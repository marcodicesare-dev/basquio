import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { DatasetProfile } from "@basquio/types";

import { validateDataPrimacy } from "./data-primacy-validator";

async function buildWorkbookBuffer(rows: Array<Array<string | number>>) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("w34 Cocktails on tap");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildSparseWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("w34 Cocktails on tap");
  sheet.getCell("A1").value = "metric";
  sheet.getCell("C1").value = "value";
  sheet.getCell("A2").value = "respondents";
  sheet.getCell("C2").value = 100;
  sheet.getCell("A3").value = "trial_rate";
  sheet.getCell("C3").value = 0.135;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function buildDatasetProfile(): DatasetProfile {
  return {
    datasetId: "dataset-1",
    sourceFileName: "cocktails.xlsx",
    sourceFiles: [{
      id: "file-1",
      fileName: "cocktails.xlsx",
      role: "main-fact-table",
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "workbook",
      parsedSheetCount: 1,
      notes: [],
    }],
    sheets: [{
      name: "w34 Cocktails on tap",
      rowCount: 3,
      sourceFileId: "file-1",
      sourceFileName: "cocktails.xlsx",
      sourceRole: "main-fact-table",
      columns: [
        {
          name: "metric",
          inferredType: "string",
          role: "dimension",
          nullable: false,
          sampleValues: ["respondents"],
          uniqueCount: 2,
          nullRate: 0,
        },
        {
          name: "value",
          inferredType: "number",
          role: "measure",
          nullable: false,
          sampleValues: ["100", "0.135"],
          uniqueCount: 2,
          nullRate: 0,
        },
      ],
      sampleRows: [
        { metric: "respondents", value: 100 },
        { metric: "trial_rate", value: 0.135 },
      ],
    }],
    warnings: [],
  };
}

describe("validateDataPrimacy", () => {
  it("passes when every slide number matches uploaded workbook values", async () => {
    const workbook = await buildWorkbookBuffer([
      ["metric", "value"],
      ["respondents", 100],
      ["trial_rate", 0.135],
    ]);

    const report = await validateDataPrimacy({
      manifest: {
        slides: [{
          position: 1,
          title: "100 respondents",
          body: "Trial intent sits at 13,5%",
        }],
        charts: [],
      },
      datasetProfile: buildDatasetProfile(),
      uploadedWorkbookBuffers: [{ fileName: "cocktails.xlsx", buffer: workbook }],
    });

    expect(report.heroPassed).toBe(true);
    expect(report.bodyPassed).toBe(true);
    expect(report.unboundClaims).toHaveLength(0);
  });

  it("flags an invented hero number in the title", async () => {
    const workbook = await buildWorkbookBuffer([
      ["metric", "value"],
      ["respondents", 100],
      ["trial_rate", 0.135],
    ]);

    const report = await validateDataPrimacy({
      manifest: {
        slides: [{
          position: 3,
          title: "2,500 outlets",
          body: "Trial intent sits at 13,5%",
        }],
        charts: [],
      },
      datasetProfile: buildDatasetProfile(),
      uploadedWorkbookBuffers: [{ fileName: "cocktails.xlsx", buffer: workbook }],
    });

    expect(report.heroPassed).toBe(false);
    expect(report.heroUnbound).toHaveLength(1);
    expect(report.heroUnbound[0]?.rawText).toBe("2,500");
  });

  it("accepts a body percentage classified as derivable by Haiku", async () => {
    const workbook = await buildWorkbookBuffer([
      ["metric", "value"],
      ["buyers", 25],
      ["base", 40],
    ]);

    const report = await validateDataPrimacy({
      client: {
        beta: {
          messages: {
            create: async () => ({
              content: [{ type: "text", text: '["bound-via-derivation"]' }],
            }),
          },
        },
      } as never,
      manifest: {
        slides: [{
          position: 2,
          title: "Survey readout",
          body: "Purchase intent reaches 62.5%",
        }],
        charts: [],
      },
      datasetProfile: buildDatasetProfile(),
      uploadedWorkbookBuffers: [{ fileName: "cocktails.xlsx", buffer: workbook }],
    });

    expect(report.heroPassed).toBe(true);
    expect(report.bodyPassed).toBe(true);
    expect(report.boundClaims).toBe(report.totalNumericClaims);
  });

  it("normalizes Italian percentages against decimal workbook values", async () => {
    const workbook = await buildWorkbookBuffer([
      ["metric", "value"],
      ["trial_rate", 0.135],
    ]);

    const report = await validateDataPrimacy({
      manifest: {
        slides: [{
          position: 1,
          title: "Trial intent 13,5%",
        }],
        charts: [],
      },
      datasetProfile: buildDatasetProfile(),
      uploadedWorkbookBuffers: [{ fileName: "cocktails.xlsx", buffer: workbook }],
    });

    expect(report.heroPassed).toBe(true);
    expect(report.unboundClaims).toHaveLength(0);
  });

  it("handles sparse workbook headers without throwing", async () => {
    const workbook = await buildSparseWorkbookBuffer();

    const report = await validateDataPrimacy({
      manifest: {
        slides: [{
          position: 1,
          title: "100 respondents",
          body: "Trial intent 13,5%",
        }],
        charts: [],
      },
      datasetProfile: buildDatasetProfile(),
      uploadedWorkbookBuffers: [{ fileName: "cocktails.xlsx", buffer: workbook }],
    });

    expect(report.heroPassed).toBe(true);
    expect(report.bodyPassed).toBe(true);
    expect(report.unboundClaims).toHaveLength(0);
  });

  it("falls back to unbound classification when the classifier returns malformed JSON", async () => {
    const workbook = await buildWorkbookBuffer([
      ["metric", "value"],
      ["buyers", 25],
      ["base", 40],
    ]);

    const report = await validateDataPrimacy({
      client: {
        beta: {
          messages: {
            create: async () => ({
              content: [{ type: "text", text: "not json" }],
            }),
          },
        },
      } as never,
      manifest: {
        slides: [{
          position: 2,
          title: "Survey readout",
          body: "Purchase intent reaches 62.5%",
        }],
        charts: [],
      },
      datasetProfile: buildDatasetProfile(),
      uploadedWorkbookBuffers: [{ fileName: "cocktails.xlsx", buffer: workbook }],
    });

    expect(report.heroPassed).toBe(true);
    expect(report.bodyPassed).toBe(false);
    expect(report.unboundClaims).toHaveLength(1);
    expect(report.unboundClaims[0]?.classification).toBe("unbound-invented");
  });

  it("treats an empty deck as passing", async () => {
    const report = await validateDataPrimacy({
      manifest: {
        slides: [],
        charts: [],
      },
      datasetProfile: buildDatasetProfile(),
      uploadedWorkbookBuffers: [],
    });

    expect(report.heroPassed).toBe(true);
    expect(report.bodyPassed).toBe(true);
    expect(report.totalNumericClaims).toBe(0);
  });
});
