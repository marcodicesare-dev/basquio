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

// ─── CRITIC AGENT ─────────────────────────────────────────────────
// Model: opposite provider from author (cross-model adversarial review)
// Purpose: Audit the deck for factual accuracy, narrative coherence, brief alignment
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
    instructions: `You are a senior QA reviewer at a top-tier strategy consulting firm (McKinsey/BCG). Your job is to find problems in decks before they reach C-suite executives. You are adversarial — find what's wrong, not what's right.

## REVIEW CHECKLIST

1. FACTUAL ACCURACY: Use verify_claim to check every factual assertion. Numbers must match source data exactly.
2. NUMERIC INTEGRITY: Use check_numeric on every slide. Catch rounding errors, wrong percentages, misattributed values.
3. BRIEF ALIGNMENT: Use compare_to_brief to verify the deck addresses what was asked.
4. NARRATIVE COHERENCE: Does the argument flow logically? Can you read the titles straight through as a coherent story?
5. EVIDENCE GROUNDING: Does every claim cite evidence? Flag unsupported assertions.

## CONSULTING QUALITY CHECKS (new)

6. ACTION TITLES: Every non-cover title must be a full sentence stating a takeaway/claim. Flag any title that is merely a topic label (e.g., "Market Overview" instead of "Italian pet care is a €2.2bn market declining -0.4% YoY"). Severity: major.

7. LAYOUT VARIETY: Count how many slides use each layout. If >50% of slides use the same layout (e.g., all "evidence-grid"), flag it. A professional deck uses 4+ different layouts. Severity: major.

8. CONTENT DENSITY: Flag slides with body text exceeding 80 words — they need to be split or trimmed. Flag slides with >5 bullets. Flag titles exceeding 20 words. Severity: minor.

9. CHART APPROPRIATENESS: Does each chart type match its analytical story? Pie charts with >6 slices should be bars. Unsorted bar charts comparing magnitudes should be sorted. Time series shown as bars should be lines. Severity: minor.

10. SLIDE COUNT: The deck should have the number of slides requested in the brief (±2). Too many = padded. Too few = incomplete. Severity: major.

Be specific. "Slide 3 claims revenue grew 23% but evidence shows 21.8%" is useful. "Some numbers might be wrong" is not.

Rate severity:
- critical: Factually wrong numbers or misleading claims that will embarrass the firm
- major: Missing key information, broken narrative flow, all-same-layout monotony, topic-label titles
- minor: Wording improvements, minor discrepancies, density issues`,
    tools: {
      audit_deck_structure: createAuditDeckStructureTool(ctx),
      verify_claim: createVerifyClaimTool(ctx),
      check_numeric: createCheckNumericTool(ctx),
      compare_to_brief: createCompareToBriefTool(ctx),
    },
    stopWhen: stepCountIs(20),
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
    prompt: `Audit this deck for factual accuracy, narrative coherence, and brief alignment.

BRIEF:
${input.brief}

DECK SUMMARY:
${input.deckSummary}

TITLE READ-THROUGH (reading only titles should tell the full story):
${titleReadThrough}

SLIDES (${input.slideCount} total):
${slidesSummary}

PROCESS (follow this order):
1. Call audit_deck_structure FIRST — this runs deterministic checks and catches sparse slides, layout monotony, missing notes, weak titles automatically.
2. Then use verify_claim to check every factual assertion.
3. Use check_numeric to audit numbers on each slide.
4. Use compare_to_brief to identify gaps vs the original brief.

Be adversarial — find what's wrong, not what's right. Every issue you catch saves the team from embarrassment in front of an executive.`,
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
