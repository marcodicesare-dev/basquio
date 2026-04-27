const MATRIX_STYLE_CHART_TYPES = new Set(["heatmap", "matrix"]);
const BAR_STYLE_CHART_TYPES = new Set(["bar", "grouped_bar", "stacked_bar", "stacked_bar_100"]);
const POINT_LABEL_DENSE_CHART_TYPES = new Set(["bubble", "scatter"]);

export const POINT_LABEL_CATEGORY_LIMIT = 6;

export function shouldApplyChartCategorySlotCap(chartType: string | null | undefined) {
  return !MATRIX_STYLE_CHART_TYPES.has(normalizeChartType(chartType));
}

export function shouldWarnBarChartCategoryDensity(chartType: string | null | undefined) {
  return BAR_STYLE_CHART_TYPES.has(normalizeChartType(chartType));
}

export function shouldWarnPointLabelDensity(chartType: string | null | undefined) {
  return POINT_LABEL_DENSE_CHART_TYPES.has(normalizeChartType(chartType));
}

function normalizeChartType(chartType: string | null | undefined) {
  return (chartType ?? "").trim().toLowerCase();
}
