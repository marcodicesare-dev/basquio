import Anthropic from "@anthropic-ai/sdk";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";

import type { DatasetProfile } from "@basquio/types";

type ManifestSlide = {
  position: number;
  title: string;
  body?: string;
  bullets?: string[];
  metrics?: Array<{ label: string; value: string; delta?: string }>;
  callout?: { text?: string };
  chartId?: string;
  layoutId?: string;
  slideArchetype?: string;
  pageIntent?: string;
};

type ManifestChart = {
  id: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  bubbleSizeLabel?: string;
  sourceNote?: string;
};

export type UnboundClaim = {
  slideIndex: number;
  slideTitle: string | null;
  location: "title" | "body" | "chart-series" | "chart-axis" | "callout" | "recommendation";
  rawText: string;
  parsedValue: number;
  suggestedAnchor: string | null;
  classification?: "bound-via-derivation" | "bound-via-ratio" | "unbound-external" | "unbound-invented";
};

export type DataPrimacyReport = {
  totalNumericClaims: number;
  boundClaims: number;
  unboundClaims: UnboundClaim[];
  heroUnbound: UnboundClaim[];
  boundRatio: number;
  heroPassed: boolean;
  bodyPassed: boolean;
};

type NumericClaim = UnboundClaim & {
  hero: boolean;
};

type WorkbookVocabulary = {
  valueSet: number[];
  anchors: string[];
  aggregates: Array<{ value: number; anchor: string }>;
  datasetSummary: string;
  workbookSamples: string;
};

export async function validateDataPrimacy(input: {
  client?: Anthropic;
  manifest: {
    slides: ManifestSlide[];
    charts: ManifestChart[];
  };
  datasetProfile: DatasetProfile;
  uploadedWorkbookBuffers: Array<{ fileName: string; buffer: Buffer }>;
  sampleTolerancePct?: number;
}): Promise<DataPrimacyReport> {
  const sampleTolerancePct = input.sampleTolerancePct ?? 1.0;
  const chartById = new Map(input.manifest.charts.map((chart) => [chart.id, chart]));
  const claims = collectNumericClaims(input.manifest.slides, chartById);
  if (claims.length === 0) {
    return {
      totalNumericClaims: 0,
      boundClaims: 0,
      unboundClaims: [],
      heroUnbound: [],
      boundRatio: 1,
      heroPassed: true,
      bodyPassed: true,
    };
  }

  const vocabulary = await buildWorkbookVocabulary(input.uploadedWorkbookBuffers);
  const initiallyUnbound: NumericClaim[] = [];
  let boundClaims = 0;

  for (const claim of claims) {
    if (matchesWorkbookVocabulary(claim.parsedValue, vocabulary, sampleTolerancePct)) {
      boundClaims += 1;
    } else {
      initiallyUnbound.push({
        ...claim,
        suggestedAnchor: vocabulary.anchors[0] ?? null,
      });
    }
  }

  const classifiedUnbound = await classifyUnboundClaims({
    client: input.client,
    claims: initiallyUnbound,
    datasetProfile: input.datasetProfile,
    vocabulary,
  });

  const boundAfterClassification = classifiedUnbound.filter((claim) =>
    claim.classification === "bound-via-derivation" || claim.classification === "bound-via-ratio",
  ).length;
  const finalBoundClaims = boundClaims + boundAfterClassification;
  const heroUnbound = classifiedUnbound.filter((claim) =>
    claim.hero &&
    claim.classification !== "bound-via-derivation" &&
    claim.classification !== "bound-via-ratio" &&
    claim.classification !== "unbound-external",
  );
  const unboundClaims = classifiedUnbound
    .filter((claim) =>
      claim.classification !== "bound-via-derivation" &&
      claim.classification !== "bound-via-ratio",
    )
    .map(stripHeroFlag);

  const boundRatio = claims.length === 0 ? 1 : finalBoundClaims / claims.length;

  return {
    totalNumericClaims: claims.length,
    boundClaims: finalBoundClaims,
    unboundClaims,
    heroUnbound: heroUnbound.map(stripHeroFlag),
    boundRatio,
    heroPassed: heroUnbound.length === 0,
    bodyPassed: boundRatio >= 0.8,
  };
}

