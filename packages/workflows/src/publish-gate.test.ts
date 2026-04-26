import { describe, expect, it } from "vitest";

import { __test__, collectPublishGateFailures } from "./generate-deck";

describe("collectPublishGateFailures", () => {
  it("treats blocking lint, contract, claim, visual, and artifact gate failures as hard blockers", () => {
    const gate = collectPublishGateFailures({
      qaReport: {
        tier: "yellow",
        passed: false,
        checks: [],
        failed: [
          "chart_density_fits_layout_slots",
          "rendered_page_visual_no_revision",
          "md_minimum_word_count",
          "xlsx_data_sheets_have_tables",
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
    expect(gate.blockingFailures).toContain("md_minimum_word_count");
    expect(gate.blockingFailures).toContain("xlsx_data_sheets_have_tables");
    expect(gate.blockingFailures).toContain("lint:Slide 1 writing issue [em_dash]: Em dash in title (title)");
    expect(gate.blockingFailures).toContain("claim:Slide 7 claim issue [claim_traceability]: Title claims unsupported causal diagnosis.");
    expect(gate.blockingFailures).toContain("lint:Slide 2 fidelity issue [title_claim_unverified]: Title number \"+22%\" is not verifiable from the linked slide data.");
    expect(gate.blockingFailures).toContain("contract:Deck contract issue: Last slide should be summary or recommendation layout");
  });

  it("blocks copy defects that break analyst acceptance while keeping low layout variety advisory", () => {
    const gate = collectPublishGateFailures({
      qaReport: {
        tier: "yellow",
        passed: true,
        checks: [],
        failed: [],
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

    expect(gate.blockingFailures).toContain("lint:Slide 2 writing issue [title_no_number]: Non-cover title has no number (title)");
    expect(gate.blockingFailures).toContain("lint:Slide 3 writing issue [italian_missing_accent]: Missing Italian accent (body)");
    expect(gate.advisories).toContain("lint:Deck writing issue [low_layout_variety]: Only 3 layout types used across 12 slides");
  });

  it("turns invalid author analysis plans into a complete artifact rebuild instruction", () => {
    const gate = __test__.buildAuthorPlanQualityGate({
      sheetReport: {
        valid: false,
        fabricatedSheetNames: [{
          slidePosition: 4,
          chartId: "chart-4",
          claimedSheetName: "Promo share by country",
          knownSheetNames: ["Estrazione SP Segafredo"],
        }],
      },
      planLint: {
        actionableIssues: [
          "Slides 3 and 10: same leaf question should not be repeated.",
          "Deck plan issue [storyline_backtracking]: returned to a previous chapter after leaving it.",
        ],
        summary: {
          slideCount: 12,
          requestedSlideCount: 10,
          drillDownDimensions: ["market", "channel"],
          minRequiredDimensions: 4,
          mecePairViolations: 1,
          deepestLevel: 2,
          chapterDepths: {},
          contentSlideCount: 10,
          appendixSlideCount: 0,
          appendixCap: 1,
          meceCheckEnabled: false,
        },
        result: {},
      } as never,
    });

    expect(gate.passed).toBe(false);
    expect(gate.issues).toContain("Slide 4 plan sheet issue [plan_sheet_name]: chart chart-4 references \"Promo share by country\" outside the uploaded dataset.");
    expect(gate.issues).toContain("Deck plan issue [storyline_backtracking]: returned to a previous chapter after leaving it.");

    const retryMessage = __test__.buildAuthorPlanQualityRetryMessage({
      issues: gate.issues,
      targetSlideCount: 10,
      requiredFiles: ["analysis_result.json", "deck.pptx", "narrative_report.md", "data_tables.xlsx", "deck_manifest.json"],
      knownSheetNames: ["Estrazione SP Segafredo"],
    });
    const text = ((retryMessage.content as Array<{ text?: string }>)[0]?.text ?? "");

    expect(text).toContain("Rebuild the complete artifact set");
    expect(text).toContain("content-slide count must be exactly 10");
    expect(text).toContain("Use only these uploaded sheet names");
    expect(text).toContain("analysis_result.json");
    expect(text).toContain("deck.pptx");
  });
});
