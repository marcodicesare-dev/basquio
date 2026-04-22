// ─── EVAL HARNESS ─────────────────────────────────────────────────
// Benchmark framework for scoring deck runs against quality targets.
// Run with: npx tsx packages/intelligence/src/eval-harness.ts
//
// This is the skeleton. Benchmark corpus must be populated with real
// FMCG briefs and expected outputs before claims become falsifiable.

// ─── TYPES ────────────────────────────────────────────────────────

export type EvalDimension =
  | "factuality"                  // numeric claims match computed evidence
  | "evidence_linkage"            // every claim cites valid evidence IDs
  | "strategic_value"             // recommendations are specific, quantified, FMCG-lever-based
  | "writing_quality"             // passes writing linter with 0 critical, <3 major
  | "visual_quality"              // layout variety, chart coverage, density discipline
  | "compatibility"               // PPTX opens in PowerPoint, Slides, Keynote without repair
  | "cost"                        // total run cost <= $1.00
  | "intelligence_non_negotiables" // hard blockers: no hallucinated target, evidence mismatch, etc.
  | "narrative_linearity"         // problem flow is progressive, not redundant or chaotic
  | "promo_analytical_depth"      // promo work drills down across mechanics rather than summarizing
  | "decimal_discipline"          // numeric precision follows NIQ deterministic policy
  | "client_friendly_copy";       // copy is clear and commercial, but never overrides intelligence

export type EvalScore = {
  dimension: EvalDimension;
  score: number;        // 0.0 to 1.0
  passed: boolean;      // meets threshold
  details: string;
};

export type RunEval = {
  runId: string;
  brief: string;
  timestamp: string;
  scores: EvalScore[];
  overallPassed: boolean;
  totalCostUsd: number;
  slideCount: number;
  publishGrade: "green" | "yellow" | "red";
};

export type BenchmarkCase = {
  id: string;
  brief: string;
  dataFiles: string[];     // paths to test data files
  expectedDomain: string;  // "rms" | "cps" | "mixed"
  expectedSlideRange: [number, number]; // [min, max]
  requiredEvidence: string[];  // evidence types that must be computed
  requiredChartTypes: string[]; // chart families that should appear
  criticalInvariants?: string[]; // must not regress even if style improves
  styleObjectives?: string[]; // softer presentation goals to optimize after invariants
  language: "en" | "it";
  notes: string;
};

export type IntelligenceInvariantFlags = {
  inventedTargets: number;
  inventedMotives: number;
  claimChartMismatches: number;
  focalBrandOmissions: number;
  distributionClaimsWithoutProductivityProof: number;
  inflationPivotMisses: number;
  redundantAnalyticalCuts: number;
  decimalPolicyViolations: number;
};

export type NarrativeLinearityInput = {
  redundantAnalyticalCuts: number;
  unsupportedLeaps: number;
  offSequencePromoSlides: number;
  totalAnalyticalSlides: number;
};

export type PromoAnalyticalDepthInput = {
  hasCategoryBaseline: boolean | null;
  hasValueVolumePriceBridge: boolean | null;
  hasPromoVsNoPromoCut: boolean | null;
  hasDiscountTierCut: boolean | null;
  hasChannelOrFormatLocalization: boolean | null;
  hasMechanicsEvidence: boolean | null;
  hasFocalBrandVsCompetitorRead: boolean | null;
  hasOpportunitySynthesis: boolean | null;
};

export type ClientFriendlyCopyInput = {
  clarityScore: number; // 0..1
  commercialToneScore: number; // 0..1
  concisionScore: number; // 0..1
};

export const HARD_BLOCKING_DIMENSIONS: EvalDimension[] = [
  "factuality",
  "evidence_linkage",
  "compatibility",
  "intelligence_non_negotiables",
  "decimal_discipline",
];

export const REPORTING_DIMENSIONS: EvalDimension[] = [
  "factuality",
  "evidence_linkage",
  "strategic_value",
  "writing_quality",
  "visual_quality",
  "compatibility",
  "cost",
  "intelligence_non_negotiables",
  "narrative_linearity",
  "promo_analytical_depth",
  "decimal_discipline",
  "client_friendly_copy",
];

// ─── THRESHOLDS ───────────────────────────────────────────────────

