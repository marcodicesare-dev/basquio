import { describe, expect, it } from "vitest";

import {
  createResearchPlan,
  executePlan,
  type FirecrawlBatchScrapeStatus,
  type FirecrawlClient,
  type FirecrawlMapLink,
  type GraphCoverageResult,
  type HaikuCallFn,
  type RestConfig,
  type SourceCatalogEntry,
} from "@basquio/research";

/**
 * Research phase smoke, stubbed end-to-end. No real network, no real
 * Supabase. Runs planner + fetcher in sequence and asserts the wire-up
 * produces the shape downstream code expects. Complements the live
 * smoke harness at scripts/smoke-test-research-layer.ts which is kept
 * out of CI because it costs real credits.
 *
 * Target runtime: under 5 seconds per Marco's Sub-Batch A scope.
 */

const TEAM = "15cc947e-70cb-455a-b0df-d8c34b760d71";

function stubCatalog(): SourceCatalogEntry[] {
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
        crawl_deny: ["/sitemap/.*"],
      },
      trustScore: 90,
      status: "active",
    },
  ];
}

function stubFirecrawl(): FirecrawlClient {
  const batchResponses = new Map<string, FirecrawlBatchScrapeStatus>();
  const links: FirecrawlMapLink[] = [
    { url: "https://mark-up.it/articoli/2026/04/snack-salati-trend", title: "Snack salati trend 2026" },
  ];
  return {
    async map() {
      return { success: true, links, creditsUsed: 1 };
    },
    async scrape(): Promise<never> {
      throw new Error("scrape not expected");
    },
    async batchScrape(req) {
      const id = `b-${req.urls.length}`;
      batchResponses.set(id, {
        success: true,
        status: "completed",
        total: req.urls.length,
        completed: req.urls.length,
        creditsUsed: req.urls.length,
        data: req.urls.map((u) => ({
          markdown: `# Stub article\n\nScraped from ${u}`,
          metadata: {
            sourceURL: u,
            title: "Snack salati trend 2026",
            publishedTime: new Date().toISOString(),
          },
        })),
      });
      return { success: true, id, url: `https://api.firecrawl.dev/v2/batch/scrape/${id}` };
    },
    async batchScrapeStatus(id) {
      return (
        batchResponses.get(id) ?? {
          success: true,
          status: "completed",
          total: 0,
          completed: 0,
          data: [],
        }
      );
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

function stubRest(): RestConfig {
  let id = 0;
  return {
    supabaseUrl: "http://stub",
    serviceKey: "stub-key",
    fetchImpl: (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(url).pathname;
      if (path.endsWith("/rpc/ensure_scrape_persisted") && method === "POST") {
        id += 1;
        return new Response(
          JSON.stringify([
            {
              knowledge_document_id: `k-${id}`,
              cache_row_id: `c-${id}`,
              file_ingest_run_id: `f-${id}`,
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

describe("research phase smoke (stubbed end-to-end)", () => {
  it("planner + fetcher produce firecrawl: EvidenceRefs on empty graph", async () => {
    const stubHaiku: HaikuCallFn = async () =>
      JSON.stringify({
        queries: [
          {
            id: "q1",
            text: "snack salati Italia trend 2026",
            intent: "category_landscape",
            tier_mask: [1],
            source_type_mask: ["trade_press"],
            language: "it",
            freshness_window_days: 30,
            max_results_per_source: 2,
            gap_reason: "no_coverage",
          },
        ],
        rationale: "empty graph",
        estimated_credits: 3,
      });

    const plan = await createResearchPlan(
      {
        workspaceId: TEAM,
        briefSummary: "Kellanova snack salati Q1 2026",
        briefKeywords: ["snack salati", "Kellanova"],
        stakeholders: [],
        scopeName: "Kellanova",
        scopeKind: "client",
        workspaceCatalog: stubCatalog(),
        budget: { maxUrls: 10, maxUsd: 1.0 },
      },
      {
        graphQuery: async (): Promise<GraphCoverageResult> => ({ hits: [] }),
        callHaiku: stubHaiku,
      },
    );
    expect(plan.queries.length).toBe(1);
    expect(plan.existingGraphRefs).toEqual([]);

    const result = await executePlan(
      { workspaceId: TEAM, plan, catalog: stubCatalog(), researchRunId: "rr-smoke" },
      {
        rest: stubRest(),
        firecrawl: stubFirecrawl(),
        uploadStorage: async () => undefined,
      },
    );
    expect(result.evidenceRefs.length).toBeGreaterThan(0);
    for (const ref of result.evidenceRefs) {
      expect(ref.id).toMatch(/^firecrawl:[a-f0-9]{64}$/);
    }
    expect(result.stats.scrapesSucceeded).toBeGreaterThan(0);
  }, 10_000);

  it("planner short-circuits Haiku when graph is fully covered", async () => {
    let haikuCalls = 0;
    const stubHaiku: HaikuCallFn = async () => {
      haikuCalls += 1;
      return "{}";
    };
    const plan = await createResearchPlan(
      {
        workspaceId: TEAM,
        briefSummary: "Covered topic",
        briefKeywords: ["snack"],
        stakeholders: [],
        scopeName: null,
        scopeKind: null,
        workspaceCatalog: stubCatalog(),
        budget: { maxUrls: 10, maxUsd: 1.0 },
      },
      {
        graphQuery: async () => ({
          hits: [
            {
              keyword: "snack",
              chunks: [
                {
                  id: "c1",
                  documentId: "d1",
                  documentKind: "scraped_article",
                  documentSourceUrl: "https://mark-up.it/x",
                  documentSourceTrustScore: 90,
                  documentFileName: "x.md",
                  snippet: "snippet",
                  rawContent: "content",
                  score: 1,
                  dimensions: {},
                },
              ],
              facts: [
                {
                  id: "f1",
                  documentId: "d1",
                  documentFileName: "x.md",
                  subjectEntity: "e1",
                  subjectName: "X",
                  predicate: "is",
                  objectValue: "covered",
                  confidence: 1,
                  validFrom: null,
                  validTo: null,
                  dimensions: {},
                },
              ],
              isStale: false,
              staleReason: null,
            },
          ],
        }),
        callHaiku: stubHaiku,
      },
    );
    expect(plan.queries.length).toBe(0);
    expect(plan.existingGraphRefs.length).toBeGreaterThan(0);
    expect(haikuCalls).toBe(0);
  });
});
