/**
 * Planner prompt: system instructions and few-shot examples for the
 * Haiku call in Step 2 of the graph-first planner.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §5.2.
 * The prompt is split out so it can be iterated without touching the
 * control flow in planner.ts. Tests treat the prompt as a black box;
 * what matters is that Haiku returns JSON matching haikuPlanOutputSchema.
 *
 * Five FMCG few-shot examples cover the query intents we expect to see
 * in Italian mid-market CPG briefs: category review, competitor scan,
 * JBP prep, regulatory scan, ingredient innovation. More examples can
 * land here without changing any other file.
 *
 * Design notes (Anthropic prompting best practices for Claude 4.x+):
 * - XML tags separate instructions, examples, input, output. Avoids
 *   bleed between sections.
 * - Few-shots wrapped in <example> tags.
 * - The prompt explicitly says "return ONLY JSON, no prose" because the
 *   Haiku tier is prone to chatty wrappers at medium effort.
 * - No "CRITICAL: You MUST" phrasing. Claude 4.x responds to specificity,
 *   not force.
 */

import type {
  PlannerInput,
  SourceCatalogEntry,
  ResearchQueryIntent,
} from "./types";

/**
 * Single system prompt for the planner. The user message is rendered
 * per-call by `buildPlannerUserMessage` below.
 */
export const PLANNER_SYSTEM_PROMPT = `You are the research planner for Basquio, a CPG market-intelligence workspace.

Your job: given a brief, the keywords already covered by the workspace knowledge graph, and the list of Italian and UK FMCG sources available in the catalog, produce a JSON plan that specifies ONLY the new queries needed to fill gaps. If the graph already covers the brief, return an empty queries array.

Return STRICT JSON matching the schema:

{
  "queries": [
    {
      "id": "q1",
      "text": "search query text in Italian or English",
      "intent": "category_landscape | competitor_launch | retailer_activity | consumer_trend | regulatory | brand_news | market_sizing",
      "tier_mask": [1, 2],
      "source_type_mask": ["trade_press", "association"],
      "language": "it | en | both",
      "freshness_window_days": 30,
      "max_results_per_source": 3,
      "gap_reason": "no_coverage | stale_coverage | low_trust_coverage | new_angle"
    }
  ],
  "rationale": "one short paragraph describing why these queries and not others",
  "estimated_credits": 18
}

Rules for producing queries:

1. Generate at most one query per distinct gap_reason + intent pair per keyword. Do not duplicate.
2. text must be the exact search phrase Firecrawl's /map search parameter will receive. Italian keywords in Italian, English keywords in English, brand names in their native spelling.
3. tier_mask restricts which catalog sources the query will hit. Prefer tier [1, 2] for Italian trade press, [3] for stats bodies, [4] for market research, [5] only as fallback.
4. source_type_mask must be a subset of these exact values: trade_press, retailer, association, stats, market_research, brand, news, cross_reference, linkedin_fiber.
5. freshness_window_days is how recent articles must be. Use 7 for breaking-news intents (competitor_launch, retailer_activity), 30 for category_landscape, 90 for regulatory, 180 for market_sizing.
6. max_results_per_source defaults to 3 unless a category is thin; never exceed 5 without a rationale sentence explaining why.
7. estimated_credits is an integer sum across queries using this approximation: 1 credit per /map call plus 1 credit per expected URL scraped. For a query with tier_mask [1, 2] hitting ~5 sources at max_results_per_source=3, estimate 5 + 15 = 20 credits.
8. Return zero queries when the graph already covers every keyword with fresh, high-trust content. Say so in the rationale.
9. Return ONLY JSON. No prose outside the JSON object. No code fences.

Do NOT invent keywords that are not in the brief or in the covered-keywords list. Do NOT infer stakeholder strategy beyond what the brief names.`;

type RenderInput = Omit<PlannerInput, "workspaceId" | "budget" | "defaultFreshnessWindowDays"> & {
  coveredKeywords: Array<{ keyword: string; score: number; stale: boolean }>;
  staleKeywords: string[];
};

/**
 * Render the per-call user message. The planner calls this after Step 1
 * (graph coverage) completes so the message includes both the brief
 * context and the coverage scores.
 */
