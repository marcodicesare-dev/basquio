import { z } from "zod";

import {
  artifactKindSchema,
  chartSpecSchema,
  datasetProfileSchema,
  evidenceRefSchema,
  packageSemanticsSchema,
  reportBriefSchema,
  templateProfileSchema,
} from "./contracts";

// ─── DECK RUN ──────────────────────────────────────────────────────
// One durable job record. The state machine.
// Replaces: generation_jobs + synthetic run-status

export const deckRunPhaseSchema = z.enum([
  "normalize",
  "understand",
  "plan",
  "author",
  "polish",
  "critique",
  "revise",
  "export",
]);

export const deckRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const deckRunSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  requestedBy: z.string().uuid().optional(),

  brief: reportBriefSchema.default({}),
  businessContext: z.string().default(""),
  client: z.string().default(""),
  audience: z.string().default("Executive stakeholder"),
  objective: z.string().default(""),
  thesis: z.string().default(""),
  stakes: z.string().default(""),

  sourceFileIds: z.array(z.string().uuid()).default([]),
  templateProfileId: z.string().uuid().optional(),

  status: deckRunStatusSchema.default("queued"),
  currentPhase: deckRunPhaseSchema.optional(),
  phaseStartedAt: z.string().optional(),

  failureMessage: z.string().optional(),
  failurePhase: deckRunPhaseSchema.optional(),
  retryCount: z.number().int().nonnegative().default(0),

  inngestRunId: z.string().optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});

// ─── DECK RUN EVENTS ──────────────────────────────────────────────
// Event-sourced progress from real tool calls.

export const deckRunEventTypeSchema = z.enum([
  "phase_started",
  "tool_call",
  "tool_result",
  "phase_completed",
  "error",
  "checkpoint",
]);

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const deckRunEventSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  phase: deckRunPhaseSchema,
  eventType: deckRunEventTypeSchema,
  toolName: z.string().optional(),
  stepNumber: z.number().int().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  usage: tokenUsageSchema.optional(),
  durationMs: z.number().int().optional(),
  createdAt: z.string(),
});

// ─── EVIDENCE WORKSPACE ───────────────────────────────────────────
// Normalized uploaded files + extracted text/tables + brand/template assets.
// Replaces: current intake/profiling stage output

export const evidenceFileInventoryItemSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  kind: z.string(),
  role: z.string(),
  mediaType: z.string().default("application/octet-stream"),
  sheets: z.array(z.object({
    name: z.string(),
    rowCount: z.number().int().nonnegative(),
    columnCount: z.number().int().nonnegative(),
    columns: z.array(z.object({
      name: z.string(),
      inferredType: z.enum(["string", "number", "date", "boolean", "unknown"]),
      role: z.enum(["dimension", "measure", "time", "segment", "identifier", "unknown"]),
      sampleValues: z.array(z.string()).default([]),
      uniqueCount: z.number().int().nonnegative().default(0),
      uniqueCountApproximate: z.boolean().optional(),
      nullRate: z.number().min(0).max(1).default(0),
    })).default([]),
  })).default([]),
  textContent: z.string().optional(),
  pages: z.array(z.object({
    num: z.number().int(),
    text: z.string(),
  })).optional(),
  pageCount: z.number().int().optional(),
  warnings: z.array(z.string()).default([]),
});

export const evidenceWorkspaceSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  fileInventory: z.array(evidenceFileInventoryItemSchema).default([]),
  datasetProfile: datasetProfileSchema.optional(),
  packageSemantics: packageSemanticsSchema.optional(),
  templateProfile: templateProfileSchema.optional(),
  sheetData: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ─── ANALYSIS NOTEBOOK ────────────────────────────────────────────
// Every tool call, query result, evidence ref, chart dataset, reasoning checkpoint.
// Persisted with stable IDs. Makes runs debuggable, replayable, eval-ready.
// Replaces: current analytics result blob

export const notebookEntrySchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  phase: deckRunPhaseSchema,
  stepNumber: z.number().int().nonnegative(),
  toolName: z.string(),
  toolInput: z.record(z.string(), z.unknown()).default({}),
  toolOutput: z.record(z.string(), z.unknown()).default({}),
  evidenceRefId: z.string().optional(),
  durationMs: z.number().int().optional(),
  createdAt: z.string(),
});

