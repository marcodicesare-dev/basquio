import { describe, expect, it } from "vitest";

import type { DatasetProfile } from "@basquio/types";

import { validatePlanSheetNames } from "./plan-sheet-name-validator";

function buildDatasetProfile(sheetName: string): DatasetProfile {
  return {
    datasetId: "ds-1",
    sourceFileName: `${sheetName}.xlsx`,
    sourceFiles: [{
      id: "sf-1",
      fileName: `${sheetName}.xlsx`,
      role: "main-fact-table",
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "workbook",
      parsedSheetCount: 1,
      notes: [],
    }],
    manifest: {
      datasetId: "ds-1",
      packageLabel: sheetName,
      files: [],
      methodologyFileIds: [],
      validationFileIds: [],
      citationFileIds: [],
      warnings: [],
    },
    sheets: [{
      name: sheetName,
      rowCount: 10,
      sourceFileId: "sf-1",
      sourceFileName: `${sheetName}.xlsx`,
      sourceRole: "main-fact-table",
      columns: [],
      sampleRows: [],
    }],
    warnings: [],
  };
}

describe("validatePlanSheetNames", () => {
  it("flags Rossella-style fabricated sheet names", () => {
    const report = validatePlanSheetNames({
      slidePlan: [
        { position: 2, chart: { id: "chart-2", excelSheetName: "S02_EMEA_Overview" } },
        { position: 3, chart: { id: "chart-3", excelSheetName: "S03_Italia_Bridge" } },
        { position: 4, chart: { id: "chart-4", excelSheetName: "S04_Italia_Canali" } },
        { position: 5, chart: { id: "chart-5", excelSheetName: "S05_Italia_Formati" } },
        { position: 6, chart: { id: "chart-6", excelSheetName: "S06_Competitor_Share" } },
        { position: 7, chart: { id: "chart-7", excelSheetName: "S07_Channel_Mix" } },
        { position: 8, chart: { id: "chart-8", excelSheetName: "S08_Price_Bridge" } },
        { position: 9, chart: { id: "chart-9", excelSheetName: "S09_EMEA_Countries" } },
        { position: 10, chart: { id: "chart-10", excelSheetName: "S10_Scenarios_2027" } },
        { position: 11, chart: { id: "chart-11", excelSheetName: "S11_Recommendation_Impact" } },
      ],
      datasetProfile: buildDatasetProfile("w34 Cocktails on tap"),
    });

    expect(report.valid).toBe(false);
    expect(report.fabricatedSheetNames.length).toBeGreaterThanOrEqual(10);
  });

  it("passes when the claimed sheet exists in the dataset profile", () => {
    const report = validatePlanSheetNames({
      slidePlan: [
        { position: 2, chart: { id: "chart-2", excelSheetName: "NIQ scanner coffee" } },
      ],
      datasetProfile: buildDatasetProfile("NIQ scanner coffee"),
    });

    expect(report.valid).toBe(true);
    expect(report.fabricatedSheetNames).toHaveLength(0);
  });

  it("passes computed sheet names", () => {
    const report = validatePlanSheetNames({
      slidePlan: [
        { position: 2, chart: { id: "chart-2", excelSheetName: "computed_trial_rate_by_gender" } },
      ],
      datasetProfile: buildDatasetProfile("w34 Cocktails on tap"),
    });

    expect(report.valid).toBe(true);
  });
});
