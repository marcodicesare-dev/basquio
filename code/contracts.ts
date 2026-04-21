import { z } from "zod";

export const sourceAssetKindSchema = z.enum([
  "workbook",
  "document",
  "pptx",
  "pdf",
  "image",
  "brand-tokens",
  "unknown",
]);

export const datasetFileRoleSchema = z.enum([
  "main-fact-table",
  "supporting-fact-table",
  "evidence-pptx",
  "evidence-pdf",
  "citations-table",
  "validation-table",
  "methodology-guide",
  "definitions-guide",
  "query-log",
  "response-log",
  "overview-table",
  "brand-tokens",
  "template-pptx",
  "style-reference-pdf",
  "unknown-support",
]);

export const columnRoleSchema = z.enum([
  "dimension",
  "measure",
  "time",
  "segment",
  "identifier",
  "unknown",
]);

export const confidenceLevelSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

export const datasetColumnSchema = z.object({
  name: z.string(),
  inferredType: z.enum(["string", "number", "date", "boolean", "unknown"]),
  role: columnRoleSchema,
  nullable: z.boolean().default(true),
  sampleValues: z.array(z.string()).default([]),
  uniqueCount: z.number().int().nonnegative().default(0),
  uniqueCountApproximate: z.boolean().optional(),
  nullRate: z.number().min(0).max(1).default(0),
});

export const datasetProfileSchema = z.object({
  datasetId: z.string(),
  sourceFileName: z.string(),
  sourceFiles: z.array(
    z.object({
      id: z.string().default(""),
      fileName: z.string(),
      role: datasetFileRoleSchema.default("unknown-support"),
      mediaType: z.string().default("application/octet-stream"),
      kind: sourceAssetKindSchema.default("unknown"),
      parsedSheetCount: z.number().int().nonnegative().default(0),
      notes: z.array(z.string()).default([]),
    }),
  ).default([]),
  manifest: z
    .object({
      datasetId: z.string(),
      packageLabel: z.string().default("Evidence package"),
      files: z
        .array(
          z.object({
            id: z.string(),
            fileName: z.string(),
            mediaType: z.string().default("application/octet-stream"),
            kind: sourceAssetKindSchema.default("unknown"),
            role: datasetFileRoleSchema.default("unknown-support"),
            parsedSheetCount: z.number().int().nonnegative().default(0),
            notes: z.array(z.string()).default([]),
          }),
        )
        .min(1),
      primaryFileId: z.string().optional(),
      brandFileId: z.string().optional(),
      methodologyFileIds: z.array(z.string()).default([]),
      validationFileIds: z.array(z.string()).default([]),
      citationFileIds: z.array(z.string()).default([]),
      warnings: z.array(z.string()).default([]),
    })
    .optional(),
  sheets: z.array(
    z.object({
      name: z.string(),
      rowCount: z.number().int().nonnegative(),
      sourceFileId: z.string().default(""),
      sourceFileName: z.string().default(""),
      sourceRole: datasetFileRoleSchema.default("unknown-support"),
      columns: z.array(datasetColumnSchema),
      sampleRows: z.array(z.record(z.string(), z.unknown())).default([]),
    }),
  ),
  warnings: z.array(z.string()).default([]),
});

export const packageEntitySchema = z.object({
  name: z.string(),
  idColumn: z.string(),
  sourceFile: z.string(),
  description: z.string(),
});

export const packageRelationshipSchema = z.object({
  fromFile: z.string(),
  toFile: z.string(),
  leftKey: z.string(),
  rightKey: z.string(),
  relationship: z.enum(["one-to-many", "many-to-many", "one-to-one"]),
  confidence: z.number().min(0).max(1).default(0.6),
  rationale: z.string().default(""),
});

export const metricJoinSchema = z.object({
  file: z.string(),
  leftKey: z.string(),
  rightKey: z.string(),
});

export const filterConditionSchema = z.object({
  column: z.string(),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]),
});

