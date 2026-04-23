/**
 * Research package type contracts.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §5.2.
 *
 * EvidenceRef shape here mirrors the llmEvidenceRefSchema defined inline in
 * `packages/intelligence/src/insights.ts:26-39`. The research package
 * emits EvidenceRef-shaped objects for the fetcher to merge into the
 * deck pipeline's `analyticsResult.evidenceRefs`. We don't import the
 * intelligence schema here to avoid a circular dependency; the fetcher
 * (Day 4) owns the boundary and validates shape at consumption time.
 */

import { z } from "zod";

/**
 * EvidenceRef shape, kept in sync with llmEvidenceRefSchema in
 * `packages/intelligence/src/insights.ts:26-39`. Zod schema so callers
 * can validate rather than cast blindly.
 */
export const evidenceRefSchema = z.object({
  id: z.string(),
  sourceFileId: z.string(),
  fileName: z.string(),
  fileRole: z.string(),
  sheet: z.string(),
  metric: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  sourceLocation: z.string(),
  rawValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  derivedTable: z.string().nullable(),
  dimensions: z.record(z.string(), z.string()),
});

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

/**
 * A source_catalog row surface trimmed to what the planner and fetcher
 * need. Rows are loaded by the caller (Day 5 pipeline integration)
 * from the `source_catalog` table and passed in; the research package
 * does not touch the DB directly.
 */
export const sourceCatalogEntrySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  url: z.string(),
  host: z.string(),
  tier: z.number().int().min(1).max(5),
  language: z.string(),
  sourceType: z.enum([
    "trade_press",
    "retailer",
    "association",
    "stats",
    "market_research",
    "brand",
    "news",
    "cross_reference",
    "linkedin_fiber",
  ]),
  domainTags: z.array(z.string()),
  crawlPatterns: z.record(z.string(), z.unknown()),
  trustScore: z.number().int().min(0).max(100),
  status: z.enum(["active", "paused", "broken", "removed"]),
});

export type SourceCatalogEntry = z.infer<typeof sourceCatalogEntrySchema>;

/**
 * Planner input. The caller (fetcher on Day 4) builds this from the
 * synthesized brief plus the workspace's active catalog rows.
 */
export type PlannerInput = {
  workspaceId: string;
  briefSummary: string;
  briefKeywords: string[];
  stakeholders: Array<{ name: string; role: string | null }>;
  scopeName: string | null;
  scopeKind: "client" | "category" | "function" | "system" | null;
  workspaceCatalog: SourceCatalogEntry[];
  budget: ResearchBudget;
  defaultFreshnessWindowDays?: number;
};

export type ResearchBudget = {
  maxUrls: number;
  maxUsd: number;
};

/**
 * Per-query intent names match spec §5.2. Used by the fetcher to pick
 * Firecrawl endpoints and by the UI to render a human-readable query
 * list on the research telemetry row (spec §7.3).
 */
export const researchQueryIntentSchema = z.enum([
  "category_landscape",
  "competitor_launch",
  "retailer_activity",
  "consumer_trend",
  "regulatory",
  "brand_news",
  "market_sizing",
]);

export type ResearchQueryIntent = z.infer<typeof researchQueryIntentSchema>;

export const researchQueryGapReasonSchema = z.enum([
  "no_coverage",
  "stale_coverage",
  "low_trust_coverage",
  "new_angle",
]);

export type ResearchQueryGapReason = z.infer<typeof researchQueryGapReasonSchema>;

export const researchQuerySchema = z.object({
  id: z.string().regex(/^q\d+$/, "query id must be q<number>"),
  text: z.string().min(1),
  intent: researchQueryIntentSchema,
  tier_mask: z.array(z.number().int().min(1).max(5)).min(1),
  source_type_mask: z.array(z.string()).min(1),
  language: z.enum(["it", "en", "both"]),
  freshness_window_days: z.number().int().min(1).nullable(),
  max_results_per_source: z.number().int().min(1).max(20).default(3),
  gap_reason: researchQueryGapReasonSchema,
});

export type ResearchQuery = z.infer<typeof researchQuerySchema>;

