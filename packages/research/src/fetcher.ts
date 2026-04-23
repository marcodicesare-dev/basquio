/**
 * Research fetcher: executes a ResearchPlan against Firecrawl and Fiber,
 * dual-writes each scrape into source_catalog_scrapes AND knowledge_
 * documents, enqueues async extraction via file_ingest_runs, and
 * returns the per-run EvidenceRef[] that merges into the deck
 * pipeline's analyticsResult.evidenceRefs.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md
 * §5.3 + §5.7.
 *
 * Design posture:
 * - Non-fatal failure. If Firecrawl or Fiber returns a non-retryable
 *   error on one query or one URL, log and proceed. The deck still
 *   ships with whatever evidence was collected plus whatever came
 *   from the graph coverage step.
 * - Dependency injection. Every external hop (Firecrawl, Fiber, REST
 *   to Supabase, Storage upload) is a typed function parameter so
 *   tests stub them without monkey-patching globalThis.
 * - Budget-gated. Every Firecrawl/Fiber call checks the budget
 *   accumulator first. When a cap trips, the fetcher halts gracefully
 *   and marks budget_exceeded=true in telemetry.
 * - Graceful-degradation contract from spec §5.7: if the FIBER_API_KEY
 *   or FIRECRAWL_API_KEY is unset, the caller skips that client rather
 *   than killing the whole phase. The fetcher inspects `deps.firecrawl`
 *   and `deps.fiber` as optionals.
 */

import { randomUUID } from "node:crypto";

import {
  DAY_4_FIRECRAWL_USD_CAP,
  DAY_4_SMOKE_BUDGET,
  FIRECRAWL_USD_PER_CREDIT,
  checkBudget,
  creditsToUsd,
  newCostAccumulator,
  recordCost,
  type BudgetCapReason,
  type CostAccumulator,
} from "./budget";
import { hashContent, hashUrl } from "./dedupe";
import {
  scrapeToEvidenceRef,
  type SourceCatalogScrape,
} from "./evidence-adapter";
import {
  insertScrapeCacheRow,
  lookupCacheByContentHash,
  lookupCacheByUrlHash,
  type RestConfig,
} from "./cache";
import type {
  EvidenceRef,
  ResearchBudget,
  ResearchPlan,
  ResearchQuery,
  SourceCatalogEntry,
} from "./types";
import type {
  FirecrawlClient,
  FirecrawlMapLink,
  FirecrawlScrapeData,
} from "./firecrawl-client";
import type { FiberClient } from "./fiber-client";

// ── Inputs ──────────────────────────────────────────────────────────

export type FetcherInput = {
  workspaceId: string;
  plan: ResearchPlan;
  catalog: SourceCatalogEntry[];
  researchRunId: string;
};

export type FetcherDeps = {
  /** Supabase REST config for knowledge_documents + scrape cache + file_ingest_runs writes. */
  rest: RestConfig;
  /** Firecrawl client. Optional per spec §5.7 graceful degradation; if absent, non-linkedin sources are skipped. */
  firecrawl?: FirecrawlClient;
  /** Fiber client. Optional per spec §5.7; if absent, linkedin_fiber sources are skipped. */
  fiber?: FiberClient;
  /** Storage upload function. Signature matches the pattern in packages/workflows/src/supabase.ts uploadToStorage. */
  uploadStorage: (args: {
    bucket: string;
    storagePath: string;
    body: Buffer;
    contentType: string;
    upsert?: boolean;
  }) => Promise<void>;
  /** Current time supplier. Tests inject a deterministic clock. */
  now?: () => Date;
  /** Observability: fires at each stage of the fetcher for telemetry. */
  onStage?: (stage: FetcherStage, payload: Record<string, unknown>) => void;
  /** Budget override. Defaults to Day 4 smoke envelope. */
  budget?: ResearchBudget;
  firecrawlCap?: number;
  firecrawlUsdPerCredit?: number;
  /** Per-query timeout. Defaults to 180 seconds per spec §5.3. */
  perQueryTimeoutMs?: number;
  /** Batch-scrape poll interval. Defaults to 3 seconds. */
  pollIntervalMs?: number;
};