export const executableMetricSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["ratio", "count", "count_distinct", "sum", "average", "delta", "rank", "share"]),
  sourceFile: z.string(),
  joinFiles: z.array(z.string()).default([]),
  joins: z.array(metricJoinSchema).default([]),
  valueColumn: z.string().optional(),
  groupBy: z.array(z.string()).default([]),
  filter: z.array(filterConditionSchema).default([]),
  numerator: z
    .object({
      aggregation: z.enum(["count", "count_distinct", "sum"]),
      column: z.string().optional(),
      filter: z.array(filterConditionSchema).default([]),
    })
    .optional(),
  denominator: z
    .object({
      aggregation: z.enum(["count", "count_distinct", "sum"]),
      column: z.string().optional(),
      filter: z.array(filterConditionSchema).default([]),
    })
    .optional(),
  timeColumn: z.string().optional(),
  sortBy: z
    .object({
      column: z.string(),
      direction: z.enum(["asc", "desc"]),
  })
    .optional(),
  limit: z.number().int().min(1).optional(),
});

export const stageTraceSchema = z.object({
  stage: z.string(),
  promptVersion: z.string().default("v1"),
  requestedModelId: z.string(),
  resolvedModelId: z.string().default(""),
  provider: z.enum(["anthropic", "openai", "none"]),
  status: z.enum(["succeeded", "fallback", "failed", "skipped"]),
  fallbackReason: z.string().default(""),
  errorMessage: z.string().default(""),
  generatedAt: z.string(),
});

export const generationEngineSchema = z.enum([
  "structured-pipeline",
  "claude-code-execution",
]);

export const executionSurfaceSchema = z.enum([
  "vercel-route",
  "railway-worker",
]);

export const directDeckArtifactContractSchema = z.object({
  generationPattern: z.literal("single-turn"),
  requiredArtifacts: z.tuple([
    z.literal("deck.pptx"),
    z.literal("narrative_report.md"),
    z.literal("data_tables.xlsx"),
    z.literal("deck_manifest.json"),
  ]),
  optionalArtifacts: z.array(z.literal("basquio_analysis.json")).default(["basquio_analysis.json"]),
  requiredSkills: z.tuple([
    z.literal("pptx"),
    z.literal("pdf"),
  ]),
  chartArtifactMode: z.literal("raster-screenshot"),
  companionWorkbookChartMode: z.literal("native-editable"),
  executionSurface: executionSurfaceSchema.default("railway-worker"),
});

export const deckExecutionPhaseSchema = z.enum([
  "normalize",
  "understand",
  "author",
  "render",
  "critique",
  "revise",
  "export",
]);

export const deckRunAttemptStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "superseded",
]);

export const deckRunAttemptSchema = z.object({
  id: z.string(),
  runId: z.string(),
  attemptNumber: z.number().int().min(1),
  status: deckRunAttemptStatusSchema,
  recoveryReason: z.string().nullable().default(null),
  failurePhase: deckExecutionPhaseSchema.nullable().default(null),
  failureMessage: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  supersededByAttemptId: z.string().nullable().default(null),
  supersedesAttemptId: z.string().nullable().default(null),
});

export const workspaceLaunchSourceSchema = z.enum([
  "workspace-chat",
  "workspace-deliverable",
  "jobs-new",
  "other",
]);

export const workspaceScopeSchema = z.object({
  id: z.string().nullable().default(null),
  kind: z.string().nullable().default(null),
  name: z.string().nullable().default(null),
});

export const workspaceStakeholderSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().nullable().default(null),
  preferences: z.record(z.string(), z.unknown()).default({}),
});

export const workspaceRulePackSchema = z.object({
  workspace: z.array(z.string()).default([]),
  analyst: z.array(z.string()).default([]),
  scoped: z.array(z.string()).default([]),
});

export const workspaceCitedSourceSchema = z.object({
  documentId: z.string(),
  fileName: z.string(),
  sourceFileId: z.string().nullable().default(null),
});

export const workspaceContextSourceFileSchema = z.object({
  id: z.string(),
  kind: z.string(),
  fileName: z.string(),
  storageBucket: z.string(),
  storagePath: z.string(),
});

export const workspaceContextLineageSchema = z.object({
  conversationId: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  deliverableTitle: z.string().nullable().default(null),
  prompt: z.string().nullable().default(null),
  launchSource: workspaceLaunchSourceSchema.default("jobs-new"),
});

