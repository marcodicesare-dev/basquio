/**
 * Graph-first research planner.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §5.2.
 * Two-step flow:
 *
 *   Step 1 (deterministic, no LLM): query the workspace knowledge graph
 *          for the brief's keywords. Score coverage per keyword. Flag
 *          stale entries. Materialize matching content as EvidenceRef[]
 *          with ids prefixed `graph:fact:<id>` or `graph:chunk:<id>`.
 *
 *   Step 2 (Haiku, cheap): pass Step 1's coverage scores plus the catalog
 *          summary to Haiku. Haiku returns JSON for gap queries only.
 *          Short-circuit to empty queries when graph_coverage_score is
 *          above the tuning threshold AND no keyword is flagged stale.
 *
 * The planner does not touch Postgres or Anthropic directly. Callers
 * (Day 5 deck pipeline integration, Day 4 chat tool wiring) inject a
 * `graphQuery` function and a `callHaiku` function. This lets tests use
 * stubbed fixtures without spinning up a database or a live API key.
 *
 * Output is a `ResearchPlan` combining Step 1 `existingGraphRefs` with
 * Step 2 queries, validated by the Zod schemas in `types.ts`.
 */

import {
  DEFAULT_PLANNER_TUNING,
  evidenceRefSchema,
  haikuPlanOutputSchema,
  researchPlanSchema,
  type EvidenceRef,
  type GraphCoverageHit,
  type GraphCoverageResult,
  type GraphQueryFn,
  type HaikuCallFn,
  type PlannerInput,
  type PlannerTuning,
  type ResearchPlan,
} from "./types";
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserMessage } from "./planner-prompt";

export type PlannerDeps = {
  graphQuery: GraphQueryFn;
  callHaiku: HaikuCallFn;
  /** Tuning overrides. Unset fields fall back to DEFAULT_PLANNER_TUNING. */
  tuning?: Partial<PlannerTuning>;
  /** Observability hook. Fires after Step 1 and after Step 2 with timing. */
  onStage?: (stage: "graph_coverage" | "haiku_gap" | "done", ms: number) => void;
};

/**
 * Build the full research plan. Throws on invalid Haiku output (Zod
 * parse failure) rather than silently returning degraded state; the
 * fetcher caller decides whether to retry or fall back to
 * scrape-every-time.
 */
export async function createResearchPlan(
  input: PlannerInput,
  deps: PlannerDeps,
  signal?: AbortSignal,
): Promise<ResearchPlan> {
  const tuning: PlannerTuning = { ...DEFAULT_PLANNER_TUNING, ...(deps.tuning ?? {}) };

  // ── Step 1: graph coverage check ──
  const t0 = Date.now();
  const graph = await deps.graphQuery({
    workspaceId: input.workspaceId,
    keywords: input.briefKeywords,
    freshnessWindowDays: input.defaultFreshnessWindowDays ?? null,
  });
  deps.onStage?.("graph_coverage", Date.now() - t0);

  const coveredKeywords = scoreCoveragePerKeyword(input.briefKeywords, graph, tuning);
  const staleKeywords = coveredKeywords.filter((c) => c.stale).map((c) => c.keyword);
  const existingGraphRefs = materializeGraphEvidenceRefs(graph, tuning);
  const graphCoverageScore = aggregateCoverageScore(coveredKeywords);

  // Short-circuit: full coverage AND no stale flags means Haiku does not
  // need to fire. Saves roughly $0.02 per skipped plan.
  const shouldSkipHaiku =
    graphCoverageScore >= tuning.highCoverageThreshold && staleKeywords.length === 0;

  if (shouldSkipHaiku) {
    const plan: ResearchPlan = {
      existingGraphRefs,
      queries: [],
      rationale: buildSkipRationale(coveredKeywords, graphCoverageScore),
      estimated_credits: 0,
      graph_coverage_score: Number(graphCoverageScore.toFixed(3)),
      stale_keywords: staleKeywords,
    };
    return researchPlanSchema.parse(plan);
  }

  // ── Step 2: Haiku gap queries ──
  const t1 = Date.now();
  const userMessage = buildPlannerUserMessage({
    briefSummary: input.briefSummary,
    briefKeywords: input.briefKeywords,
    stakeholders: input.stakeholders,
    scopeName: input.scopeName,
    scopeKind: input.scopeKind,
    workspaceCatalog: input.workspaceCatalog,
    coveredKeywords: coveredKeywords.map((c) => ({
      keyword: c.keyword,
      score: c.score,
      stale: c.stale,
    })),
    staleKeywords,
  });

  const rawResponse = await deps.callHaiku({
    system: PLANNER_SYSTEM_PROMPT,
    user: userMessage,
    signal,
  });
  deps.onStage?.("haiku_gap", Date.now() - t1);

  const parsedJson = tolerantJsonParse(rawResponse);
  const haikuOutput = haikuPlanOutputSchema.parse(parsedJson);

  // Enforce the budget at planner-output time so the fetcher never sees
  // a plan that exceeds the caller's credit envelope. We only trim the
  // query list; we do not rewrite individual queries.
  const trimmedQueries = enforceBudget(
    haikuOutput.queries,
    input.budget,
    haikuOutput.estimated_credits,
    tuning.firecrawlUsdPerCredit,
  );

  const plan: ResearchPlan = {
    existingGraphRefs,
    queries: trimmedQueries.queries,
    rationale: trimmedQueries.truncated
      ? `${haikuOutput.rationale} [Planner trimmed ${trimmedQueries.droppedCount} low-priority queries to stay within the ${input.budget.maxUrls}-URL / $${input.budget.maxUsd} budget.]`
      : haikuOutput.rationale,
    estimated_credits: trimmedQueries.trimmedCredits,
    graph_coverage_score: Number(graphCoverageScore.toFixed(3)),
    stale_keywords: staleKeywords,
  };

  deps.onStage?.("done", Date.now() - t0);
  return researchPlanSchema.parse(plan);
}

