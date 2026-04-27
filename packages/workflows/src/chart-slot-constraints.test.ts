import { describe, expect, it } from "vitest";

import { shouldApplyChartCategorySlotCap, shouldWarnBarChartCategoryDensity } from "./chart-slot-constraints";

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
});
