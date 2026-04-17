import { normalizeEntity, RISKY_RETAILERS } from "./fidelity/helpers";
import type { FidelitySlideInput, FidelityViolation } from "./fidelity/types";

export function validateEntityGrounding(
  slide: FidelitySlideInput,
  knownEntities: Set<string>,
): FidelityViolation[] {
  if (knownEntities.size === 0) {
    return [];
  }

  const text = [slide.title, slide.body, ...(slide.bullets ?? []), slide.callout?.text]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ");
  const normalizedText = normalizeEntity(text);
  const violations: FidelityViolation[] = [];

  for (const retailer of RISKY_RETAILERS) {
    if (normalizedText.includes(retailer) && !knownEntities.has(retailer)) {
      violations.push({
        rule: "entity_not_in_input",
        severity: "major",
        position: slide.position,
        message: `Slide names entity "${retailer}" but it does not appear in the input evidence package.`,
      });
    }
  }

  return violations;
}
