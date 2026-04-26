import type { FidelitySheetInput, TitleNumberToken } from "./types";

export const CANONICAL_METRIC_LABELS = new Set([
  "sales value",
  "sales volume",
  "sales units",
  "value share",
  "volume share",
  "share change",
  "share change pts",
  "share change pp",
  "avg price",
  "average price",
  "price",
  "price index",
  "weighted distribution",
  "numeric distribution",
  "distribution",
  "promo intensity",
  "incremental sales",
  "baseline sales",
  "mix",
  "mix gap",
  "growth",
  "value growth",
  "quota",
  "quota val",
  "quota valore",
  "prezzo",
  "prezzo medio",
  "brand",
  "brands",
  "segment",
  "segments",
  "channel",
  "channels",
  "retailer",
  "retailers",
  "period",
  "periodo",
]);

export const FORBIDDEN_INVENTED_LABELS = [
  { label: "acv", message: "Invented label 'ACV' is not allowed unless the source label is shown explicitly." },
  { label: "all commodity value", message: "Invented label 'All Commodity Value' is not allowed unless the source label is shown explicitly." },
  { label: "penetration", message: "Invented label 'Penetration' is not allowed when the source metric is distribution." },
  { label: "brand health", message: "Invented label 'Brand Health' is not grounded in source data." },
];

export const RISKY_RETAILERS = [
  "esselunga",
  "coop",
  "conad",
  "carrefour",
  "selex",
  "vege",
  "vegè",
  "iper",
  "despar",
  "pam",
  "auchan",
  "lidl",
  "md",
  "eurospin",
];

export const PERIOD_PY_PATTERNS = [/\bpy\b/i, /\banno\s+prec\b/i, /\bprior\s+year\b/i];
export const PERIOD_CY_PATTERNS = [/\bcy\b/i, /\banno\s+corr\b/i, /\bcurrent\s+year\b/i];
export const PERIOD_2YA_PATTERNS = [/\b2ya\b/i, /\b2\s+anno\s+prec\b/i, /\btwo\s+years\s+ago\b/i];

export function findHeaderIndex(headers: string[], patterns: RegExp[]) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

export function normalizeLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[():]/g, "")
    .trim();
}

export function normalizeEntity(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksTemporalHeader(header: string) {
  const normalized = normalizeLabel(header);
  return normalized.includes("week")
    || normalized.includes("month")
    || normalized.includes("period")
    || normalized.includes("quarter")
    || normalized.includes("anno")
    || normalized.match(/\b20\d{2}\b/) !== null;
}

export function extractPrimaryNumericSeries(sheet: FidelitySheetInput) {
  if (sheet.rows.length === 0 || sheet.headers.length < 2) {
    return [];
  }

  const numericHeaders = sheet.headers.filter((header, index) => index > 0 && sheet.rows.some((row) => typeof row[header] === "number"));
  const primaryHeader = numericHeaders[0];
  if (!primaryHeader) {
    return [];
  }

  return sheet.rows
    .map((row) => coerceNumber(row[primaryHeader]))
    .filter((value): value is number => value !== null);
}

export function isMonotonic(values: number[], direction: "asc" | "desc") {
  for (let index = 1; index < values.length; index += 1) {
    if (direction === "asc" && values[index] < values[index - 1]) {
      return false;
    }
    if (direction === "desc" && values[index] > values[index - 1]) {
      return false;
    }
  }
  return true;
}

export function countSourceMentions(values: string[]) {
  return values.reduce((total, value) => total + ((value.match(/\b(source|sources|fonte|fonti)\b[: ]/gi) ?? []).length), 0);
}

export function extractTitleNumberTokens(title: string): TitleNumberToken[] {
  const matches = title.matchAll(/([+-]?\d+(?:[.,]\d+)?)\s*(%|pp|pts|pt|mln|m|k|€|eur)?/gi);
  const tokens: TitleNumberToken[] = [];

  for (const match of matches) {
    const raw = match[0]?.trim() ?? "";
    const value = parseLocaleNumber(match[1] ?? "");
    const unit = (match[2] ?? "").toLowerCase();
    if (!raw || value === null) {
      continue;
    }
    tokens.push({ raw, value, unit });
  }

  return tokens;
}

export function parseLocaleNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.includes(",") && trimmed.includes(".")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed.includes(",")
      ? trimmed.replace(",", ".")
      : trimmed;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildComparableWorkbookValues(sheet?: FidelitySheetInput) {
  if (!sheet) {
    return [] as number[];
  }

  const values = new Set<number>();
  for (const numeric of sheet.numericValues) {
    values.add(roundComparable(numeric));
    values.add(roundComparable(numeric * 100));
    values.add(roundComparable(numeric / 1_000));
    values.add(roundComparable(numeric / 1_000_000));
  }
  return [...values];
}

export function buildDerivedComparableValues(sheet?: FidelitySheetInput) {
  if (!sheet) {
    return [] as number[];
  }

  const primarySeries = extractPrimaryNumericSeries(sheet);
  if (primarySeries.length === 0) {
    return [];
  }

  const sum = primarySeries.reduce((total, value) => total + value, 0);
  const avg = sum / primarySeries.length;
  const max = Math.max(...primarySeries);
  return [roundComparable(sum), roundComparable(sum / 1_000_000), roundComparable(avg), roundComparable(max)];
}

export function mentionsDerivation(text: string) {
  return /\b(total|totale|combined|somma|sum|average|media|max|maximum|peak)\b/i.test(text);
}

export function matchesComparableValue(token: TitleNumberToken, comparableValues: number[]) {
  const expected = normalizeTokenComparableValue(token);
  return comparableValues.some((value) => Math.abs(value - expected) <= toleranceForUnit(token.unit, expected));
}

export function normalizeTokenComparableValue(token: TitleNumberToken) {
  if (token.unit === "mln" || token.unit === "m") {
    return roundComparable(token.value);
  }
  return roundComparable(token.value);
}

export function toleranceForUnit(unit: string, value: number) {
  if (unit === "%" || unit === "pp" || unit === "pts" || unit === "pt") {
    return 2;
  }
  if (Math.abs(value) >= 100) {
    return Math.max(1, Math.abs(value) * 0.02);
  }
  return 0.5;
}

export function findClosestComparableValue(token: TitleNumberToken, comparableValues: number[]) {
  if (comparableValues.length === 0) {
    return null;
  }

  const expected = normalizeTokenComparableValue(token);
  return comparableValues.reduce((closest, value) => {
    if (closest === null) {
      return value;
    }
    return Math.abs(value - expected) < Math.abs(closest - expected) ? value : closest;
  }, null as number | null);
}

export function roundComparable(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatComparableValue(value: number, unit: string) {
  if (unit === "%") {
    return `${value}%`;
  }
  if (unit === "pp" || unit === "pts" || unit === "pt") {
    return `${value}pp`;
  }
  if (unit === "mln" || unit === "m") {
    return `${value}M`;
  }
  return `${value}`;
}

export function coerceNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return parseLocaleNumber(value);
  }
  return null;
}
