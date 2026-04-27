/**
 * Brand-guideline extraction pipeline (Memory v1 Brief 3).
 *
 * Spec: docs/research/2026-04-25-sota-implementation-specs.md §4
 * Brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 3)
 *
 * Three phases (Anthropic three-agent harness, P-9):
 *   1. Extract via BAML ExtractBrandGuideline (Sonnet 4.6)
 *   2. Validate via BAML ValidateBrandGuideline (Haiku 4.5).
 *      Reject when validation.confidence < 0.7.
 *   3. Persist via SECURITY DEFINER RPC public.persist_brand_guideline.
 *      Per Brief 1 architectural pivot: NEVER use withActor for the persist
 *      phase. The RPC sets app.actor inside its body so the audit trigger
 *      reads the actor inside the same transaction.
 *
 * Wraps the run in beginWorkflowRun / finishWorkflowRun for telemetry on
 * memory_workflow_runs (status, candidates_created, cost, tokens).
 */
import { Collector } from "@boundaryml/baml";
import type { SupabaseClient } from "@supabase/supabase-js";

import { b } from "../../baml_client";
import type { BrandGuidelineExtraction, BrandGuidelineValidation } from "../../baml_client";
import {
  beginWorkflowRun,
  ensureMemoryWorkflow,
  finishWorkflowRun,
} from "./memory-workflow-runs";

// Prompt and skill version: bump when brand_guideline.baml prompt changes.
export const BRAND_EXTRACTION_PROMPT_VERSION = "v1.0";
export const BRAND_EXTRACTION_SKILL_REF = "basquio-brand-extraction";
export const BRAND_EXTRACTION_SKILL_VERSION = "1.0.0";

// Validation gate: persistence requires confidence >= this floor. Lower
// confidence is logged on memory_workflow_runs as a failure with the reason.
export const VALIDATION_CONFIDENCE_FLOOR = 0.7;

// Anthropic per-million-token pricing (Apr 2026, model-aware).
// Sonnet 4.6: $3 / $15 in/out, $3.75 cache write, $0.30 cache read.
// Haiku 4.5:  $1 / $5  in/out, $1.25 cache write, $0.10 cache read.
const SONNET_PRICE = { input: 3, output: 15, cachedRead: 0.3 };
const HAIKU_PRICE = { input: 1, output: 5, cachedRead: 0.1 };

function priceTokens(
  usage: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null },
  rates: { input: number; output: number; cachedRead: number },
): number {
  const inMt = (usage.inputTokens ?? 0) / 1_000_000;
  const outMt = (usage.outputTokens ?? 0) / 1_000_000;
  const cachedMt = (usage.cachedInputTokens ?? 0) / 1_000_000;
  return inMt * rates.input + outMt * rates.output + cachedMt * rates.cachedRead;
}

export type RunBrandGuidelineExtractionInput = {
  workspaceId: string;
  organizationId: string;
  documentId: string;
  pdfText: string;
  pageCount: number;
  actor: string;
  brandEntityId?: string | null;
  scopeId?: string | null;
};

export type RunBrandGuidelineExtractionResult = {
  workflowRunId: string;
  brandGuidelineId: string;
  brand: string;
  version: string;
  extractionConfidence: number;
  validationConfidence: number;
  costUsd: number;
  tokensInput: number;
  tokensOutput: number;
  ruleCounts: {
    typography: number;
    colour: number;
    tone: number;
    imagery: number;
    forbidden: number;
    layoutConstraints: number;
    logoRules: number;
    languagePreferences: number;
  };
};

export class BrandExtractionValidationError extends Error {
  readonly confidence: number;
  readonly issues: string[];
  constructor(message: string, confidence: number, issues: string[]) {
    super(message);
    this.name = "BrandExtractionValidationError";
    this.confidence = confidence;
    this.issues = issues;
  }
}

