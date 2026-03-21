// ─── EVAL HARNESS ─────────────────────────────────────────────────
// Benchmark framework for scoring deck runs against quality targets.
// Run with: npx tsx packages/intelligence/src/eval-harness.ts
//
// This is the skeleton. Benchmark corpus must be populated with real
// FMCG briefs and expected outputs before claims become falsifiable.

// ─── TYPES ────────────────────────────────────────────────────────

export type EvalDimension =
  | "factuality"        // numeric claims match computed evidence
  | "evidence_linkage"  // every claim cites valid evidence IDs
  | "strategic_value"   // recommendations are specific, quantified, FMCG-lever-based
  | "writing_quality"   // passes writing linter with 0 critical, <3 major
  | "visual_quality"    // layout variety, chart coverage, density discipline
  | "compatibility"     // PPTX opens in PowerPoint, Slides, Keynote without repair
  | "cost";             // total run cost <= $1.00

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
  language: "en" | "it";
  notes: string;
};

// ─── THRESHOLDS ───────────────────────────────────────────────────

export const EVAL_THRESHOLDS: Record<EvalDimension, number> = {
  factuality: 0.9,          // 90% of numeric claims verifiable
  evidence_linkage: 0.8,    // 80% of slides cite valid evidence
  strategic_value: 0.7,     // 70% of recommendations are specific + quantified
  writing_quality: 0.85,    // <3 major writing violations per deck
  visual_quality: 0.8,      // 3+ layout types, >70% chart coverage
  compatibility: 1.0,       // 100% — PPTX must open cleanly
  cost: 1.0,                // 100% — must be under $1.00
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
    language: "en",
    notes: "English brief on Italian data — tests language routing",
  },
];

// ─── AGGREGATE REPORTING ──────────────────────────────────────────

export function aggregateEvals(evals: RunEval[]): {
  totalRuns: number;
  passRate: number;
  medianCost: number;
  p95Cost: number;
  dimensionPassRates: Record<EvalDimension, number>;
  publishGradeMix: Record<string, number>;
} {
  const totalRuns = evals.length;
  const passRate = evals.filter(e => e.overallPassed).length / Math.max(totalRuns, 1);

  const costs = evals.map(e => e.totalCostUsd).sort((a, b) => a - b);
  const medianCost = costs[Math.floor(costs.length / 2)] ?? 0;
  const p95Cost = costs[Math.floor(costs.length * 0.95)] ?? 0;

  const dimensions: EvalDimension[] = ["factuality", "evidence_linkage", "strategic_value", "writing_quality", "visual_quality", "compatibility", "cost"];
  const dimensionPassRates: Record<string, number> = {};
  for (const dim of dimensions) {
    const dimScores = evals.flatMap(e => e.scores.filter(s => s.dimension === dim));
    dimensionPassRates[dim] = dimScores.filter(s => s.passed).length / Math.max(dimScores.length, 1);
  }

  const publishGradeMix: Record<string, number> = { green: 0, yellow: 0, red: 0 };
  for (const e of evals) {
    publishGradeMix[e.publishGrade] = (publishGradeMix[e.publishGrade] ?? 0) + 1;
  }

  return {
    totalRuns,
    passRate,
    medianCost,
    p95Cost,
    dimensionPassRates: dimensionPassRates as Record<EvalDimension, number>,
    publishGradeMix,
  };
}
