export const BASQUIO_REPOSITORY = "marco-dicesare-dev/Basquio";

export const BASQUIO_SUPABASE = {
  projectId: "fxvbvkpzzvrkwvqmecmi",
  url: "https://fxvbvkpzzvrkwvqmecmi.supabase.co",
} as const;

export const BASQUIO_PIPELINE_STAGES = [
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
] as const;

export const BASQUIO_PIPELINE_STAGE_WEIGHTS: Record<(typeof BASQUIO_PIPELINE_STAGES)[number], number> = {
  "intake and profiling": 1.3,
  "package semantics inference": 1.6,
  "metric planning": 1.3,
  "deterministic analytics execution": 1.4,
  "insight ranking": 1.2,
  "story architecture": 1.1,
  "outline architecture": 0.8,
  "design translation": 0.9,
  "slide architecture": 1.7,
  "deterministic validation": 1.0,
  "semantic critique": 1.1,
  "targeted revision loop": 0.8,
  "render pptx": 0.9,
  "render pdf": 0.9,
  "artifact qa and delivery": 1.0,
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
