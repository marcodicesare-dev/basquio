import { validateBarOrdering } from "./bar-order-validator";
import { validateBubbleLegend } from "./bubble-size-legend-validator";
import { validateChartRepetition } from "./chart-repetition-validator";
import { validateClaimChartAlignment } from "./claim-chart-alignment-validator";
import { validateEntityGrounding } from "./entity-grounding-validator";
import { validatePeriodOrdering } from "./period-order-validator";
import { validateRequiredDeltaColumns } from "./required-delta-validator";
import { validateSingleSourceLine } from "./source-line-validator";
import { validateSourceLabels } from "./source-label-validator";
import { validateTitleClaims } from "./title-claim-verifier";
import { normalizeEntity } from "./fidelity/helpers";
import type {
  FidelityLintResult,
  FidelitySheetInput,
  FidelitySlideInput,
  FidelityViolation,
} from "./fidelity/types";

export type {
  FidelityChartInput,
  FidelityLintResult,
  FidelityMetricsInput,
  FidelitySheetInput,
  FidelitySlideInput,
  FidelityViolation,
} from "./fidelity/types";

export function lintDeckFidelity(input: {
  slides: FidelitySlideInput[];
  sheets: FidelitySheetInput[];
  knownEntities?: string[];
  clientName?: string;
}): FidelityLintResult {
  const violations: FidelityViolation[] = [];
  const sheetByName = new Map(input.sheets.map((sheet) => [sheet.name, sheet]));
  const knownEntities = new Set(
    (input.knownEntities ?? [])
      .map(normalizeEntity)
      .filter(Boolean),
  );

  if (input.clientName) {
    knownEntities.add(normalizeEntity(input.clientName));
  }

  for (const slide of input.slides) {
    const sheet = slide.chart?.excelSheetName ? sheetByName.get(slide.chart.excelSheetName) : undefined;

    violations.push(...validateSourceLabels(slide, sheet));
    violations.push(...validatePeriodOrdering(slide, sheet));
    violations.push(...validateRequiredDeltaColumns(slide, sheet));
    violations.push(...validateBarOrdering(slide, sheet));
    violations.push(...validateBubbleLegend(slide));
    violations.push(...validateSingleSourceLine(slide));
    violations.push(...validateTitleClaims(slide, sheet));
    violations.push(...validateClaimChartAlignment(slide, sheet));
    violations.push(...validateEntityGrounding(slide, knownEntities));
  }

  violations.push(...validateChartRepetition(input.slides));

  return {
    passed: !violations.some((violation) => violation.severity === "critical" || violation.severity === "major"),
    violations,
  };
}
