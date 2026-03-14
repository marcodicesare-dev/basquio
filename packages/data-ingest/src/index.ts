import { inferSourceFileKind } from "@basquio/core";
import { read, utils } from "xlsx";

import {
  datasetProfileSchema,
  deterministicAnalysisSchema,
  normalizedWorkbookSchema,
  type DatasetProfile,
  type DeterministicAnalysis,
  type NormalizedEvidenceFile,
  type NormalizedWorkbook,
} from "@basquio/types";

type ParseWorkbookInput = {
  datasetId: string;
  fileName: string;
  buffer: Buffer;
};

type ParseEvidenceFileInput = {
  id?: string;
  fileName: string;
  mediaType?: string;
  buffer: Buffer;
  kind?: ReturnType<typeof inferSourceFileKind>;
};

type ParseEvidencePackageInput = {
  datasetId: string;
  files: ParseEvidenceFileInput[];
};

export function parseWorkbookBuffer(input: ParseWorkbookInput): {
  datasetProfile: DatasetProfile;
  normalizedWorkbook: NormalizedWorkbook;
} {
  return parseEvidencePackage({
    datasetId: input.datasetId,
    files: [
      {
        fileName: input.fileName,
        buffer: input.buffer,
      },
    ],
  });
}

export function parseEvidencePackage(input: ParseEvidencePackageInput): {
  datasetProfile: DatasetProfile;
  normalizedWorkbook: NormalizedWorkbook;
} {
  const normalizedFiles = input.files.map((file, index) =>
    parseEvidenceFile({
      ...file,
      id: file.id ?? `${input.datasetId}-file-${index + 1}`,
      kind: file.kind ?? inferSourceFileKind(file.fileName),
    }),
  );

  const workbookFiles = normalizedFiles.filter((file) => file.kind === "workbook");
  const sheets = workbookFiles.flatMap((file) => file.sheets);
  const primaryFile =
    normalizedFiles.find((file) => file.role === "main-fact-table") ??
    workbookFiles[0] ??
    normalizedFiles[0];
  const manifestWarnings = buildManifestWarnings(normalizedFiles, sheets.length);
  const packageLabel =
    normalizedFiles.length > 1
      ? `${primaryFile?.fileName ?? "Evidence package"} + ${normalizedFiles.length - 1} supporting file${normalizedFiles.length === 2 ? "" : "s"}`
      : primaryFile?.fileName ?? "Evidence package";

  const datasetProfile = datasetProfileSchema.parse({
    datasetId: input.datasetId,
    sourceFileName: primaryFile?.fileName ?? "evidence-package",
    sourceFiles: normalizedFiles.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      role: file.role,
      mediaType: file.mediaType,
      kind: file.kind,
      parsedSheetCount: file.sheets.length,
      notes: file.warnings,
    })),
    manifest: {
      datasetId: input.datasetId,
      packageLabel,
      files: normalizedFiles.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        mediaType: file.mediaType,
        kind: file.kind,
        role: file.role,
        parsedSheetCount: file.sheets.length,
        notes: file.warnings,
      })),
      primaryFileId: primaryFile?.id,
      brandFileId: normalizedFiles.find((file) => file.role === "brand-tokens")?.id,
      methodologyFileIds: normalizedFiles
        .filter((file) => file.role === "methodology-guide" || file.role === "definitions-guide")
        .map((file) => file.id),
      validationFileIds: normalizedFiles.filter((file) => file.role === "validation-table").map((file) => file.id),
      citationFileIds: normalizedFiles.filter((file) => file.role === "citations-table").map((file) => file.id),
      warnings: manifestWarnings,
    },
    sheets: sheets.map(({ rows, ...sheet }) => sheet),
    warnings: manifestWarnings,
  });

  const normalizedWorkbook = normalizedWorkbookSchema.parse({
    datasetId: input.datasetId,
    sourceFileName: primaryFile?.fileName ?? "evidence-package",
    files: normalizedFiles,
    sheets,
  });

  return {
    datasetProfile,
    normalizedWorkbook,
  };
}