export type FetcherStage =
  | "query_start"
  | "map_filtered"
  | "cache_hit"
  | "batch_kickoff"
  | "batch_complete"
  | "scrape_persisted"
  | "fiber_profile"
  | "query_end"
  | "budget_capped"
  | "done";

// ── Output ─────────────────────────────────────────────────────────

export type FetcherResult = {
  evidenceRefs: EvidenceRef[];
  stats: FetcherStats;
};

export type FetcherStats = {
  queriesAttempted: number;
  queriesCompleted: number;
  queriesFailed: number;
  scrapesAttempted: number;
  scrapesCacheHit: number;
  scrapesSucceeded: number;
  scrapesFailed: number;
  firecrawlUsd: number;
  fiberUsd: number;
  urlsFetched: number;
  budgetExceeded: boolean;
  budgetCapReason: BudgetCapReason | null;
};

// ── Main entry point ───────────────────────────────────────────────

export async function executePlan(
  input: FetcherInput,
  deps: FetcherDeps,
  signal?: AbortSignal,
): Promise<FetcherResult> {
  const budget = deps.budget ?? DAY_4_SMOKE_BUDGET;
  const firecrawlCap = deps.firecrawlCap ?? DAY_4_FIRECRAWL_USD_CAP;
  const usdPerCredit = deps.firecrawlUsdPerCredit ?? FIRECRAWL_USD_PER_CREDIT;
  const now = deps.now ?? (() => new Date());
  const perQueryTimeoutMs = deps.perQueryTimeoutMs ?? 180_000;

  const acc: CostAccumulator = newCostAccumulator();
  const stats: FetcherStats = {
    queriesAttempted: 0,
    queriesCompleted: 0,
    queriesFailed: 0,
    scrapesAttempted: 0,
    scrapesCacheHit: 0,
    scrapesSucceeded: 0,
    scrapesFailed: 0,
    firecrawlUsd: 0,
    fiberUsd: 0,
    urlsFetched: 0,
    budgetExceeded: false,
    budgetCapReason: null,
  };
  const allRefs: EvidenceRef[] = [];

  for (const query of input.plan.queries) {
    if (signal?.aborted) break;
    if (stats.budgetExceeded) break;

    stats.queriesAttempted += 1;
    deps.onStage?.("query_start", { queryId: query.id, text: query.text });

    try {
      const perQueryCtrl = new AbortController();
      const perQueryTimer = setTimeout(() => perQueryCtrl.abort(), perQueryTimeoutMs);
      const linkedQueryCtrl = linkAbortSignals(signal, perQueryCtrl.signal);
      try {
        const refs = await executeOneQuery(
          query,
          input,
          {
            ...deps,
            budget,
            firecrawlCap,
            firecrawlUsdPerCredit: usdPerCredit,
            pollIntervalMs: deps.pollIntervalMs ?? 3_000,
          },
          acc,
          stats,
          now,
          linkedQueryCtrl.signal,
        );
        allRefs.push(...refs);
        stats.queriesCompleted += 1;
      } finally {
        clearTimeout(perQueryTimer);
      }
    } catch (error) {
      stats.queriesFailed += 1;
      deps.onStage?.("query_end", {
        queryId: query.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    deps.onStage?.("query_end", {
      queryId: query.id,
      urls: stats.urlsFetched,
      cost: stats.firecrawlUsd + stats.fiberUsd,
    });
  }

  stats.firecrawlUsd = Number(acc.firecrawlUsd.toFixed(4));
  stats.fiberUsd = Number(acc.fiberUsd.toFixed(4));
  stats.urlsFetched = acc.urlsFetched;

  deps.onStage?.("done", {
    queriesCompleted: stats.queriesCompleted,
    urlsFetched: stats.urlsFetched,
    refCount: allRefs.length,
  });

  return { evidenceRefs: allRefs, stats };
}

// ── Per-query execution ─────────────────────────────────────────────

async function executeOneQuery(
  query: ResearchQuery,
  input: FetcherInput,
  deps: FetcherDeps & {
    budget: ResearchBudget;
    firecrawlCap: number;
    firecrawlUsdPerCredit: number;
    pollIntervalMs: number;
  },
  acc: CostAccumulator,
  stats: FetcherStats,
  now: () => Date,
  signal: AbortSignal,
): Promise<EvidenceRef[]> {
  const eligibleSources = input.catalog.filter((row) =>
    isSourceEligible(row, query, deps.firecrawl !== undefined, deps.fiber !== undefined),
  );
  if (eligibleSources.length === 0) return [];

  // Partition by client type. LinkedIn sources always go to Fiber,
  // everything else goes to Firecrawl (spec §5.7).
  const firecrawlSources = eligibleSources.filter((s) => s.sourceType !== "linkedin_fiber");
  const fiberSources = eligibleSources.filter((s) => s.sourceType === "linkedin_fiber");

  const refs: EvidenceRef[] = [];

  if (firecrawlSources.length > 0 && deps.firecrawl) {
    const firecrawlRefs = await runFirecrawlBranch(
      query,
      input,
      firecrawlSources,
      deps,
      acc,
      stats,
      now,
      signal,
    );
    refs.push(...firecrawlRefs);
  }

  if (fiberSources.length > 0 && deps.fiber) {
    // Fiber per-query Day 4 scope is a placeholder: the seed catalog
    // ships no linkedin_fiber rows yet. When those land, this branch
    // will fire people-search or profile-posts against them. For now
    // it is a no-op so the fetcher stays forward-compatible.
    deps.onStage?.("fiber_profile", {
      queryId: query.id,
      note: "no linkedin_fiber catalog rows seeded yet; Day 4 stub",
    });
  }

  return refs;
}

// ── Firecrawl branch ───────────────────────────────────────────────

async function runFirecrawlBranch(
  query: ResearchQuery,
  input: FetcherInput,
  sources: SourceCatalogEntry[],
  deps: FetcherDeps & {
    budget: ResearchBudget;
    firecrawlCap: number;
    firecrawlUsdPerCredit: number;
    pollIntervalMs: number;
  },
  acc: CostAccumulator,
  stats: FetcherStats,
  now: () => Date,
  signal: AbortSignal,
): Promise<EvidenceRef[]> {
  if (!deps.firecrawl) return [];

  // Step 1: /v2/map per source in parallel.
  const mapResults = await Promise.all(
    sources.map(async (source) => {
      // Budget check per map call. 1 credit per call.
      const verdict = checkBudget({
        accumulator: acc,
        proposedUrls: 0,
        proposedFirecrawlUsd: creditsToUsd(1, deps.firecrawlUsdPerCredit),
        proposedFiberUsd: 0,
        budget: deps.budget,
        firecrawlCap: deps.firecrawlCap,
      });
      if (verdict.status !== "within_budget") {
        stats.budgetExceeded = true;
        stats.budgetCapReason = verdict.reason;
        deps.onStage?.("budget_capped", { stage: "map", source: source.host, reason: verdict.reason });
        return { source, links: [] as FirecrawlMapLink[] };
      }

      try {
        const mapped = await deps.firecrawl!.map({
          url: source.url,
          search: query.text,
          sitemap: "include",
          includeSubdomains: false,
          ignoreQueryParameters: true,
          limit: getSourceCrawlLimit(source),
          location: { country: "IT", languages: [source.language] },
        });
        recordCost(acc, { firecrawlUsd: creditsToUsd(mapped.creditsUsed ?? 1, deps.firecrawlUsdPerCredit) });
        return { source, links: mapped.links };
      } catch (error) {
        deps.onStage?.("query_end", {
          queryId: query.id,
          stage: "map",
          source: source.host,
          error: error instanceof Error ? error.message : String(error),
        });
        return { source, links: [] as FirecrawlMapLink[] };
      }
    }),
  );

  // Step 2: filter by per-source crawl patterns and keyword score.
  const candidateUrls: Array<{ source: SourceCatalogEntry; link: FirecrawlMapLink }> = [];
  for (const { source, links } of mapResults) {
    const filtered = filterLinksForSource(links, source);
    const ranked = rankLinksByKeyword(filtered, query.text).slice(0, query.max_results_per_source);
    for (const link of ranked) candidateUrls.push({ source, link });
  }
  deps.onStage?.("map_filtered", { queryId: query.id, count: candidateUrls.length });

  // Step 3: dedupe across sources by url_hash.
  const seenUrlHashes = new Set<string>();
  const deduped: typeof candidateUrls = [];
  for (const candidate of candidateUrls) {
    const hash = safeHashUrl(candidate.link.url);
    if (!hash) continue;
    if (seenUrlHashes.has(hash)) continue;
    seenUrlHashes.add(hash);
    deduped.push(candidate);
  }

  // Step 4: for each candidate, check the cache. Cached URLs bypass
  // the scrape entirely and produce their ref from the cache row.
  const toScrape: Array<{ source: SourceCatalogEntry; url: string; urlHash: string }> = [];
  const refs: EvidenceRef[] = [];
  for (const candidate of deduped) {
    if (signal.aborted || stats.budgetExceeded) break;
    const urlHash = safeHashUrl(candidate.link.url)!;
    const cacheHit = await safeCacheLookup(deps.rest, {
      workspaceId: input.workspaceId,
      urlHash,
      now: now(),
    });
    if (cacheHit) {
      stats.scrapesCacheHit += 1;
      deps.onStage?.("cache_hit", { queryId: query.id, url: candidate.link.url, cacheRowId: cacheHit.cacheRowId });
      try {
        refs.push(scrapeToEvidenceRef(cacheHit.scrape, candidate.source));
      } catch (error) {
        deps.onStage?.("scrape_persisted", {
          url: candidate.link.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }
    toScrape.push({ source: candidate.source, url: candidate.link.url, urlHash });
  }

  if (toScrape.length === 0 || signal.aborted || stats.budgetExceeded) {
    return refs;
  }

  // Step 5: budget check before batch-scrape.
  const scrapeVerdict = checkBudget({
    accumulator: acc,
    proposedUrls: toScrape.length,
    proposedFirecrawlUsd: creditsToUsd(toScrape.length, deps.firecrawlUsdPerCredit),
    proposedFiberUsd: 0,
    budget: deps.budget,
    firecrawlCap: deps.firecrawlCap,
  });
  if (scrapeVerdict.status !== "within_budget") {
    // Trim toScrape to the remaining URL headroom if any.
    const remaining = Math.max(0, deps.budget.maxUrls - acc.urlsFetched);
    if (remaining === 0) {
      stats.budgetExceeded = true;
      stats.budgetCapReason = scrapeVerdict.reason;
      deps.onStage?.("budget_capped", { stage: "batch_scrape", reason: scrapeVerdict.reason });
      return refs;
    }
    toScrape.length = Math.min(toScrape.length, remaining);
  }

  // Step 6: batch-scrape + poll.
  stats.scrapesAttempted += toScrape.length;
  deps.onStage?.("batch_kickoff", { queryId: query.id, count: toScrape.length });

  const kickoff = await deps.firecrawl!.batchScrape({
    urls: toScrape.map((t) => t.url),
    formats: ["markdown"],
    onlyMainContent: true,
    waitFor: 0,
    blockAds: true,
    location: { country: "IT", languages: [firstNonEnglishLanguage(toScrape)] },
    maxConcurrency: 5,
    ignoreInvalidURLs: true,
  });

  const completed = await pollBatchScrape(deps, kickoff.id, deps.pollIntervalMs, signal);
  deps.onStage?.("batch_complete", {
    queryId: query.id,
    status: completed.status,
    total: completed.total,
    creditsUsed: completed.creditsUsed,
  });

  recordCost(acc, {
    firecrawlUsd: creditsToUsd(completed.creditsUsed ?? toScrape.length, deps.firecrawlUsdPerCredit),
    urlsFetched: toScrape.length,
  });

  // Step 7: per-result dual-write. Firecrawl v2 batch-scrape returns
  // `data[i]` as the FirecrawlScrapeData shape directly (markdown,
  // metadata, links, etc.) with the source URL at `metadata.sourceURL`
  // or `metadata.url`. Match against `toScrape` entries by canonical
  // url_hash so trailing-slash and minor canonicalization differences
  // from Firecrawl do not break the join.
  const results = completed.data ?? [];
  for (const result of results) {
    if (signal.aborted) break;
    const resultUrl = firstDefinedString(
      typeof result.metadata?.sourceURL === "string" ? result.metadata.sourceURL : null,
      typeof result.metadata?.url === "string" ? (result.metadata.url as string) : null,
    );
    const resultHash = resultUrl ? safeHashUrl(resultUrl) : null;
    const plan = resultHash
      ? toScrape.find((t) => t.urlHash === resultHash)
      : null;
    if (!plan) {
      stats.scrapesFailed += 1;
      continue;
    }
    if (result.error || !result.markdown) {
      stats.scrapesFailed += 1;
      continue;
    }
    try {
      const ref = await persistScrape({
        query,
        source: plan.source,
        url: plan.url,
        urlHash: plan.urlHash,
        scrapeData: result,
        input,
        deps,
        now,
      });
      if (ref) {
        refs.push(ref);
        stats.scrapesSucceeded += 1;
      } else {
        stats.scrapesFailed += 1;
      }
    } catch (error) {
      stats.scrapesFailed += 1;
      deps.onStage?.("scrape_persisted", {
        url: plan.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return refs;
}

// ── Persist one scrape: dual-write + enqueue extraction ─────────────

async function persistScrape(args: {
  query: ResearchQuery;
  source: SourceCatalogEntry;
  url: string;
  urlHash: string;
  scrapeData: FirecrawlScrapeData;
  input: FetcherInput;
  deps: FetcherDeps & { firecrawlUsdPerCredit: number };
  now: () => Date;
}): Promise<EvidenceRef | null> {
  const { query, source, url, urlHash, scrapeData, input, deps, now } = args;
  const markdown = scrapeData.markdown ?? "";
  const contentHash = hashContent(markdown);

  // Step 7a: content-hash cache check (same article on a different domain).
  const contentHit = await safeContentCacheLookup(deps.rest, {
    workspaceId: input.workspaceId,
    contentHash,
    now: now(),
  });
  if (contentHit?.knowledgeDocumentId) {
    // Reuse the existing document + build an EvidenceRef pointing at
    // the pre-existing cache row (no new writes).
    return scrapeToEvidenceRef(contentHit.scrape, source);
  }

  // Step 7b: extract title + published_at from metadata where possible.
  const title = stringFromMetadata(scrapeData.metadata, ["title", "ogTitle", "og:title"]) ?? null;
  const publishedAtStr = stringFromMetadata(scrapeData.metadata, [
    "publishedTime",
    "article:published_time",
    "datePublished",
  ]);
  const publishedAt = publishedAtStr ? safeDate(publishedAtStr) : null;

  // Step 7c: upload markdown to storage. Uses existing knowledge-base
  // bucket with a scraped/ prefix path so Day 4 does not need a new
  // bucket migration.
  const storagePath = `scraped/${input.workspaceId}/${urlHash}.md`;
  await deps.uploadStorage({
    bucket: "knowledge-base",
    storagePath,
    body: Buffer.from(markdown, "utf-8"),
    contentType: "text/markdown; charset=utf-8",
    upsert: true,
  });

  // Step 7d: write knowledge_documents row (kind='scraped_article').
  const knowledgeDocId = randomUUID();
  await insertKnowledgeDocument(deps.rest, {
    id: knowledgeDocId,
    workspaceId: input.workspaceId,
    filename: title ?? url,
    fileType: "md",
    storagePath,
    fileSizeBytes: Buffer.byteLength(markdown, "utf-8"),
    contentHash,
    kind: "scraped_article",
    sourceCatalogId: source.id,
    sourceUrl: url,
    sourcePublishedAt: publishedAt,
    sourceTrustScore: source.trustScore,
  });

  // Step 7e: write source_catalog_scrapes row linked to the knowledge doc.
  const cacheRow = await insertScrapeCacheRow(deps.rest, {
    sourceId: source.id,
    workspaceId: input.workspaceId,
    url,
    urlHash,
    contentHash,
    title,
    publishedAt,
    contentMarkdown: markdown,
    language: source.language,
    fetcherEndpoint: "batch-scrape",
    fetcherCreditsUsed: 1,
    knowledgeDocumentId: knowledgeDocId,
  });

  // Step 7f: enqueue async extraction. The worker's file_ingest_runs
  // consumer will pick this up once shipped; until then the row sits
  // queued safely and the scrape evidence is still usable via the
  // markdown stored on knowledge_documents.
  await enqueueFileIngestRun(deps.rest, {
    documentId: knowledgeDocId,
    workspaceId: input.workspaceId,
  });

  deps.onStage?.("scrape_persisted", {
    url,
    urlHash,
    contentHash,
    knowledgeDocumentId: knowledgeDocId,
    cacheRowId: cacheRow.id,
    queryId: query.id,
    source: source.host,
  });

  // Step 7g: materialize EvidenceRef.
  const scrape: SourceCatalogScrape = {
    url,
    urlHash,
    contentHash,
    title,
    publishedAt,
    contentMarkdown: markdown,
    language: source.language,
    fetchedAt: now(),
  };
  return scrapeToEvidenceRef(scrape, source);
}

// ── Supabase REST helpers (local to the fetcher) ────────────────────

async function insertKnowledgeDocument(
  rest: RestConfig,
  input: {
    id: string;
    workspaceId: string;
    filename: string;
    fileType: string;
    storagePath: string;
    fileSizeBytes: number;
    contentHash: string;
    kind: "scraped_article";
    sourceCatalogId: string;
    sourceUrl: string;
    sourcePublishedAt: Date | null;
    sourceTrustScore: number;
  },
): Promise<void> {
  const url = new URL(`/rest/v1/knowledge_documents`, rest.supabaseUrl);
  url.searchParams.set("on_conflict", "id");

  const body = [
    {
      id: input.id,
      workspace_id: input.workspaceId,
      organization_id: input.workspaceId,
      filename: input.filename,
      file_type: input.fileType,
      file_size_bytes: input.fileSizeBytes,
      storage_path: input.storagePath,
      uploaded_by: "basquio-research",
      uploaded_by_discord_id: "basquio-research",
      content_hash: input.contentHash,
      status: "processing",
      metadata: {
        seeded_by: "packages/research/fetcher",
      },
      kind: input.kind,
      source_catalog_id: input.sourceCatalogId,
      source_url: input.sourceUrl,
      source_published_at: input.sourcePublishedAt?.toISOString() ?? null,
      source_trust_score: input.sourceTrustScore,
    },
  ];

  const response = await (rest.fetchImpl ?? fetch)(url.toString(), {
    method: "POST",
    headers: buildHeaders(rest.serviceKey, {
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`insertKnowledgeDocument failed ${response.status}: ${text}`);
  }
}

async function enqueueFileIngestRun(
  rest: RestConfig,
  input: { documentId: string; workspaceId: string },
): Promise<void> {
  const url = new URL(`/rest/v1/file_ingest_runs`, rest.supabaseUrl);
  url.searchParams.set("on_conflict", "document_id");
  const response = await (rest.fetchImpl ?? fetch)(url.toString(), {
    method: "POST",
    headers: buildHeaders(rest.serviceKey, {
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify([
      {
        document_id: input.documentId,
        workspace_id: input.workspaceId,
        status: "queued",
        claimed_by: null,
        claimed_at: null,
        error_message: null,
        metadata: { enqueued_by: "packages/research/fetcher" },
      },
    ]),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`enqueueFileIngestRun failed ${response.status}: ${text}`);
  }
}

function buildHeaders(serviceKey: string, extra: Record<string, string>): Headers {
  const headers = new Headers(extra);
  headers.set("apikey", serviceKey);
  if (serviceKey.split(".").length === 3 && !serviceKey.startsWith("sb_secret_")) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }
  return headers;
}

// ── Polling ─────────────────────────────────────────────────────────

async function pollBatchScrape(
  deps: FetcherDeps,
  kickoffId: string,
  pollIntervalMs: number,
  signal: AbortSignal,
) {
  if (!deps.firecrawl) {
    throw new Error("pollBatchScrape: firecrawl client is required");
  }
  while (true) {
    if (signal.aborted) {
      throw new Error("pollBatchScrape: aborted before completion");
    }
    const status = await deps.firecrawl.batchScrapeStatus(kickoffId, signal);
    if (status.status === "completed" || status.status === "failed" || status.status === "cancelled") {
      return status;
    }
    await sleep(pollIntervalMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("sleep aborted"));
      },
      { once: true },
    );
  });
}

// ── Source eligibility + link filtering ─────────────────────────────

function isSourceEligible(
  source: SourceCatalogEntry,
  query: ResearchQuery,
  firecrawlAvailable: boolean,
  fiberAvailable: boolean,
): boolean {
  if (source.status !== "active") return false;
  if (!query.tier_mask.includes(source.tier)) return false;
  if (!query.source_type_mask.includes(source.sourceType)) return false;
  if (query.language !== "both" && query.language !== source.language) return false;
  if (source.sourceType === "linkedin_fiber") return fiberAvailable;
  return firecrawlAvailable;
}

function filterLinksForSource(
  links: FirecrawlMapLink[],
  source: SourceCatalogEntry,
): FirecrawlMapLink[] {
  const patterns = source.crawlPatterns as {
    crawl_allow?: string[];
    crawl_deny?: string[];
  };
  const allowRegexes = (patterns.crawl_allow ?? []).map(safeRegex).filter((r): r is RegExp => r !== null);
  const denyRegexes = (patterns.crawl_deny ?? []).map(safeRegex).filter((r): r is RegExp => r !== null);
  return links.filter((link) => {
    const path = safePath(link.url);
    if (path === null) return false;
    if (allowRegexes.length > 0 && !allowRegexes.some((r) => r.test(path))) return false;
    if (denyRegexes.some((r) => r.test(path))) return false;
    return true;
  });
}

function rankLinksByKeyword(links: FirecrawlMapLink[], queryText: string): FirecrawlMapLink[] {
  const terms = queryText
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (terms.length === 0) return links;
  const scored = links.map((link) => {
    const blob = [link.title, link.description, link.url].filter(Boolean).join(" ").toLowerCase();
    let score = 0;
    for (const term of terms) if (blob.includes(term)) score += 1;
    return { link, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.link);
}

function getSourceCrawlLimit(source: SourceCatalogEntry): number {
  const patterns = source.crawlPatterns as { max_pages_per_crawl?: number };
  return patterns.max_pages_per_crawl ?? 200;
}

// ── Misc helpers ─────────────────────────────────────────────────────

function safeHashUrl(url: string): string | null {
  try {
    return hashUrl(url);
  } catch {
    return null;
  }
}

function firstDefinedString(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function safeRegex(source: string): RegExp | null {
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

function safePath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function safeDate(str: string): Date | null {
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function stringFromMetadata(
  metadata: Record<string, unknown> | undefined,
  candidates: string[],
): string | null {
  if (!metadata) return null;
  for (const key of candidates) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function firstNonEnglishLanguage(
  items: Array<{ source: SourceCatalogEntry }>,
): string {
  const it = items.find((t) => t.source.language === "it");
  return it?.source.language ?? items[0]?.source.language ?? "it";
}

async function safeCacheLookup(
  rest: RestConfig,
  args: { workspaceId: string; urlHash: string; now: Date },
) {
  try {
    return await lookupCacheByUrlHash(rest, args);
  } catch {
    return null;
  }
}

async function safeContentCacheLookup(
  rest: RestConfig,
  args: { workspaceId: string; contentHash: string; now: Date },
) {
  try {
    return await lookupCacheByContentHash(rest, args);
  } catch {
    return null;
  }
}

function linkAbortSignals(
  outer: AbortSignal | undefined,
  inner: AbortSignal,
): { signal: AbortSignal } {
  if (!outer) return { signal: inner };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (outer.aborted) controller.abort();
  else outer.addEventListener("abort", onAbort, { once: true });
  if (inner.aborted) controller.abort();
  else inner.addEventListener("abort", onAbort, { once: true });
  return { signal: controller.signal };
}
