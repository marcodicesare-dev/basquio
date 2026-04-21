import type {
  ExhibitPresentationSpec,
  MetricPresentationSpec,
  MetricSemanticFamily,
  TemplateProfile,
} from "@basquio/types";

type ExhibitMarkerSymbol = ExhibitPresentationSpec["series"][number]["markerSymbol"];

type MetricPresentationInput = {
  label: string;
  title?: string;
  locale?: string;
};

type WorkbookSheetLike = {
  name: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
};

type WorkbookSheetPresentation = {
  sheetName: string;
  columns: Array<{
    header: string;
    presentation: MetricPresentationSpec;
  }>;
};

const DEFAULT_LOCALE = "en-US";
const DEFAULT_CHART_PALETTE = ["#1A6AFF", "#F0CC27", "#4CC9A0", "#E8636F", "#5D656B", "#D6D1C4"];
const VARIATION_TOKENS = [
  "variation",
  "variazione",
  "delta",
  "change",
  "chg",
  "growth",
  "crescita",
  "vs",
  "uplift",
  "lift",
];
const SCALE_TOKEN_MAP = [
  { token: "thousand", unit: "thousands" },
  { token: "thousands", unit: "thousands" },
  { token: " k", unit: "thousands" },
  { token: "(k)", unit: "thousands" },
  { token: "000", unit: "thousands" },
  { token: "million", unit: "millions" },
  { token: "millions", unit: "millions" },
  { token: " mn", unit: "millions" },
  { token: " mm", unit: "millions" },
  { token: " mln", unit: "millions" },
  { token: "billion", unit: "billions" },
  { token: "billions", unit: "billions" },
  { token: " bn", unit: "billions" },
];

export function inferMetricPresentationSpec(input: MetricPresentationInput): MetricPresentationSpec {
  const locale = input.locale?.trim() || DEFAULT_LOCALE;
  const normalizedLabel = normalizeMetricText(input.label);
  const normalizedTitle = normalizeMetricText(input.title ?? "");
  const combined = `${normalizedLabel} ${normalizedTitle}`.trim();
  const baseText = removeVariationTokens(combined);
  const semanticFamily = inferSemanticFamily(combined, baseText);
  const displayUnit = inferDisplayUnit(semanticFamily, combined);
  const decimalPlaces = inferDecimalPlaces(semanticFamily, combined, displayUnit);
  const variationDisplay = hasVariationToken(combined) ? "auto" : "absolute";
  const excelNumberFormat = buildExcelNumberFormat(displayUnit, decimalPlaces);
  const valueFormat = buildHumanNumberFormat(displayUnit, decimalPlaces);

  return {
    semanticFamily,
    displayUnit,
    decimalPlaces,
    variationDisplay,
    locale,
    excelNumberFormat,
    pptLabelFormat: valueFormat,
    markdownFormat: valueFormat,
  };
}

export function buildWorkbookSheetPresentation(sheet: WorkbookSheetLike): WorkbookSheetPresentation {
  const columns = sheet.headers
    .filter((header, index) =>
      index > 0 &&
      sheet.rows.some((row) => typeof row[header] === "number" && Number.isFinite(row[header] as number)),
    )
    .map((header) => ({
      header,
      presentation: inferMetricPresentationSpec({
        label: header,
        title: sheet.name,
      }),
    }));

  return {
    sheetName: sheet.name,
    columns,
  };
}

export function buildWorkbookSheetPresentations(
  sheets: WorkbookSheetLike[],
): WorkbookSheetPresentation[] {
  return sheets.map((sheet) => buildWorkbookSheetPresentation(sheet)).filter((sheet) => sheet.columns.length > 0);
}

