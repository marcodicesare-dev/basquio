import type { TemplateProfile } from "@basquio/types";

export type TemplateDiagnosticStatus =
  | "not_provided"
  | "parsed_successfully"
  | "partially_applied"
  | "fallback_default";

export type TemplateDiagnosticSource =
  | "system_default"
  | "saved_profile"
  | "uploaded_file";

export type TemplateDiagnosticEffect =
  | "layout_and_theme"
  | "theme_only"
  | "none";

export type TemplateDiagnostics = {
  status: TemplateDiagnosticStatus;
  source: TemplateDiagnosticSource;
  effect: TemplateDiagnosticEffect;
  reason: string;
  templateProfileId: string | null;
  templateName: string | null;
  sourceType: string | null;
  layoutCount: number;
  warningCount: number;
  warnings: string[];
  fontCount: number;
  colorCount: number;
  fallbackTo: "system_default" | null;
};

export function buildNoTemplateDiagnostics(): TemplateDiagnostics {
  return {
    status: "not_provided",
    source: "system_default",
    effect: "none",
    reason: "no_template_attached",
    templateProfileId: null,
    templateName: "Basquio House Style",
    sourceType: "system",
    layoutCount: 0,
    warningCount: 0,
    warnings: [],
    fontCount: 0,
    colorCount: 0,
    fallbackTo: "system_default",
  };
}

export function buildTemplateDiagnosticsFromProfile(input: {
  profile: TemplateProfile;
  source: Exclude<TemplateDiagnosticSource, "system_default">;
  templateProfileId?: string | null;
}): TemplateDiagnostics {
  const { profile } = input;
  const warnings = profile.warnings ?? [];
  const warningText = warnings.join(" ").toLowerCase();
  const layoutCount = profile.layouts.length;
  const fallbackDetected =
    warningText.includes("fell back to the system template") ||
    warningText.includes("reused system layout defaults") ||
    warningText.includes("reused system theme defaults");
  const themeOnly =
    profile.sourceType === "brand-tokens" ||
    profile.sourceType === "pdf-style-reference";
  const effect: TemplateDiagnosticEffect = fallbackDetected
    ? "none"
    : themeOnly
      ? "theme_only"
      : "layout_and_theme";
  const status: TemplateDiagnosticStatus = fallbackDetected
    ? "fallback_default"
    : warnings.length > 0 || themeOnly
      ? "partially_applied"
      : "parsed_successfully";

  return {
    status,
    source: input.source,
    effect,
    reason: fallbackDetected
      ? "parse_failed"
      : themeOnly
        ? "theme_only_template"
        : warnings.length > 0
          ? "template_with_warnings"
          : "template_parsed_cleanly",
    templateProfileId: input.templateProfileId ?? null,
    templateName: profile.templateName ?? null,
    sourceType: profile.sourceType ?? null,
    layoutCount,
    warningCount: warnings.length,
    warnings,
    fontCount: profile.fonts.length,
    colorCount: profile.colors.length,
    fallbackTo: fallbackDetected ? "system_default" : null,
  };
}

export function isTemplateDiagnostics(value: unknown): value is TemplateDiagnostics {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.status === "string" &&
    typeof record.source === "string" &&
    typeof record.effect === "string" &&
    typeof record.reason === "string"
  );
}
