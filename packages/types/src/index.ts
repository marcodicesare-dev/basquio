import { z } from "zod";

export * from "../../../code/contracts";

export const normalizedRowSchema = z.record(z.string(), z.unknown());

export const normalizedSheetSchema = z.object({
  name: z.string(),
  rowCount: z.number().int().nonnegative(),
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

export const normalizedWorkbookSchema = z.object({
  datasetId: z.string(),
  sourceFileName: z.string(),
  sheets: z.array(normalizedSheetSchema).min(1),
});

export const deterministicMetricSummarySchema = z.object({
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

export const generationRequestSchema = z.object({
  jobId: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  sourceFileName: z.string(),
  workbookBase64: z.string().min(1),
  templateFileName: z.string().optional(),
  businessContext: z.string().default(""),
  audience: z.string().default("Executive stakeholder"),
  objective: z.string().default("Explain the business performance signal"),
});

export const sourceFileSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  fileName: z.string(),
  kind: z.enum(["workbook", "pptx", "pdf", "unknown"]),
  storagePath: z.string(),
});

export const datasetRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sourceFileId: z.string(),
  profileVersion: z.number().int().positive().default(1),
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
});

export const artifactKindSchema = z.enum(["pptx", "pdf"]);

export const artifactRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  kind: artifactKindSchema,
  fileName: z.string(),
  mimeType: z.string(),
  storagePath: z.string(),
  byteSize: z.number().int().nonnegative(),
  provider: z.enum(["supabase", "local"]).default("local"),
});

export const slidePlanBundleSchema = z.object({
  slides: z.array(z.any()),
  charts: z.array(z.any()).default([]),
});

export const generationJobResultSchema = z.object({
  datasetId: z.string(),
  storyTitle: z.string(),
  artifacts: z.array(artifactRecordSchema),
});

export type NormalizedWorkbook = z.infer<typeof normalizedWorkbookSchema>;
export type NormalizedSheet = z.infer<typeof normalizedSheetSchema>;
export type DeterministicMetricSummary = z.infer<typeof deterministicMetricSummarySchema>;
export type DeterministicAnalysis = z.infer<typeof deterministicAnalysisSchema>;
export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type SourceFileRecord = z.infer<typeof sourceFileSchema>;
export type DatasetRecord = z.infer<typeof datasetRecordSchema>;
export type GenerationJobStatus = z.infer<typeof generationJobStatusSchema>;
export type GenerationJobStep = z.infer<typeof generationJobStepSchema>;
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;
export type GenerationJobResult = z.infer<typeof generationJobResultSchema>;

export interface BinaryArtifact {
  fileName: string;
  mimeType: string;
  buffer: Buffer | { type: "Buffer"; data: number[] };
}
