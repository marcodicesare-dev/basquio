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

  it("does not block distinct low-specificity share slides as duplicates", () => {
    const result = lintSlidePlan(
      [
        { position: 1, role: "cover", title: "Segafredo promotion review" },
        { position: 2, role: "exec-summary", title: "La quota resta sotto il mercato" },
        { position: 3, title: "La quota valore cresce ma i volumi restano deboli" },
        { position: 4, title: "Il contributo relativo spiega parte della pressione" },
        { position: 5, title: "La quota relativa non compensa il gap operativo" },
        { position: 6, title: "La quota finale cambia la qualità della pressione" },
      ],
      5,
    );

    assert.ok(
      !result.pairViolations.some((violation) => violation.rule === "redundant_analytical_cut"),
      "did not expect generic share language alone to create duplicate analytical cuts",
    );
    assert.ok(
      !result.deckViolations.some((violation) => violation.rule === "storyline_backtracking"),
      "did not expect generic branches to trigger storyline_backtracking",
    );
  });

  it("still catches exact duplicate generic share slides", () => {
    const result = lintSlidePlan(
      [
        { position: 1, role: "cover", title: "Segafredo promotion review" },
        { position: 2, role: "exec-summary", title: "La quota promo resta sotto il mercato" },
        { position: 3, title: "La quota valore resta sotto il mercato" },
        { position: 4, title: "La quota valore resta sotto il mercato" },
        { position: 5, title: "I tagli prezzo spiegano parte della pressione" },
      ],
      3,
    );

    assert.ok(
      result.pairViolations.some((violation) => violation.rule === "redundant_analytical_cut"),
      "expected exact generic duplicate slides to remain blocked",
    );
  });

  it("treats a terminal summary slide as structural for content-count enforcement", () => {
    const result = lintSlidePlan(
      [
        { position: 1, role: "cover", layoutId: "cover", title: "Coffee category review" },
        { position: 2, role: "exec-summary", layoutId: "exec-summary", title: "Executive summary" },
        { position: 3, layoutId: "title-chart", title: "Slide 1" },
        { position: 4, layoutId: "title-chart", title: "Slide 2" },
        { position: 5, layoutId: "title-chart", title: "Slide 3" },
        { position: 6, layoutId: "title-chart", title: "Slide 4" },
        { position: 7, layoutId: "title-chart", title: "Slide 5" },
        { position: 8, layoutId: "title-chart", title: "Slide 6" },
        { position: 9, layoutId: "title-chart", title: "Slide 7" },
        { position: 10, layoutId: "title-chart", title: "Slide 8" },
        { position: 11, layoutId: "recommendation-cards", title: "Slide 10" },
        { position: 12, layoutId: "summary", title: "Closing summary" },
      ],
      10,
    );

    assert.equal(result.contentSlideCount, 10);
    assert.ok(
      !result.deckViolations.some((violation) => violation.rule === "content_overflow"),
      "did not expect a trailing summary slide to trigger content_overflow",
    );
  });
});
