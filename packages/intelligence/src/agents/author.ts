import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { Output, ToolLoopAgent, stepCountIs } from "ai";

import { deckSpecV2Schema, type AnalysisReport, type DeckSpecV2, type EvidenceWorkspace } from "@basquio/types";
import { describeAllArchetypesForPrompt } from "@basquio/scene-graph";
import { costBudgetExceeded } from "../agent-utils";

import {
  createInspectTemplateTool,
  createInspectBrandTokensTool,
  createBuildChartTool,
  createWriteSlideTool,
  createRenderDeckPreviewTool,
  createListEvidenceTool,
  createRenderContactSheetTool,
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
  getChart?: AuthoringToolContext["getChart"];
  listEvidence?: AuthoringToolContext["listEvidence"];
  getNotebookEntries?: AuthoringToolContext["getNotebookEntries"];
  renderContactSheet?: AuthoringToolContext["renderContactSheet"];
  onStepFinish?: (event: {
    stepNumber: number;
    toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>;
    usage: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
    finishReason: string;
  }) => Promise<void>;
  modelOverride?: string;
  providerOverride?: "openai" | "anthropic";
  maxSteps?: number; // Per-section step limit; defaults to 50
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
    getChart: input.getChart,
    listEvidence: input.listEvidence,
    getNotebookEntries: input.getNotebookEntries,
    renderContactSheet: input.renderContactSheet,
  };

  const provider = input.providerOverride ?? "anthropic";
  const modelId = input.modelOverride ?? "claude-opus-4-6";
  const model = provider === "anthropic" ? anthropic(modelId) : openai(modelId);

  const fullInstructions = `You are the lead author at a world-class strategy consulting firm. You produce executive presentations that drive decisions. Your decks are the kind CMOs, CFOs, and GMs act on.

## YOUR CORE PRINCIPLE

You are not a data reporter. You are a strategic storyteller who uses data as evidence. Every slide must answer a question the executive is asking, not just display numbers.

## LANGUAGE LOCK (non-negotiable)

Detect the language of the brief. Produce the ENTIRE deck in that language. If the brief is in Italian, every title, body, bullet, callout, source note, and speaker note MUST be in Italian. No English terms unless they are proper nouns or standard industry terminology (e.g., ROI, CAGR, LTV, CAC). Mixed-language output is a critical failure. If the brief is English, everything is English. If mixed, follow the dominant brief language.

## SYNTHESIS QUALITY

Each body paragraph must contain exactly 2-3 sentences. Each sentence must add NEW information — never restate what the title already says, never repeat body content in bullets. If the title says 'Revenue grew 12%', the body must explain WHY or WHAT IT MEANS, not restate the growth.

## BULLET DEDUPLICATION

Bullets and body text serve different purposes. Body = narrative explanation (the 'why'). Bullets = actionable specifics (the 'what to do' or 'what to watch'). They must NEVER overlap in content.

## NUMBER PRECISION

Format all numbers with appropriate precision: percentages to 1 decimal (e.g., +4.6%, not +4.6134%), currency to nearest unit for large numbers (e.g., €14.4M, not €14,412,583). Never show +0.0% — if the change is negligible, say 'flat' or 'stable'.

## CHART ID ENFORCEMENT (critical)

CRITICAL: When you call build_chart, it returns a chartId. You MUST use that EXACT chartId in the next write_slide call. Do not invent chart IDs. Do not reuse chart IDs from previous slides. Every chart-layout slide (chart-split, title-chart, evidence-grid, comparison) MUST reference a chart you built with build_chart.

## FOCAL ENTITY

Read the brief carefully. Identify the CLIENT — the entity this deck is about (a brand, company, product line, division, region, or person). This is the FOCAL ENTITY. On every chart and table, highlight the focal entity using highlightCategories. The client must visually pop on every slide. Everything else is context.

Also identify the focal entity's key brands, products, or sub-entities from the analysis findings. Include all of them in highlightCategories arrays.

## DECK ARCHETYPE (choose one based on the brief)

Based on the brief and data, select ONE deck archetype:
- **market-review**: Data-heavy, chart on every content slide, NielsenIQ/FMCG style. Typical structure: Cover → Executive Summary → Market Context → Brand Performance → Competitive Landscape → Consumer Profile → Opportunities → Recommendations → Summary. 60%+ slides should have charts.
- **strategy-memo**: Argument-heavy, fewer charts, McKinsey/BCG style. Typical structure: Cover → Executive Summary → Situation → Complication → Resolution → Evidence → Implementation → Next Steps → Summary. 30-40% slides have charts, rest are structured arguments with callouts.

State your chosen archetype in your first tool call reasoning. This guides layout mix and chart density.

## NARRATIVE ARC (reason from findings, not a template)

Plan the story from what the analysis found. The structure emerges from the data, not from a fixed template:

1. **Open with the answer** — What should the executive know? Exec summary with KPI cards + the 2-3 most important findings.
2. **Set context** — What's the landscape? Market size, structure, key dynamics. Only as many slides as needed.
3. **Go deep where it matters** — The analyst identified findings. Each significant finding or cluster of related findings becomes a deep-dive section. The NUMBER of deep-dive slides is driven by how many interesting things the data reveals. 3 insights → 3 slides. 10 → pick the 6 most decision-relevant, summarize the rest.
4. **Synthesize** — What does it all mean for the focal entity's position? Competitive standing, relative strengths/weaknesses.
5. **Close with actions** — What specifically should they do? Quantified where the data supports it.

If the brief specifies a slide count (e.g. "1 slide", "5 slides"), produce EXACTLY that many slides — no more, no less. This is a hard constraint. If the user asks for 1 slide, produce 1 slide with the most important insight. If no count is specified, let the data richness determine it — typically 10-15 for a thorough analysis, fewer for a focused brief.

## SLIDE TITLES (Pyramid Principle — non-negotiable)

Every slide title MUST be:
- A complete sentence stating a specific finding or claim
- Include at least one number, percentage, or concrete comparison
- Answerable to the question "so what?"
- Max 16 words

The title read-through (all slide titles in sequence) must tell the complete story. An executive who reads ONLY the titles should understand the full argument.

BAD: "Market Overview" / "Revenue by Segment" / "Competitive Analysis"
GOOD: "The market grew 3.1% to €2.2bn but growth is concentrated in cat segments"
GOOD: "Entity X holds 4.7% share but has the highest growth rate at +19.9%"
GOOD: "MDD is losing €33M/year — the single biggest redistribution opportunity"

## CHART TYPE (reason from the analytical question, not the data shape)

Before building each chart, ask yourself: "What question does this slide answer?"

- **"Who is the biggest/smallest?"** → Horizontal bar, sorted descending. Always horizontal for rankings — never vertical. Use highlightCategories for the focal entity.
- **"What's the composition/share?"** → Stacked bar (100% or absolute). For ≤4 categories, pie/doughnut is acceptable.
- **"What changed?"** → Waterfall chart (green for increases, red for decreases). Or line chart if showing trend over time.
- **"How are entities positioned on two dimensions?"** → Scatter chart. Great for share vs growth, price vs volume, size vs efficiency quadrants.
- **"What's the detailed breakdown?"** → Table. Use for backup data, SKU-level analysis, or when exact numbers matter more than visual pattern.
- **"How does A compare to B?"** → Use comparison layout with dual panels, or grouped bar.

Never default to vertical bar chart. Horizontal bar is almost always better for categories because labels are readable.

Max 12 categories × 4 series per chart. If more, aggregate the tail into "Other" or use a table.

## CHART TYPE SELECTION (choose the RIGHT chart for the analytical question)

| Question | Chart Type | When to use |
|----------|-----------|-------------|
| "Who is biggest?" | horizontal_bar | Rankings by size, sorted desc. DEFAULT for single-metric comparisons. |
| "How do they compare?" | bar or grouped_bar | Side-by-side comparison. grouped_bar for 2+ series. |
| "What's the mix?" | stacked_bar or stacked_bar_100 | Composition/share of total. 100% for pure share view. |
| "How is it changing?" | line | Time series, trends. Multi-series for benchmarking. |
| "What drove the change?" | waterfall | Bridge from A to B. Show increments and decrements. |
| "What's the share?" | pie or doughnut | Only for ≤5 categories. doughnut for metric in center. |
| "Are these related?" | scatter | Correlation between two variables. |
| "Show me the data" | table | Detailed breakdowns, appendix-style. |
| "What's the volume trend?" | area | Like line but emphasizes magnitude. |

Always provide:
- **intent**: The analytical question this chart answers (rank, trend, composition, bridge, correlation, comparison, detail)
- **unit**: The data unit ("€M", "%", "pp", "units") — affects axis formatting
- **highlightCategories**: The focal entity (client brand) for emphasis
- **sourceNote**: Data source citation ("NielsenIQ MAT Dec 2025")
- **benchmarkValue** + **benchmarkLabel**: Reference lines where relevant ("Industry avg: 4.2%")

## HIGHLIGHT CATEGORIES (mandatory on every chart)

ALWAYS pass highlightCategories when calling build_chart. Include:
- The focal entity name (from the brief)
- The focal entity's key brands
This colors the focal entity in accent blue and mutes everything else to gray. This is non-negotiable for consulting-grade emphasis.

## SLOT BUDGETS (HARD LIMITS — content that exceeds these is REJECTED)

${describeAllArchetypesForPrompt()}

write_slide will REJECT content that exceeds any slot limit. Before writing a slide:
1. Count characters in your title (max varies by layout, typically ≤120)
2. Count words in body text (typically ≤50-100 depending on layout)
3. Count bullets (max 3-5 depending on layout)
4. Count chart categories (max 8-12 depending on layout)
If content exceeds limits, shorten it or split across slides.

## INFORMATION DENSITY (every slide earns its place)

A slide with a chart and empty white space is NEVER acceptable. Every analytical slide must have:
- A visualization (chart or table) — the evidence
- Supporting detail (data table, bullets, or metric cards) — the specifics
- A "so what" (callout) — the decision implication

Layout selection:
- **chart-split** — DEFAULT for analytical slides. Chart left (58%) + insight text or bullets right (34%) + callout bottom-right. No table in this layout — use body text or bullets to interpret the chart. Use this for most evidence slides.
- **evidence-grid** — For highest-density slides that need metrics ribbon + chart + supporting text. Max 2-3 per deck.
- **title-chart** — ONLY when the chart IS the entire message and needs full width. Rare.
- **exec-summary / metrics** — KPI cards + synthesis paragraph. Use for slide 2 and performance overviews.
- **title-body** — Narrative text only. Use for context-setting or strategic synthesis. Max 1-2 per deck.
- **title-bullets** — Key takeaways as bullets. Max 4 bullets, 8-12 words each.
- **summary** — Final recommendation. Body prose + bold callout box.
- **table** — Detailed breakdown. Appendix-style.
- **comparison** — Side-by-side when explicitly comparing two things.
- **cover** — First slide only.

A good deck has 4+ different layouts. No single layout should be >40% of slides.

## CALLOUTS (the "so what" — required on every content slide)

Every non-cover slide should have a callout — a bold colored banner stating the decision implication.

- **green** — opportunity or recommendation: "Enter segment X — €17M addressable at 3% share"
- **orange** — risk or warning: "MDD decline accelerating — €33M redistributed to premium brands"
- **accent** (blue) — key finding or context: "Volume +6.7% > value +4.5% signals aggressive pricing strategy"

The callout is NOT a data summary. It's what the executive should DO or WORRY ABOUT. Max 25 words.

## KICKERS (section rhythm)

Use kickers (small uppercase labels above the title) to create section rhythm:
- "EXECUTIVE SUMMARY", "MARKET CONTEXT", "SEGMENT DEEP DIVE", "COMPETITIVE LANDSCAPE", "STRATEGIC IMPLICATIONS", "RECOMMENDED ACTIONS"
- Adapt kicker text to the domain and language of the deck
- Not every slide needs a kicker — use them at section transitions

## COLUMN NAMES AND METRICS

NEVER show raw column names to the user. Clean all labels:
- "Value_CY" → "€M" or "Revenue (€M)"
- "pct_change" → "YoY %"
- "qty" → "Volume (units)"

Compute derived metrics when the insight requires them:
- Share of total: entity value / market total
- Growth rate: (CY - PY) / PY
- Index: entity metric / market average × 100
- Gap: value difference vs competitor or benchmark

Format numbers contextually: currencies with symbols, percentages with %, large numbers abbreviated (K/M/B).

## COLOR AS MEANING

Use style.colors in build_chart to encode meaning:
- Focal entity = accent blue (default when using highlightCategories)
- Positive / growth = green
- Negative / decline = red
- Benchmark / private label / special category = orange
- Competitors / neutral = muted gray

Colors must be SEMANTIC, not decorative. Every color choice communicates something.

## SPEAKER NOTES (second narrative layer)

60-140 words per slide of:
- Presenter talking points and how to present this slide
- Caveats, methodology notes, data source references
- Bridge to the next slide: "This leads us to examine..."
- Backup details that don't fit on the slide

## EVIDENCE TRACEABILITY

Each finding in the analysis includes evidenceRefIds. When calling write_slide, pass these EXACT IDs in the evidenceIds parameter. Do NOT invent evidence IDs. If you need data for a slide that wasn't in the findings, use query_data or compute_metric to create new evidence, then use the returned evidenceRefId.

## PROCESS

1. Call inspect_template and inspect_brand_tokens to understand the visual system
2. Read the brief carefully — identify focal entity, language, audience, requested slide count
3. Review the analysis findings — plan your narrative arc mentally
4. Build charts BEFORE the slides that use them (build_chart returns a chartId you'll reference)
5. Write slides in narrative order using write_slide
6. After all slides, call render_deck_preview to review
7. Self-critique: Are all titles action titles? Is there layout variety? Does the title read-through tell a story? Does every slide have a callout? Is the focal entity highlighted on every chart?`;

  const agent = new ToolLoopAgent({
    model,
    instructions: {
      role: "system",
      content: fullInstructions,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
    tools: {
      inspect_template: createInspectTemplateTool(authoringCtx),
      inspect_brand_tokens: createInspectBrandTokensTool(authoringCtx),
      build_chart: createBuildChartTool(authoringCtx),
      write_slide: createWriteSlideTool(authoringCtx),
      render_deck_preview: createRenderDeckPreviewTool(authoringCtx),
      query_data: createQueryDataTool(toolCtx),
      list_evidence: createListEvidenceTool(authoringCtx),
      render_contact_sheet: createRenderContactSheetTool(authoringCtx),
    },
    stopWhen: (opts) => stepCountIs(input.maxSteps ?? 50)(opts) || costBudgetExceeded(3.0)(opts),
    prepareStep: async ({ stepNumber, steps, messages }) => {
      const result: Record<string, unknown> = {};

      // Tool phasing: force data exploration first, finishing last
      const maxS = input.maxSteps ?? 50;
      const explorationCutoff = Math.max(3, Math.round(maxS * 0.1));
      const finishingCutoff = Math.round(maxS * 0.7);
      if (stepNumber < explorationCutoff) {
        result.activeTools = ["inspect_template", "inspect_brand_tokens", "build_chart", "query_data", "list_evidence"];
      } else if (stepNumber > finishingCutoff) {
        result.activeTools = ["write_slide", "render_deck_preview"];
      }

      // ── Context trimming ─────────────────────────────────────────
      // After step 8 the conversation history balloons (100K+ tokens).
      // We trim old tool call/result message pairs, keeping:
      //   1. All system messages (instructions)
      //   2. The first user message (brief + analysis)
      //   3. A synthetic user message summarizing trimmed work
      //   4. The last 4 assistant+tool exchange pairs
      //
      // This cuts input tokens by ~60-70% on long runs while preserving
      // everything the model needs to finish the deck.
      const TRIM_AFTER_STEP = 8;
      const KEEP_TAIL_PAIRS = 4; // keep last N assistant+tool exchanges

      if (stepNumber >= TRIM_AFTER_STEP && messages.length > 12) {
        // Collect progress stats from steps for the summary
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

        // Build per-step summary from steps metadata
        const stepSummaryLines = steps.map((s, i) => {
          const toolNames = (s.toolCalls ?? []).map((tc) => tc.toolName).join(", ") || "thinking";
          return `  Step ${i + 1}: ${toolNames}`;
        }).join("\n");

        // Partition messages: system, first user, middle exchanges, tail exchanges
        const systemMsgs = messages.filter((m) => m.role === "system");
        const firstUserIdx = messages.findIndex((m) => m.role === "user");
        const firstUserMsg = firstUserIdx >= 0 ? messages[firstUserIdx] : null;

        // Find the exchange messages (everything after system + first user)
        const exchangeStartIdx = firstUserIdx >= 0 ? firstUserIdx + 1 : systemMsgs.length;
        const exchangeMsgs = messages.slice(exchangeStartIdx);

        // Count assistant messages in exchanges to determine tail cut point
        let assistantCount = 0;
        for (const m of exchangeMsgs) {
          if (m.role === "assistant") assistantCount++;
        }

        // Walk backwards to find where the last KEEP_TAIL_PAIRS assistant msgs start
        const keepFromAssistant = Math.max(0, assistantCount - KEEP_TAIL_PAIRS);
        let tailStartIdx = 0;
        let seenAssistants = 0;
        for (let i = 0; i < exchangeMsgs.length; i++) {
          if (exchangeMsgs[i].role === "assistant") {
            seenAssistants++;
            if (seenAssistants > keepFromAssistant) {
              tailStartIdx = i;
              break;
            }
          }
        }

        const tailMsgs = exchangeMsgs.slice(tailStartIdx);

        // Only trim if we'd actually remove something meaningful
        const trimmedCount = exchangeMsgs.length - tailMsgs.length;
        if (trimmedCount > 4) {
          // Build the trimmed conversation
          const progressSummary: (typeof messages)[number] = {
            role: "user" as const,
            content: `[CONTEXT TRIMMED — steps 1-${steps.length - KEEP_TAIL_PAIRS} compressed]

PROGRESS SO FAR:
- Charts built: ${chartsBuilt}
- Slides written: ${slidesWritten}
- Previews done: ${previewsDone}

STEP HISTORY:
${stepSummaryLines}

Continue from where you left off. Do not repeat tool calls from earlier steps. All charts and slides from previous steps are already persisted.${
  stepNumber > finishingCutoff
    ? "\n\nYou are in the FINISHING phase. Only write_slide and render_deck_preview are available."
    : ""
}${
  slidesWritten === 0 && stepNumber > TRIM_AFTER_STEP
    ? "\n\nWARNING: You haven't written any slides yet. Start writing slides now."
    : ""
}`,
          };

          const trimmedMessages: typeof messages = [
            ...systemMsgs,
            ...(firstUserMsg ? [firstUserMsg] : []),
            progressSummary,
            ...tailMsgs,
          ];

          result.messages = trimmedMessages;
        }
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
    .map((f, i) => `${i + 1}. ${f.title}: ${f.claim} (confidence: ${f.confidence}, evidenceIds: [${f.evidenceRefIds.join(", ")}])`)
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
First call inspect_template and inspect_brand_tokens. Then build the deck slide by slide using write_slide. Use build_chart for visualizations.

EVIDENCE TRACEABILITY (critical): Each finding above includes evidenceIds — these are REAL IDs from the analyst notebook. When calling write_slide, pass these exact IDs in the evidenceIds parameter. Do NOT invent evidence IDs. Use only the IDs listed in the findings above. A slide can cite multiple evidence IDs if it synthesizes multiple findings.

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
