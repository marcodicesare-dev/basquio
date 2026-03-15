import { z } from "zod";

import {
  revisionDecisionSchema,
  validationReportSchema,
  type AnalyticsResult,
  type ChartSpec,
  type InsightSpec,
  type RevisionDecision,
  type RevisionTargetStage,
  type SlideSpec,
  type StageTrace,
  type StorySpec,
  type ValidationIssue,
  type ValidationReport,
} from "@basquio/types";

import { generateStructuredStage } from "./model";

const semanticCritiqueSchema = z.object({
  status: z.enum(["passed", "needs_input"]),
  summary: z.string().default(""),
  targetStage: z.enum(["metrics", "insights", "story", "slides"]).optional(),
  reviewerFeedback: z.array(z.string()).default([]),
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

type ValidationInput = {
  jobId: string;
  analyticsResult: AnalyticsResult;
  insights: InsightSpec[];
  slides: SlideSpec[];
  charts: ChartSpec[];
  story: StorySpec;
  stageTraces?: StageTrace[];
  attemptCount?: number;
};

type CritiqueResult = {
  report: ValidationReport;
  trace: StageTrace | null;
};

export function runDeterministicValidation(input: ValidationInput): ValidationReport {
  const issues = [
    ...validateReferentialIntegrity(input.analyticsResult, input.insights, input.slides, input.charts),
    ...validateNumericAssertions(input.slides, input.analyticsResult),
    ...validateEvidenceExists(input.insights, input.analyticsResult),
    ...validateStructuralConsistency(input.slides, input.charts, input.story, input.analyticsResult),
  ].map((issue) => ({
    ...issue,
    validator: "deterministic" as const,
    backtrackStage: issue.backtrackStage ?? inferBacktrackStage(issue.code),
  }));
  const hasBlockingIssue = issues.some((issue) => issue.severity === "error");

  return validationReportSchema.parse({
    jobId: input.jobId,
    generatedAt: new Date().toISOString(),
    status: hasBlockingIssue ? "needs_input" : "passed",
    claimCount: input.insights.flatMap((insight) => insight.claims).length,
    chartCount: input.charts.length,
    slideCount: input.slides.length,
    attemptCount: input.attemptCount || 1,
    targetStage: hasBlockingIssue ? pickTargetStage(issues) : undefined,
    reviewerFeedback: hasBlockingIssue ? buildReviewerFeedback(issues) : [],
    deterministicIssueCount: issues.length,
    semanticIssueCount: 0,
    issues,
    traces: [...(input.stageTraces ?? [])],
  });
}

export async function critiqueExecutionPlanSemantically(input: ValidationInput): Promise<CritiqueResult> {
  const reviewer = selectReviewerModel(input.stageTraces ?? []);
  const review = await generateStructuredStage({
    stage: "semantic-critique",
    schema: semanticCritiqueSchema,
    modelId: reviewer.modelId,
    providerPreference: reviewer.providerPreference,
    prompt: [
      "You are an independent report critic reviewing an evidence-backed executive deck plan.",
      "Do not recompute numbers. Judge whether the story overreaches, whether recommendations are unsupported, whether transitions are incoherent, and whether the slide plan actually matches the analytics and evidence.",
      "If the right fix is upstream, set targetStage and per-issue backtrackStage accordingly: metrics, insights, story, or slides.",
      "Return specific reviewerFeedback that the next revision attempt should address.",
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

  const critiqueTrace = review.trace.provider === "none" ? null : review.trace;
  const critiqueIssues = (review.object?.issues ?? []).map((issue) => ({
    ...issue,
    validator: "semantic" as const,
    backtrackStage: issue.backtrackStage ?? review.object?.targetStage ?? "slides",
  }));
  const skippedCritiqueIssue =
    review.trace.provider !== "none" && review.trace.status === "failed"
      ? [
          {
            code: "semantic-critic-failed",
            validator: "semantic" as const,
            severity: "warning" as const,
            message: review.trace.errorMessage || "The semantic critic could not complete its review.",
            backtrackStage: undefined,
          },
        ]
      : [];
  const issues = [...critiqueIssues, ...skippedCritiqueIssue];
  const needsRevision =
    review.object?.status === "needs_input" || critiqueIssues.some((issue) => issue.severity === "error");

  return {
    report: validationReportSchema.parse({
      jobId: input.jobId,
      generatedAt: new Date().toISOString(),
      status: needsRevision ? "needs_input" : "passed",
      claimCount: input.insights.flatMap((insight) => insight.claims).length,
      chartCount: input.charts.length,
      slideCount: input.slides.length,
      attemptCount: input.attemptCount || 1,
      targetStage: needsRevision ? review.object?.targetStage ?? pickTargetStage(critiqueIssues) : undefined,
      reviewerFeedback: needsRevision ? buildReviewerFeedback(issues, review.object?.reviewerFeedback ?? []) : [],
      deterministicIssueCount: 0,
      semanticIssueCount: issues.length,
      issues,
      traces: critiqueTrace ? [critiqueTrace] : [],
    }),
    trace: critiqueTrace,
  };
}

export function combineValidationReports(input: {
  jobId: string;
  insights: InsightSpec[];
  charts: ChartSpec[];
  slides: SlideSpec[];
  deterministicReport: ValidationReport;
  semanticReport: ValidationReport;
  stageTraces?: StageTrace[];
  attemptCount?: number;
}): ValidationReport {
  const issues = [...input.deterministicReport.issues, ...input.semanticReport.issues];
  const needsRevision =
    input.deterministicReport.status === "needs_input" || input.semanticReport.status === "needs_input";

  return validationReportSchema.parse({
    jobId: input.jobId,
    generatedAt: new Date().toISOString(),
    status: needsRevision ? "needs_input" : "passed",
    claimCount: input.insights.flatMap((insight) => insight.claims).length,
    chartCount: input.charts.length,
    slideCount: input.slides.length,
    attemptCount: input.attemptCount || input.semanticReport.attemptCount || input.deterministicReport.attemptCount || 1,
    targetStage: needsRevision ? pickTargetStage(issues) : undefined,
    reviewerFeedback: needsRevision
      ? buildReviewerFeedback(issues, [
          ...input.deterministicReport.reviewerFeedback,
          ...input.semanticReport.reviewerFeedback,
        ])
      : [],
    deterministicIssueCount: input.deterministicReport.issues.length,
    semanticIssueCount: input.semanticReport.issues.length,
    issues,
    traces: [
      ...(input.stageTraces ?? []),
      ...input.deterministicReport.traces,
      ...input.semanticReport.traces,
    ],
  });
}

export function decideRevision(input: { report: ValidationReport }): RevisionDecision | null {
  if (input.report.status === "passed") {
    return null;
  }

  const targetStage = input.report.targetStage ?? pickTargetStage(input.report.issues) ?? "slides";
  const leadingIssues = input.report.issues
    .filter((issue) => issue.severity === "error")
    .slice(0, 3)
    .map((issue) => issue.message);

  return revisionDecisionSchema.parse({
    attempt: input.report.attemptCount,
    trigger:
      input.report.semanticIssueCount > 0 && input.report.deterministicIssueCount > 0
        ? "combined-review"
        : input.report.semanticIssueCount > 0
          ? "semantic-critique"
          : "deterministic-validation",
    targetStage,
    rationale:
      leadingIssues[0] ||
      `Validation failed and the smallest responsible backtrack stage is ${targetStage}.`,
    reviewerFeedback: input.report.reviewerFeedback,
    issueCodes: input.report.issues.map((issue) => issue.code),
  });
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
      return {
        modelId: process.env.BASQUIO_VALIDATION_OPENAI_MODEL || "gpt-5-mini",
        providerPreference: "openai" as const,
      };
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
    const numbersInText = [...new Set(
      [...textContent.matchAll(/(\d+\.?\d*)\s*%/g)].map((match) => parseFloat(match[1])),
    )];

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

        return refNumbers.some((refNumber) => {
          const percentComparable = Math.abs((refNumber * 100) - numberInText) < Math.max(numberInText * 0.02, 0.1);
          const directComparable = Math.abs(refNumber - numberInText) < Math.max(numberInText * 0.02, 0.1);
          return directComparable || percentComparable;
        });
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

  for (const slide of slides) {
    const missingBindings = slide.blocks.filter((block) =>
      block.kind !== "divider" &&
      block.kind !== "title" &&
      block.kind !== "subtitle" &&
      !block.templateBinding,
    );

    if (missingBindings.length > 0) {
      issues.push({
        code: "missing-template-binding",
        severity: "warning",
        message: `Slide ${slide.id} still has ${missingBindings.length} block${missingBindings.length === 1 ? "" : "s"} without a template-region binding.`,
        slideId: slide.id,
      });
    }
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

function inferBacktrackStage(code: string): RevisionTargetStage {
  if (code.includes("derived-table") || code.includes("unbound-chart")) {
    return "metrics";
  }
  if (code.includes("claim") || code.includes("evidence-ref")) {
    return "insights";
  }
  if (code.includes("template-binding") || code.includes("section") || code.includes("slide") || code.includes("number")) {
    return "slides";
  }
  return "story";
}

function pickTargetStage(issues: Array<Pick<ValidationIssue, "severity" | "backtrackStage">>) {
  const candidates = issues
    .filter((issue) => issue.severity === "error" || issue.backtrackStage)
    .map((issue) => issue.backtrackStage)
    .filter((stage): stage is RevisionTargetStage => Boolean(stage));

  if (candidates.includes("metrics")) {
    return "metrics";
  }
  if (candidates.includes("insights")) {
    return "insights";
  }
  if (candidates.includes("story")) {
    return "story";
  }
  if (candidates.includes("slides")) {
    return "slides";
  }
  return undefined;
}

function buildReviewerFeedback(
  issues: Array<Pick<ValidationIssue, "severity" | "message">>,
  explicitFeedback: string[] = [],
) {
  return compactUnique([
    ...explicitFeedback,
    ...issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.message),
  ]).slice(0, 10);
}

function compactUnique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
