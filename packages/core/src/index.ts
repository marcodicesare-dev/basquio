export const BASQUIO_REPOSITORY = "marco-dicesare-dev/Basquio";

export const BASQUIO_SUPABASE = {
  projectId: "fxvbvkpzzvrkwvqmecmi",
  url: "https://fxvbvkpzzvrkwvqmecmi.supabase.co",
} as const;

export const BASQUIO_PIPELINE_STAGES = [
  "parse input",
  "analyze",
  "interpret package",
  "plan metrics",
  "compute analytics",
  "generate insights",
  "plan story",
  "plan outline",
  "interpret template",
  "plan slides",
  "validate plan",
  "render pptx",
  "render pdf",
  "store artifacts",
  "post-render qa",
] as const;

export const BASQUIO_PIPELINE_STAGE_WEIGHTS: Record<(typeof BASQUIO_PIPELINE_STAGES)[number], number> = {
  "parse input": 0.8,
  analyze: 0.6,
  "interpret package": 1.6,
  "plan metrics": 1.3,
  "compute analytics": 1.4,
  "generate insights": 1.2,
  "plan story": 1.1,
  "plan outline": 0.8,
  "interpret template": 0.9,
  "plan slides": 1.7,
  "validate plan": 1.3,
  "render pptx": 0.9,
  "render pdf": 0.9,
  "store artifacts": 0.6,
  "post-render qa": 0.8,
};

export const BASQUIO_RENDER_POLICY = {
  pdf: "Browserless primary, pdf-lib fallback placeholder",
  pptx: "PptxGenJS primary, pptx-automizer template-preserving support",
  charts: "Editable PPT charts where possible, ECharts SVG SSR for advanced visuals",
  workflow: "Inngest default with QStash checkpoint-resume inheritance",
} as const;

export function inferSourceFileKind(fileName: string) {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".xlsx") || normalized.endsWith(".xls") || normalized.endsWith(".csv")) {
    return "workbook" as const;
  }

  if (normalized.endsWith(".json") || normalized.endsWith(".css")) {
    return "brand-tokens" as const;
  }

  if (
    normalized.endsWith(".docx") ||
    normalized.endsWith(".doc") ||
    normalized.endsWith(".txt") ||
    normalized.endsWith(".md")
  ) {
    return "document" as const;
  }

  if (normalized.endsWith(".pptx")) {
    return "pptx" as const;
  }

  if (normalized.endsWith(".pdf")) {
    return "pdf" as const;
  }

  return "unknown" as const;
}

export function createJobStepId(jobId: string, stage: string) {
  return `${jobId}:${stage.replaceAll(" ", "-")}`;
}
