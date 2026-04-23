import { describe, expect, it } from "vitest";

import { executePlan } from "./fetcher";
import type {
  EvidenceRef,
  FirecrawlBatchScrapeStatus,
  FirecrawlClient,
  FirecrawlMapLink,
  RestConfig,
  ResearchPlan,
  SourceCatalogEntry,
} from ".";

/**
 * B4c: the fetcher now seeds the returned evidenceRefs with the
 * planner's existingGraphRefs (id prefix `graph:fact:*` or
 * `graph:chunk:*`) plus deduplicates by id so operators and the
 * intelligence validator see one merged set. These tests exercise the
 * seed + merge path with a stub REST + Firecrawl so nothing hits the
 * network.
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
      crawlPatterns: { crawl_allow: ["/articoli/.*"], crawl_deny: ["/sitemap/.*"] },
      trustScore: 90,
      status: "active",
    },
  ];
}

function graphRef(id: string, summary: string): EvidenceRef {
  return {
    id,
    sourceFileId: "doc-1",
    fileName: "prior-scrape.md",
    fileRole: "tier1-trade_press",
    sheet: "mark-up.it",
    metric: "fact",
    summary,
    confidence: 0.9,
    sourceLocation: "graph",
    rawValue: null,
    derivedTable: null,
    dimensions: { language: "it" },
  };
}

function stubFirecrawl(): FirecrawlClient {
  const batchResponses = new Map<string, FirecrawlBatchScrapeStatus>();
  const links: FirecrawlMapLink[] = [
    {
      url: "https://mark-up.it/articoli/2026/04/snack-salati-trend",
      title: "Snack salati trend 2026",
    },
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
          markdown: `# Snack salati\n\nStub article scraped from ${u}.`,
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
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
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

function buildPlan(overrides: Partial<ResearchPlan> = {}): ResearchPlan {
  return {
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
    existingGraphRefs: [],
    rationale: "stub",
    estimated_credits: 3,
    graph_coverage_score: 0,
    stale_keywords: [],
    ...overrides,
  };
}

describe("fetcher graph-seed + merge (B4c)", () => {
  it("seeds the returned evidenceRefs with the plan's existingGraphRefs plus firecrawl refs", async () => {
    const plan = buildPlan({
      existingGraphRefs: [
        graphRef("graph:fact:f1", "Italian snack sales up 4.2% Q1 2026"),
        graphRef("graph:chunk:c1", "Recent article on private-label penetration"),
      ],
    });
    const result = await executePlan(
      { workspaceId: TEAM, plan, catalog: stubCatalog(), researchRunId: "rr-graph-seed" },
      {
        rest: stubRest(),
        firecrawl: stubFirecrawl(),
        uploadStorage: async () => undefined,
      },
    );
    const ids = result.evidenceRefs.map((r) => r.id);
    expect(ids).toContain("graph:fact:f1");
    expect(ids).toContain("graph:chunk:c1");
    const firecrawlIds = ids.filter((id) => id.startsWith("firecrawl:"));
    expect(firecrawlIds.length).toBeGreaterThan(0);
    expect(result.stats.evidenceRefsFromGraph).toBe(2);
    expect(result.stats.evidenceRefsFromFirecrawl).toBe(firecrawlIds.length);
  });

  it("drops a duplicate id when the planner seeds it twice", async () => {
    const plan = buildPlan({
      existingGraphRefs: [
        graphRef("graph:fact:dup", "Once"),
        graphRef("graph:fact:dup", "Twice (same id)"),
      ],
    });
    const result = await executePlan(
      { workspaceId: TEAM, plan, catalog: stubCatalog(), researchRunId: "rr-dup" },
      {
        rest: stubRest(),
        firecrawl: stubFirecrawl(),
        uploadStorage: async () => undefined,
      },
    );
    const dupCount = result.evidenceRefs.filter((r) => r.id === "graph:fact:dup").length;
    expect(dupCount).toBe(1);
    expect(result.stats.evidenceRefsFromGraph).toBe(1);
  });

  it("returns graph-only evidence when queries is empty (fully-covered graph)", async () => {
    const plan = buildPlan({
      queries: [],
      existingGraphRefs: [graphRef("graph:fact:solo", "Covered topic fact")],
    });
    const result = await executePlan(
      { workspaceId: TEAM, plan, catalog: stubCatalog(), researchRunId: "rr-graph-only" },
      {
        rest: stubRest(),
        firecrawl: stubFirecrawl(),
        uploadStorage: async () => undefined,
      },
    );
    expect(result.evidenceRefs.map((r) => r.id)).toEqual(["graph:fact:solo"]);
    expect(result.stats.evidenceRefsFromGraph).toBe(1);
    expect(result.stats.evidenceRefsFromFirecrawl).toBe(0);
    expect(result.stats.queriesAttempted).toBe(0);
  });
});