export const workspaceStyleContractSchema = z.object({
  language: z.string().nullable().default(null),
  tone: z.string().nullable().default(null),
  deckLength: z.string().nullable().default(null),
  chartPreferences: z.array(z.string()).default([]),
});

export const workspaceContextPackSchema = z.object({
  workspaceId: z.string(),
  workspaceScopeId: z.string().nullable().default(null),
  deliverableId: z.string().nullable().default(null),
  scope: workspaceScopeSchema.default({}),
  stakeholders: z.array(workspaceStakeholderSchema).default([]),
  rules: workspaceRulePackSchema.default({
    workspace: [],
    analyst: [],
    scoped: [],
  }),
  citedSources: z.array(workspaceCitedSourceSchema).default([]),
  sourceFiles: z.array(workspaceContextSourceFileSchema).default([]),
  lineage: workspaceContextLineageSchema.default({
    conversationId: null,
    messageId: null,
    deliverableTitle: null,
    prompt: null,
    launchSource: "jobs-new",
  }),
  styleContract: workspaceStyleContractSchema.default({
    language: null,
    tone: null,
    deckLength: null,
    chartPreferences: [],
  }),
  renderedBriefPrelude: z.string().default(""),
  createdAt: z.string(),
  schemaVersion: z.number().int().min(1).default(1),
});

export const runRequestUsageSchema = z.object({
  runId: z.string(),
  attemptId: z.string(),
  attemptNumber: z.number().int().min(1),
  phase: deckExecutionPhaseSchema,
  requestKind: z.string(),
  provider: z.literal("anthropic"),
  model: z.string(),
  anthropicRequestId: z.string().nullable().default(null),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
});

export const pipelineStageSchema = z.enum([
  "intake and profiling",
  "package semantics inference",
  "metric planning",
  "deterministic analytics execution",
  "insight ranking",
  "story architecture",
  "outline architecture",
  "design translation",
  "slide architecture",
  "deterministic validation",
  "semantic critique",
  "targeted revision loop",
  "render pptx",
  "render pdf",
  "artifact qa and delivery",
]);

export const revisionTargetStageSchema = z.enum(["metrics", "insights", "story", "design", "slides"]);

export const revisionDecisionSchema = z.object({
  attempt: z.number().int().min(1),
  trigger: z.enum(["deterministic-validation", "semantic-critique", "combined-review"]),
  targetStage: revisionTargetStageSchema,
  rationale: z.string(),
  reviewerFeedback: z.array(z.string()).default([]),
  issueCodes: z.array(z.string()).default([]),
});

export const candidateMetricSchema = z.object({
  name: z.string(),
  formula: z.string(),
  executableSpec: z.lazy(() => executableMetricSpecSchema).optional(),
  sourceFiles: z.array(z.string()).min(1),
  dimensions: z.array(z.string()).default([]),
  description: z.string(),
});

export const packageSemanticsSchema = z.object({
  domain: z.string(),
  packageType: z.string(),
  entities: z.array(packageEntitySchema).default([]),
  relationships: z.array(packageRelationshipSchema).default([]),
  candidateMetrics: z.array(candidateMetricSchema).default([]),
  candidateDimensions: z.array(z.string()).default([]),
  candidateTimeAxes: z.array(z.string()).default([]),
  reportableQuestions: z.array(z.string()).default([]),
  methodologyContext: z.string().optional(),
  definitionsContext: z.string().optional(),
});

export const evidenceRefSchema = z.object({
  id: z.string(),
  sourceFileId: z.string().default(""),
  fileName: z.string().default(""),
  fileRole: datasetFileRoleSchema.default("unknown-support"),
  sheet: z.string(),
  metric: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  sourceLocation: z.string().default(""),
  rawValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  derivedTable: z.string().optional(),
  dimensions: z.record(z.string(), z.string()).default({}),
});

export const evidenceSchema = evidenceRefSchema;

export const metricStatisticSchema = z.enum([
  "sum",
  "average",
  "min",
  "max",
  "numericCount",
  "distinctCount",
]);

export const numericAssertionSchema = z.object({
  evidenceId: z.string(),
  sourceFileId: z.string().default(""),
  fileName: z.string().default(""),
  sheet: z.string(),
  metric: z.string(),
  statistic: metricStatisticSchema,
  expectedValue: z.number(),
  tolerance: z.number().nonnegative().default(0.001),
});

