import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { parseEvidencePackage } from "@basquio/data-ingest";
import { createSystemTemplateProfile } from "@basquio/template-engine";

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

  it("does not award reviewed quality when rendered visual QA was skipped", () => {
    const passport = __test__.classifyQualityPassport({
      qaReport: {
        failed: [],
        checks: [],
      } as never,
      lint: {
        result: { deckViolations: [], slideResults: [] },
        fidelity: { violations: [] },
        planLint: { pairViolations: [], deckViolations: [] },
      } as never,
      contract: {
        actionableIssues: [],
      } as never,
      visualQa: {
        score: 8.8,
        overallStatus: "green",
        summary: "Visual QA skipped: invalid_internal_pdf:pdf_invalid_header",
        deckNeedsRevision: false,
        issues: [],
        strongestSlides: [],
        weakestSlides: [],
      },
      claimIssues: [],
    });

    expect(passport.classification).toBe("bronze");
    expect(passport.summary).toContain("visualVerified=false");
  });

  it("removes orphan slide-master content type overrides before PPTX QA", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        '<Override PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        "</Types>",
      ].join(""),
    );
    zip.file("ppt/slideMasters/slideMaster1.xml", "<p:sldMaster/>");
    const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));

    const sanitized = await __test__.sanitizePptxMedia(buffer);
    const sanitizedZip = await JSZip.loadAsync(sanitized);
    const contentTypes = await sanitizedZip.file("[Content_Types].xml")!.async("string");

    expect(contentTypes).toContain("/ppt/slideMasters/slideMaster1.xml");
    expect(contentTypes).not.toContain("/ppt/slideMasters/slideMaster2.xml");
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

  it("publishes bronze or recovery passports as degraded advisories, not hard blockers", () => {
    expect(__test__.collectQualityPassportPublishAdvisories({
      classification: "recovery",
      criticalCount: 6,
      majorCount: 7,
      visualScore: 8.2,
      mecePass: false,
      summary: "Quality passport recovery: visual=8.2, critical=6, major=7, mecePass=false.",
    })).toEqual([
      "quality_passport_not_reviewed: Quality passport recovery: visual=8.2, critical=6, major=7, mecePass=false.",
    ]);

    expect(__test__.collectQualityPassportPublishAdvisories({
      classification: "bronze",
      criticalCount: 0,
      majorCount: 9,
      visualScore: 7.2,
      mecePass: true,
      summary: "Quality passport bronze: visual=7.2, critical=0, major=9, mecePass=true.",
    })).toEqual([
      "quality_passport_not_reviewed: Quality passport bronze: visual=7.2, critical=0, major=9, mecePass=true.",
    ]);
  });

  it("does not add quality passport advisories for reviewed silver and gold outputs", () => {
    for (const classification of ["silver", "gold"] as const) {
      expect(__test__.collectQualityPassportPublishAdvisories({
        classification,
        criticalCount: 0,
        majorCount: classification === "gold" ? 1 : 5,
        visualScore: classification === "gold" ? 9 : 7.5,
        mecePass: true,
        summary: `Quality passport ${classification}`,
      })).toEqual([]);
    }
  });

  it("hard-blocks only artifact integrity failures at final publish", () => {
    expect(__test__.collectArtifactIntegrityPublishFailures([
      "chart_density_fits_layout_slots",
      "rendered_page_visual_no_revision",
      "lint:Slide 4 writing issue [storyline_backtracking]: returned to a prior branch",
      "claim:Slide 7 claim issue [claim_traceability]: Unsupported claim.",
      "pptx_zip_signature",
      "xlsx_workbook_xml",
    ])).toEqual([
      "pptx_zip_signature",
      "xlsx_workbook_xml",
    ]);
  });

  it("enriches sparse manifests from actual PPTX visible text before QA", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide2.xml",
      [
        "<p:sld><p:cSld><p:spTree>",
        "<a:t>Q2 COMMERCIAL ACTIONS</a:t>",
        "<a:t>NORTHSTAR SHARE</a:t>",
        "<a:t>55.8%</a:t>",
        "<a:t>-0.5pp vs Jan</a:t>",
        "<a:t>Restore TT distribution to 73%+</a:t>",
        "<a:t>TT promo efficiency is 8.9x; PL gained 3.6pp channel share.</a:t>",
        "<a:t>Recover ~$4K/month value</a:t>",
        "</p:spTree></p:cSld></p:sld>",
      ].join(""),
    );
    const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));

    const enriched = await __test__.enrichManifestWithPptxVisibleText({
      manifest: {
        slideCount: 2,
        pageCount: 2,
        slides: [
          { position: 1, layoutId: "cover", slideArchetype: "cover", title: "Cover" },
          {
            position: 2,
            layoutId: "recommendation-cards",
            slideArchetype: "recommendation-cards",
            pageIntent: "q2-actions",
            title: "Three Q2 actions protect the channel reset",
          },
        ],
        charts: [],
      } as never,
      pptx: {
        fileId: "pptx",
        fileName: "deck.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer,
      },
    });

    expect(enriched.slides[1]?.body).toContain("Restore TT distribution to 73%+");
    expect(enriched.slides[1]?.body).toContain("Recover ~$4K/month value");
    expect(enriched.slides[1]?.metrics).toContainEqual({
      label: "NORTHSTAR SHARE",
      value: "55.8%",
      delta: "-0.5pp vs Jan",
    });
  });

  it("builds deterministic recovery artifacts when author cannot publish reviewed files", async () => {
    const parsed = await parseEvidencePackage({
      datasetId: "recovery-smoke",
      files: [
        {
          id: "source-1",
          fileName: "sales.csv",
          buffer: Buffer.from([
            "Month,Channel,ValueSales,VolumeUnits",
            "Jan,Modern Trade,1200,80",
            "Feb,Modern Trade,1400,92",
            "Mar,E-commerce,1800,110",
          ].join("\n")),
        },
      ],
    });

    const artifacts = await __test__.buildDeterministicRecoveryArtifacts({
      run: {
        id: "run-1",
        organization_id: "org-1",
        project_id: "project-1",
        requested_by: "user-1",
        brief: {},
        business_context: "Diagnose commercial performance.",
        client: "Northstar Foods",
        audience: "Country Manager",
        objective: "Explain channel growth",
        thesis: "Modern Trade and E-commerce are driving growth.",
        stakes: "Used for Q2 planning.",
        source_file_ids: ["source-1"],
        target_slide_count: 5,
        author_model: "claude-sonnet-4-6",
        template_profile_id: null,
        template_diagnostics: null,
        workspace_id: null,
        workspace_scope_id: null,
        conversation_id: null,
        from_message_id: null,
        launch_source: "operator-smoke-test",
        workspace_context_pack: null,
        workspace_context_pack_hash: null,
        active_attempt_id: "attempt-1",
        latest_attempt_id: "attempt-1",
        latest_attempt_number: 1,
        failure_phase: null,
      } as never,
      parsed,
      templateProfile: createSystemTemplateProfile(),
      parseWarnings: [],
      reason: "author retry failed",
    });

    expect(artifacts.manifest.slideCount).toBe(5);
    expect(artifacts.qaReport.qualityPassport.classification).toBe("recovery");
    expect(artifacts.pptx.buffer.subarray(0, 2).toString()).toBe("PK");
    expect(artifacts.xlsx.buffer.subarray(0, 2).toString()).toBe("PK");
    expect(artifacts.md.buffer.toString("utf8")).toContain("Recovery reason: author retry failed");
  });
});
