import { describe, expect, it } from "vitest";

import { collectBlockingEvidenceFailures } from "./publish-gate";

describe("collectBlockingEvidenceFailures", () => {
  it("blocks major fidelity issues and claim issues, but ignores minor fidelity findings", () => {
    const failures = collectBlockingEvidenceFailures({
      fidelityViolations: [
        {
          rule: "duplicate_source_line",
          severity: "minor",
          position: 2,
          message: "Keep a single source line.",
        },
        {
          rule: "promo_mechanic_coverage_gap",
          severity: "major",
          position: 14,
          message: "Promo mechanics omitted Communication In Store.",
        },
      ],
      claimIssues: [
        {
          position: 19,
          severity: "major",
          message: "Recommendation cites an unsupported retailer-specific action.",
        },
      ],
    });

    expect(failures).toEqual([
      "fidelity:Slide 14 [promo_mechanic_coverage_gap] Promo mechanics omitted Communication In Store.",
      "claim:Slide 19 Recommendation cites an unsupported retailer-specific action.",
    ]);
  });
});