// ─── DECK SPEC V2 ────────────────────────────────────────────────
// Working deck state, slide by slide. Built incrementally by the author agent.
// Replaces: current slide blueprints + materialized slides

// DB schema — NOT used as Output.object(). Optional fields are nullable in Postgres.
export const deckSpecV2SlideSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  position: z.number().int().min(1),
  layoutId: z.string(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  kicker: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  bullets: z.array(z.string()).nullable().optional(),
  chartId: z.string().nullable().optional(),
  metrics: z.array(z.object({
    label: z.string(),
    value: z.string(),
    delta: z.string().optional(),
  })).nullable().optional(),
  callout: z.object({
    text: z.string(),
    tone: z.enum(["accent", "green", "orange"]).optional(),
  }).nullable().optional(),
  evidenceIds: z.array(z.string()).default([]),
  speakerNotes: z.string().nullable().optional(),
  transition: z.string().nullable().optional(),
  sceneGraph: z.record(z.string(), z.unknown()).nullable().optional(),
  previewUrl: z.string().nullable().optional(),
  qaStatus: z.enum(["pending", "passed", "failed"]).default("pending"),
  revision: z.number().int().min(1).default(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

// DB schema — NOT used as Output.object().
export const deckSpecV2ChartSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  chartType: z.enum([
    "bar", "horizontal_bar", "grouped_bar",
    "stacked_bar", "stacked_bar_100",
    "line", "area",
    "pie", "doughnut",
    "scatter",
    "waterfall",
    "table",
    "funnel", "marimekko", "matrix", "quadrant",
    // Legacy compat
    "heatmap",
  ]),
  title: z.string(),
  data: z.array(z.record(z.string(), z.unknown())),
  xAxis: z.string(),
  yAxis: z.string().default(""),
  series: z.array(z.string()),
  style: z.object({
    colors: z.array(z.string()).optional(),
    showLegend: z.boolean().optional(),
    showValues: z.boolean().optional(),
    highlightCategories: z.array(z.string()).optional(),
  }).default({}),
  // Semantic fields from chart design system
  intent: z.enum([
    "rank", "trend", "composition", "bridge", "correlation",
    "comparison", "distribution", "flow", "detail", "positioning",
    "timeline", "proportion",
  ]).nullable().optional(),
  unit: z.string().nullable().optional(),
  benchmarkLabel: z.string().nullable().optional(),
  benchmarkValue: z.number().nullable().optional(),
  sourceNote: z.string().nullable().optional(),
  thumbnailUrl: z.string().default(""),
  width: z.number().int().default(0),
  height: z.number().int().default(0),
  createdAt: z.string().optional(),
});

// Full deck spec assembled from slides + charts
export const deckSpecV2Schema = z.object({
  runId: z.string().uuid(),
  slides: z.array(deckSpecV2SlideSchema),
  charts: z.array(deckSpecV2ChartSchema),
  summary: z.string(),
  slideCount: z.number().int().nonnegative(),
});

// ─── ARTIFACT MANIFEST V2 ────────────────────────────────────────
// Only published after export + QA pass.
// Replaces: current artifact persistence (which races with status)

export const artifactEntryV2Schema = z.object({
  id: z.string().uuid(),
  kind: artifactKindSchema,
  fileName: z.string(),
  mimeType: z.string(),
  storageBucket: z.string().default("artifacts"),
  storagePath: z.string(),
  fileBytes: z.number().int().nonnegative(),
  checksumSha256: z.string().default(""),
});

export const artifactManifestV2Schema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  slideCount: z.number().int().nonnegative(),
  pageCount: z.number().int().optional(),
  qaPassed: z.boolean().default(false),
  qaReport: z.record(z.string(), z.unknown()).default({}),
  artifacts: z.array(artifactEntryV2Schema).default([]),
  publishedAt: z.string().optional(),
  createdAt: z.string(),
});

// ─── CRITIQUE REPORT ─────────────────────────────────────────────

export const critiqueIssueSchema = z.object({
  type: z.enum(["factual_error", "numeric_mismatch", "missing_evidence", "narrative_gap", "brief_misalignment", "layout_issue"]),
  severity: z.enum(["critical", "major", "minor"]),
  slideId: z.string(),
  claim: z.string(),
  expectedValue: z.string(),
  actualValue: z.string(),
  evidence: z.string(),
  suggestion: z.string(),
});

