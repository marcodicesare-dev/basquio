import { z } from "zod";

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
  sheets: z.array(
    z.object({
      name: z.string(),
      rowCount: z.number().int().nonnegative(),
      columns: z.array(datasetColumnSchema),
    }),
  ),
  warnings: z.array(z.string()).default([]),
});

export const evidenceSchema = z.object({
  sheet: z.string(),
  metric: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});

export const insightSpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  claim: z.string(),
  businessMeaning: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSchema).min(1),
});

export const storySpecSchema = z.object({
  audience: z.string(),
  objective: z.string(),
  narrativeArc: z.array(z.string()).min(1),
  keyMessages: z.array(z.string()).min(1),
  recommendedActions: z.array(z.string()).default([]),
});

export const chartSpecSchema = z.object({
  id: z.string(),
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
  series: z.array(
    z.object({
      name: z.string(),
      dataKey: z.string(),
    }),
  ),
  xKey: z.string().optional(),
  yKeys: z.array(z.string()).default([]),
});

export const slideBlockSchema = z.object({
  kind: z.enum(["title", "subtitle", "body", "chart", "table", "callout"]),
  content: z.string().optional(),
  chartId: z.string().optional(),
});

export const slideSpecSchema = z.object({
  id: z.string(),
  purpose: z.string(),
  layoutId: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  blocks: z.array(slideBlockSchema).min(1),
  evidenceIds: z.array(z.string()).default([]),
  speakerNotes: z.string().default(""),
});

export const templateProfileSchema = z.object({
  id: z.string(),
  sourceType: z.enum(["system", "pptx", "pdf-style-reference"]),
  slideSize: z.string(),
  fonts: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  layouts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      placeholders: z.array(z.string()).default([]),
    }),
  ),
});

export type DatasetProfile = z.infer<typeof datasetProfileSchema>;
export type InsightSpec = z.infer<typeof insightSpecSchema>;
export type StorySpec = z.infer<typeof storySpecSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type SlideSpec = z.infer<typeof slideSpecSchema>;
export type TemplateProfile = z.infer<typeof templateProfileSchema>;
