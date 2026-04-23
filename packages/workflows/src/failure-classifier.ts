/**
 * Canonical failure classifier for Basquio run engine.
 *
 * Single source of truth for:
 * - worker retry/supersession policy
 * - jobs API failure mapping
 * - cost accounting
 * - template fallback decisions
 */

export type FailureClass =
  | "transient_provider"
  | "transient_network"
  | "structured_output_invalid"
  | "analysis_json_invalid"
  | "manifest_json_invalid"
  | "rendered_page_qa_invalid"
  | "artifact_repair_invalid"
  | "missing_required_artifact"
  | "export_build_failure"
  | "worker_interruption"
  | "unsupported_input"
  | "budget_exceeded"
  | "internal_processing_error";

export type FailureClassification = {
  class: FailureClass;
  retryable: boolean;
  headline: string;
  explanation: string;
  retryAdvice: string;
};

const RETRYABLE_CONTAINER_STRING_ERROR = "container: input should be a valid string";

export function isRetryableContainerStringError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const status = "status" in error ? (error as { status?: number }).status : undefined;
  return msg.includes(RETRYABLE_CONTAINER_STRING_ERROR) && (status === undefined || status === 400);
}

/**
 * Classify a runtime error from the worker/generation path.
 */
export function classifyRuntimeError(error: unknown): FailureClass {
  if (isTransientProviderError(error)) return "transient_provider";
  if (isTransientNetworkError(error)) return "transient_network";
  if (isAnalysisJsonError(error)) return "analysis_json_invalid";
  if (isManifestJsonError(error)) return "manifest_json_invalid";
  if (isRenderedPageQaError(error)) return "rendered_page_qa_invalid";
  if (isArtifactRepairError(error)) return "artifact_repair_invalid";
  if (isStructuredOutputError(error)) return "structured_output_invalid";
  if (isMissingArtifactError(error)) return "missing_required_artifact";
  if (isBudgetError(error)) return "budget_exceeded";
  if (isUnsupportedInputError(error)) return "unsupported_input";
  return "internal_processing_error";
}

/**
 * Classify a stored failure message (from deck_runs.failure_message).
 */
