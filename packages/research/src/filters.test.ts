import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  executePlan,
  type FirecrawlClient,
  type FirecrawlBatchScrapeStatus,
  type FirecrawlMapResponse,
  type HaikuCallFn,
  type RestConfig,
  type SourceCatalogEntry,
} from "./index";

/**
 * Unit tests for the R7 content-quality filters added 2026-04-23 after
 * Day 4 smoke exposed three gaps:
 *
 *   1. Sitemap / feed / tag / category / author / archive URLs were
 *      scraped as articles because they matched crawl_allow. Fix: a
 *      GLOBAL_CRAWL_DENY regex list in fetcher.ts that applies
 *      regardless of per-source config. Plus a migration that sets
 *      the same list on every seed row.
 *   2. No freshness enforcement. Fix: URL-path year extraction; if
 *      path embeds /YYYY/ older than now - freshness_window_days,
 *      drop pre-scrape. Second line of defense: metadata.publishedTime
 *      check in persistScrape.
 *   3. Zero-keyword-score URLs got through. Fix: minimum score of 1
 *      on title + description + URL path before a link is kept.
 *   4. Brief B hotel-AI query scraped 15 food-CPG articles because
 *      the topic-overlap gate did not exist. Fix: reject sources
 *      whose domain_tags + host + source_type share zero terms with
 *      the brief.
 *
 * Tests use stubbed Firecrawl clients and cover behavior observable
 * through the fetcher's public surface (executePlan). Stub uses
 * structured fixtures so real-content regressions surface fast.
 */

const TEAM = "15cc947e-70cb-455a-b0df-d8c34b760d71";

function buildItalianCatalog(): SourceCatalogEntry[] {
  return [
    {
      id: "src-markup",
      workspaceId: TEAM,
      url: "https://mark-up.it",
      host: "mark-up.it",
      tier: 1,
      language: "it",
      sourceType: "trade_press",
      domainTags: ["gdo", "retail", "private_label", "fmcg", "cpg", "italia"],
      crawlPatterns: {
        crawl_allow: ["/articoli/.*", "/news/.*"],
        crawl_deny: ["/sitemap/.*", "/feed/.*", "/tag/.*", "/category/.*"],
      },
      trustScore: 90,
      status: "active",
    },
    {
      id: "src-justfood",
      workspaceId: TEAM,
      url: "https://just-food.com",
      host: "just-food.com",
      tier: 5,
      language: "en",
      sourceType: "cross_reference",
      domainTags: ["cross_reference", "food", "consumer", "retail", "fmcg", "cpg"],
      crawlPatterns: {
        crawl_allow: ["/news/.*"],
        crawl_deny: ["/sitemap/.*", "/feed/.*"],
      },
      trustScore: 65,
      status: "active",
    },
  ];
}

function buildPlan(
  queryOverrides: Partial<import("./types").ResearchQuery> = {},
): import("./types").ResearchPlan {
  return {
    existingGraphRefs: [],
    queries: [
      {
        id: "q1",
        text: "snack salati Italia trend 2026",
        intent: "category_landscape",
        tier_mask: [1, 5],
        source_type_mask: ["trade_press", "cross_reference"],
        language: "both",
        freshness_window_days: 30,
        max_results_per_source: 3,
        gap_reason: "no_coverage",
        ...queryOverrides,
      },
    ],
    rationale: "test",
    estimated_credits: 10,
    graph_coverage_score: 0,
    stale_keywords: [],
  };
}

type ScriptedMap = (url: string, search: string | undefined) => FirecrawlMapResponse;

