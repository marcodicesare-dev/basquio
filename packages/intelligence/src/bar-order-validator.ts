import {
  extractPrimaryNumericSeries,
  isMonotonic,
  looksTemporalHeader,
} from "./fidelity/helpers";
import type {
  FidelitySheetInput,
  FidelitySlideInput,
  FidelityViolation,
} from "./fidelity/types";

export function validateBarOrdering(
  slide: FidelitySlideInput,
  sheet?: FidelitySheetInput,
): FidelityViolation[] {
  const chartType = (slide.chart?.chartType ?? "").toLowerCase();
  if (!sheet || !["bar", "horizontal_bar", "grouped_bar"].includes(chartType)) {
    return [];
  }

  if (sheet.headers.length < 2 || looksTemporalHeader(sheet.headers[0] ?? "")) {
    return [];
  }

  const mainSeries = extractPrimaryNumericSeries(sheet);
  if (mainSeries.length < 3) {
    return [];
  }

  if (isMonotonic(mainSeries, "asc") || isMonotonic(mainSeries, "desc")) {
    return [];
  }

  return [{
    rule: "bar_order_unsorted",
    severity: "minor",
    position: slide.position,
    message: `Sheet ${sheet.name} does not appear sorted by value, delta, or chronology for a ranked bar chart.`,
  }];
}
