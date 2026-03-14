import { z } from "zod";

import {
  validationReportSchema,
  type AnalyticsResult,
  type ChartSpec,
  type InsightSpec,
  type SlideSpec,
  type StageTrace,
  type StorySpec,
  type ValidationIssue,
  type ValidationReport,
} from "@basquio/types";

import { generateStructuredStage } from "./model";

const semanticReviewSchema = z.object({
  status: z.enum(["passed", "needs_input"]),
  issues: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["error", "warning"]).default("warning"),
      message: z.string(),
      backtrackStage: z.enum(["metrics", "insights", "story", "slides"]).default("slides"),
      claimId: z.string().optional(),
      slideId: z.string().optional(),
      chartId: z.string().optional(),
      evidenceId: z.string().optional(),
    }),
  ).default([]),
});

export async function validateExecutionPlan(input: {
  jobId: string;
  analyticsResult: AnalyticsResult;
  insights: InsightSpec[];
  slides: SlideSpec[];
  charts: ChartSpec[];
  story: StorySpec;
  stageTraces?: StageTrace[];
  attemptCount?: number;
}): Promise<ValidationReport> {
  const deterministicIssues = [
    ...validateReferentialIntegrity(input.analyticsResult, input.insights, input.slides, input.charts),
    ...validateNumericAssertions(input.slides, input.analyticsResult),
    ...validateEvidenceExists(input.insights, input.analyticsResult),
    ...validateStructuralConsistency(input.slides, input.charts, input.story, input.analyticsResult),
  ].map((issue) => ({
    ...issue,
    validator: "deterministic" as const,
    backtrackStage: issue.backtrackStage ?? inferBacktrackStage(issue.code),
  }));

  const semanticReview = await reviewSemantically(input);
  const semanticIssues = (semanticReview.result?.issues ?? []).map((issue) => ({
    ...issue,
    validator: "semantic" as const,
  }));

  const issues = [...deterministicIssues, ...semanticIssues];

  return validationReportSchema.parse({
    jobId: input.jobId,
    generatedAt: new Date().toISOString(),
    status:
      issues.some((issue) => issue.severity === "error") || semanticReview.result?.status === "needs_input"
        ? "needs_input"
        : "passed",
    claimCount: input.insights.flatMap((insight) => insight.claims).length,
    chartCount: input.charts.length,
    slideCount: input.slides.length,
    attemptCount: input.attemptCount || 1,
    issues,
    traces: [
      ...(input.stageTraces ?? []),
      ...(semanticReview.trace ? [semanticReview.trace] : []),
    ],
  });
}

async function reviewSemantically(input: {
  jobId: string;
  analyticsResult: AnalyticsResult;
  insights: InsightSpec[];
  slides: SlideSpec[];
  charts: ChartSpec[];
  story: StorySpec;
  stageTraces?: StageTrace[];
}) {
  const reviewer = selectReviewerModel(input.stageTraces ?? []);
  const review = await generateStructuredStage({
    stage: "semantic-review",
    schema: semanticReviewSchema,
    modelId: reviewer.modelId,
    providerPreference: reviewer.providerPreference,
    prompt: [
      "You are an independent report critic reviewing an evidence-backed executive deck plan.",
      "Do not recompute numbers. Judge whether the story overreaches, whether recommendations are unsupported, whether transitions are incoherent, and whether the slide plan actually matches the analytics and evidence.",
      "If the right fix is upstream, set backtrackStage accordingly: metrics, insights, story, or slides.",
      "",
      "## Analytics result",
      JSON.stringify(input.analyticsResult, null, 2),
      "",
      "## Ranked insights",
      JSON.stringify(input.insights, null, 2),
      "",
      "## Story",
      JSON.stringify(input.story, null, 2),
      "",
      "## Slides",
      JSON.stringify(input.slides, null, 2),
      "",
      "## Charts",
      JSON.stringify(input.charts, null, 2),
    ].join("\n"),
  });

  return {
    result: review.object,
    trace: review.trace.provider === "none" ? null : review.trace,
  };
}