function buildStubFirecrawl(opts: {
  onMap: ScriptedMap;
  onBatch?: (urls: string[]) => FirecrawlBatchScrapeStatus;
}): FirecrawlClient {
  const batchResponses = new Map<string, FirecrawlBatchScrapeStatus>();
  return {
    async map(req) {
      return opts.onMap(req.url, req.search);
    },
    async scrape(): Promise<never> {
      throw new Error("scrape not expected in these tests");
    },
    async batchScrape(req) {
      const id = `batch-${Math.random().toString(36).slice(2, 10)}`;
      if (opts.onBatch) {
        batchResponses.set(id, opts.onBatch(req.urls));
      } else {
        batchResponses.set(id, { success: true, status: "completed", total: 0, completed: 0, data: [] });
      }
      return { success: true, id, url: `https://api.firecrawl.dev/v2/batch/scrape/${id}` };
    },
    async batchScrapeStatus(id) {
      return batchResponses.get(id) ?? { success: true, status: "completed", total: 0, completed: 0, data: [] };
    },
    async crawl(): Promise<never> {
      throw new Error("crawl not expected");
    },
    async crawlStatus(): Promise<never> {
      throw new Error("crawlStatus not expected");
    },
    async search(): Promise<never> {
      throw new Error("search not expected");
    },
  };
}

