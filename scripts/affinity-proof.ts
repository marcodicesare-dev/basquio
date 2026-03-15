import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  computeAnalytics,
  interpretPackageSemantics,
  planMetrics,
  planReportOutline,
  planSlides,
  planStory,
  profileDataset,
  rankInsights,
  runDeterministicValidation,
} from "@basquio/intelligence";
import { renderPdfArtifact } from "@basquio/render-pdf";
import { renderPptxArtifact } from "@basquio/render-pptx";
import { interpretTemplateSource } from "@basquio/template-engine";
import type { DatasetProfile, NormalizedSheet, NormalizedWorkbook, ReportBrief } from "@basquio/types";
import { read, utils } from "xlsx";

const outputDir = path.resolve(process.cwd(), "output", "affinity-proof");
const brief: ReportBrief = {
  businessContext:
    "Affinity Petcare FMCG market review in Italian petfood using NielsenIQ sell-out data. Generate an executive-ready category and brand analysis using the Seminario RMS deck as the presentation template and brand system.",
  client: "Affinity Petcare",
  audience: "Executive leadership and commercial stakeholders",
  objective:
    "Create a 15-slide deck that surfaces the most important market, category, competitive, and Affinity-specific performance signals from the dataset.",
  thesis:
    "Affinity needs a crisp view of where it is winning, where it is structurally under-indexed, and which category and segment plays should shape the next commercial plan.",
  stakes: "The output is intended to look like a client-ready strategy deck, not a data dump.",
};

function timed<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const start = Date.now();
  return Promise.resolve(fn()).then((value) => {
    console.log(`[stage] ${label} ${((Date.now() - start) / 1000).toFixed(2)}s`);
    return value;
  });
}

function normalizeHeader(value: unknown, index: number) {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return raw.length > 0 ? raw : `column_${index + 1}`;
}

function parseNumericString(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const normalizedNa = trimmed.toLowerCase();
  if (normalizedNa === "na" || normalizedNa === "n/a" || normalizedNa === "null") return null;

  let candidate = trimmed.replace(/[€$£¥%]/g, "").replace(/\s+/g, "").replace(/[’']/g, "");
  if (!/[0-9]/.test(candidate)) return null;

  const lastComma = candidate.lastIndexOf(",");
  const lastDot = candidate.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    candidate = lastComma > lastDot ? candidate.replaceAll(".", "").replace(",", ".") : candidate.replaceAll(",", "");
  } else if (lastComma >= 0) {
    const decimalDigits = candidate.length - lastComma - 1;
    candidate = decimalDigits > 0 && decimalDigits <= 2 ? candidate.replace(",", ".") : candidate.replaceAll(",", "");
  }

  if (!/^-?\d+(\.\d+)?$/.test(candidate)) return null;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCell(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return parseNumericString(trimmed) ?? trimmed;
  }
  return value ?? null;
}

function inferType(values: unknown[]) {
  if (values.length === 0) return "unknown" as const;
  if (values.every((value) => typeof value === "number")) return "number" as const;
  if (values.every((value) => typeof value === "string" && !Number.isNaN(Date.parse(value)) && /[-/]/.test(value))) {
    return "date" as const;
  }
  if (values.every((value) => typeof value === "boolean")) return "boolean" as const;
  return "string" as const;
}

function inferRole(columnName: string, inferredType: string) {
  const normalizedName = columnName.toLowerCase();
  if (
    inferredType === "date" ||
    normalizedName.includes("date") ||
    normalizedName.includes("month") ||
    normalizedName.includes("sett")
  ) {
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
    normalizedName.includes("category") ||
    normalizedName.includes("mercato") ||
    normalizedName.includes("fornitore") ||
    normalizedName.includes("marca") ||
    normalizedName.includes("famiglia") ||
    normalizedName.includes("comparto")
  ) {
    return "segment" as const;
  }
  if (inferredType === "number") return "measure" as const;
  if (inferredType === "string") return "dimension" as const;
  return "unknown" as const;
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
    sampleValues: nonNullValues.slice(0, 10).map((value) => String(value)),
    uniqueCount: new Set(nonNullValues.map((value) => String(value))).size,
    nullRate: rows.length === 0 ? 0 : (rows.length - nonNullValues.length) / rows.length,
  } as const;
}

function sampleRows(rows: Array<Record<string, unknown>>, limit: number) {
  if (rows.length <= limit) return rows;
  const lastIndex = rows.length - 1;
  return Array.from({ length: limit }, (_, index) => {
    if (index === limit - 1) {
      return rows[lastIndex];
    }
    const sampledIndex = Math.floor((index * rows.length) / limit);
    return rows[Math.min(lastIndex, sampledIndex)];
  });
}

