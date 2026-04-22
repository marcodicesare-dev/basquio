import assert from "node:assert/strict";

import { lintSlidePlan } from "../packages/intelligence/src/slide-plan-linter";

function main() {
  const backtrackingResult = lintSlidePlan([
    { position: 1, role: "cover", title: "Coffee category review" },
    { position: 2, title: "Category value grows +8%, but volume lags", pageIntent: "market overview" },
    { position: 3, title: "Capsules drive category momentum", pageIntent: "segment drill-down" },
    { position: 4, title: "Hypermarkets lose traffic", pageIntent: "channel drill-down" },
    { position: 5, title: "Ground coffee slows sharply", pageIntent: "segment drill-down" },
    { position: 6, title: "Promo mechanics explain the divergence", pageIntent: "promo mechanics" },
  ], 5);

  assert.ok(
    backtrackingResult.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
    "expected storyline_backtracking when the deck returns to a segment branch after switching away",
  );

  const contiguousResult = lintSlidePlan([
    { position: 1, role: "cover", title: "Coffee category review" },
    { position: 2, title: "Category value grows +8%, but volume lags", pageIntent: "market overview" },
    { position: 3, title: "Capsules drive category momentum", pageIntent: "segment drill-down" },
    { position: 4, title: "Ground coffee slows sharply", pageIntent: "segment drill-down" },
    { position: 5, title: "Hypermarkets lose traffic", pageIntent: "channel drill-down" },
    { position: 6, title: "Promo mechanics explain the divergence", pageIntent: "promo mechanics" },
  ], 5);

  assert.ok(
    !contiguousResult.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
    "did not expect storyline_backtracking when each branch stays contiguous",
  );

  const synthesisResult = lintSlidePlan([
    { position: 1, role: "cover", title: "Coffee category review" },
    { position: 2, title: "Category value grows +8%, but volume lags", pageIntent: "market overview" },
    { position: 3, title: "Capsules drive category momentum", pageIntent: "segment drill-down" },
    { position: 4, title: "Hypermarkets lose traffic", pageIntent: "channel drill-down" },
    { position: 5, title: "Capsules vs ground coffee: implications for Segafredo", pageIntent: "comparison synthesis" },
    { position: 6, title: "Promo mechanics explain the divergence", pageIntent: "promo mechanics" },
  ], 5);

  assert.ok(
    !synthesisResult.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
    "did not expect storyline_backtracking for an explicit synthesis revisit",
  );

  const chapterBoundaryResult = lintSlidePlan([
    { position: 1, role: "cover", title: "Coffee category review" },
    { position: 2, role: "exec-summary", title: "Market overview: Segafredo lags leaders", pageIntent: "market overview" },
    { position: 3, title: "Segafredo trails in capsules", pageIntent: "brand drill-down" },
    { position: 4, title: "Segafredo recovers in ground coffee", pageIntent: "brand drill-down" },
    { position: 5, title: "Hypermarkets slow the market", pageIntent: "channel drill-down" },
    { position: 6, title: "Brand comparison: capsules vs ground coffee", pageIntent: "comparison synthesis" },
  ], 5);

  assert.ok(
    !chapterBoundaryResult.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
    "did not expect storyline_backtracking when an exec summary mentions the brand before a contiguous brand branch",
  );

  const explicitBrandSummaryResult = lintSlidePlan([
    { position: 1, role: "cover", title: "Coffee category review" },
    { position: 2, role: "exec-summary", title: "Brand overview: Segafredo lags leaders", pageIntent: "market overview" },
    { position: 3, title: "Segafredo trails in capsules", pageIntent: "brand drill-down" },
    { position: 4, title: "Segafredo recovers in ground coffee", pageIntent: "brand drill-down" },
    { position: 5, title: "Hypermarkets slow the market", pageIntent: "channel drill-down" },
    { position: 6, title: "Brand comparison: capsules vs ground coffee", pageIntent: "comparison synthesis" },
  ], 5);

  assert.ok(
    !explicitBrandSummaryResult.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
    "did not expect storyline_backtracking when the executive summary explicitly references the focal brand before a contiguous brand branch",
  );

  const lateSummaryBacktrackingResult = lintSlidePlan([
    { position: 1, role: "cover", title: "Coffee category review" },
    { position: 2, role: "exec-summary", title: "Market overview: value up, volume soft", pageIntent: "market overview" },
    { position: 3, title: "Capsules drive category momentum", pageIntent: "segment drill-down" },
    { position: 4, title: "Hypermarkets lose traffic", pageIntent: "channel drill-down" },
    { position: 5, role: "segment summary", title: "Segment summary: ground coffee is weakening", pageIntent: "segment summary" },
    { position: 6, title: "Promo mechanics explain the divergence", pageIntent: "promo mechanics" },
  ], 5);

  assert.ok(
    lateSummaryBacktrackingResult.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
    "expected storyline_backtracking for a late segment-summary revisit after switching away from the segment branch",
  );

  process.stdout.write("slide plan linter storyline sequencing regressions passed\n");
}

main();