// Model-facing schema: only fields the LLM can generate.
// Used as Output.object() for the critic agent.
// NOTE: OpenAI structured output rejects ALL numeric constraints (minimum, maximum,
// exclusiveMinimum, nonnegative) on integer types. Use .describe() instead.
export const critiqueReportOutputSchema = z.object({
  iteration: z.number().int().describe("Critique iteration number, starting from 1"),
  hasIssues: z.boolean(),
  issues: z.array(critiqueIssueSchema),
  coverageScore: z.number().describe("0.0 to 1.0"),
  accuracyScore: z.number().describe("0.0 to 1.0"),
  narrativeScore: z.number().describe("0.0 to 1.0"),
});

// Full schema including orchestration-assigned metadata.
// NOT used as Output.object() — assembled by the orchestration layer.
export const critiqueReportSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  iteration: z.number().int().min(1),
  hasIssues: z.boolean(),
  issues: z.array(critiqueIssueSchema),
  coverageScore: z.number().min(0).max(1),
  accuracyScore: z.number().min(0).max(1),
  narrativeScore: z.number().min(0).max(1),
  modelId: z.string(),
  provider: z.string(),
  usage: tokenUsageSchema,
  createdAt: z.string(),
});

// ─── ANALYSIS REPORT ──────────────────────────────────────────────
// Structured output from the analyst agent (UNDERSTAND phase)

// NOTE: Schemas used as Output.object() for OpenAI structured outputs MUST have
// ALL properties required (no .optional() or .default()). OpenAI strict mode
// rejects schemas where 'required' doesn't include every property key.
export const analysisReportSchema = z.object({
  summary: z.string(),
  domain: z.string(),
  topFindings: z.array(z.object({
    title: z.string(),
    claim: z.string(),
    evidenceRefIds: z.array(z.string()),
    confidence: z.number().describe("0.0 to 1.0"),
    businessImplication: z.string(),
  })),
  metricsComputed: z.number().int().describe("Number of metrics computed, >= 0"),
  queriesExecuted: z.number().int().describe("Number of queries executed, >= 0"),
  filesAnalyzed: z.number().int().describe("Number of files analyzed, >= 0"),
  keyDimensions: z.array(z.string()),
  recommendedChartTypes: z.array(z.object({
    findingIndex: z.number().int().describe("0-indexed finding reference"),
    chartType: z.string(),
    rationale: z.string(),
  })),
});

// ─── CLARIFIED BRIEF ─────────────────────────────────────────────
// Working paper: the analyst's interpretation of the user's request.

export const clarifiedBriefSchema = z.object({
  governingQuestion: z.string().describe("The single question this deck must answer"),
  focalEntity: z.string().describe("The client/brand/company this deck is about"),
  focalBrands: z.array(z.string()).describe("Key brands/products/sub-entities of the focal entity"),
  audience: z.string().describe("Who will see this deck and what decisions they make"),
  language: z.string().describe("Detected output language: en, it, de, fr, es, etc."),
  objective: z.string().describe("What the deck must accomplish"),
  requestedSlideCount: z.number().int().nullable().describe("From the brief, or null if not specified. Must be >= 1 when present"),
  stakes: z.string().describe("What is at risk if the recommendation is wrong"),
  hypotheses: z.array(z.string()).describe("Initial hypotheses before deep analysis"),
});

// ─── STORYLINE PLAN ──────────────────────────────────────────────
// Working paper: the issue tree that structures the analysis.

export const storylineHypothesisSchema = z.object({
  claim: z.string(),
  evidenceRequired: z.array(z.string()).describe("What data would confirm or refute this"),
  evidenceFound: z.array(z.string()).describe("Evidence ref IDs that address this"),
  status: z.enum(["confirmed", "refuted", "pending", "partial"]),
});

export const storylineIssueBranchSchema = z.object({
  question: z.string().describe("A sub-question that must be answered"),
  hypotheses: z.array(storylineHypothesisSchema),
  conclusion: z.string().describe("What the evidence says about this branch"),
  slideImplication: z.string().describe("What kind of slide(s) this branch needs"),
});

export const recommendationShapeSchema = z.object({
  condition: z.string().describe("Under what conditions this recommendation applies"),
  recommendation: z.string(),
  quantification: z.string().describe("Expected impact, sized if possible"),
  confidence: z.enum(["high", "medium", "low"]),
});

