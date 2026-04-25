import { createHash } from "node:crypto";

import { read, utils } from "xlsx";

import type { FidelitySheetInput } from "@basquio/intelligence";

export function extractWorkbookSheetProfiles(buffer: Buffer): FidelitySheetInput[] {
  const workbook = read(buffer, {
    type: "buffer",
    raw: true,
    cellDates: true,
  });

  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const matrix = utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    }) as unknown[][];
    const normalizedRows = matrix
      .map((row) => densifyWorkbookRow(Array.isArray(row) ? row : []))
      .filter((row) => row.some((cell) => cell !== null && cell !== ""));
    const maxColumnCount = normalizedRows.reduce((max, row) => Math.max(max, row.length), 0);
    const headerRow = normalizedRows[0] ?? [];
    const headers = Array.from(
      { length: maxColumnCount },
      (_, index) => normalizeWorkbookHeader(headerRow[index], index),
    );
    const rowObjects = normalizedRows
      .slice(1)
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null] as const)))
      .filter((row) => Object.values(row).some((value) => value !== null && value !== ""));
    const numericValues = rowObjects.flatMap((row) =>
      Object.values(row)
        .map((value) => typeof value === "number" && Number.isFinite(value) ? value : null)
        .filter((value): value is number => value !== null),
    );

    return {
      name: sheetName,
      headers,
      rows: rowObjects,
      numericValues,
      dataSignature: createHash("sha256")
        .update(JSON.stringify({ headers, rows: rowObjects }))
        .digest("hex")
        .slice(0, 16),
    };
  });
}

function densifyWorkbookRow(row: unknown[]) {
  return Array.from({ length: row.length }, (_, index) => normalizeWorkbookCell(row[index]));
}

function normalizeWorkbookHeader(value: unknown, index: number) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return `column_${index + 1}`;
}

function normalizeWorkbookCell(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return value ?? null;
}