export const claimLineageSchema = z.object({
  insightId: z.string().optional(),
  sectionId: z.string().optional(),
  slideId: z.string().optional(),
});

export const claimSpecSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(["thesis", "finding", "methodology", "implication", "recommendation"]),
  evidenceIds: z.array(z.string()).min(1),
  numericAssertions: z.array(numericAssertionSchema).default([]),
  lineage: claimLineageSchema.default({}),
});

export const reportBriefSchema = z.object({
  businessContext: z.string().default(""),
  client: z.string().default(""),
  audience: z.string().default("Executive stakeholder"),
  objective: z.string().default("Explain the business performance signal"),
  thesis: z.string().default(""),
  stakes: z.string().default(""),
});

export const reportSectionSchema = z.object({
  id: z.string(),
  kind: z.enum(["framing", "methodology", "findings", "implications", "recommendations", "analysis", "appendix"]),
  title: z.string(),
  summary: z.string(),
  objective: z.string(),
  supportingInsightIds: z.array(z.string()).default([]),
  emphasis: z.enum(["heavy", "standard", "light"]).default("standard"),
  suggestedSlideCount: z.number().int().min(1).default(1),
});

export const reportOutlineSchema = z.object({
  title: z.string().default("Basquio report"),
  sections: z.array(reportSectionSchema).min(1),
});

export const insightSpecSchema = z.object({
  id: z.string(),
  rank: z.number().int().min(1).default(1),
  title: z.string(),
  claim: z.string(),
  businessMeaning: z.string(),
  confidence: z.number().min(0).max(1),
  confidenceLabel: confidenceLevelSchema.default("MEDIUM"),
  finding: z.string().default(""),
  implication: z.string().default(""),
  evidence: z.array(evidenceRefSchema).min(1),
  evidenceRefIds: z.array(z.string()).default([]),
  chartSuggestion: z.string().optional(),
  slideEmphasis: z.enum(["lead", "support", "detail"]).default("support"),
  claims: z.array(claimSpecSchema).min(1),
});

export const storySpecSchema = z.object({
  client: z.string().default(""),
  audience: z.string(),
  objective: z.string(),
  thesis: z.string().default(""),
  stakes: z.string().default(""),
  title: z.string().default(""),
  executiveSummary: z.string().default(""),
  narrativeArcType: z.enum(["opportunity", "threat", "transformation", "validation", "discovery"]).default("discovery"),
  narrativeArc: z.array(z.string()).min(1),
  keyMessages: z.array(z.string()).min(1),
  sections: z.array(reportSectionSchema).default([]),
  recommendedSlideCount: z.number().int().min(1).default(6),
  recommendedActions: z.array(z.string()).default([]),
});

export const computedMetricSchema = z.object({
  name: z.string(),
  metricType: executableMetricSpecSchema.shape.type.optional(),
  overallValue: z.union([z.number(), z.string()]),
  stddev: z.number().default(0),
  sampleSize: z.number().int().nonnegative().default(0),
  byDimension: z.record(
    z.string(),
    z.array(
      z.object({
        key: z.string(),
        value: z.number(),
      }),
    ),
  ),
  evidenceRefIds: z.array(z.string()).default([]),
});

