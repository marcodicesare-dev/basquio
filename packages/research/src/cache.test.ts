import { describe, expect, it } from "vitest";

import { persistScrapeAtomic, type RestConfig } from "./cache";

/**
 * Unit tests for the persistScrapeAtomic RPC caller (B4a). The RPC
 * itself runs in Postgres with BEGIN/ROLLBACK semantics; these tests
 * verify the TypeScript wrapper emits the correct body, reads the
 * correct response shape, and propagates RPC errors (the signal a
 * caller needs to abort the scrape).
 */

function sampleInput() {
  return {
    knowledgeDocumentId: "11111111-1111-1111-1111-111111111111",
    workspaceId: "22222222-2222-2222-2222-222222222222",
    organizationId: "22222222-2222-2222-2222-222222222222",
    filename: "article.md",
    fileType: "md",
    fileSizeBytes: 4096,
    storagePath: "scraped/ws/hash.md",
    contentHash: "f".repeat(64),
    kind: "scraped_article" as const,
    sourceCatalogId: "33333333-3333-3333-3333-333333333333",
    sourceUrl: "https://mark-up.it/snack",
    sourcePublishedAt: new Date("2026-04-20T10:00:00Z"),
    sourceTrustScore: 90,
    scrapeUrl: "https://mark-up.it/snack",
    scrapeUrlHash: "a".repeat(64),
    scrapeTitle: "Snack salati trend 2026",
    scrapeContentMarkdown: "# Stub article\n\nbody",
    scrapeLanguage: "it",
    fetcherEndpoint: "batch-scrape" as const,
    fetcherCreditsUsed: 1,
  };
}

describe("persistScrapeAtomic", () => {
  it("posts to /rest/v1/rpc/ensure_scrape_persisted with the documented body shape", async () => {
    const captured: { url?: string; body?: unknown } = {};
    const stubFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      captured.url = url;
      captured.body = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(
        JSON.stringify([
          {
            knowledge_document_id: "11111111-1111-1111-1111-111111111111",
            cache_row_id: "44444444-4444-4444-4444-444444444444",
            file_ingest_run_id: "55555555-5555-5555-5555-555555555555",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const rest: RestConfig = {
      supabaseUrl: "http://stub",
      serviceKey: "stub-key",
      fetchImpl: stubFetch,
    };
    const result = await persistScrapeAtomic(rest, sampleInput());
    expect(result.knowledgeDocumentId).toBe("11111111-1111-1111-1111-111111111111");
    expect(result.cacheRowId).toBe("44444444-4444-4444-4444-444444444444");
    expect(result.fileIngestRunId).toBe("55555555-5555-5555-5555-555555555555");
    expect(captured.url).toContain("/rest/v1/rpc/ensure_scrape_persisted");
    const body = captured.body as Record<string, unknown>;
    expect(body.p_knowledge_document_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(body.p_scrape_url_hash).toBe("a".repeat(64));
    expect(body.p_fetcher_endpoint).toBe("batch-scrape");
    expect(body.p_source_published_at).toBe("2026-04-20T10:00:00.000Z");
    expect(body.p_fetcher_credits_used).toBe(1);
  });

  it("throws when the RPC returns a Postgres error (rollback signal)", async () => {
    const stubFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          code: "P0001",
          message: "null value in column \"filename\" of relation \"knowledge_documents\" violates not-null constraint",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    const rest: RestConfig = {
      supabaseUrl: "http://stub",
      serviceKey: "stub-key",
      fetchImpl: stubFetch,
    };
    await expect(persistScrapeAtomic(rest, sampleInput())).rejects.toThrow(
      /Supabase REST POST 400/,
    );
  });

  it("throws when the RPC returns an empty result set", async () => {
    const stubFetch: typeof fetch = async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const rest: RestConfig = {
      supabaseUrl: "http://stub",
      serviceKey: "stub-key",
      fetchImpl: stubFetch,
    };
    await expect(persistScrapeAtomic(rest, sampleInput())).rejects.toThrow(
      /no row/,
    );
  });

  it("omits fetcher_credits_used when caller leaves it unspecified", async () => {
    let bodyCaptured: Record<string, unknown> | null = null;
    const stubFetch: typeof fetch = async (_url, init) => {
      bodyCaptured = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify([
          {
            knowledge_document_id: "11111111-1111-1111-1111-111111111111",
            cache_row_id: "44444444-4444-4444-4444-444444444444",
            file_ingest_run_id: "55555555-5555-5555-5555-555555555555",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const rest: RestConfig = {
      supabaseUrl: "http://stub",
      serviceKey: "stub-key",
      fetchImpl: stubFetch,
    };
    const input = sampleInput();
    delete (input as Partial<typeof input>).fetcherCreditsUsed;
    await persistScrapeAtomic(rest, input);
    expect(bodyCaptured).not.toBeNull();
    expect((bodyCaptured as unknown as Record<string, unknown>).p_fetcher_credits_used).toBeNull();
  });
});