export function buildPlannerUserMessage(input: RenderInput): string {
  const catalogSummary = summarizeCatalog(input.workspaceCatalog);
  const coverageList = input.coveredKeywords.length
    ? input.coveredKeywords
        .map(
          (c) =>
            `  - ${c.keyword}: score=${c.score.toFixed(2)}${c.stale ? " (STALE, refresh needed)" : ""}`,
        )
        .join("\n")
    : "  (none yet; empty graph)";
  const staleList = input.staleKeywords.length
    ? input.staleKeywords.map((k) => `  - ${k}`).join("\n")
    : "  (none)";
  const stakeholderList = input.stakeholders.length
    ? input.stakeholders.map((s) => `  - ${s.name}${s.role ? ` (${s.role})` : ""}`).join("\n")
    : "  (none named)";
  const scopeLine = input.scopeName ? `${input.scopeName} (${input.scopeKind ?? "system"})` : "(no scope selected)";

  return `<brief>
${input.briefSummary}
</brief>

<brief_keywords>
${input.briefKeywords.map((k) => `  - ${k}`).join("\n")}
</brief_keywords>

<scope>
${scopeLine}
</scope>

<stakeholders>
${stakeholderList}
</stakeholders>

<graph_coverage>
${coverageList}
</graph_coverage>

<stale_flags>
${staleList}
</stale_flags>

<catalog_summary>
${catalogSummary}
</catalog_summary>

<instruction>
Produce the JSON plan per the system instructions. Generate queries ONLY for keywords with low coverage or stale coverage. If every keyword is fresh and well covered, return an empty queries array and say so in the rationale.
</instruction>

${FEW_SHOT_EXAMPLES}`;
}

function summarizeCatalog(catalog: SourceCatalogEntry[]): string {
  if (catalog.length === 0) return "  (empty catalog)";
  const byTierType = new Map<string, number>();
  for (const row of catalog) {
    const key = `tier${row.tier}-${row.sourceType}-${row.language}`;
    byTierType.set(key, (byTierType.get(key) ?? 0) + 1);
  }
  const lines: string[] = [];
  for (const [key, count] of [...byTierType.entries()].sort()) {
    lines.push(`  - ${key}: ${count}`);
  }
  return lines.join("\n");
}

/**
 * Five canonical FMCG query types with fully formed expected output.
 * Each example pairs a brief snippet with the planner's ideal JSON
 * response. Haiku learns the shape and the judgment from these.
 */