export function runIngestDeterministicChecks(workbook: NormalizedWorkbook): DeterministicAnalysis {
  const metricSummaries = workbook.sheets.flatMap((sheet) =>
    sheet.columns.map((column) => {
      const numericValues = sheet.rows
        .map((row) => coerceNumber(row[column.name]))
        .filter((value): value is number => value !== null);

      return {
        sourceFileId: sheet.sourceFileId,
        fileName: sheet.sourceFileName,
        fileRole: sheet.sourceRole,
        sheet: sheet.name,
        column: column.name,
        rowCount: sheet.rowCount,
        numericCount: numericValues.length,
        distinctCount: new Set(sheet.rows.map((row) => String(row[column.name] ?? ""))).size,
        sum: numericValues.length > 0 ? numericValues.reduce((total, value) => total + value, 0) : null,
        average:
          numericValues.length > 0
            ? numericValues.reduce((total, value) => total + value, 0) / numericValues.length
            : null,
        min: numericValues.length > 0 ? Math.min(...numericValues) : null,
        max: numericValues.length > 0 ? Math.max(...numericValues) : null,
      };
    }),
  );

  return deterministicAnalysisSchema.parse({
    datasetId: workbook.datasetId,
    metricSummaries,
    highlights: metricSummaries
      .filter((summary) => summary.numericCount > 0)
      .slice(0, 3)
      .map(
        (summary) =>
          `${summary.fileName || "Workbook"} · ${summary.sheet}.${summary.column} has ${summary.numericCount} numeric rows ready for deterministic analytics.`,
      ),
    warnings:
      metricSummaries.filter((summary) => summary.numericCount > 0).length === 0
        ? ["No numeric columns were detected during ingest checks."]
        : [],
  });
}

function parseEvidenceFile(
  input: {
    id: string;
    fileName: string;
    mediaType?: string;
    buffer: Buffer;
    kind: ReturnType<typeof inferSourceFileKind>;
  },
): NormalizedEvidenceFile {
  const role = inferFileRole(input.fileName, input.kind);

  if (input.kind === "workbook") {
    const workbook = read(resolveWorkbookSource(input.fileName, input.buffer), {
      type: input.fileName.toLowerCase().endsWith(".csv") ? "string" : "buffer",
      cellDates: true,
      raw: false,
    });

    const sheets = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const matrix = utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: true,
      }) as unknown[][];

      const [headerRow = [], ...bodyRows] = matrix;
      const headers = (headerRow.length > 0 ? headerRow : ["column_1"]).map((value, index) =>
        normalizeHeader(value, index),
      );

      const rows = bodyRows
        .filter((row) => row.some((value) => value !== null && value !== ""))
        .map((row) => Object.fromEntries(headers.map((header, index) => [header, normalizeCell(row[index])])));

      const columns = headers.map((header) => inferColumn(rows, header));

      return {
        name: workbook.SheetNames.length > 1 ? `${input.fileName} · ${sheetName}` : input.fileName,
        rowCount: rows.length,
        sourceFileId: input.id,
        sourceFileName: input.fileName,
        sourceRole: role,
        columns,
        rows,
      };
    }).filter((sheet) => sheet.rowCount > 0 || sheet.columns.length > 0);

    const warnings = sheets.length === 0 ? [`${input.fileName} did not expose any readable tabular sheets.`] : [];

    return {
      id: input.id,
      fileName: input.fileName,
      mediaType: input.mediaType ?? "application/octet-stream",
      kind: input.kind,
      role,
      sheets,
      warnings,
    };
  }

  const warnings = buildSupportFileWarnings(input.fileName, input.kind, role);

  return {
    id: input.id,
    fileName: input.fileName,
    mediaType: input.mediaType ?? "application/octet-stream",
    kind: input.kind,
    role,
    sheets: [],
    textContent: canDecodeAsText(input.fileName, input.kind) ? input.buffer.toString("utf8") : undefined,
    warnings,
  };
}

function buildManifestWarnings(files: NormalizedEvidenceFile[], sheetCount: number) {
  const warnings: string[] = [];

  if (sheetCount === 0) {
    warnings.push("The evidence package did not produce any readable tabular sheets.");
  }

  if (!files.some((file) => file.role === "main-fact-table")) {
    warnings.push("No file was confidently classified as the main fact table; Basquio is using the first workbook as the primary source.");
  }

  if (!files.some((file) => file.role === "methodology-guide" || file.role === "definitions-guide")) {
    warnings.push("No methodology or definitions guide was provided; methodology framing will rely on the uploaded brief and inferred package roles.");
  }

  return warnings;
}

