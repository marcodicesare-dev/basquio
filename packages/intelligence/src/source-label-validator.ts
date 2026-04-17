import {
  CANONICAL_METRIC_LABELS,
  FORBIDDEN_INVENTED_LABELS,
  normalizeLabel,
} from "./fidelity/helpers";
import type {
  FidelitySheetInput,
  FidelitySlideInput,
  FidelityViolation,
} from "./fidelity/types";

export function validateSourceLabels(
  slide: FidelitySlideInput,
  sheet?: FidelitySheetInput,
): FidelityViolation[] {
  const violations: FidelityViolation[] = [];
  const legalLabels = new Set([
    ...CANONICAL_METRIC_LABELS,
    ...(sheet?.headers ?? []).map(normalizeLabel),
  ]);
  const candidateLabels = [
    slide.chart?.xAxisLabel,
    slide.chart?.yAxisLabel,
    slide.chart?.bubbleSizeLabel,
    ...(slide.metrics ?? []).map((metric) => metric.label),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const label of candidateLabels) {
    const normalized = normalizeLabel(label);
    for (const forbidden of FORBIDDEN_INVENTED_LABELS) {
      if (normalized.includes(forbidden.label) && !legalLabels.has(normalized)) {
        violations.push({
          rule: "invented_label",
          severity: "major",
          position: slide.position,
          message: `${forbidden.message} Offending label: "${label}".`,
        });
        break;
      }
    }
  }

  return violations;
}
