import {
  findHeaderIndex,
  PERIOD_2YA_PATTERNS,
  PERIOD_CY_PATTERNS,
  PERIOD_PY_PATTERNS,
} from "./fidelity/helpers";
import type {
  FidelitySheetInput,
  FidelitySlideInput,
  FidelityViolation,
} from "./fidelity/types";

export function validatePeriodOrdering(
  slide: FidelitySlideInput,
  sheet?: FidelitySheetInput,
): FidelityViolation[] {
  if (!sheet || sheet.headers.length < 2) {
    return [];
  }

  const pyIndex = findHeaderIndex(sheet.headers, PERIOD_PY_PATTERNS);
  const cyIndex = findHeaderIndex(sheet.headers, PERIOD_CY_PATTERNS);
  if (pyIndex !== -1 && cyIndex !== -1 && pyIndex > cyIndex) {
    return [{
      rule: "period_order_incorrect",
      severity: "minor",
      position: slide.position,
      message: `Workbook columns place CY before PY in sheet ${sheet.name}. Reorder period columns chronologically.`,
    }];
  }

  const twoYaIndex = findHeaderIndex(sheet.headers, PERIOD_2YA_PATTERNS);
  if (twoYaIndex !== -1 && pyIndex !== -1 && cyIndex !== -1 && !(twoYaIndex < pyIndex && pyIndex < cyIndex)) {
    return [{
      rule: "period_order_incorrect",
      severity: "minor",
      position: slide.position,
      message: `Workbook columns in sheet ${sheet.name} are not ordered as 2YA -> PY -> CY.`,
    }];
  }

  return [];
}
