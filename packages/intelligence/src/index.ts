import type {
  ChartSpec,
  DatasetProfile,
  DeterministicAnalysis,
  InsightSpec,
  NormalizedWorkbook,
  ReportBrief,
  ReportOutline,
  SlideSpec,
  StorySpec,
  TemplateProfile,
} from "@basquio/types";

import {
  chartSpecSchema,
  deterministicAnalysisSchema,
  insightSpecSchema,
  reportOutlineSchema,
  slideSpecSchema,
  storySpecSchema,
} from "@basquio/types";

type StoryPlanningInput = {
  datasetProfile: DatasetProfile;
  analysis: DeterministicAnalysis;
  insights: InsightSpec[];
  brief: ReportBrief;
};

type OutlinePlanningInput = {
  datasetProfile: DatasetProfile;
  analysis: DeterministicAnalysis;
  insights: InsightSpec[];
  story: StorySpec;
  brief: ReportBrief;
};

type SlidePlanningInput = {
  datasetProfile: DatasetProfile;
  analysis: DeterministicAnalysis;
  story: StorySpec;
  outline: ReportOutline;
  insights: InsightSpec[];
  templateProfile: TemplateProfile;
  brief: ReportBrief;
};

export function profileDataset(datasetProfile: DatasetProfile) {
  const warnings = [...datasetProfile.warnings];

  if ((datasetProfile.manifest?.files.length ?? 0) > 1) {
    warnings.push(`Evidence package includes ${datasetProfile.manifest?.files.length ?? 0} files across tabular and support roles.`);
  }

  return {
    ...datasetProfile,
    warnings: compactUnique(warnings),
  };
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
          sourceFileId: sheet.sourceFileId,
          fileName: sheet.sourceFileName,
          fileRole: sheet.sourceRole,
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

  const narrativeMetrics = metricSummaries.filter((summary) => isNarrativeSignalRole(summary.fileRole));
  const topAverageSignals = narrativeMetrics
    .slice()
    .sort((left, right) => Math.abs(right.average ?? 0) - Math.abs(left.average ?? 0))
    .slice(0, 3);
  const topCoverageSignals = narrativeMetrics
    .slice()
    .sort((left, right) => right.numericCount - left.numericCount)
    .slice(0, 2);

  const highlights = compactUnique([
    ...topAverageSignals.map(
      (summary) =>
        `${summary.fileName || "Dataset"} · ${summary.column} carries the strongest average signal (${round(summary.average)} across ${summary.numericCount} numeric rows).`,
    ),
    ...topCoverageSignals.map(
      (summary) =>
        `${summary.sheet} contributes ${summary.numericCount} usable rows for ${summary.column}, making it a stable source for the report spine.`,
    ),
  ]);

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
  brief: ReportBrief;
}): InsightSpec[] {
  const insights: InsightSpec[] = [];
  const manifest = input.datasetProfile.manifest;
  const topSignals = input.analysis.metricSummaries
    .filter((summary) => summary.numericCount > 0 && isNarrativeSignalRole(summary.fileRole))
    .slice()
    .sort((left, right) => {
      const leftScore = Math.abs(left.average ?? 0) + (left.numericCount / 10);
      const rightScore = Math.abs(right.average ?? 0) + (right.numericCount / 10);
      return rightScore - leftScore;
    })
    .slice(0, 3);

  if (manifest && manifest.files.length > 1) {
    insights.push(
      insightSpecSchema.parse({
        id: `${input.datasetProfile.datasetId}-insight-package`,
        title: `${manifest.files.length} source files shape the report, not one anonymous table`,
        claim: `${input.brief.client || "The client"} should read this as an evidence package with explicit file roles, not as a flat spreadsheet export.`,
        businessMeaning: `The methodology section can now distinguish the main fact table from citation, validation, and support inputs before drawing executive conclusions for ${input.brief.audience.toLowerCase()}.`,
        confidence: 0.84,
        evidence: [
          {
            fileName: input.datasetProfile.sourceFileName,
            fileRole: "main-fact-table",
            sheet: "package manifest",
            metric: "file roles",
            summary: `${manifest.files.length} files classified across ${new Set(manifest.files.map((file) => file.role)).size} package roles.`,
            confidence: 0.84,
          },
        ],
      }),
    );
  }

  for (const [index, summary] of topSignals.entries()) {
    insights.push(
      insightSpecSchema.parse({
        id: `${input.datasetProfile.datasetId}-insight-${index + 1}`,
        title: `${summary.column} is a lead signal for ${input.brief.objective.toLowerCase()}`,
        claim: `${summary.fileName || summary.sheet} surfaces ${summary.column} as a report-grade finding with enough numeric coverage to anchor the narrative.`,
        businessMeaning: input.brief.stakes
          ? `Because ${cleanFragment(input.brief.stakes).toLowerCase()}, leadership should treat ${summary.column} as a decision input rather than a descriptive appendix metric.`
          : `Use ${summary.column} to anchor the executive framing, then unpack segment or methodological qualifiers underneath it.`,
        confidence: summary.numericCount >= 10 ? 0.81 : 0.63,
        evidence: [
          {
            fileName: summary.fileName,
            fileRole: summary.fileRole,
            sheet: summary.sheet,
            metric: summary.column,
            summary: `Average ${round(summary.average)}, range ${round(summary.min)} to ${round(summary.max)}, ${summary.numericCount} numeric rows, ${summary.distinctCount} distinct values.`,
            confidence: summary.numericCount >= 10 ? 0.85 : 0.65,
          },
        ],
      }),
    );
  }

  if (insights.length > 0) {
    return insights;
  }

  return [
    insightSpecSchema.parse({
      id: `${input.datasetProfile.datasetId}-insight-fallback`,
      title: "Dataset requires analyst review before executive packaging",
      claim: "The evidence package parsed successfully but does not yet expose a strong numeric measure set.",
      businessMeaning: "Keep the workflow running, but flag the package for file-role review and metric mapping before customer-facing output.",
      confidence: 0.42,
      evidence: [
        {
          fileName: input.datasetProfile.sourceFileName,
          fileRole: "unknown-support",
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
  const businessInsights = getBusinessInsights(input.insights);
  const leadInsight = businessInsights[0] ?? input.insights[0];
  const thesis =
    input.brief.thesis ||
    leadInsight?.claim ||
    `Use the evidence package to explain ${input.brief.objective.toLowerCase()}.`;
  const title = input.brief.client
    ? `${input.brief.client} evidence package report`
    : "Basquio evidence package report";
  const keyMessages = compactUnique([
    thesis,
    ...(businessInsights.length > 0 ? businessInsights : input.insights).slice(0, 3).map((insight) => insight.title),
  ]).slice(0, 4);

  return storySpecSchema.parse({
    client: input.brief.client,
    audience: input.brief.audience,
    objective: input.brief.objective,
    thesis,
    stakes: input.brief.stakes,
    title,
    narrativeArc: [
      input.brief.stakes
        ? `Frame the commercial stakes first: ${cleanFragment(input.brief.stakes)}.`
        : `Frame the executive ask first so ${input.brief.audience.toLowerCase()} knows why this report exists.`,
      "Show how the evidence package was assembled, which files are primary, and where validation or methodology support comes from.",
      "Move from the lead finding into supporting measures without breaking evidence traceability.",
      "Close with implications and recommended actions that match the stated objective rather than generic next steps.",
    ],
    keyMessages,
    recommendedActions: [
      `Use ${leadInsight?.title.toLowerCase() ?? "the lead signal"} as the opening message for ${input.brief.audience.toLowerCase()}.`,
      "Keep methodology, citations, and validation roles visible so the report reads as an evidence package, not a speculative narrative.",
      input.brief.stakes
        ? `Tie the closing recommendations directly back to ${cleanFragment(input.brief.stakes).toLowerCase()}.`
        : "Translate the findings into an operating decision or reporting cadence at the end of the deck.",
    ],
  });
}

export function planReportOutline(input: OutlinePlanningInput): ReportOutline {
  const businessInsights = getBusinessInsights(input.insights);
  const findingsObjective =
    input.brief.objective || "Explain the highest-signal findings from the evidence package.";

  return reportOutlineSchema.parse({
    title: input.story.title || "Basquio report",
    sections: [
      {
        id: "outline-framing",
        kind: "framing",
        title: "Framing the report",
        summary: input.story.thesis,
        objective: `Orient ${input.brief.audience.toLowerCase()} around the client, objective, and stakes before showing the data.`,
        supportingInsightIds: (businessInsights[0] ? [businessInsights[0]] : input.insights.slice(0, 1)).map((insight) => insight.id),
      },
      {
        id: "outline-methodology",
        kind: "methodology",
        title: "How the system assembled the evidence package",
        summary: `Basquio is using ${input.datasetProfile.manifest?.files.length ?? 1} uploaded file${(input.datasetProfile.manifest?.files.length ?? 1) === 1 ? "" : "s"} with explicit file-role inference before narrative planning.`,
        objective: "Explain file roles, deterministic analysis, and why the package can support the final report.",
        supportingInsightIds: input.insights.filter((insight) => insight.id.includes("package")).map((insight) => insight.id),
      },
      {
        id: "outline-findings",
        kind: "findings",
        title: "Findings",
        summary: input.analysis.highlights[0] ?? findingsObjective,
        objective: findingsObjective,
        supportingInsightIds: (businessInsights.length > 0 ? businessInsights : input.insights).slice(0, 3).map((insight) => insight.id),
      },
      {
        id: "outline-implications",
        kind: "implications",
        title: "Implications",
        summary: input.brief.stakes
          ? `The findings matter because ${cleanFragment(input.brief.stakes).toLowerCase()}.`
          : "Translate the findings into business implications for the intended audience.",
        objective: "Connect evidence-backed findings to operating or strategic consequences.",
        supportingInsightIds: (businessInsights.length > 0 ? businessInsights : input.insights).slice(0, 2).map((insight) => insight.id),
      },
      {
        id: "outline-recommendations",
        kind: "recommendations",
        title: "Recommendations",
        summary: input.story.recommendedActions[0] ?? "Close with actions that the audience can own.",
        objective: "Finish with practical recommendations and an explicit next-step path.",
        supportingInsightIds: (businessInsights.length > 0 ? businessInsights : input.insights).slice(0, 2).map((insight) => insight.id),
      },
    ],
  });
}

export function planSlides(input: SlidePlanningInput): { slides: SlideSpec[]; charts: ChartSpec[] } {
  const charts = buildCharts(input.analysis, input.brief);
  const manifestFiles = input.datasetProfile.manifest?.files ?? [];
  const fileRoleLines = manifestFiles.map((file) => `${humanizeRole(file.role)}: ${file.fileName}`);
  const businessInsights = getBusinessInsights(input.insights);
  const leadInsight = businessInsights[0] ?? input.insights[0];
  const supportingInsights = (businessInsights.length > 0 ? businessInsights : input.insights).slice(1, 3);
  const implications = compactUnique([
    input.story.keyMessages[0],
    ...supportingInsights.map((insight) => insight.businessMeaning),
  ]).slice(0, 4);

  const slides: SlideSpec[] = [
    slideSpecSchema.parse({
      id: "slide-cover",
      purpose: "Cover and framing",
      section: "Framing",
      eyebrow: input.brief.client || "Basquio",
      emphasis: "cover",
      layoutId: input.templateProfile.layouts.find((layout) => layout.id === "cover")?.id ?? "cover",
      title: input.story.title,
      subtitle: input.brief.objective,
      blocks: [
        {
          kind: "body",
          content: input.brief.businessContext || "Executive report generated from a structured evidence package.",
        },
        {
          kind: "callout",
          content: input.story.thesis,
          tone: "positive",
        },
        {
          kind: "bullet-list",
          items: compactUnique([
            input.brief.stakes ? `Stakes: ${input.brief.stakes}` : undefined,
            `Audience: ${input.brief.audience}`,
            `Evidence package: ${manifestFiles.length || 1} file${(manifestFiles.length || 1) === 1 ? "" : "s"}`,
          ]),
        },
      ],
      evidenceIds: leadInsight ? collectInsightEvidenceIds([leadInsight]) : [],
      speakerNotes: "Open with the objective, then state the thesis and stakes before showing methodology or evidence detail.",
    }),
    slideSpecSchema.parse({
      id: "slide-methodology",
      purpose: "Methodology and package understanding",
      section: "Methodology",
      eyebrow: "How The System Works",
      emphasis: "section",
      layoutId: input.templateProfile.layouts.find((layout) => layout.id === "summary")?.id ?? "summary",
      title: "Evidence package and methodology",
      subtitle: "Deterministic analysis happens before narrative generation",
      blocks: [
        {
          kind: "metric",
          label: "Files",
          value: String(manifestFiles.length || 1),
        },
        {
          kind: "metric",
          label: "Sheets",
          value: String(input.datasetProfile.sheets.length),
        },
        {
          kind: "metric",
          label: "Insights ranked",
          value: String(input.insights.length),
        },
        {
          kind: "bullet-list",
          items: [
            "Infer file roles across the package before treating any workbook as primary.",
            "Run deterministic analytics on parsed tabular sheets before planning the narrative.",
            "Map sections to framing, methodology, findings, implications, and recommendations.",
          ],
        },
        {
          kind: "evidence-list",
          items: fileRoleLines.slice(0, 6),
        },
      ],
      evidenceIds: collectInsightEvidenceIds((businessInsights.length > 0 ? businessInsights : input.insights).slice(0, 2)),
      speakerNotes: "Use this slide to establish trust in the package structure and analysis order.",
    }),
    slideSpecSchema.parse({
      id: "slide-findings-summary",
      purpose: "Lead findings",
      section: "Findings",
      eyebrow: "Lead Signal",
      emphasis: "content",
      layoutId: input.templateProfile.layouts.find((layout) => layout.id === "evidence-grid")?.id ?? "evidence-grid",
      title: leadInsight?.title ?? "Lead finding",
      subtitle: leadInsight?.claim,
      blocks: [
        {
          kind: "callout",
          content: leadInsight?.businessMeaning ?? input.story.keyMessages[0],
          tone: "positive",
        },
        charts[0]
          ? {
              kind: "chart" as const,
              chartId: charts[0].id,
            }
          : {
              kind: "body" as const,
              content: input.analysis.highlights[0] ?? "Awaiting stronger numeric signal.",
            },
        {
          kind: "evidence-list",
          items: leadInsight?.evidence.map((evidence) => `${evidence.fileName || evidence.sheet}: ${evidence.summary}`) ?? [],
        },
        {
          kind: "bullet-list",
          items: input.story.keyMessages.slice(0, 3),
        },
      ],
      evidenceIds: collectInsightEvidenceIds(input.insights.slice(0, 2)),
      speakerNotes: "Anchor the report on the strongest finding and show the chart as evidence, not decoration.",
    }),
    slideSpecSchema.parse({
      id: "slide-findings-support",
      purpose: "Supporting findings",
      section: "Findings",
      eyebrow: "Supporting Proof",
      emphasis: "content",
      layoutId: input.templateProfile.layouts.find((layout) => layout.id === "two-column")?.id ?? "two-column",
      title: "Supporting evidence and signal breadth",
      subtitle: "Secondary measures that reinforce the report thesis",
      blocks: [
        charts[1]
          ? {
              kind: "chart" as const,
              chartId: charts[1].id,
            }
          : {
              kind: "body" as const,
              content: input.analysis.highlights[1] ?? "Supporting signals remain thin and should be reviewed by an analyst.",
            },
        {
          kind: "bullet-list",
          items: supportingInsights.map((insight) => `${insight.title}: ${insight.businessMeaning}`),
        },
        {
          kind: "evidence-list",
          items: supportingInsights.flatMap((insight) =>
            insight.evidence.map((evidence) => `${evidence.sheet}: ${evidence.summary}`),
          ),
        },
      ],
      evidenceIds: collectInsightEvidenceIds(supportingInsights),
      speakerNotes: "Show the supporting measures that keep the narrative honest and defensible.",
    }),
    slideSpecSchema.parse({
      id: "slide-implications",
      purpose: "Implications",
      section: "Implications",
      eyebrow: "Why It Matters",
      emphasis: "section",
      layoutId: input.templateProfile.layouts.find((layout) => layout.id === "summary")?.id ?? "summary",
      title: "Implications for the brief",
      subtitle: input.outline.sections.find((section) => section.kind === "implications")?.summary,
      blocks: [
        {
          kind: "callout",
          content: input.brief.stakes || input.story.keyMessages[0],
          tone: "caution",
        },
        {
          kind: "bullet-list",
          items: implications,
        },
      ],
      evidenceIds: collectInsightEvidenceIds(input.insights.slice(0, 2)),
      speakerNotes: "Translate the findings into concrete business consequences for the intended audience.",
    }),
    slideSpecSchema.parse({
      id: "slide-recommendations",
      purpose: "Recommendations",
      section: "Recommendations",
      eyebrow: "Recommended Actions",
      emphasis: "section",
      layoutId: input.templateProfile.layouts.find((layout) => layout.id === "summary")?.id ?? "summary",
      title: "Recommended next steps",
      subtitle: "Actions derived from the same outline and evidence base",
      blocks: [
        {
          kind: "bullet-list",
          items: input.story.recommendedActions,
        },
        {
          kind: "evidence-list",
          items: [
            "Keep the manifest with the exported artifacts so file provenance remains inspectable.",
            "Use the editable PPTX for iteration, but keep PDF and PPTX derived from the same slide contract.",
          ],
        },
      ],
      evidenceIds: collectInsightEvidenceIds(input.insights.slice(0, 1)),
      speakerNotes: "Close with practical actions and make clear that the artifact pair stays coupled to the same slide spec.",
    }),
  ];

  return {
    slides,
    charts,
  };
}

function buildCharts(analysis: DeterministicAnalysis, brief: ReportBrief): ChartSpec[] {
  const averageRanked = analysis.metricSummaries
    .filter((summary) => summary.numericCount > 0 && isNarrativeSignalRole(summary.fileRole))
    .slice()
    .sort((left, right) => Math.abs(right.average ?? 0) - Math.abs(left.average ?? 0))
    .slice(0, 4);
  const coverageRanked = analysis.metricSummaries
    .filter((summary) => summary.numericCount > 0 && isNarrativeSignalRole(summary.fileRole))
    .slice()
    .sort((left, right) => right.numericCount - left.numericCount)
    .slice(0, 4);

  const charts: ChartSpec[] = [];

  if (averageRanked.length > 0) {
    charts.push(
      chartSpecSchema.parse({
        id: "chart-average-signal",
        title: "Highest average signal",
        family: "bar",
        editableInPptx: true,
        categories: averageRanked.map((summary) => compactMetricLabel(summary.fileName, summary.column)),
        series: [
          {
            name: "Average",
            dataKey: "average",
            values: averageRanked.map((summary) => safeNumber(summary.average)),
          },
        ],
        xKey: "metric",
        yKeys: ["average"],
        summary: `Average-value comparison built for ${brief.objective.toLowerCase()}.`,
        evidenceIds: averageRanked.map((summary) => buildEvidenceId(summary.fileName, summary.sheet, summary.column)),
      }),
    );
  }

  if (coverageRanked.length > 0) {
    charts.push(
      chartSpecSchema.parse({
        id: "chart-coverage-signal",
        title: "Most stable measures by numeric coverage",
        family: "bar",
        editableInPptx: true,
        categories: coverageRanked.map((summary) => compactMetricLabel(summary.fileName, summary.column)),
        series: [
          {
            name: "Numeric rows",
            dataKey: "numericCount",
            values: coverageRanked.map((summary) => summary.numericCount),
          },
        ],
        xKey: "metric",
        yKeys: ["numericCount"],
        summary: "Coverage comparison for measures that can support repeated report updates.",
        evidenceIds: coverageRanked.map((summary) => buildEvidenceId(summary.fileName, summary.sheet, summary.column)),
      }),
    );
  }

  return charts;
}

function collectInsightEvidenceIds(insights: InsightSpec[]) {
  return compactUnique(
    insights.flatMap((insight) =>
      insight.evidence.map((evidence) => buildEvidenceId(evidence.fileName, evidence.sheet, evidence.metric)),
    ),
  );
}

function buildEvidenceId(fileName: string, sheet: string, metric: string) {
  return [fileName || "dataset", sheet, metric].filter(Boolean).join(":");
}

function compactMetricLabel(fileName: string, column: string) {
  const fileStub = fileName ? fileName.replace(/\.[a-z0-9]+$/i, "").slice(0, 18) : "dataset";
  return `${fileStub} · ${column}`;
}

function humanizeRole(role: string) {
  return role
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getBusinessInsights(insights: InsightSpec[]) {
  return insights.filter((insight) => !insight.id.includes("package"));
}

function isNarrativeSignalRole(role: string) {
  return role === "main-fact-table" || role === "supporting-fact-table" || role === "overview-table";
}

function cleanFragment(value: string) {
  return value.trim().replace(/[.,;:!?]+$/g, "");
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

function safeNumber(value: number | null) {
  return value ?? 0;
}

function round(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }

  return value.toFixed(2);
}

function compactUnique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim().length > 0)))];
}