function selectReviewerModel(stageTraces: StageTrace[]) {
  const explicitModel = process.env.BASQUIO_VALIDATION_MODEL;
  if (explicitModel) {
    return {
      modelId: explicitModel,
      providerPreference: explicitModel.startsWith("claude") ? ("anthropic" as const) : ("openai" as const),
    };
  }

  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const lastPrimaryProvider = [...stageTraces]
    .reverse()
    .find((trace) => trace.provider === "anthropic" || trace.provider === "openai")?.provider;

  if (hasAnthropic && hasOpenAi) {
    if (lastPrimaryProvider === "anthropic") {
      return { modelId: process.env.BASQUIO_VALIDATION_OPENAI_MODEL || "gpt-5-mini", providerPreference: "openai" as const };
    }
    if (lastPrimaryProvider === "openai") {
      return {
        modelId: process.env.BASQUIO_VALIDATION_ANTHROPIC_MODEL || "claude-sonnet-4-6",
        providerPreference: "anthropic" as const,
      };
    }
  }

  if (hasAnthropic) {
    return {
      modelId: process.env.BASQUIO_VALIDATION_ANTHROPIC_MODEL || "claude-sonnet-4-6",
      providerPreference: "anthropic" as const,
    };
  }

  return {
    modelId: process.env.BASQUIO_VALIDATION_OPENAI_MODEL || "gpt-5-mini",
    providerPreference: "openai" as const,
  };
}

function validateReferentialIntegrity(
  analyticsResult: AnalyticsResult,
  insights: InsightSpec[],
  slides: SlideSpec[],
  charts: ChartSpec[],
) {
  const evidenceIds = new Set(analyticsResult.evidenceRefs.map((evidence) => evidence.id));
  const claimIds = new Set(insights.flatMap((insight) => insight.claims.map((claim) => claim.id)));
  const chartIds = new Set(charts.map((chart) => chart.id));
  const issues: Array<Omit<ValidationIssue, "validator">> = [];

  for (const slide of slides) {
    for (const claimId of slide.claimIds) {
      if (!claimIds.has(claimId)) {
        issues.push({
          code: "missing-claim",
          severity: "error",
          message: `Slide ${slide.id} references claim ${claimId} but no ranked insight produced it.`,
          slideId: slide.id,
          claimId,
        });
      }
    }

    for (const evidenceId of slide.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push({
          code: "missing-evidence",
          severity: "error",
          message: `Slide ${slide.id} references evidence ${evidenceId} that does not exist in the analytics result.`,
          slideId: slide.id,
          evidenceId,
        });
      }
    }

    for (const block of slide.blocks) {
      if (block.chartId && !chartIds.has(block.chartId)) {
        issues.push({
          code: "missing-chart",
          severity: "error",
          message: `Slide ${slide.id} references chart ${block.chartId} that was not planned.`,
          slideId: slide.id,
          chartId: block.chartId,
        });
      }

      for (const evidenceId of block.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          issues.push({
            code: "missing-block-evidence",
            severity: "error",
            message: `Slide block on ${slide.id} references evidence ${evidenceId} that does not exist.`,
            slideId: slide.id,
            evidenceId,
          });
        }
      }
    }
  }

  for (const chart of charts) {
    for (const evidenceId of chart.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push({
          code: "missing-chart-evidence",
          severity: "error",
          message: `Chart ${chart.id} references evidence ${evidenceId} that does not exist.`,
          chartId: chart.id,
          evidenceId,
        });
      }
    }
  }

  return issues;
}

