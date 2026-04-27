import { read, utils, type WorkBook, type WorkSheet } from "xlsx";

export type WorkbookEvidenceSourceFile = {
  fileName: string;
  kind: string;
  buffer: Buffer;
};

export type WorkbookEvidencePacket = {
  filename: string;
  content: string;
};

type ParsedColumn = {
  index: number;
  name: string;
  group: string | null;
  year: number | null;
};

type ParsedSheet = {
  name: string;
  headerRowIndex: number;
  columns: ParsedColumn[];
  rows: unknown[][];
};

const MAX_SHEETS_PER_WORKBOOK = 4;
const MAX_DIMENSION_BREAKDOWNS = 8;
const MAX_DIMENSION_VALUES = 25;

export function buildWorkbookEvidencePackets(files: WorkbookEvidenceSourceFile[]): WorkbookEvidencePacket[] {
  return files
    .filter((file) => file.kind === "workbook")
    .flatMap((file, index) => buildWorkbookEvidencePacket(file, index));
}

function buildWorkbookEvidencePacket(file: WorkbookEvidenceSourceFile, index: number): WorkbookEvidencePacket[] {
  let workbook: WorkBook;
  try {
    workbook = read(file.buffer, {
      type: file.fileName.toLowerCase().endsWith(".csv") ? "string" : "buffer",
      cellDates: true,
      raw: true,
    });
  } catch (error) {
    return [{
      filename: buildPacketFilename(index, file.fileName),
      content: [
        "# Basquio Workbook Evidence Packet",
        "",
        `Source file: ${file.fileName}`,
        "",
        `Workbook parse warning: ${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
    }];
  }

  const sheetSections = workbook.SheetNames
    .slice(0, MAX_SHEETS_PER_WORKBOOK)
    .map((sheetName) => buildSheetSection(workbook, sheetName))
    .filter(Boolean);

  if (sheetSections.length === 0) {
    return [];
  }

  return [{
    filename: buildPacketFilename(index, file.fileName),
    content: [
      "# Basquio Workbook Evidence Packet",
      "",
      "This packet was generated deterministically from the uploaded workbook before deck authoring.",
      "Treat the totals and breakdowns below as binding source truth. If raw Excel parsing gives different figures, fix the header parsing before writing narrative_report.md, data_tables.xlsx, deck.pptx, or deck_manifest.json.",
      "Do not replace these figures with estimated market sizes, external benchmarks, or manually typed tables.",
      "",
      `Source file: ${file.fileName}`,
      `Parsed sheets summarized: ${sheetSections.length}`,
      "",
      ...sheetSections,
    ].join("\n"),
  }];
}

function buildSheetSection(workbook: WorkBook, sheetName: string) {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    return "";
  }

  const parsed = parseWorksheet(sheetName, worksheet);
  if (!parsed || parsed.rows.length === 0) {
    return "";
  }

  const measureColumns = parsed.columns.filter((column) => column.year && hasNumericValues(parsed.rows, column.index));
  const dimensionColumns = parsed.columns.filter((column) =>
    !column.year && hasTextValues(parsed.rows, column.index));
  if (measureColumns.length === 0) {
    return [
      `## Sheet: ${sheetName}`,
      "",
      `Rows: ${parsed.rows.length}`,
      `Header row index: ${parsed.headerRowIndex + 1}`,
      `Columns: ${parsed.columns.map((column) => column.name).join(", ")}`,
      "",
      "No year-based numeric measures were detected for deterministic totals.",
    ].join("\n");
  }

  const primaryMeasure = selectPrimaryMeasure(measureColumns);
  const primaryYears = yearsForMeasure(measureColumns, primaryMeasure);
  const latestPrimaryYear = primaryYears.at(-1) ?? null;
  const earliestPrimaryYear = primaryYears[0] ?? null;

  const totalLines = buildMeasureTotalLines(parsed.rows, measureColumns);
  const dimensionLines = latestPrimaryYear
    ? buildDimensionBreakdownLines({
        rows: parsed.rows,
        columns: parsed.columns,
        dimensionColumns,
        measureColumns,
        primaryMeasure,
        earliestPrimaryYear,
        latestPrimaryYear,
      })
    : [];

  return [
    `## Sheet: ${sheetName}`,
    "",
    `Rows: ${parsed.rows.length}`,
    `Header row index: ${parsed.headerRowIndex + 1}`,
    `Canonical columns: ${parsed.columns.map((column) => column.name).join(", ")}`,
    "",
    "### Source totals",
    ...totalLines,
    "",
    ...(dimensionLines.length > 0
      ? [
          "### Top dimension breakdowns",
          ...dimensionLines,
          "",
        ]
      : []),
    "Authoring guardrail: every deck/report/workbook market size, share, CAGR, and focal-entity value must reconcile to these source totals within normal rounding.",
  ].join("\n");
}

function parseWorksheet(sheetName: string, worksheet: WorkSheet): ParsedSheet | null {
  const matrix = worksheetToRowsWithMergeFill(worksheet);
  if (matrix.length === 0) {
    return null;
  }

  const headerRowIndex = detectHeaderRowIndex(matrix);
  const previousHeaderRow = matrix[headerRowIndex - 1] ?? [];
  const headerRow = matrix[headerRowIndex] ?? [];
  const columns = headerRow.map((value, index) => buildColumn(value, previousHeaderRow[index], index));
  const rows = matrix
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((value) => value !== null && value !== ""));

  return {
    name: sheetName,
    headerRowIndex,
    columns,
    rows,
  };
}

function buildColumn(headerValue: unknown, groupValue: unknown, index: number): ParsedColumn {
  const header = stringifyCell(headerValue);
  const group = stringifyCell(groupValue);
  const year = extractYear(header);
  const fallback = `column_${index + 1}`;
  const groupPrefix = group && !extractYear(group) && !looksLikeDimensionHeader(group) ? group : null;
  const baseName = year && groupPrefix
    ? `${groupPrefix}_${year}`
    : header || group || fallback;

  return {
    index,
    name: dedupeBlank(baseName, fallback),
    group: groupPrefix,
    year,
  };
}

function buildMeasureTotalLines(rows: unknown[][], measureColumns: ParsedColumn[]) {
  const grouped = new Map<string, ParsedColumn[]>();
  for (const column of measureColumns) {
    const key = column.group ?? extractMeasureName(column.name);
    grouped.set(key, [...(grouped.get(key) ?? []), column]);
  }

  const lines: string[] = [];
  for (const [measure, columns] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sortedColumns = columns
      .filter((column) => column.year)
      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
    const totals = sortedColumns.map((column) => ({
      year: column.year!,
      total: sumColumn(rows, column.index),
    }));
    const earliest = totals[0];
    const latest = totals.at(-1);
    const cagr = earliest && latest ? computeCagr(earliest.total, latest.total, latest.year - earliest.year) : null;
    lines.push(
      `- ${measure}: ${totals.map((entry) => `${entry.year}=${formatNumber(entry.total)}`).join(", ")}${cagr == null ? "" : `; CAGR ${earliest!.year}-${latest!.year}=${formatPercent(cagr)}`}.`,
    );
  }
  return lines;
}

function buildDimensionBreakdownLines(input: {
  rows: unknown[][];
  columns: ParsedColumn[];
  dimensionColumns: ParsedColumn[];
  measureColumns: ParsedColumn[];
  primaryMeasure: string;
  earliestPrimaryYear: number | null;
  latestPrimaryYear: number;
}) {
  const latestMeasure = input.measureColumns.find((column) =>
    (column.group ?? extractMeasureName(column.name)) === input.primaryMeasure &&
    column.year === input.latestPrimaryYear);
  if (!latestMeasure) {
    return [];
  }
  const earliestMeasure = input.earliestPrimaryYear == null
    ? undefined
    : input.measureColumns.find((column) =>
        (column.group ?? extractMeasureName(column.name)) === input.primaryMeasure &&
        column.year === input.earliestPrimaryYear);
  const totalLatest = sumColumn(input.rows, latestMeasure.index);
  const lines: string[] = [];

  for (const dimension of input.dimensionColumns.slice(0, MAX_DIMENSION_BREAKDOWNS)) {
    const groups = new Map<string, { latest: number; earliest: number }>();
    for (const row of input.rows) {
      const key = stringifyCell(row[dimension.index]);
      if (!key) {
        continue;
      }
      const current = groups.get(key) ?? { latest: 0, earliest: 0 };
      current.latest += toNumber(row[latestMeasure.index]) ?? 0;
      if (earliestMeasure) {
        current.earliest += toNumber(row[earliestMeasure.index]) ?? 0;
      }
      groups.set(key, current);
    }

    const ranked = [...groups.entries()]
      .filter(([, value]) => value.latest !== 0)
      .sort((a, b) => b[1].latest - a[1].latest)
      .slice(0, MAX_DIMENSION_VALUES);
    if (ranked.length <= 1) {
      continue;
    }

    lines.push(`- ${dimension.name} by ${input.primaryMeasure} ${input.latestPrimaryYear}:`);
    for (const [label, value] of ranked) {
      const share = totalLatest > 0 ? value.latest / totalLatest : null;
      const cagr = earliestMeasure && input.earliestPrimaryYear != null
        ? computeCagr(value.earliest, value.latest, input.latestPrimaryYear - input.earliestPrimaryYear)
        : null;
      lines.push(
        `  - ${label}: ${formatNumber(value.latest)}${share == null ? "" : ` (${formatPercent(share)} share)`}${cagr == null ? "" : `; CAGR ${input.earliestPrimaryYear}-${input.latestPrimaryYear}=${formatPercent(cagr)}`}.`,
      );
    }
  }

  return lines;
}

function worksheetToRowsWithMergeFill(worksheet: WorkSheet): unknown[][] {
  const rows = utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });
  const filledRows = rows.map((row) => [...row]);
  const merges = worksheet["!merges"] ?? [];
  for (const merge of merges) {
    const value = filledRows[merge.s.r]?.[merge.s.c] ?? null;
    for (let rowIndex = merge.s.r; rowIndex <= merge.e.r; rowIndex += 1) {
      while ((filledRows[rowIndex] ??= []).length <= merge.e.c) {
        filledRows[rowIndex]!.push(null);
      }
      for (let columnIndex = merge.s.c; columnIndex <= merge.e.c; columnIndex += 1) {
        filledRows[rowIndex]![columnIndex] = value;
      }
    }
  }
  return filledRows;
}

