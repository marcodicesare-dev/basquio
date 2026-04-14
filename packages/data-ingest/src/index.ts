import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Worker } from "node:worker_threads";
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

type SupportTextResult = {
  fullText?: string;
  pages?: Array<{ num: number; text: string }>;
  pageCount?: number;
};

type PdfSupportTextPayload = {
  fullText?: string;
  pages: Array<{ num: number; text: string }>;
  pageCount: number;
};

const PDF_PARSE_TIMEOUT_MS = 20_000;
const PDF_PARSE_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const pdfParse = require("pdf-parse");

(async () => {
  try {
    const buffer = Buffer.from(workerData.buffer);
    const pages = [];
    const pdfData = await pdfParse(buffer, {
      max: 100,
      pagerender: async (pageData) => {
        const content = await pageData.getTextContent();
        const text = content.items.map((item) => item.str).join(" ").trim();
        if (text.length > 30) {
          pages.push({ num: pageData.pageNumber, text });
        }
        return text;
      },
    });

    parentPort.postMessage({
      ok: true,
      fullText: typeof pdfData.text === "string" ? pdfData.text.trim() : "",
      pages,
      pageCount: Number.isFinite(pdfData.numpages) ? pdfData.numpages : pages.length,
    });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
})();
`;

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
        allFiles: input.files,
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
    allFiles?: Array<Pick<ParseEvidenceFileInput, "fileName" | "kind">>;
  },
): Promise<NormalizedEvidenceFile & { workbookSheets?: NormalizedSheet[] }> {
  const role = inferFileRole(input.fileName, input.kind, input.allFiles);

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

  const textResult = await extractSupportText(input.fileName, input.kind, input.buffer);
  const warnings = buildSupportFileWarnings(input.fileName, input.kind, role, textResult.fullText);

  return {
    id: input.id,
    fileName: input.fileName,
    mediaType: input.mediaType ?? "application/octet-stream",
    kind: input.kind,
    role,
    sheets: [],
    textContent: textResult.fullText,
    pages: textResult.pages,
    pageCount: textResult.pageCount,
    warnings,
  };
}

// ─── PPTX CHART DATA EXTRACTION ────────────────────────────────────
// Extract data series from OOXML chart XML (c:chart namespace).
// Supports bar, line, pie, scatter, area charts.

function extractChartDataFromXml(chartXml: string): string | null {
  const parts: string[] = [];

  // Extract chart title
  const titleMatch = chartXml.match(/<c:chart[^>]*>[\s\S]*?<c:title>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
  if (titleMatch) parts.push(`Title: ${titleMatch[1].trim()}`);

  // Extract category labels from c:cat
  const catLabels: string[] = [];
  const catMatches = chartXml.match(/<c:cat>[\s\S]*?<\/c:cat>/g) ?? [];
  for (const catBlock of catMatches) {
    const vals = (catBlock.match(/<c:v>([^<]*)<\/c:v>/g) ?? []) as string[];
    for (const v of vals) {
      const val = v.replace(/<\/?c:v>/g, "").trim();
      if (val && !catLabels.includes(val)) catLabels.push(val);
    }
    // Also check string references
    const strVals = (catBlock.match(/<c:pt[^>]*><c:v>([^<]*)<\/c:v><\/c:pt>/g) ?? []) as string[];
    for (const sv of strVals) {
      const val = sv.replace(/<c:pt[^>]*><c:v>|<\/c:v><\/c:pt>/g, "").trim();
      if (val && !catLabels.includes(val)) catLabels.push(val);
    }
  }

  // Extract series names and values
  const serMatches = chartXml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) ?? [];
  for (const serBlock of serMatches) {
    // Series name
    const nameMatch = serBlock.match(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/);
    const seriesName = nameMatch ? nameMatch[1].trim() : "Series";

    // Series values
    const valBlock = serBlock.match(/<c:val>[\s\S]*?<\/c:val>/) ?? serBlock.match(/<c:yVal>[\s\S]*?<\/c:yVal>/);
    if (valBlock) {
      const nums = (valBlock[0].match(/<c:v>([^<]*)<\/c:v>/g) ?? []) as string[];
      const values = nums.map((n: string) => n.replace(/<\/?c:v>/g, "").trim());
      if (values.length > 0) {
        if (catLabels.length === values.length) {
          const pairs = catLabels.map((cat, i) => `${cat}: ${values[i]}`);
          parts.push(`${seriesName}: ${pairs.join(", ")}`);
        } else {
          parts.push(`${seriesName}: ${values.join(", ")}`);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

// ─── PPTX TABLE DATA EXTRACTION ───────────────────────────────────
// Extract table content from slide XML <a:tbl> elements.

function extractTableDataFromSlideXml(slideXml: string): string | null {
  const tableMatches = slideXml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g);
  if (!tableMatches || tableMatches.length === 0) return null;

  const tables: string[] = [];
  for (const tableXml of tableMatches) {
    const rows = tableXml.match(/<a:tr[^>]*>[\s\S]*?<\/a:tr>/g) ?? [];
    const tableRows: string[][] = [];

    for (const rowXml of rows) {
      const cells = rowXml.match(/<a:tc[^>]*>[\s\S]*?<\/a:tc>/g) ?? [];
      const rowValues: string[] = [];

      for (const cellXml of cells) {
        const texts = (cellXml.match(/<a:t>([^<]*)<\/a:t>/g) ?? []) as string[];
        const cellText = texts
          .map((t: string) => t.replace(/<\/?a:t>/g, "").trim())
          .filter(Boolean)
          .join(" ");
        rowValues.push(cellText || "");
      }

      if (rowValues.some((v) => v.length > 0)) {
        tableRows.push(rowValues);
      }
    }

    if (tableRows.length > 0) {
      // Format as header row + data rows
      const header = tableRows[0].join(" | ");
      const dataRows = tableRows.slice(1).map((r) => r.join(" | "));
      tables.push([header, ...dataRows].join("\n"));
    }
  }

  return tables.length > 0 ? tables.join("\n\n") : null;
}

async function extractSupportText(
  fileName: string,
  kind: ReturnType<typeof inferSourceFileKind>,
  buffer: Buffer,
): Promise<SupportTextResult> {
  if (kind !== "document" && kind !== "brand-tokens" && kind !== "pdf" && kind !== "pptx") {
    return { fullText: undefined };
  }

  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".docx")) {
    try {
      const result = await mammoth.convertToHtml({ buffer });
      const html = result.value;
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
      return { fullText: text || undefined };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown parse error";
      return {
        fullText: `[DOCX "${fileName}" could not be fully parsed — ${reason}. Basquio will continue with the raw upload, but analysis may be limited.]`,
      };
    }
  }

  if (normalized.endsWith(".doc")) {
    return { fullText: `[Basquio warning: .doc format not supported. Please convert "${fileName}" to .docx for full text extraction.]` };
  }

  // PDF text extraction with per-page chunking
  if (normalized.endsWith(".pdf")) {
    return extractPdfSupportText(fileName, buffer);
  }

  // PPTX content extraction with per-slide chunking + chart/table data
  if (normalized.endsWith(".pptx")) {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const pages: Array<{ num: number; text: string }> = [];

      const slideEntries = Object.keys(zip.files)
        .filter((f: string) => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
        .sort();

      // Extract chart data from ppt/charts/*.xml
      const chartDataMap = new Map<string, string>();
      const chartEntries = Object.keys(zip.files)
        .filter((f: string) => /^ppt\/charts\/chart\d+\.xml$/i.test(f));
      for (const chartEntry of chartEntries) {
        try {
          const chartXml = await zip.files[chartEntry].async("text");
          const chartText = extractChartDataFromXml(chartXml);
          if (chartText) {
            const chartName = chartEntry.replace(/^ppt\/charts\//, "").replace(/\.xml$/i, "");
            chartDataMap.set(chartName, chartText);
          }
        } catch { /* skip unparseable charts */ }
      }

      // Map slide relationships to chart files
      const slideChartMap = new Map<number, string[]>();
      for (const entry of slideEntries) {
        const slideNum = parseInt(entry.match(/slide(\d+)/)?.[1] ?? "0", 10);
        const relsPath = entry.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
        if (zip.files[relsPath]) {
          try {
            const relsXml = await zip.files[relsPath].async("text");
            const chartRefs = (relsXml.match(/Target="\.\.\/charts\/(chart\d+)\.xml"/g) ?? []) as string[];
            const chartNames = chartRefs.map((r: string) => r.match(/chart\d+/)?.[0] ?? "").filter(Boolean);
            if (chartNames.length > 0) {
              slideChartMap.set(slideNum, chartNames);
            }
          } catch { /* skip */ }
        }
      }

      for (const entry of slideEntries) {
        const xml = await zip.files[entry].async("text");
        const slideNum = parseInt(entry.match(/slide(\d+)/)?.[1] ?? "0", 10);

        // Extract text
        const texts = (xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? []) as string[];
        const slideText = texts
          .map((t: string) => t.replace(/<\/?a:t>/g, "").trim())
          .filter((t: string) => t.length > 0)
          .join(" ");

        // Extract table data from <a:tbl> elements
        const tableData = extractTableDataFromSlideXml(xml);

        // Get associated chart data
        const chartNames = slideChartMap.get(slideNum) ?? [];
        const chartTexts = chartNames
          .map((name) => chartDataMap.get(name))
          .filter(Boolean) as string[];

        // Combine all content for this slide
        const parts: string[] = [];
        if (slideText) parts.push(slideText);
        if (tableData) parts.push(`[Table data] ${tableData}`);
        for (const ct of chartTexts) parts.push(`[Chart data] ${ct}`);

        if (parts.length > 0) {
          pages.push({ num: slideNum, text: parts.join("\n") });
        }
      }

      const fullText = pages.length > 0
        ? pages.map((p) => `[Slide ${p.num}] ${p.text}`).join("\n\n")
        : `[PPTX "${fileName}" contained no readable text.]`;

      return { fullText, pages, pageCount: slideEntries.length };
    } catch {
      return { fullText: `[PPTX "${fileName}" could not be parsed.]` };
    }
  }

  if (canDecodeAsText(fileName, kind)) {
    return { fullText: buffer.toString("utf8") };
  }

  return { fullText: undefined };
}

async function extractPdfSupportText(fileName: string, buffer: Buffer): Promise<SupportTextResult> {
  try {
    const parsed = normalizePdfSupportText(await parsePdfSupportTextInWorker(buffer));
    if (parsed.fullText && parsed.fullText.length > 20) {
      return parsed;
    }

    return {
      fullText: `[PDF "${fileName}" parsed but contained no readable text — may be image-only or scanned.]`,
      pages: parsed.pages,
      pageCount: parsed.pageCount,
    };
  } catch (error) {
    const reason = sanitizePdfParseFailure(error);
    return {
      fullText: `[PDF "${fileName}" could not be parsed — ${reason}.]`,
    };
  }
}

function normalizePdfSupportText(input: PdfSupportTextPayload): PdfSupportTextPayload {
  return {
    ...input,
    fullText: normalizePdfExtractedText(input.fullText),
    pages: input.pages.map((page) => ({
      ...page,
      text: normalizePdfExtractedText(page.text) ?? page.text,
    })),
  };
}

function normalizePdfExtractedText(text: string | undefined) {
  if (typeof text !== "string") {
    return text;
  }

  const normalizedLines = text
    .replace(/\u00a0/g, " ")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizePdfExtractedLine(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalizedLines || text.trim();
}

function normalizePdfExtractedLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .replace(/\b(?:[A-Za-z0-9] ){1,}[A-Za-z0-9]\b/gu, (match) => repairLetterSpacedRun(match))
    .split(/ {2,}|\t+/)
    .map((chunk) => normalizePdfLetterSpacedChunk(chunk))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:%)])/, "$1")
    .replace(/([(%])\s+/g, "$1")
    .trim();
}

function normalizePdfLetterSpacedChunk(chunk: string) {
  const trimmed = chunk.trim();
  if (!trimmed) {
    return "";
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 4) {
    return trimmed;
  }

  const singleCharTokens = tokens.filter((token) => /^[A-Za-z0-9&+/%.,()-]$/u.test(token)).length;
  const alphaNumericSingles = tokens.filter((token) => /^[A-Za-z0-9]$/u.test(token)).length;
  const shouldJoin = singleCharTokens / tokens.length >= 0.7 && alphaNumericSingles >= 4;

  if (!shouldJoin) {
    return trimmed;
  }

  return tokens.join("");
}

function repairLetterSpacedRun(match: string) {
  const collapsed = match.replace(/\s+/g, "");
  return collapsed
    .replace(/([a-z])([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
}

async function parsePdfSupportTextInWorker(buffer: Buffer): Promise<PdfSupportTextPayload> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(PDF_PARSE_WORKER_SOURCE, {
      eval: true,
      workerData: {
        buffer: Uint8Array.from(buffer),
      },
    });

    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      callback();
    };

    const timeoutId = setTimeout(() => {
      settle(() => {
        void worker.terminate().catch(() => {});
        reject(new Error("pdf parser timed out"));
      });
    }, PDF_PARSE_TIMEOUT_MS);

    worker.once("message", (message: unknown) => {
      settle(() => {
        void worker.terminate().catch(() => {});
        const payload = message as
          | { ok: true; fullText?: string; pages?: Array<{ num: number; text: string }>; pageCount?: number }
          | { ok: false; error?: string };
        if (payload?.ok) {
          resolve({
            fullText: payload.fullText,
            pages: payload.pages ?? [],
            pageCount: payload.pageCount ?? payload.pages?.length ?? 0,
          });
          return;
        }

        reject(new Error(payload?.error ?? "pdf parser failed"));
      });
    });

    worker.once("error", (error) => {
      settle(() => {
        reject(error);
      });
    });

    worker.once("exit", (code) => {
      settle(() => {
        if (code === 0) {
          reject(new Error("pdf parser exited without returning a result"));
          return;
        }
        reject(new Error(`pdf parser exited with code ${code}`));
      });
    });
  });
}

function sanitizePdfParseFailure(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "parser unavailable";
}

// ─── PPTX SLIDE IMAGE EXTRACTION ──────────────────────────────────
// Extract embedded images from PPTX slides for vision-based data extraction.
// Returns slide images as base64 data URIs + metadata about which slides
// have visual content (shapes, SmartArt, grouped objects) that XML parsing missed.

export type PptxSlideImage = {
  slideNum: number;
  images: Array<{ name: string; base64: string; mimeType: string }>;
  hasShapes: boolean;      // slide has <p:sp> shape elements (possible chart-as-shapes)
  hasSmartArt: boolean;    // slide has SmartArt
  hasGroupedShapes: boolean; // slide has <p:grpSp> grouped shapes
  hasNativeChart: boolean; // slide has native OOXML chart (already extracted by XML parser)
  needsVision: boolean;    // true if slide has visual content NOT covered by XML extraction
};

export async function extractPptxSlideImages(buffer: Buffer): Promise<PptxSlideImage[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const results: PptxSlideImage[] = [];

  const slideEntries = Object.keys(zip.files)
    .filter((f: string) => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
    .sort();

  for (const entry of slideEntries) {
    const slideNum = parseInt(entry.match(/slide(\d+)/)?.[1] ?? "0", 10);
    const xml = await zip.files[entry].async("text");

    // Detect content types
    const hasNativeChart = xml.includes("<c:chart") || xml.includes("chart.xml");
    const hasShapes = (xml.match(/<p:sp\b/g) ?? []).length > 3; // >3 shapes suggests complex visuals
    const hasSmartArt = xml.includes("dgm:") || xml.includes("smartArt");
    const hasGroupedShapes = xml.includes("<p:grpSp");
    const hasEmbeddedImages = xml.includes("<a:blip");

    // Extract embedded images from this slide's relationships
    const images: Array<{ name: string; base64: string; mimeType: string }> = [];
    const relsPath = entry.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";

    if (zip.files[relsPath]) {
      try {
        const relsXml = await zip.files[relsPath].async("text");
        const imageRefs = relsXml.match(/Target="([^"]*\.(png|jpg|jpeg|gif|bmp|tiff|emf|wmf))"/gi) ?? [];

        for (const ref of imageRefs) {
          const targetMatch = ref.match(/Target="([^"]*)"/);
          if (!targetMatch) continue;

          let imagePath = targetMatch[1];
          // Resolve relative path
          if (imagePath.startsWith("../")) {
            imagePath = "ppt/" + imagePath.replace("../", "");
          } else if (!imagePath.startsWith("ppt/")) {
            imagePath = "ppt/slides/" + imagePath;
          }

          if (zip.files[imagePath]) {
            try {
              const imageBuffer = await zip.files[imagePath].async("nodebuffer");
              // Only include images > 5KB (skip tiny icons/bullets)
              if (imageBuffer.length > 5000) {
                const ext = imagePath.split(".").pop()?.toLowerCase() ?? "png";
                const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
                  : ext === "png" ? "image/png"
                  : ext === "gif" ? "image/gif"
                  : "image/png";
                images.push({
                  name: imagePath.split("/").pop() ?? `slide${slideNum}-image`,
                  base64: imageBuffer.toString("base64"),
                  mimeType,
                });
              }
            } catch { /* skip unreadable images */ }
          }
        }
      } catch { /* skip unreadable rels */ }
    }

    // A slide needs vision if it has visual content that XML parsing can't handle
    const needsVision = (
      (!hasNativeChart && (hasShapes || hasGroupedShapes || hasSmartArt)) ||
      (hasEmbeddedImages && images.length > 0)
    );

    results.push({
      slideNum,
      images,
      hasShapes,
      hasSmartArt,
      hasGroupedShapes,
      hasNativeChart,
      needsVision,
    });
  }

  return results;
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

function inferFileRole(
  fileName: string,
  kind: ReturnType<typeof inferSourceFileKind>,
  allFiles?: Array<Pick<ParseEvidenceFileInput, "fileName" | "kind">>,
) {
  const normalized = fileName.toLowerCase();
  const hasWorkbookEvidence = allFiles?.some((file) => {
    const resolvedKind = file.kind ?? inferSourceFileKind(file.fileName);
    return resolvedKind === "workbook";
  }) ?? false;

  if (kind === "brand-tokens") {
    return "brand-tokens" as const;
  }

  if (kind === "pptx") {
    return hasWorkbookEvidence ? "template-pptx" as const : "evidence-pptx" as const;
  }

  if (kind === "pdf") {
    return hasWorkbookEvidence ? "style-reference-pdf" as const : "evidence-pdf" as const;
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

/**
 * Resolve ExcelJS rich cell values to primitives.
 * ExcelJS returns: string, number, Date, boolean, { richText: [...] },
 * { formula: string, result: unknown }, { text: string, hyperlink: string }, or null.
 */
function resolveCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;

  // Rich text: { richText: [{ text: '...' }, ...] }
  if (typeof value === "object" && "richText" in value && Array.isArray((value as { richText: unknown[] }).richText)) {
    return (value as { richText: Array<{ text?: string }> }).richText.map((r) => r.text ?? "").join("");
  }

  // Formula: { formula: '...', result: ... }
  if (typeof value === "object" && "result" in value) {
    const result = (value as { result: unknown }).result;
    return resolveCellValue(result); // Recurse in case result is also complex
  }

  // Hyperlink: { text: '...', hyperlink: '...' }
  if (typeof value === "object" && "text" in value) {
    return (value as { text: string }).text;
  }

  // Fallback: stringify
  return String(value);
}

/**
 * Extract formula information from an ExcelJS cell value.
 * Returns whether the value is formula-driven and the formula text if so.
 */
function extractFormulaInfo(value: unknown): { isFormula: boolean; formula?: string } {
  if (value && typeof value === "object" && "formula" in value) {
    return { isFormula: true, formula: (value as { formula: string }).formula };
  }
  return { isFormula: false };
}

/**
 * Pick the best header row from buffered rows.
 * Scores each row based on:
 * 1. Number of non-empty cells (more = better header candidate)
 * 2. Proportion of string values (headers are typically strings, not numbers)
 * 3. Penalty for being the very first row (often a title)
 * Returns the index of the best header row, or -1 if none qualifies.
 */
function pickBestHeaderRow(rows: unknown[][]): number {
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nonEmpty = row.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (nonEmpty.length < 2) continue; // Need at least 2 columns to be a header

    const stringCount = nonEmpty.filter((v) => typeof v === "string").length;
    const stringRatio = stringCount / nonEmpty.length;

    // Score: favor rows with many columns and mostly-string values
    let score = nonEmpty.length * (0.5 + stringRatio * 0.5);

    // Slight penalty for row 0 (often a title, not a header)
    if (i === 0) score *= 0.7;

    // Heavy penalty for instruction/description rows: headers are SHORT labels,
    // not long sentences. If average string length > 30 chars, it's probably
    // a merged instruction row, not a header.
    const avgStringLen = nonEmpty
      .filter((v): v is string => typeof v === "string")
      .reduce((sum, s) => sum + s.length, 0) / Math.max(1, stringCount);
    if (avgStringLen > 30) score *= 0.3; // Very likely instruction text, not headers
    else if (avgStringLen > 20) score *= 0.6; // Somewhat long for headers

    // Penalty if all values are identical (merged cell propagation artifact)
    const uniqueValues = new Set(nonEmpty.map((v) => String(v)));
    if (uniqueValues.size === 1 && nonEmpty.length > 2) score *= 0.1; // All same = merged instruction

    // Bonus for being preceded by a blank or single-value row (section break)
    if (i > 0) {
      const prevNonEmpty = rows[i - 1].filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
      if (prevNonEmpty.length <= 1) score *= 1.2; // Blank/title row before = likely header
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
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

  // Dashes and single dots are null indicators, not numbers
  if (trimmed === "-" || trimmed === "\u2014" || trimmed === "\u2013" || trimmed === "." || trimmed === "..") {
    return null;
  }

  let candidate = trimmed
    .replace(/^[\u20AC$\u00A3\u00A5\u20B9\u20BD\u20A9]/, "")        // Leading currency symbols
    .replace(/[\u20AC$\u00A3\u00A5\u20B9\u20BD\u20A9%]$/g, "")       // Trailing currency symbols
    .replace(/^(CHF|USD|EUR|GBP|SEK|NOK|DKK|CZK|PLN|BRL|JPY|CNY|KRW|INR|RUB)\s*/i, "") // ISO currency prefixes
    .replace(/\s*(CHF|USD|EUR|GBP|SEK|NOK|DKK|CZK|PLN|BRL|JPY|CNY|KRW|INR|RUB)$/i, "") // ISO currency suffixes
    .replace(/[‘\u2019\u02BC\u201B`\u00B4]/g, "")           // All apostrophe/quote variants (thousand separators)
    .replace(/\s+/g, "")                // Whitespace (space as thousand separator)
    .replace(/%$/, "");                 // Trailing percent

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
  // Region metadata — only present for region-level manifests from dense parse
  regionId?: string;
  regionIndex?: number;
  regionType?: "structured_table" | "financial_model_block" | "kpi_grid" | "narrative_sheet" | "unsafe";
  regionConfidence?: number;
  regionBounds?: {
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
    headerStartRow: number;
    headerEndRow: number;
    dataStartRow: number;
  };
  sourceSheetKey?: string; // parent sheet if this is a sub-region
  formulaColumns?: string[]; // columns with formula-driven values
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
  const role = inferFileRole(input.fileName, input.kind as ReturnType<typeof inferSourceFileKind>, [
    { fileName: input.fileName, kind: input.kind as ReturnType<typeof inferSourceFileKind> },
  ]);
  const ext = input.fileName.toLowerCase();

  if (ext.endsWith(".csv")) {
    const sheet = await streamParseCsv(input.id, input.fileName, role, input.buffer);
    return { sheets: [sheet], role };
  }

  if (ext.endsWith(".xlsx")) {
    const sheets = await streamParseXlsx(input.id, input.fileName, role, input.buffer);

    // Detect sheets that need dense region analysis
    const needsDenseParse = sheets.some((m) => {
      // Obviously broken
      if (m.columnCount <= 2) return true;
      // Too many generic column names (column_1, column_2, etc.)
      const genericHeaders = m.columns.filter((c) => /^column_\d+$/.test(c.name)).length;
      if (genericHeaders > m.columnCount * 0.5) return true;
      // Suspiciously low usable row count for a workbook sheet
      if (m.rowCount <= 3 && m.columnCount <= 4) return true;
      // Duplicate header names
      const uniqueHeaders = new Set(m.columns.map((c) => c.name));
      if (uniqueHeaders.size < m.columnCount * 0.7) return true;
      return false;
    });
    if (needsDenseParse) {
      try {
        const denseManifests = await denseParseXlsx(input.id, input.fileName, role, input.buffer, sheets);
        // Merge dense results: dense replaces streaming only when it finds
        // genuinely better structure (more columns, fewer generic headers,
        // or region metadata). Prevents instruction-text headers from
        // overriding good streaming results.
        for (const dm of denseManifests) {
          const idx = sheets.findIndex((m) => m.sheetKey === dm.sheetKey);
          if (idx >= 0) {
            const existing = sheets[idx];
            const denseGenericCount = dm.columns.filter((c) => /^column_\d+$/.test(c.name)).length;
            const existingGenericCount = existing.columns.filter((c) => /^column_\d+$/.test(c.name)).length;
            // Dense wins if: more columns, or fewer generic headers, or has region metadata
            const denseIsBetter =
              dm.columnCount > existing.columnCount ||
              (dm.columnCount === existing.columnCount && denseGenericCount < existingGenericCount) ||
              (dm.regionType && !existing.regionType);
            if (denseIsBetter) {
              sheets[idx] = dm;
            }
          } else {
            sheets.push(dm); // New region-level manifest
          }
        }
      } catch (denseError) {
        console.warn(`[data-ingest] Dense parse failed, using streaming results:`, denseError);
      }
    }

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

    // Buffer first N rows for smart header detection instead of locking on row 1.
    // Financial models have title rows, instruction rows, blanks before headers.
    const MAX_HEADER_SCAN = 25;
    const bufferedRows: unknown[][] = [];
    let headerRowIndex = -1;

    for await (const row of worksheetReader) {
      // ExcelJS row.values: sparse array (index 0 empty) or object with numeric keys.
      // Cell values may be: string, number, Date, boolean, { richText: [...] },
      // { formula: string, result: unknown }, { text: string, hyperlink: string }, or null.
      const rawValues = row.values;
      const values = Array.isArray(rawValues)
        ? rawValues.slice(1)
        : rawValues && typeof rawValues === "object"
          ? Object.values(rawValues as Record<number, unknown>)
          : [];

      // Resolve rich text / formula objects to primitives
      const resolved = values.map(resolveCellValue);

      if (!headerDetected) {
        bufferedRows.push(resolved);

        // Keep buffering until we have MAX_HEADER_SCAN rows — don't commit early
        if (bufferedRows.length < MAX_HEADER_SCAN) {
          continue;
        }

        // Now we have MAX_HEADER_SCAN rows, pick the best header from the full buffer
        headerRowIndex = pickBestHeaderRow(bufferedRows);
        if (headerRowIndex < 0) headerRowIndex = 0;
        headers = bufferedRows[headerRowIndex].map((v, i) => normalizeHeader(v, i));
        headerDetected = true;

        // Process ALL buffered rows after the header
        for (let r = headerRowIndex + 1; r < bufferedRows.length; r++) {
          const rowValues = bufferedRows[r];
          if (rowValues.every((v) => v === null || v === undefined || String(v).trim() === "")) continue;
          const obj: Record<string, unknown> = {};
          for (let i = 0; i < headers.length; i++) {
            obj[headers[i]] = normalizeCell(rowValues[i]);
          }
          gzip.write(JSON.stringify(obj) + "\n");
          if (headSample.length < 40) headSample.push(obj);
          tailBuffer[rowCount % 20] = obj;
          updateColumnStats(colStats, obj);
          rowCount++;
        }
        continue;
      }

      if (resolved.every((v) => v === null || v === undefined || String(v).trim() === "")) continue;

      const obj: Record<string, unknown> = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = normalizeCell(resolved[i]);
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

    // Handle worksheets with fewer than MAX_HEADER_SCAN rows
    // (the for-await loop ended before the buffer filled up)
    if (!headerDetected && bufferedRows.length > 0) {
      headerRowIndex = pickBestHeaderRow(bufferedRows);
      if (headerRowIndex < 0) headerRowIndex = 0;
      headers = bufferedRows[headerRowIndex].map((v, i) => normalizeHeader(v, i));
      headerDetected = true;

      for (let r = headerRowIndex + 1; r < bufferedRows.length; r++) {
        const rowValues = bufferedRows[r];
        if (rowValues.every((v) => v === null || v === undefined || String(v).trim() === "")) continue;
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < headers.length; i++) {
          obj[headers[i]] = normalizeCell(rowValues[i]);
        }
        gzip.write(JSON.stringify(obj) + "\n");
        if (headSample.length < 40) headSample.push(obj);
        tailBuffer[rowCount % 20] = obj;
        updateColumnStats(colStats, obj);
        rowCount++;
      }
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

// ─── DENSE XLSX PARSE (region detection enrichment) ───────────────
// Non-streaming fallback for financial models & multi-block sheets.
// Uses ExcelJS Workbook for full cell access + merged cell info.

type Region = {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  headerRow: number;
  type: "structured_table" | "financial_model_block" | "kpi_grid" | "narrative_sheet" | "unsafe";
  confidence: number;
};

/**
 * Propagate merged cell values across their ranges.
 * Mutates the grid in-place: every cell in a merged range gets the top-left value.
 */
function resolveMergedCells(
  grid: unknown[][],
  merges: Array<{ top: number; left: number; bottom: number; right: number }>,
): void {
  for (const merge of merges) {
    const value = grid[merge.top]?.[merge.left];
    if (value === null || value === undefined) continue;
    for (let r = merge.top; r <= merge.bottom; r++) {
      for (let c = merge.left; c <= merge.right; c++) {
        if (r === merge.top && c === merge.left) continue;
        if (grid[r]) grid[r][c] = value;
      }
    }
  }
}

/**
 * Collapse multi-row headers (common in financial models with merged header cells)
 * into a single row of header strings joined by " — ".
 */
function collapseMultiRowHeaders(
  grid: unknown[][],
  headerStart: number,
  headerEnd: number,
  colCount: number,
): string[] {
  const headers: string[] = [];
  for (let c = 0; c < colCount; c++) {
    const parts: string[] = [];
    for (let r = headerStart; r <= headerEnd; r++) {
      const val = grid[r]?.[c];
      if (val !== null && val !== undefined && String(val).trim()) {
        parts.push(String(val).trim());
      }
    }
    headers.push(parts.join(" — ") || `column_${c + 1}`);
  }
  return headers;
}

/**
 * Detect table regions within a dense grid by finding blank row bands.
 * 3+ consecutive empty rows = region separator.
 */
function detectRegions(
  grid: unknown[][],
  mergedRanges: Array<{ top: number; left: number; bottom: number; right: number }>,
): Region[] {
  if (grid.length === 0) return [];

  // 1. Find blank rows (rows where all cells are empty)
  const isBlankRow = (rowIdx: number): boolean => {
    const row = grid[rowIdx];
    if (!row) return true;
    return row.every((v) => v === null || v === undefined || String(v).trim() === "");
  };

  // 2. Split into vertical segments at blank bands (3+ consecutive blank rows)
  const segments: Array<{ start: number; end: number }> = [];
  let segStart = -1;
  let blankRun = 0;

  for (let r = 0; r < grid.length; r++) {
    if (isBlankRow(r)) {
      blankRun++;
      if (blankRun >= 3 && segStart >= 0) {
        // End current segment at the row before the blank band
        segments.push({ start: segStart, end: r - blankRun });
        segStart = -1;
      }
    } else {
      if (segStart < 0) segStart = r;
      blankRun = 0;
    }
  }
  // Close last segment
  if (segStart >= 0) {
    segments.push({ start: segStart, end: grid.length - 1 });
  }

  // 3. For each segment, determine column extent and classify
  const regions: Region[] = [];
  for (const seg of segments) {
    // Find the column extent (min/max non-empty columns)
    let minCol = Infinity;
    let maxCol = 0;
    for (let r = seg.start; r <= seg.end; r++) {
      const row = grid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== null && row[c] !== undefined && String(row[c]).trim() !== "") {
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
        }
      }
    }

    if (minCol > maxCol) continue; // completely empty segment

    const colCount = maxCol - minCol + 1;
    const rowCount = seg.end - seg.start + 1;

    // Extract sub-grid for header detection
    const subGrid: unknown[][] = [];
    for (let r = seg.start; r <= seg.end; r++) {
      const row = grid[r];
      subGrid.push(row ? row.slice(minCol, maxCol + 1) : []);
    }

    // Detect header row within this segment
    const scanRows = subGrid.slice(0, Math.min(15, subGrid.length));
    let headerIdx = pickBestHeaderRow(scanRows);
    if (headerIdx < 0) headerIdx = 0;

    // Check for multi-row headers: if the row above the detected header has
    // merged cells spanning the same columns, it's part of the header
    let headerStart = headerIdx;
    if (headerIdx > 0) {
      const prevRow = subGrid[headerIdx - 1];
      if (prevRow) {
        const prevNonEmpty = prevRow.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
        const prevStringCount = prevNonEmpty.filter((v) => typeof v === "string").length;
        // If previous row is mostly strings and has at least 2 values, it's likely a stacked header
        if (prevNonEmpty.length >= 2 && prevStringCount / prevNonEmpty.length > 0.5) {
          // Check if any merged cells span this row
          const hasMergeAbove = mergedRanges.some(
            (m) => m.top <= seg.start + headerIdx - 1 && m.bottom >= seg.start + headerIdx &&
                   m.left >= minCol && m.right <= maxCol,
          );
          if (hasMergeAbove) headerStart = headerIdx - 1;
        }
      }
    }

    // Score and classify the region
    const dataRowCount = rowCount - (headerIdx + 1);
    const headerRow = subGrid[headerIdx] ?? [];
    const headerNonEmpty = headerRow.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    const headerStringCount = headerNonEmpty.filter((v) => typeof v === "string").length;
    const headerStringRatio = headerNonEmpty.length > 0 ? headerStringCount / headerNonEmpty.length : 0;

    // Count numeric values in data rows
    let numericDataCells = 0;
    let totalDataCells = 0;
    for (let r = headerIdx + 1; r < subGrid.length; r++) {
      const row = subGrid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (v !== null && v !== undefined && String(v).trim() !== "") {
          totalDataCells++;
          if (typeof v === "number") numericDataCells++;
        }
      }
    }
    const numericRatio = totalDataCells > 0 ? numericDataCells / totalDataCells : 0;

    let type: Region["type"];
    let confidence: number;

    if (colCount >= 3 && dataRowCount >= 3 && headerStringRatio > 0.8) {
      type = "structured_table";
      confidence = 0.9 + Math.min(0.09, dataRowCount / 1000);
    } else if (colCount >= 2 && numericRatio > 0.3) {
      type = "financial_model_block";
      confidence = 0.7 + Math.min(0.15, dataRowCount / 100) * (numericRatio > 0.5 ? 1 : 0.8);
    } else if (dataRowCount <= 4 && numericRatio > 0.5) {
      type = "kpi_grid";
      confidence = 0.6;
    } else if (colCount < 3 && headerStringRatio > 0.5) {
      type = "narrative_sheet";
      confidence = 0.5;
    } else {
      type = "unsafe";
      confidence = 0.3;
    }

    regions.push({
      startRow: seg.start,
      endRow: seg.end,
      startCol: minCol,
      endCol: maxCol,
      headerRow: seg.start + headerIdx,
      type,
      confidence,
    });
  }

  // Second pass: split wide regions at blank column bands
  const refinedRegions: Region[] = [];
  for (const region of regions) {
    // Check for blank columns within the region
    const blankCols: number[] = [];
    for (let c = region.startCol; c <= region.endCol; c++) {
      let isEmpty = true;
      for (let r = region.startRow; r <= region.endRow; r++) {
        if (grid[r]?.[c] !== null && grid[r]?.[c] !== undefined && String(grid[r]?.[c]).trim() !== "") {
          isEmpty = false;
          break;
        }
      }
      if (isEmpty) blankCols.push(c);
    }

    // Find blank column bands (2+ consecutive blank columns) and split the region
    if (blankCols.length >= 2) {
      // Find runs of consecutive blank columns
      const bands: Array<{ start: number; end: number }> = [];
      let bandStart = blankCols[0];
      for (let i = 1; i < blankCols.length; i++) {
        if (blankCols[i] !== blankCols[i - 1] + 1) {
          if (blankCols[i - 1] - bandStart >= 1) bands.push({ start: bandStart, end: blankCols[i - 1] });
          bandStart = blankCols[i];
        }
      }
      if (blankCols[blankCols.length - 1] - bandStart >= 1) {
        bands.push({ start: bandStart, end: blankCols[blankCols.length - 1] });
      }

      if (bands.length > 0) {
        // Split at the widest blank band
        const widest = bands.reduce((a, b) => (b.end - b.start > a.end - a.start) ? b : a);
        let didSplit = false;
        // Left sub-region
        if (widest.start > region.startCol) {
          // Re-detect header for the left sub-region
          const leftSubGrid: unknown[][] = [];
          for (let r = region.startRow; r <= region.endRow; r++) {
            leftSubGrid.push(grid[r] ? grid[r].slice(region.startCol, widest.start) : []);
          }
          const leftHeaderIdx = pickBestHeaderRow(leftSubGrid.slice(0, Math.min(15, leftSubGrid.length)));
          refinedRegions.push({
            ...region,
            endCol: widest.start - 1,
            headerRow: region.startRow + (leftHeaderIdx >= 0 ? leftHeaderIdx : 0),
          });
          didSplit = true;
        }
        // Right sub-region
        if (widest.end < region.endCol) {
          const rightSubGrid: unknown[][] = [];
          for (let r = region.startRow; r <= region.endRow; r++) {
            rightSubGrid.push(grid[r] ? grid[r].slice(widest.end + 1, region.endCol + 1) : []);
          }
          const rightHeaderIdx = pickBestHeaderRow(rightSubGrid.slice(0, Math.min(15, rightSubGrid.length)));
          refinedRegions.push({
            ...region,
            startCol: widest.end + 1,
            headerRow: region.startRow + (rightHeaderIdx >= 0 ? rightHeaderIdx : 0),
          });
          didSplit = true;
        }
        if (didSplit) continue;
      }
    }
    refinedRegions.push(region);
  }

  return refinedRegions;
}