function validateNumericAssertions(
  slides: SlideSpec[],
  analyticsResult: AnalyticsResult,
) {
  const issues: Array<Omit<ValidationIssue, "validator">> = [];
  const evidenceMap = new Map(analyticsResult.evidenceRefs.map((ref) => [ref.id, ref]));

  for (const slide of slides) {
    const textContent = extractAllText(slide);
    const numbersInText = [...textContent.matchAll(/(\d+\.?\d*)\s*%/g)].map((match) => parseFloat(match[1]));

    for (const numberInText of numbersInText) {
      const cited = slide.evidenceIds.some((refId) => {
        const ref = evidenceMap.get(refId);
        if (!ref) {
          return false;
        }

        const refNumbers = [
          ...(typeof ref.rawValue === "number" ? [ref.rawValue] : []),
          ...[...(ref.summary || "").matchAll(/(\d+\.?\d*)/g)].map((match) => parseFloat(match[1])),
        ];

        return refNumbers.some((refNumber) => Math.abs(refNumber - numberInText) < Math.max(numberInText * 0.02, 0.1));
      });

      if (!cited) {
        issues.push({
          code: "uncited-number",
          severity: "warning",
          message: `Number ${numberInText}% appears in slide text but is not supported by any cited evidence ref.`,
          slideId: slide.id,
        });
      }
    }
  }

  return issues;
}

function validateEvidenceExists(
  insights: InsightSpec[],
  analyticsResult: AnalyticsResult,
) {
  const issues: Array<Omit<ValidationIssue, "validator">> = [];
  const evidenceIds = new Set(analyticsResult.evidenceRefs.map((ref) => ref.id));

  for (const insight of insights) {
    for (const refId of insight.evidenceRefIds) {
      if (!evidenceIds.has(refId)) {
        issues.push({
          code: "dangling-evidence-ref",
          severity: "error",
          message: `Insight "${insight.title}" cites evidence ref "${refId}" which does not exist in analytics results.`,
          claimId: insight.claims[0]?.id,
          evidenceId: refId,
        });
      }
    }
  }

  return issues;
}

function validateStructuralConsistency(
  slides: SlideSpec[],
  charts: ChartSpec[],
  story: StorySpec,
  analyticsResult: AnalyticsResult,
) {
  const issues: Array<Omit<ValidationIssue, "validator">> = [];

  for (const section of story.sections) {
    const sectionSlides = slides.filter((slide) => {
      const normalizedSectionTitle = section.title.toLowerCase();
      return (
        slide.section.toLowerCase().includes(normalizedSectionTitle) ||
        slide.title.toLowerCase().includes(normalizedSectionTitle) ||
        slide.section.toLowerCase().includes(section.kind.toLowerCase())
      );
    });

    if (sectionSlides.length === 0) {
      issues.push({
        code: "empty-section",
        severity: "error",
        message: `Section "${section.title}" has no slides.`,
      });
    }
  }

  if (slides.length < 6) {
    issues.push({
      code: "too-few-slides",
      severity: "error",
      message: `Only ${slides.length} slides generated. Minimum viable report is 6 slides.`,
    });
  }

  for (const chart of charts) {
    if (!chart.dataBinding?.derivedTable) {
      issues.push({
        code: "unbound-chart",
        severity: "error",
        message: `Chart ${chart.id} has no derived-table binding.`,
        chartId: chart.id,
      });
      continue;
    }

    const derivedTableExists = analyticsResult.derivedTables.some(
      (table) => table.name === chart.dataBinding?.derivedTable,
    );

    if (!derivedTableExists) {
      issues.push({
        code: "missing-derived-table",
        severity: "error",
        message: `Chart ${chart.id} is bound to ${chart.dataBinding.derivedTable}, but no derived table with that name exists.`,
        chartId: chart.id,
      });
    }
  }

  return issues;
}

function extractAllText(slide: SlideSpec) {
  return [
    slide.title,
    slide.subtitle || "",
    slide.speakerNotes,
    ...slide.blocks.flatMap((block) => [block.content || "", ...(block.items || [])]),
  ].join(" ");
}

function inferBacktrackStage(code: string): ValidationIssue["backtrackStage"] {
  if (code.includes("derived-table") || code.includes("unbound-chart")) {
    return "metrics";
  }
  if (code.includes("claim") || code.includes("evidence-ref")) {
    return "insights";
  }
  if (code.includes("section") || code.includes("slide") || code.includes("number")) {
    return "slides";
  }
  return "story";
}
