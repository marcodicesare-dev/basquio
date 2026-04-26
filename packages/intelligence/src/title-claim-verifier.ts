import {
  buildComparableWorkbookValues,
  buildDerivedComparableValues,
  extractTitleNumberTokens,
  findClosestComparableValue,
  formatComparableValue,
  matchesComparableValue,
  mentionsDerivation,
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
  const textContext = `${slide.body ?? ""} ${(slide.bullets ?? []).join(" ")} ${slide.callout?.text ?? ""}`;
  const violations: FidelityViolation[] = [];

  for (const token of tokens) {
    if (isStructuralOrOrdinalToken(slide, token.raw)) {
      continue;
    }

    if (matchesComparableValue(token, workbookValues)) {
      continue;
    }

    const derivable = buildDerivedComparableValues(sheet);
    if ((mentionsDerivation(textContext) || derivable.length > 0) && matchesComparableValue(token, derivable)) {
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

function isStructuralOrOrdinalToken(slide: FidelitySlideInput, rawToken: string) {
  const title = slide.title.toLowerCase();
  const intent = (slide.pageIntent ?? "").toLowerCase();
  const token = rawToken.trim();

  if (slide.position === 1) {
    return true;
  }

  if (
    /\b(q[1-4]|roadmap|timeline|piano d'azione|sequenza|priorit|priority)\b/i.test(title) ||
    /\b(roadmap|timeline|action plan|piano d'azione|appendix|appendice)\b/i.test(intent)
  ) {
    if (/^(?:20\d{2}|[1-9])$/.test(token.replace(/[+-]/g, ""))) {
      return true;
    }
  }

  return false;
}
