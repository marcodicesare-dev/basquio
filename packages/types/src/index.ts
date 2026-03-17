import { z } from "zod";

import {
  analyticsResultSchema,
  artifactManifestSchema,
  artifactRecordSchema,
  chartSpecSchema,
  datasetProfileSchema,
  datasetFileRoleSchema,
  executableMetricSpecSchema,
  insightSpecSchema,
  packageSemanticsSchema,
  revisionDecisionSchema,
  qualityReportSchema,
  reportBriefSchema,
  reportOutlineSchema,
  slideSpecSchema,
  sourceAssetKindSchema,
  stageTraceSchema,
  storySpecSchema,
  templateProfileSchema,
  validationReportSchema,
} from "../../../code/contracts";

export * from "../../../code/contracts";
export * from "../../../code/v2-contracts";

export const normalizedRowSchema = z.record(z.string(), z.unknown());
export const normalizedRowsCollectionSchema = z.custom<Array<Record<string, unknown>>>(
  (value) => Array.isArray(value),
  "Expected sheet rows to be an array of row objects",
);

export const normalizedSheetPreviewSchema = z.object({
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
      sampleValues: z.array(z.string()).default([]),
      uniqueCount: z.number().int().nonnegative().default(0),
      uniqueCountApproximate: z.boolean().optional(),
      nullRate: z.number().min(0).max(1).default(0),
    }),
  ),
  sampleRows: z.array(normalizedRowSchema).default([]),
});

export const normalizedSheetSchema = normalizedSheetPreviewSchema.extend({
  rows: normalizedRowsCollectionSchema,
});

export const normalizedEvidenceFileSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  mediaType: z.string().default("application/octet-stream"),
  kind: sourceAssetKindSchema.default("unknown"),
  role: datasetFileRoleSchema.default("unknown-support"),
  sheets: z.array(normalizedSheetPreviewSchema).default([]),
  textContent: z.string().optional(),
  pages: z.array(z.object({ num: z.number(), text: z.string() })).optional(),
  pageCount: z.number().int().nonnegative().optional(),
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

export const deterministicAnalysisSchema = analyticsResultSchema;

export const uploadedSourceFileSchema = z
  .object({
    id: z.string().optional(),
    fileName: z.string(),
    mediaType: z.string().default("application/octet-stream"),
    base64: z.string().min(1).optional(),
    storageBucket: z.string().min(1).optional(),
    storagePath: z.string().min(1).optional(),
    fileBytes: z.number().int().nonnegative().optional(),
    kind: sourceAssetKindSchema.optional(),
  })
  .superRefine((value, context) => {
    const hasInlineBody = typeof value.base64 === "string" && value.base64.length > 0;
    const hasStorageRef =
      typeof value.storageBucket === "string" &&
      value.storageBucket.length > 0 &&
      typeof value.storagePath === "string" &&
      value.storagePath.length > 0;

    if (!hasInlineBody && !hasStorageRef) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Uploaded files must include either base64 content or a storage bucket/path reference.",
      });
    }
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
  packageSemantics: packageSemanticsSchema,
  metricPlan: z.array(executableMetricSpecSchema).default([]),
  analyticsResult: analyticsResultSchema,
  insights: z.array(insightSpecSchema),
  story: storySpecSchema,
  reportOutline: reportOutlineSchema.optional(),
  templateProfile: templateProfileSchema.optional(),
  slidePlan: z.object({
    slides: z.array(slideSpecSchema),
    charts: z.array(chartSpecSchema),
  }),
  validationReport: validationReportSchema.optional(),
  artifactManifest: artifactManifestSchema.optional(),
  qualityReport: qualityReportSchema.optional(),
  revisionHistory: z.array(revisionDecisionSchema).default([]),
  stageTraces: z.array(stageTraceSchema).default([]),
  artifacts: z.array(artifactRecordSchema),
});

export type NormalizedWorkbook = z.infer<typeof normalizedWorkbookSchema>;
export type NormalizedSheet = z.infer<typeof normalizedSheetSchema>;
export type NormalizedEvidenceFile = z.infer<typeof normalizedEvidenceFileSchema>;
export type DeterministicMetricSummary = z.infer<typeof deterministicMetricSummarySchema>;
export type ExecutableMetricSpec = z.infer<typeof executableMetricSpecSchema>;
export type StageTrace = z.infer<typeof stageTraceSchema>;
export type PackageSemantics = z.infer<typeof packageSemanticsSchema>;
export type AnalyticsResult = z.infer<typeof analyticsResultSchema>;
export type DeterministicAnalysis = AnalyticsResult;
export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type SourceFileRecord = z.infer<typeof sourceFileSchema>;
export type DatasetRecord = z.infer<typeof datasetRecordSchema>;
export type GenerationJobStatus = z.infer<typeof generationJobStatusSchema>;
export type GenerationJobStep = z.infer<typeof generationJobStepSchema>;
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;
export type GenerationJobResult = z.infer<typeof generationJobResultSchema>;
export type GenerationRunSummary = z.infer<typeof generationRunSummarySchema>;

export * from "./collaboration";

export interface BinaryArtifact {
  fileName: string;
  mimeType: string;
  buffer: Buffer | { type: "Buffer"; data: number[] };
}
