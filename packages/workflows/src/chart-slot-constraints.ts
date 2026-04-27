const MATRIX_STYLE_CHART_TYPES = new Set(["heatmap", "matrix"]);
const BAR_STYLE_CHART_TYPES = new Set(["bar", "grouped_bar", "stacked_bar", "stacked_bar_100"]);

export function shouldApplyChartCategorySlotCap(chartType: string | null | undefined) {
  return !MATRIX_STYLE_CHART_TYPES.has(normalizeChartType(chartType));
}

export function shouldWarnBarChartCategoryDensity(chartType: string | null | undefined) {
  return BAR_STYLE_CHART_TYPES.has(normalizeChartType(chartType));
}

function normalizeChartType(chartType: string | null | undefined) {
  return (chartType ?? "").trim().toLowerCase();
}
