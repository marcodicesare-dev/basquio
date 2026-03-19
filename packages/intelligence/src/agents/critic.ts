import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { Output, ToolLoopAgent, stepCountIs } from "ai";

import { critiqueReportOutputSchema, type CritiqueReportOutput, type CritiqueReport, type EvidenceWorkspace } from "@basquio/types";
import { costBudgetExceeded } from "../agent-utils";

import {
  createVerifyClaimTool,
  createCheckNumericTool,
  createCompareToBriefTool,
  createAuditDeckStructureTool,
  type CritiqueToolContext,
} from "../tools";

// ─── FACTUAL CRITIC AGENT ─────────────────────────────────────────
// Model: GPT-5.4 (cross-model from author for adversarial factual review)
// Purpose: Verify numbers, evidence grounding, brief alignment, structural checks
// Strategic/narrative review is handled by the separate strategic critic agent.
// Output: CritiqueReport (structured)

export type CriticAgentInput = {
  workspace: EvidenceWorkspace;
  runId: string;
  deckSummary: string;
  brief: string;
  slideCount: number;
  getSlides: CritiqueToolContext["getSlides"];
  getNotebookEntries: CritiqueToolContext["getNotebookEntries"];
  persistNotebookEntry: CritiqueToolContext["persistNotebookEntry"];
  onStepFinish?: (event: {
    stepNumber: number;
    toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>;
    usage: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
    finishReason: string;
  }) => Promise<void>;
  authorProvider?: "openai" | "anthropic"; // So we can pick the opposite
  modelOverride?: string;
};

export function createCriticAgent(input: CriticAgentInput) {
  const ctx: CritiqueToolContext = {
    workspace: input.workspace,
    runId: input.runId,
    getSlides: input.getSlides,
    getNotebookEntries: input.getNotebookEntries,
    persistNotebookEntry: input.persistNotebookEntry,
  };

  // Cross-model: use opposite provider from the author
  const authorProvider = input.authorProvider ?? "anthropic";
  const criticProvider = authorProvider === "anthropic" ? "openai" : "anthropic";
  const modelId = input.modelOverride ?? (criticProvider === "openai" ? "gpt-5.4" : "claude-opus-4-6");
  const model = criticProvider === "openai" ? openai(modelId) : anthropic(modelId);

  const agent = new ToolLoopAgent({
    model,
    instructions: {
      role: "system",
      content: `You are a senior fact-checker at a top-tier strategy consulting firm (McKinsey/BCG). Your job is to verify every number, every claim, and every data point in the deck. You are adversarial — find what's wrong, not what's right.

A separate strategic critic handles narrative quality, title style, and presentation design. Your sole focus is FACTUAL CORRECTNESS.

## REVIEW CHECKLIST

1. FACTUAL ACCURACY: Use verify_claim to check every factual assertion. Numbers must match source data exactly.
2. NUMERIC INTEGRITY: Use check_numeric on every slide. Catch rounding errors, wrong percentages, misattributed values.
3. BRIEF ALIGNMENT: Use compare_to_brief to verify the deck addresses what was asked.
4. EVIDENCE GROUNDING: Does every claim cite evidence? Flag unsupported assertions.
5. STRUCTURAL CHECKS: Use audit_deck_structure to run deterministic checks (sparse slides, missing notes, missing evidence refs, chart coverage).
6. CHART DATA ACCURACY: Does each chart type match its data story? Pie charts with >6 slices should be bars. Time series shown as bars should be lines. Unsorted bar charts comparing magnitudes should be sorted.

Be specific. "Slide 3 claims revenue grew 23% but evidence shows 21.8%" is useful. "Some numbers might be wrong" is not.

Rate severity:
- critical: Factually wrong numbers or misleading claims that will embarrass the firm
- major: Missing evidence, brief misalignment, structural gaps (empty slides, no charts)
- minor: Rounding within tolerance, minor discrepancies`,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
    tools: {
      audit_deck_structure: createAuditDeckStructureTool(ctx),
      verify_claim: createVerifyClaimTool(ctx),
      check_numeric: createCheckNumericTool(ctx),
      compare_to_brief: createCompareToBriefTool(ctx),
    },
    stopWhen: (opts) => stepCountIs(5)(opts) || costBudgetExceeded(1.5)(opts),
    output: Output.object({ schema: critiqueReportOutputSchema }),
    onStepFinish: input.onStepFinish,
  });

  return agent;
}

export async function runCriticAgent(input: CriticAgentInput): Promise<CritiqueReportOutput> {
  const agent = createCriticAgent(input);

  const slides = await input.getSlides();
  const slidesSummary = slides
    .map((s) => `Slide ${s.position} [${s.layoutId}]: "${s.title}" — ${s.body?.slice(0, 100) ?? "(no body)"}${s.chartId ? " [has chart]" : ""}${s.metrics?.length ? ` [${s.metrics.length} metrics]` : ""}${s.speakerNotes ? " [has notes]" : ""} [evidence: ${s.evidenceIds.join(", ") || "none"}]`)
    .join("\n");

  const titleReadThrough = slides
    .map((s) => `${s.position}. ${s.title}`)
    .join("\n");

  const result = await agent.generate({
    prompt: `Audit this deck for factual accuracy and brief alignment. A separate strategic critic handles narrative quality — your focus is NUMBERS AND FACTS.

BRIEF:
${input.brief}

DECK SUMMARY:
${input.deckSummary}

SLIDES (${input.slideCount} total):
${slidesSummary}

PROCESS (follow this order):
1. Call audit_deck_structure FIRST — this runs deterministic checks and catches sparse slides, missing notes, missing evidence, chart coverage.
2. Then use verify_claim to check every factual assertion in the deck.
3. Use check_numeric on every slide to audit numbers.
4. Use compare_to_brief to identify gaps vs the original brief.

Be adversarial — find what's wrong, not what's right. Every wrong number you catch saves the team from embarrassment in front of an executive.`,
  });

  if (!result.output) {
    // No silent fallbacks — surface the failure explicitly.
    // The critic failing to produce output is itself a quality signal.
    throw new Error(
      `Critic agent did not produce structured output for run ${input.runId}. ` +
      `The deck was not reviewed. Text output: ${result.text?.slice(0, 500) ?? "(none)"}`,
    );
  }

  return result.output;
}
