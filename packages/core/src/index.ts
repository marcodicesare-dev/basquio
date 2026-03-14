export const BASQUIO_REPOSITORY = "marco-dicesare-dev/Basquio";

export const BASQUIO_SUPABASE = {
  projectId: "fxvbvkpzzvrkwvqmecmi",
  url: "https://fxvbvkpzzvrkwvqmecmi.supabase.co",
} as const;

export const BASQUIO_PIPELINE_STAGES = [
  "parse input",
  "analyze",
  "generate insights",
  "plan story",
  "plan slides",
  "render pptx",
  "render pdf",
  "store artifacts",
] as const;

export const BASQUIO_RENDER_POLICY = {
  pdf: "Browserless primary, pdf-lib fallback placeholder",
  pptx: "PptxGenJS primary, pptx-automizer template-preserving support",
  charts: "Editable PPT charts where possible, ECharts SVG SSR for advanced visuals",
  workflow: "Inngest default with QStash checkpoint-resume inheritance",
} as const;

export function inferSourceFileKind(fileName: string) {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".xlsx") || normalized.endsWith(".xls")) {
    return "workbook" as const;
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
