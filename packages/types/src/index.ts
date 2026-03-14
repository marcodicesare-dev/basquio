import { z } from "zod";

import {
  artifactManifestSchema,
  artifactRecordSchema,
  chartSpecSchema,
  datasetProfileSchema,
  datasetFileRoleSchema,
  insightSpecSchema,
  qualityReportSchema,
  reportBriefSchema,
  reportOutlineSchema,
  slideSpecSchema,
  sourceAssetKindSchema,
  storySpecSchema,
  validationReportSchema,
} from "../../../code/contracts";

export * from "../../../code/contracts";

export const normalizedRowSchema = z.record(z.string(), z.unknown());

export const normalizedSheetSchema = z.object({
  name: z.string(),
  rowCount: z.number().int().nonnegative(),
  sourceFileId: z.string().default(""),
  sourceFileName: z.string().default(""),
  sourceRole: datasetFileRoleSchema.default("unknown-support"),
  columns: z.array(
    z.object({
      name: z.string(),
      inferredType: z.enum(["string", "number", "date", "boolean", "unknown"]),
      role: z.enum(["dimension", "measure", "time", "segment", "identifier", "unknown"]),
      nullable: z.boolean().default(true),
    }),
  ),
  rows: z.array(normalizedRowSchema),
});

export const normalizedEvidenceFileSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  mediaType: z.string().default("application/octet-stream"),
  kind: sourceAssetKindSchema.default("unknown"),
  role: datasetFileRoleSchema.default("unknown-support"),
  sheets: z.array(normalizedSheetSchema).default([]),
  textContent: z.string().optional(),
  warnings: z.array(z.string()).default([]),
});

export const normalizedWorkbookSchema = z.object({
  datasetId: z.string(),
  sourceFileName: z.string(),
  files: z.array(normalizedEvidenceFileSchema).min(1),
  sheets: z.array(normalizedSheetSchema).min(1),
});

export const deterministicMetricSummarySchema = z.object({
  sourceFileId: z.string().default(""),
  fileName: z.string().default(""),
  fileRole: datasetFileRoleSchema.default("unknown-support"),
  sheet: z.string(),
  column: z.string(),
  rowCount: z.number().int().nonnegative(),
  numericCount: z.number().int().nonnegative(),
  distinctCount: z.number().int().nonnegative(),
  sum: z.number().nullable().default(null),
  average: z.number().nullable().default(null),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
});

export const deterministicAnalysisSchema = z.object({
  datasetId: z.string(),
  metricSummaries: z.array(deterministicMetricSummarySchema),
  highlights: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export const uploadedSourceFileSchema = z.object({
  id: z.string().optional(),
  fileName: z.string(),
  mediaType: z.string().default("application/octet-stream"),
  base64: z.string().min(1),
  kind: sourceAssetKindSchema.optional(),
});

export const generationRequestSchema = z.object({
  jobId: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  sourceFiles: z.array(uploadedSourceFileSchema).default([]),
  styleFile: uploadedSourceFileSchema.optional(),
  brief: reportBriefSchema.default({}),
  sourceFileName: z.string().optional(),
  workbookBase64: z.string().optional(),
  templateFileName: z.string().optional(),
  businessContext: z.string().default(""),
  client: z.string().default(""),
  audience: z.string().default("Executive stakeholder"),
  objective: z.string().default("Explain the business performance signal"),
  thesis: z.string().default(""),
  stakes: z.string().default(""),
});

export const sourceFileSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  externalId: z.string().optional(),
  fileName: z.string(),
  mediaType: z.string().default("application/octet-stream"),
  kind: sourceAssetKindSchema,
  storageBucket: z.string().default("source-files"),
  storagePath: z.string(),
  fileBytes: z.number().int().nonnegative().default(0),
});

export const datasetRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  externalId: z.string().optional(),
  sourceFileId: z.string().optional(),
  profileVersion: z.number().int().positive().default(1),
  manifest: z.record(z.string(), z.unknown()).optional(),
});

export const generationJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "needs_input",
]);

export const generationJobStepSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  stage: z.string(),
  status: generationJobStatusSchema,
  detail: z.string().default(""),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const slidePlanBundleSchema = z.object({
  slides: z.array(slideSpecSchema),
  charts: z.array(chartSpecSchema).default([]),
});

export const generationJobResultSchema = z.object({
  datasetId: z.string(),
  storyTitle: z.string(),
  artifacts: z.array(artifactRecordSchema),
});

export const generationRunSummarySchema = z.object({
  jobId: z.string(),
  createdAt: z.string(),
  status: generationJobStatusSchema.default("completed"),
  failureMessage: z.string().default(""),
  sourceFileName: z.string(),
  brief: reportBriefSchema.default({}),
  businessContext: z.string(),
  client: z.string().default(""),
  audience: z.string(),
  objective: z.string(),
  thesis: z.string().default(""),
  stakes: z.string().default(""),
  datasetProfile: datasetProfileSchema,
  deterministicAnalysis: deterministicAnalysisSchema,
  insights: z.array(insightSpecSchema),
  story: storySpecSchema,
  reportOutline: reportOutlineSchema.optional(),
  slidePlan: z.object({
    slides: z.array(slideSpecSchema),
    charts: z.array(chartSpecSchema),
  }),
  validationReport: validationReportSchema.optional(),
  artifactManifest: artifactManifestSchema.optional(),
  qualityReport: qualityReportSchema.optional(),
  artifacts: z.array(artifactRecordSchema),
});

export type NormalizedWorkbook = z.infer<typeof normalizedWorkbookSchema>;
export type NormalizedSheet = z.infer<typeof normalizedSheetSchema>;
export type NormalizedEvidenceFile = z.infer<typeof normalizedEvidenceFileSchema>;
export type DeterministicMetricSummary = z.infer<typeof deterministicMetricSummarySchema>;
export type DeterministicAnalysis = z.infer<typeof deterministicAnalysisSchema>;
export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type SourceFileRecord = z.infer<typeof sourceFileSchema>;
export type DatasetRecord = z.infer<typeof datasetRecordSchema>;
export type GenerationJobStatus = z.infer<typeof generationJobStatusSchema>;
export type GenerationJobStep = z.infer<typeof generationJobStepSchema>;
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;
export type GenerationJobResult = z.infer<typeof generationJobResultSchema>;
export type GenerationRunSummary = z.infer<typeof generationRunSummarySchema>;

export interface BinaryArtifact {
  fileName: string;
  mimeType: string;
  buffer: Buffer | { type: "Buffer"; data: number[] };
}