export const storylinePlanSchema = z.object({
  governingQuestion: z.string(),
  issueBranches: z.array(storylineIssueBranchSchema),
  recommendationShapes: z.array(recommendationShapeSchema),
  titleReadThrough: z.array(z.string()).describe("Proposed title sequence for the full deck"),
});

// ─── DECK PLAN ───────────────────────────────────────────────────
// Working paper: structured slide-level plan before authoring.

export const deckPlanSlideSpecSchema = z.object({
  position: z.number().int().describe("1-indexed slide position"),
  role: z.string().describe("cover, exec-summary, context, evidence, comparison, synthesis, recommendation, appendix"),
  layout: z.string(),
  governingThought: z.string().describe("The one sentence this slide must communicate"),
  chartIntent: z.string().describe("rank, trend, composition, bridge, correlation, comparison, kpi, table, none"),
  evidenceRequired: z.array(z.string()).describe("Evidence ref IDs this slide must cite"),
  focalObject: z.string().describe("What entity/metric is the star of this slide"),
});

export const deckPlanSectionSchema = z.object({
  sectionId: z.string(),
  title: z.string(),
  issueBranch: z.string().describe("Which issue branch this section addresses"),
  slides: z.array(deckPlanSlideSpecSchema),
});

export const deckPlanSchema = z.object({
  targetSlideCount: z.number().int().describe("Target number of slides, >= 1"),
  sections: z.array(deckPlanSectionSchema),
  appendixStrategy: z.string().describe("What goes in appendix vs main body"),
});

// ─── TYPED EVIDENCE ──────────────────────────────────────────────
// Working paper: evidence registry with type-discriminated values.

export const typedEvidenceSchema = z.object({
  id: z.string(),
  runId: z.string(),
  evidenceType: z.enum(["metric", "table", "derived_table", "document", "claim"]),
  refId: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  value: z.unknown().describe("Type-dependent: number for metric, rows for table, text for document/claim"),
  sourceSheetKey: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

// ─── DELIVERY STATUS ─────────────────────────────────────────────

export const deliveryStatusSchema = z.enum(["draft", "reviewed", "approved", "degraded", "failed"]);

// ─── TYPE EXPORTS ─────────────────────────────────────────────────

export type ClarifiedBrief = z.infer<typeof clarifiedBriefSchema>;
export type StorylineHypothesis = z.infer<typeof storylineHypothesisSchema>;
export type StorylineIssueBranch = z.infer<typeof storylineIssueBranchSchema>;
export type RecommendationShape = z.infer<typeof recommendationShapeSchema>;
export type StorylinePlan = z.infer<typeof storylinePlanSchema>;
export type DeckPlanSlideSpec = z.infer<typeof deckPlanSlideSpecSchema>;
export type DeckPlanSection = z.infer<typeof deckPlanSectionSchema>;
export type DeckPlan = z.infer<typeof deckPlanSchema>;
export type TypedEvidence = z.infer<typeof typedEvidenceSchema>;
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;
export type DeckRunPhase = z.infer<typeof deckRunPhaseSchema>;
export type DeckRunStatus = z.infer<typeof deckRunStatusSchema>;
export type DeckRun = z.infer<typeof deckRunSchema>;
export type DeckRunEventType = z.infer<typeof deckRunEventTypeSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type DeckRunEvent = z.infer<typeof deckRunEventSchema>;
export type EvidenceFileInventoryItem = z.infer<typeof evidenceFileInventoryItemSchema>;
export type EvidenceWorkspace = z.infer<typeof evidenceWorkspaceSchema>;
export type NotebookEntry = z.infer<typeof notebookEntrySchema>;
export type DeckSpecV2Slide = z.infer<typeof deckSpecV2SlideSchema>;
export type DeckSpecV2Chart = z.infer<typeof deckSpecV2ChartSchema>;
export type DeckSpecV2 = z.infer<typeof deckSpecV2Schema>;
export type ArtifactEntryV2 = z.infer<typeof artifactEntryV2Schema>;
export type ArtifactManifestV2 = z.infer<typeof artifactManifestV2Schema>;
export type CritiqueIssue = z.infer<typeof critiqueIssueSchema>;
export type CritiqueReportOutput = z.infer<typeof critiqueReportOutputSchema>;
export type CritiqueReport = z.infer<typeof critiqueReportSchema>;
export type AnalysisReport = z.infer<typeof analysisReportSchema>;
