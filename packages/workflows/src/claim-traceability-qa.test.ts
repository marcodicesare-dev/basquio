import { describe, expect, it } from "vitest";

import { filterStandaloneNumericRecommendationIssues } from "./claim-traceability-qa";

describe("filterStandaloneNumericRecommendationIssues", () => {
  it("drops duplicate linked-sheet issues for title-only numeric recommendation slides", () => {
    const issues = filterStandaloneNumericRecommendationIssues(
      [{
        position: 10,
        severity: "major",
        message:
          "Title claims 'EUR118M di fatturato incrementale calcolabile' but no linkedSheet is provided. The calculation methodology and lever-by-lever support must be visible on or linked to this slide to justify the headline number.",
      }],
      [{
        position: 10,
        layoutId: "recommendation-cards",
        slideArchetype: "recommendation-cards",
        pageIntent: "3 raccomandazioni prioritizzate con impatto, leva e timeline",
        title: "3 leve prioritarie per catturare EUR118M di fatturato incrementale calcolabile",
        body: null,
        bullets: [],
        calloutText: null,
        linkedSheet: null,
      }],
    );

    expect(issues).toHaveLength(0);
  });

  it("keeps substantive unsupported recommendation issues when card text exists", () => {
    const issues = filterStandaloneNumericRecommendationIssues(
      [{
        position: 10,
        severity: "major",
        message: "Recommendation says promo activation is underwhelming, but no linked sheet or cited prior slide shows promo effectiveness evidence.",
      }],
      [{
        position: 10,
        layoutId: "recommendation-cards",
        slideArchetype: "recommendation-cards",
        pageIntent: "3 raccomandazioni prioritizzate con impatto, leva e timeline",
        title: "3 leve prioritarie per catturare EUR118M di fatturato incrementale calcolabile",
        body: "Accelerare la promo activation nei cluster premium.",
        bullets: [],
        calloutText: null,
        linkedSheet: null,
      }],
    );

    expect(issues).toHaveLength(1);
  });
});
