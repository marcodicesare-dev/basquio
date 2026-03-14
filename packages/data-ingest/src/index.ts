import mammoth from "mammoth";
import { inferSourceFileKind } from "@basquio/core";
import { read, utils } from "xlsx";

import {
  analyticsResultSchema,
  datasetProfileSchema,
  normalizedWorkbookSchema,
  type AnalyticsResult,
  type DatasetProfile,
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

export async function parseWorkbookBuffer(input: ParseWorkbookInput): Promise<{
  datasetProfile: DatasetProfile;
  normalizedWorkbook: NormalizedWorkbook;
}> {
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

export async function parseEvidencePackage(input: ParseEvidencePackageInput): Promise<{
  datasetProfile: DatasetProfile;
  normalizedWorkbook: NormalizedWorkbook;
}> {
  const normalizedFiles = await Promise.all(
    input.files.map((file, index) =>
      parseEvidenceFile({
        ...file,
        id: file.id ?? `${input.datasetId}-file-${index + 1}`,
        kind: file.kind ?? inferSourceFileKind(file.fileName),
      }),
    ),
  );

  const workbookFiles = normalizedFiles.filter((file) => file.kind === "workbook");
  const sheets = workbookFiles.flatMap((file) => file.sheets);
  const primaryFile =
    normalizedFiles.find((file) => file.role === "main-fact-table") ??
    normalizedFiles.find((file) => file.role === "response-log") ??
    normalizedFiles.find((file) => file.role === "query-log") ??
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

export function runIngestDeterministicChecks(workbook: NormalizedWorkbook): AnalyticsResult {
  const evidenceRefs = workbook.sheets.flatMap((sheet) =>
    sheet.columns
      .filter((column) => column.role === "measure")
      .map((column, index) => ({
        id: `${sheet.sourceFileId || sheet.sourceFileName}-${sheet.name}-${column.name}-${index}`.replace(/[^a-zA-Z0-9-_]/g, "-"),
        sourceFileId: sheet.sourceFileId,
        fileName: sheet.sourceFileName,
        fileRole: sheet.sourceRole,
        sheet: sheet.name,
        metric: column.name,
        summary: `${column.name} has ${column.sampleValues.length} representative sample values across ${sheet.rowCount} rows.`,
        confidence: 0.5,
        sourceLocation: `${sheet.name}.${column.name}`,
        rawValue: column.sampleValues[0] ?? null,
      })),
  );

  return analyticsResultSchema.parse({
    metrics: [],
    correlations: [],
    rankings: [],
    deltas: [],
    distributions: [],
    outliers: [],
    segmentBreakdowns: [],
    derivedTables: [],
    evidenceRefs,
  });
}

async function parseEvidenceFile(
  input: {
    id: string;
    fileName: string;
    mediaType?: string;
    buffer: Buffer;
    kind: ReturnType<typeof inferSourceFileKind>;
  },
): Promise<NormalizedEvidenceFile> {
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
        .map((row) => Object.fromEntries(headers.map((header, index) => [header, normalizeCell(row[index])])))
        .filter((row) => Object.values(row).some((value) => value !== null && value !== ""));

      const columns = headers.map((header) => inferColumn(rows, header));

      return {
        name: workbook.SheetNames.length > 1 ? `${input.fileName} · ${sheetName}` : input.fileName,
        rowCount: rows.length,
        sourceFileId: input.id,
        sourceFileName: input.fileName,
        sourceRole: role,
        columns,
        sampleRows: sampleRows(rows, 20),
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

  const textContent = await extractSupportText(input.fileName, input.kind, input.buffer);
  const warnings = buildSupportFileWarnings(input.fileName, input.kind, role, textContent);

  return {
    id: input.id,
    fileName: input.fileName,
    mediaType: input.mediaType ?? "application/octet-stream",
    kind: input.kind,
    role,
    sheets: [],
    textContent,
    warnings,
  };
}

async function extractSupportText(
  fileName: string,
  kind: ReturnType<typeof inferSourceFileKind>,
  buffer: Buffer,
) {
  if (kind !== "document" && kind !== "brand-tokens") {
    return undefined;
  }

  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".docx")) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim();
    } catch {
      return undefined;
    }
  }

  if (canDecodeAsText(fileName, kind)) {
    return buffer.toString("utf8");
  }

  return undefined;
}

function buildManifestWarnings(files: NormalizedEvidenceFile[], sheetCount: number) {
  const warnings: string[] = [];

  if (sheetCount === 0) {
    warnings.push("The evidence package did not produce any readable tabular sheets.");
  }

  if (!files.some((file) => file.role === "main-fact-table" || file.role === "response-log")) {
    warnings.push("No file was confidently classified as the main analytical table; Basquio is using the first workbook as the primary source.");
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
  textContent?: string,
) {
  const warnings: string[] = [];

  if (kind === "document" && !textContent) {
    warnings.push(`${fileName} was retained in the package manifest but could not be parsed into support text.`);
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
  const values = rows.map((row) => row[name]);
  const nonNullValues = values.filter((value) => value !== null && value !== "");
  const inferredType = inferType(nonNullValues);

  return {
    name,
    inferredType,
    role: inferRole(name, inferredType),
    nullable: nonNullValues.length !== rows.length,
    sampleValues: sampleValues(nonNullValues, 10).map((value) => String(value)),
    uniqueCount: new Set(nonNullValues.map((value) => String(value))).size,
    nullRate: rows.length === 0 ? 0 : (rows.length - nonNullValues.length) / rows.length,
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
    normalizedName.includes("channel") ||
    normalizedName.includes("platform") ||
    normalizedName.includes("category")
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

function sampleRows(rows: Array<Record<string, unknown>>, limit: number) {
  if (rows.length <= limit) {
    return rows;
  }

  const lastIndex = rows.length - 1;
  const indexes = new Set<number>([0, lastIndex]);

  while (indexes.size < limit) {
    const ratio = indexes.size / (limit - 1);
    indexes.add(Math.min(lastIndex, Math.round(ratio * lastIndex)));
  }

  return [...indexes]
    .sort((left, right) => left - right)
    .map((index) => rows[index]);
}

function sampleValues(values: unknown[], limit: number) {
  if (values.length <= limit) {
    return values;
  }

  return values.slice(0, limit);
}
