export type AuthorInputFileRef = {
  id: string;
  filename: string;
};

export type AuthorInputFilesForMessage = {
  uploadedEvidence: AuthorInputFileRef[];
  uploadedSupportPackets: AuthorInputFileRef[];
  uploadedTemplate: AuthorInputFileRef | null;
};

export type AuthorMessageContentBlock =
  | { type: "text"; text: string }
  | { type: "container_upload"; file_id: string };

export type EvidenceModeForMessage = {
  hasTabularData: boolean;
  hasDocumentEvidence: boolean;
};

export function buildRequiredAuthorOutputFiles(input: {
  isReportOnly: boolean;
  requiresAnalysisResult: boolean;
}): string[] {
  if (input.isReportOnly) {
    return ["narrative_report.md", "data_tables.xlsx", "deck_manifest.json"];
  }

  return [
    ...(input.requiresAnalysisResult ? ["analysis_result.json"] : []),
    "deck.pptx",
    "narrative_report.md",
    "data_tables.xlsx",
    "deck_manifest.json",
  ];
}

export function buildUploadedFileContentBlocks(
  files?: AuthorInputFilesForMessage,
): AuthorMessageContentBlock[] {
  return [
    ...(files?.uploadedEvidence.map((file) => ({ type: "container_upload" as const, file_id: file.id })) ?? []),
    ...(files?.uploadedSupportPackets.map((file) => ({ type: "container_upload" as const, file_id: file.id })) ?? []),
    ...(files?.uploadedTemplate ? [{ type: "container_upload" as const, file_id: files.uploadedTemplate.id }] : []),
  ];
}

export function buildTextFirstAuthorContent(input: {
  text: string;
  files?: AuthorInputFilesForMessage;
}): AuthorMessageContentBlock[] {
  return [
    { type: "text", text: input.text },
    ...buildUploadedFileContentBlocks(input.files),
  ];
}

export function buildAuthorFileInventoryLines(files?: AuthorInputFilesForMessage): string[] {
  if (!files) {
    return [
      "UPLOADED FILE INVENTORY:",
      "- This request reuses an existing container. Reconfirm evidence files on disk before analysis.",
    ];
  }

  return [
    "UPLOADED FILE INVENTORY:",
    files.uploadedEvidence.length > 0
      ? `- Required evidence files: ${files.uploadedEvidence.map(formatFileRef).join("; ")}.`
      : "- Required evidence files: none uploaded.",
    files.uploadedSupportPackets.length > 0
      ? `- Normalized support packets: ${files.uploadedSupportPackets.map(formatFileRef).join("; ")}.`
      : "- Normalized support packets: none uploaded.",
    files.uploadedTemplate
      ? `- Client template file: ${formatFileRef(files.uploadedTemplate)}.`
      : "- Client template file: none uploaded.",
  ];
}

export function buildEvidenceAvailabilityGateLines(input: {
  files?: AuthorInputFilesForMessage;
  evidenceMode: EvidenceModeForMessage;
}): string[] {
  const evidenceFiles = input.files?.uploadedEvidence ?? [];
  const requiredTabularFiles = evidenceFiles.filter((file) => isTabularEvidenceFileName(file.filename));
  const requiredEvidenceNames = evidenceFiles.map((file) => file.filename);
  const requiredTabularNames = requiredTabularFiles.map((file) => file.filename);

  const requiredList = input.evidenceMode.hasTabularData
    ? (requiredTabularNames.length > 0 ? requiredTabularNames : requiredEvidenceNames)
    : requiredEvidenceNames;

  return [
    "MANDATORY EVIDENCE AVAILABILITY GATE:",
    "- Before analysis, run code execution to list the container working directory and locate every required evidence file by exact filename or unique basename.",
    requiredList.length > 0
      ? `- Required evidence filenames: ${requiredList.join("; ")}.`
      : "- Required evidence filenames: none were uploaded. If the brief expects data, stop and report missing evidence.",
    input.evidenceMode.hasTabularData
      ? "- At least one uploaded Excel or CSV evidence file must be found and opened with pandas or openpyxl before writing any analytical claim."
      : "- Open the uploaded evidence or normalized support packet before writing any analytical claim.",
    "- For each required Excel or CSV file, print the discovered path, sheet names, and shape of the first relevant table. Keep output compact.",
    "- If any required tabular evidence file is missing or cannot be opened, stop immediately. Do not infer from the brief, template, filename, or prior run memory.",
    "- On missing required evidence, do not create deck.pptx, narrative_report.md, data_tables.xlsx, or deck_manifest.json. Attach only evidence_availability_error.json with missingFiles, discoveredFiles, and reason.",
  ];
}

export function hasEvidenceAvailabilityFailureText(input: {
  text: string;
  expectedEvidenceFileNames: string[];
}): boolean {
  if (input.expectedEvidenceFileNames.length === 0) {
    return false;
  }

  const normalized = input.text.toLowerCase();
  const mentionsMissingEvidence =
    normalized.includes("missing from the container") ||
    normalized.includes("not present in the container") ||
    normalized.includes("appears to be missing") ||
    normalized.includes("cannot find the uploaded") ||
    normalized.includes("could not find the uploaded") ||
    normalized.includes("work with what's available") ||
    normalized.includes("working with what's available") ||
    normalized.includes("infer from the brief") ||
    normalized.includes("generate the analysis from the context");

  if (!mentionsMissingEvidence) {
    return false;
  }

  const expectedBasenames = input.expectedEvidenceFileNames.map((name) => name.toLowerCase());
  return expectedBasenames.some((name) => normalized.includes(name)) ||
    normalized.includes("excel file") ||
    normalized.includes("workbook") ||
    normalized.includes("spreadsheet");
}

function formatFileRef(file: AuthorInputFileRef): string {
  return `${file.filename} (file id ${file.id})`;
}

function isTabularEvidenceFileName(fileName: string): boolean {
  return /\.(csv|tsv|xlsx|xls|xlsm)$/i.test(fileName);
}