export function buildExhibitPresentationSpec(input: {
  chartId: string;
  chartType: string;
  title: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  selectedHeaders: string[];
  headerPresentations: Record<string, MetricPresentationSpec>;
  templateProfile: TemplateProfile;
  workbookAnchor?: string | null;
}): ExhibitPresentationSpec {
  const chartPalette = resolveChartPalette(input.templateProfile);
  const legendPosition = resolveLegendPosition(input.chartType);
  const series = input.selectedHeaders.map((header, index) => {
    const metricPresentation = input.headerPresentations[header] ?? inferMetricPresentationSpec({
      label: header,
      title: input.title,
    });
    const color = chartPalette[index % chartPalette.length];

    return {
      label: header,
      header,
      color,
      lineColor: color,
      markerSymbol: (normalizeChartType(input.chartType) === "scatter" ? "circle" : "none") as ExhibitMarkerSymbol,
      markerSize: normalizeChartType(input.chartType) === "scatter" ? 8 : 0,
      lineWidth: normalizeChartType(input.chartType) === "line" || normalizeChartType(input.chartType) === "scatter" ? 1.75 : 1,
      metricPresentation,
    };
  });

  const xHeader = input.selectedHeaders[0] ?? input.xAxisLabel ?? input.title;
  const yHeader = input.selectedHeaders[normalizeChartType(input.chartType) === "scatter" ? 1 : 0] ?? input.yAxisLabel ?? input.title;
  const categoryAxisPresentation =
    normalizeChartType(input.chartType) === "scatter"
      ? input.headerPresentations[xHeader] ?? inferMetricPresentationSpec({ label: xHeader, title: input.title })
      : null;
  const valueAxisPresentation =
    input.headerPresentations[yHeader] ?? inferMetricPresentationSpec({ label: yHeader, title: input.title });
  const uniformSeriesFormat = buildUniformSeriesFormat(series);
  const palette = input.templateProfile.brandTokens?.palette;

  return {
    chartFamily: normalizeChartType(input.chartType),
    legendPosition,
    series,
    categoryAxis: {
      label: input.xAxisLabel ?? null,
      numberFormat: categoryAxisPresentation?.excelNumberFormat ?? null,
      textColor: palette?.muted ?? palette?.text ?? null,
    },
    valueAxis: {
      label: input.yAxisLabel ?? null,
      numberFormat: valueAxisPresentation.excelNumberFormat,
      textColor: palette?.muted ?? palette?.text ?? null,
    },
    dataLabelFormat: uniformSeriesFormat,
    chartBackground: palette?.background ?? null,
    plotBackground: palette?.surface ?? null,
    gridlineColor: palette?.border ?? null,
    gridlineWidth: 1,
    brandPaletteSource: input.templateProfile.brandTokens?.chartPalette?.length
      ? "template-chart-palette"
      : input.templateProfile.brandTokens?.palette
        ? "template-core-palette"
        : "basquio-default",
    templateProfileId: input.templateProfile.id,
    templateProfileSource: input.templateProfile.sourceType,
    workbookAnchor: input.workbookAnchor ?? null,
    screenshotChartId: input.chartId,
  };
}

function inferSemanticFamily(combined: string, baseText: string): MetricSemanticFamily {
  if (containsAny(baseText, ["price", "prezzo", "prezzi", "pricing"])) {
    return "price";
  }
  if (containsAny(baseText, ["share", "quota", "quote", "mix"])) {
    return "share";
  }
  if (containsAny(baseText, ["distribution", "distribuzione", "ponderata", "numerica", "numeric", "promo", "promotion"])) {
    return "distribution";
  }
  if (containsAny(baseText, ["tdp"])) {
    return "tdp";
  }
  if (containsAny(baseText, ["rotation", "rotazione", "rotazioni"])) {
    return "rotation";
  }
  if (containsAny(baseText, ["referenze", "assortment", "referenze medie", "reference count"])) {
    return "avg_assortment";
  }
  if (containsAny(baseText, ["intensity", "index", "indice", "indici", "efficacia"])) {
    return "index";
  }
  if (containsAny(baseText, ["volume", "volumi", "qty", "quantity", "confezione", "packs", "units"])) {
    return "sales_volume";
  }
  if (containsAny(combined, ["value", "valore", "sales", "vendite", "revenue"])) {
    return "sales_value";
  }
  return "sales_value";
}

