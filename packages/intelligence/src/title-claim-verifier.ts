import {
  buildComparableWorkbookValues,
  buildDerivedComparableValues,
  extractTitleNumberTokens,
  findClosestComparableValue,
  formatComparableValue,
  matchesComparableValue,
  parseLocaleNumber,
  roundComparable,
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

  const workbookValues = [
    ...buildComparableWorkbookValues(sheet),
    ...buildComparableSlideMetricValues(slide),
  ];
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

function buildComparableSlideMetricValues(slide: FidelitySlideInput) {
  const values = new Set<number>();
  for (const metric of slide.metrics ?? []) {
    for (const value of extractMetricNumbers(`${metric.value ?? ""} ${metric.delta ?? ""}`)) {
      values.add(roundComparable(value));
      if (Math.abs(value) > 0 && Math.abs(value) <= 1) {
        values.add(roundComparable(value * 100));
      }
    }
  }
  return [...values];
}

function extractMetricNumbers(text: string) {
  const values: number[] = [];
  for (const match of text.matchAll(/[-+−–]?\s*\d+(?:[.,]\d+)?/g)) {
    const normalized = (match[0] ?? "").replace(/[−–]/g, "-").replace(/\s+/g, "");
    const parsed = parseLocaleNumber(normalized);
    if (parsed !== null) {
      values.push(parsed);
    }
  }
  return values;
}
