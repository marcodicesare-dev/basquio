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
import { createSystemTemplateProfile } from "@basquio/template-engine";

import { buildBasquioSystemPrompt } from "../../packages/workflows/src/system-prompt";

/**
 * Pipeline integration smoke: the research phase output must merge into
 * the Sonnet/Opus author system prompt exactly where generate-deck.ts
 * (lines 1267-1281) wires it. This test exercises the boundary between
 * @basquio/research and packages/workflows/src/system-prompt so a shape
 * drift in EvidenceRef or ExternalEvidenceSummary fails loudly in
 * pre-commit instead of surfacing as a silently-empty evidence block in
 * production.
 *
 * It intentionally does NOT boot the full generateDeckRun pipeline.
 * That would require Anthropic + Supabase + container_upload machinery
 * none of which add signal for the wire-up we care about here.
 * Target runtime: under 5 seconds.
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
          markdown: `# Stub article\n\nScraped from ${u}. Italian snack salati market grew 4.2 percent in Q1 2026.`,
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
      if (path.endsWith("/source_catalog_scrapes") && method === "POST") {
        id += 1;
        return new Response(JSON.stringify([{ id: `stub-${id}` }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  };
}

describe("pipeline integration smoke (research -> author system prompt)", () => {
  it("research phase evidenceRefs flow into the <external_evidence> dynamic block, not the static block", async () => {
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
    const fetchResult = await executePlan(
      { workspaceId: TEAM, plan, catalog: stubCatalog(), researchRunId: "rr-pipeline-smoke" },
      {
        rest: stubRest(),
        firecrawl: stubFirecrawl(),
        uploadStorage: async () => undefined,
      },
    );
    expect(fetchResult.evidenceRefs.length).toBeGreaterThan(0);

    // Mirror the exact transformation from generate-deck.ts:1271-1280.
    const externalEvidence = fetchResult.evidenceRefs.map((ref) => ({
      id: ref.id,
      fileName: ref.fileName,
      summary: ref.summary,
      confidence: ref.confidence,
      sourceLocation: ref.sourceLocation,
    }));

    const blocks = await buildBasquioSystemPrompt({
      templateProfile: createSystemTemplateProfile(),
      briefLanguageHint: "Italian",
      authorModel: "claude-sonnet-4-6",
      externalEvidence,
    });

    expect(blocks).toHaveLength(2);
    const [staticBlock, dynamicBlock] = blocks;

    // Static block keeps its ephemeral cache breakpoint so every run
    // hits the prompt cache; the dynamic block must NOT be cached.
    expect(staticBlock.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(dynamicBlock.cache_control).toBeUndefined();

    // The evidence block must appear in the dynamic portion so the
    // static cache breakpoint survives across runs. If it leaks into
    // the static block, every run invalidates the cache.
    expect(dynamicBlock.text).toContain("<external_evidence>");
    expect(dynamicBlock.text).toContain("</external_evidence>");
    expect(staticBlock.text).not.toContain("<external_evidence>");

    // Each firecrawl: id must survive the adapter -> prompt boundary
    // verbatim so Claude's citations land on the validator's expected
    // id format.
    for (const ref of externalEvidence) {
      expect(ref.id).toMatch(/^firecrawl:[a-f0-9]{64}$/);
      expect(dynamicBlock.text).toContain(`id=[${ref.id}]`);
    }

    // The NIQ hardening knowledge packs (22406d5) must remain in the
    // static block regardless of external evidence presence.
    expect(staticBlock.text).toContain("niq-promo-storytelling-playbook");
    expect(staticBlock.text).toContain("niq-decimal-policy");
  }, 15_000);

  it("omits the <external_evidence> block when research produced zero refs", async () => {
    const blocks = await buildBasquioSystemPrompt({
      templateProfile: createSystemTemplateProfile(),
      briefLanguageHint: "English",
      authorModel: "claude-sonnet-4-6",
      externalEvidence: undefined,
    });
    expect(blocks).toHaveLength(2);
    const [staticBlock, dynamicBlock] = blocks;
    expect(staticBlock.text).not.toContain("<external_evidence>");
    expect(dynamicBlock.text).not.toContain("<external_evidence>");
    // Static block still carries the NIQ packs when the prompt is
    // invoked without external evidence.
    expect(staticBlock.text).toContain("niq-promo-storytelling-playbook");
    expect(staticBlock.text).toContain("niq-decimal-policy");
  });

  it("Haiku report-only branch ignores externalEvidence by design", async () => {
    const blocks = await buildBasquioSystemPrompt({
      templateProfile: createSystemTemplateProfile(),
      briefLanguageHint: "Italian",
      authorModel: "claude-haiku-4-5",
      externalEvidence: [
        {
          id: "firecrawl:abc",
          fileName: "snack.md",
          summary: "snack salati trend",
          confidence: 0.8,
          sourceLocation: "https://mark-up.it/x",
        },
      ],
    });
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.text).not.toContain("<external_evidence>");
      expect(block.text).not.toContain("firecrawl:abc");
    }
  });
});
