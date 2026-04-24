import { describe, expect, it } from "vitest";

import type Anthropic from "@anthropic-ai/sdk";
import type { DatasetProfile } from "@basquio/types";

import { runBriefDataReconciliation } from "./brief-data-reconciliation";

function buildDatasetProfile(label: string): DatasetProfile {
  return {
    datasetId: "ds-1",
    sourceFileName: `${label}.xlsx`,
    sourceFiles: [
      {
        id: "sf-1",
        fileName: `${label}.xlsx`,
        role: "main-fact-table",
        mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        kind: "workbook",
        parsedSheetCount: 1,
        notes: [],
      },
    ],
    manifest: {
      datasetId: "ds-1",
      packageLabel: label,
      files: [],
      methodologyFileIds: [],
      validationFileIds: [],
      citationFileIds: [],
      warnings: [],
    },
    sheets: [
      {
        name: label,
        rowCount: 12,
        sourceFileId: "sf-1",
        sourceFileName: `${label}.xlsx`,
        sourceRole: "main-fact-table",
        columns: [
          {
            name: "Metric",
            inferredType: "string",
            role: "dimension",
            nullable: false,
            sampleValues: ["Trial intent", "Repeat intent"],
            uniqueCount: 2,
            uniqueCountApproximate: false,
            nullRate: 0,
          },
          {
            name: "Value",
            inferredType: "number",
            role: "measure",
            nullable: false,
            sampleValues: ["0.42", "0.31"],
            uniqueCount: 2,
            uniqueCountApproximate: false,
            nullRate: 0,
          },
        ],
        sampleRows: [
          { Metric: "Trial intent", Value: 0.42 },
          { Metric: "Repeat intent", Value: 0.31 },
        ],
      },
    ],
    warnings: [],
  };
}

function buildClient(responseText: string) {
  return {
    beta: {
      messages: {
        create: async () =>
          ({
            content: [{ type: "text", text: responseText }],
          }) as Anthropic.Beta.BetaMessage,
      },
    },
  } as unknown as Anthropic;
}

describe("runBriefDataReconciliation", () => {
  it("parses fully answerable output", async () => {
    const result = await runBriefDataReconciliation({
      client: buildClient(JSON.stringify({
        answerable: "fully",
        uploadedDataFrame: "The dataset measures retail sales, price, and promo across channels.",
        briefImpliesFrame: "The brief asks for a scanner-data growth and promo diagnosis.",
        scopeAdjustment: null,
      })),
      brief: {
        objective: "Explain coffee growth drivers",
        businessContext: "Use scanner data to explain growth and promo dynamics.",
        audience: "Segafredo leadership",
      },
      datasetProfile: buildDatasetProfile("segafredo"),
    });

    expect(result.answerable).toBe("fully");
    expect(result.scopeAdjustment).toBeNull();
  });

  it("parses partial output", async () => {
    const result = await runBriefDataReconciliation({
      client: buildClient(JSON.stringify({
        answerable: "partial",
        uploadedDataFrame: "The dataset measures household purchase intent and basic segment cuts.",
        briefImpliesFrame: "The brief asks for market sizing, competitor shares, and consumer demand.",
        scopeAdjustment: "The uploaded data captures consumer intent, not market size or competitor shares. Use the deck to quantify intent, segment the likely adopters, and state clearly that market sizing is out of scope. Put that limitation in the executive summary and in the narrative report. Cut any slide that would require invented market values.",
      })),
      brief: {
        objective: "Explain RTD growth and size the market",
        businessContext: "The team wants growth, market size, and consumer demand.",
        audience: "Leadership",
      },
      datasetProfile: buildDatasetProfile("survey"),
    });

    expect(result.answerable).toBe("partial");
    expect(result.scopeAdjustment).toContain("executive summary");
  });

  it("parses mismatch output wrapped in markdown fences", async () => {
    const result = await runBriefDataReconciliation({
      client: buildClient([
        "```json",
        JSON.stringify({
          answerable: "mismatch",
          uploadedDataFrame: "The dataset measures trial intent among Italian respondents for cocktails on tap.",
          briefImpliesFrame: "The brief asks for an EMEA RTD market-sizing and competitor story.",
          scopeAdjustment: "The uploaded file is a consumer trial-intent survey, not a market-sizing or competitor-share dataset. Use the deck to explain who is willing to try cocktails on tap, how intent varies across the survey cuts, and what the evidence does not support. State in the executive summary and narrative report that the upload does not contain sales, pricing, geography, or competitor-share data. Remove any slide that would require invented market values or external estimates presented as core evidence.",
        }),
        "```",
      ].join("\n")),
      brief: {
        objective: "Explain RTD market trends",
        businessContext: "Trend emergenti per produttori italiani di alcolici.",
        audience: "Branca leadership team",
      },
      datasetProfile: buildDatasetProfile("rossella"),
    });

    expect(result.answerable).toBe("mismatch");
    expect(result.uploadedDataFrame).toContain("trial intent");
    expect(result.scopeAdjustment).toContain("does not contain");
  });
});