// ── Step 1 helpers ───────────────────────────────────────────────────

type CoverageRow = {
  keyword: string;
  score: number;
  stale: boolean;
  factCount: number;
  chunkCount: number;
};

function scoreCoveragePerKeyword(
  keywords: string[],
  graph: GraphCoverageResult,
  tuning: PlannerTuning,
): CoverageRow[] {
  return keywords.map((keyword) => {
    const hit = graph.hits.find((h) => h.keyword.toLowerCase() === keyword.toLowerCase());
    if (!hit) return { keyword, score: 0, stale: false, factCount: 0, chunkCount: 0 };
    const factContribution = hit.facts.reduce((sum, f) => sum + f.confidence * tuning.factWeight, 0);
    const chunkContribution = hit.chunks
      .filter(
        (c) => c.documentSourceTrustScore === null || c.documentSourceTrustScore >= tuning.chunkMinTrust,
      )
      .reduce((sum, c) => sum + c.score * tuning.chunkWeight, 0);
    return {
      keyword,
      score: factContribution + chunkContribution,
      stale: hit.isStale,
      factCount: hit.facts.length,
      chunkCount: hit.chunks.length,
    };
  });
}

function aggregateCoverageScore(rows: CoverageRow[]): number {
  if (rows.length === 0) return 0;
  // Normalize per-keyword scores with a saturation curve so one huge
  // hit on one keyword does not mask zero coverage on another. The
  // saturation cap 1.0 means a keyword with score >= 1 counts as fully
  // covered; everything above is ignored.
  const normalized = rows.map((r) => Math.min(1, r.score));
  const mean = normalized.reduce((a, b) => a + b, 0) / rows.length;
  return mean;
}

function materializeGraphEvidenceRefs(
  graph: GraphCoverageResult,
  tuning: PlannerTuning,
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const hit of graph.hits) {
    for (const fact of hit.facts) {
      refs.push({
        id: `graph:fact:${fact.id}`,
        sourceFileId: fact.documentId,
        fileName: fact.documentFileName,
        fileRole: "graph-fact",
        sheet: "knowledge-graph",
        metric: fact.predicate,
        summary: `${fact.subjectName} ${fact.predicate} ${fact.objectValue}`,
        confidence: clamp01(fact.confidence),
        sourceLocation: fact.documentFileName,
        rawValue: fact.objectValue,
        derivedTable: null,
        dimensions: {
          ...fact.dimensions,
          keyword: hit.keyword,
          subject_entity: fact.subjectEntity,
          valid_from: fact.validFrom ?? "unknown",
          valid_to: fact.validTo ?? "open",
        },
      });
    }
    for (const chunk of hit.chunks) {
      if (
        chunk.documentSourceTrustScore !== null &&
        chunk.documentSourceTrustScore < tuning.chunkMinTrust
      ) {
        continue;
      }
      refs.push({
        id: `graph:chunk:${chunk.id}`,
        sourceFileId: chunk.documentId,
        fileName: chunk.documentFileName,
        fileRole: `graph-chunk-${chunk.documentKind}`,
        sheet: "knowledge-graph",
        metric: "graph_chunk",
        summary: chunk.snippet.slice(0, 240),
        confidence: clamp01(
          chunk.documentSourceTrustScore !== null
            ? chunk.documentSourceTrustScore / 100
            : chunk.score,
        ),
        sourceLocation: chunk.documentSourceUrl ?? chunk.documentFileName,
        rawValue: chunk.rawContent,
        derivedTable: null,
        dimensions: {
          ...chunk.dimensions,
          keyword: hit.keyword,
          document_kind: chunk.documentKind,
          retrieval_score: chunk.score.toFixed(3),
        },
      });
    }
  }
  // Defensive validation: drop any ref that fails the schema rather
  // than propagating a malformed row into the deck pipeline.
  return refs.filter((ref) => evidenceRefSchema.safeParse(ref).success);
}

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function buildSkipRationale(rows: CoverageRow[], aggregate: number): string {
  const freshCount = rows.filter((r) => !r.stale && r.score > 0).length;
  return `Graph coverage is sufficient: ${freshCount} of ${rows.length} keywords score at or above the full-coverage threshold with no stale flags. Aggregate score ${aggregate.toFixed(2)}. No new scrape needed for this brief.`;
}

