import Anthropic from "@anthropic-ai/sdk";

import { fetchRestRows } from "./supabase";

const MODEL_PRICING: Record<string, { inputUsdPerMTok: number; outputUsdPerMTok: number }> = {
  "claude-sonnet-4-6": { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
  "claude-haiku-4-5": { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  "claude-opus-4-6": { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
  "claude-opus-4-7": { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
};
export const EMERGENCY_USD_CEILING = 30.0;

export const MODEL_BUDGET_USD: Record<keyof typeof MODEL_PRICING, {
  preFlight: number;
  hard: number;
  crossAttempt: number;
}> = {
  "claude-sonnet-4-6": { preFlight: 7.0, hard: 10.0, crossAttempt: 15.0 },
  "claude-haiku-4-5": { preFlight: 3.0, hard: 5.0, crossAttempt: 8.0 },
  "claude-opus-4-6": { preFlight: 12.0, hard: 18.0, crossAttempt: 24.0 },
  "claude-opus-4-7": { preFlight: 12.0, hard: 18.0, crossAttempt: 24.0 },
};

export function getDeckBudgetCaps(
  model: keyof typeof MODEL_PRICING,
  targetSlideCount?: number,
) {
  if ((model === "claude-opus-4-6" || model === "claude-opus-4-7") && typeof targetSlideCount === "number" && targetSlideCount >= 40) {
    return { preFlight: 30.0, hard: 42.0, crossAttempt: 48.0 };
  }
  return MODEL_BUDGET_USD[model];
}

type FileBackedBudgetContext = {
  phase: "author" | "revise" | "critique" | "export";
  targetSlideCount: number;
  fileCount: number;
  attachmentKinds?: string[];
  hasWorkspaceContext: boolean;
  hasPriorRevise?: boolean;
  priorSpendUsd: number;
};

type BudgetWarning = {
  model: keyof typeof MODEL_PRICING;
  projectedUsd: number;
  softCapUsd: number;
  spentUsd: number;
};

export async function enforceDeckBudget(input: {
  client: Anthropic;
  model: keyof typeof MODEL_PRICING;
  betas: string[];
  body: Omit<Anthropic.Beta.MessageCountTokensParams, "model" | "betas">;
  spentUsd: number;
  outputTokenBudget: number;
  maxUsd?: number;
  fileBackedBudgetContext?: FileBackedBudgetContext;
  onSoftCapExceeded?: (warning: BudgetWarning) => Promise<void> | void;
}) {
  const maxUsd = input.maxUsd ?? getDeckBudgetCaps(input.model).preFlight;

  // Anthropic's token-counting endpoint rejects Files API references such as
  // `source: { type: "file", file_id }`, container uploads, and server tools.
  // Use token counting only for inline-only requests and fall back to
  // actual-usage enforcement for file-backed or tool-backed phases.
  if (containsUncountableRequestSurface(input.body)) {
    const projectedUsd = input.spentUsd + estimateFileBackedEnvelopeUsd(
      input.model,
      input.outputTokenBudget,
      input.fileBackedBudgetContext,
    );
    const overBudget = await handleProjectedBudget({
      model: input.model,
      projectedUsd,
      softCapUsd: maxUsd,
      spentUsd: input.spentUsd,
      onSoftCapExceeded: input.onSoftCapExceeded,
    });

    return {
      inputTokens: null,
      projectedUsd,
      overBudget,
      usedCountTokens: false,
      envelopeContext: input.fileBackedBudgetContext ?? null,
    };
  }

  let tokenCount: Awaited<ReturnType<Anthropic["beta"]["messages"]["countTokens"]>>;
  try {
    tokenCount = await input.client.beta.messages.countTokens({
      model: input.model,
      betas: input.betas as Anthropic.Beta.AnthropicBeta[],
      ...input.body,
    });
  } catch (error) {
    if (!isCountTokensUnsupportedError(error)) {
      throw error;
    }

    const projectedUsd = input.spentUsd + estimateFileBackedEnvelopeUsd(
      input.model,
      input.outputTokenBudget,
      input.fileBackedBudgetContext,
    );
    const overBudget = await handleProjectedBudget({
      model: input.model,
      projectedUsd,
      softCapUsd: maxUsd,
      spentUsd: input.spentUsd,
      onSoftCapExceeded: input.onSoftCapExceeded,
    });

    return {
      inputTokens: null,
      projectedUsd,
      overBudget,
      usedCountTokens: false,
      envelopeContext: input.fileBackedBudgetContext ?? null,
    };
  }

  const projectedUsd =
    input.spentUsd +
    estimateUsd(input.model, tokenCount.input_tokens, input.outputTokenBudget);

  const overBudget = await handleProjectedBudget({
    model: input.model,
    projectedUsd,
    softCapUsd: maxUsd,
    spentUsd: input.spentUsd,
    onSoftCapExceeded: input.onSoftCapExceeded,
  });

  return {
    inputTokens: tokenCount.input_tokens,
    projectedUsd,
    overBudget,
    usedCountTokens: true,
    envelopeContext: null,
  };
}

export function assertDeckSpendWithinBudget(
  spentUsd: number,
  maxUsdOrModel: number | keyof typeof MODEL_PRICING = "claude-sonnet-4-6",
  options?: {
    allowPartialOutput?: boolean;
    context?: string;
    targetSlideCount?: number;
    onSoftCapExceeded?: (warning: BudgetWarning) => Promise<void> | void;
  },
) {
  const maxUsd = typeof maxUsdOrModel === "number"
    ? maxUsdOrModel
    : getDeckBudgetCaps(maxUsdOrModel, options?.targetSlideCount).hard;
  if (spentUsd > EMERGENCY_USD_CEILING) {
    throwEmergencyBudgetError("Claude cost", spentUsd);
  }

  const overBudget = spentUsd > maxUsd;
  if (overBudget) {
    console.warn(
      `[cost-guard] spend $${spentUsd.toFixed(3)} exceeds soft cap $${maxUsd.toFixed(2)}${options?.context ? ` during ${options.context}` : ""}, continuing.`,
    );
    void options?.onSoftCapExceeded?.({
      model: typeof maxUsdOrModel === "string" ? maxUsdOrModel : "claude-sonnet-4-6",
      projectedUsd: spentUsd,
      softCapUsd: maxUsd,
      spentUsd,
    });
  }

  return {
    overBudget,
    projectedUsd: spentUsd,
    softCapUsd: maxUsd,
    emergencyCeilingUsd: EMERGENCY_USD_CEILING,
  };
}

export function estimateUsd(
  model: keyof typeof MODEL_PRICING,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens: number = 0,
  cacheReadInputTokens: number = 0,
) {
  const pricing = MODEL_PRICING[model];
  return roundUsd(
    (inputTokens / 1_000_000) * pricing.inputUsdPerMTok +
      (cacheCreationInputTokens / 1_000_000) * pricing.inputUsdPerMTok * 1.25 +
      (cacheReadInputTokens / 1_000_000) * pricing.inputUsdPerMTok * 0.1 +
      (outputTokens / 1_000_000) * pricing.outputUsdPerMTok,
  );
}

export function usageToCost(
  model: keyof typeof MODEL_PRICING,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  } | null | undefined,
) {
  return estimateUsd(
    model,
    usage?.input_tokens ?? 0,
    usage?.output_tokens ?? 0,
    usage?.cache_creation_input_tokens ?? 0,
    usage?.cache_read_input_tokens ?? 0,
  );
}

export function roundUsd(value: number) {
  return Math.round(value * 1000) / 1000;
}

export async function getPriorAttemptsCost(input: {
  supabaseUrl: string;
  serviceKey: string;
  runId: string;
  excludeAttemptId?: string | null;
}) {
  const attempts = await fetchRestRows<{
    id: string;
    status: string;
    cost_telemetry: Record<string, unknown> | null;
  }>({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,status,cost_telemetry",
      run_id: `eq.${input.runId}`,
      order: "attempt_number.asc",
      limit: "50",
    },
  }).catch(() => []);

  return roundUsd(
    attempts
      .filter((row) => row.id !== input.excludeAttemptId)
      .filter((row) => row.status !== "queued" && row.status !== "running")
      .reduce((sum, row) => {
        const value = Number(row.cost_telemetry?.estimatedCostUsd ?? 0);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0),
  );
}

function containsUncountableRequestSurface(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsUncountableRequestSurface(item));
  }

  const record = value as Record<string, unknown>;

  if (record.type === "container_upload") {
    return true;
  }

  if (record.type === "file" && typeof record.file_id === "string") {
    return true;
  }

  if (
    record.source &&
    typeof record.source === "object" &&
    (record.source as Record<string, unknown>).type === "file" &&
    typeof (record.source as Record<string, unknown>).file_id === "string"
  ) {
    return true;
  }

  if (hasUnsupportedCountTokensServerTool(record)) {
    return true;
  }

  return Object.values(record).some((entry) => containsUncountableRequestSurface(entry));
}

async function handleProjectedBudget(input: {
  model: keyof typeof MODEL_PRICING;
  projectedUsd: number;
  softCapUsd: number;
  spentUsd: number;
  onSoftCapExceeded?: (warning: BudgetWarning) => Promise<void> | void;
}) {
  if (input.projectedUsd > EMERGENCY_USD_CEILING) {
    throwEmergencyBudgetError("Projected Claude cost", input.projectedUsd);
  }

  const overBudget = input.projectedUsd > input.softCapUsd;
  if (overBudget) {
    console.warn(
      `[cost-guard] projected spend $${input.projectedUsd.toFixed(3)} exceeds soft cap $${input.softCapUsd.toFixed(2)} for ${input.model}, continuing.`,
    );
    await input.onSoftCapExceeded?.({
      model: input.model,
      projectedUsd: input.projectedUsd,
      softCapUsd: input.softCapUsd,
      spentUsd: input.spentUsd,
    });
  }

  return overBudget;
}

function hasUnsupportedCountTokensServerTool(record: Record<string, unknown>) {
  const type = typeof record.type === "string" ? record.type : null;
  const name = typeof record.name === "string" ? record.name : null;
  return (
    type?.startsWith("code_execution_") === true ||
    type?.startsWith("web_fetch_") === true ||
    name === "code_execution" ||
    name === "web_fetch"
  );
}

function throwEmergencyBudgetError(label: string, usd: number): never {
  throw new Error(
    `${label} $${usd.toFixed(3)} exceeds emergency ceiling $${EMERGENCY_USD_CEILING.toFixed(2)}. Circuit breaker.`,
  );
}

function isCountTokensUnsupportedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("count_tokens endpoint") ||
    normalized.includes("count tokens endpoint") ||
    (
      normalized.includes("count_tokens") &&
      (
        normalized.includes("server tools are not supported") ||
        normalized.includes("web_fetch") ||
        normalized.includes("code_execution")
      )
    )
  );
}

