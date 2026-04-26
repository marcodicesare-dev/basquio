import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";

import type { NormalizedWorkbook } from "@basquio/types";
import {
  buildBriefDataReconciliationProfile,
  buildFallbackBriefDataReconciliation,
  formatScopeAdjustmentForAuthor,
} from "./brief-data-reconciliation";

describe("brief-data-reconciliation", () => {
  it("extracts workbook scope and blocks unsupported Segafredo claims", () => {
    const rows = [
      ["WORLD", "CONTINENTS", "COUNTRY", "CATEGORY", "BRAND OWNER", "Value", null, null, "Volume", null, null],
      [null, null, null, null, null, 2023, 2024, 2025, 2023, 2024, 2025],
      ["WORLD", "EUROPE", "ITALY", "COFFEE MULTI SERVE", "MASSIMO ZANETTI", 100, 110, 120, 10, 11, 12],
      ["WORLD", "EUROPE", "ITALY", "COFFEE SOLUBLE", "NESTLE", 200, 210, 220, 20, 21, 22],
      ["WORLD", "EUROPE", "FRANCE", "COFFEE SINGLE SERVE ROAST", "LAVAZZA", 300, 310, 320, 30, 31, 32],
    ];
    const sheet = utils.aoa_to_sheet(rows);
    sheet["!merges"] = [
      { s: { r: 0, c: 5 }, e: { r: 0, c: 7 } },
      { s: { r: 0, c: 8 }, e: { r: 0, c: 10 } },
    ];
    const workbookFile = utils.book_new();
    utils.book_append_sheet(workbookFile, sheet, "Sheet1");
    const buffer = Buffer.from(write(workbookFile, { type: "buffer", bookType: "xlsx" }));
    const normalizedWorkbook = buildNormalizedWorkbook();

    const profile = buildBriefDataReconciliationProfile({
      briefText: "analizza i trend globali del caffe e le opportunita per Segafredo",
      files: [{
        id: "file-1",
        fileName: "Estrazione SP Segafredo.xlsx",
        kind: "workbook",
        buffer,
      }],
      workbook: normalizedWorkbook,
    });
    const result = buildFallbackBriefDataReconciliation(profile);
    const authorBlock = formatScopeAdjustmentForAuthor(result);

    expect(profile.detectedYears).toEqual([2023, 2024, 2025]);
    expect(profile.detectedMeasureGroups).toEqual(["Value", "Volume"]);
    expect(profile.unsupportedBriefTerms).toContain("Segafredo");
    expect(authorBlock).toContain("Do not claim or create data for years outside 2023, 2024, 2025.");
    expect(authorBlock).toContain("COFFEE MULTI SERVE");
    expect(authorBlock).toContain("COFFEE SOLUBLE");
    expect(authorBlock).toContain("COFFEE SINGLE SERVE ROAST");
    expect(authorBlock).toContain("Do not invent Segafredo metrics");
    expect(authorBlock).not.toContain("2019");
  });
});

function buildNormalizedWorkbook(): NormalizedWorkbook {
  const rows = [
    {
      WORLD: "WORLD",
      CONTINENTS: "EUROPE",
      COUNTRY: "ITALY",
      CATEGORY: "COFFEE MULTI SERVE",
      "BRAND OWNER": "MASSIMO ZANETTI",
      "2023": 100,
      "2024": 110,
      "2025": 120,
    },
    {
      WORLD: "WORLD",
      CONTINENTS: "EUROPE",
      COUNTRY: "ITALY",
      CATEGORY: "COFFEE SOLUBLE",
      "BRAND OWNER": "NESTLE",
      "2023": 200,
      "2024": 210,
      "2025": 220,
    },
    {
      WORLD: "WORLD",
      CONTINENTS: "EUROPE",
      COUNTRY: "FRANCE",
      CATEGORY: "COFFEE SINGLE SERVE ROAST",
      "BRAND OWNER": "LAVAZZA",
      "2023": 300,
      "2024": 310,
      "2025": 320,
    },
  ];

  return {
    datasetId: "run-1",
    sourceFileName: "Estrazione SP Segafredo.xlsx",
    files: [{
      id: "file-1",
      fileName: "Estrazione SP Segafredo.xlsx",
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "workbook",
      role: "main-fact-table",
      sheets: [],
      warnings: [],
    }],
    sheets: [{
      name: "Sheet1",
      rowCount: rows.length,
      sourceFileId: "file-1",
      sourceFileName: "Estrazione SP Segafredo.xlsx",
      sourceRole: "main-fact-table",
      columns: [
        { name: "WORLD", inferredType: "string", role: "dimension", nullable: false, sampleValues: ["WORLD"], uniqueCount: 1, nullRate: 0 },
        { name: "CONTINENTS", inferredType: "string", role: "dimension", nullable: false, sampleValues: ["EUROPE"], uniqueCount: 1, nullRate: 0 },
        { name: "COUNTRY", inferredType: "string", role: "dimension", nullable: false, sampleValues: ["ITALY"], uniqueCount: 2, nullRate: 0 },
        { name: "CATEGORY", inferredType: "string", role: "dimension", nullable: false, sampleValues: ["COFFEE MULTI SERVE"], uniqueCount: 3, nullRate: 0 },
        { name: "BRAND OWNER", inferredType: "string", role: "dimension", nullable: false, sampleValues: ["MASSIMO ZANETTI"], uniqueCount: 3, nullRate: 0 },
        { name: "2023", inferredType: "number", role: "measure", nullable: false, sampleValues: ["100"], uniqueCount: 3, nullRate: 0 },
        { name: "2024", inferredType: "number", role: "measure", nullable: false, sampleValues: ["110"], uniqueCount: 3, nullRate: 0 },
        { name: "2025", inferredType: "number", role: "measure", nullable: false, sampleValues: ["120"], uniqueCount: 3, nullRate: 0 },
      ],
      sampleRows: rows,
      rows,
    }],
  };
}