/**
 * Dense XLSX parse for region detection.
 * Uses non-streaming ExcelJS Workbook for full cell access + merged cells.
 * Only used when streaming parse produces suspicious results or when
 * the workbook looks like a financial model (multiple header candidates per sheet).
 */
async function denseParseXlsx(
  fileId: string,
  fileName: string,
  role: string,
  buffer: Buffer,
  existingManifests: SheetManifest[],
): Promise<SheetManifest[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const manifests: SheetManifest[] = [];

  for (const worksheet of workbook.worksheets) {
    const wsName = worksheet.name;
    const existingKey = `${fileId}:${fileName} · ${wsName}`;
    const existingManifest = existingManifests.find((m) => m.sheetKey === existingKey);

    // Dense parse runs on ALL sheets when triggered — even sheets with >2 columns
    // may have wrong headers, merged-cell issues, or multiple undetected regions.

    // Build dense grid of resolved cell values + formula tracking
    const rowCount = worksheet.rowCount;
    const colCount = worksheet.columnCount;
    if (rowCount === 0 || colCount === 0) continue;

    const grid: unknown[][] = [];
    const formulaGrid: boolean[][] = []; // parallel grid tracking which cells are formulas
    for (let r = 1; r <= rowCount; r++) {
      const row = worksheet.getRow(r);
      const values: unknown[] = [];
      const formulaFlags: boolean[] = [];
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        values.push(resolveCellValue(cell.value));
        formulaFlags.push(extractFormulaInfo(cell.value).isFormula);
      }
      grid.push(values);
      formulaGrid.push(formulaFlags);
    }

    // Extract merged cell ranges
    const mergedRanges: Array<{ top: number; left: number; bottom: number; right: number }> = [];
    // worksheet.model.merges is an array of range strings like "A1:C3"
    const merges = (worksheet.model as { merges?: string[] }).merges ?? [];
    for (const mergeStr of merges) {
      // Parse "A1:C3" → {top, left, bottom, right} (0-indexed)
      const parts = mergeStr.split(":");
      if (parts.length !== 2) continue;
      const tl = parseCellRef(parts[0]);
      const br = parseCellRef(parts[1]);
      if (tl && br) {
        mergedRanges.push({ top: tl.row, left: tl.col, bottom: br.row, right: br.col });
      }
    }

    // Propagate merged cell values
    resolveMergedCells(grid, mergedRanges);

    // Detect regions
    const regions = detectRegions(grid, mergedRanges);

    if (regions.length === 0) continue;

    // If only one region found and it's worse than existing, skip
    if (regions.length === 1 && existingManifest) {
      const r = regions[0];
      const regionColCount = r.endCol - r.startCol + 1;
      if (regionColCount <= existingManifest.columnCount) continue;
    }

    // Build a manifest for each region
    for (let ri = 0; ri < regions.length; ri++) {
      const region = regions[ri];
      const regionColCount = region.endCol - region.startCol + 1;

      // Skip unsafe regions with very low confidence
      if (region.type === "unsafe" && region.confidence < 0.4) continue;

      // Determine headers
      let headers: string[];
      const headerRowInGrid = region.headerRow;

      // Check for multi-row headers: look one row above for merged cells
      let headerStartRow = headerRowInGrid;
      if (headerRowInGrid > region.startRow) {
        const hasMergeAbove = mergedRanges.some(
          (m) => m.top <= headerRowInGrid - 1 && m.bottom >= headerRowInGrid &&
                 m.left >= region.startCol && m.right <= region.endCol,
        );
        if (hasMergeAbove) headerStartRow = headerRowInGrid - 1;
      }

      if (headerStartRow < headerRowInGrid) {
        // Multi-row header: collapse
        headers = collapseMultiRowHeaders(grid, headerStartRow, headerRowInGrid, regionColCount);
      } else {
        // Single-row header
        const headerRow = grid[headerRowInGrid] ?? [];
        headers = [];
        for (let c = region.startCol; c <= region.endCol; c++) {
          headers.push(normalizeHeader(headerRow[c], c - region.startCol));
        }
      }

      // Deduplicate header names
      const headerCounts = new Map<string, number>();
      headers = headers.map((h) => {
        const count = headerCounts.get(h) ?? 0;
        headerCounts.set(h, count + 1);
        return count > 0 ? `${h}_${count + 1}` : h;
      });

      // Build rows from data area (after header)
      const dataStartRow = headerRowInGrid + 1;
      const colStats = new Map<string, StreamingColumnStats>();
      const headSample: Record<string, unknown>[] = [];
      const reservoirSample: Record<string, unknown>[] = [];
      const tailBuffer: Record<string, unknown>[] = [];
      let dataRowCount = 0;

      // Track formula columns (columns where values are computed, not input)
      const formulaColumns = new Set<string>();

      // Gzip blob for this region
      const gzipChunks: Buffer[] = [];
      const gzip = createGzip({ level: 6 });
      gzip.on("data", (chunk: Buffer) => gzipChunks.push(chunk));
      const gzipDone = new Promise<void>((resolve, reject) => {
        gzip.on("finish", resolve);
        gzip.on("error", reject);
      });

      for (let r = dataStartRow; r <= region.endRow; r++) {
        const row = grid[r];
        if (!row) continue;

        // Extract values for this region's column range
        const values = row.slice(region.startCol, region.endCol + 1);
        if (values.every((v) => v === null || v === undefined || String(v).trim() === "")) continue;

        // Check for formula cells in this row's region columns
        const rowFormulas = formulaGrid[r]?.slice(region.startCol, region.endCol + 1) ?? [];
        for (let i = 0; i < headers.length; i++) {
          if (rowFormulas[i]) formulaColumns.add(headers[i]);
        }

        const obj: Record<string, unknown> = {};
        for (let i = 0; i < headers.length; i++) {
          obj[headers[i]] = normalizeCell(values[i]);
        }

        gzip.write(JSON.stringify(obj) + "\n");

        // Sampling
        if (headSample.length < 40) {
          headSample.push(obj);
        } else {
          if (reservoirSample.length < 200) {
            reservoirSample.push(obj);
          } else {
            const j = Math.floor(Math.random() * (dataRowCount + 1));
            if (j < 200) reservoirSample[j] = obj;
          }
        }
        tailBuffer[dataRowCount % 20] = obj;
        updateColumnStats(colStats, obj);
        dataRowCount++;
      }

      gzip.end();
      await gzipDone;

      if (dataRowCount === 0) continue;

      const columns = headers.map((h) => buildColumnFromStats(h, colStats.get(h), dataRowCount));
      const columnProfile = buildProfileFromStats(colStats, dataRowCount);

      const tail = dataRowCount <= 40
        ? []
        : Array.from({ length: Math.min(20, dataRowCount - 40) }, (_, i) =>
            tailBuffer[(dataRowCount - Math.min(20, dataRowCount - 40) + i) % 20],
          ).filter(Boolean);

      // Build sheet name: include region index if multiple regions
      const regionSuffix = regions.length > 1 ? ` [region ${ri + 1}]` : "";
      const sheetName = `${fileName} · ${wsName}${regionSuffix}`;
      const sheetKey = `${fileId}:${sheetName}`;

      manifests.push({
        sheetKey,
        sheetName,
        sourceFileId: fileId,
        sourceFileName: fileName,
        sourceRole: role,
        rowCount: dataRowCount,
        columnCount: headers.length,
        columns,
        sampleRows: [...headSample, ...reservoirSample, ...tail],
        columnProfile,
        blobBuffer: Buffer.concat(gzipChunks),
        // Region metadata
        regionId: `${fileId}:${wsName}:region-${ri + 1}`,
        regionIndex: ri,
        regionType: region.type,
        regionConfidence: region.confidence,
        regionBounds: {
          startRow: region.startRow,
          endRow: region.endRow,
          startCol: region.startCol,
          endCol: region.endCol,
          headerStartRow: headerStartRow,
          headerEndRow: headerRowInGrid,
          dataStartRow,
        },
        sourceSheetKey: existingKey,
        formulaColumns: Array.from(formulaColumns),
      });
    }
  }

  return manifests;
}

/**
 * Parse a cell reference like "A1" or "BC42" to 0-indexed {row, col}.
 */
function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const letters = match[1].toUpperCase();
  const rowNum = parseInt(match[2], 10) - 1; // 0-indexed
  let colNum = 0;
  for (let i = 0; i < letters.length; i++) {
    colNum = colNum * 26 + (letters.charCodeAt(i) - 64);
  }
  colNum -= 1; // 0-indexed
  return { row: rowNum, col: colNum };
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