function buildSupportFileWarnings(
  fileName: string,
  kind: ReturnType<typeof inferSourceFileKind>,
  role: ReturnType<typeof inferFileRole>,
) {
  const warnings: string[] = [];

  if (kind === "document" && !canDecodeAsText(fileName, kind)) {
    warnings.push(`${fileName} was retained in the package manifest but is not yet parsed into structured support text.`);
  }

  if (role === "style-reference-pdf") {
    warnings.push(`${fileName} is treated as a style reference only in v1.`);
  }

  return warnings;
}

function inferFileRole(fileName: string, kind: ReturnType<typeof inferSourceFileKind>) {
  const normalized = fileName.toLowerCase();

  if (kind === "brand-tokens") {
    return "brand-tokens" as const;
  }

  if (kind === "pptx") {
    return "template-pptx" as const;
  }

  if (kind === "pdf") {
    return "style-reference-pdf" as const;
  }

  if (normalized.includes("citation")) {
    return "citations-table" as const;
  }

  if (
    normalized.includes("validation") ||
    normalized.includes("browser-validation") ||
    normalized.includes("disagreement") ||
    normalized.includes("qa")
  ) {
    return "validation-table" as const;
  }

  if (normalized.includes("definition") || normalized.includes("glossary")) {
    return "definitions-guide" as const;
  }

  if (normalized.includes("method") || normalized.includes("guide")) {
    return "methodology-guide" as const;
  }

  if (normalized.includes("query") || normalized.includes("fanout")) {
    return "query-log" as const;
  }

  if (normalized.includes("response") || normalized.includes("conversation")) {
    return "response-log" as const;
  }

  if (normalized.includes("overview") || normalized.includes("summary") || normalized.includes("matrix")) {
    return "overview-table" as const;
  }

  if (
    normalized.includes("main") ||
    normalized.includes("fact") ||
    normalized.includes("core") ||
    normalized.includes("performance") ||
    normalized.includes("sales")
  ) {
    return "main-fact-table" as const;
  }

  if (kind === "workbook") {
    return "supporting-fact-table" as const;
  }

  return "unknown-support" as const;
}

function resolveWorkbookSource(fileName: string, buffer: Buffer) {
  return fileName.toLowerCase().endsWith(".csv") ? buffer.toString("utf8") : buffer;
}

function canDecodeAsText(fileName: string, kind: ReturnType<typeof inferSourceFileKind>) {
  return (
    kind === "brand-tokens" ||
    fileName.toLowerCase().endsWith(".txt") ||
    fileName.toLowerCase().endsWith(".md") ||
    fileName.toLowerCase().endsWith(".json") ||
    fileName.toLowerCase().endsWith(".css")
  );
}

function normalizeHeader(value: unknown, index: number) {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return raw.length > 0 ? raw : `column_${index + 1}`;
}

function normalizeCell(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return value ?? null;
}

function inferColumn(rows: Array<Record<string, unknown>>, name: string) {
  const values = rows.map((row) => row[name]).filter((value) => value !== null && value !== "");
  const inferredType = inferType(values);

  return {
    name,
    inferredType,
    role: inferRole(name, inferredType),
    nullable: values.length !== rows.length,
  } as const;
}

function inferType(values: unknown[]) {
  if (values.length === 0) {
    return "unknown" as const;
  }

  if (values.every((value) => typeof value === "number")) {
    return "number" as const;
  }

  if (
    values.every(
      (value) =>
        typeof value === "string" &&
        !Number.isNaN(Date.parse(value)) &&
        /[-/]/.test(value),
    )
  ) {
    return "date" as const;
  }

  if (values.every((value) => typeof value === "boolean")) {
    return "boolean" as const;
  }

  return "string" as const;
}

function inferRole(columnName: string, inferredType: string) {
  const normalizedName = columnName.toLowerCase();

  if (inferredType === "date" || normalizedName.includes("date") || normalizedName.includes("month")) {
    return "time" as const;
  }

  if (
    normalizedName === "id" ||
    normalizedName.endsWith("_id") ||
    normalizedName.includes("identifier") ||
    normalizedName.endsWith("_key")
  ) {
    return "identifier" as const;
  }

  if (
    normalizedName.includes("segment") ||
    normalizedName.includes("region") ||
    normalizedName.includes("channel")
  ) {
    return "segment" as const;
  }

  if (inferredType === "number") {
    return "measure" as const;
  }

  if (inferredType === "string") {
    return "dimension" as const;
  }

  return "unknown" as const;
}

function coerceNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
