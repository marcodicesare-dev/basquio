import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { Output, ToolLoopAgent, stepCountIs } from "ai";

import { deckSpecV2Schema, type AnalysisReport, type DeckSpecV2, type EvidenceWorkspace } from "@basquio/types";
import { costBudgetExceeded } from "../agent-utils";

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
  getSlides?: AuthoringToolContext["getSlides"];
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
    getSlides: input.getSlides,
  };

  const provider = input.providerOverride ?? "anthropic";
  const modelId = input.modelOverride ?? "claude-opus-4-6";
  const model = provider === "anthropic" ? anthropic(modelId) : openai(modelId);

  const fullInstructions = `You are an executive presentation author at a top-tier strategy consulting firm (McKinsey/BCG/NielsenIQ caliber). You create decks that make executives act.

## NARRATIVE ARCHITECTURE (Pyramid Principle)

Your deck tells ONE story. The title read-through alone (all slide titles in sequence) must form a coherent argument. Structure the narrative as:

1. COVER — one sentence thesis that frames the entire deck
2. EXEC SUMMARY — 3 key takeaways maximum, use "metrics" layout
3. CONTEXT — why this matters now (market size, macro trend)
4. EVIDENCE (3-6 slides) — each proves one sub-argument of the thesis
5. IMPLICATION — what the evidence means for the audience
6. RECOMMENDATION — specific actions with expected outcomes
7. SUMMARY — closing synthesis with bold recommendation callout

## ACTION TITLES (mandatory)

Every slide title MUST be a complete sentence stating the takeaway. The audience should understand your argument by reading only the titles.

GOOD: "Cat Wet is the largest untapped opportunity at €780.9m with <1% Affinity share"
BAD: "Cat Wet Market Overview"
GOOD: "ULTIMA concentration at 94.7% creates existential single-brand risk"
BAD: "Brand Portfolio Analysis"

Title rules: max 16 words, must contain a number or specific claim, must be a full sentence.

## LAYOUT SELECTION (use variety — NOT all evidence-grid)

- cover: opening slide ONLY. Title + subtitle.
- exec-summary: exactly 1 slide. Use "metrics" layout with 3-4 KPI cards + one paragraph.
- title-chart: when the chart IS the insight. Full-width chart dominates. Use for your strongest data point.
- chart-split: chart (left 58%) + interpretation bullets (right 42%). Best for "here's the data, here's what it means."
- metrics: 3-4 KPI cards for scorecard/dashboard slides. Use for exec summary or performance overview.
- title-body: narrative text only. Use for context-setting, methodology, or strategic synthesis.
- title-bullets: key takeaways as a bullet list. Max 4 bullets.
- evidence-grid: ONLY for dense slides that genuinely need metrics + chart + text. Max 2-3 per deck.
- table: for detailed breakdowns when exact numbers matter. Appendix-style.
- summary: for final recommendation. Body text + bold callout box.

A good 15-slide deck typically has: 1 cover, 1 metrics, 3-4 title-chart, 3-4 chart-split, 1-2 title-body, 1 title-bullets, 1 summary. NOT 12 evidence-grids.

## CONTENT BUDGETS (enforced)

- Title: max 16 words
- Body text: max 55 words on story slides, 80 words on appendix slides
- Bullets: max 4 bullets, 8-12 words each
- One chart per slide maximum
- If you need more than one claim per slide, split it into two slides

## CHART DESIGN (story-first)

When you call build_chart, think about the ANALYTICAL STORY, not just the data shape:
- RANK (who's biggest?) → sorted horizontal bar, descending
- TREND (what changed?) → line chart, annotate inflection points
- COMPOSITION (what's the mix?) → 100% stacked bar or pie (max 5 slices)
- BRIDGE (what drove the change?) → waterfall
- CORRELATION (are these related?) → scatter
- COMPARISON (A vs B) → grouped bar or slope chart
- DETAIL (exact numbers matter) → table

Chart data: max 12 categories × 4 series. Beyond that, aggregate or use a table.

## TABLE + CHART COMBO (chart-split layout)

On chart-split slides, ALWAYS create BOTH a chart AND include the same data as a table. The renderer automatically places the chart on the left and builds a table from the same chart data on the right. The chart shows the pattern, the table shows the exact numbers. This is standard consulting practice — never leave a chart without supporting numbers.

## SPEAKER NOTES (second narrative layer)

Speaker notes are NOT slide body copy. They are 60-140 words of:
- Presenter talking points and transitions
- Caveats and methodology details
- Backup numbers that don't fit on the slide
- Bridge sentence to the next slide: "This sets up the question of..."

## PROCESS

1. Call inspect_template and inspect_brand_tokens first
2. Plan narrative arc mentally before writing any slides
3. Build charts BEFORE the slides that use them
4. Write slides in narrative order using write_slide
5. Call render_deck_preview to review the full deck
6. Self-critique: are titles action titles? Is there layout variety? Is the story coherent?`;

  const agent = new ToolLoopAgent({
    model,
    instructions: fullInstructions,
    tools: {
      inspect_template: createInspectTemplateTool(authoringCtx),
      inspect_brand_tokens: createInspectBrandTokensTool(authoringCtx),
      build_chart: createBuildChartTool(authoringCtx),
      write_slide: createWriteSlideTool(authoringCtx),
      render_deck_preview: createRenderDeckPreviewTool(authoringCtx),
      query_data: createQueryDataTool(toolCtx),
    },
    stopWhen: [stepCountIs(35), costBudgetExceeded(1.00)],
    prepareStep: async ({ stepNumber, steps }) => {
      const result: Record<string, unknown> = {};

      // Tool phasing: force data exploration first, finishing last
      if (stepNumber < 5) {
        result.activeTools = ["inspect_template", "inspect_brand_tokens", "build_chart", "query_data"];
      } else if (stepNumber > 25) {
        result.activeTools = ["write_slide", "render_deck_preview"];
      }

      // Context trimming: after step 15, inject a compressed progress summary
      // into the system message so the model doesn't lose track of what it built
      if (stepNumber > 15 && steps.length > 10) {
        const chartsBuilt = steps
          .flatMap((s) => s.toolCalls ?? [])
          .filter((tc) => tc.toolName === "build_chart")
          .length;
        const slidesWritten = steps
          .flatMap((s) => s.toolCalls ?? [])
          .filter((tc) => tc.toolName === "write_slide")
          .length;
        const previewsDone = steps
          .flatMap((s) => s.toolCalls ?? [])
          .filter((tc) => tc.toolName === "render_deck_preview")
          .length;

        // Estimate tokens used
        const totalTokens = steps.reduce(
          (acc, s) => acc + (s.usage?.inputTokens ?? 0) + (s.usage?.outputTokens ?? 0), 0,
        );

        result.system = `${fullInstructions}

PROGRESS UPDATE (step ${stepNumber}/${35}):
- Charts built: ${chartsBuilt}
- Slides written: ${slidesWritten}
- Previews checked: ${previewsDone}
- Tokens used: ~${Math.round(totalTokens / 1000)}K
- Budget remaining: ~${Math.max(0, 100 - Math.round(totalTokens / 10000))}%
${stepNumber > 25 ? "\nYou are in the FINISHING phase. Only write_slide and render_deck_preview are available. Complete any remaining slides and call render_deck_preview to verify quality." : ""}
${slidesWritten === 0 && stepNumber > 10 ? "\nWARNING: You haven't written any slides yet. Start writing slides now using write_slide." : ""}`;
      }

      return result;
    },
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
