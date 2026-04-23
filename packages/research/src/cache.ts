/**
 * Scrape-cost dedup cache. Reads and writes `source_catalog_scrapes`
 * with the 24-hour TTL contract from spec §3.2.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §5.3:
 * a URL already scraped in the last 24h does NOT hit Firecrawl or Fiber
 * again. Instead, the cache row's linked `knowledge_documents` row is
 * resolved and its content is used to rebuild the EvidenceRef.
 *
 * Talks to Supabase via plain REST (mirrors the pattern in
 * packages/workflows/src/supabase.ts) so packages/research stays free
 * of an @supabase/supabase-js runtime dependency. Callers pass the
 * service key; tests inject a stub fetch so nothing hits the network.
 */

import type { SourceCatalogScrape } from "./evidence-adapter";

export type RestConfig = {
  supabaseUrl: string;
  serviceKey: string;
  /**
   * Optional fetch override. Tests use this to stub Supabase REST
   * calls without monkey-patching `globalThis.fetch`. Production calls
   * default to `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
};

export type CacheHit = {
  scrape: SourceCatalogScrape;
  sourceId: string;
  knowledgeDocumentId: string | null;
  cacheRowId: string;
};

type ScrapeCacheRowRest = {
  id: string;
  source_id: string;
  workspace_id: string;
  url: string;
  url_hash: string;
  content_hash: string;
  title: string | null;
  published_at: string | null;
  content_markdown: string;
  language: string | null;
  metadata: Record<string, unknown>;
  fetcher_endpoint: string;
  fetched_at: string;
  expires_at: string;
};

const SELECT_COLUMNS =
  "id,source_id,workspace_id,url,url_hash,content_hash,title,published_at,content_markdown,language,metadata,fetcher_endpoint,fetched_at,expires_at";

/**
 * Look up a fresh cache row by workspace + url_hash. "Fresh" means
 * `expires_at > now()` evaluated at the DB so the 24h TTL is
 * authoritative regardless of client clock drift.
 */
export async function lookupCacheByUrlHash(
  config: RestConfig,
  args: { workspaceId: string; urlHash: string; now: Date },
): Promise<CacheHit | null> {
  const url = new URL(`/rest/v1/source_catalog_scrapes`, config.supabaseUrl);
  url.searchParams.set("select", SELECT_COLUMNS);
  url.searchParams.set("workspace_id", `eq.${args.workspaceId}`);
  url.searchParams.set("url_hash", `eq.${args.urlHash}`);
  url.searchParams.set("expires_at", `gt.${args.now.toISOString()}`);
  url.searchParams.set("limit", "1");

  const rows = await restGet<ScrapeCacheRowRest[]>(url, config);
  const row = rows[0];
  if (!row) return null;
  return rowToHit(row);
}

/**
 * Look up a fresh cache row by content_hash across any source in the
 * workspace. Catches the "same article republished on a second
 * domain" case without refetching.
 */
export async function lookupCacheByContentHash(
  config: RestConfig,
  args: { workspaceId: string; contentHash: string; now: Date },
): Promise<CacheHit | null> {
  const url = new URL(`/rest/v1/source_catalog_scrapes`, config.supabaseUrl);
  url.searchParams.set("select", SELECT_COLUMNS);
  url.searchParams.set("workspace_id", `eq.${args.workspaceId}`);
  url.searchParams.set("content_hash", `eq.${args.contentHash}`);
  url.searchParams.set("expires_at", `gt.${args.now.toISOString()}`);
  url.searchParams.set("limit", "1");

  const rows = await restGet<ScrapeCacheRowRest[]>(url, config);
  const row = rows[0];
  if (!row) return null;
  return rowToHit(row);
}

export type ScrapeCacheInsert = {
  sourceId: string;
  workspaceId: string;
  url: string;
  urlHash: string;
  contentHash: string;
  title: string | null;
  publishedAt: Date | null;
  contentMarkdown: string;
  contentTokens?: number;
  language: string | null;
  fetcherEndpoint: "scrape" | "crawl" | "batch-scrape" | "map" | "search" | "fiber";
  fetcherCreditsUsed?: number;
  knowledgeDocumentId: string | null;
};

/**
 * Write a scrape into the cache. `expires_at` falls to the table
 * default `now() + interval '24 hours'`. Upsert on `url_hash` so a
 * concurrent write loses the race cleanly rather than raising a
 * unique-violation the caller must catch.
 */
export async function insertScrapeCacheRow(
  config: RestConfig,
  input: ScrapeCacheInsert,
): Promise<{ id: string }> {
  const metadata: Record<string, unknown> = {};
  if (input.knowledgeDocumentId) {
    metadata.knowledge_document_id = input.knowledgeDocumentId;
  }

  const row = {
    source_id: input.sourceId,
    workspace_id: input.workspaceId,
    url: input.url,
    url_hash: input.urlHash,
    content_hash: input.contentHash,
    title: input.title,
    published_at: input.publishedAt?.toISOString() ?? null,
    content_markdown: input.contentMarkdown,
    content_tokens: input.contentTokens ?? null,
    language: input.language,
    metadata,
    fetcher_endpoint: input.fetcherEndpoint,
    fetcher_credits_used: input.fetcherCreditsUsed ?? null,
  };

  const url = new URL(`/rest/v1/source_catalog_scrapes`, config.supabaseUrl);
  url.searchParams.set("on_conflict", "url_hash");
  url.searchParams.set("select", "id");

  const rows = await restPost<Array<{ id: string }>>(url, [row], config, {
    Prefer: "resolution=merge-duplicates,return=representation",
  });
  const inserted = rows[0];
  if (!inserted?.id) throw new Error("insertScrapeCacheRow: no id returned");
  return { id: inserted.id };
}

function rowToHit(row: ScrapeCacheRowRest): CacheHit {
  return {
    cacheRowId: row.id,
    sourceId: row.source_id,
    knowledgeDocumentId:
      typeof row.metadata?.knowledge_document_id === "string"
        ? (row.metadata.knowledge_document_id as string)
        : null,
    scrape: {
      url: row.url,
      urlHash: row.url_hash,
      contentHash: row.content_hash,
      title: row.title,
      publishedAt: row.published_at ? new Date(row.published_at) : null,
      contentMarkdown: row.content_markdown,
      language: row.language,
      fetchedAt: new Date(row.fetched_at),
    },
  };
}

async function restGet<T>(url: URL, config: RestConfig): Promise<T> {
  const response = await (config.fetchImpl ?? fetch)(url.toString(), {
    method: "GET",
    headers: buildHeaders(config.serviceKey, { Accept: "application/json" }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase REST GET ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
}

async function restPost<T>(
  url: URL,
  body: unknown,
  config: RestConfig,
  extra: Record<string, string> = {},
): Promise<T> {
  const response = await (config.fetchImpl ?? fetch)(url.toString(), {
    method: "POST",
    headers: buildHeaders(config.serviceKey, {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...extra,
    }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase REST POST ${response.status}: ${text}`);
  }
  if (response.status === 204) return [] as unknown as T;
  return (await response.json()) as T;
}

function buildHeaders(serviceKey: string, extra: Record<string, string>): Headers {
  const headers = new Headers(extra);
  headers.set("apikey", serviceKey);
  if (serviceKey.split(".").length === 3 && !serviceKey.startsWith("sb_secret_")) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }
  return headers;
}