export const EVAL_THRESHOLDS: Record<EvalDimension, number> = {
  factuality: 0.9,          // 90% of numeric claims verifiable
  evidence_linkage: 0.8,    // 80% of slides cite valid evidence
  strategic_value: 0.7,     // 70% of recommendations are specific + quantified
  writing_quality: 0.85,    // <3 major writing violations per deck
  visual_quality: 0.8,      // 3+ layout types, >70% chart coverage
  compatibility: 1.0,       // 100% — PPTX must open cleanly
  cost: 1.0,                // 100% — must be under $1.00
  intelligence_non_negotiables: 1.0, // zero hard analytical violations
  narrative_linearity: 0.85, // no redundant or out-of-sequence analytical jumps
  promo_analytical_depth: 0.85, // promo drill-down should cover the essential NIQ cascade
  decimal_discipline: 1.0, // deterministic NIQ decimals are hard requirements
  client_friendly_copy: 0.75, // optimize for clarity/commercial tone after intelligence is safe
};

// ─── SCORING FUNCTIONS ────────────────────────────────────────────

export function scoreWritingQuality(lintResult: {
  passed: boolean;
  slideResults: Array<{ result: { violations: Array<{ severity: string }> } }>;
  deckViolations: Array<{ severity: string }>;
}): EvalScore {
  const allViolations = [
    ...lintResult.slideResults.flatMap(r => r.result.violations),
    ...lintResult.deckViolations,
  ];
  const criticalCount = allViolations.filter(v => v.severity === "critical").length;
  const majorCount = allViolations.filter(v => v.severity === "major").length;
  const totalSlides = lintResult.slideResults.length;

  // Score: 1.0 if 0 critical and 0 major, drops with each violation
  const penalty = (criticalCount * 0.2) + (majorCount * 0.05);
  const score = Math.max(0, 1 - penalty);

  return {
    dimension: "writing_quality",
    score,
    passed: criticalCount === 0 && majorCount < 3,
    details: `${criticalCount} critical, ${majorCount} major violations across ${totalSlides} slides`,
  };
}

export function scoreVisualQuality(slides: Array<{
  layoutId: string;
  chartId?: string;
}>): EvalScore {
  const layoutCounts: Record<string, number> = {};
  for (const s of slides) {
    layoutCounts[s.layoutId] = (layoutCounts[s.layoutId] ?? 0) + 1;
  }
  const uniqueLayouts = Object.keys(layoutCounts).length;
  const chartSlides = slides.filter(s => s.chartId);
  const analyticalSlides = slides.filter(s => !["cover", "section-divider"].includes(s.layoutId));
  const chartCoverage = analyticalSlides.length > 0 ? chartSlides.length / analyticalSlides.length : 0;

  const layoutScore = Math.min(1, uniqueLayouts / 4); // 4+ distinct layouts = 1.0
  const chartScore = Math.min(1, chartCoverage / 0.7); // 70%+ coverage = 1.0
  const score = (layoutScore + chartScore) / 2;

  return {
    dimension: "visual_quality",
    score,
    passed: score >= EVAL_THRESHOLDS.visual_quality,
    details: `${uniqueLayouts} layout types, ${Math.round(chartCoverage * 100)}% chart coverage`,
  };
}

export function scoreCost(totalCostUsd: number): EvalScore {
  const passed = totalCostUsd <= 1.0;
  return {
    dimension: "cost",
    score: passed ? 1.0 : Math.max(0, 1 - (totalCostUsd - 1.0)),
    passed,
    details: `$${totalCostUsd.toFixed(2)} (target: <$1.00)`,
  };
}

export function scoreIntelligenceNonNegotiables(flags: IntelligenceInvariantFlags): EvalScore {
  const totalViolations = Object.values(flags).reduce((sum, count) => sum + count, 0);
  return {
    dimension: "intelligence_non_negotiables",
    score: totalViolations === 0 ? 1 : 0,
    passed: totalViolations === 0,
    details: totalViolations === 0
      ? "No hard analytical violations detected"
      : [
          `invented_targets=${flags.inventedTargets}`,
          `invented_motives=${flags.inventedMotives}`,
          `claim_chart_mismatches=${flags.claimChartMismatches}`,
          `focal_brand_omissions=${flags.focalBrandOmissions}`,
          `distribution_without_productivity=${flags.distributionClaimsWithoutProductivityProof}`,
          `inflation_pivot_misses=${flags.inflationPivotMisses}`,
          `redundant_analytical_cuts=${flags.redundantAnalyticalCuts}`,
          `decimal_policy_violations=${flags.decimalPolicyViolations}`,
        ].join(", "),
  };
}