function inferDisplayUnit(
  semanticFamily: MetricSemanticFamily,
  combined: string,
): MetricPresentationSpec["displayUnit"] {
  const scaledUnit = detectScaledUnit(combined);
  if (scaledUnit) {
    return scaledUnit;
  }

  if (semanticFamily === "share" || semanticFamily === "distribution") {
    return "percent";
  }
  if (semanticFamily === "price") {
    return "currency";
  }
  if (semanticFamily === "index") {
    return "index";
  }
  return "raw";
}

function inferDecimalPlaces(
  semanticFamily: MetricSemanticFamily,
  combined: string,
  displayUnit: MetricPresentationSpec["displayUnit"],
) {
  if (displayUnit === "thousands" || displayUnit === "millions" || displayUnit === "billions") {
    return 1;
  }

  if (semanticFamily === "price") {
    return 2;
  }
  if (semanticFamily === "share" || semanticFamily === "rotation" || semanticFamily === "avg_assortment") {
    return 1;
  }
  if (semanticFamily === "index") {
    return containsAny(combined, ["intensity"]) ? 1 : 0;
  }
  if (semanticFamily === "distribution" || semanticFamily === "tdp") {
    return 0;
  }
  return 0;
}

function buildExcelNumberFormat(
  displayUnit: MetricPresentationSpec["displayUnit"],
  decimalPlaces: number,
) {
  const raw = `0${decimalPlaces > 0 ? `.${"0".repeat(decimalPlaces)}` : ""}`;
  if (displayUnit === "percent") {
    return `${raw}"%"`;
  }
  if (displayUnit === "currency") {
    return raw;
  }
  return raw;
}

function buildHumanNumberFormat(
  displayUnit: MetricPresentationSpec["displayUnit"],
  decimalPlaces: number,
) {
  const raw = `0${decimalPlaces > 0 ? `.${"0".repeat(decimalPlaces)}` : ""}`;
  if (displayUnit === "percent") {
    return `${raw}%`;
  }
  return raw;
}

function buildUniformSeriesFormat(
  series: ExhibitPresentationSpec["series"],
) {
  const formats = [...new Set(series.map((entry) => entry.metricPresentation?.excelNumberFormat).filter(Boolean))];
  return formats.length === 1 ? (formats[0] ?? null) : null;
}

function resolveChartPalette(templateProfile: TemplateProfile) {
  const palette = templateProfile.brandTokens?.chartPalette?.filter(Boolean);
  if (palette && palette.length > 0) {
    return palette;
  }

  const core = templateProfile.brandTokens?.palette;
  const fallback = [
    core?.accent,
    core?.highlight,
    core?.positive,
    core?.negative,
    core?.muted,
    core?.border,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return fallback.length > 0 ? fallback : DEFAULT_CHART_PALETTE;
}

function resolveLegendPosition(chartType: string): ExhibitPresentationSpec["legendPosition"] {
  const normalized = normalizeChartType(chartType);
  if (normalized === "pie" || normalized === "doughnut") {
    return "right";
  }
  return "bottom";
}

function detectScaledUnit(combined: string): MetricPresentationSpec["displayUnit"] | null {
  for (const entry of SCALE_TOKEN_MAP) {
    if (combined.includes(entry.token)) {
      return entry.unit as MetricPresentationSpec["displayUnit"];
    }
  }
  return null;
}

function hasVariationToken(value: string) {
  return VARIATION_TOKENS.some((token) => value.includes(token));
}

function removeVariationTokens(value: string) {
  let next = value;
  for (const token of VARIATION_TOKENS) {
    next = next.replaceAll(token, " ");
  }
  return next.replace(/\s+/g, " ").trim();
}

function containsAny(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(token));
}

function normalizeMetricText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeChartType(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

export type { WorkbookSheetPresentation };