/**
 * Full planner output. `existingGraphRefs` comes from Step 1 (graph
 * coverage) and is populated regardless of whether Step 2 fires.
 * `queries` is empty when the graph already covers the brief.
 */
export const researchPlanSchema = z.object({
  existingGraphRefs: z.array(evidenceRefSchema),
  queries: z.array(researchQuerySchema),
  rationale: z.string(),
  estimated_credits: z.number().min(0),
  graph_coverage_score: z.number().min(0).max(1),
  stale_keywords: z.array(z.string()),
});

export type ResearchPlan = z.infer<typeof researchPlanSchema>;

/**
 * Zod-parseable shape of the JSON response we expect from Haiku.
 * Tighter than researchPlanSchema because Haiku only produces the
 * Step-2 output (queries + rationale + credits). The planner merges
 * Step-1 outputs (existingGraphRefs, graph_coverage_score, stale_keywords)
 * into the final ResearchPlan.
 */
export const haikuPlanOutputSchema = z.object({
  queries: z.array(researchQuerySchema),
  rationale: z.string(),
  estimated_credits: z.number().min(0),
});

export type HaikuPlanOutput = z.infer<typeof haikuPlanOutputSchema>;

/**
 * Graph coverage result from Step 1 of the planner. Callers implement
 * the actual query using the shipped `workspace_chat_retrieval` RPC
 * plus direct queries against `entities`, `facts`, `knowledge_chunks`.
 * Keeping the interface as a function prop means tests can inject
 * deterministic fixtures without spinning up a Postgres.
 */
export type GraphCoverageHit = {
  keyword: string;
  chunks: Array<{
    id: string;
    documentId: string;
    documentKind: "uploaded_file" | "scraped_article" | "chat_paste" | "chat_url";
    documentSourceUrl: string | null;
    documentSourceTrustScore: number | null;
    documentFileName: string;
    snippet: string;
    rawContent: string;
    score: number;
    dimensions: Record<string, string>;
  }>;
  facts: Array<{
    id: string;
    documentId: string;
    documentFileName: string;
    subjectEntity: string;
    subjectName: string;
    predicate: string;
    objectValue: string;
    confidence: number;
    validFrom: string | null;
    validTo: string | null;
    dimensions: Record<string, string>;
  }>;
  isStale: boolean;
  staleReason: string | null;
};

export type GraphCoverageResult = {
  hits: GraphCoverageHit[];
};

export type GraphQueryFn = (args: {
  workspaceId: string;
  keywords: string[];
  freshnessWindowDays: number | null;
}) => Promise<GraphCoverageResult>;

/**
 * Haiku invocation hook. The planner passes a fully formed message
 * (system + user) and expects a string response that will be parsed
 * as JSON matching `haikuPlanOutputSchema`. Callers plug in their
 * real Anthropic SDK client; tests inject a stub that returns a
 * fixture string.
 */
export type HaikuCallFn = (args: {
  system: string;
  user: string;
  signal?: AbortSignal;
}) => Promise<string>;

/**
 * Tunable constants for the coverage-score heuristic. Exposed so the
 * Day 4 fetcher can tighten or loosen based on the Day 3 R7
 * extraction-quality measurement.
 */
export type PlannerTuning = {
  /** Minimum coverage score to short-circuit Step 2 entirely. */
  highCoverageThreshold: number;
  /** Weight for each matching fact in the coverage score. */
  factWeight: number;
  /** Weight for each matching chunk in the coverage score. */
  chunkWeight: number;
  /** Minimum trust score for a chunk's source to count toward coverage. */
  chunkMinTrust: number;
  /**
   * USD per Firecrawl credit. Defaults to Hobby-tier pricing as a
   * conservative upper bound. Callers on Standard tier (confirmed 2026-04-23
   * for Basquio) can lower to ~0.00083 for more headroom.
   */
  firecrawlUsdPerCredit: number;
};

export const DEFAULT_PLANNER_TUNING: PlannerTuning = {
  highCoverageThreshold: 0.8,
  factWeight: 1,
  chunkWeight: 0.3,
  chunkMinTrust: 60,
  firecrawlUsdPerCredit: 0.0063,
};
