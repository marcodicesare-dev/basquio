export const BASQUIO_REPOSITORY = "marco-dicesare-dev/Basquio";

export const BASQUIO_SUPABASE = {
  projectId: "fxvbvkpzzvrkwvqmecmi",
  url: "https://fxvbvkpzzvrkwvqmecmi.supabase.co",
} as const;

export const BASQUIO_PHASES = [
  "normalize",
  "understand",
  "author",
  "polish",
  "critique",
  "revise",
  "export",
] as const;

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

  if (
    normalized.endsWith(".png") ||
    normalized.endsWith(".jpg") ||
    normalized.endsWith(".jpeg") ||
    normalized.endsWith(".gif") ||
    normalized.endsWith(".svg") ||
    normalized.endsWith(".webp")
  ) {
    return "image" as const;
  }

  return "unknown" as const;
}

export function createJobStepId(jobId: string, stage: string) {
  return `${jobId}:${stage.replaceAll(" ", "-")}`;
}