export function classifyFailureMessage(message: string, isStale = false): FailureClassification {
  if (isStale) {
    return {
      class: "worker_interruption",
      retryable: true,
      headline: "Run stalled",
      explanation: "The worker stopped responding during generation.",
      retryAdvice: "Basquio will try to recover this automatically after the stale-run timeout window. If it still does not resume, start a new run.",
    };
  }

  const msg = message.toLowerCase();

  if (matchesTransientProvider(msg)) {
    return {
      class: "transient_provider",
      retryable: true,
      headline: "Our AI provider is experiencing issues right now",
      explanation: "This is temporary and not related to your file.",
      retryAdvice: "Your credits have been refunded. Retry in a few minutes and it should work once the provider recovers.",
    };
  }

  if (matchesTransientNetwork(msg)) {
    return {
      class: "transient_network",
      retryable: true,
      headline: "Temporary service issue",
      explanation: "A network or storage request failed before delivery completed.",
      retryAdvice: "This is usually transient. Retry with the same files — it should work on the next attempt.",
    };
  }

  if (matchesUnsupportedInput(msg)) {
    return {
      class: "unsupported_input",
      retryable: false,
      headline: "Input files could not be processed",
      explanation: "Basquio could not read usable data from the uploaded files.",
      retryAdvice: "Make sure you include at least one CSV or XLSX workbook with numeric data. Remove corrupted or password-protected files.",
    };
  }

  // F2: Split structured-output failures into specific sub-types
  if (matchesAnalysisJsonFailure(msg)) {
    return {
      class: "analysis_json_invalid",
      retryable: true,
      headline: "Analysis output was malformed",
      explanation: "The model returned invalid analysis JSON during the planning phase.",
      retryAdvice: "Retry with the same files. If it keeps happening, try simplifying the brief.",
    };
  }

  if (matchesManifestJsonFailure(msg)) {
    return {
      class: "manifest_json_invalid",
      retryable: true,
      headline: "Deck manifest was malformed",
      explanation: "The model returned an invalid deck manifest during generation.",
      retryAdvice: "Retry with the same files. If it keeps happening, try simplifying the brief.",
    };
  }

  if (matchesRenderedPageQaFailure(msg)) {
    return {
      class: "rendered_page_qa_invalid",
      retryable: true,
      headline: "Visual review failed",
      explanation: "The visual quality review returned an unreadable response.",
      retryAdvice: "Retry with the same files. The deck was likely generated but could not be reviewed.",
    };
  }

  if (matchesStructuredOutput(msg)) {
    return {
      class: "structured_output_invalid",
      retryable: true,
      headline: "Generation output was malformed",
      explanation: "The model returned an invalid response during generation.",
      retryAdvice: "Retry with the same files. If it keeps happening, try simplifying the brief.",
    };
  }

  if (matchesMissingArtifact(msg)) {
    return {
      class: "missing_required_artifact",
      retryable: true,
      headline: "Deck export failed",
      explanation: "The analysis completed but the final deck artifacts could not be assembled.",
      retryAdvice: "Retry with the same files. If it happens again, try simplifying the brief or reducing the number of input files.",
    };
  }

  if (matchesExportFailure(msg)) {
    return {
      class: "export_build_failure",
      retryable: false,
      headline: "Deck export failed",
      explanation: "The analysis completed but the final deck artifacts could not be assembled.",
      retryAdvice: "Retry with the same files. If it happens again, try simplifying the brief or reducing the number of input files.",
    };
  }

  if (matchesBudget(msg)) {
    return {
      class: "budget_exceeded",
      retryable: false,
      headline: "Generation cost limit reached",
      explanation: "The run exceeded its cost safety limit.",
      retryAdvice: "Retry with a simpler brief or fewer input files to reduce generation complexity.",
    };
  }

  return {
    class: "internal_processing_error",
    retryable: false,
    headline: "Something went wrong",
    explanation: "An unexpected error occurred during generation.",
    retryAdvice: "Retry with the same files. If it keeps happening, try a simpler brief or fewer support files.",
  };
}

/**
 * Check if an error is transient and should trigger in-phase retry.
 */
export function isTransientProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const name = error.name?.toLowerCase() ?? "";

  if (isRetryableContainerStringError(error)) return true;
  if (msg === "terminated" || msg.includes("execution environment terminated")) return true;
  if (msg.includes("overloaded") || msg.includes("overloaded_error")) return true;
  if (msg.includes("api_error") || msg.includes("internal server error")) return true;
  if (msg.includes("rate_limit") || msg.includes("rate limit")) return true;
  if (msg.includes("too_many_requests")) return true;
  if (msg.includes("container_expired")) return true;
  if (msg.includes("execution_time_exceeded") || msg.includes("code_execution_exceeded")) return true;
  if (msg.includes("tool_result_error") && msg.includes("unavailable")) return true;
  if (/\b(429|500|529|502|503|504)\b/.test(msg)) return true;
  if (msg.includes("stream ended") || msg.includes("did not return")) return true;
  if (msg.includes("request ended without sending any chunks")) return true;
  if (msg.includes("request was aborted")) return true;
  if (msg.includes("timed out after") && msg.includes("claude")) return true;
  if (msg.includes("connection") && (msg.includes("reset") || msg.includes("refused") || msg.includes("closed"))) return true;
  if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("etimedout")) return true;
  if (name.includes("fetcherror") || name.includes("aborterror")) return true;

  if ("status" in error) {
    const status = (error as { status?: number }).status;
    if (status && [429, 500, 502, 503, 504, 529].includes(status)) return true;
  }

  return false;
}

// ─── Internal runtime error matchers ────────────────────────

function isAnalysisJsonError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("structured analysis") ||
    msg.includes("analysis_result.json") ||
    (msg.includes("analysis json") && (msg.includes("parse") || msg.includes("invalid") || msg.includes("malformed")));
}

function isManifestJsonError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("deck_manifest") && (msg.includes("malformed") || msg.includes("parse"));
}

function isRenderedPageQaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("rendered-page qa") && (msg.includes("invalid json") || msg.includes("repair retry"));
}

function isArtifactRepairError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("artifact qa failed") || (msg.includes("artifact") && msg.includes("repair") && msg.includes("failed"));
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("request was aborted") ||
    msg.includes("fetch failed") ||
    msg.includes("transient storage") ||
    msg.includes("storage upload failure") ||
    msg.includes("storage upstream error");
}

function isStructuredOutputError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (msg.includes("json") && (msg.includes("parse") || msg.includes("position") || msg.includes("unexpected"))) ||
    msg.includes("structured analysis") || msg.includes("parseable");
}

function isMissingArtifactError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("did not generate required file") || msg.includes("missing file");
}

function isBudgetError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("budget") || msg.includes("spend") || msg.includes("cost limit");
}

function isUnsupportedInputError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("no analytical evidence") || msg.includes("needs at least one") ||
    (msg.includes("unsupported") && !msg.includes("archetype"));
}

function matchesTransientProvider(msg: string): boolean {
  return msg.includes(RETRYABLE_CONTAINER_STRING_ERROR) ||
    msg === "terminated" ||
    msg.includes("execution environment terminated") ||
    msg.includes("upstream error") || msg.includes("upstream infrastructure") ||
    msg.includes("connection error") || msg.includes("overloaded") ||
    msg.includes("500") || msg.includes("internal server error") || msg.includes("api_error") ||
    msg.includes("529") || msg.includes("502") || msg.includes("503") ||
    msg.includes("rate limit") || msg.includes("too_many_requests") ||
    msg.includes("container_expired") ||
    msg.includes("execution_time_exceeded") ||
    msg.includes("code_execution_exceeded") ||
    (msg.includes("tool_result_error") && msg.includes("unavailable")) ||
    msg.includes("stream ended") ||
    msg.includes("did not return") || msg.includes("request ended without sending any chunks");
}

function matchesTransientNetwork(msg: string): boolean {
  return msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed") ||
    msg.includes("aborterror") ||
    msg.includes("transient storage") ||
    msg.includes("storage upload failure") ||
    msg.includes("storage upstream error");
}

function matchesUnsupportedInput(msg: string): boolean {
  return msg.includes("no analytical evidence") || msg.includes("needs at least one") ||
    msg.includes("unsupported") || msg.includes("unreadable") ||
    (msg.includes("parse") && msg.includes("evidence"));
}

function matchesAnalysisJsonFailure(msg: string): boolean {
  return msg.includes("structured analysis") ||
    msg.includes("analysis_result.json") ||
    (msg.includes("analysis json") && (msg.includes("parse") || msg.includes("invalid") || msg.includes("malformed")));
}

function matchesManifestJsonFailure(msg: string): boolean {
  return msg.includes("deck_manifest") && (msg.includes("malformed") || msg.includes("parseable") || msg.includes("parse"));
}

function matchesRenderedPageQaFailure(msg: string): boolean {
  return msg.includes("rendered-page qa") && (msg.includes("invalid json") || msg.includes("repair retry"));
}

function matchesStructuredOutput(msg: string): boolean {
  return (msg.includes("json") && (msg.includes("parse") || msg.includes("position") || msg.includes("unexpected"))) ||
    msg.includes("parseable");
}

function matchesMissingArtifact(msg: string): boolean {
  return msg.includes("did not generate") && (
    msg.includes("deck.pptx") ||
    msg.includes("deck.pdf") ||
    msg.includes("deck_manifest") ||
    msg.includes("analysis_result.json")
  );
}

function matchesExportFailure(msg: string): boolean {
  // Only match actual export/QA failures, not missing-artifact patterns which have their own class
  return msg.includes("artifact qa failed") ||
    (msg.includes("export") && (msg.includes("failed") || msg.includes("error")));
}

function matchesBudget(msg: string): boolean {
  return msg.includes("budget") || msg.includes("spend") || msg.includes("cost limit");
}
