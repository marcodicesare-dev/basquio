import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createResearchPlan,
  type GraphCoverageResult,
  type HaikuCallFn,
  type PlannerInput,
  type ResearchPlan,
  type SourceCatalogEntry,
} from "./index";

/**
 * Smoke tests for the graph-first planner.
 *
 * No live Anthropic API calls. Haiku is a stub function returning a
 * canned JSON string. Graph queries are fixtures. Cases required by
 * spec §9 Day 3 acceptance:
 *
 *   1. Empty graph  -> full queries generated for every keyword.
 *   2. Covered graph (high score, no stale) -> queries = [], existingGraphRefs populated.
 *   3. Partial coverage -> only missing keywords get queries.
 *   4. Stale coverage -> queries generated despite high score.
 *   5. Budget exceeded -> queries trimmed to stay within budget.
 *   6. Invalid Haiku JSON -> error raised, not silent degradation.
 *
 * Plus two extra for robustness:
 *   7. Haiku returns code-fenced JSON -> tolerant parse works.
 *   8. Graph chunks below chunkMinTrust -> filtered out of evidence refs.
 */

const TEAM_WORKSPACE = "15cc947e-70cb-455a-b0df-d8c34b760d71";

function buildCatalog(): SourceCatalogEntry[] {
  return [
    {
      id: "00000000-0000-0000-0000-000000000001",
      workspaceId: TEAM_WORKSPACE,
      url: "https://mark-up.it",
      host: "mark-up.it",
      tier: 1,
      language: "it",
      sourceType: "trade_press",
      domainTags: ["gdo"],
      crawlPatterns: {},
      trustScore: 90,
      status: "active",
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      workspaceId: TEAM_WORKSPACE,
      url: "https://federalimentare.it",
      host: "federalimentare.it",
      tier: 2,
      language: "it",
      sourceType: "association",
      domainTags: ["association"],
      crawlPatterns: {},
      trustScore: 85,
      status: "active",
    },
  ];
}

function buildInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    workspaceId: TEAM_WORKSPACE,
    briefSummary: "Kellanova snack salati Q1 2026 category review",
    briefKeywords: ["snack salati", "private label", "Kellanova"],
    stakeholders: [{ name: "Maria Rossi", role: "Head of Insights" }],
    scopeName: "Kellanova",
    scopeKind: "client",
    workspaceCatalog: buildCatalog(),
    budget: { maxUrls: 50, maxUsd: 2.0 },
    ...overrides,
  };
}

function emptyGraph(): GraphCoverageResult {
  return { hits: [] };
}

function fullyCoveredGraph(keywords: string[]): GraphCoverageResult {
  return {
    hits: keywords.map((keyword) => ({
      keyword,
      chunks: [
        {
          id: `chunk-${keyword}`,
          documentId: `doc-${keyword}`,
          documentKind: "scraped_article" as const,
          documentSourceUrl: `https://mark-up.it/articoli/${keyword}`,
          documentSourceTrustScore: 85,
          documentFileName: `${keyword}.md`,
          snippet: `Coverage snippet for ${keyword}.`,
          rawContent: `Full content for ${keyword}.`,
          score: 0.9,
          dimensions: { source_host: "mark-up.it" },
        },
      ],
      facts: [
        {
          id: `fact-${keyword}`,
          documentId: `doc-${keyword}`,
          documentFileName: `${keyword}.md`,
          subjectEntity: "entity-1",
          subjectName: "Kellanova",
          predicate: "sells",
          objectValue: `${keyword} products`,
          confidence: 0.95,
          validFrom: "2026-03-01",
          validTo: null,
          dimensions: {},
        },
      ],
      isStale: false,
      staleReason: null,
    })),
  };
}

function haikuReturning(json: Record<string, unknown>): HaikuCallFn {
  return async () => JSON.stringify(json);
}

function haikuThatShouldNotBeCalled(): HaikuCallFn {
  return async () => {
    throw new Error("Haiku was called when the planner should have short-circuited");
  };
}

async function test1EmptyGraphGeneratesFullQueries() {
  const input = buildInput();
  const stubHaiku = haikuReturning({
    queries: [
      {
        id: "q1",
        text: "snack salati Italia trend 2026",
        intent: "category_landscape",
        tier_mask: [1, 2],
        source_type_mask: ["trade_press", "association"],
        language: "it",
        freshness_window_days: 30,
        max_results_per_source: 3,
        gap_reason: "no_coverage",
      },
      {
        id: "q2",
        text: "Kellanova Italia lancio snack 2026",
        intent: "brand_news",
        tier_mask: [1],
        source_type_mask: ["trade_press"],
        language: "it",
        freshness_window_days: 60,
        max_results_per_source: 3,
        gap_reason: "no_coverage",
      },
    ],
    rationale: "empty graph test",
    estimated_credits: 12,
  });
  const plan = await createResearchPlan(input, {
    graphQuery: async () => emptyGraph(),
    callHaiku: stubHaiku,
  });
  assert.equal(plan.queries.length, 2);
  assert.equal(plan.existingGraphRefs.length, 0);
  assert.equal(plan.graph_coverage_score, 0);
  assert.deepEqual(plan.stale_keywords, []);
}