export function scoreNarrativeLinearity(input: NarrativeLinearityInput): EvalScore {
  const totalPenaltyPoints =
    input.redundantAnalyticalCuts +
    input.unsupportedLeaps +
    input.offSequencePromoSlides;
  const normalizedPenalty =
    input.totalAnalyticalSlides > 0 ? totalPenaltyPoints / input.totalAnalyticalSlides : 1;
  const score = Math.max(0, 1 - normalizedPenalty);

  return {
    dimension: "narrative_linearity",
    score,
    passed: score >= EVAL_THRESHOLDS.narrative_linearity,
    details: `${input.redundantAnalyticalCuts} redundant cuts, ${input.unsupportedLeaps} unsupported leaps, ${input.offSequencePromoSlides} off-sequence promo slides across ${input.totalAnalyticalSlides} analytical slides`,
  };
}

export function scorePromoAnalyticalDepth(input: PromoAnalyticalDepthInput): EvalScore {
  const checks = [
    input.hasCategoryBaseline,
    input.hasValueVolumePriceBridge,
    input.hasPromoVsNoPromoCut,
    input.hasDiscountTierCut,
    input.hasChannelOrFormatLocalization,
    input.hasMechanicsEvidence,
    input.hasFocalBrandVsCompetitorRead,
    input.hasOpportunitySynthesis,
  ];
  const applicableChecks = checks.filter((check): check is boolean => check !== null);
  if (applicableChecks.length === 0) {
    return {
      dimension: "promo_analytical_depth",
      score: 1,
      passed: true,
      details: "Not applicable for this deck or evidence package",
    };
  }
  const passedChecks = applicableChecks.filter(Boolean).length;
  const score = passedChecks / applicableChecks.length;

  return {
    dimension: "promo_analytical_depth",
    score,
    passed: score >= EVAL_THRESHOLDS.promo_analytical_depth,
    details: `${passedChecks}/${applicableChecks.length} NIQ promo drill-down stages covered`,
  };
}

export function scoreDecimalDiscipline(violations: number, auditedMetrics: number): EvalScore {
  const score = violations === 0 ? 1 : Math.max(0, 1 - (violations / Math.max(auditedMetrics, 1)));
  return {
    dimension: "decimal_discipline",
    score,
    passed: violations === 0,
    details: violations === 0
      ? `0 decimal-policy violations across ${auditedMetrics} audited metrics`
      : `${violations} decimal-policy violations across ${auditedMetrics} audited metrics`,
  };
}

export function scoreClientFriendlyCopy(input: ClientFriendlyCopyInput): EvalScore {
  const score = (input.clarityScore + input.commercialToneScore + input.concisionScore) / 3;
  return {
    dimension: "client_friendly_copy",
    score,
    passed: score >= EVAL_THRESHOLDS.client_friendly_copy,
    details: `clarity=${input.clarityScore.toFixed(2)}, commercial_tone=${input.commercialToneScore.toFixed(2)}, concision=${input.concisionScore.toFixed(2)}`,
  };
}

export function scoreEvidenceLinkage(slides: Array<{
  position: number;
  evidenceIds?: string[];
  layoutId: string;
}>): EvalScore {
  const analyticalSlides = slides.filter(s => !["cover", "section-divider"].includes(s.layoutId));
  const slidesWithEvidence = analyticalSlides.filter(s => s.evidenceIds && s.evidenceIds.length > 0);
  const coverage = analyticalSlides.length > 0 ? slidesWithEvidence.length / analyticalSlides.length : 0;

  return {
    dimension: "evidence_linkage",
    score: coverage,
    passed: coverage >= EVAL_THRESHOLDS.evidence_linkage,
    details: `${slidesWithEvidence.length}/${analyticalSlides.length} analytical slides cite evidence`,
  };
}

export function determineOverallPassed(scores: EvalScore[]): boolean {
  if (!hasCompleteHardBlockingScorecard(scores)) {
    return false;
  }
  const hardFailures = scores.some((score) =>
    HARD_BLOCKING_DIMENSIONS.includes(score.dimension) && !score.passed,
  );
  if (hardFailures) {
    return false;
  }
  return scores.every((score) => score.passed || !HARD_BLOCKING_DIMENSIONS.includes(score.dimension));
}

export function hasCompleteHardBlockingScorecard(scores: EvalScore[]): boolean {
  const presentDimensions = new Set(scores.map((score) => score.dimension));
  return HARD_BLOCKING_DIMENSIONS.every((dimension) => presentDimensions.has(dimension));
}