function stripHeroFlag(claim: NumericClaim): UnboundClaim {
  const { hero: _hero, ...rest } = claim;
  return rest;
}

function collectNumericClaims(
  slides: ManifestSlide[],
  chartById: Map<string, ManifestChart>,
): NumericClaim[] {
  const claims: NumericClaim[] = [];

  for (const slide of slides) {
    const chart = slide.chartId ? chartById.get(slide.chartId) : undefined;
    claims.push(
      ...extractNumericClaims(slide.position, slide.title, "title", slide.title, true, slide),
      ...extractNumericClaims(slide.position, slide.title, "body", slide.body ?? "", false, slide),
      ...(slide.bullets ?? []).flatMap((bullet) =>
        extractNumericClaims(slide.position, slide.title, inferRecommendationLocation(slide), bullet, false, slide),
      ),
      ...extractNumericClaims(slide.position, slide.title, "callout", slide.callout?.text ?? "", true, slide),
      ...(slide.metrics ?? []).flatMap((metric, index) => [
        ...extractNumericClaims(slide.position, slide.title, "body", metric.value, index === 0, slide),
        ...extractNumericClaims(slide.position, slide.title, "body", metric.delta ?? "", false, slide),
      ]),
      ...extractNumericClaims(slide.position, slide.title, "chart-axis", chart?.xAxisLabel ?? "", false, slide),
      ...extractNumericClaims(slide.position, slide.title, "chart-axis", chart?.yAxisLabel ?? "", false, slide),
      ...extractNumericClaims(slide.position, slide.title, "chart-axis", chart?.bubbleSizeLabel ?? "", false, slide),
      ...extractNumericClaims(slide.position, slide.title, "body", chart?.sourceNote ?? "", false, slide),
    );
  }

  return claims;
}

function extractNumericClaims(
  slideIndex: number,
  slideTitle: string | null,
  location: NumericClaim["location"],
  text: string,
  hero: boolean,
  slide: ManifestSlide,
): NumericClaim[] {
  if (!text) {
    return [];
  }

  return [...text.matchAll(NUMERIC_TOKEN_PATTERN)]
    .flatMap((match): NumericClaim[] => {
      const rawText = match[0]?.trim() ?? "";
      const parsedValue = parseNumericToken(rawText);
      if (parsedValue === null) {
        return [];
      }

      return [{
        slideIndex,
        slideTitle,
        location: location === "body" ? inferRecommendationLocation(slide, location) : location,
        rawText,
        parsedValue,
        suggestedAnchor: null,
        hero,
      }];
    });
}

const NUMERIC_TOKEN_PATTERN = /-?\d[\d.,]*\s*(?:%|€|EUR|Mln|MLN|M|mld|K|pp|bps)?/g;

function inferRecommendationLocation(slide: ManifestSlide, fallback: NumericClaim["location"] = "recommendation") {
  const text = `${slide.layoutId ?? ""} ${slide.slideArchetype ?? ""} ${slide.pageIntent ?? ""}`.toLowerCase();
  return text.includes("recommend") ? "recommendation" : fallback;
}

function parseNumericToken(raw: string) {
  const trimmed = raw.trim();
  const unitMatch = trimmed.match(/(%|€|EUR|Mln|MLN|M|mld|K|pp|bps)$/i);
  const unit = unitMatch?.[1]?.toLowerCase() ?? "";
  const numericPart = unit ? trimmed.slice(0, -unitMatch![1].length).trim() : trimmed;
  const parsed = parseLocalizedNumber(numericPart);
  if (parsed === null) {
    return null;
  }

  const multiplier =
    unit === "mld" ? 1_000_000_000
      : unit === "mln" || unit === "m" ? 1_000_000
      : unit === "k" ? 1_000
      : 1;

  return parsed * multiplier;
}