export async function runBrandGuidelineExtraction(
  supabase: SupabaseClient,
  input: RunBrandGuidelineExtractionInput,
): Promise<RunBrandGuidelineExtractionResult> {
  if (!input.actor || input.actor.trim().length === 0) {
    throw new Error("runBrandGuidelineExtraction: actor is required");
  }

  const workflowId = await ensureMemoryWorkflow(supabase, {
    organizationId: input.organizationId,
    name: "brand-guideline-extraction",
    version: 1,
    triggerKind: "on_upload",
    skillRef: BRAND_EXTRACTION_SKILL_REF,
    metadata: { phase: "memory-v1-brief-3" },
  });

  const workflowRunId = await beginWorkflowRun(supabase, {
    workflowId,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    scopeId: input.scopeId ?? null,
    triggerPayload: {
      document_id: input.documentId,
      page_count: input.pageCount,
      actor: input.actor,
    },
    promptVersion: BRAND_EXTRACTION_PROMPT_VERSION,
    skillVersion: BRAND_EXTRACTION_SKILL_VERSION,
  });

  const extractCollector = new Collector("brand-extraction-extract");
  const validateCollector = new Collector("brand-extraction-validate");

  try {
    // Phase 1: extract (Sonnet 4.6).
    const extraction: BrandGuidelineExtraction = await b.ExtractBrandGuideline(
      input.pdfText,
      input.pageCount,
      { collector: extractCollector },
    );

    // Phase 2: validate (Haiku 4.5).
    const validation: BrandGuidelineValidation = await b.ValidateBrandGuideline(
      extraction,
      { collector: validateCollector },
    );

    const extractUsage = extractCollector.usage;
    const validateUsage = validateCollector.usage;
    const tokensInput = (extractUsage.inputTokens ?? 0) + (validateUsage.inputTokens ?? 0);
    const tokensOutput = (extractUsage.outputTokens ?? 0) + (validateUsage.outputTokens ?? 0);
    const costUsd =
      priceTokens(extractUsage, SONNET_PRICE) + priceTokens(validateUsage, HAIKU_PRICE);

    if (validation.confidence < VALIDATION_CONFIDENCE_FLOOR) {
      const reason = `validation rejected (confidence=${validation.confidence.toFixed(3)}): ${validation.reason}`;
      await finishWorkflowRun(supabase, workflowRunId, {
        status: "failure",
        candidatesCreated: 0,
        costUsd,
        tokensInput,
        tokensOutput,
        errorMessage: reason,
        metadata: {
          extraction_brand: extraction.brand,
          extraction_version: extraction.version,
          extraction_confidence: extraction.extraction_confidence,
          validation_confidence: validation.confidence,
          validation_issues: validation.issues,
          rule_counts: {
            typography: extraction.typography.length,
            colour: extraction.colour.length,
            tone: extraction.tone.length,
            imagery: extraction.imagery.length,
          },
        },
      });
      throw new BrandExtractionValidationError(
        reason,
        validation.confidence,
        validation.issues,
      );
    }

    // Phase 3: persist via SECURITY DEFINER RPC.
    const { data: brandGuidelineId, error: rpcError } = await supabase.rpc(
      "persist_brand_guideline",
      {
        p_workspace_id: input.workspaceId,
        p_brand: extraction.brand,
        p_version: extraction.version,
        p_source_document_id: input.documentId,
        p_brand_entity_id: input.brandEntityId ?? null,
        p_typography: extraction.typography,
        p_colour: extraction.colour,
        p_tone: extraction.tone,
        p_imagery: extraction.imagery,
        p_forbidden: extraction.forbidden,
        p_language_preferences: extraction.language_preferences,
        p_layout: extraction.layout_constraints,
        p_logo: extraction.logo_rules,
        p_extraction_confidence: extraction.extraction_confidence,
        p_actor: input.actor,
        p_workflow_run_id: workflowRunId,
      },
    );

    if (rpcError) {
      await finishWorkflowRun(supabase, workflowRunId, {
        status: "failure",
        candidatesCreated: 0,
        costUsd,
        tokensInput,
        tokensOutput,
        errorMessage: `persist_brand_guideline RPC failed: ${rpcError.message}`,
        metadata: {
          extraction_brand: extraction.brand,
          extraction_version: extraction.version,
          extraction_confidence: extraction.extraction_confidence,
          validation_confidence: validation.confidence,
          rpc_error_code: rpcError.code,
        },
      });
      throw new Error(`persist_brand_guideline RPC failed: ${rpcError.message}`);
    }

    const persistedId = String(brandGuidelineId);

    await finishWorkflowRun(supabase, workflowRunId, {
      status: "success",
      candidatesCreated: 1,
      costUsd,
      tokensInput,
      tokensOutput,
      metadata: {
        brand_guideline_id: persistedId,
        extraction_brand: extraction.brand,
        extraction_version: extraction.version,
        extraction_confidence: extraction.extraction_confidence,
        validation_confidence: validation.confidence,
        validation_issues: validation.issues,
        rule_counts: {
          typography: extraction.typography.length,
          colour: extraction.colour.length,
          tone: extraction.tone.length,
          imagery: extraction.imagery.length,
          forbidden: extraction.forbidden.length,
          layout_constraints: extraction.layout_constraints.length,
          logo_rules: extraction.logo_rules.length,
          language_preferences: extraction.language_preferences.length,
        },
      },
    });

    return {
      workflowRunId,
      brandGuidelineId: persistedId,
      brand: extraction.brand,
      version: extraction.version,
      extractionConfidence: extraction.extraction_confidence,
      validationConfidence: validation.confidence,
      costUsd,
      tokensInput,
      tokensOutput,
      ruleCounts: {
        typography: extraction.typography.length,
        colour: extraction.colour.length,
        tone: extraction.tone.length,
        imagery: extraction.imagery.length,
        forbidden: extraction.forbidden.length,
        layoutConstraints: extraction.layout_constraints.length,
        logoRules: extraction.logo_rules.length,
        languagePreferences: extraction.language_preferences.length,
      },
    };
  } catch (err) {
    if (err instanceof BrandExtractionValidationError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    await finishWorkflowRun(supabase, workflowRunId, {
      status: "failure",
      candidatesCreated: 0,
      costUsd:
        priceTokens(extractCollector.usage, SONNET_PRICE) +
        priceTokens(validateCollector.usage, HAIKU_PRICE),
      tokensInput:
        (extractCollector.usage.inputTokens ?? 0) +
        (validateCollector.usage.inputTokens ?? 0),
      tokensOutput:
        (extractCollector.usage.outputTokens ?? 0) +
        (validateCollector.usage.outputTokens ?? 0),
      errorMessage: message,
    });
    throw err;
  }
}
