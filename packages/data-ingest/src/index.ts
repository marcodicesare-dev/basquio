import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";

import { parse as csvParse } from "csv-parse";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { inferSourceFileKind } from "@basquio/core";
import { read, utils } from "xlsx";

import {
  analyticsResultSchema,
  type AnalyticsResult,
  type DatasetProfile,
  type NormalizedEvidenceFile,
  type NormalizedSheet,
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
  const parsedFiles = await Promise.all(
    input.files.map((file, index) =>
      parseEvidenceFile({
        ...file,
        id: file.id ?? `${input.datasetId}-file-${index + 1}`,
        kind: file.kind ?? inferSourceFileKind(file.fileName),
      }),
    ),
  );

  const normalizedFiles = parsedFiles.map(({ workbookSheets, ...file }) => file);
  const workbookFiles = parsedFiles.filter((file) => file.kind === "workbook");
  const sheets = workbookFiles.flatMap((file) => file.workbookSheets ?? []);
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

  const datasetProfile: DatasetProfile = {
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
  };

  const normalizedWorkbook: NormalizedWorkbook = {
    datasetId: input.datasetId,
    sourceFileName: primaryFile?.fileName ?? "evidence-package",
    files: normalizedFiles,
    sheets,
  };

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
): Promise<NormalizedEvidenceFile & { workbookSheets?: NormalizedSheet[] }> {
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

      const headerIndex = detectHeaderRowIndex(matrix);
      const headerRow = matrix[headerIndex] ?? [];
      const bodyRows = matrix.slice(headerIndex + 1);
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
      sheets: sheets.map(({ rows, ...sheet }) => sheet),
      workbookSheets: sheets,
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
      const result = await mammoth.convertToHtml({ buffer });
      // Extract text from HTML, preserving table structure as markdown
      const html = result.value;
      // Strip tags but preserve table separators
      const text = html
        .replace(/<\/tr>/gi, "\n")
        .replace(/<\/td>/gi, " | ")
        .replace(/<\/th>/gi, " | ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .trim();
      return text || undefined;
    } catch {
      return undefined;
    }
  }

  if (normalized.endsWith(".doc")) {
    // Legacy .doc format — mammoth does not support it.
    // Return a warning instead of silently failing.
    return `[Basquio warning: .doc format not supported. Please convert "${fileName}" to .docx for full text extraction.]`;
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
    if (trimmed.length === 0) {
      return null;
    }

    const parsedNumber = parseNumericString(trimmed);
    return parsedNumber ?? trimmed;
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
    normalizedName.endsWith("_key") ||
    normalizedName.includes("upc") ||
    normalizedName.includes("item code") ||
    normalizedName.includes("sku") ||
    normalizedName.includes("ean")
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
  return Array.from({ length: limit }, (_, index) => {
    if (index === limit - 1) {
      return rows[lastIndex];
    }

    const sampledIndex = Math.floor((index * rows.length) / limit);
    return rows[Math.min(lastIndex, sampledIndex)];
  });
}

function sampleValues(values: unknown[], limit: number) {
  if (values.length <= limit) {
    return values;
  }

  return values.slice(0, limit);
}

