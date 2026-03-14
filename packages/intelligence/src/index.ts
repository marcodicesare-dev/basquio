import type {
  ChartSpec,
  DatasetProfile,
  DeterministicAnalysis,
  InsightSpec,
  NormalizedWorkbook,
  SlideSpec,
  StorySpec,
  TemplateProfile,
} from "@basquio/types";

import { deterministicAnalysisSchema, insightSpecSchema, storySpecSchema, slideSpecSchema } from "@basquio/types";

type StoryPlanningInput = {
  datasetProfile: DatasetProfile;
  insights: InsightSpec[];
  audience: string;
  objective: string;
};

type SlidePlanningInput = {
  story: StorySpec;
  insights: InsightSpec[];
  templateProfile: TemplateProfile;
};

export function profileDataset(datasetProfile: DatasetProfile) {
  return datasetProfile;
}

export function runDeterministicAnalytics(workbook: NormalizedWorkbook): DeterministicAnalysis {
  const metricSummaries = workbook.sheets.flatMap((sheet) =>
    sheet.columns
      .filter((column) => column.role === "measure")
      .map((column) => {
        const numericValues = sheet.rows
          .map((row) => coerceNumber(row[column.name]))
          .filter((value): value is number => value !== null);

        const distinctCount = new Set(sheet.rows.map((row) => String(row[column.name] ?? ""))).size;
        const sum = numericValues.reduce((total, value) => total + value, 0);
        const average = numericValues.length > 0 ? sum / numericValues.length : null;

        return {
          sheet: sheet.name,
          column: column.name,
          rowCount: sheet.rowCount,
          numericCount: numericValues.length,
          distinctCount,
          sum: numericValues.length > 0 ? sum : null,
          average,
          min: numericValues.length > 0 ? Math.min(...numericValues) : null,
          max: numericValues.length > 0 ? Math.max(...numericValues) : null,
        };
      }),
  );

  const highlights = metricSummaries
    .slice()
    .sort((left, right) => Math.abs(right.average ?? 0) - Math.abs(left.average ?? 0))
    .slice(0, 3)
    .map(
      (summary) =>
        `${summary.sheet}.${summary.column} is a high-signal measure with ${summary.numericCount} numeric observations and average ${round(summary.average)}.`,
    );

  return deterministicAnalysisSchema.parse({
    datasetId: workbook.datasetId,
    metricSummaries,
    highlights,
    warnings: metricSummaries.length === 0 ? ["No measure columns were available for deterministic analytics."] : [],
  });
}

export function generateInsights(input: {
  datasetProfile: DatasetProfile;
  analysis: DeterministicAnalysis;
}): InsightSpec[] {
  const insights = input.analysis.metricSummaries
    .filter((summary) => summary.numericCount > 0)
    .slice(0, 3)
    .map((summary, index) =>
      insightSpecSchema.parse({
        id: `${input.datasetProfile.datasetId}-insight-${index + 1}`,
        title: `${summary.column} deserves executive attention`,
        claim: `${summary.sheet}.${summary.column} shows enough structured signal to anchor the narrative.`,
        businessMeaning: `Use ${summary.column} as a lead metric for the executive summary and connect segment or time cuts underneath it.`,
        confidence: summary.numericCount >= 10 ? 0.78 : 0.56,
        evidence: [
          {
            sheet: summary.sheet,
            metric: summary.column,
            summary: `Average ${round(summary.average)}, range ${round(summary.min)} to ${round(summary.max)}, ${summary.numericCount} numeric rows.`,
            confidence: summary.numericCount >= 10 ? 0.82 : 0.6,
          },
        ],
      }),
    );

  if (insights.length > 0) {
    return insights;
  }

  return [
    insightSpecSchema.parse({
      id: `${input.datasetProfile.datasetId}-insight-fallback`,
      title: "Dataset requires analyst review",
      claim: "The workbook parsed successfully but does not yet expose a strong numeric measure set.",
      businessMeaning: "Keep the workflow running, but flag the job for template and metric mapping review before customer-facing output.",
      confidence: 0.42,
      evidence: [
        {
          sheet: input.datasetProfile.sheets[0]?.name ?? "unknown",
          metric: "dataset",
          summary: "Parsed workbook structure is valid but measure detection is still sparse.",
          confidence: 0.42,
        },
      ],
    }),
  ];
}

export function planStory(input: StoryPlanningInput): StorySpec {
  const keyMessages = input.insights.map((insight) => insight.title);

  return storySpecSchema.parse({
    audience: input.audience,
    objective: input.objective,
    narrativeArc: [
      "Start with the highest-confidence business signal.",
      "Move into the supporting measures and segment drivers.",
      "Close with actions and open questions for the operating team.",
    ],
    keyMessages,
    recommendedActions: [
      "Confirm the lead metric owner and reporting cadence.",
      "Validate segment breakouts before external sharing.",
      "Use the PPTX output as the editable working artifact for iteration.",
    ],
  });
}

export function planSlides(input: SlidePlanningInput): { slides: SlideSpec[]; charts: ChartSpec[] } {
  const charts: ChartSpec[] = input.insights.slice(0, 2).map((insight, index) => ({
    id: `${insight.id}-chart`,
    family: "bar",
    editableInPptx: true,
    series: [
      {
        name: insight.title,
        dataKey: "value",
      },
    ],
    xKey: "label",
    yKeys: ["value"],
  }));

  const slides = [
    slideSpecSchema.parse({
      id: "slide-executive-summary",
      purpose: "Executive summary",
      layoutId: input.templateProfile.layouts[0]?.id ?? "summary",
      title: input.story.keyMessages[0] ?? "Executive summary",
      subtitle: input.story.objective,
      blocks: [
        {
          kind: "body",
          content: input.story.narrativeArc[0],
        },
        {
          kind: "callout",
          content: input.insights[0]?.claim ?? "Awaiting stronger insight signal.",
        },
      ],
      evidenceIds: input.insights.flatMap((insight) => insight.evidence.map((evidence) => `${evidence.sheet}:${evidence.metric}`)),
      speakerNotes: "Lead with the core business signal before moving into underlying cuts.",
    }),
    slideSpecSchema.parse({
      id: "slide-supporting-analytics",
      purpose: "Supporting analytics",
      layoutId: input.templateProfile.layouts[1]?.id ?? input.templateProfile.layouts[0]?.id ?? "two-column",
      title: "Supporting evidence",
      subtitle: "Deterministic summaries before narrative elaboration",
      blocks: [
        {
          kind: "body",
          content: input.story.narrativeArc[1],
        },
        {
          kind: "chart",
          chartId: charts[0]?.id,
        },
      ],
      evidenceIds: input.insights.slice(0, 2).flatMap((insight) => insight.evidence.map((evidence) => `${evidence.sheet}:${evidence.metric}`)),
      speakerNotes: "Keep every claim tied back to metric evidence and explicit confidence.",
    }),
    slideSpecSchema.parse({
      id: "slide-actions",
      purpose: "Recommendations",
      layoutId: input.templateProfile.layouts[0]?.id ?? "summary",
      title: "Recommended next steps",
      blocks: input.story.recommendedActions.map((action) => ({
        kind: "body" as const,
        content: action,
      })),
      evidenceIds: [],
      speakerNotes: "Use this slide to bridge insight into action without overstating certainty.",
    }),
  ];

  return {
    slides,
    charts,
  };
}

function coerceNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function round(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }

  return value.toFixed(2);
}