function buildStubRest(): RestConfig {
  // Supabase REST stub. Mirrors the response shapes the fetcher expects
  // from each call site:
  //   - source_catalog_scrapes lookups return [] (no cache hit).
  //   - /rpc/ensure_scrape_persisted returns a row with the three ids
  //     the persistScrapeAtomic wrapper unpacks (B4a).
  //   - Storage upload requests (not REST) are bypassed by uploadStorage
  //     being its own injected function in FetcherDeps.
  let rowCounter = 0;
  return {
    supabaseUrl: "http://stub",
    serviceKey: "stub-key",
    fetchImpl: (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(url).pathname;
      if (path.endsWith("/rpc/ensure_scrape_persisted") && method === "POST") {
        rowCounter += 1;
        return new Response(
          JSON.stringify([
            {
              knowledge_document_id: `k-${rowCounter}`,
              cache_row_id: `c-${rowCounter}`,
              file_ingest_run_id: `f-${rowCounter}`,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  };
}

async function testSitemapUrlsRejectedByGlobalDeny() {
  const catalog = buildItalianCatalog();
  const firecrawl = buildStubFirecrawl({
    onMap: () => ({
      success: true,
      links: [
        { url: "https://mark-up.it/articoli/kellanova-snack" },
        { url: "https://mark-up.it/sitemap/news/2025", title: "sitemap" },
        { url: "https://mark-up.it/news/2026/03/articolo-reale" },
        { url: "https://mark-up.it/tag/snack" },
      ],
      creditsUsed: 1,
    }),
    onBatch: (urls) => {
      const now = new Date().toISOString();
      return {
        success: true,
        status: "completed",
        total: urls.length,
        completed: urls.length,
        creditsUsed: urls.length,
        data: urls.map((url) => ({
          markdown: `# Article at ${url}`,
          metadata: { sourceURL: url, publishedTime: now, title: `Article ${url}` },
        })),
      };
    },
  });
  const res = await executePlan(
    { workspaceId: TEAM, plan: buildPlan(), catalog, researchRunId: "rr-1" },
    {
      rest: buildStubRest(),
      firecrawl,
      uploadStorage: async () => undefined,
    },
  );
  const urlsScraped = new Set(res.evidenceRefs.map((r) => r.sourceLocation));
  assert.ok(
    !urlsScraped.has("https://mark-up.it/sitemap/news/2025"),
    "sitemap URL must be rejected by the global deny list",
  );
  assert.ok(
    !urlsScraped.has("https://mark-up.it/tag/snack"),
    "tag URL must be rejected by the global deny list",
  );
}

async function testStaleUrlRejectedByPathYearFilter() {
  const catalog = buildItalianCatalog();
  const firecrawl = buildStubFirecrawl({
    onMap: () => ({
      success: true,
      links: [
        // /articoli/ matches crawl_allow. This article is from 2019 per
        // its URL path; the 30-day freshness window should reject it.
        { url: "https://mark-up.it/articoli/2019/01/15/snack-salati-trend-storico", title: "2019 snack article" },
        // This one is from this year; should pass.
        { url: "https://mark-up.it/articoli/2026/04/snack-salati-trend-recente", title: "2026 snack article" },
      ],
      creditsUsed: 1,
    }),
    onBatch: (urls) => ({
      success: true,
      status: "completed",
      total: urls.length,
      completed: urls.length,
      creditsUsed: urls.length,
      data: urls.map((url) => ({
        markdown: `# ${url}`,
        metadata: { sourceURL: url, publishedTime: new Date().toISOString(), title: "ok" },
      })),
    }),
  });
  const res = await executePlan(
    { workspaceId: TEAM, plan: buildPlan(), catalog, researchRunId: "rr-2" },
    {
      rest: buildStubRest(),
      firecrawl,
      uploadStorage: async () => undefined,
    },
  );
  const scrapedUrls = res.evidenceRefs.map((r) => r.sourceLocation);
  assert.ok(
    !scrapedUrls.includes("https://mark-up.it/articoli/2019/01/15/snack-salati-trend-storico"),
    "URL with path year 2019 must be filtered out by the 30-day freshness window",
  );
  assert.ok(
    scrapedUrls.includes("https://mark-up.it/articoli/2026/04/snack-salati-trend-recente"),
    "URL with path year 2026 must pass freshness filter",
  );
}

async function testZeroKeywordScoreUrlsDropped() {
  const catalog = buildItalianCatalog();
  const firecrawl = buildStubFirecrawl({
    onMap: () => ({
      success: true,
      links: [
        // Titles with zero overlap on the query "snack salati Italia trend 2026".
        { url: "https://mark-up.it/articoli/2026/04/meteo-marzo", title: "Le previsioni meteo di marzo" },
        { url: "https://mark-up.it/articoli/2026/04/snack-salati", title: "Snack salati: dati 2026" },
      ],
      creditsUsed: 1,
    }),
    onBatch: (urls) => ({
      success: true,
      status: "completed",
      total: urls.length,
      completed: urls.length,
      creditsUsed: urls.length,
      data: urls.map((url) => ({
        markdown: `# ${url}`,
        metadata: { sourceURL: url, title: "ok", publishedTime: new Date().toISOString() },
      })),
    }),
  });
  const res = await executePlan(
    { workspaceId: TEAM, plan: buildPlan(), catalog, researchRunId: "rr-3" },
    {
      rest: buildStubRest(),
      firecrawl,
      uploadStorage: async () => undefined,
    },
  );
  const scraped = res.evidenceRefs.map((r) => r.sourceLocation);
  assert.ok(!scraped.includes("https://mark-up.it/articoli/2026/04/meteo-marzo"), "zero-keyword-score URL must drop");
  assert.ok(scraped.includes("https://mark-up.it/articoli/2026/04/snack-salati"), "matching URL must pass");
}

async function testTopicOverlapGateRejectsFoodSourceOnHotelBrief() {
  const catalog = buildItalianCatalog();
  let mapCalls = 0;
  const firecrawl = buildStubFirecrawl({
    onMap: () => {
      mapCalls += 1;
      return { success: true, links: [], creditsUsed: 1 };
    },
  });
  const plan = buildPlan({
    text: "hotel AI hospitality EMEA revenue management",
    tier_mask: [1, 5],
    source_type_mask: ["trade_press", "cross_reference"],
    language: "both",
  });
  await executePlan(
    { workspaceId: TEAM, plan, catalog, researchRunId: "rr-4" },
    {
      rest: buildStubRest(),
      firecrawl,
      uploadStorage: async () => undefined,
    },
  );
  assert.equal(
    mapCalls,
    0,
    "no source should match the hotel-AI brief's topic terms (catalog is food/CPG); zero map calls expected",
  );
}

async function testTopicOverlapGateKeepsFoodSourceOnFoodBrief() {
  const catalog = buildItalianCatalog();
  let mapCalls = 0;
  const firecrawl = buildStubFirecrawl({
    onMap: () => {
      mapCalls += 1;
      return { success: true, links: [], creditsUsed: 1 };
    },
  });
  const plan = buildPlan({
    text: "snack salati Italia GDO Kellanova trend",
    tier_mask: [1, 5],
    source_type_mask: ["trade_press", "cross_reference"],
    language: "both",
  });
  await executePlan(
    { workspaceId: TEAM, plan, catalog, researchRunId: "rr-5" },
    {
      rest: buildStubRest(),
      firecrawl,
      uploadStorage: async () => undefined,
    },
  );
  assert.ok(mapCalls > 0, "at least one food-CPG source must pass overlap gate on a food brief");
}

async function testTopicOverlapGate3CharPrefixMatches() {
  // Reviewer finding #2: 3-char brief terms must match longer domain
  // tags via prefix. "pet" should match "petfood", "oil" should match
  // "oilseed", etc. Uses a synthetic source with a 7-char domain_tag.
  const catalog: SourceCatalogEntry[] = [
    {
      id: "src-pet",
      workspaceId: TEAM,
      url: "https://petindustry.com",
      host: "petindustry.com",
      tier: 5,
      language: "en",
      sourceType: "cross_reference",
      domainTags: ["petfood", "consumer", "retail"],
      crawlPatterns: { crawl_allow: ["/news/.*"] },
      trustScore: 65,
      status: "active",
    },
  ];
  let mapCalls = 0;
  const firecrawl = buildStubFirecrawl({
    onMap: () => {
      mapCalls += 1;
      return { success: true, links: [], creditsUsed: 1 };
    },
  });
  const plan = buildPlan({
    text: "pet market trends 2026",
    tier_mask: [1, 5],
    source_type_mask: ["trade_press", "cross_reference"],
    language: "both",
  });
  await executePlan(
    { workspaceId: TEAM, plan, catalog, researchRunId: "rr-6" },
    {
      rest: buildStubRest(),
      firecrawl,
      uploadStorage: async () => undefined,
    },
  );
  assert.ok(mapCalls > 0, '"pet" (3 chars) must match "petfood" domain tag via prefix');
}

async function testTopicOverlapGateMidStringDoesNotMatch() {
  // Reviewer finding #2 complement: "pet" must NOT match "competitor"
  // since "pet" appears only as a mid-string substring. Otherwise
  // every 3-char brief term would fire on random domain tags.
  const catalog: SourceCatalogEntry[] = [
    {
      id: "src-mid",
      workspaceId: TEAM,
      url: "https://example.com",
      host: "example.com",
      tier: 5,
      language: "en",
      sourceType: "cross_reference",
      domainTags: ["competitor", "market_research"],
      crawlPatterns: { crawl_allow: ["/news/.*"] },
      trustScore: 65,
      status: "active",
    },
  ];
  let mapCalls = 0;
  const firecrawl = buildStubFirecrawl({
    onMap: () => {
      mapCalls += 1;
      return { success: true, links: [], creditsUsed: 1 };
    },
  });
  const plan = buildPlan({
    text: "pet food retail",
    tier_mask: [1, 5],
    source_type_mask: ["trade_press", "cross_reference"],
    language: "both",
  });
  await executePlan(
    { workspaceId: TEAM, plan, catalog, researchRunId: "rr-7" },
    {
      rest: buildStubRest(),
      firecrawl,
      uploadStorage: async () => undefined,
    },
  );
  assert.equal(mapCalls, 0, '"pet" must not match "competitor" (mid-string substring, no prefix/suffix)');
}

describe("research R7 filters", () => {
  it("global deny rejects sitemap URLs", testSitemapUrlsRejectedByGlobalDeny);
  it("URL-path year filter rejects stale articles", testStaleUrlRejectedByPathYearFilter);
  it("zero-keyword-score URLs drop", testZeroKeywordScoreUrlsDropped);
  it("topic-overlap gate rejects food source on hotel brief", testTopicOverlapGateRejectsFoodSourceOnHotelBrief);
  it("topic-overlap gate keeps food source on food brief", testTopicOverlapGateKeepsFoodSourceOnFoodBrief);
  it('topic-overlap gate 3-char prefix match ("pet" -> "petfood")', testTopicOverlapGate3CharPrefixMatches);
  it('topic-overlap gate mid-string non-match ("pet" !~ "competitor")', testTopicOverlapGateMidStringDoesNotMatch);
});
