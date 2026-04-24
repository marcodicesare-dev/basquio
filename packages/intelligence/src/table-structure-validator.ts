import { normalizeLabel } from "./fidelity/helpers";
import type { FidelitySlideInput, FidelityViolation } from "./fidelity/types";

export function validateNativeTableDeclaration(slide: FidelitySlideInput): FidelityViolation[] {
  const layoutTokens = normalizeLabel(`${slide.layoutId ?? ""} ${slide.slideArchetype ?? ""}`);
  const usesTableArchetype = /\btable\b/.test(layoutTokens);

  if (!usesTableArchetype || slide.hasDataTable === true) {
    return [];
  }

  return [{
    rule: "table_manifest_missing_hasDataTable",
    severity: "major",
    position: slide.position,
    message: "Table slides must set hasDataTable=true so the final QA gate can verify a native editable PowerPoint table.",
  }];
}