function detectHeaderRowIndex(matrix: unknown[][]) {
  const lookahead = matrix.slice(0, 25);
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [index, row] of lookahead.entries()) {
    const score = scoreHeaderCandidate(row, lookahead[index - 1], lookahead[index + 1]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function scoreHeaderCandidate(row: unknown[], previousRow?: unknown[], nextRow?: unknown[]) {
  const cells = row.map(stringifyCell).filter(Boolean);
  if (cells.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const years = cells.filter((cell) => extractYear(cell)).length;
  const textLike = cells.filter((cell) => !looksNumeric(cell)).length;
  const nextNonEmpty = (nextRow ?? []).map(stringifyCell).filter(Boolean).length;
  const previousMeasureGroups = (previousRow ?? [])
    .map(stringifyCell)
    .filter((cell) => cell && !extractYear(cell) && isLikelyMeasureGroup(cell)).length;

  return (
    cells.length * 10 +
    textLike * 2 +
    years * 6 +
    previousMeasureGroups * 8 +
    (nextNonEmpty >= Math.max(2, Math.floor(cells.length * 0.6)) ? 8 : 0)
  );
}

function selectPrimaryMeasure(measureColumns: ParsedColumn[]) {
  const groups = [...new Set(measureColumns.map((column) => column.group ?? extractMeasureName(column.name)))];
  return groups.find((group) => /\b(value|sales|revenue|eur|valore|vendite|fatturato)\b/i.test(group)) ?? groups[0] ?? "Value";
}

function yearsForMeasure(measureColumns: ParsedColumn[], measure: string) {
  return [...new Set(measureColumns
    .filter((column) => (column.group ?? extractMeasureName(column.name)) === measure)
    .map((column) => column.year)
    .filter((year): year is number => Number.isFinite(year)))]
    .sort((a, b) => a - b);
}

function hasNumericValues(rows: unknown[][], columnIndex: number) {
  return rows.some((row) => toNumber(row[columnIndex]) != null);
}

function hasTextValues(rows: unknown[][], columnIndex: number) {
  return rows.some((row) => {
    const value = stringifyCell(row[columnIndex]);
    return value && !looksNumeric(value);
  });
}

function sumColumn(rows: unknown[][], columnIndex: number) {
  return rows.reduce((sum, row) => sum + (toNumber(row[columnIndex]) ?? 0), 0);
}

function computeCagr(start: number, end: number, periods: number) {
  if (start <= 0 || end <= 0 || periods <= 0) {
    return null;
  }
  return (end / start) ** (1 / periods) - 1;
}

function extractMeasureName(name: string) {
  return name.replace(/[_\s-]?(19\d{2}|20\d{2})\b/g, "").trim() || name;
}

function extractYear(value: string) {
  const match = String(value).match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function looksLikeDimensionHeader(value: string) {
  return /^(world|country|countries|continent|continents|category|brand|brand owner|supplier|retailer|channel|region|area|market)$/i.test(value.trim());
}

function isLikelyMeasureGroup(value: string) {
  return /\b(value|volume|sales|revenue|eur|kg|units|qty|quantity|valore|vendite|fatturato)\b/i.test(value);
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim()
    .replace(/^[€$£¥₹₽₩]/, "")
    .replace(/[€$£¥₹₽₩%]$/g, "")
    .replace(/^(CHF|USD|EUR|GBP|SEK|NOK|DKK|CZK|PLN|BRL|JPY|CNY|KRW|INR|RUB)\s*/i, "")
    .replace(/\s*(CHF|USD|EUR|GBP|SEK|NOK|DKK|CZK|PLN|BRL|JPY|CNY|KRW|INR|RUB)$/i, "")
    .replace(/[‘’ʼ‛`´]/g, "")
    .replace(/\s+/g, "");

  if (!/[0-9]/.test(normalized)) {
    return null;
  }

  let candidate = normalized;
  const lastComma = candidate.lastIndexOf(",");
  const lastDot = candidate.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    candidate = lastComma > lastDot
      ? candidate.replaceAll(".", "").replace(",", ".")
      : candidate.replaceAll(",", "");
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

function stringifyCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function looksNumeric(value: string) {
  return toNumber(value) != null;
}

function formatNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${formatFixed(value / 1_000_000_000)}B (${formatInteger(value)} raw)`;
  }
  if (abs >= 1_000_000) {
    return `${formatFixed(value / 1_000_000)}M (${formatInteger(value)} raw)`;
  }
  if (abs >= 1_000) {
    return `${formatFixed(value / 1_000)}K (${formatInteger(value)} raw)`;
  }
  return formatFixed(value);
}

function formatPercent(value: number) {
  return `${formatFixed(value * 100, 2)}%`;
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function formatFixed(value: number, maxFractionDigits = 3) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  });
}

function dedupeBlank(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function buildPacketFilename(index: number, fileName: string) {
  const base = fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `workbook-${index + 1}`;
  return `basquio-workbook-evidence-packet-${String(index + 1).padStart(2, "0")}-${base}.md`;
}
