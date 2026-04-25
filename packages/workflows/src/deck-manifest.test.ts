import { describe, expect, it } from "vitest";

import { parseDeckManifest } from "./deck-manifest";

describe("parseDeckManifest", () => {
  it("repairs chart ids when slides reference semantic ids but charts fall back to generic ids", () => {
    const manifest = parseDeckManifest({
      slideCount: 3,
      slides: [
        { position: 1, title: "Cover" },
        { position: 2, title: "Growth", chartId: "chart_s2_global" },
        { position: 3, title: "Category", chartId: "chart_s3_category" },
      ],
      charts: [
        { id: "chart-1", chartType: "grouped_bar_plus_line", title: "Chart 1" },
        { id: "chart-2", chartType: "grouped_bar_plus_line", title: "Chart 2" },
      ],
    });

    expect(manifest.charts.map((chart) => chart.id)).toEqual([
      "chart_s2_global",
      "chart_s3_category",
    ]);
  });

  it("preserves already-matched chart ids", () => {
    const manifest = parseDeckManifest({
      slideCount: 2,
      slides: [
        { position: 1, title: "Cover" },
        { position: 2, title: "Growth", chartId: "chart_s2_global" },
      ],
      charts: [
        { id: "chart_s2_global", chartType: "grouped_bar_plus_line", title: "Chart 1" },
      ],
    });

    expect(manifest.charts.map((chart) => chart.id)).toEqual(["chart_s2_global"]);
  });
});
