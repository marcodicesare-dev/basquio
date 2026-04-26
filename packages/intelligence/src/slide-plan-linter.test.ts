import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { lintSlidePlan } from "./slide-plan-linter";

/**
 * NIQ storyline-sequencing regression tests. Hardening file from
 * commit 22406d5: verbatim port of scripts/test-slide-plan-linter.ts.
 * Do NOT weaken assertions without Marco's explicit sign-off.
 */
describe("slide-plan-linter", () => {
  it("detects storyline_backtracking on non-contiguous segment branch", () => {
    const result = lintSlidePlan(
      [
        { position: 1, role: "cover", title: "Coffee category review" },
        { position: 2, title: "Category value grows +8%, but volume lags", pageIntent: "market overview" },
        { position: 3, title: "Capsules drive category momentum", pageIntent: "segment drill-down" },
        { position: 4, title: "Hypermarkets lose traffic", pageIntent: "channel drill-down" },
        { position: 5, title: "Ground coffee slows sharply", pageIntent: "segment drill-down" },
        { position: 6, title: "Promo mechanics explain the divergence", pageIntent: "promo mechanics" },
      ],
      5,
    );
    assert.ok(
      result.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
      "expected storyline_backtracking when the deck returns to a segment branch after switching away",
    );
  });

  it("stays silent when each branch is contiguous", () => {
    const result = lintSlidePlan(
      [
        { position: 1, role: "cover", title: "Coffee category review" },
        { position: 2, title: "Category value grows +8%, but volume lags", pageIntent: "market overview" },
        { position: 3, title: "Capsules drive category momentum", pageIntent: "segment drill-down" },
        { position: 4, title: "Ground coffee slows sharply", pageIntent: "segment drill-down" },
        { position: 5, title: "Hypermarkets lose traffic", pageIntent: "channel drill-down" },
        { position: 6, title: "Promo mechanics explain the divergence", pageIntent: "promo mechanics" },
      ],
      5,
    );
    assert.ok(
      !result.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
      "did not expect storyline_backtracking when each branch stays contiguous",
    );
  });

  it("allows explicit comparison-synthesis revisit", () => {
    const result = lintSlidePlan(
      [
        { position: 1, role: "cover", title: "Coffee category review" },
        { position: 2, title: "Category value grows +8%, but volume lags", pageIntent: "market overview" },
        { position: 3, title: "Capsules drive category momentum", pageIntent: "segment drill-down" },
        { position: 4, title: "Hypermarkets lose traffic", pageIntent: "channel drill-down" },
        {
          position: 5,
          title: "Capsules vs ground coffee: implications for Segafredo",
          pageIntent: "comparison synthesis",
        },
        { position: 6, title: "Promo mechanics explain the divergence", pageIntent: "promo mechanics" },
      ],
      5,
    );
    assert.ok(
      !result.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
      "did not expect storyline_backtracking for an explicit synthesis revisit",
    );
  });

  it("allows exec-summary to mention focal brand before a contiguous brand branch", () => {
    const result = lintSlidePlan(
      [
        { position: 1, role: "cover", title: "Coffee category review" },
        {
          position: 2,
          role: "exec-summary",
          title: "Market overview: Segafredo lags leaders",
          pageIntent: "market overview",
        },
        { position: 3, title: "Segafredo trails in capsules", pageIntent: "brand drill-down" },
        { position: 4, title: "Segafredo recovers in ground coffee", pageIntent: "brand drill-down" },
        { position: 5, title: "Hypermarkets slow the market", pageIntent: "channel drill-down" },
        {
          position: 6,
          title: "Brand comparison: capsules vs ground coffee",
          pageIntent: "comparison synthesis",
        },
      ],
      5,
    );
    assert.ok(
      !result.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
      "did not expect storyline_backtracking when an exec summary mentions the brand before a contiguous brand branch",
    );
  });

  it("allows explicit brand-summary exec overview", () => {
    const result = lintSlidePlan(
      [
        { position: 1, role: "cover", title: "Coffee category review" },
        {
          position: 2,
          role: "exec-summary",
          title: "Brand overview: Segafredo lags leaders",
          pageIntent: "market overview",
        },
        { position: 3, title: "Segafredo trails in capsules", pageIntent: "brand drill-down" },
        { position: 4, title: "Segafredo recovers in ground coffee", pageIntent: "brand drill-down" },
        { position: 5, title: "Hypermarkets slow the market", pageIntent: "channel drill-down" },
        {
          position: 6,
          title: "Brand comparison: capsules vs ground coffee",
          pageIntent: "comparison synthesis",
        },
      ],
      5,
    );
    assert.ok(
      !result.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
      "did not expect storyline_backtracking when the executive summary explicitly references the focal brand before a contiguous brand branch",
    );
  });

  it("detects storyline_backtracking on a late segment-summary revisit", () => {
    const result = lintSlidePlan(
      [
        { position: 1, role: "cover", title: "Coffee category review" },
        {
          position: 2,
          role: "exec-summary",
          title: "Market overview: value up, volume soft",
          pageIntent: "market overview",
        },
        { position: 3, title: "Capsules drive category momentum", pageIntent: "segment drill-down" },
        { position: 4, title: "Hypermarkets lose traffic", pageIntent: "channel drill-down" },
        {
          position: 5,
          role: "segment summary",
          title: "Segment summary: ground coffee is weakening",
          pageIntent: "segment summary",
        },
        { position: 6, title: "Promo mechanics explain the divergence", pageIntent: "promo mechanics" },
      ],
      5,
    );
    assert.ok(
      result.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
      "expected storyline_backtracking for a late segment-summary revisit after switching away from the segment branch",
    );
  });
});
