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

    expect(gate.advisories).toContain("chart_density_fits_layout_slots");
    expect(gate.advisories).toContain("rendered_page_visual_no_revision");
    expect(gate.blockingFailures).toContain("lint:Slide 1 writing issue [em_dash]: Em dash in title (title)");
    expect(gate.blockingFailures).toContain("claim:Slide 7 claim issue [claim_traceability]: Title claims unsupported causal diagnosis.");
    expect(gate.blockingFailures).toContain("lint:Slide 2 fidelity issue [title_claim_unverified]: Title number \"+22%\" is not verifiable from the linked slide data.");
    expect(gate.blockingFailures).toContain("contract:Deck contract issue: Last slide should be summary or recommendation layout");
  });

  it("keeps small copy and layout defects advisory so completed artifacts can still publish", () => {
    const gate = collectPublishGateFailures({
      qaReport: {
        tier: "yellow",
        passed: true,
        checks: [],
        failed: ["rendered_page_visual_no_revision"],
      } as never,
      lint: {
        actionableIssues: [
          "Slide 2 writing issue [title_no_number]: Non-cover title has no number (title)",
          "Slide 3 writing issue [italian_missing_accent]: Missing Italian accent (body)",
          "Deck writing issue [low_layout_variety]: Only 3 layout types used across 12 slides",
        ],
        result: { passed: false, slideResults: [], deckViolations: [] },
        fidelity: { violations: [] },
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
        actionableIssues: [],
        result: { valid: true, violations: [] },
      } as never,
      claimIssues: [],
    });

    expect(gate.blockingFailures).toEqual([]);
    expect(gate.advisories).toContain("rendered_page_visual_no_revision");
    expect(gate.advisories).toContain("lint:Slide 2 writing issue [title_no_number]: Non-cover title has no number (title)");
    expect(gate.advisories).toContain("lint:Slide 3 writing issue [italian_missing_accent]: Missing Italian accent (body)");
    expect(gate.advisories).toContain("lint:Deck writing issue [low_layout_variety]: Only 3 layout types used across 12 slides");
  });
});
