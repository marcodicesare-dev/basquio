import { describe, expect, it } from "vitest";

import {
  POINT_LABEL_CATEGORY_LIMIT,
  shouldApplyChartCategorySlotCap,
  shouldWarnBarChartCategoryDensity,
  shouldWarnPointLabelDensity,
} from "./chart-slot-constraints";

describe("chart slot constraints", () => {
  it("does not apply one-dimensional category caps to heatmap cells", () => {
    expect(shouldApplyChartCategorySlotCap("heatmap")).toBe(false);
    expect(shouldApplyChartCategorySlotCap("matrix")).toBe(false);
  });

  it("keeps dense bar-chart warnings enabled", () => {
    expect(shouldApplyChartCategorySlotCap("bar")).toBe(true);
    expect(shouldWarnBarChartCategoryDensity("grouped_bar")).toBe(true);
    expect(shouldWarnBarChartCategoryDensity("heatmap")).toBe(false);
  });

  it("flags point-label chart families for stricter density handling", () => {
    expect(POINT_LABEL_CATEGORY_LIMIT).toBe(6);
    expect(shouldWarnPointLabelDensity("bubble")).toBe(true);
    expect(shouldWarnPointLabelDensity("scatter")).toBe(true);
    expect(shouldWarnPointLabelDensity("horizontal_bar")).toBe(false);
  });
});
