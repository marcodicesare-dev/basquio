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
  "author",
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

export const deckSpecV2SlideSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  position: z.number().int().positive(),
  layoutId: z.string(),
  title: z.string(),
  subtitle: z.string(),
  body: z.string(),
  bullets: z.array(z.string()),
  chartId: z.string(),
  metrics: z.array(z.object({
    label: z.string(),
    value: z.string(),
    delta: z.string(),
  })),
  evidenceIds: z.array(z.string()),
  speakerNotes: z.string(),
  transition: z.string(),
  sceneGraph: z.record(z.string(), z.unknown()),
  previewUrl: z.string(),
  qaStatus: z.enum(["pending", "passed", "failed"]),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const deckSpecV2ChartSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  chartType: z.enum(["bar", "line", "pie", "scatter", "waterfall", "heatmap", "stacked_bar", "table"]),
  title: z.string(),
  data: z.array(z.record(z.string(), z.unknown())),
  xAxis: z.string(),
  yAxis: z.string(),
  series: z.array(z.string()),
  style: z.object({
    colors: z.array(z.string()),
    showLegend: z.boolean(),
    showValues: z.boolean(),
  }),
  thumbnailUrl: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  createdAt: z.string(),
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
export const critiqueReportOutputSchema = z.object({
  iteration: z.number().int().positive(),
  hasIssues: z.boolean(),
  issues: z.array(critiqueIssueSchema),
  coverageScore: z.number().min(0).max(1),
  accuracyScore: z.number().min(0).max(1),
  narrativeScore: z.number().min(0).max(1),
});

// Full schema including orchestration-assigned metadata.
// NOT used as Output.object() — assembled by the orchestration layer.
export const critiqueReportSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  iteration: z.number().int().positive(),
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
    confidence: z.number().min(0).max(1),
    businessImplication: z.string(),
  })),
  metricsComputed: z.number().int().nonnegative(),
  queriesExecuted: z.number().int().nonnegative(),
  filesAnalyzed: z.number().int().nonnegative(),
  keyDimensions: z.array(z.string()),
  recommendedChartTypes: z.array(z.object({
    findingIndex: z.number().int().nonnegative(),
    chartType: z.string(),
    rationale: z.string(),
  })),
});

// ─── TYPE EXPORTS ─────────────────────────────────────────────────

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