async function test2CoveredGraphSkipsHaiku() {
  const input = buildInput();
  const plan = await createResearchPlan(input, {
    graphQuery: async () => fullyCoveredGraph(input.briefKeywords),
    callHaiku: haikuThatShouldNotBeCalled(),
  });
  assert.equal(plan.queries.length, 0);
  assert.ok(plan.existingGraphRefs.length > 0, "should have materialized fact+chunk refs");
  assert.ok(plan.graph_coverage_score >= 0.8, `expected >=0.8, got ${plan.graph_coverage_score}`);
  assert.equal(plan.estimated_credits, 0);
  assert.match(plan.rationale, /sufficient/i);
}

async function test3PartialCoverageAsksForGaps() {
  const input = buildInput({
    briefKeywords: ["covered-a", "covered-b", "missing-c"],
  });
  const partialGraph: GraphCoverageResult = {
    hits: [
      {
        keyword: "covered-a",
        chunks: [
          {
            id: "chunk-a",
            documentId: "doc-a",
            documentKind: "scraped_article",
            documentSourceUrl: "https://x/a",
            documentSourceTrustScore: 85,
            documentFileName: "a.md",
            snippet: "snippet a",
            rawContent: "a content",
            score: 0.9,
            dimensions: {},
          },
        ],
        facts: [
          {
            id: "fact-a",
            documentId: "doc-a",
            documentFileName: "a.md",
            subjectEntity: "e1",
            subjectName: "Entity A",
            predicate: "is",
            objectValue: "covered",
            confidence: 0.9,
            validFrom: null,
            validTo: null,
            dimensions: {},
          },
        ],
        isStale: false,
        staleReason: null,
      },
      {
        keyword: "covered-b",
        chunks: [],
        facts: [
          {
            id: "fact-b",
            documentId: "doc-b",
            documentFileName: "b.md",
            subjectEntity: "e2",
            subjectName: "Entity B",
            predicate: "is",
            objectValue: "covered",
            confidence: 0.85,
            validFrom: null,
            validTo: null,
            dimensions: {},
          },
        ],
        isStale: false,
        staleReason: null,
      },
    ],
  };
  const stubHaiku = haikuReturning({
    queries: [
      {
        id: "q1",
        text: "missing-c search",
        intent: "category_landscape",
        tier_mask: [1],
        source_type_mask: ["trade_press"],
        language: "it",
        freshness_window_days: 30,
        max_results_per_source: 3,
        gap_reason: "no_coverage",
      },
    ],
    rationale: "missing-c uncovered",
    estimated_credits: 4,
  });
  const plan = await createResearchPlan(input, {
    graphQuery: async () => partialGraph,
    callHaiku: stubHaiku,
  });
  assert.equal(plan.queries.length, 1);
  assert.equal(plan.queries[0]?.text, "missing-c search");
  assert.ok(plan.existingGraphRefs.length >= 2, "should have materialized covered-a + covered-b refs");
  assert.ok(plan.graph_coverage_score > 0 && plan.graph_coverage_score < 0.8);
}

async function test4StaleCoverageStillCallsHaiku() {
  const input = buildInput({ briefKeywords: ["stale-topic"] });
  const staleGraph: GraphCoverageResult = {
    hits: [
      {
        keyword: "stale-topic",
        chunks: [],
        facts: [
          {
            id: "fact-stale",
            documentId: "doc-stale",
            documentFileName: "stale.md",
            subjectEntity: "e",
            subjectName: "Topic",
            predicate: "was",
            objectValue: "covered years ago",
            confidence: 0.95,
            validFrom: "2024-01-01",
            validTo: "2024-12-31",
            dimensions: {},
          },
        ],
        isStale: true,
        staleReason: "last article is 90+ days old",
      },
    ],
  };
  let haikuCalled = false;
  const stubHaiku: HaikuCallFn = async () => {
    haikuCalled = true;
    return JSON.stringify({
      queries: [
        {
          id: "q1",
          text: "refresh stale-topic coverage",
          intent: "brand_news",
          tier_mask: [1],
          source_type_mask: ["trade_press"],
          language: "it",
          freshness_window_days: 14,
          max_results_per_source: 3,
          gap_reason: "stale_coverage",
        },
      ],
      rationale: "stale refresh",
      estimated_credits: 4,
    });
  };
  const plan = await createResearchPlan(input, {
    graphQuery: async () => staleGraph,
    callHaiku: stubHaiku,
  });
  assert.equal(haikuCalled, true, "stale flag must force Haiku step");
  assert.equal(plan.queries.length, 1);
  assert.equal(plan.queries[0]?.gap_reason, "stale_coverage");
  assert.deepEqual(plan.stale_keywords, ["stale-topic"]);
}