function estimateFileBackedEnvelopeUsd(
  model: keyof typeof MODEL_PRICING,
  outputTokenBudget: number,
  context?: FileBackedBudgetContext,
) {
  const baselineOutputOnly = estimateUsd(model, 0, outputTokenBudget);
  if (!context) {
    return baselineOutputOnly;
  }

  const slideBucket =
    context.targetSlideCount <= 10 ? "short"
      : context.targetSlideCount <= 20 ? "standard"
      : context.targetSlideCount <= 40 ? "deep"
      : "long";
  const filePressure = Math.min(0.55, Math.max(0, context.fileCount - 1) * 0.09);
  const workspacePressure = context.hasWorkspaceContext ? 0.24 : 0;
  const revisePressure = context.phase === "revise" ? 0.55 : 0;
  const priorRevisePressure = context.hasPriorRevise ? 0.18 : 0;
  const attachmentKinds = new Set((context.attachmentKinds ?? []).map((kind) => kind.trim().toLowerCase()));
  const documentPressure =
    (attachmentKinds.has("pdf") ? 0.1 : 0) +
    (attachmentKinds.has("pptx") ? 0.08 : 0) +
    (attachmentKinds.has("document") ? 0.06 : 0);
  const slidePressure =
    slideBucket === "short" ? 0.65
      : slideBucket === "standard" ? 1.15
      : slideBucket === "deep" ? 1.8
      : 2.8;
  const modelPressure =
    model === "claude-haiku-4-5" ? 0.65
      : model === "claude-sonnet-4-6" ? 1
      : 1.65;
  const phasePressure =
    context.phase === "author" ? 1.2
      : context.phase === "revise" ? 0.95
      : context.phase === "critique" ? 0.28
      : 0.24;

  const telemetryEnvelope = roundUsd(
    (slidePressure * modelPressure * phasePressure) +
      filePressure +
      workspacePressure +
      documentPressure +
      priorRevisePressure,
  );

  return Math.max(baselineOutputOnly, telemetryEnvelope);
}
