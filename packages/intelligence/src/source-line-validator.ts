import { countSourceMentions } from "./fidelity/helpers";
import type { FidelitySlideInput, FidelityViolation } from "./fidelity/types";

export function validateSingleSourceLine(slide: FidelitySlideInput): FidelityViolation[] {
  const inlineSourceCount = countSourceMentions([
    slide.body,
    ...(slide.bullets ?? []),
    slide.callout?.text,
  ].filter((value): value is string => Boolean(value)));
  const footerSourceCount = slide.chart?.sourceNote ? 1 : 0;

  if (inlineSourceCount + footerSourceCount <= 1) {
    return [];
  }

  return [{
    rule: "duplicate_source_line",
    severity: "minor",
    position: slide.position,
    message: "Slide contains more than one source line. Keep a single canonical source in the footer band.",
  }];
}
