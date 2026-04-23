/**
 * Deck-pipeline integration for the research layer.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §5.5.
 * This module encapsulates the research phase so generate-deck.ts keeps a
 * small diff: load the catalog, run the planner, run the fetcher, persist
 * the results, return the EvidenceRef[] plus telemetry.
 *
 * Day 4 scope:
 * - Fires the planner + fetcher with real Firecrawl and optional Fiber clients.
 * - Writes research_runs rows for operator observability.
 * - Returns the EvidenceRef[] for downstream system-prompt wiring in author.
 * - Day 5 follow-up: merge these refs into the container's analyticsResult
 *   before rankInsights runs so the insights.ts validator accepts them.
 *
 * Non-fatal. If Firecrawl is not configured, Fiber is not configured, or
 * any network call fails, the phase logs and returns an empty result
 * so the deck still ships with uploaded-file evidence only.
 */

import { randomUUID } from "node:crypto";

import type { WorkspaceContextPack } from "@basquio/types";
import {
  DAY_4_FIRECRAWL_USD_CAP,
  DAY_4_SMOKE_BUDGET,
  FIRECRAWL_USD_PER_CREDIT,
  createFiberClient,
  createFirecrawlClient,
  createResearchPlan,
  executePlan,
  type EvidenceRef,
  type FetcherStats,
  type GraphCoverageResult,
  type HaikuCallFn,
  type RestConfig,
  type ResearchPlan,
  type SourceCatalogEntry,
} from "@basquio/research";

import { fetchRestRows, patchRestRows, upsertRestRows, uploadToStorage } from "./supabase";

export type ResearchPhaseInput = {
  workspaceId: string;
  /**
   * Deck run id. Nullable so smoke harnesses that exercise the research
   * phase standalone (no real deck_runs row) can still write a
   * research_runs telemetry row; the column's FK is ON DELETE SET NULL
   * and accepts null at insert time.
   */
  deckRunId: string | null;
  conversationId: string | null;
  briefSummary: string;
  briefKeywords: string[];
  workspaceContextPack: WorkspaceContextPack | null;
  callHaiku: HaikuCallFn;
  graphQuery: (args: {
    workspaceId: string;
    keywords: string[];
    freshnessWindowDays: number | null;
  }) => Promise<GraphCoverageResult>;
};

export type ResearchPhaseConfig = {
  supabaseUrl: string;
  serviceKey: string;
  firecrawlApiKey: string | null;
  fiberApiKey: string | null;
};

export type ResearchPhaseResult = {
  researchRunId: string;
  plan: ResearchPlan;
  evidenceRefs: EvidenceRef[];
  stats: FetcherStats;
  /** True when the phase returned early due to config or error. */
  degraded: boolean;
  degradedReason: string | null;
};