const FEW_SHOT_EXAMPLES = `<examples>

<example>
<scenario>Category review: Italian snack salati, stakeholder is an insights lead at Kellanova, graph is empty.</scenario>
<input_keywords>snack salati, private label, promo pressure, Kellanova Italia</input_keywords>
<graph_coverage>all keywords score=0, no stale flags (empty graph)</graph_coverage>
<output>
{
  "queries": [
    {
      "id": "q1",
      "text": "snack salati Italia trend 2026 volume valore",
      "intent": "category_landscape",
      "tier_mask": [1, 2, 3],
      "source_type_mask": ["trade_press", "association", "stats"],
      "language": "it",
      "freshness_window_days": 30,
      "max_results_per_source": 3,
      "gap_reason": "no_coverage"
    },
    {
      "id": "q2",
      "text": "private label snack pressione promozionale GDO",
      "intent": "retailer_activity",
      "tier_mask": [1, 2],
      "source_type_mask": ["trade_press", "association"],
      "language": "it",
      "freshness_window_days": 30,
      "max_results_per_source": 3,
      "gap_reason": "no_coverage"
    },
    {
      "id": "q3",
      "text": "Kellanova Italia lancio snack 2026",
      "intent": "brand_news",
      "tier_mask": [1, 5],
      "source_type_mask": ["trade_press", "cross_reference"],
      "language": "it",
      "freshness_window_days": 60,
      "max_results_per_source": 3,
      "gap_reason": "no_coverage"
    }
  ],
  "rationale": "Empty graph on a category-review brief means three parallel scans: baseline category trend, private-label promo pressure, and Kellanova brand news. Tier 3 stats body included because ISTAT and ISMEA publish volume data that ground the commercial story.",
  "estimated_credits": 48
}
</output>
</example>

<example>
<scenario>Competitor launch: brief focuses on a Barilla capsule-coffee launch, graph has stale Borbone coverage.</scenario>
<input_keywords>Barilla capsule coffee, Borbone, Segafredo, rotazioni capsule</input_keywords>
<graph_coverage>Barilla score=0 no coverage; Borbone score=0.9 stale; Segafredo score=0.1 low coverage; rotazioni capsule score=0.4 partial</graph_coverage>
<output>
{
  "queries": [
    {
      "id": "q1",
      "text": "Barilla capsule caffe lancio 2026",
      "intent": "competitor_launch",
      "tier_mask": [1, 5],
      "source_type_mask": ["trade_press", "cross_reference"],
      "language": "it",
      "freshness_window_days": 7,
      "max_results_per_source": 5,
      "gap_reason": "no_coverage"
    },
    {
      "id": "q2",
      "text": "Borbone capsule quota volume GDO",
      "intent": "brand_news",
      "tier_mask": [1, 2],
      "source_type_mask": ["trade_press", "association"],
      "language": "it",
      "freshness_window_days": 14,
      "max_results_per_source": 3,
      "gap_reason": "stale_coverage"
    },
    {
      "id": "q3",
      "text": "Segafredo capsule caffe distribuzione Italia",
      "intent": "brand_news",
      "tier_mask": [1, 2],
      "source_type_mask": ["trade_press", "association"],
      "language": "it",
      "freshness_window_days": 30,
      "max_results_per_source": 3,
      "gap_reason": "low_trust_coverage"
    }
  ],
  "rationale": "Barilla query is fresh no-coverage, Borbone refresh since coverage is stale, Segafredo deepen because current score is low. Rotazioni capsule stays out of the gap list because 0.4 is acceptable partial coverage; the fetcher will surface what the graph already has.",
  "estimated_credits": 42
}
</output>
</example>

<example>
<scenario>JBP prep: Esselunga brief, graph covers Esselunga but stakeholder is new.</scenario>
<input_keywords>Esselunga, promo calendar, JBP 2026, private label Esselunga</input_keywords>
<graph_coverage>Esselunga score=1.2 fresh; promo calendar score=0.2 low; JBP 2026 score=0 no coverage; private label Esselunga score=0.9 fresh</graph_coverage>
<output>
{
  "queries": [
    {
      "id": "q1",
      "text": "Esselunga calendario promozionale 2026 gennaio febbraio",
      "intent": "retailer_activity",
      "tier_mask": [1, 2],
      "source_type_mask": ["trade_press", "association"],
      "language": "it",
      "freshness_window_days": 14,
      "max_results_per_source": 3,
      "gap_reason": "low_trust_coverage"
    },
    {
      "id": "q2",
      "text": "JBP joint business plan GDO 2026 case study",
      "intent": "retailer_activity",
      "tier_mask": [1, 2, 5],
      "source_type_mask": ["trade_press", "association", "cross_reference"],
      "language": "both",
      "freshness_window_days": 90,
      "max_results_per_source": 3,
      "gap_reason": "no_coverage"
    }
  ],
  "rationale": "Esselunga itself is well covered; do not re-scrape. Promo calendar needs deeper coverage and JBP playbook material is absent. Private-label Esselunga stays out because the graph already has strong coverage.",
  "estimated_credits": 28
}
</output>
</example>

<example>
<scenario>Regulatory scan: Nutri-Score change in Italy, graph has no regulatory coverage at all.</scenario>
<input_keywords>Nutri-Score Italia, etichettatura fronte pacco, regolamento UE 2026</input_keywords>
<graph_coverage>Nutri-Score Italia score=0 no coverage; etichettatura fronte pacco score=0 no coverage; regolamento UE 2026 score=0 no coverage</graph_coverage>
<output>
{
  "queries": [
    {
      "id": "q1",
      "text": "Nutri-Score Italia aggiornamento normativa 2026",
      "intent": "regulatory",
      "tier_mask": [2, 3],
      "source_type_mask": ["association", "stats"],
      "language": "it",
      "freshness_window_days": 90,
      "max_results_per_source": 5,
      "gap_reason": "no_coverage"
    },
    {
      "id": "q2",
      "text": "etichettatura fronte pacco alimentare regolamento UE",
      "intent": "regulatory",
      "tier_mask": [2, 3, 5],
      "source_type_mask": ["association", "stats", "cross_reference"],
      "language": "both",
      "freshness_window_days": 180,
      "max_results_per_source": 3,
      "gap_reason": "no_coverage"
    }
  ],
  "rationale": "Regulatory scans need long freshness windows because policy text moves slowly. Tier 2 associations (Federalimentare, Federdistribuzione) plus Tier 3 stats bodies plus UK/EU cross-reference catch the union of Italian reaction and EU source text.",
  "estimated_credits": 35
}
</output>
</example>

<example>
<scenario>Ingredient innovation: alt-protein launches, graph has mature alt-protein coverage.</scenario>
<input_keywords>plant-based proteine, alt-protein lancio Italia, consumatori italiani proteine vegetali</input_keywords>
<graph_coverage>plant-based proteine score=1.5 fresh; alt-protein lancio Italia score=1.1 fresh; consumatori italiani proteine vegetali score=0.95 fresh</graph_coverage>
<output>
{
  "queries": [],
  "rationale": "All three keywords score above 0.8 with fresh coverage. The graph already carries Italian trade-press articles on plant-based launches and consumer trend data from ISMEA. No new scrape needed for this brief.",
  "estimated_credits": 0
}
</output>
</example>

</examples>`;

/**
 * Optional helper for ad-hoc testing: map an intent to the default
 * freshness window used in the few-shot examples. Not load-bearing on
 * production behavior; Haiku may pick a different window per-query.
 */
export function defaultFreshnessWindowForIntent(intent: ResearchQueryIntent): number {
  switch (intent) {
    case "competitor_launch":
    case "retailer_activity":
      return 7;
    case "brand_news":
    case "consumer_trend":
      return 30;
    case "category_landscape":
      return 60;
    case "regulatory":
    case "market_sizing":
      return 180;
    default:
      return 30;
  }
}
