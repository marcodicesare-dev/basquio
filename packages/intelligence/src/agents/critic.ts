import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { Output, ToolLoopAgent, stepCountIs } from "ai";

import { critiqueReportSchema, type CritiqueReport, type EvidenceWorkspace } from "@basquio/types";

import {
  createVerifyClaimTool,
  createCheckNumericTool,
  createCompareToBriefTool,
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
    instructions: `You are a senior QA reviewer at a strategy consulting firm. Your job is to find problems in decks before they reach executives. You are adversarial — your goal is to find what's wrong, not what's right.

Your review checklist:
1. FACTUAL ACCURACY: Use verify_claim to check every factual assertion. Numbers must match the source data.
2. NUMERIC INTEGRITY: Use check_numeric on every slide to catch rounding errors, wrong percentages, misattributed values.
3. BRIEF ALIGNMENT: Use compare_to_brief to check that the deck actually addresses what was asked.
4. NARRATIVE COHERENCE: Does the argument flow logically? Are transitions between slides clear?
5. EVIDENCE GROUNDING: Does every claim cite evidence? Are there unsupported assertions?
6. COMPLETENESS: Are there obvious angles the analysis missed?

Be specific. "Slide 3 claims revenue grew 23% but evidence shows 21.8%" is useful. "Some numbers might be wrong" is not.

Rate severity:
- critical: Factually wrong, will mislead the executive
- major: Missing important information, or narrative doesn't flow
- minor: Wording could be improved, or a minor discrepancy that doesn't affect the conclusion`,
    tools: {
      verify_claim: createVerifyClaimTool(ctx),
      check_numeric: createCheckNumericTool(ctx),
      compare_to_brief: createCompareToBriefTool(ctx),
    },
    stopWhen: stepCountIs(20),
    output: Output.object({ schema: critiqueReportSchema }),
    onStepFinish: input.onStepFinish,
  });

  return agent;
}

export async function runCriticAgent(input: CriticAgentInput): Promise<CritiqueReport> {
  const agent = createCriticAgent(input);

  const slides = await input.getSlides();
  const slidesSummary = slides
    .map((s) => `Slide ${s.position}: "${s.title}" — ${s.body?.slice(0, 100) ?? "(no body)"} [evidence: ${s.evidenceIds.join(", ") || "none"}]`)
    .join("\n");

  const result = await agent.generate({
    prompt: `Audit this deck for factual accuracy, narrative coherence, and brief alignment.

BRIEF:
${input.brief}

DECK SUMMARY:
${input.deckSummary}

SLIDES (${input.slideCount} total):
${slidesSummary}

Use verify_claim to check every factual assertion. Use check_numeric to audit numbers on each slide. Use compare_to_brief to identify gaps.

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