export function resolveOverallPassed(runEval: RunEval): boolean {
  const hardFailurePresent = runEval.scores.some((score) =>
    HARD_BLOCKING_DIMENSIONS.includes(score.dimension) && !score.passed,
  );
  if (hardFailurePresent) {
    return false;
  }

  return hasCompleteHardBlockingScorecard(runEval.scores)
    ? determineOverallPassed(runEval.scores)
    : runEval.overallPassed;
}

export function resolveScorecardPassed(runEval: RunEval): boolean {
  if (runEval.scores.length === 0) {
    return runEval.overallPassed;
  }

  return runEval.scores.every((score) => score.passed);
}

// ─── BENCHMARK CORPUS (to be populated with real FMCG data) ──────

export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "affinity-petfood-discount",
    brief: "Analisi del canale Discount per Affinity Petcare. Come sta performando il brand rispetto al mercato? Dove ci sono opportunità di crescita?",
    dataFiles: ["affinity-petfood-discount.xlsx"],
    expectedDomain: "rms",
    expectedSlideRange: [8, 12],
    requiredEvidence: ["value_share_pct", "share_change_pts", "value_growth_pct", "distribution"],
    requiredChartTypes: ["ranked_share_bar", "cy_vs_py_grouped"],
    criticalInvariants: [
      "no_invented_targets",
      "claim_chart_binding",
      "focal_brand_persistence",
      "deterministic_decimals",
    ],
    styleObjectives: ["client_friendly_copy", "clear_recommendation_titles"],
    language: "it",
    notes: "Core ICP test case — NIQ category analyst reviewing Affinity in Discount channel",
  },
  {
    id: "generic-fmcg-category-review",
    brief: "Full category performance review for the pasta category in Italy. Focus on private label vs branded, distribution gaps, and pricing dynamics.",
    dataFiles: ["pasta-category-review.xlsx"],
    expectedDomain: "mixed",
    expectedSlideRange: [8, 12],
    requiredEvidence: ["value_share_pct", "price_index", "distribution", "mix_pct"],
    requiredChartTypes: ["ranked_share_bar", "mix_comparison_stack", "cy_vs_py_grouped"],
    criticalInvariants: [
      "inflation_aware_value_to_volume_pivot",
      "claim_chart_binding",
      "deterministic_decimals",
    ],
    styleObjectives: ["client_friendly_copy", "narrative_linearity"],
    language: "en",
    notes: "English brief on Italian data — tests language routing",
  },
];

// ─── AGGREGATE REPORTING ──────────────────────────────────────────

export function aggregateEvals(evals: RunEval[]): {
  totalRuns: number;
  passRate: number;
  hardGatePassRate: number;
  medianCost: number;
  p95Cost: number;
  dimensionPassRates: Record<EvalDimension, number>;
  dimensionMeasuredCounts: Record<EvalDimension, number>;
  publishGradeMix: Record<string, number>;
} {
  const totalRuns = evals.length;
  const passRate = evals.filter((runEval) => resolveScorecardPassed(runEval)).length / Math.max(totalRuns, 1);
  const hardGatePassRate = evals.filter((runEval) => resolveOverallPassed(runEval)).length / Math.max(totalRuns, 1);

  const costs = evals.map(e => e.totalCostUsd).sort((a, b) => a - b);
  const medianCost = costs[Math.floor(costs.length / 2)] ?? 0;
  const p95Cost = costs[Math.floor(costs.length * 0.95)] ?? 0;

  const dimensionPassRates: Record<string, number> = {};
  const dimensionMeasuredCounts: Record<string, number> = {};
  for (const dim of REPORTING_DIMENSIONS) {
    const dimScores = evals.flatMap(e => e.scores.filter(s => s.dimension === dim));
    dimensionMeasuredCounts[dim] = dimScores.length;
    dimensionPassRates[dim] = dimScores.length > 0
      ? dimScores.filter(s => s.passed).length / dimScores.length
      : Number.NaN;
  }

  const publishGradeMix: Record<string, number> = { green: 0, yellow: 0, red: 0 };
  for (const e of evals) {
    publishGradeMix[e.publishGrade] = (publishGradeMix[e.publishGrade] ?? 0) + 1;
  }

  return {
    totalRuns,
    passRate,
    hardGatePassRate,
    medianCost,
    p95Cost,
    dimensionPassRates: dimensionPassRates as Record<EvalDimension, number>,
    dimensionMeasuredCounts: dimensionMeasuredCounts as Record<EvalDimension, number>,
    publishGradeMix,
  };
}