export const derivedTableSchema = z.object({
  name: z.string(),
  description: z.string(),
  columns: z.array(z.string()).default([]),
  rows: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const analyticsResultSchema = z.object({
  metrics: z.array(computedMetricSchema).default([]),
  correlations: z
    .array(
      z.object({
        metric1: z.string(),
        metric2: z.string(),
        r: z.number(),
        significance: z.enum(["high", "medium", "low"]),
      }),
    )
    .default([]),
  rankings: z
    .array(
      z.object({
        dimension: z.string(),
        metric: z.string(),
        order: z.array(
          z.object({
            key: z.string(),
            value: z.number(),
          }),
        ),
      }),
    )
    .default([]),
  deltas: z
    .array(
      z.object({
        metric: z.string(),
        period1: z.string(),
        period2: z.string(),
        absoluteChange: z.number(),
        pctChange: z.number(),
      }),
    )
    .default([]),
  distributions: z
    .array(
      z.object({
        metric: z.string(),
        histogram: z.array(
          z.object({
            bucket: z.string(),
            count: z.number().int().nonnegative(),
          }),
        ),
        skew: z.number().default(0),
        kurtosis: z.number().default(0),
      }),
    )
    .default([]),
  outliers: z
    .array(
      z.object({
        entity: z.string(),
        metric: z.string(),
        value: z.number(),
        zscore: z.number(),
        direction: z.enum(["high", "low"]),
      }),
    )
    .default([]),
  segmentBreakdowns: z
    .array(
      z.object({
        dimension: z.string(),
        segments: z.array(
          z.object({
            name: z.string(),
            metrics: z.record(z.string(), z.number()),
          }),
        ),
      }),
    )
    .default([]),
  derivedTables: z.array(derivedTableSchema).default([]),
  evidenceRefs: z.array(evidenceRefSchema).default([]),
});

export const chartSpecSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  family: z.enum([
    "line",
    "bar",
    "stacked-bar",
    "area",
    "pie",
    "combo",
    "waterfall",
    "scatter",
    "table",
    "doughnut",
    "funnel",
    "heatmap",
    "radar",
    "timeline",
    "marimekko",
    "matrix",
    "quadrant",
    "horizontal-bar",
    "grouped-bar",
  ]),
  editableInPptx: z.boolean().default(false),
  artifactMode: z.enum(["raster-screenshot"]).default("raster-screenshot"),
  categories: z.array(z.string()).default([]),
  series: z.array(
    z.object({
      name: z.string(),
      dataKey: z.string().default("value"),
      values: z.array(z.number()).default([]),
    }),
  ),
  xKey: z.string().optional(),
  yKeys: z.array(z.string()).default([]),
  summary: z.string().default(""),
  annotation: z.string().default(""),
  evidenceIds: z.array(z.string()).default([]),
  dataBinding: z
    .object({
      derivedTable: z.string(),
      categoryColumn: z.string(),
      valueColumns: z.array(z.string()).default([]),
    })
    .optional(),
  bindings: z.array(
    z.object({
      id: z.string(),
      evidenceId: z.string(),
      sourceFileId: z.string().default(""),
      fileName: z.string().default(""),
      sheet: z.string(),
      metric: z.string(),
      statistic: metricStatisticSchema,
    }),
  ).default([]),
});

export const templateRegionBindingSchema = z.object({
  layoutId: z.string(),
  regionKey: z.string(),
  placeholder: z.string(),
  placeholderIndex: z.number().int().nonnegative().default(0),
  name: z.string().default(""),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  w: z.number().positive(),
  h: z.number().positive(),
  source: z.enum(["system", "layout", "master"]).default("system"),
});

export const slideBlockSchema = z.object({
  kind: z.enum([
    "title",
    "subtitle",
    "body",
    "chart",
    "table",
    "callout",
    "bullet-list",
    "metric",
    "evidence-list",
    "divider",
  ]),
  content: z.string().optional(),
  chartId: z.string().optional(),
  items: z.array(z.string()).default([]),
  label: z.string().optional(),
  value: z.string().optional(),
  tone: z.enum(["default", "positive", "caution", "neutral"]).default("default"),
  evidenceIds: z.array(z.string()).default([]),
  templateBinding: templateRegionBindingSchema.optional(),
});

export const slideSpecSchema = z.object({
  id: z.string(),
  purpose: z.string(),
  section: z.string().default(""),
  eyebrow: z.string().optional(),
  emphasis: z.enum(["cover", "section", "content"]).default("content"),
  layoutId: z.string(),
  slideArchetype: z.string().default("title-body"),
  title: z.string(),
  subtitle: z.string().optional(),
  blocks: z.array(slideBlockSchema).min(1),
  claimIds: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  speakerNotes: z.string().default(""),
  transition: z.string().default(""),
});

export const validationIssueSchema = z.object({
  code: z.string(),
  validator: z.enum(["deterministic", "semantic"]).default("deterministic"),
  severity: z.enum(["error", "warning"]).default("error"),
  message: z.string(),
  backtrackStage: revisionTargetStageSchema.optional(),
  claimId: z.string().optional(),
  slideId: z.string().optional(),
  chartId: z.string().optional(),
  evidenceId: z.string().optional(),
});

