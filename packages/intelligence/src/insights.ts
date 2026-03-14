import {
  insightSpecSchema,
  type AnalyticsResult,
  type InsightSpec,
  type PackageSemantics,
  type ReportBrief,
  type StageTrace,
} from "@basquio/types";

import { generateStructuredStage } from "./model";
import { buildEvidenceId, compactUnique, scoreEvidence } from "./utils";

type RankInsightsInput = {
  analyticsResult: AnalyticsResult;
  packageSemantics: PackageSemantics;
  brief: ReportBrief;
  reviewFeedback?: string[];
};

type TraceOptions = {
  onTrace?: (trace: StageTrace) => void;
};

export async function rankInsights(input: RankInsightsInput, options: TraceOptions = {}): Promise<InsightSpec[]> {
  const modelId = process.env.BASQUIO_INSIGHT_MODEL || "gpt-5-mini";
  const llmResult = await generateStructuredStage({
    stage: "insight-ranking",
    schema: insightSpecSchema.array(),
    modelId,
    providerPreference: modelId.startsWith("claude") ? "anthropic" : "openai",
    prompt: [
      "You are a senior analyst ranking findings by business relevance.",
      "Use only the pre-computed analytics and evidence refs provided below.",
      "Every claim must cite evidence ids already present in the evidence list.",
      "",
      "## Brief",
      JSON.stringify(input.brief, null, 2),
      "",
      "## Package semantics",
      JSON.stringify(input.packageSemantics, null, 2),
      "",
      "## Analytics result",
      JSON.stringify(input.analyticsResult, null, 2),
      "",
      ...(input.reviewFeedback?.length
        ? [
            "## Reviewer feedback to address",
            ...input.reviewFeedback.map((item) => `- ${item}`),
          ]
        : []),
    ].join("\n"),
  });
  options.onTrace?.(llmResult.trace);

  if (llmResult.object && llmResult.object.length > 0) {
    const validEvidenceIds = new Set(input.analyticsResult.evidenceRefs.map((evidence) => evidence.id));

    return llmResult.object
      .map((insight, index) => {
        const validRefs = compactUnique(
          (insight.evidenceRefIds.length > 0 ? insight.evidenceRefIds : insight.evidence.map((evidence) => evidence.id)).filter((id) =>
            validEvidenceIds.has(id),
          ),
        );

        if (validRefs.length === 0) {
          return null;
        }

        const evidence = validRefs
          .map((id) => input.analyticsResult.evidenceRefs.find((candidate) => candidate.id === id))
          .filter((value): value is NonNullable<typeof value> => Boolean(value));

        return insightSpecSchema.parse({
          ...insight,
          rank: insight.rank || index + 1,
          confidence: scoreEvidence(evidence),
          confidenceLabel: validRefs.length >= 3 ? "HIGH" : validRefs.length >= 1 ? "MEDIUM" : "LOW",
          evidence,
          evidenceRefIds: validRefs,
        });
      })
      .filter((insight): insight is InsightSpec => Boolean(insight));
  }

  return buildFallbackInsights(input.analyticsResult, input.brief);
}

function buildFallbackInsights(analyticsResult: AnalyticsResult, brief: ReportBrief): InsightSpec[] {
  const topMetrics = analyticsResult.metrics
    .map((metric) => ({
      metric,
      score: scoreInsight(metric, brief),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);

  return topMetrics.map(({ metric }, index) => {
    const evidence = metric.evidenceRefIds
      .map((id) => analyticsResult.evidenceRefs.find((candidate) => candidate.id === id))
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
    const leadBreakout = Object.values(metric.byDimension)[0]?.[0];
    const title = leadBreakout
      ? `${humanizeMetric(metric.name)} shifts most in ${leadBreakout.key}`
      : `${humanizeMetric(metric.name)} is a lead analytical signal`;
    const claim = leadBreakout
      ? `${humanizeMetric(metric.name)} peaks at ${leadBreakout.key} with ${formatValue(leadBreakout.value)}.`
      : `${humanizeMetric(metric.name)} is materially shaping the report objective.`;
    const implication = brief.stakes
      ? `This matters because ${brief.stakes.replace(/\.$/, "").toLowerCase()}, making ${humanizeMetric(metric.name).toLowerCase()} an operating signal rather than appendix detail.`
      : `Use ${humanizeMetric(metric.name).toLowerCase()} to anchor the executive narrative and recommendations.`;

    return insightSpecSchema.parse({
      id: `insight-${metric.name}`,
      rank: index + 1,
      title,
      claim,
      businessMeaning: implication,
      finding: claim,
      implication,
      confidence: scoreEvidence(evidence),
      confidenceLabel: evidence.length >= 3 ? "HIGH" : evidence.length === 2 ? "MEDIUM" : "LOW",
      evidence,
      evidenceRefIds: evidence.map((item) => item.id),
      chartSuggestion: inferChartSuggestion(metric.name, metric.byDimension),
      slideEmphasis: index < 3 ? "lead" : index < 6 ? "support" : "detail",
      claims: [
        {
          id: buildEvidenceId({
            fileName: evidence[0]?.fileName,
            sheet: evidence[0]?.sheet || "metric",
            metric: metric.name,
            suffix: "claim",
          }),
          text: claim,
          kind: "finding",
          evidenceIds: evidence.map((item) => item.id),
          lineage: {
            insightId: `insight-${metric.name}`,
          },
        },
      ],
    });
  });
}

function humanizeMetric(value: string) {
  return value.replaceAll("_", " ");
}

function formatValue(value: number) {
  if (Math.abs(value) <= 1) {
    return `${(value * 100).toFixed(1)}%`;
  }

  return value.toFixed(2);
}

function inferChartSuggestion(metricName: string, byDimension: InsightSpec["evidenceRefIds"] | AnalyticsResult["metrics"][number]["byDimension"]) {
  const dimensionKey = typeof byDimension === "object" ? Object.keys(byDimension)[0] : "";
  if (metricName.includes("delta") || dimensionKey.includes("date") || dimensionKey.includes("month")) {
    return "line chart showing period-over-period change";
  }

  return "comparison bar chart of the leading grouped values";
}

function scoreInsight(metric: AnalyticsResult["metrics"][number], brief: ReportBrief) {
  let score = 0;

  const overallValue = typeof metric.overallValue === "number" ? metric.overallValue : Number(metric.overallValue);
  const cv = metric.stddev / Math.abs(overallValue || 1);
  score += Math.min(cv * 10, 30);

  const nameWords = metric.name.toLowerCase().split(/[_\s]+/);
  const objectiveWords = (brief.objective || "").toLowerCase().split(/\s+/);
  const overlap = nameWords.filter((word) => objectiveWords.includes(word)).length;
  score += overlap * 15;

  const evidenceCount = metric.evidenceRefIds.length;
  score += Math.min(evidenceCount * 2, 20);

  const dimensionCount = Object.keys(metric.byDimension).length;
  score += dimensionCount * 5;

  const firstDim = Object.values(metric.byDimension)[0];
  if (firstDim && firstDim.length >= 3) {
    const sorted = firstDim.map((dimension) => dimension.value).sort((left, right) => right - left);
    const topBottomRatio = sorted[0] / (sorted[sorted.length - 1] || 1);
    score += Math.min(topBottomRatio * 2, 20);
  }

  return score;
}
