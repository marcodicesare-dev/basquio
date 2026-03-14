import { templateProfileSchema, type TemplateProfile } from "@basquio/types";

type TemplateInput = {
  id: string;
  fileName?: string;
};

export function createSystemTemplateProfile(): TemplateProfile {
  return templateProfileSchema.parse({
    id: "system-default",
    sourceType: "system",
    slideSize: "LAYOUT_WIDE",
    fonts: ["Aptos", "Inter"],
    colors: ["#0F172A", "#2563EB", "#E2E8F0", "#F8FAFC"],
    layouts: [
      {
        id: "summary",
        name: "Summary",
        placeholders: ["title", "subtitle", "body"],
      },
      {
        id: "two-column",
        name: "Two column",
        placeholders: ["title", "body-left", "body-right", "chart"],
      },
    ],
  });
}

export function interpretTemplateSource(input: TemplateInput): TemplateProfile {
  if (!input.fileName) {
    return createSystemTemplateProfile();
  }

  const normalized = input.fileName.toLowerCase();

  if (normalized.endsWith(".pptx")) {
    return templateProfileSchema.parse({
      ...createSystemTemplateProfile(),
      id: input.id,
      sourceType: "pptx",
    });
  }

  if (normalized.endsWith(".pdf")) {
    return templateProfileSchema.parse({
      ...createSystemTemplateProfile(),
      id: input.id,
      sourceType: "pdf-style-reference",
    });
  }

  return createSystemTemplateProfile();
}