export const validationReportSchema = z.object({
  jobId: z.string(),
  generatedAt: z.string(),
  status: z.enum(["passed", "needs_input", "failed"]),
  claimCount: z.number().int().nonnegative().default(0),
  chartCount: z.number().int().nonnegative().default(0),
  slideCount: z.number().int().nonnegative().default(0),
  attemptCount: z.number().int().min(1).default(1),
  targetStage: revisionTargetStageSchema.optional(),
  reviewerFeedback: z.array(z.string()).default([]),
  deterministicIssueCount: z.number().int().nonnegative().default(0),
  semanticIssueCount: z.number().int().nonnegative().default(0),
  issues: z.array(validationIssueSchema).default([]),
  traces: z.array(stageTraceSchema).default([]),
});

export const templateBrandTokensSchema = z.object({
  palette: z
    .object({
      text: z.string().default("#0B0C0C"),
      muted: z.string().default("#5D656B"),
      background: z.string().default("#F5F1E8"),
      surface: z.string().default("#FBF8F1"),
      accent: z.string().default("#1A6AFF"),
      accentMuted: z.string().default("#E0EBFF"),
      accentLight: z.string().default("#E0EBFF"),
      highlight: z.string().default("#F0CC27"),
      border: z.string().default("#D6D1C4"),
      positive: z.string().default("#4CC9A0"),
      negative: z.string().default("#E8636F"),
      coverBg: z.string().default("#F5F1E8"),
      calloutGreen: z.string().default("#4CC9A0"),
      calloutOrange: z.string().default("#F0CC27"),
    })
    .default({}),
  typography: z
    .object({
      headingFont: z.string().default("Arial"),
      bodyFont: z.string().default("Arial"),
      monoFont: z.string().default("Courier New"),
      titleSize: z.number().default(24),
      bodySize: z.number().default(12),
    })
    .default({}),
  spacing: z
    .object({
      pageX: z.number().default(0.6),
      pageY: z.number().default(0.5),
      sectionGap: z.number().default(0.32),
      blockGap: z.number().default(0.2),
      cardRadius: z.number().default(0.12),
    })
    .default({}),
  chartPalette: z.array(z.string()).default([]),
  logo: z
    .object({
      wordmarkPath: z.string().optional(),
      iconPath: z.string().optional(),
      imageBase64: z.string().optional(),
      position: z
        .object({
          x: z.number().nonnegative(),
          y: z.number().nonnegative(),
          w: z.number().positive(),
          h: z.number().positive(),
        })
        .optional(),
      treatment: z.string().default("default"),
    })
    .default({}),
  decorativeShapes: z.array(
    z.object({
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
      w: z.number().positive(),
      h: z.number().positive(),
      fill: z.string(),
    }),
  ).default([]),
  /** Deterministic injection payload for post-generation template branding (PGTI). */
  injection: z.object({
    themeColorSchemeXml: z.string(),
    themeFontSchemeXml: z.string(),
    logoBase64: z.string().nullable(),
    logoMimeType: z.enum(["image/png", "image/jpeg"]).default("image/png"),
    logoPosition: z.object({
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
      w: z.number().positive(),
      h: z.number().positive(),
    }).nullable(),
    decorativeShapes: z.array(
      z.object({
        x: z.number().nonnegative(),
        y: z.number().nonnegative(),
        w: z.number().positive(),
        h: z.number().positive(),
        fill: z.string(),
      }),
    ).default([]),
    masterBackground: z.string().nullable(),
  }).optional(),
});

