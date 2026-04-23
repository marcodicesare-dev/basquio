import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  aggregateEvals,
  determineOverallPassed,
  hasCompleteHardBlockingScorecard,
  resolveOverallPassed,
  resolveScorecardPassed,
  scoreClientFriendlyCopy,
  scoreCost,
  scoreDecimalDiscipline,
  scoreEvidenceLinkage,
  scoreIntelligenceNonNegotiables,
  scoreNarrativeLinearity,
  scorePromoAnalyticalDepth,
  scoreVisualQuality,
  type EvalScore,
} from "./eval-harness";

/**
 * NIQ eval-harness regression tests. Hardening file from commit 22406d5:
 * do NOT weaken assertions without Marco's explicit sign-off. This file
 * is a verbatim port of scripts/test-eval-harness.ts into Vitest so
 * the same assertion set runs under the monorepo test runner.
 */
describe("eval-harness", () => {
  it("aggregate scorecard regression", () => {
    const styleWin = scoreClientFriendlyCopy({
      clarityScore: 0.92,
      commercialToneScore: 0.9,
      concisionScore: 0.86,
    });
    assert.equal(styleWin.passed, true);

    const intelligenceFailure = scoreIntelligenceNonNegotiables({
      inventedTargets: 1,
      inventedMotives: 0,
      claimChartMismatches: 0,
      focalBrandOmissions: 0,
      distributionClaimsWithoutProductivityProof: 0,
      inflationPivotMisses: 0,
      redundantAnalyticalCuts: 0,
      decimalPolicyViolations: 0,
    });
    assert.equal(intelligenceFailure.passed, false);

    const healthySupportScores: EvalScore[] = [
      { dimension: "factuality", score: 1, passed: true, details: "all numeric claims verified" },
      scoreEvidenceLinkage([
        { position: 2, evidenceIds: ["e1"], layoutId: "bar-chart" },
        { position: 3, evidenceIds: ["e2"], layoutId: "table-chart" },
      ]),
      scoreVisualQuality([
        { layoutId: "cover" },
        { layoutId: "bar-chart", chartId: "c1" },
        { layoutId: "table-chart", chartId: "c2" },
        { layoutId: "line-chart", chartId: "c3" },
        { layoutId: "split-callout", chartId: "c4" },
      ]),
      scoreNarrativeLinearity({
        redundantAnalyticalCuts: 0,
        unsupportedLeaps: 0,
        offSequencePromoSlides: 0,
        totalAnalyticalSlides: 6,
      }),
      scorePromoAnalyticalDepth({
        hasCategoryBaseline: true,
        hasValueVolumePriceBridge: true,
        hasPromoVsNoPromoCut: true,
        hasDiscountTierCut: true,
        hasChannelOrFormatLocalization: true,
        hasMechanicsEvidence: true,
        hasFocalBrandVsCompetitorRead: true,
        hasOpportunitySynthesis: true,
      }),
      scoreDecimalDiscipline(0, 12),
      { dimension: "compatibility", score: 1, passed: true, details: "pptx opens cleanly" },
      styleWin,
    ];

    assert.equal(determineOverallPassed([...healthySupportScores, intelligenceFailure]), false);

    const intelligencePass = scoreIntelligenceNonNegotiables({
      inventedTargets: 0,
      inventedMotives: 0,
      claimChartMismatches: 0,
      focalBrandOmissions: 0,
      distributionClaimsWithoutProductivityProof: 0,
      inflationPivotMisses: 0,
      redundantAnalyticalCuts: 0,
      decimalPolicyViolations: 0,
    });
    assert.equal(determineOverallPassed([...healthySupportScores, intelligencePass]), true);

    const incompleteHardBlockers: EvalScore[] = [styleWin, scoreCost(0.8)];
    assert.equal(hasCompleteHardBlockingScorecard(incompleteHardBlockers), false);
    assert.equal(determineOverallPassed(incompleteHardBlockers), false);

    const fallbackLegacyEval = {
      runId: "legacy-1",
      brief: "legacy scorecard",
      timestamp: new Date().toISOString(),
      scores: incompleteHardBlockers,
      overallPassed: true,
      totalCostUsd: 0.8,
      slideCount: 10,
      publishGrade: "green" as const,
    };
    assert.equal(resolveOverallPassed(fallbackLegacyEval), true);

    const incompleteButFailedHardBlockerEval = {
      ...fallbackLegacyEval,
      runId: "legacy-hard-failure",
      scores: [intelligenceFailure, styleWin],
    };
    assert.equal(resolveOverallPassed(incompleteButFailedHardBlockerEval), false);

    const fullyScoredEval = {
      runId: "full-1",
      brief: "full scorecard",
      timestamp: new Date().toISOString(),
      scores: [...healthySupportScores, intelligencePass],
      overallPassed: false,
      totalCostUsd: 0.8,
      slideCount: 10,
      publishGrade: "green" as const,
    };
    assert.equal(resolveOverallPassed(fullyScoredEval), true);
    assert.equal(resolveScorecardPassed(fullyScoredEval), true);

    const softFailureEval = {
      ...fullyScoredEval,
      runId: "soft-failure-1",
      scores: fullyScoredEval.scores.map((score) =>
        score.dimension === "client_friendly_copy"
          ? { ...score, passed: false, score: 0.4, details: "copy too stiff" }
          : score,
      ),
    };
    assert.equal(resolveOverallPassed(softFailureEval), true);
    assert.equal(resolveScorecardPassed(softFailureEval), false);

    const aggregate = aggregateEvals([fallbackLegacyEval, fullyScoredEval, softFailureEval]);
    assert.equal(aggregate.passRate, 2 / 3);
    assert.equal(aggregate.hardGatePassRate, 1);
    assert.equal(aggregate.dimensionMeasuredCounts.client_friendly_copy, 3);
    assert.equal(aggregate.dimensionMeasuredCounts.strategic_value, 0);
    assert.ok(Number.isNaN(aggregate.dimensionPassRates.strategic_value));

    const notApplicablePromoDepth = scorePromoAnalyticalDepth({
      hasCategoryBaseline: null,
      hasValueVolumePriceBridge: null,
      hasPromoVsNoPromoCut: null,
      hasDiscountTierCut: null,
      hasChannelOrFormatLocalization: null,
      hasMechanicsEvidence: null,
      hasFocalBrandVsCompetitorRead: null,
      hasOpportunitySynthesis: null,
    });
    assert.equal(notApplicablePromoDepth.passed, true);
    assert.equal(notApplicablePromoDepth.score, 1);
  });
});
