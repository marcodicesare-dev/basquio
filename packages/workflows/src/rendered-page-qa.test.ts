import { describe, expect, it } from "vitest";

import { buildRenderedPageQaPrompt } from "./rendered-page-qa";

describe("rendered-page QA prompt", () => {
  it("treats chart callout overlap as a revision-worthy visual defect", () => {
    const prompt = buildRenderedPageQaPrompt({
      slideCount: 2,
      slides: [
        { position: 1, title: "Cover", layoutId: "cover" },
        { position: 2, title: "Market growth", layoutId: "title-chart", slideArchetype: "title-chart" },
      ],
    });

    expect(prompt).toContain("Do not award green");
    expect(prompt).toContain("chart_callout_overlap");
    expect(prompt).toContain("axis_label_obscured");
    expect(prompt).toContain("deckNeedsRevision=true");
  });
});
