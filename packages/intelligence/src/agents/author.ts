import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { Output, ToolLoopAgent, stepCountIs } from "ai";

import { deckSpecV2Schema, type AnalysisReport, type DeckSpecV2, type EvidenceWorkspace } from "@basquio/types";

import {
  createInspectTemplateTool,
  createInspectBrandTokensTool,
  createBuildChartTool,
  createWriteSlideTool,
  createRenderDeckPreviewTool,
  createQueryDataTool,
  type AuthoringToolContext,
  type ToolContext,
} from "../tools";

// ─── AUTHOR AGENT ─────────────────────────────────────────────────
// Model: claude-opus-4-6 (superior prose, extended thinking, 1M context)
// Purpose: Build the deck slide by slide, using analysis as evidence
// Output: DeckSpecV2 (structured)

export type AuthorAgentInput = {
  workspace: EvidenceWorkspace;
  runId: string;
  analysis: AnalysisReport;
  brief: string;
  critiqueContext?: string; // Provided during revision loop
  persistNotebookEntry: ToolContext["persistNotebookEntry"];
  loadRows?: ToolContext["loadRows"];
  persistSlide: AuthoringToolContext["persistSlide"];
  persistChart: AuthoringToolContext["persistChart"];
  getTemplateProfile: AuthoringToolContext["getTemplateProfile"];
  onStepFinish?: (event: {
    stepNumber: number;
    toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>;
    usage: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
    finishReason: string;
  }) => Promise<void>;
  modelOverride?: string;
  providerOverride?: "openai" | "anthropic";
};

export function createAuthorAgent(input: AuthorAgentInput) {
  const toolCtx: ToolContext = {
    workspace: input.workspace,
    runId: input.runId,
    persistNotebookEntry: input.persistNotebookEntry,
    loadRows: input.loadRows,
  };

  const authoringCtx: AuthoringToolContext = {
    workspace: input.workspace,
    runId: input.runId,
    persistNotebookEntry: input.persistNotebookEntry,
    persistSlide: input.persistSlide,
    persistChart: input.persistChart,
    getTemplateProfile: input.getTemplateProfile,
  };

  const provider = input.providerOverride ?? "anthropic";
  const modelId = input.modelOverride ?? "claude-opus-4-6";
  const model = provider === "anthropic" ? anthropic(modelId) : openai(modelId);

  const agent = new ToolLoopAgent({
    model,
    instructions: `You are an executive presentation author at a top-tier strategy consulting firm. You create compelling, data-driven decks that drive executive decisions.

Your approach:
1. First, call inspect_template to understand available layouts and slide dimensions.
2. Call inspect_brand_tokens to get the brand guidelines (colors, fonts, spacing).
3. Plan your narrative arc — what story does this data tell? What decisions should it drive?
4. Build the deck slide by slide using write_slide:
   - Cover slide with a compelling title and thesis
   - Executive summary with key findings
   - Evidence slides with charts and data-backed claims
   - Implications and recommendations
5. Use build_chart for every data visualization — don't describe data, show it.
6. Use query_data to validate any claim you're about to make — verify before you assert.
7. After building all slides, call render_deck_preview to review the full deck.
8. Revise any slides that don't meet executive quality.

Writing rules:
- Every claim must cite an evidence ref (evidenceIds).
- Write executive prose, not placeholder text. "Revenue grew 23% YoY driven by North region expansion" not "Revenue metric".
- Headlines should be assertions, not descriptions. "North region drives 68% of growth" not "Regional analysis".
- Speaker notes should contain the talking points an executive would use to present this slide.
- Transitions should connect the argument from one slide to the next.
- Keep slide count proportional to findings — don't pad with filler slides.`,
    tools: {
      inspect_template: createInspectTemplateTool(authoringCtx),
      inspect_brand_tokens: createInspectBrandTokensTool(authoringCtx),
      build_chart: createBuildChartTool(authoringCtx),
      write_slide: createWriteSlideTool(authoringCtx),
      render_deck_preview: createRenderDeckPreviewTool(authoringCtx),
      query_data: createQueryDataTool(toolCtx),
    },
    stopWhen: stepCountIs(50),
    onStepFinish: input.onStepFinish,
  });

  return agent;
}

export async function runAuthorAgent(input: AuthorAgentInput): Promise<DeckSpecV2> {
  const agent = createAuthorAgent(input);

  const findingsSummary = input.analysis.topFindings
    .map((f, i) => `${i + 1}. ${f.title}: ${f.claim} (confidence: ${f.confidence})`)
    .join("\n");

  const critiqueSection = input.critiqueContext
    ? `\n\nIMPORTANT: A reviewer found these issues with the previous version of this deck. Fix them:\n${input.critiqueContext}\n`
    : "";

  const result = await agent.generate({
    prompt: `Create a compelling executive deck based on this analysis.

BRIEF:
${input.brief}

ANALYSIS SUMMARY:
${input.analysis.summary}

KEY FINDINGS:
${findingsSummary}

DOMAIN: ${input.analysis.domain}
METRICS COMPUTED: ${input.analysis.metricsComputed}
FILES ANALYZED: ${input.analysis.filesAnalyzed}
${critiqueSection}
First call inspect_template and inspect_brand_tokens. Then build the deck slide by slide using write_slide. Use build_chart for visualizations. Ground every claim in evidence.

After building all slides, call render_deck_preview to review the full deck. Revise any slides that don't meet executive quality.`,
  });

  // The deck spec is assembled from the persisted slides and charts
  // The agent's structured output is not used here — the slides were persisted via write_slide
  // Return a placeholder that the orchestration layer will replace with the actual persisted state
  return {
    runId: input.runId,
    slides: [],
    charts: [],
    summary: result.text ?? "",
    slideCount: 0,
  };
}
