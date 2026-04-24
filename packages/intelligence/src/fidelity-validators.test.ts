import { describe, expect, it } from "vitest";

import { lintDeckFidelity } from "./fidelity-validators";

describe("lintDeckFidelity", () => {
  it("flags promo-mechanics exhibits that omit Communication In Store from the source workbook", () => {
    const report = lintDeckFidelity({
      slides: [
        {
          position: 14,
          title: "Retail promo mechanics over-index on WD Promo and price cuts",
          body: "Discount tiers and WD Promo explain the retailer spike.",
          chart: {
            chartType: "grouped_bar",
            title: "Promo mechanics by retailer",
            xAxisLabel: "Importance of Sales",
            yAxisLabel: "Retailer",
            excelSheetName: "S14_PromoMechanics",
          },
        },
      ],
      sheets: [
        {
          name: "S14_PromoMechanics",
          headers: ["Retailer", "WD Promo", "10<20", "20<30", "Display Only"],
          rows: [{ Retailer: "Hyper", "WD Promo": 48, "10<20": 12, "20<30": 21, "Display Only": 7 }],
          numericValues: [48, 12, 21, 7],
          dataSignature: "promo-mechanics",
        },
      ],
      sourceHeaders: [
        "Importance of Sales (ALL) Display Only",
        "Importance of Sales (ALL) Comm. In Store Only",
      ],
    });

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "promo_mechanic_coverage_gap",
      severity: "major",
      position: 14,
    }));
  });

  it("flags DP promo commentary when the linked chart omits the promo distribution metric", () => {
    const report = lintDeckFidelity({
      slides: [
        {
          position: 9,
          title: "Segafredo under-indexes on DP promo",
          body: "La DP promo resta sotto i competitor nonostante la pressione promozionale.",
          chart: {
            chartType: "horizontal_bar",
            title: "Promo pressure by brand",
            xAxisLabel: "Promo Intensity",
            yAxisLabel: "Brand",
            excelSheetName: "S09_PromoPressure",
          },
        },
      ],
      sheets: [
        {
          name: "S09_PromoPressure",
          headers: ["Brand", "Promo Intensity", "Sales Value"],
          rows: [{ Brand: "Segafredo", "Promo Intensity": 54, "Sales Value": 980 }],
          numericValues: [54, 980],
          dataSignature: "promo-pressure",
        },
      ],
    });

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "claim_chart_metric_mismatch",
      severity: "major",
      position: 9,
    }));
  });

  it("requires table archetype slides to declare hasDataTable", () => {
    const report = lintDeckFidelity({
      slides: [
        {
          position: 6,
          title: "Channel scorecard",
          slideArchetype: "table",
        },
      ],
      sheets: [],
    });

    expect(report.violations).toContainEqual(expect.objectContaining({
      rule: "table_manifest_missing_hasDataTable",
      severity: "major",
      position: 6,
    }));
  });
});
