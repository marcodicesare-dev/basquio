import type {
  FidelitySlideInput,
  FidelityViolation,
} from "./fidelity/types";

export function validateChartRepetition(slides: FidelitySlideInput[]): FidelityViolation[] {
  const priorSignatures = new Map<string, { position: number; chartType: string }>();
  const violations: FidelityViolation[] = [];

  for (const slide of slides) {
    const signature = slide.chart?.dataSignature;
    const chartType = slide.chart?.chartType;
    if (!signature || !chartType) {
      continue;
    }

    const existing = priorSignatures.get(signature);
    if (existing) {
      violations.push({
        rule: "chart_repetition",
        severity: existing.chartType === chartType ? "major" : "minor",
        position: slide.position,
        message:
          `Chart repeats slide ${existing.position} with the same underlying data signature` +
          `${existing.chartType === chartType ? " and chart type." : "."}`,
      });
      continue;
    }

    priorSignatures.set(signature, { position: slide.position, chartType });
  }

  return violations;
}