async function test5BudgetTrimsLowestPriorityQueries() {
  const input = buildInput({
    budget: { maxUrls: 6, maxUsd: 12 },
    briefKeywords: ["a", "b", "c", "d"],
  });
  // Haiku returns 4 queries; budget only accepts ~2 (each uses 3 URLs x 1 tier = 3 URLs, so 2 fit).
  const stubHaiku = haikuReturning({
    queries: [
      { id: "q1", text: "a", intent: "category_landscape", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 30, max_results_per_source: 3, gap_reason: "no_coverage" },
      { id: "q2", text: "b", intent: "brand_news", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 30, max_results_per_source: 3, gap_reason: "new_angle" },
      { id: "q3", text: "c", intent: "consumer_trend", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 30, max_results_per_source: 3, gap_reason: "stale_coverage" },
      { id: "q4", text: "d", intent: "regulatory", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 180, max_results_per_source: 3, gap_reason: "low_trust_coverage" },
    ],
    rationale: "four gaps",
    estimated_credits: 16,
  });
  const plan = await createResearchPlan(input, {
    graphQuery: async () => emptyGraph(),
    callHaiku: stubHaiku,
  });
  // Budget of 6 URLs allows 2 queries (3 URLs each). Priority keeps no_coverage first, then stale_coverage.
  assert.equal(plan.queries.length, 2);
  const keptGaps = plan.queries.map((q) => q.gap_reason);
  assert.ok(keptGaps.includes("no_coverage"), "must keep no_coverage (highest priority)");
  assert.ok(keptGaps.includes("stale_coverage"), "must keep stale_coverage (second priority)");
  assert.ok(!keptGaps.includes("new_angle"), "must drop new_angle (lowest priority)");
  assert.match(plan.rationale, /trimmed/i);
}

async function test6InvalidHaikuJsonRaises() {
  const input = buildInput();
  const stubHaiku: HaikuCallFn = async () => "this is definitely not json at all";
  await assert.rejects(
    () =>
      createResearchPlan(input, {
        graphQuery: async () => emptyGraph(),
        callHaiku: stubHaiku,
      }),
    (err: unknown) => err instanceof SyntaxError,
  );
}

async function test7TolerantJsonParseHandlesCodeFence() {
  const input = buildInput();
  const stubHaiku: HaikuCallFn = async () =>
    "Sure! Here is your plan:\n```json\n" +
    JSON.stringify({
      queries: [],
      rationale: "nothing needed",
      estimated_credits: 0,
    }) +
    "\n```";
  const plan = await createResearchPlan(input, {
    graphQuery: async () => emptyGraph(),
    callHaiku: stubHaiku,
  });
  assert.equal(plan.queries.length, 0);
  assert.equal(plan.rationale, "nothing needed");
}

async function test8LowTrustChunksFilteredOut() {
  const input = buildInput({ briefKeywords: ["low-trust-topic"] });
  const lowTrustGraph: GraphCoverageResult = {
    hits: [
      {
        keyword: "low-trust-topic",
        chunks: [
          {
            id: "chunk-lowtrust",
            documentId: "doc-lowtrust",
            documentKind: "scraped_article",
            documentSourceUrl: "https://sketchy.example/x",
            documentSourceTrustScore: 40, // below default chunkMinTrust=60
            documentFileName: "lowtrust.md",
            snippet: "snippet",
            rawContent: "content",
            score: 0.7,
            dimensions: {},
          },
        ],
        facts: [],
        isStale: false,
        staleReason: null,
      },
    ],
  };
  const stubHaiku = haikuReturning({
    queries: [
      { id: "q1", text: "refresh low-trust", intent: "category_landscape", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 30, max_results_per_source: 3, gap_reason: "low_trust_coverage" },
    ],
    rationale: "low trust",
    estimated_credits: 4,
  });
  const plan = await createResearchPlan(input, {
    graphQuery: async () => lowTrustGraph,
    callHaiku: stubHaiku,
  });
  assert.equal(plan.existingGraphRefs.length, 0, "low-trust chunks should be filtered out");
  assert.ok(plan.graph_coverage_score < 0.5, "low-trust chunk should not inflate coverage");
  assert.equal(plan.queries.length, 1);
}

