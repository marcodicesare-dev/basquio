import { describe, expect, it } from "vitest";

import { buildReviseMessage, computeReviseIterationBudget } from "./generate-deck";

const manifest = {
  slideCount: 3,
  pageCount: 3,
  slides: [
    { position: 1, title: "Cover", layoutId: "cover", slideArchetype: "cover" },
    { position: 2, title: "Market", layoutId: "title-chart", slideArchetype: "title-chart" },
    { position: 3, title: "Summary", layoutId: "summary", slideArchetype: "summary" },
  ],
  charts: [],
};

const currentPdf = {
  fileId: "pdf-1",
  fileName: "deck.pdf",
  buffer: Buffer.from("%PDF-1.4"),
  mimeType: "application/pdf",
};

const visualQa = {
  score: 8.5,
  overallStatus: "green" as const,
  weakestSlides: [] as number[],
  strongestSlides: [] as number[],
  deckNeedsRevision: false,
  issues: [],
  summary: "ok",
};

function extractText(message: ReturnType<typeof buildReviseMessage>) {
  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || !("text" in textBlock)) {
    throw new Error("Expected text block");
  }
  return textBlock.text;
}

describe("buildReviseMessage", () => {
  it("widens revise scope for deck-level count and closing-slide contract issues", () => {
    const message = buildReviseMessage({
      issues: [
        "Deck plan issue [content_overflow]: Plan has 11 content slides for a 10-slide ask.",
        "Deck contract issue: Last slide should be summary or recommendation layout",
      ],
      manifest,
      currentPdf,
      visualQa,
      targetSlideCount: 10,
    });

    const text = extractText(message);
    expect(text).toContain("You may change any slide, but still preserve the storyline and keep edits minimal.");
    expect(text).toContain("If a critique issue says [content_shortfall], [content_overflow], or [appendix_overfill]");
    expect(text).toContain("If you include a structural closing slide, it must be the final slide.");
    expect(text).toContain("If there is one surplus slide, remove the weakest trailing support slide");
    expect(text).toContain("The user asked for exactly 10 content slides.");
  });

  it("keeps revise scope narrow for slide-local issues", () => {
    const message = buildReviseMessage({
      issues: [
        "Slide 2 title is 96 characters and will overflow the right margin. Shorten to under 75 characters.",
      ],
      manifest,
      currentPdf,
      visualQa,
      targetSlideCount: 10,
    });

    const text = extractText(message);
    expect(text).toContain("You may change ONLY these slides: 2 (Market).");
    expect(text).toContain("Do NOT change these slides: 1 (Cover), 3 (Summary).");
  });

  it("treats non-visual blocking issues as mandatory, not optional", () => {
    const message = buildReviseMessage({
      issues: [
        "Slide 2 writing issue [em_dash]: Em dash in title (title)",
        "Slide 2 writing issue [title_no_number]: Non-cover title has no number (title)",
        "Slide 2 fidelity issue [title_claim_unverified]: Title number \"+22%\" is not verifiable from the linked slide data.",
        "Slide 2 fidelity issue [claim_chart_metric_mismatch]: Slide commentary says the story is price-led, but the hero chart does not show price mechanics or value-vs-volume decomposition.",
        "Slide 2 chart exposes 15 categories but the title-chart chart slot is capped at 12. Aggregate the tail, switch to horizontal orientation, or change the grammar.",
      ],
      manifest,
      currentPdf,
      visualQa,
      targetSlideCount: 10,
    });

    const text = extractText(message);
    expect(text).toContain("Mandatory non-visual issues to fix in the same revise turn:");
    expect(text).toContain("If a critique issue says em_dash, replace every em dash");
    expect(text).toContain("If a critique issue says title_no_number or title_number_coverage");
    expect(text).toContain("If a critique issue says title_claim_unverified or data_primacy");
    expect(text).toContain("If a critique issue says claim_chart_metric_mismatch or distribution_claim_without_productivity_proof");
    expect(text).toContain("If a critique issue says the chart exceeds the layout slot cap");
    expect(text).not.toContain("Secondary issues to consider only if they can be fixed");
  });

  it("grants more revise loops for heavy sonnet repair frontiers", () => {
    expect(computeReviseIterationBudget({
      repairLane: "sonnet",
      frontierState: {
        blockingContractIssueCount: 8,
        claimTraceabilityIssueCount: 1,
        blockingVisualIssueCount: 2,
        visualScore: 6.2,
        advisoryIssueCount: 3,
        deckNeedsRevision: true,
      },
    })).toBe(5);
  });
});