function scoreHeaderCandidate(row: unknown[], nextRow?: unknown[]) {
  const cells = row.map((value) => String(value ?? "").trim()).filter(Boolean);
  const nonEmptyCount = cells.length;
  if (nonEmptyCount === 0) return Number.NEGATIVE_INFINITY;
  const textLikeCount = cells.filter((cell) => parseNumericString(cell) === null).length;
  const nextRowNonEmptyCount = (nextRow ?? []).filter((value) => String(value ?? "").trim().length > 0).length;
  return (
    nonEmptyCount * 10 +
    textLikeCount * 2 +
    (nonEmptyCount >= 2 ? 5 : -20) +
    (nextRowNonEmptyCount >= Math.max(2, Math.floor(nonEmptyCount * 0.6)) ? 8 : 0)
  );
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

async function parseAffinityCsv(): Promise<{ datasetProfile: DatasetProfile; normalizedWorkbook: NormalizedWorkbook }> {
  const sourceRole = "supporting-fact-table" as const;
  console.log("[parseAffinityCsv] read:start");
  const csv = await readFile("/Users/marcodicesare/Downloads/Estrazione Item Pet 2025.csv");
  console.log(`[parseAffinityCsv] read:done ${csv.byteLength}`);
  const workbook = read(csv.toString("utf8"), { type: "string", cellDates: true, raw: false });
  console.log(`[parseAffinityCsv] workbook:done ${workbook.SheetNames.join(",")}`);
  const workbookSheets: NormalizedSheet[] = workbook.SheetNames.map((sheetName) => {
    console.log(`[parseAffinityCsv] sheet:start ${sheetName}`);
    const sheet = workbook.Sheets[sheetName];
    const matrix = utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][];
    console.log(`[parseAffinityCsv] sheet:matrix ${sheetName} ${matrix.length}`);
    const headerIndex = detectHeaderRowIndex(matrix);
    console.log(`[parseAffinityCsv] sheet:headerIndex ${sheetName} ${headerIndex}`);
    const headerRow = matrix[headerIndex] ?? [];
    const bodyRows = matrix.slice(headerIndex + 1);
    const headers = (headerRow.length > 0 ? headerRow : ["column_1"]).map((value, index) => normalizeHeader(value, index));
    console.log(`[parseAffinityCsv] sheet:headers ${sheetName} ${headers.length}`);
    const rows = bodyRows
      .filter((row) => row.some((value) => value !== null && value !== ""))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, normalizeCell(row[index])])))
      .filter((row) => Object.values(row).some((value) => value !== null && value !== ""));
    console.log(`[parseAffinityCsv] sheet:rows ${sheetName} ${rows.length}`);
    const columns = headers.map((header) => inferColumn(rows, header));
    console.log(`[parseAffinityCsv] sheet:columns ${sheetName} ${columns.length}`);
    return {
      name: workbook.SheetNames.length > 1 ? `Estrazione Item Pet 2025.csv · ${sheetName}` : "Estrazione Item Pet 2025.csv",
        rowCount: rows.length,
        sourceFileId: "affinity-proof-file-1",
        sourceFileName: "Estrazione Item Pet 2025.csv",
        sourceRole,
        columns,
        sampleRows: sampleRows(rows, 20),
        rows,
    };
  }).filter((sheet) => sheet.rowCount > 0 || sheet.columns.length > 0);
  console.log(`[parseAffinityCsv] workbookSheets ${workbookSheets.length}`);

  const warnings = [
    "No methodology or definitions guide was provided; methodology framing will rely on the uploaded brief and inferred package roles.",
    "No file was confidently classified as the main analytical table; Basquio is using the first workbook as the primary source.",
  ];

  const datasetProfile: DatasetProfile = {
    datasetId: "affinity-proof",
    sourceFileName: "Estrazione Item Pet 2025.csv",
    sourceFiles: [
      {
        id: "affinity-proof-file-1",
        fileName: "Estrazione Item Pet 2025.csv",
        role: sourceRole,
        mediaType: "text/csv",
        kind: "workbook",
        parsedSheetCount: workbookSheets.length,
        notes: [],
      },
    ],
    manifest: {
      datasetId: "affinity-proof",
      packageLabel: "Estrazione Item Pet 2025.csv",
      files: [
        {
          id: "affinity-proof-file-1",
          fileName: "Estrazione Item Pet 2025.csv",
          mediaType: "text/csv",
          kind: "workbook",
          role: sourceRole,
          parsedSheetCount: workbookSheets.length,
          notes: [],
        },
      ],
      primaryFileId: "affinity-proof-file-1",
      methodologyFileIds: [],
      validationFileIds: [],
      citationFileIds: [],
      warnings,
    },
    sheets: workbookSheets.map(({ rows, ...sheet }) => sheet),
    warnings,
  };

  const normalizedWorkbook: NormalizedWorkbook = {
    datasetId: "affinity-proof",
    sourceFileName: "Estrazione Item Pet 2025.csv",
    files: [
      {
        id: "affinity-proof-file-1",
        fileName: "Estrazione Item Pet 2025.csv",
        mediaType: "text/csv",
        kind: "workbook",
        role: sourceRole,
        sheets: workbookSheets.map(({ rows, ...sheet }) => sheet),
        warnings: [],
      },
    ],
    sheets: workbookSheets,
  };
  console.log("[parseAffinityCsv] done");

  return { datasetProfile, normalizedWorkbook };
}