// ── Step 2 helpers ───────────────────────────────────────────────────

/**
 * Parse JSON tolerantly. Haiku occasionally wraps output in a code
 * fence or prepends prose even when instructed not to; extract the
 * first `{...}` block if the naive parse fails. Does NOT swallow
 * genuine syntax errors; a truly unparseable response throws.
 */
function tolerantJsonParse(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]!);
    } catch {
      // fall through
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const inner = trimmed.slice(firstBrace, lastBrace + 1);
    return JSON.parse(inner);
  }
  throw new SyntaxError("planner: Haiku response is not parseable JSON");
}

type BudgetTrimResult = {
  queries: ResearchPlan["queries"];
  truncated: boolean;
  droppedCount: number;
  trimmedCredits: number;
};

/**
 * Enforce the caller's URL and USD budget by trimming the lowest-
 * priority queries first. Priority order keeps no_coverage first,
 * stale_coverage second, low_trust_coverage third, new_angle last.
 * Genuine gaps beat speculative refinements when budget is tight.
 *
 * USD-per-credit conversion comes from PlannerTuning so callers on
 * Standard-tier Firecrawl can opt into more headroom without code edits.
 */
function enforceBudget(
  queries: ResearchPlan["queries"],
  budget: PlannerInput["budget"],
  declaredCredits: number,
  usdPerCredit: number,
): BudgetTrimResult {
  const urlEstimate = (q: ResearchPlan["queries"][number]) =>
    q.max_results_per_source * q.tier_mask.length;
  const totalUrls = queries.reduce((sum, q) => sum + urlEstimate(q), 0);
  const declaredUsd = declaredCredits * usdPerCredit;

  if (totalUrls <= budget.maxUrls && declaredUsd <= budget.maxUsd) {
    return {
      queries,
      truncated: false,
      droppedCount: 0,
      trimmedCredits: declaredCredits,
    };
  }

  // Rank: keep no_coverage first, stale_coverage second, low_trust third,
  // new_angle last. Lower gap-reason index = higher priority to keep.
  const priorityIndex = (gap: ResearchPlan["queries"][number]["gap_reason"]) => {
    switch (gap) {
      case "no_coverage":
        return 0;
      case "stale_coverage":
        return 1;
      case "low_trust_coverage":
        return 2;
      case "new_angle":
        return 3;
    }
  };
  const ranked = [...queries].sort((a, b) => priorityIndex(a.gap_reason) - priorityIndex(b.gap_reason));

  const kept: ResearchPlan["queries"] = [];
  let runningUrls = 0;
  let runningCredits = 0;
  for (const q of ranked) {
    const qUrls = urlEstimate(q);
    const qCredits = 1 + qUrls;
    const runningUsd = runningCredits * usdPerCredit;
    const qUsd = qCredits * usdPerCredit;
    if (runningUrls + qUrls > budget.maxUrls) continue;
    if (runningUsd + qUsd > budget.maxUsd) continue;
    kept.push(q);
    runningUrls += qUrls;
    runningCredits += qCredits;
  }

  // Re-sort kept list back into original order so the ids read naturally.
  const originalOrder = new Map(queries.map((q, i) => [q.id, i]));
  kept.sort(
    (a, b) => (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0),
  );

  return {
    queries: kept,
    truncated: true,
    droppedCount: queries.length - kept.length,
    trimmedCredits: runningCredits,
  };
}