function parseLocalizedNumber(value: string) {
  const cleaned = value.replace(/\s+/g, "");
  if (!cleaned) {
    return null;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalSeparator =
    lastComma > lastDot ? ","
      : lastDot > lastComma ? "."
      : null;

  let normalized = cleaned;
  if (decimalSeparator === ",") {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (decimalSeparator === ".") {
    normalized = cleaned.replace(/,/g, "");
  } else {
    normalized = cleaned.replace(/[.,](?=\d{3}\b)/g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function buildWorkbookVocabulary(
  uploadedWorkbookBuffers: Array<{ fileName: string; buffer: Buffer }>,
): Promise<WorkbookVocabulary> {
  const valueSet = new Set<number>();
  const anchors: string[] = [];
  const aggregates: Array<{ value: number; anchor: string }> = [];
  const datasetSummaryParts: string[] = [];
  const workbookSamples: Array<Record<string, unknown>> = [];

  for (const workbookFile of uploadedWorkbookBuffers) {
    const workbook = new ExcelJS.Workbook();
    if (workbookFile.fileName.toLowerCase().endsWith(".csv")) {
      await workbook.csv.read(Readable.from([workbookFile.buffer]));
    } else {
      await workbook.xlsx.read(Readable.from([workbookFile.buffer]));
    }

    for (const worksheet of workbook.worksheets) {
      const rows = worksheet.getSheetValues().slice(1).map((row) => Array.isArray(row) ? row.slice(1) : []);
      const headers = (rows[0] ?? []).map((value, index) => normalizeHeader(value, index));
      const bodyRows = rows.slice(1).filter((row) => row.some((value) => value !== null && value !== undefined && `${value}`.trim() !== ""));
      datasetSummaryParts.push(`${worksheet.name}: ${bodyRows.length} rows, ${headers.length} columns`);

      for (let rowIndex = 0; rowIndex < Math.min(bodyRows.length, 200); rowIndex += 1) {
        workbookSamples.push({
          sheet: worksheet.name,
          row: rowIndex + 1,
          values: Object.fromEntries(headers.map((header, colIndex) => [header, bodyRows[rowIndex]?.[colIndex] ?? null])),
        });
      }

      const numericByColumn = headers.map((header, colIndex) => ({
        header,
        values: bodyRows
          .map((row) => normalizeNumericCell(row[colIndex]))
          .filter((value): value is number => value !== null),
      }));

      for (const column of numericByColumn) {
        anchors.push(`${worksheet.name}.${column.header}`);
        for (const value of column.values) {
          addComparableValues(valueSet, value);
        }
        for (const aggregate of buildAggregates(column.values)) {
          addComparableValues(valueSet, aggregate.value);
          aggregates.push({
            value: aggregate.value,
            anchor: `${worksheet.name}.${column.header}.${aggregate.label}`,
          });
        }
      }
    }
  }

  return {
    valueSet: [...valueSet],
    anchors,
    aggregates,
    datasetSummary: datasetSummaryParts.join("\n"),
    workbookSamples: JSON.stringify(workbookSamples.slice(0, 200), null, 2),
  };
}

function normalizeHeader(value: ExcelJS.CellValue | undefined, index: number) {
  const text = typeof value === "string" ? value.trim() : `${value ?? ""}`.trim();
  return text || `column_${index + 1}`;
}

function normalizeNumericCell(value: ExcelJS.CellValue | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return null;
  }
  if (typeof value === "string") {
    return parseLocalizedNumber(value);
  }
  if (value && typeof value === "object" && "result" in value) {
    const formulaResult = (value as { result?: unknown }).result;
    return typeof formulaResult === "number" && Number.isFinite(formulaResult) ? formulaResult : null;
  }
  return null;
}

function addComparableValues(target: Set<number>, value: number) {
  if (!Number.isFinite(value)) {
    return;
  }

  const comparableValues = new Set<number>([
    value,
    roundNumber(value, 4),
    roundNumber(value, 2),
    roundNumber(value, 1),
    roundNumber(value, 0),
  ]);

  if (value >= 0 && value <= 1) {
    comparableValues.add(roundNumber(value * 100, 4));
    comparableValues.add(roundNumber(value * 100, 2));
    comparableValues.add(roundNumber(value * 100, 1));
  }

  for (const comparable of comparableValues) {
    if (Number.isFinite(comparable)) {
      target.add(comparable);
    }
  }
}

function buildAggregates(values: number[]) {
  if (values.length === 0) {
    return [];
  }

  const sorted = [...values].sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total + value, 0);
  const mean = sum / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[(sorted.length / 2) - 1]! + sorted[sorted.length / 2]!) / 2
    : sorted[Math.floor(sorted.length / 2)]!;

  return [
    { label: "min", value: sorted[0]! },
    { label: "max", value: sorted[sorted.length - 1]! },
    { label: "mean", value: mean },
    { label: "median", value: median },
    { label: "sum", value: sum },
    { label: "count", value: values.length },
  ];
}

function matchesWorkbookVocabulary(value: number, vocabulary: WorkbookVocabulary, tolerancePct: number) {
  for (const candidate of vocabulary.valueSet) {
    if (matchesWithinTolerance(value, candidate, tolerancePct)) {
      return true;
    }
  }

  for (const aggregate of vocabulary.aggregates) {
    if (matchesWithinTolerance(value, aggregate.value, tolerancePct)) {
      return true;
    }
  }

  return false;
}

function matchesWithinTolerance(value: number, candidate: number, tolerancePct: number) {
  if (Math.abs(value - candidate) < 1e-9) {
    return true;
  }

  if (Number.isInteger(value) && Number.isInteger(candidate) && value === candidate) {
    return true;
  }

  const denominator = Math.max(Math.abs(candidate), 1);
  return (Math.abs(value - candidate) / denominator) * 100 <= tolerancePct;
}

async function classifyUnboundClaims(input: {
  client?: Anthropic;
  claims: NumericClaim[];
  datasetProfile: DatasetProfile;
  vocabulary: WorkbookVocabulary;
}) {
  if (input.claims.length === 0) {
    return input.claims;
  }

  if (!input.client) {
    return input.claims.map((claim) => ({
      ...claim,
      classification: "unbound-invented" as const,
    }));
  }

  const prompt = [
    "You classify numeric claims as bound or unbound to an uploaded dataset.",
    "",
    "INPUT:",
    "- A list of unbound claim candidates (from pass 1 regex match)",
    "- The full dataset profile (sheet names, column names, sample values, aggregates)",
    "- The full uploaded workbook data (first 200 rows per sheet)",
    "",
    "For each candidate, return one of:",
    '- "bound-via-derivation": the number can be computed from uploaded cells via reasonable arithmetic (e.g., percentage of a count)',
    '- "bound-via-ratio": the number is a ratio or weighted average derivable from uploaded columns',
    '- "unbound-external": the number is clearly from an external source (cited with URL, labeled "Market context")',
    '- "unbound-invented": the number has no plausible derivation path from uploaded data and is not labeled external',
    "",
    "Respond with JSON array matching the input order.",
    "",
    "CANDIDATES:",
    JSON.stringify(input.claims.map(stripHeroFlag), null, 2),
    "",
    "DATASET PROFILE:",
    JSON.stringify(input.datasetProfile, null, 2),
    "",
    "AGGREGATES:",
    input.vocabulary.datasetSummary,
    "",
    "WORKBOOK SAMPLE:",
    input.vocabulary.workbookSamples,
  ].join("\n");

  const response = await input.client.beta.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1_600,
    messages: [{
      role: "user",
      content: [{ type: "text", text: prompt }],
    }],
  });

  const rawText = response.content
    .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
    .join("\n");
  const parsed = JSON.parse(stripFence(rawText)) as Array<NumericClaim["classification"]>;

  return input.claims.map((claim, index) => ({
    ...claim,
    classification: parsed[index] ?? "unbound-invented",
  }));
}

function stripFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function roundNumber(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