export async function runResearchPhase(
  input: ResearchPhaseInput,
  config: ResearchPhaseConfig,
  signal?: AbortSignal,
): Promise<ResearchPhaseResult> {
  const restConfig: RestConfig = {
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
  };
  const researchRunId = randomUUID();

  // Step 1: load the active catalog for the workspace. Do this before
  // we commit any research_runs row; if the catalog is empty the whole
  // phase is a no-op and we return early without persisting noise.
  let catalog: SourceCatalogEntry[] = [];
  try {
    catalog = await loadActiveCatalog(restConfig, input.workspaceId);
  } catch (error) {
    return degraded(
      researchRunId,
      `catalog load failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (catalog.length === 0) {
    return degraded(researchRunId, "catalog is empty; skipping research phase");
  }

  // Step 2: insert a research_runs row so operators can follow the phase
  // in real time. Subsequent updates mutate the same row.
  try {
    await insertResearchRun(restConfig, {
      id: researchRunId,
      workspaceId: input.workspaceId,
      deckRunId: input.deckRunId,
      conversationId: input.conversationId,
      briefSummary: input.briefSummary,
      status: "planning",
      plan: { queries: [], rationale: "phase started" },
    });
  } catch (error) {
    return degraded(
      researchRunId,
      `research_runs insert failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Step 3: planner. Graph-first; Haiku only fires on real gaps.
  let plan: ResearchPlan;
  try {
    plan = await createResearchPlan(
      {
        workspaceId: input.workspaceId,
        briefSummary: input.briefSummary,
        briefKeywords: input.briefKeywords,
        stakeholders:
          input.workspaceContextPack?.stakeholders?.map((s) => ({
            name: s.name,
            role: s.role ?? null,
          })) ?? [],
        scopeName: input.workspaceContextPack?.scope?.name ?? null,
        scopeKind: mapScopeKind(input.workspaceContextPack?.scope?.kind ?? null),
        workspaceCatalog: catalog,
        budget: DAY_4_SMOKE_BUDGET,
      },
      {
        graphQuery: input.graphQuery,
        callHaiku: input.callHaiku,
      },
      signal,
    );
  } catch (error) {
    await markFailed(restConfig, researchRunId, error);
    return degraded(
      researchRunId,
      `planner failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await updateResearchRun(restConfig, researchRunId, {
    status: plan.queries.length === 0 ? "completed" : "fetching",
    plan: { ...plan, existingGraphRefs: plan.existingGraphRefs.length },
    evidence_ref_count: plan.existingGraphRefs.length,
  });

  // Fast path: planner says the graph already covers the brief.
  if (plan.queries.length === 0) {
    return {
      researchRunId,
      plan,
      evidenceRefs: plan.existingGraphRefs,
      stats: zeroStats(),
      degraded: false,
      degradedReason: null,
    };
  }

  // Step 4: fetcher. Clients are optional per spec §5.7 graceful degradation.
  const firecrawlClient = config.firecrawlApiKey
    ? createFirecrawlClient({ apiKey: config.firecrawlApiKey })
    : undefined;
  const fiberClient = config.fiberApiKey
    ? createFiberClient({ apiKey: config.fiberApiKey })
    : undefined;

  if (!firecrawlClient && !fiberClient) {
    // Graceful degradation per spec §5.7: the graph refs are still
    // usable evidence. Mark the run as completed-with-degradation
    // rather than failed so operators see an honest status in the
    // research_runs table. A later run that configures the keys can
    // populate the gaps without the UI surfacing a false red state.
    const msg = "no Firecrawl or Fiber key configured; returning graph-only evidence";
    await updateResearchRun(restConfig, researchRunId, {
      status: "completed",
      error_detail: msg.slice(0, 2000),
      evidence_ref_count: plan.existingGraphRefs.length,
      completed_at: new Date().toISOString(),
    }).catch(() => {});
    return {
      researchRunId,
      plan,
      evidenceRefs: plan.existingGraphRefs,
      stats: zeroStats(),
      degraded: true,
      degradedReason: msg,
    };
  }

  try {
    const result = await executePlan(
      {
        workspaceId: input.workspaceId,
        plan,
        catalog,
        researchRunId,
      },
      {
        rest: restConfig,
        firecrawl: firecrawlClient,
        fiber: fiberClient,
        uploadStorage: async (args) => {
          await uploadToStorage({
            supabaseUrl: config.supabaseUrl,
            serviceKey: config.serviceKey,
            bucket: args.bucket,
            storagePath: args.storagePath,
            body: args.body,
            contentType: args.contentType,
            upsert: args.upsert,
          });
        },
        budget: DAY_4_SMOKE_BUDGET,
        firecrawlCap: DAY_4_FIRECRAWL_USD_CAP,
        firecrawlUsdPerCredit: FIRECRAWL_USD_PER_CREDIT,
      },
      signal,
    );

    const mergedRefs = [...plan.existingGraphRefs, ...result.evidenceRefs];
    await updateResearchRun(restConfig, researchRunId, {
      status: "completed",
      scrapes_attempted: result.stats.scrapesAttempted,
      scrapes_succeeded: result.stats.scrapesSucceeded,
      firecrawl_cost_usd: result.stats.firecrawlUsd,
      evidence_ref_count: mergedRefs.length,
      completed_at: new Date().toISOString(),
    });

    return {
      researchRunId,
      plan,
      evidenceRefs: mergedRefs,
      stats: result.stats,
      degraded: false,
      degradedReason: null,
    };
  } catch (error) {
    await markFailed(restConfig, researchRunId, error);
    return {
      researchRunId,
      plan,
      evidenceRefs: plan.existingGraphRefs,
      stats: zeroStats(),
      degraded: true,
      degradedReason: `fetcher failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── helpers ────────────────────────────────────────────────────────

function mapScopeKind(
  raw: string | null | undefined,
): "client" | "category" | "function" | "system" | null {
  if (!raw) return null;
  if (raw === "client" || raw === "category" || raw === "function" || raw === "system") return raw;
  return null;
}

function zeroStats(): FetcherStats {
  return {
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
}

function degraded(id: string, reason: string): ResearchPhaseResult {
  return {
    researchRunId: id,
    plan: {
      existingGraphRefs: [],
      queries: [],
      rationale: reason,
      estimated_credits: 0,
      graph_coverage_score: 0,
      stale_keywords: [],
    },
    evidenceRefs: [],
    stats: zeroStats(),
    degraded: true,
    degradedReason: reason,
  };
}

async function loadActiveCatalog(
  restConfig: RestConfig,
  workspaceId: string,
): Promise<SourceCatalogEntry[]> {
  const rows = await fetchRestRows<{
    id: string;
    workspace_id: string;
    url: string;
    host: string;
    tier: number;
    language: string;
    source_type: SourceCatalogEntry["sourceType"];
    domain_tags: string[];
    crawl_patterns: Record<string, unknown>;
    trust_score: number;
    status: SourceCatalogEntry["status"];
  }>({
    supabaseUrl: restConfig.supabaseUrl,
    serviceKey: restConfig.serviceKey,
    table: "source_catalog",
    query: {
      select: "id,workspace_id,url,host,tier,language,source_type,domain_tags,crawl_patterns,trust_score,status",
      workspace_id: `eq.${workspaceId}`,
      status: "eq.active",
    },
  });
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    url: r.url,
    host: r.host,
    tier: r.tier,
    language: r.language,
    sourceType: r.source_type,
    domainTags: r.domain_tags,
    crawlPatterns: r.crawl_patterns,
    trustScore: r.trust_score,
    status: r.status,
  }));
}

async function insertResearchRun(
  restConfig: RestConfig,
  input: {
    id: string;
    workspaceId: string;
    deckRunId: string | null;
    conversationId: string | null;
    briefSummary: string;
    status: string;
    plan: Record<string, unknown>;
  },
): Promise<void> {
  await upsertRestRows({
    supabaseUrl: restConfig.supabaseUrl,
    serviceKey: restConfig.serviceKey,
    table: "research_runs",
    rows: [
      {
        id: input.id,
        workspace_id: input.workspaceId,
        deck_run_id: input.deckRunId,
        conversation_id: input.conversationId,
        trigger: "deck_run",
        brief_summary: input.briefSummary.slice(0, 4000),
        plan: input.plan,
        status: input.status,
      },
    ],
    onConflict: "id",
  });
}

async function updateResearchRun(
  restConfig: RestConfig,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await patchRestRows({
    supabaseUrl: restConfig.supabaseUrl,
    serviceKey: restConfig.serviceKey,
    table: "research_runs",
    query: { id: `eq.${id}` },
    payload: patch,
  });
}

async function markFailed(
  restConfig: RestConfig,
  id: string,
  error: unknown,
): Promise<void> {
  try {
    await updateResearchRun(restConfig, id, {
      status: "failed",
      error_detail: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      completed_at: new Date().toISOString(),
    });
  } catch {
    // swallow: operator telemetry should never crash the run
  }
}
