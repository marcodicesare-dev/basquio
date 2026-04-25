import { describe, expect, it } from "vitest";

import { collectPublishGateFailures } from "./generate-deck";

describe("collectPublishGateFailures", () => {
  it("treats blocking lint, contract, claim, and visual gate failures as hard blockers", () => {
    const gate = collectPublishGateFailures({
      qaReport: {
        tier: "yellow",
        passed: false,
        checks: [],
        failed: [
          "chart_density_fits_layout_slots",
          "rendered_page_visual_no_revision",
        ],
      } as never,
      lint: {
        actionableIssues: [
          "Slide 1 writing issue [em_dash]: Em dash in title (title)",
          "Slide 2 fidelity issue [title_claim_unverified]: Title number \"+22%\" is not verifiable from the linked slide data.",
        ],
        result: {
          passed: false,
          slideResults: [],
          deckViolations: [],
        },
        fidelity: {
          violations: [],
        },
        planLint: {
          pairViolations: [],
          deckViolations: [],
          uniqueDimensions: 0,
          minRequiredDimensions: 0,
          deepestLevel: 0,
          contentSlideCount: 0,
          appendixSlideCount: 0,
          appendixCap: 0,
        },
      } as never,
      contract: {
        actionableIssues: [
          "Deck contract issue: Last slide should be summary or recommendation layout",
        ],
        result: {
          valid: false,
          violations: [{ message: "Last slide should be summary or recommendation layout" }],
        },
      } as never,
      claimIssues: [
        {
          position: 7,
          severity: "major",
          message: "Title claims unsupported causal diagnosis.",
        },
      ],
    });

    expect(gate.blockingFailures).toContain("chart_density_fits_layout_slots");
    expect(gate.blockingFailures).toContain("rendered_page_visual_no_revision");
    expect(gate.blockingFailures).toContain("lint:Slide 1 writing issue [em_dash]: Em dash in title (title)");
    expect(gate.blockingFailures).toContain("contract:Deck contract issue: Last slide should be summary or recommendation layout");
    expect(gate.blockingFailures).toContain("claim:Slide 7 claim issue [claim_traceability]: Title claims unsupported causal diagnosis.");
  });
});
