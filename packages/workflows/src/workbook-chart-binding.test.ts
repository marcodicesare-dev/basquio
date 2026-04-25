import { describe, expect, it } from "vitest";

import { __test__ } from "./generate-deck";

const templateProfile = {
  id: "template-profile",
  sourceType: "pptx",
  brandTokens: {
    chartPalette: ["#2C6DF6"],
    palette: {
      text: "#060A45",
      muted: "#4B5563",
      surface: "#FFFFFF",
      background: "#FFFFFF",
      border: "#D1D5DB",
    },
  },
} as const;

describe("workbook chart binding", () => {
  it("uses slide semantics when the chart title is only a placeholder", () => {
    const manifest = {
      charts: [
        {
          id: "chart-1",
          title: "Chart 1",
          chartType: "horizontal_bar",
        },
      ],
      slides: [
        {
          position: 6,
          title: "MZ concentra l'83% in Multi Serve vs 47% del mercato",
          pageIntent: "Portfolio mismatch: MZ mix vs category mix",
          chartId: "chart-1",
        },
      ],
    } as any;
    const analysis = {
      slidePlan: [
        {
          position: 6,
          chart: {
            id: "chart-1",
            chartType: "horizontal_bar",
            categories: ["USA", "Germany", "France"],
          },
        },
      ],
    } as any;

    const [request] = __test__.buildWorkbookChartBindingRequests(manifest, analysis);

    expect(request?.title).toBe("MZ concentra l'83% in Multi Serve vs 47% del mercato");
    expect(request?.categories).toEqual([]);
    expect(request?.preferSemanticSlideBinding).toBe(true);
  });

  it("does not trust an existing sheet name when the chart title is a placeholder", () => {
    const request = {
      position: 6,
      chartId: "chart-1",
      chartType: "horizontal_bar",
      title: "MZ concentra l'83% in Multi Serve vs 47% del mercato",
      categories: [],
      existingSheetName: "S05_TopCountries",
      preferSemanticSlideBinding: true,
    };
    const workbookSheets = [
      {
        name: "S05_TopCountries",
        headers: ["Country", "Valore_2025_EUR_Mld"],
        rows: [{ Country: "USA", Valore_2025_EUR_Mld: 8.1 }],
        numericValues: [8.1],
        dataSignature: "top-countries",
      },
      {
        name: "S06_SegmentMix",
        headers: ["Segment", "Mix_Mercato_pct", "Mix_MZ_pct"],
        rows: [{ Segment: "Multi Serve", Mix_Mercato_pct: 47, Mix_MZ_pct: 83 }],
        numericValues: [47, 83],
        dataSignature: "segment-mix",
      },
    ] as any;

    const binding = __test__.bindWorkbookSheetToChart(
      request as any,
      workbookSheets,
      templateProfile as any,
      new Map(),
    );

    expect(binding?.sheet.name).toBe("S06_SegmentMix");
  });

  it("ignores orphan manifest charts that are not linked to any slide", () => {
    const manifest = {
      charts: [
        {
          id: "chart-linked",
          title: "Chart 1",
          chartType: "horizontal_bar",
        },
        {
          id: "chart-orphan",
          title: "Chart 2",
          chartType: "grouped_bar",
          excelSheetName: "README",
        },
      ],
      slides: [
        {
          position: 6,
          title: "Portfolio mismatch: MZ mix vs category mix",
          pageIntent: "Portfolio mismatch: MZ mix vs category mix",
          chartId: "chart-linked",
        },
      ],
    } as any;

    const requests = __test__.buildWorkbookChartBindingRequests(manifest, null);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.chartId).toBe("chart-linked");
  });
});