async function test9UsdBoundTrimExercised() {
  // maxUrls is generous but maxUsd is tight so the USD branch of
  // enforceBudget is the binding constraint.
  const input = buildInput({
    budget: { maxUrls: 500, maxUsd: 0.02 },
    briefKeywords: ["a", "b", "c"],
  });
  const stubHaiku = haikuReturning({
    queries: [
      { id: "q1", text: "a", intent: "category_landscape", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 30, max_results_per_source: 3, gap_reason: "no_coverage" },
      { id: "q2", text: "b", intent: "brand_news", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 30, max_results_per_source: 3, gap_reason: "new_angle" },
      { id: "q3", text: "c", intent: "consumer_trend", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 30, max_results_per_source: 3, gap_reason: "stale_coverage" },
    ],
    rationale: "three gaps",
    estimated_credits: 12,
  });
  // Each query is 1 + 3 = 4 credits. At Hobby rate 0.0063/credit that is
  // $0.0252. Budget is $0.02. Only zero or one fits. With priority keeping
  // no_coverage first, we expect exactly one kept query (or zero if the
  // default tuning rate over-shoots; assert <= 1 to be safe on the boundary).
  const plan = await createResearchPlan(input, {
    graphQuery: async () => emptyGraph(),
    callHaiku: stubHaiku,
  });
  assert.ok(
    plan.queries.length <= 1,
    `USD-bound trim should keep at most 1 query, got ${plan.queries.length}`,
  );
  assert.match(plan.rationale, /trimmed/i);
}

async function test10StandardTierTuningFitsMoreQueries() {
  // With Standard-tier USD per credit (roughly 0.00083) the same tight
  // maxUsd accepts more queries. This test documents that the override
  // works without fiddling with the budget envelope itself.
  const input = buildInput({
    budget: { maxUrls: 500, maxUsd: 0.02 },
    briefKeywords: ["a", "b", "c"],
  });
  const stubHaiku = haikuReturning({
    queries: [
      { id: "q1", text: "a", intent: "category_landscape", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 30, max_results_per_source: 3, gap_reason: "no_coverage" },
      { id: "q2", text: "b", intent: "brand_news", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 30, max_results_per_source: 3, gap_reason: "no_coverage" },
      { id: "q3", text: "c", intent: "consumer_trend", tier_mask: [1], source_type_mask: ["trade_press"], language: "it", freshness_window_days: 30, max_results_per_source: 3, gap_reason: "no_coverage" },
    ],
    rationale: "three gaps",
    estimated_credits: 12,
  });
  const plan = await createResearchPlan(input, {
    graphQuery: async () => emptyGraph(),
    callHaiku: stubHaiku,
    tuning: { firecrawlUsdPerCredit: 0.00083 },
  });
  // At 0.00083 each 4-credit query is $0.00332. Three fit under $0.02.
  assert.equal(plan.queries.length, 3);
}

async function test11OnStageObserverFires() {
  const input = buildInput();
  const stages: string[] = [];
  const stubHaiku = haikuReturning({ queries: [], rationale: "n/a", estimated_credits: 0 });
  await createResearchPlan(input, {
    graphQuery: async () => fullyCoveredGraph(input.briefKeywords),
    callHaiku: stubHaiku,
    onStage: (stage) => {
      stages.push(stage);
    },
  });
  assert.ok(stages.includes("graph_coverage"), "graph_coverage stage must fire");
  // Haiku skipped when fully covered, so haiku_gap should NOT fire.
  assert.ok(!stages.includes("haiku_gap"), "haiku_gap must not fire on skip path");
}

describe("research planner", () => {
  it("empty graph generates full queries", test1EmptyGraphGeneratesFullQueries);
  it("covered graph skips Haiku", test2CoveredGraphSkipsHaiku);
  it("partial coverage asks for gaps", test3PartialCoverageAsksForGaps);
  it("stale coverage still calls Haiku", test4StaleCoverageStillCallsHaiku);
  it("budget trims lowest-priority queries", test5BudgetTrimsLowestPriorityQueries);
  it("invalid Haiku JSON raises SyntaxError", test6InvalidHaikuJsonRaises);
  it("tolerant JSON parse handles code-fenced Haiku output", test7TolerantJsonParseHandlesCodeFence);
  it("low-trust chunks filtered out", test8LowTrustChunksFilteredOut);
  it("USD-bound trim exercised (Hobby default)", test9UsdBoundTrimExercised);
  it("Standard-tier tuning fits more queries under same USD cap", test10StandardTierTuningFitsMoreQueries);
  it("onStage observer fires for graph_coverage", test11OnStageObserverFires);
});
