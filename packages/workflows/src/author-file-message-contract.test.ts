import { describe, expect, it } from "vitest";

import {
  buildEvidenceAvailabilityGateLines,
  buildRequiredAuthorOutputFiles,
  buildTextFirstAuthorContent,
  hasEvidenceAvailabilityFailureText,
  type AuthorInputFilesForMessage,
} from "./author-file-message-contract";

const files: AuthorInputFilesForMessage = {
  uploadedEvidence: [
    { id: "file_workbook", filename: "Estrazione SP Segafredo.xlsx" },
  ],
  uploadedSupportPackets: [
    { id: "file_support", filename: "workspace-context.md" },
  ],
  uploadedTemplate: { id: "file_template", filename: "Template 2026.pptx" },
};

describe("author file message contract", () => {
  it("puts the instruction text before container_upload blocks", () => {
    const content = buildTextFirstAuthorContent({
      text: "Analyze the uploaded evidence.",
      files,
    });

    expect(content[0]).toEqual({ type: "text", text: "Analyze the uploaded evidence." });
    expect(content.slice(1)).toEqual([
      { type: "container_upload", file_id: "file_workbook" },
      { type: "container_upload", file_id: "file_support" },
      { type: "container_upload", file_id: "file_template" },
    ]);
  });

  it("requires tabular evidence to be found and opened before analysis", () => {
    const lines = buildEvidenceAvailabilityGateLines({
      files,
      evidenceMode: { hasTabularData: true, hasDocumentEvidence: false },
    }).join("\n");

    expect(lines).toContain("Required evidence filenames: Estrazione SP Segafredo.xlsx.");
    expect(lines).toContain("opened with pandas or openpyxl");
    expect(lines).toContain("Do not infer from the brief");
    expect(lines).toContain("evidence_availability_error.json");
  });

  it("classifies missing workbook self-reports as evidence availability failures", () => {
    expect(hasEvidenceAvailabilityFailureText({
      expectedEvidenceFileNames: ["Estrazione SP Segafredo.xlsx"],
      text: "The Excel file (`Estrazione SP Segafredo.xlsx`) is not present in the container. I will work with what's available.",
    })).toBe(true);
  });

  it("does not classify unrelated parser text as evidence availability failure", () => {
    expect(hasEvidenceAvailabilityFailureText({
      expectedEvidenceFileNames: ["Estrazione SP Segafredo.xlsx"],
      text: "analysis_result.json is malformed and could not be repaired.",
    })).toBe(false);
  });

  it("requires analysis_result.json for merged full-deck author runs", () => {
    expect(buildRequiredAuthorOutputFiles({
      isReportOnly: false,
      requiresAnalysisResult: true,
    })).toEqual([
      "analysis_result.json",
      "deck.pptx",
      "narrative_report.md",
      "data_tables.xlsx",
      "deck_manifest.json",
    ]);
  });

  it("does not require analysis_result.json for report-only output", () => {
    expect(buildRequiredAuthorOutputFiles({
      isReportOnly: true,
      requiresAnalysisResult: true,
    })).toEqual([
      "narrative_report.md",
      "data_tables.xlsx",
      "deck_manifest.json",
    ]);
  });
});
