import { describe, expect, it } from "vitest";

import { validateCitations } from "./citation-fidelity-validator";

describe("validateCitations", () => {
  it("passes for uploaded filenames", () => {
    const report = validateCitations({
      manifest: {
        slides: [{
          position: 1,
          title: "Slide 1",
          body: "Fonte: q3-promo-data.xlsx",
        }],
        charts: [],
      },
      uploadedFileNames: ["q3-promo-data.xlsx"],
      fetchedUrls: [],
    });

    expect(report.passed).toBe(true);
  });

  it("passes for fetched URLs", () => {
    const report = validateCitations({
      manifest: {
        slides: [{
          position: 1,
          title: "Slide 1",
          body: "Source: https://retailwatch.it/article/123",
        }],
        charts: [],
      },
      uploadedFileNames: [],
      fetchedUrls: ["https://retailwatch.it/article/123"],
    });

    expect(report.passed).toBe(true);
  });

  it("flags unfetched URLs", () => {
    const report = validateCitations({
      manifest: {
        slides: [{
          position: 2,
          title: "Slide 2",
          body: "Source: https://example.com/fake",
        }],
        charts: [],
      },
      uploadedFileNames: [],
      fetchedUrls: [],
    });

    expect(report.passed).toBe(false);
    expect(report.violations[0]?.violationType).toBe("unfetched-url");
  });

  it("flags fabricated report names", () => {
    const report = validateCitations({
      manifest: {
        slides: [{
          position: 3,
          title: "Slide 3",
          body: "Fonte: NIQ EMEA Pulses w34 IT",
        }],
        charts: [],
      },
      uploadedFileNames: ["cocktails.xlsx"],
      fetchedUrls: [],
    });

    expect(report.passed).toBe(false);
    expect(report.violations[0]?.violationType).toBe("fabricated-report-name");
  });
});
