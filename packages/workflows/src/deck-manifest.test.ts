import { describe, expect, it } from "vitest";

import { parseDeckManifest } from "./deck-manifest";

describe("deck manifest normalization", () => {
  it("preserves slide chart bindings when chart ids drift by order", () => {
    const manifest = parseDeckManifest({
      slideCount: 3,
      slides: [
        { position: 1, title: "Cover" },
        { position: 2, title: "Category growth", chartId: "chart_s02" },
        { position: 3, title: "Competitor growth", chartId: "chart_s03" },
      ],
      charts: [
        { id: "chart-1", chartType: "bar", title: "Category chart", excelSheetName: "S02" },
        { id: "chart-2", chartType: "bar", title: "Competitor chart", excelSheetName: "S03" },
      ],
    });

    expect(manifest.charts.map((chart) => chart.id)).toEqual(["chart_s02", "chart_s03"]);
    expect(manifest.slides[1]?.chartId).toBe("chart_s02");
    expect(manifest.slides[2]?.chartId).toBe("chart_s03");
  });

  it("does not rewrite chart ids when slide bindings already resolve", () => {
    const manifest = parseDeckManifest({
      slideCount: 2,
      slides: [
        { position: 1, title: "Cover" },
        { position: 2, title: "Category growth", chartId: "chart-1" },
      ],
      charts: [
        { id: "chart-1", chartType: "bar", title: "Category chart", excelSheetName: "S02" },
      ],
    });

    expect(manifest.charts[0]?.id).toBe("chart-1");
  });

  it("normalizes common author chart type aliases to supported contract names", () => {
    const manifest = parseDeckManifest({
      slideCount: 3,
      slides: [
        { position: 1, title: "Cover" },
        { position: 2, title: "Combo", chartId: "c1" },
        { position: 3, title: "Horizontal", chartId: "c2" },
      ],
      charts: [
        { id: "c1", chartType: "grouped_bar_with_line", title: "Combo" },
        { id: "c2", chartType: "horizontal_grouped_bar", title: "Ranking" },
      ],
    });

    expect(manifest.charts.map((chart) => chart.chartType)).toEqual(["grouped_bar", "horizontal_bar"]);
  });
});
