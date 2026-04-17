import type { FidelitySlideInput, FidelityViolation } from "./fidelity/types";

export function validateBubbleLegend(slide: FidelitySlideInput): FidelityViolation[] {
  const chartType = (slide.chart?.chartType ?? "").toLowerCase();
  if (!["bubble", "scatter"].includes(chartType)) {
    return [];
  }

  const title = `${slide.chart?.title ?? ""} ${slide.title}`.toLowerCase();
  const sizeLabel = (slide.chart?.bubbleSizeLabel ?? "").trim();
  if ((title.includes("bubble =") || title.includes("bolla =")) && sizeLabel.length > 0) {
    return [];
  }

  return [{
    rule: "bubble_size_legend_missing",
    severity: "major",
    position: slide.position,
    message: "Bubble chart is missing an explicit bubble-size legend in the title or metadata.",
  }];
}