function detectHeaderRowIndex(matrix: unknown[][]) {
  const lookahead = matrix.slice(0, 25);
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [index, row] of lookahead.entries()) {
    const score = scoreHeaderCandidate(row, lookahead[index + 1]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function scoreHeaderCandidate(row: unknown[], nextRow?: unknown[]) {
  const cells = row.map((value) => String(value ?? "").trim()).filter(Boolean);
  const nonEmptyCount = cells.length;

  if (nonEmptyCount === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const textLikeCount = cells.filter((cell) => parseNumericString(cell) === null).length;
  const nextRowNonEmptyCount = (nextRow ?? []).filter((value) => String(value ?? "").trim().length > 0).length;

  return (
    nonEmptyCount * 10 +
    textLikeCount * 2 +
    (nonEmptyCount >= 2 ? 5 : -20) +
    (nextRowNonEmptyCount >= Math.max(2, Math.floor(nonEmptyCount * 0.6)) ? 8 : 0)
  );
}

function parseNumericString(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalizedNa = trimmed.toLowerCase();
  if (normalizedNa === "na" || normalizedNa === "n/a" || normalizedNa === "null") {
    return null;
  }

  let candidate = trimmed
    .replace(/[€$£¥%]/g, "")
    .replace(/\s+/g, "")
    .replace(/[’']/g, "");

  if (!/[0-9]/.test(candidate)) {
    return null;
  }

  const lastComma = candidate.lastIndexOf(",");
  const lastDot = candidate.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      candidate = candidate.replaceAll(".", "").replace(",", ".");
    } else {
      candidate = candidate.replaceAll(",", "");
    }
  } else if (lastComma >= 0) {
    const decimalDigits = candidate.length - lastComma - 1;
    candidate = decimalDigits > 0 && decimalDigits <= 2
      ? candidate.replace(",", ".")
      : candidate.replaceAll(",", "");
  }

  if (!/^-?\d+(\.\d+)?$/.test(candidate)) {
    return null;
  }

  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

// ─── STREAMING PARSE + BLOB GENERATION ─────────────────────────────
// New architecture: parse files in a streaming fashion, write rows to
// jsonl.gz blobs, return only manifests + samples + column profiles.
// Full row data never lives in memory or Postgres — it's in Storage.

export type SheetManifest = {
  sheetKey: string;
  sheetName: string;
  sourceFileId: string;
  sourceFileName: string;
  sourceRole: string;
  rowCount: number;
  columnCount: number;
  columns: Array<{
    name: string;
    inferredType: "string" | "number" | "date" | "boolean" | "unknown";
    role: "dimension" | "measure" | "time" | "segment" | "identifier" | "unknown";
    nullable: boolean;
    sampleValues: string[];
    uniqueCount: number;
    uniqueCountApproximate?: boolean;
    nullRate: number;
  }>;
  sampleRows: Record<string, unknown>[];
  columnProfile: Record<string, ColumnProfile>;
  blobBuffer: Buffer; // gzipped jsonl — caller uploads to Storage
};

export type ColumnProfile = {
  min?: number | string;
  max?: number | string;
  mean?: number;
  nullCount: number;
  distinctCount: number;
  distinctApproximate?: boolean; // true when distinct tracking was capped (>1000 unique values)
  topValues: Array<{ value: string; count: number }>;
};

/**
 * Parse a workbook file (CSV/XLSX/XLS) and return per-sheet manifests
 * with gzipped JSONL blob buffers. No full row arrays in memory after
 * streaming completes — only samples and profiles are retained.
 */
export async function streamParseFile(input: {
  id: string;
  fileName: string;
  buffer: Buffer;
  kind: string;
}): Promise<{ sheets: SheetManifest[]; role: string }> {
  const role = inferFileRole(input.fileName, input.kind as ReturnType<typeof inferSourceFileKind>);
  const ext = input.fileName.toLowerCase();

  if (ext.endsWith(".csv")) {
    const sheet = await streamParseCsv(input.id, input.fileName, role, input.buffer);
    return { sheets: [sheet], role };
  }

  if (ext.endsWith(".xlsx")) {
    const sheets = await streamParseXlsx(input.id, input.fileName, role, input.buffer);
    return { sheets, role };
  }

  // XLS fallback: use SheetJS (no streaming support for .xls)
  if (ext.endsWith(".xls")) {
    const sheets = parseXlsBuffered(input.id, input.fileName, role, input.buffer);
    return { sheets, role };
  }

  return { sheets: [], role };
}

async function streamParseCsv(
  fileId: string,
  fileName: string,
  role: string,
  buffer: Buffer,
): Promise<SheetManifest> {
  const sheetName = fileName;
  const sheetKey = `${fileId}:${sheetName}`;

  // True streaming: rows flow through gzip transform, never all in memory.
  // We keep only: head sample (40), reservoir sample (200), tail sample (20),
  // and per-column running stats for profiling.
  const headSample: Record<string, unknown>[] = [];
  const reservoirSample: Record<string, unknown>[] = [];
  const tailBuffer: Record<string, unknown>[] = []; // ring buffer, last 20
  let rowCount = 0;
  let headers: string[] | null = null;

  // Running column stats (single-pass)
  const colStats = new Map<string, StreamingColumnStats>();

  // Gzip transform: rows are written here and compressed incrementally
  const gzipChunks: Buffer[] = [];
  const gzip = createGzip({ level: 6 });
  gzip.on("data", (chunk: Buffer) => gzipChunks.push(chunk));
  const gzipDone = new Promise<void>((resolve, reject) => {
    gzip.on("finish", resolve);
    gzip.on("error", reject);
  });

  const parser = csvParse({
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  const readable = Readable.from(buffer);

  await new Promise<void>((resolve, reject) => {
    readable
      .pipe(parser)
      .on("data", (record: Record<string, string>) => {
        const normalized = Object.fromEntries(
          Object.entries(record).map(([k, v]) => [k, normalizeCell(v)]),
        );

        if (!headers) headers = Object.keys(normalized);

        // Write to gzip stream (no accumulation)
        gzip.write(JSON.stringify(normalized) + "\n");

        // Sampling: head 40, reservoir 200, tail 20
        if (headSample.length < 40) {
          headSample.push(normalized);
        } else {
          // Reservoir sampling for middle rows
          if (reservoirSample.length < 200) {
            reservoirSample.push(normalized);
          } else {
            const j = Math.floor(Math.random() * (rowCount + 1));
            if (j < 200) reservoirSample[j] = normalized;
          }
        }

        // Tail ring buffer
        tailBuffer[rowCount % 20] = normalized;

        // Update running column stats
        updateColumnStats(colStats, normalized);
        rowCount++;
      })
      .on("end", () => {
        gzip.end();
        resolve();
      })
      .on("error", reject);
  });

  await gzipDone;

  const finalHeaders = headers ?? [];
  const columns = finalHeaders.map((h) => buildColumnFromStats(h, colStats.get(h), rowCount));
  const columnProfile = buildProfileFromStats(colStats, rowCount);

  // Assemble sample: head + reservoir + tail (deduplicated)
  const tail = rowCount <= 40
    ? []
    : Array.from({ length: Math.min(20, rowCount - 40) }, (_, i) =>
        tailBuffer[(rowCount - Math.min(20, rowCount - 40) + i) % 20],
      ).filter(Boolean);
  const sampleRows = [...headSample, ...reservoirSample, ...tail];

  return {
    sheetKey,
    sheetName,
    sourceFileId: fileId,
    sourceFileName: fileName,
    sourceRole: role,
    rowCount,
    columnCount: finalHeaders.length,
    columns,
    sampleRows,
    columnProfile,
    blobBuffer: Buffer.concat(gzipChunks),
  };
}

async function streamParseXlsx(
  fileId: string,
  fileName: string,
  role: string,
  buffer: Buffer,
): Promise<SheetManifest[]> {
  const manifests: SheetManifest[] = [];

  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    entries: "emit",
    sharedStrings: "cache",
    worksheets: "emit",
  });

  let wsIndex = 0;
  for await (const worksheetReader of workbookReader) {
    const wsName = (worksheetReader as unknown as { name?: string }).name ?? `Sheet${++wsIndex}`;
    const sheetName = `${fileName} · ${wsName}`;
    const sheetKey = `${fileId}:${sheetName}`;

    let headers: string[] = [];
    let headerDetected = false;
    let rowCount = 0;

    // True streaming: same pattern as CSV — gzip transform, reservoir sampling, running stats
    const headSample: Record<string, unknown>[] = [];
    const reservoirSample: Record<string, unknown>[] = [];
    const tailBuffer: Record<string, unknown>[] = [];
    const colStats = new Map<string, StreamingColumnStats>();
    const gzipChunks: Buffer[] = [];
    const gzip = createGzip({ level: 6 });
    gzip.on("data", (chunk: Buffer) => gzipChunks.push(chunk));
    const gzipDone = new Promise<void>((resolve, reject) => {
      gzip.on("finish", resolve);
      gzip.on("error", reject);
    });

    for await (const row of worksheetReader) {
      const values = (row.values as unknown[])?.slice(1) ?? [];

      if (!headerDetected) {
        headers = values.map((v, i) => normalizeHeader(v, i));
        headerDetected = true;
        continue;
      }

      if (values.every((v) => v === null || v === undefined || v === "")) continue;

      const obj: Record<string, unknown> = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = normalizeCell(values[i]);
      }

      gzip.write(JSON.stringify(obj) + "\n");

      if (headSample.length < 40) {
        headSample.push(obj);
      } else {
        if (reservoirSample.length < 200) {
          reservoirSample.push(obj);
        } else {
          const j = Math.floor(Math.random() * (rowCount + 1));
          if (j < 200) reservoirSample[j] = obj;
        }
      }
      tailBuffer[rowCount % 20] = obj;
      updateColumnStats(colStats, obj);
      rowCount++;
    }

    gzip.end();
    await gzipDone;

    if (rowCount === 0 && headers.length === 0) continue;

    const columns = headers.map((h) => buildColumnFromStats(h, colStats.get(h), rowCount));
    const columnProfile = buildProfileFromStats(colStats, rowCount);

    const tail = rowCount <= 40
      ? []
      : Array.from({ length: Math.min(20, rowCount - 40) }, (_, i) =>
          tailBuffer[(rowCount - Math.min(20, rowCount - 40) + i) % 20],
        ).filter(Boolean);

    manifests.push({
      sheetKey,
      sheetName,
      sourceFileId: fileId,
      sourceFileName: fileName,
      sourceRole: role,
      rowCount,
      columnCount: headers.length,
      columns,
      sampleRows: [...headSample, ...reservoirSample, ...tail],
      columnProfile,
      blobBuffer: Buffer.concat(gzipChunks),
    });
  }

  return manifests;
}

function parseXlsBuffered(
  fileId: string,
  fileName: string,
  role: string,
  buffer: Buffer,
): SheetManifest[] {
  // XLS has no streaming support — use SheetJS as bounded fallback
  const workbook = read(buffer, { type: "buffer", cellDates: true, raw: false });
  const manifests: SheetManifest[] = [];

  for (const wsName of workbook.SheetNames) {
    const ws = workbook.Sheets[wsName];
    const matrix = utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as unknown[][];

    const headerIndex = detectHeaderRowIndex(matrix);
    const headerRow = matrix[headerIndex] ?? [];
    const bodyRows = matrix.slice(headerIndex + 1);
    const headers = (headerRow.length > 0 ? headerRow : ["column_1"]).map((v, i) =>
      normalizeHeader(v, i),
    );

    const rows = bodyRows
      .filter((row) => row.some((v) => v !== null && v !== ""))
      .map((row) => Object.fromEntries(headers.map((h, i) => [h, normalizeCell(row[i])])))
      .filter((row) => Object.values(row).some((v) => v !== null && v !== ""));

    if (rows.length === 0 && headers.length === 0) continue;

    const sheetName = workbook.SheetNames.length > 1 ? `${fileName} · ${wsName}` : fileName;
    const sheetKey = `${fileId}:${sheetName}`;
    const columns = headers.map((h) => inferColumn(rows, h));

    // Build profile from rows (XLS is bounded, in-memory is fine)
    const colStats = new Map<string, StreamingColumnStats>();
    for (const row of rows) updateColumnStats(colStats, row);
    const columnProfile = buildProfileFromStats(colStats, rows.length);

    const jsonlData = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const { gzipSync } = require("node:zlib") as typeof import("node:zlib");
    const blobBuffer = gzipSync(Buffer.from(jsonlData));

    // Sample: head 40 + tail 20 (XLS files are small)
    const sampleRows = rows.length <= 260
      ? rows
      : [...rows.slice(0, 40), ...rows.slice(-20)];

    manifests.push({
      sheetKey,
      sheetName,
      sourceFileId: fileId,
      sourceFileName: fileName,
      sourceRole: role,
      rowCount: rows.length,
      columnCount: headers.length,
      columns,
      sampleRows,
      columnProfile,
      blobBuffer,
    });
  }

  return manifests;
}

// ─── STREAMING COLUMN STATS (single-pass profiling) ───────────────
// Updated per-row as data flows through. No full-dataset accumulation.

type StreamingColumnStats = {
  count: number;
  nullCount: number;
  numericSum: number;
  numericCount: number;
  numericMin: number;
  numericMax: number;
  isAllNumeric: boolean;
  isAllDate: boolean;
  isAllBoolean: boolean;
  valueCounts: Map<string, number>; // capped at 1000 unique values
  cappedDistinct: boolean;
};

function newColumnStats(): StreamingColumnStats {
  return {
    count: 0,
    nullCount: 0,
    numericSum: 0,
    numericCount: 0,
    numericMin: Infinity,
    numericMax: -Infinity,
    isAllNumeric: true,
    isAllDate: true,
    isAllBoolean: true,
    valueCounts: new Map(),
    cappedDistinct: false,
  };
}

function updateColumnStats(
  statsMap: Map<string, StreamingColumnStats>,
  row: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(row)) {
    let stats = statsMap.get(key);
    if (!stats) {
      stats = newColumnStats();
      statsMap.set(key, stats);
    }
    stats.count++;

    if (value === null || value === undefined || value === "") {
      stats.nullCount++;
      continue;
    }

    const str = String(value);

    // Track value frequency (cap at 1000 unique to bound memory)
    if (!stats.cappedDistinct) {
      stats.valueCounts.set(str, (stats.valueCounts.get(str) ?? 0) + 1);
      if (stats.valueCounts.size > 1000) stats.cappedDistinct = true;
    } else {
      // Still increment existing entries
      const existing = stats.valueCounts.get(str);
      if (existing !== undefined) stats.valueCounts.set(str, existing + 1);
    }

    const num = typeof value === "number" ? value : Number(str);
    if (!isNaN(num) && typeof value === "number") {
      stats.numericSum += num;
      stats.numericCount++;
      if (num < stats.numericMin) stats.numericMin = num;
      if (num > stats.numericMax) stats.numericMax = num;
    } else {
      stats.isAllNumeric = false;
    }

    if (typeof value !== "boolean") stats.isAllBoolean = false;
    if (!(typeof value === "string" && !isNaN(Date.parse(value)) && /[-/]/.test(value))) {
      stats.isAllDate = false;
    }
  }
}

function buildColumnFromStats(
  name: string,
  stats: StreamingColumnStats | undefined,
  totalRows: number,
): SheetManifest["columns"][number] {
  if (!stats) {
    return { name, inferredType: "unknown", role: "unknown", nullable: true, sampleValues: [], uniqueCount: 0, nullRate: 1 };
  }

  const nonNull = stats.count - stats.nullCount;
  let inferredType: SheetManifest["columns"][number]["inferredType"] = "string";
  if (nonNull === 0) inferredType = "unknown";
  else if (stats.isAllBoolean) inferredType = "boolean";
  else if (stats.isAllNumeric && stats.numericCount === nonNull) inferredType = "number";
  else if (stats.isAllDate) inferredType = "date";

  const role = inferRole(name, inferredType);
  const topEntries = Array.from(stats.valueCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    name,
    inferredType,
    role,
    nullable: stats.nullCount > 0,
    sampleValues: topEntries.slice(0, 10).map(([v]) => v),
    uniqueCount: stats.valueCounts.size,
    uniqueCountApproximate: stats.cappedDistinct || undefined,
    nullRate: totalRows === 0 ? 0 : stats.nullCount / totalRows,
  };
}

function buildProfileFromStats(
  statsMap: Map<string, StreamingColumnStats>,
  totalRows: number,
): Record<string, ColumnProfile> {
  const profile: Record<string, ColumnProfile> = {};

  for (const [name, stats] of statsMap) {
    const topValues = Array.from(stats.valueCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value, count]) => ({ value, count }));

    const p: ColumnProfile = {
      nullCount: stats.nullCount,
      distinctCount: stats.valueCounts.size,
      distinctApproximate: stats.cappedDistinct || undefined,
      topValues,
    };

    if (stats.numericCount > 0) {
      p.min = stats.numericMin;
      p.max = stats.numericMax;
      p.mean = stats.numericSum / stats.numericCount;
    }

    profile[name] = p;
  }

  return profile;
}

async function gzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gzip = createGzip({ level: 6 });
    gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);
    gzip.end(input);
  });
}

/**
 * Load rows from a jsonl.gz blob buffer. Used by tools at query time.
 */
export async function loadRowsFromBlob(
  gzippedBuffer: Buffer,
): Promise<Record<string, unknown>[]> {
  const { gunzipSync } = await import("node:zlib");
  const text = gunzipSync(gzippedBuffer).toString("utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Compute a SHA-256 checksum for a buffer.
 */
export function checksumSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
