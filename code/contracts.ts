import { z } from "zod";

export const sourceAssetKindSchema = z.enum([
  "workbook",
  "document",
  "pptx",
  "pdf",
  "brand-tokens",
  "unknown",
]);

export const datasetFileRoleSchema = z.enum([
  "main-fact-table",
  "supporting-fact-table",
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

export const datasetColumnSchema = z.object({
  name: z.string(),
  inferredType: z.enum(["string", "number", "date", "boolean", "unknown"]),
  role: columnRoleSchema,
  nullable: z.boolean().default(true),
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
    }),
  ),
  warnings: z.array(z.string()).default([]),
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
  kind: z.enum(["framing", "methodology", "findings", "implications", "recommendations"]),
  title: z.string(),
  summary: z.string(),
  objective: z.string(),
  supportingInsightIds: z.array(z.string()).default([]),
});

export const reportOutlineSchema = z.object({
  title: z.string().default("Basquio report"),
  sections: z.array(reportSectionSchema).min(1),
});

export const insightSpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  claim: z.string(),
  businessMeaning: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceRefSchema).min(1),
  claims: z.array(claimSpecSchema).min(1),
});

export const storySpecSchema = z.object({
  client: z.string().default(""),
  audience: z.string(),
  objective: z.string(),
  thesis: z.string().default(""),
  stakes: z.string().default(""),
  title: z.string().default(""),
  narrativeArc: z.array(z.string()).min(1),
  keyMessages: z.array(z.string()).min(1),
  recommendedActions: z.array(z.string()).default([]),
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
  ]),
  editableInPptx: z.boolean().default(false),
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
  evidenceIds: z.array(z.string()).default([]),
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
});

export const slideSpecSchema = z.object({
  id: z.string(),
  purpose: z.string(),
  section: z.string().default(""),
  eyebrow: z.string().optional(),
  emphasis: z.enum(["cover", "section", "content"]).default("content"),
  layoutId: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  blocks: z.array(slideBlockSchema).min(1),
  claimIds: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  speakerNotes: z.string().default(""),
});

export const validationIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning"]).default("error"),
  message: z.string(),
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
  issues: z.array(validationIssueSchema).default([]),
});

export const templateBrandTokensSchema = z.object({
  palette: z
    .object({
      text: z.string().default("#0F172A"),
      background: z.string().default("#F8FAFC"),
      surface: z.string().default("#FFFFFF"),
      accent: z.string().default("#2563EB"),
      accentMuted: z.string().default("#DBEAFE"),
      highlight: z.string().default("#F0CC27"),
      border: z.string().default("#CBD5E1"),
    })
    .default({}),
  typography: z
    .object({
      headingFont: z.string().default("Aptos"),
      bodyFont: z.string().default("Aptos"),
      monoFont: z.string().default("Aptos"),
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
  logo: z
    .object({
      wordmarkPath: z.string().optional(),
      iconPath: z.string().optional(),
      treatment: z.string().default("default"),
    })
    .default({}),
});

export const templateProfileSchema = z.object({
  id: z.string(),
  sourceType: z.enum(["system", "pptx", "brand-tokens", "pdf-style-reference"]),
  slideSize: z.string(),
  fonts: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  spacingTokens: z.array(z.string()).default([]),
  logoAssetHints: z.array(z.string()).default([]),
  brandTokens: templateBrandTokensSchema.optional(),
  warnings: z.array(z.string()).default([]),
  layouts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      placeholders: z.array(z.string()).default([]),
    }),
  ),
});

export const artifactProviderSchema = z.enum(["supabase", "database", "local"]);

export const artifactKindSchema = z.enum(["pptx", "pdf"]);

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
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type NumericAssertion = z.infer<typeof numericAssertionSchema>;
export type ClaimSpec = z.infer<typeof claimSpecSchema>;
export type ReportBrief = z.infer<typeof reportBriefSchema>;
export type ReportOutline = z.infer<typeof reportOutlineSchema>;
export type InsightSpec = z.infer<typeof insightSpecSchema>;
export type StorySpec = z.infer<typeof storySpecSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type SlideSpec = z.infer<typeof slideSpecSchema>;
export type TemplateProfile = z.infer<typeof templateProfileSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;
export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
export type QualityCheck = z.infer<typeof qualityCheckSchema>;
export type QualityReport = z.infer<typeof qualityReportSchema>;
