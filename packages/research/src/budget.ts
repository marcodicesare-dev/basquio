/**
 * Per-research-run budget enforcement.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §5.3
 * step 9 and Marco's 2026-04-23 Day 4 scope tightening:
 *
 *   Day 4 caps (first live run safety envelope):
 *     maxUrls:         15     (spec default 50, tightened for smoke)
 *     maxFirecrawlUsd: $0.30  (spec default $2.00, tightened for smoke)
 *     maxTotalUsd:     $0.50  (includes Fiber credits)
 *
 *   Post-smoke stable caps (raise to spec §5.3 defaults once Day 4
 *   verifies the path is safe):
 *     maxUrls:         50
 *     maxFirecrawlUsd: $2.00
 *     maxTotalUsd:     $2.50
 *
 * The fetcher consults this budget at each step and halts with partial
 * results when a cap is hit, logging `metadata.budget_exceeded=true`
 * on the research_runs row per spec §5.3. Callers reading the plan
 * can see that the run completed partially rather than failed.
 */

import type { ResearchBudget } from "./types";

/**
 * Day-4 safety envelope. Tighter than spec §5.3 default during the
 * first live smoke run. Switch to SPEC_STABLE_BUDGET once Day 4
 * verifies the path.
 */
export const DAY_4_SMOKE_BUDGET: ResearchBudget = {
  maxUrls: 15,
  maxUsd: 0.5,
};

/**
 * Firecrawl-only sub-cap within the total budget. Per Marco's Day 4
 * scope: "max $0.30 Firecrawl cost, max $0.50 total including Fiber."
 * The total is checked against `maxUsd`; this constant is the Firecrawl
 * share.
 */
export const DAY_4_FIRECRAWL_USD_CAP = 0.3;

/**
 * Spec §5.3 stable defaults. Move to these after Day 4 smoke passes.
 */
export const SPEC_STABLE_BUDGET: ResearchBudget = {
  maxUrls: 50,
  maxUsd: 2.5,
};

export const SPEC_STABLE_FIRECRAWL_USD_CAP = 2.0;

export type CostAccumulator = {
  firecrawlUsd: number;
  fiberUsd: number;
  urlsFetched: number;
};

export function newCostAccumulator(): CostAccumulator {
  return { firecrawlUsd: 0, fiberUsd: 0, urlsFetched: 0 };
}

export type BudgetVerdict =
  | { status: "within_budget" }
  | { status: "cap_hit"; reason: BudgetCapReason; message: string };

export type BudgetCapReason =
  | "max_urls"
  | "max_firecrawl_usd"
  | "max_total_usd"
  | "per_call_exceeds_remaining";

/**
 * Check whether a proposed next call would keep the run inside budget.
 * Callers pass in the accumulator, the proposed URL count for the
 * next call, and the proposed USD. `within_budget` means fire; any
 * other status means halt the run gracefully with partial results.
 */
export function checkBudget(args: {
  accumulator: CostAccumulator;
  proposedUrls: number;
  proposedFirecrawlUsd: number;
  proposedFiberUsd: number;
  budget: ResearchBudget;
  firecrawlCap: number;
}): BudgetVerdict {
  const { accumulator, proposedUrls, proposedFirecrawlUsd, proposedFiberUsd, budget, firecrawlCap } = args;

  const nextUrls = accumulator.urlsFetched + proposedUrls;
  if (nextUrls > budget.maxUrls) {
    return {
      status: "cap_hit",
      reason: "max_urls",
      message: `URL cap reached: ${accumulator.urlsFetched}/${budget.maxUrls} used, proposed call would push to ${nextUrls}`,
    };
  }

  const nextFirecrawl = accumulator.firecrawlUsd + proposedFirecrawlUsd;
  if (nextFirecrawl > firecrawlCap) {
    return {
      status: "cap_hit",
      reason: "max_firecrawl_usd",
      message: `Firecrawl USD cap reached: $${accumulator.firecrawlUsd.toFixed(4)}/${firecrawlCap.toFixed(2)} used, proposed call would push to $${nextFirecrawl.toFixed(4)}`,
    };
  }

  const nextTotal =
    accumulator.firecrawlUsd + accumulator.fiberUsd + proposedFirecrawlUsd + proposedFiberUsd;
  if (nextTotal > budget.maxUsd) {
    return {
      status: "cap_hit",
      reason: "max_total_usd",
      message: `Total USD cap reached: $${(accumulator.firecrawlUsd + accumulator.fiberUsd).toFixed(4)}/${budget.maxUsd.toFixed(2)} used, proposed call would push to $${nextTotal.toFixed(4)}`,
    };
  }

  if (proposedUrls > budget.maxUrls - accumulator.urlsFetched) {
    return {
      status: "cap_hit",
      reason: "per_call_exceeds_remaining",
      message: `single call would consume ${proposedUrls} URLs but only ${budget.maxUrls - accumulator.urlsFetched} remain`,
    };
  }

  return { status: "within_budget" };
}

/**
 * Record the actual cost of a completed call on the accumulator.
 * Firecrawl reports credits in its response; the fetcher converts to
 * USD via the tuning value and passes here.
 */
export function recordCost(
  acc: CostAccumulator,
  args: { firecrawlUsd?: number; fiberUsd?: number; urlsFetched?: number },
): void {
  if (args.firecrawlUsd !== undefined) acc.firecrawlUsd += args.firecrawlUsd;
  if (args.fiberUsd !== undefined) acc.fiberUsd += args.fiberUsd;
  if (args.urlsFetched !== undefined) acc.urlsFetched += args.urlsFetched;
}

/**
 * Firecrawl credits to USD. Mirrors the planner's default so the budget
 * arithmetic stays consistent. Callers on Standard tier override both
 * the planner tuning and this constant together.
 */
export const FIRECRAWL_USD_PER_CREDIT = 0.0063;

export function creditsToUsd(credits: number, ratePerCredit: number = FIRECRAWL_USD_PER_CREDIT): number {
  return credits * ratePerCredit;
}
