import { describe, expect, it } from "vitest";

import { buildReviseMessage } from "./generate-deck";

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
    expect(text).toContain("If a critique issue says title_claim_unverified or data_primacy");
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
});
