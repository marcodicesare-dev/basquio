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
  freezePane: string;
  tableStyleName: string;
  headerFillColor: string;
  headerTextColor: string;
  showGridLines: boolean;
  columns: Array<{
    header: string;
    widthChars: number;
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
type MetricPolicyRule = {
  semanticFamily: MetricSemanticFamily;
  decimals: number;
  displayUnit?: MetricPresentationSpec["displayUnit"];
};

const NIQ_POLICY_RULES: Array<{ matches: string[]; rule: MetricPolicyRule }> = [
  {
    matches: ["wd promo", "promo wd", "weighted distribution", "numeric distribution", "distr pond", "distr num", "distribution", "distribuzione", "ponderata", "numerica"],
    rule: { semanticFamily: "distribution", decimals: 0, displayUnit: "percent" },
  },
  {
    matches: ["promo pressure", "promo intensity", "promotional pressure", "pressione promo"],
    rule: { semanticFamily: "distribution", decimals: 0, displayUnit: "percent" },
  },
  {
    matches: ["tdp", "total distribution points"],
    rule: { semanticFamily: "tdp", decimals: 0, displayUnit: "percent" },
  },
  {
    matches: ["intensity index", "promo intensity index", "int idx", "int idx val", "int idx vol"],
    rule: { semanticFamily: "index", decimals: 1, displayUnit: "index" },
  },
  {
    matches: ["price index", "idx pr", "indice prezzo", "promo effectiveness index", "efficacia promo", "index", "indice", "indici"],
    rule: { semanticFamily: "index", decimals: 0, displayUnit: "index" },
  },
  {
    matches: ["quote", "quota", "share", "mix gap", "mix", "% discount", "discount", "price reduction", "lift"],
    rule: { semanticFamily: "share", decimals: 1, displayUnit: "percent" },
  },
  {
    matches: ["avg no promo price", "avg promo price", "avg price", "prezzo medio", "price", "pricing", "prezzo"],
    rule: { semanticFamily: "price", decimals: 2, displayUnit: "currency" },
  },
  {
    matches: ["n medio ref", "numero medio di referenze", "avg refs", "avg reference", "referenze", "assortment", "reference count"],
    rule: { semanticFamily: "avg_assortment", decimals: 1, displayUnit: "raw" },
  },
  {
    matches: ["sales per point", "value per distribution point", "productivity", "ros", "rotation", "rotazione", "rotazioni", "velocity"],
    rule: { semanticFamily: "rotation", decimals: 1, displayUnit: "raw" },
  },
  {
    matches: ["vol promo sales", "promo volume", "volume sales", "sales volume", "v all", "volumi", "volume", "ltrs", "kg", "qty", "quantity", "confezioni", "packs", "units"],
    rule: { semanticFamily: "sales_volume", decimals: 0, displayUnit: "raw" },
  },
  {
    matches: ["promo sales value", "no promo sales value", "sales value", "v valore", "v valore any promo", "vendite", "value", "valore", "revenue", "eur"],
    rule: { semanticFamily: "sales_value", decimals: 0, displayUnit: "raw" },
  },
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
  const metricRule = resolveMetricPolicy(baseText);
  const semanticFamily = metricRule?.semanticFamily ?? inferSemanticFamily(combined, baseText);
  const displayUnit = inferDisplayUnit(metricRule, semanticFamily, combined);
  const decimalPlaces = inferDecimalPlaces(metricRule, semanticFamily, displayUnit, combined);
  const variationDisplay = inferVariationDisplay(combined, displayUnit);
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

export function buildWorkbookSheetPresentation(
  sheet: WorkbookSheetLike,
  templateProfile?: TemplateProfile,
): WorkbookSheetPresentation {
  const columns = sheet.headers
    .filter((header, index) =>
      index > 0 &&
      sheet.rows.some((row) => typeof row[header] === "number" && Number.isFinite(row[header] as number)),
    )
    .map((header) => ({
      header,
      widthChars: inferWorkbookColumnWidth(sheet, header),
      presentation: inferMetricPresentationSpec({
        label: header,
        title: sheet.name,
      }),
    }));

  const palette = templateProfile?.brandTokens?.palette;
  const headerFillColor = palette?.accent ?? "#1A6AFF";
  const headerTextColor = pickReadableHeaderTextColor(headerFillColor);

  return {
    sheetName: sheet.name,
    freezePane: sheet.headers.length > 1 ? "B2" : "A2",
    tableStyleName: "TableStyleMedium2",
    headerFillColor,
    headerTextColor,
    showGridLines: false,
    columns,
  };
}

export function buildWorkbookSheetPresentations(
  sheets: WorkbookSheetLike[],
  templateProfile?: TemplateProfile,
): WorkbookSheetPresentation[] {
  return sheets.map((sheet) => buildWorkbookSheetPresentation(sheet, templateProfile));
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
    workbookPresentation: {
      freezePane: "B2",
      tableStyleName: "TableStyleMedium2",
      chartPlacement: "right-panel",
      chartPanelMinWidthColumns: normalizeChartType(input.chartType) === "scatter" ? 9 : 8,
      chartPanelMinHeightRows:
        normalizeChartType(input.chartType) === "pie" || normalizeChartType(input.chartType) === "doughnut"
          ? 16
          : 18,
      showGridLines: false,
    },
    workbookAnchor: input.workbookAnchor ?? null,
    screenshotChartId: input.chartId,
  };
}

function inferWorkbookColumnWidth(sheet: WorkbookSheetLike, header: string) {
  const headerWidth = header.trim().length;
  const sampleWidths = sheet.rows.slice(0, 24).map((row) => {
    const value = row[header];
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.abs(value)).length + 2;
    }
    return String(value).trim().length;
  });
  const maxWidth = Math.max(headerWidth, ...sampleWidths);
  return Math.max(12, Math.min(28, maxWidth + 2));
}

