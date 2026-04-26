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
    expect(text).toContain("existing data_tables.xlsx sheet names");
    expect(text).toContain("analysis_result.json");
    expect(text).toContain("deck.pptx");
  });

  it("accepts generated workbook companion sheets during author plan validation", () => {
    const report = __test__.resolvePlanSheetValidationReport({
      slidePlan: [
        { position: 3, chart: { id: "chart-3", excelSheetName: "S03_CategoryTotals" } },
      ],
      datasetProfile: {
        sheets: [{ name: "Estrazione SP Segafredo" }],
        sourceFiles: [{ fileName: "Estrazione SP Segafredo.xlsx" }],
      } as never,
      workbookSheets: [{
        name: "S03_CategoryTotals",
        headers: ["Metrica", "Valore"],
        rows: [],
        numericValues: [],
        dataSignature: "sheet:s03",
      }],
    });

    expect(report.valid).toBe(true);
    expect(report.fabricatedSheetNames).toHaveLength(0);
  });

  it("accepts null Excel chart anchors in generated analysis artifacts", () => {
    const result = __test__.validateGeneratedAnalysisResultFile([{
      fileId: "file-analysis",
      fileName: "analysis_result.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        language: "Italian",
        thesis: "Segafredo deve riallineare promozioni e distribuzione.",
        executiveSummary: "Sintesi",
        slidePlan: [{
          position: 3,
          title: "La quota resta sotto il mercato",
          chart: {
            id: "chart-3",
            chartType: "bar",
            title: "Promozioni per communication in store",
            excelSheetName: "S03_PromoComm",
            excelChartCellAnchor: null,
          },
        }],
      })),
    }]);

    expect(result.valid).toBe(true);
  });

  it("uses manifest chart metadata to avoid false generic duplicate cuts", () => {
    const plan = __test__.lintManifestPlan({
      slideCount: 4,
      slides: [
        { position: 1, layoutId: "cover", slideArchetype: "cover", title: "Segafredo promo review" },
        { position: 2, layoutId: "exec-summary", slideArchetype: "exec-summary", title: "La quota resta sotto il mercato" },
        {
          position: 3,
          layoutId: "title-chart",
          slideArchetype: "title-chart",
          title: "La quota resta sotto il mercato",
          chartId: "promo-chart",
        },
        {
          position: 4,
          layoutId: "title-chart",
          slideArchetype: "title-chart",
          title: "La quota resta sotto il mercato",
          chartId: "channel-chart",
        },
      ],
      charts: [
        {
          id: "promo-chart",
          chartType: "bar",
          title: "Promozioni per communication in store",
          excelSheetName: "S03_PromoComm",
          xAxisLabel: "Communication in store",
          yAxisLabel: "Quota promo",
        },
        {
          id: "channel-chart",
          chartType: "bar",
          title: "Canali e insegne per peso vendite",
          excelSheetName: "S04_ChannelMix",
          xAxisLabel: "Canale",
          yAxisLabel: "Quota valore",
        },
      ],
    } as never, 3);

    expect(plan.actionableIssues).not.toContainEqual(expect.stringContaining("redundant_analytical_cut"));
  });
});
