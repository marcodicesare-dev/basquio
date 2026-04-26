import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { __test__, buildMarkdownArtifactChecks } from "./generate-deck";

describe("durable artifact quality checks", () => {
  it("detects short narrative reports and common Italian accent loss", () => {
    const markdown = [
      "# Executive Summary",
      "## Interpretazione del Brief",
      "## Executive Summary",
      "## Metodologia",
      "## Raccomandazioni",
      "## Appendice: Dati di Supporto",
      "La priorita e quasi sempre rendere il dato verificabile.",
    ].join("\n");

    const checks = buildMarkdownArtifactChecks(Buffer.from(markdown, "utf8"), "deck");
    const byName = new Map(checks.map((check) => [check.name, check]));

    expect(byName.get("md_minimum_line_count")?.passed).toBe(false);
    expect(byName.get("md_minimum_word_count")?.passed).toBe(false);
    expect(byName.get("md_required_sections_present")?.passed).toBe(true);
    expect(byName.get("md_italian_orthography_clean")?.passed).toBe(false);
  });

  it("scales deck narrative depth by requested slide count", () => {
    const checks = buildMarkdownArtifactChecks(Buffer.from("# Executive Summary\n\nBrief body", "utf8"), "deck", 5);
    const byName = new Map(checks.map((check) => [check.name, check]));

    expect(byName.get("md_minimum_line_count")?.detail).toBe("lines=3 minimum=160");
    expect(byName.get("md_minimum_word_count")?.detail).toBe("words=5 minimum=1800");
  });

  it("accepts formatted workbook sheets with tables, panes, widths, and chart drawings", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", [
      "<workbook>",
      "<sheets>",
      '<sheet name="README" sheetId="1"/>',
      '<sheet name="S02_Data" sheetId="2"/>',
      "</sheets>",
      "</workbook>",
    ].join(""));
    zip.file("xl/worksheets/sheet1.xml", "<worksheet/>");
    zip.file("xl/worksheets/sheet2.xml", [
      "<worksheet>",
      "<sheetViews><sheetView><pane ySplit=\"1\" topLeftCell=\"A2\" state=\"frozen\"/></sheetView></sheetViews>",
      "<cols><col min=\"1\" max=\"3\" width=\"18\" customWidth=\"1\"/></cols>",
      "<tableParts count=\"1\"><tablePart r:id=\"rId1\"/></tableParts>",
      "</worksheet>",
    ].join(""));
    zip.file("xl/drawings/drawing1.xml", [
      "<xdr:wsDr>",
      "<xdr:twoCellAnchor>",
      "<a:graphic><a:graphicData>",
      "<c:chart r:id=\"rId1\"/>",
      "</a:graphicData></a:graphic>",
      "</xdr:twoCellAnchor>",
      "</xdr:wsDr>",
    ].join(""));

    const checks = await __test__.buildWorkbookArtifactChecks(zip, ["README", "S02_Data"], 1);

    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("routes weak narrative and workbook quality checks into revise repair", () => {
    const repairIssues = __test__.formatArtifactQualityRepairIssues({
      failed: [
        "md_minimum_line_count",
        "md_minimum_word_count",
        "xlsx_data_sheets_have_tables",
        "rendered_page_visual_no_revision",
      ],
      checks: [
        { name: "md_minimum_line_count", passed: false, detail: "lines=403 minimum=500" },
        { name: "md_minimum_word_count", passed: false, detail: "words=4145 minimum=5000" },
        { name: "xlsx_data_sheets_have_tables", passed: false, detail: "missing tablePart: xl/worksheets/sheet2.xml" },
        { name: "rendered_page_visual_no_revision", passed: false, detail: "visual judge advisory" },
      ],
    } as never);

    expect(repairIssues).toEqual([
      "Artifact quality issue [md_minimum_line_count]: narrative_report.md failed durable output QA. lines=403 minimum=500",
      "Artifact quality issue [md_minimum_word_count]: narrative_report.md failed durable output QA. words=4145 minimum=5000",
      "Artifact quality issue [xlsx_data_sheets_have_tables]: data_tables.xlsx failed durable output QA. missing tablePart: xl/worksheets/sheet2.xml",
    ]);
  });
});