function pickReadableHeaderTextColor(fillColor: string) {
  const normalized = fillColor.replace(/^#/, "");
  if (normalized.length !== 6) {
    return "#FFFFFF";
  }
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.62 ? "#0B0C0C" : "#FFFFFF";
}

function resolveMetricPolicy(baseText: string): MetricPolicyRule | null {
  for (const entry of NIQ_POLICY_RULES) {
    if (entry.matches.some((token) => baseText.includes(token))) {
      return entry.rule;
    }
  }
  return null;
}

function inferSemanticFamily(combined: string, baseText: string): MetricSemanticFamily {
  if (containsAny(baseText, ["wd promo", "weighted distribution", "numeric distribution", "distribution", "distribuzione", "ponderata", "numerica"])) {
    return "distribution";
  }
  if (containsAny(baseText, ["promo pressure", "promo intensity"])) {
    return "distribution";
  }
  if (containsAny(baseText, ["price", "prezzo", "prezzi", "pricing"])) {
    return "price";
  }
  if (containsAny(baseText, ["tdp"])) {
    return "tdp";
  }
  if (containsAny(baseText, ["sales per point", "value per distribution point", "productivity", "ros", "rotation", "rotazione", "rotazioni", "velocity"])) {
    return "rotation";
  }
  if (containsAny(baseText, ["referenze", "assortment", "referenze medie", "reference count"])) {
    return "avg_assortment";
  }
  if (containsAny(baseText, ["intensity index", "int idx", "price index", "idx pr", "index", "indice", "indici", "efficacia"])) {
    return "index";
  }
  if (containsAny(baseText, ["share", "quota", "quote", "mix"])) {
    return "share";
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
  metricRule: MetricPolicyRule | null,
  semanticFamily: MetricSemanticFamily,
  combined: string,
): MetricPresentationSpec["displayUnit"] {
  const scaledUnit = detectScaledUnit(combined);
  if (scaledUnit) {
    return scaledUnit;
  }

  if (metricRule?.displayUnit) {
    return metricRule.displayUnit;
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
  metricRule: MetricPolicyRule | null,
  semanticFamily: MetricSemanticFamily,
  displayUnit: MetricPresentationSpec["displayUnit"],
  combined: string,
) {
  if (displayUnit === "thousands" || displayUnit === "millions" || displayUnit === "billions") {
    return 1;
  }

  if (metricRule) {
    return metricRule.decimals;
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

function inferVariationDisplay(
  combined: string,
  displayUnit: MetricPresentationSpec["displayUnit"],
): MetricPresentationSpec["variationDisplay"] {
  if (!hasVariationToken(combined)) {
    return "absolute";
  }

  if (containsAny(combined, ["var %", "var%", "growth", "crescita", "yoy", "vs py", "vs ly"])) {
    return "percentage";
  }

  if (displayUnit === "percent" && !containsAny(combined, ["share", "quota", "discount", "price reduction"])) {
    return "absolute";
  }

  return "auto";
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
