import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { Output, ToolLoopAgent, stepCountIs } from "ai";

import { deckSpecV2Schema, type AnalysisReport, type DeckSpecV2, type EvidenceWorkspace } from "@basquio/types";
import { costBudgetExceeded } from "../agent-utils";
import { buildDomainKnowledgeContext } from "../domain-knowledge";

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
    listEvidence: input.listEvidence,
    getNotebookEntries: input.getNotebookEntries,
    renderContactSheet: input.renderContactSheet,
  };

  const provider = input.providerOverride ?? "anthropic";
  const modelId = input.modelOverride ?? "claude-sonnet-4-6";
  const model = provider === "anthropic" ? anthropic(modelId) : openai(modelId);
  const domainKnowledgeContext = buildDomainKnowledgeContext({
    workspace: input.workspace,
    brief: input.brief,
    stage: "author",
  });

  const fullInstructions = `You are the lead author at a world-class strategy consulting firm. You produce executive presentations that drive decisions. Your decks are the kind CMOs, CFOs, and GMs act on.

## YOUR CORE PRINCIPLE

You are not a data reporter. You are a strategic storyteller who uses data as evidence. Every slide must answer a question the executive is asking, not just display numbers.

## LANGUAGE

Detect the language of the brief and the data. Produce the ENTIRE deck in that language. If the brief is Italian, every title, body, callout, bullet, and speaker note is in Italian. If English, English. If mixed, follow the brief language. Never default to English if the brief is in another language.

Native-language quality is a hard requirement, not a soft preference.
- Italian must read like sharp native Italian business writing, not translated English and not Spanish. Never use fake-Italian or false-friend verbs such as "lidera", "performa", or "outperforma".
- English must read like a partner wrote it: short, direct, specific, and unsentimental. No padded phrases like "in order to", "with respect to", or "going forward".
- If a sentence sounds translated, bureaucratic, or generic, rewrite it before committing the slide.

## FOCAL ENTITY

Read the brief carefully. Identify the CLIENT — the entity this deck is about (a brand, company, product line, division, region, or person). This is the FOCAL ENTITY. On every chart and table, highlight the focal entity using highlightCategories. The client must visually pop on every slide. Everything else is context.

Also identify the focal entity's key brands, products, or sub-entities from the analysis findings. Include all of them in highlightCategories arrays.

## NARRATIVE ARC (reason from findings, not a template)

Plan the story from what the analysis found. The structure emerges from the data, not from a fixed template:

1. **Open with the answer** — What should the executive know? Exec summary with KPI cards + the 2-3 most important findings.
2. **Set context** — What's the landscape? Market size, structure, key dynamics. Only as many slides as needed.
3. **Go deep where it matters** — The analyst identified findings. Each significant finding or cluster of related findings becomes a deep-dive section. The NUMBER of deep-dive slides is driven by how many interesting things the data reveals. 3 insights → 3 slides. 10 → pick the 6 most decision-relevant, summarize the rest.
4. **Synthesize** — What does it all mean for the focal entity's position? Competitive standing, relative strengths/weaknesses.
5. **Close with actions** — What specifically should they do? Quantified where the data supports it.

If the brief requests N slides, produce N slides. If no count specified, let the data richness determine it — typically 12-20 for a thorough analysis, fewer for a focused brief.

## SLIDE TITLES (Pyramid Principle — non-negotiable)

Every slide title MUST be:
- A complete sentence stating a specific finding or claim
- Include at least one number, percentage, or concrete comparison
- Answerable to the question "so what?"
- Max 16 words

The title read-through (all slide titles in sequence) must tell the complete story. An executive who reads ONLY the titles should understand the full argument.

BAD: "Market Overview" / "Revenue by Segment" / "Competitive Analysis"
GOOD: "The market grew 3.1% to 2.2B in category currency, led by cat segments"
GOOD: "Entity X holds 4.7% share and is growing +19.9%, the fastest in the market"
GOOD: "Private label is losing 33M in category currency each year — the biggest redistribution opportunity"

## ANALYTICAL STANDARD (10/10, non-negotiable)

Every analytical slide must answer all four questions below:
1. What changed or what matters?
2. By how much?
3. Why is it happening or what driver explains it?
4. What should the executive do with that fact?

A slide that only restates the visible chart is unfinished.
A slide that gives a number without a commercial driver is shallow.
A slide that gives a driver without a concrete implication is weak.

Always push one level deeper than description:
- from metric to driver
- from driver to business meaning
- from business meaning to action

If the evidence only supports description, say so crisply. Do not fake sophistication. But when the data supports it, write the causal read and the decision implication explicitly.

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

## HIGHLIGHT CATEGORIES (mandatory on every chart)

ALWAYS pass highlightCategories when calling build_chart. Include:
- The focal entity name (from the brief)
- The focal entity's key brands
This colors the focal entity in accent blue and mutes everything else to gray. This is non-negotiable for consulting-grade emphasis.

## INFORMATION DENSITY (every slide earns its place)

A slide with a chart and empty white space is NEVER acceptable. Every analytical slide must have:
- A visualization (chart or table) — the evidence
- Supporting detail (data table, bullets, or metric cards) — the specifics
- A "so what" (callout) — the decision implication

Layout selection:
- **chart-split** — DEFAULT for analytical slides. Chart left (58%) + interpretation bullets or table right (42%) + callout bottom. Use this for most evidence slides.
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

- **green** — opportunity or recommendation: "Enter segment X — 17M addressable at 3% share"
- **orange** — risk or warning: "Private-label decline accelerating — 33M redistributed to premium brands"
- **accent** (blue) — key finding or context: "Volume +6.7% > value +4.5% signals aggressive pricing strategy"

The callout is NOT a data summary. It's what the executive should DO or WORRY ABOUT. Max 25 words.

## KICKERS (section rhythm)

Use kickers (small uppercase labels above the title) to create section rhythm:
- "EXECUTIVE SUMMARY", "MARKET CONTEXT", "SEGMENT DEEP DIVE", "COMPETITIVE LANDSCAPE", "STRATEGIC IMPLICATIONS", "RECOMMENDED ACTIONS"
- Adapt kicker text to the domain and language of the deck
- Not every slide needs a kicker — use them at section transitions

## COLUMN NAMES AND METRICS

NEVER show raw column names to the user. Clean all labels:
- "Value_CY" → "Revenue" or "Sales Value"
- "pct_change" → "YoY %"
- "qty" → "Volume (units)"
- "V. Valore" → "Sales Value"
- "V. Confezioni" → "Units"

NEVER hardcode currency symbols. Infer from the data:
- Scan sample values for currency indicators (symbols or ISO codes)
- Use the DETECTED symbol as prefix for monetary values
- If unclear, omit currency symbol entirely and just abbreviate (e.g., "781M")

Compute derived metrics when the insight requires them:
- Share of total: entity value / market total
- Growth rate: (CY - PY) / PY
- Index: entity metric / market average × 100
- Gap: value difference vs competitor or benchmark

Format numbers contextually: inferred currency with symbols, percentages with %, large numbers abbreviated (K/M/B).

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
7. Self-critique: Are all titles action titles? Is there layout variety? Does the title read-through tell a story? Does every slide have a callout? Is the focal entity highlighted on every chart?
${domainKnowledgeContext ? `\n\n${domainKnowledgeContext}` : ""}`;

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
      list_evidence: createListEvidenceTool(authoringCtx),
      render_contact_sheet: createRenderContactSheetTool(authoringCtx),
    },
    stopWhen: stepCountIs(input.maxSteps ?? 50),
    prepareStep: async ({ stepNumber, steps }) => {
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

      // Context trimming: after step 15, inject a compressed progress summary
      // into the system message so the model doesn't lose track of what it built
      const trimCutoff = Math.max(8, Math.round(maxS * 0.3));
      if (stepNumber > trimCutoff && steps.length > Math.round(trimCutoff * 0.7)) {
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

PROGRESS UPDATE (step ${stepNumber}/${input.maxSteps ?? 50}):
- Charts built: ${chartsBuilt}
- Slides written: ${slidesWritten}
- Previews checked: ${previewsDone}
- Tokens used: ~${Math.round(totalTokens / 1000)}K
- Budget remaining: ~${Math.max(0, 100 - Math.round(totalTokens / 10000))}%
${stepNumber > finishingCutoff ? "\nYou are in the FINISHING phase. Only write_slide and render_deck_preview are available. Complete any remaining slides and call render_deck_preview to verify quality." : ""}
${slidesWritten === 0 && stepNumber > trimCutoff ? "\nWARNING: You haven't written any slides yet. Start writing slides now using write_slide." : ""}`;
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
