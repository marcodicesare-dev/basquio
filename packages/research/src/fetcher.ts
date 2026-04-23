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
  lookupCacheByContentHash,
  lookupCacheByUrlHash,
  persistScrapeAtomic,
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
  /**
   * Count of graph:* EvidenceRefs seeded from the planner's Step 1
   * graph-coverage output. Lets operators see the cost-saved-by-graph
   * signal and lets the research_runs telemetry row surface the mix.
   * Populated by executePlan in packages/research/src/fetcher.ts (B4c).
   */
  evidenceRefsFromGraph: number;
  /**
   * Count of firecrawl:* EvidenceRefs produced this run (not counting
   * the seeded graph refs). Complements evidenceRefsFromGraph.
   */
  evidenceRefsFromFirecrawl: number;
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
    evidenceRefsFromGraph: 0,
    evidenceRefsFromFirecrawl: 0,
  };
  // B4c: seed the returned evidence with the planner's graph-coverage
  // refs (id prefix `graph:fact:*` or `graph:chunk:*`). These have
  // already been validated by materializeGraphEvidenceRefs in planner.ts
  // and live in the analyticsResult.evidenceRefs set so the intelligence
  // validator accepts citations to them. Deduping at this layer guards
  // the edge case where a planner + fetcher cycle ever produces
  // overlapping ids.
  const seenIds = new Set<string>();
  const allRefs: EvidenceRef[] = [];
  for (const ref of input.plan.existingGraphRefs) {
    if (seenIds.has(ref.id)) continue;
    seenIds.add(ref.id);
    allRefs.push(ref);
    stats.evidenceRefsFromGraph += 1;
  }

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
        for (const ref of refs) {
          if (seenIds.has(ref.id)) continue;
          seenIds.add(ref.id);
          allRefs.push(ref);
          stats.evidenceRefsFromFirecrawl += 1;
        }
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
  const briefTopicTerms = buildBriefTopicTerms(query);
  const eligibleSources = input.catalog
    .filter((row) => isSourceEligible(row, query, deps.firecrawl !== undefined, deps.fiber !== undefined))
    // Topic-overlap gate: reject sources whose domain_tags + host +
    // source_type share zero terms with the brief. Keeps hotel-AI
    // queries from firing against food catalog sources.
    .filter((row) => sourceHasTopicOverlap(row, briefTopicTerms));
  if (eligibleSources.length === 0) {
    deps.onStage?.("query_end", {
      queryId: query.id,
      dropped: "no eligible sources after tier/type/language/topic filters",
    });
    return [];
  }

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

  // Step 2: filter by per-source crawl patterns + global deny + URL-path
  // freshness, then rank by keyword match with a minimum-score threshold.
  const freshnessCutoff = query.freshness_window_days
    ? new Date(now().getTime() - query.freshness_window_days * 24 * 60 * 60 * 1000)
    : null;
  const candidateUrls: Array<{ source: SourceCatalogEntry; link: FirecrawlMapLink }> = [];
  for (const { source, links } of mapResults) {
    const filtered = filterLinksForSource(links, source, freshnessCutoff);
    const ranked = rankLinksByKeyword(filtered, query.text).slice(0, query.max_results_per_source);
    for (const link of ranked) candidateUrls.push({ source, link });
  }
  deps.onStage?.("map_filtered", {
    queryId: query.id,
    count: candidateUrls.length,
    freshnessCutoff: freshnessCutoff?.toISOString() ?? null,
  });

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
  const postScrapeFreshnessCutoff = query.freshness_window_days
    ? new Date(now().getTime() - query.freshness_window_days * 24 * 60 * 60 * 1000)
    : null;
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
    // Post-scrape freshness check: if metadata.publishedTime is parseable
    // and older than the cutoff, reject the article before persisting.
    if (postScrapeFreshnessCutoff) {
      const publishedRaw = stringFromMetadata(result.metadata, [
        "publishedTime",
        "article:published_time",
        "datePublished",
      ]);
      if (publishedRaw) {
        const published = safeDate(publishedRaw);
        if (published && published.getTime() < postScrapeFreshnessCutoff.getTime()) {
          stats.scrapesFailed += 1;
          deps.onStage?.("scrape_persisted", {
            url: resultUrl,
            reason: "rejected: article older than freshness window",
            publishedAt: publishedRaw,
          });
          continue;
        }
      }
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

  // Steps 7d-7f: single atomic RPC covering knowledge_documents insert,
  // source_catalog_scrapes upsert, and file_ingest_runs enqueue. Spec
  // §5.3 calls this out as one logical unit; prior code ran the three
  // inserts sequentially and could leave orphan rows on a mid-sequence
  // failure. Migration 20260424120000_transactional_scrape_persistence.sql.
  const knowledgeDocId = randomUUID();
  const persisted = await persistScrapeAtomic(deps.rest, {
    knowledgeDocumentId: knowledgeDocId,
    workspaceId: input.workspaceId,
    organizationId: input.workspaceId,
    filename: title ?? url,
    fileType: "md",
    fileSizeBytes: Buffer.byteLength(markdown, "utf-8"),
    storagePath,
    contentHash,
    kind: "scraped_article",
    sourceCatalogId: source.id,
    sourceUrl: url,
    sourcePublishedAt: publishedAt,
    sourceTrustScore: source.trustScore,
    scrapeUrl: url,
    scrapeUrlHash: urlHash,
    scrapeTitle: title,
    scrapeContentMarkdown: markdown,
    scrapeLanguage: source.language,
    fetcherEndpoint: "batch-scrape",
    fetcherCreditsUsed: 1,
  });

  deps.onStage?.("scrape_persisted", {
    url,
    urlHash,
    contentHash,
    knowledgeDocumentId: persisted.knowledgeDocumentId,
    cacheRowId: persisted.cacheRowId,
    fileIngestRunId: persisted.fileIngestRunId,
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

/**
 * Global deny patterns applied to EVERY source regardless of its
 * per-source crawl_deny list. Defense in depth: even when a migration
 * misses a pattern on one source, these stop index pages (sitemaps,
 * feeds, tag/category archives, author pages) from being scraped as
 * articles. Matches the R7 migration 20260423200000 that sets the
 * same defaults on every existing seed row.
 */
const GLOBAL_CRAWL_DENY_PATTERNS: RegExp[] = [
  /\/sitemap\//i,
  /\/sitemap\.xml$/i,
  /\/feed\//i,
  /\/rss\//i,
  /\/tag\//i,
  /\/tags\//i,
  /\/topic\//i,
  /\/topics\//i,
  /\/category\//i,
  /\/categorie\//i,
  /\/categoria\//i,
  /\/author\//i,
  /\/autore\//i,
  /\/archive\//i,
  /\/archivio\//i,
  /\/page\/\d+/i,
  /\/pagina\/\d+/i,
];

/**
 * Minimum number of brief-keyword hits a candidate URL must score on
 * its title + description + URL path to be kept. Below this, the URL
 * drops out even if it passed regex filters. Set conservatively to 1
 * so sources with short descriptions still get their best matches
 * through; raise to 2 to be stricter when smoke data shows too much
 * noise.
 */
const MIN_KEYWORD_SCORE = 1;

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

/**
 * Topic-overlap gate. Returns true when the source's domain_tags,
 * host words, and source_type have ANY term in common with the brief's
 * topic terms. False when a brief about hotels hits a food-focused
 * catalog source.
 *
 * Day 4 smoke Brief B (hotel AI EMEA) exposed this gap: the planner
 * correctly tier-masked to 4/5 English sources, but the fetcher then
 * scraped 15 food articles from just-food / euromonitor / nielsen
 * because nothing rejected them on topical relevance.
 */
function sourceHasTopicOverlap(
  source: SourceCatalogEntry,
  briefTopicTerms: Set<string>,
): boolean {
  if (briefTopicTerms.size === 0) return true;
  const sourceSignature = new Set<string>();
  const addSig = (raw: string) => {
    const t = raw.toLowerCase();
    // Drop 1-2 char tokens (country TLD suffixes like ".it", "uk" are
    // substrings of many English words and cause false positives on
    // the partial-match check below).
    if (t.length >= 3) sourceSignature.add(t);
  };
  for (const tag of source.domainTags) addSig(tag);
  addSig(source.sourceType);
  for (const part of source.host.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    addSig(part);
  }
  for (const term of briefTopicTerms) {
    if (term.length < 3) continue;
    if (sourceSignature.has(term)) return true;
    for (const sig of sourceSignature) {
      if (term.length < 3 || sig.length < 3) continue;
      // Prefix/suffix match only, not mid-string. Catches legitimate
      // category roots like "pet" / "petfood", "oil" / "oilseed",
      // "tea" / "teaware", "pane" / "panetteria" without firing on
      // coincidental substrings like "pet" appearing inside
      // "competitor" or "it" inside "management".
      const smaller = term.length < sig.length ? term : sig;
      const larger = term.length < sig.length ? sig : term;
      if (larger.startsWith(smaller) || larger.endsWith(smaller)) return true;
    }
  }
  return false;
}

/**
 * Derive the brief's topic-term set from the query's search text.
 * Lowercased, tokenized on non-alphanumeric (including accented Latin
 * characters), stopwords stripped, minimum length 3. Keywords and
 * intent are not added here because the planner has already composed
 * them into `query.text` at generation time; re-tokenizing the raw
 * keyword list would duplicate signal without adding new terms.
 */
function buildBriefTopicTerms(query: ResearchQuery): Set<string> {
  const text = query.text.toLowerCase();
  const tokens = text.split(/[^a-zà-ÿ0-9]+/u).filter((t) => t.length >= 3 && !TOPIC_STOPWORDS.has(t));
  return new Set(tokens);
}

const TOPIC_STOPWORDS = new Set([
  // English
  "and",
  "the",
  "for",
  "from",
  "with",
  "into",
  "about",
  "this",
  "that",
  "these",
  "those",
  // Italian
  "per",
  "con",
  "che",
  "del",
  "dei",
  "delle",
  "della",
  "dello",
  "degli",
  "sul",
  "sulla",
  "alla",
  "alle",
  "agli",
  "nel",
  "nella",
  "una",
  "uno",
  // French / Spanish stragglers
  "des",
  "les",
  "sur",
]);

function filterLinksForSource(
  links: FirecrawlMapLink[],
  source: SourceCatalogEntry,
  freshnessCutoff: Date | null,
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
    // Global deny: sitemap, feed, tag/category, author, archive pages.
    // These are URL index pages, not articles, even when the per-source
    // regex list missed them.
    if (GLOBAL_CRAWL_DENY_PATTERNS.some((r) => r.test(path))) return false;
    if (allowRegexes.length > 0 && !allowRegexes.some((r) => r.test(path))) return false;
    if (denyRegexes.some((r) => r.test(path))) return false;
    // Freshness filter: if the URL path embeds a year (or year/month)
    // and that date is older than the cutoff, drop it. URLs without a
    // parseable date pass through; post-scrape metadata.publishedTime
    // is the next line of defense in persistScrape.
    if (freshnessCutoff && !isPathFreshEnough(path, freshnessCutoff)) return false;
    return true;
  });
}

/**
 * Try to extract a `YYYY[/MM[/DD]]` date from the URL path. If extracted
 * and the date is older than the cutoff, return false. If the path has
 * no parseable date, return true (caller cannot pre-filter; rely on
 * metadata.publishedTime during persist).
 */
function isPathFreshEnough(path: string, cutoff: Date): boolean {
  const match = path.match(/\/(20\d{2})(?:\/(\d{1,2}))?(?:\/(\d{1,2}))?(?:\/|$)/);
  if (!match) return true;
  const year = Number.parseInt(match[1]!, 10);
  const month = match[2] ? Number.parseInt(match[2], 10) : 1;
  const day = match[3] ? Number.parseInt(match[3], 10) : 1;
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return true;
  const urlDate = new Date(Date.UTC(year, Math.max(0, Math.min(11, month - 1)), Math.max(1, Math.min(28, day))));
  return urlDate.getTime() >= cutoff.getTime();
}

function rankLinksByKeyword(links: FirecrawlMapLink[], queryText: string): FirecrawlMapLink[] {
  const terms = queryText
    .toLowerCase()
    .split(/\s+/)
    // Drop purely-numeric terms (year stamps like "2026" score
    // spuriously against URL date segments) and short tokens.
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
  if (terms.length === 0) return links;
  const scored = links.map((link) => {
    // Score on title + description (semantic signals) and URL path
    // (slug signals). Numeric date segments in the URL do not contribute
    // because all-digit query terms were filtered above.
    const blob = [link.title, link.description, link.url].filter(Boolean).join(" ").toLowerCase();
    let score = 0;
    for (const term of terms) if (blob.includes(term)) score += 1;
    return { link, score };
  });
  // Minimum keyword-score threshold. A URL with zero keyword hits on
  // its title + description + URL path is not a plausible scrape target,
  // even if the per-source crawl_allow regex lets it through.
  const qualified = scored.filter((s) => s.score >= MIN_KEYWORD_SCORE);
  qualified.sort((a, b) => b.score - a.score);
  return qualified.map((s) => s.link);
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
