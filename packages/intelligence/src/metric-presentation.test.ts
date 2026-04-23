import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { inferMetricPresentationSpec } from "../../workflows/src/metric-presentation";
import { lintDeckFidelity } from "./fidelity-validators";

/**
 * NIQ decimal-policy and claim-chart-alignment regression tests.
 * Hardening file from commit 22406d5: verbatim port of
 * scripts/test-metric-presentation.ts. Do NOT weaken assertions.
 */
describe("metric-presentation + claim-chart-alignment", () => {
  it("NIQ decimal policy + fidelity violation regression", () => {
    const salesValue = inferMetricPresentationSpec({ label: "Sales Value", title: "Category" });
    assert.equal(salesValue.decimalPlaces, 0);

    const salesValueMillions = inferMetricPresentationSpec({
      label: "Sales Value (Mln)",
      title: "Category",
    });
    assert.equal(salesValueMillions.decimalPlaces, 1);
    assert.equal(salesValueMillions.displayUnit, "millions");

    const weightedDistribution = inferMetricPresentationSpec({ label: "WD Promo", title: "Promo" });
    assert.equal(weightedDistribution.decimalPlaces, 0);
    assert.equal(weightedDistribution.displayUnit, "percent");

    const share = inferMetricPresentationSpec({ label: "Volume Share", title: "Competition" });
    assert.equal(share.decimalPlaces, 1);

    const discount = inferMetricPresentationSpec({ label: "% Discount", title: "Promo" });
    assert.equal(discount.decimalPlaces, 1);

    const price = inferMetricPresentationSpec({
      label: "Avg Promo Price (LTRS)",
      title: "Promo",
    });
    assert.equal(price.decimalPlaces, 2);

    const avgRefs = inferMetricPresentationSpec({
      label: "Numero medio di referenze",
      title: "Shelf",
    });
    assert.equal(avgRefs.decimalPlaces, 1);

    const priceIndex = inferMetricPresentationSpec({ label: "Price Index", title: "Competition" });
    assert.equal(priceIndex.decimalPlaces, 0);

    const intensityIndex = inferMetricPresentationSpec({
      label: "Intensity Index",
      title: "Promo",
    });
    assert.equal(intensityIndex.decimalPlaces, 1);

    const rotations = inferMetricPresentationSpec({ label: "Rotazioni", title: "Velocity" });
    assert.equal(rotations.decimalPlaces, 1);

    const fidelity = lintDeckFidelity({
      slides: [
        {
          position: 8,
          title: "Iper Capsule: productivity gap is critical",
          body: "Segafredo produces much less per distribution point than peers.",
          chart: {
            chartType: "horizontal_bar",
            title: "Sales by brand",
            xAxisLabel: "Sales Value",
            yAxisLabel: "Brand",
            excelSheetName: "S08_IperCapsuleSales",
            dataSignature: "sales-by-brand",
          },
        },
        {
          position: 9,
          title: "Macinato growth is price-led, not volume-led",
          body: "Average price rose materially while volumes lagged.",
          chart: {
            chartType: "horizontal_bar",
            title: "Segment ranking",
            xAxisLabel: "Growth %",
            yAxisLabel: "Segment",
            excelSheetName: "S09_SegmentGrowth",
            dataSignature: "segment-growth",
          },
        },
      ],
      sheets: [
        {
          name: "S08_IperCapsuleSales",
          headers: ["Brand", "Sales Value", "WD Promo"],
          rows: [{ Brand: "Segafredo", "Sales Value": 5.0, "WD Promo": 44 }],
          numericValues: [5.0, 44],
          dataSignature: "sales-by-brand",
        },
        {
          name: "S09_SegmentGrowth",
          headers: ["Segment", "Growth %", "Sales Value"],
          rows: [{ Segment: "Macinato", "Growth %": 28.7, "Sales Value": 958 }],
          numericValues: [28.7, 958],
          dataSignature: "segment-growth",
        },
      ],
    });

    const mismatchRules = fidelity.violations.map((violation) => violation.rule);
    assert.ok(mismatchRules.includes("claim_chart_metric_mismatch"));
  });
});