export const templateProfileSchema = z.object({
  id: z.string(),
  sourceType: z.enum(["system", "pptx", "brand-tokens", "pdf-style-reference"]),
  templateName: z.string().default(""),
  themeName: z.string().default(""),
  sourceFingerprint: z.string().default(""),
  slideSize: z.string(),
  slideWidthInches: z.number().positive().default(13.333),
  slideHeightInches: z.number().positive().default(7.5),
  fonts: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  spacingTokens: z.array(z.string()).default([]),
  logoAssetHints: z.array(z.string()).default([]),
  placeholderCatalog: z.array(z.string()).default([]),
  brandTokens: templateBrandTokensSchema.optional(),
  warnings: z.array(z.string()).default([]),
  layouts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      sourceName: z.string().default(""),
      sourceMaster: z.string().default(""),
      sourceSlideNumber: z.number().int().min(1).optional(),
      sourceSlideName: z.string().default(""),
      placeholders: z.array(z.string()).default([]),
      regions: z
        .array(
          z.object({
            key: z.string(),
            placeholder: z.string(),
            placeholderIndex: z.number().int().nonnegative().default(0),
            name: z.string().default(""),
            x: z.number().nonnegative(),
            y: z.number().nonnegative(),
            w: z.number().positive(),
            h: z.number().positive(),
            source: z.enum(["system", "layout", "master"]).default("system"),
          }),
        )
        .default([]),
      notes: z.array(z.string()).default([]),
    }),
  ),
});

export const artifactProviderSchema = z.enum(["supabase", "database", "local"]);

// `pdf` remains part of the schema for legacy manifests and internal QA/checkpoint
// artifacts, but new durable user-facing publishes do not require it.
export const artifactKindSchema = z.enum(["pptx", "pdf", "md", "xlsx"]);

export const artifactRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  kind: artifactKindSchema,
  fileName: z.string(),
  mimeType: z.string(),
  storagePath: z.string(),
  byteSize: z.number().int().nonnegative(),
  provider: artifactProviderSchema.default("local"),
  checksumSha256: z.string().default(""),
  exists: z.boolean().default(true),
  slideCount: z.number().int().nonnegative().optional(),
  sectionCount: z.number().int().nonnegative().optional(),
  pageCount: z.number().int().nonnegative().optional(),
});

export const artifactManifestSchema = z.object({
  jobId: z.string(),
  generatedAt: z.string(),
  expectedSlideCount: z.number().int().nonnegative(),
  expectedSectionCount: z.number().int().nonnegative(),
  artifacts: z.array(artifactRecordSchema).min(1),
});

export const qualityCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["passed", "warning", "failed"]),
  detail: z.string(),
  artifactKind: artifactKindSchema.optional(),
});

export const qualityReportSchema = z.object({
  jobId: z.string(),
  generatedAt: z.string(),
  status: z.enum(["passed", "warning", "failed"]),
  checks: z.array(qualityCheckSchema).default([]),
});

export type DatasetProfile = z.infer<typeof datasetProfileSchema>;
export type PackageSemantics = z.infer<typeof packageSemanticsSchema>;
export type PackageEntity = z.infer<typeof packageEntitySchema>;
export type PackageRelationship = z.infer<typeof packageRelationshipSchema>;
export type CandidateMetric = z.infer<typeof candidateMetricSchema>;
export type ExecutableMetricSpec = z.infer<typeof executableMetricSpecSchema>;
export type StageTrace = z.infer<typeof stageTraceSchema>;
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export type RevisionTargetStage = z.infer<typeof revisionTargetStageSchema>;
export type RevisionDecision = z.infer<typeof revisionDecisionSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type NumericAssertion = z.infer<typeof numericAssertionSchema>;
export type ClaimSpec = z.infer<typeof claimSpecSchema>;
export type ReportBrief = z.infer<typeof reportBriefSchema>;
export type WorkspaceContextPack = z.infer<typeof workspaceContextPackSchema>;
export type ReportOutline = z.infer<typeof reportOutlineSchema>;
export type InsightSpec = z.infer<typeof insightSpecSchema>;
export type StorySpec = z.infer<typeof storySpecSchema>;
export type ComputedMetric = z.infer<typeof computedMetricSchema>;
export type DerivedTable = z.infer<typeof derivedTableSchema>;
export type AnalyticsResult = z.infer<typeof analyticsResultSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type TemplateRegionBinding = z.infer<typeof templateRegionBindingSchema>;
export type SlideSpec = z.infer<typeof slideSpecSchema>;
export type TemplateProfile = z.infer<typeof templateProfileSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;
export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
export type QualityCheck = z.infer<typeof qualityCheckSchema>;
export type QualityReport = z.infer<typeof qualityReportSchema>;
