import { read, utils } from "xlsx";

import {
  datasetProfileSchema,
  deterministicAnalysisSchema,
  type DatasetProfile,
  type DeterministicAnalysis,
  normalizedWorkbookSchema,
  type NormalizedWorkbook,
} from "@basquio/types";

type ParseWorkbookInput = {
  datasetId: string;
  fileName: string;
  buffer: Buffer;
};

export function parseWorkbookBuffer(input: ParseWorkbookInput): {
  datasetProfile: DatasetProfile;
  normalizedWorkbook: NormalizedWorkbook;
} {
  const workbook = read(input.buffer, {
    type: "buffer",
    cellDates: true,
  });

  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const matrix = utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: false,
    }) as unknown[][];

    const [headerRow = [], ...bodyRows] = matrix;
    const headers = (headerRow.length > 0 ? headerRow : [`column_1`]).map((value, index) =>
      normalizeHeader(value, index),
    );

    const rows = bodyRows
      .filter((row) => row.some((value) => value !== null && value !== ""))
      .map((row) =>
        Object.fromEntries(headers.map((header, index) => [header, normalizeCell(row[index])])),
      );

    const columns = headers.map((header) => inferColumn(rows, header));

    return {
      name: sheetName,
      rowCount: rows.length,
      columns,
      rows,
    };
  }).filter((sheet) => sheet.rowCount > 0 || sheet.columns.length > 0);

  const warnings = sheets.length === 0 ? ["Workbook did not expose any readable tabular sheets."] : [];

  const datasetProfile = datasetProfileSchema.parse({
    datasetId: input.datasetId,
    sourceFileName: input.fileName,
    sheets: sheets.map(({ rows, ...sheet }) => sheet),
    warnings,
  });

  const normalizedWorkbook = normalizedWorkbookSchema.parse({
    datasetId: input.datasetId,
    sourceFileName: input.fileName,
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
          `${summary.sheet}.${summary.column} has ${summary.numericCount} numeric rows ready for deterministic analytics.`,
      ),
    warnings:
      metricSummaries.filter((summary) => summary.numericCount > 0).length === 0
        ? ["No numeric columns were detected during ingest checks."]
        : [],
  });
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

  if (normalizedName.includes("id") || normalizedName.endsWith("_key")) {
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
