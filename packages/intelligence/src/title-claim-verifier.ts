import {
  buildComparableWorkbookValues,
  buildDerivedComparableValues,
  extractTitleNumberTokens,
  findClosestComparableValue,
  formatComparableValue,
  matchesComparableValue,
} from "./fidelity/helpers";
import type {
  FidelitySheetInput,
  FidelitySlideInput,
  FidelityViolation,
} from "./fidelity/types";

export function validateTitleClaims(
  slide: FidelitySlideInput,
  sheet?: FidelitySheetInput,
): FidelityViolation[] {
  const tokens = extractTitleNumberTokens(slide.title);
  if (tokens.length === 0) {
    return [];
  }

  const workbookValues = buildComparableWorkbookValues(sheet);
  const violations: FidelityViolation[] = [];

  for (const token of tokens) {
    if (matchesComparableValue(token, workbookValues)) {
      continue;
    }

    const derivable = buildDerivedComparableValues(sheet);
    if (matchesComparableValue(token, derivable)) {
      continue;
    }

    const closest = findClosestComparableValue(token, workbookValues);
    const gapRatio = closest === null || token.value === 0 ? 1 : Math.abs(closest - token.value) / Math.max(1, Math.abs(token.value));
    violations.push({
      rule: "title_claim_unverified",
      severity: gapRatio > 0.5 ? "critical" : "major",
      position: slide.position,
      message:
        `Title number "${token.raw}" is not verifiable from the linked slide data` +
        `${closest === null ? "." : ` (closest observable value: ${formatComparableValue(closest, token.unit)}).`}`,
    });
  }

  return violations;
}