async function main() {
  console.log("[boot] main:start");
  await mkdir(outputDir, { recursive: true });
  console.log("[boot] outputDir:ready");
  const pptxBuffer = await readFile("/Users/marcodicesare/Downloads/Seminario RMS 2026 Training.pptx");
  console.log(`[boot] template:loaded ${pptxBuffer.byteLength}`);

  const parsed = await timed("parseAffinityCsv", () => parseAffinityCsv());
  const datasetProfile = await timed("profileDataset", () => profileDataset(parsed.datasetProfile));
  const packageSemantics = await timed("interpretPackageSemantics", () =>
    interpretPackageSemantics({
      datasetProfile,
      workbook: parsed.normalizedWorkbook,
      brief,
    }),
  );
  const metricPlan = await timed("planMetrics", () =>
    planMetrics({
      datasetProfile,
      packageSemantics,
      brief,
    }),
  );
  const analyticsResult = await timed("computeAnalytics", () =>
    computeAnalytics({
      datasetProfile,
      workbook: parsed.normalizedWorkbook,
      packageSemantics,
      metricPlan,
    }),
  );
  const insights = await timed("rankInsights", () =>
    rankInsights({
      analyticsResult,
      packageSemantics,
      brief,
    }),
  );
  const story = await timed("planStory", () =>
    planStory({
      analyticsResult,
      insights,
      packageSemantics,
      brief,
    }),
  );
  const reportOutline = await timed("planReportOutline", () =>
    planReportOutline({
      story,
      insights,
      brief,
    }),
  );
  const templateProfile = await timed("interpretTemplateSource", () =>
    interpretTemplateSource({
      id: "affinity-proof-template",
      fileName: "Seminario RMS 2026 Training.pptx",
      sourceFile: {
        fileName: "Seminario RMS 2026 Training.pptx",
        mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        base64: pptxBuffer.toString("base64"),
      },
    }),
  );
  const slidePlan = await timed("planSlides", () =>
    planSlides({
      analyticsResult,
      story,
      outline: reportOutline,
      insights,
      templateProfile,
      brief,
    }),
  );
  const validation = await timed("runDeterministicValidation", () =>
    runDeterministicValidation({
      jobId: "affinity-proof",
      analyticsResult,
      insights,
      slides: slidePlan.slides,
      charts: slidePlan.charts,
      story,
      stageTraces: [],
      attemptCount: 1,
    }),
  );

  const pptxArtifact = await timed("renderPptxArtifact", () =>
    renderPptxArtifact({
      deckTitle: story.title || "Affinity Petcare analysis",
      slidePlan: slidePlan.slides,
      charts: slidePlan.charts,
      templateProfile,
      templateFile: {
        fileName: "Seminario RMS 2026 Training.pptx",
        base64: pptxBuffer.toString("base64"),
      },
    }),
  );
  const pdfArtifact = await timed("renderPdfArtifact", () =>
    renderPdfArtifact({
      deckTitle: story.title || "Affinity Petcare analysis",
      slidePlan: slidePlan.slides,
      charts: slidePlan.charts,
      templateProfile,
    }),
  );

  await writeFile(path.join(outputDir, pptxArtifact.fileName), Buffer.from(pptxArtifact.buffer as Buffer));
  await writeFile(path.join(outputDir, pdfArtifact.fileName), Buffer.from(pdfArtifact.buffer as Buffer));
  await writeFile(
    path.join(outputDir, "summary.json"),
    JSON.stringify(
      {
        datasetProfile,
        packageSemantics,
        metricPlan,
        analyticsResult,
        insights,
        story,
        reportOutline,
        templateProfile,
        slidePlan,
        validation,
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        outputDir,
        slideCount: slidePlan.slides.length,
        chartCount: slidePlan.charts.length,
        validationStatus: validation.status,
        issueCount: validation.issues.length,
        topSlideTitles: slidePlan.slides.slice(0, 15).map((slide) => slide.title),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
