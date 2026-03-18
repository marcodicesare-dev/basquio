import PptxGenJS from "pptxgenjs";

import { getLayoutRegions, SLIDE_W, SLIDE_H, type LayoutRegions, type R } from "@basquio/scene-graph/layout-regions";
import { getArchetypeOrDefault } from "@basquio/scene-graph/slot-archetypes";
import { resolveChartArchetype, type ChartRenderingRules } from "@basquio/scene-graph/chart-design-system";
import { renderShapeChart, type ShapeChartTokens } from "./shape-charts";
import type { BinaryArtifact } from "@basquio/types";

// ─── V2 INPUT TYPES ──────────────────────────────────────────────

export type V2SlideRow = {
  id: string;
  position: number;
  layoutId: string;
  title: string;
  subtitle: string | undefined;
  kicker: string | undefined;
  body: string | undefined;
  bullets: string[] | undefined;
  chartId: string | undefined;
  evidenceIds: string[];
  metrics: { label: string; value: string; delta?: string }[] | undefined;
  callout: { text: string; tone?: "accent" | "green" | "orange" } | undefined;
  speakerNotes: string | undefined;
  transition: string | undefined;
};

export type V2ChartRow = {
  id: string;
  chartType: string;
  title: string;
  data: Record<string, unknown>[];
  xAxis: string;
  yAxis: string;
  series: string[];
  style: {
    colors?: string[];
    showLegend?: boolean;
    showValues?: boolean;
    highlightCategories?: string[];
  };
  // Semantic fields from the chart design system
  intent?: string;
  unit?: string;
  benchmarkLabel?: string;
  benchmarkValue?: number;
  sourceNote?: string;
};

export type ExportMode = "powerpoint-native" | "universal-compatible";

export type RenderV2PptxInput = {
  deckTitle: string;
  slides: V2SlideRow[];
  charts: V2ChartRow[];
  brandTokens?: Partial<BrandTokens>;
  exportMode?: ExportMode;
};

// ─── CONSULTING-GRADE DESIGN SYSTEM ─────────────────────────────

type BrandTokens = {
  palette: {
    ink: string;
    muted: string;
    border: string;
    surface: string;
    bg: string;
    accent: string;
    accentLight: string;
    positive: string;
    negative: string;
    coverBg: string;
    calloutGreen: string;
    calloutOrange: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    coverTitleSize: number;
    titleSize: number;
    subtitleSize: number;
    bodySize: number;
    bulletSize: number;
    chartTitleSize: number;
    sourceSize: number;
    kpiValueSize: number;
    kpiLabelSize: number;
  };
  chartPalette: string[];
};

const DEFAULT_CHART_PALETTE = [
  "0F4C81",
  "D1D5DB",
  "1F7A4D",
  "B42318",
  "C97A00",
  "6B21A8",
  "0E7490",
  "78716C",
];

const DEFAULT_TOKENS: BrandTokens = {
  palette: {
    ink: "1A1A2E",
    muted: "4B5563",
    border: "E2E8F0",
    surface: "F8FAFC",
    bg: "FFFFFF",
    accent: "0F4C81",
    accentLight: "DCEAF7",
    positive: "16A34A",
    negative: "DC2626",
    coverBg: "1B2541",
    calloutGreen: "16A34A",
    calloutOrange: "EA580C",
  },
  typography: {
    headingFont: "Arial",
    bodyFont: "Arial",
    coverTitleSize: 32,
    titleSize: 20,
    subtitleSize: 12,
    bodySize: 11,
    bulletSize: 11,
    chartTitleSize: 10,
    sourceSize: 7,
    kpiValueSize: 32,
    kpiLabelSize: 8.5,
  },
  chartPalette: DEFAULT_CHART_PALETTE,
};

function resolveTokens(partial?: Partial<BrandTokens>): BrandTokens {
  if (!partial) return DEFAULT_TOKENS;
  return {
    palette: { ...DEFAULT_TOKENS.palette, ...(partial.palette as Partial<BrandTokens["palette"]>) },
    typography: { ...DEFAULT_TOKENS.typography, ...(partial.typography as Partial<BrandTokens["typography"]>) },
    chartPalette: partial.chartPalette ?? DEFAULT_TOKENS.chartPalette,
  };
}

// ─── GEOMETRY + LAYOUT REGIONS ───────────────────────────────────
// Imported from @basquio/scene-graph/layout-regions (single source of truth)
// Re-exported types used locally: R, LayoutRegions, SLIDE_W, SLIDE_H, getLayoutRegions

// ─── COLOR HELPER ───────────────────────────────────────────────

function norm(color: string): string {
  return color.replace("#", "").toUpperCase();
}

// ─── TEXT HELPERS ────────────────────────────────────────────────

/** Replace literal \\n and \n sequences (from LLM output) with real newlines */
function processNewlines(text: string): string {
  return text.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
}

/** Split text into TextProps array on real newlines */
function textToProps(
  text: string,
  opts: { fontSize: number; fontFace: string; color: string; bold?: boolean },
): PptxGenJS.TextProps[] {
  const lines = processNewlines(text).split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line) => ({
    text: line,
    options: {
      fontSize: opts.fontSize,
      fontFace: opts.fontFace,
      color: opts.color,
      bold: opts.bold,
      breakLine: true,
    },
  }));
}

function truncateWords(text: string, maxWords: number): { truncated: string; overflow: string } {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return { truncated: text, overflow: "" };
  return {
    truncated: words.slice(0, maxWords).join(" ") + "…",
    overflow: words.slice(maxWords).join(" "),
  };
}

// ─── DATA FORMAT DETECTION ──────────────────────────────────────
// Detect whether chart data represents percentages, currency, or plain numbers
// Used for smart axis formatting and data labels

function detectPercentageData(chart: V2ChartRow): boolean {
  // Check if title/series names suggest percentage
  const titleLower = (chart.title ?? "").toLowerCase();
  if (titleLower.includes("share") || titleLower.includes("%") || titleLower.includes("percent") || titleLower.includes("penetration") || titleLower.includes("rate")) return true;
  // Check if series names suggest percentage
  for (const s of chart.series) {
    if (s.includes("%") || s.toLowerCase().includes("share")) return true;
  }
  // Check if all values are between 0 and 1 (likely percentage as decimal)
  const allValues = chart.data.flatMap((row) => chart.series.map((s) => Number(row[s])).filter((n) => !isNaN(n)));
  if (allValues.length > 0 && allValues.every((v) => v >= 0 && v <= 1)) return true;
  // Check if all values are between 0 and 100 and title suggests share
  if (allValues.length > 0 && allValues.every((v) => v >= 0 && v <= 100) && (titleLower.includes("share") || titleLower.includes("mix"))) return true;
  return false;
}

function detectCurrencyData(chart: V2ChartRow): boolean {
  const titleLower = (chart.title ?? "").toLowerCase();
  return titleLower.includes("€") || titleLower.includes("$") || titleLower.includes("revenue") || titleLower.includes("sales value") || titleLower.includes("turnover");
}

function isNumericValue(val: unknown): boolean {
  if (typeof val === "number") return true;
  if (typeof val === "string") return /^[\d.,€$£¥%-]+$/.test(val.trim());
  return false;
}

function formatValue(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "number") {
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    if (!Number.isInteger(val)) return val.toFixed(1);
  }
  return String(val);
}

// ─── KICKER RENDERER ────────────────────────────────────────────

function renderKicker(
  slide: PptxGenJS.Slide,
  text: string,
  titleRegion: R,
  tokens: BrandTokens,
): void {
  slide.addText(text.toUpperCase(), {
    x: titleRegion.x,
    y: titleRegion.y - 0.18,
    w: titleRegion.w,
    h: 0.16,
    fontSize: 8.5,
    fontFace: tokens.typography.bodyFont,
    color: norm(tokens.palette.accent),
    bold: true,
    margin: 0,
    charSpacing: 1.2,
  });
}

// ─── CHART TRANSFORMS ───────────────────────────────────────────

function mapPptxChartType(pptx: PptxGenJS, chartType: string): PptxGenJS.CHART_NAME {
  switch (chartType) {
    case "bar":
    case "vertical-bar":
    case "horizontal_bar":
    case "horizontal-bar":
    case "stacked_bar":
    case "stacked-bar":
    case "stacked_bar_100":
    case "stacked-bar-100":
    case "grouped_bar":
    case "grouped-bar":
    case "waterfall":
      return pptx.ChartType.bar;
    case "line":
      return pptx.ChartType.line;
    case "pie":
      return pptx.ChartType.pie;
    case "doughnut":
      return pptx.ChartType.doughnut;
    case "scatter":
    case "quadrant":
      return pptx.ChartType.scatter;
    case "area":
      return pptx.ChartType.area;
    case "radar":
      return pptx.ChartType.radar;
    default:
      return pptx.ChartType.bar;
  }
}

function buildChartData(chart: V2ChartRow, tokens: BrandTokens): {
  chartData: Array<{ name: string; labels: string[]; values: number[] }>;
  opts: Record<string, unknown>;
  effectiveChartType: string;
} | null {
  if (!chart.data || chart.data.length === 0) return null;
  if (!chart.series || chart.series.length === 0) return null;

  // Auto-coerce pie/doughnut to stacked_bar when >4 categories (Change 6)
  let effectiveChartType = chart.chartType;
  const pieLike = chart.chartType === "pie" || chart.chartType === "doughnut";
  if (pieLike && chart.data.length > 4) {
    effectiveChartType = "stacked_bar";
  }

  const labels = chart.data.map((row) => String(row[chart.xAxis] ?? ""));
  const basePalette = chart.style.colors?.map(norm) ?? tokens.chartPalette.map(norm);

  // Highlight-bar coloring: if highlightCategories specified, color focal bars with accent,
  // all others with a muted gray (Change 7)
  const highlightCats = chart.style.highlightCategories ?? [];
  const highlightSet = new Set(highlightCats.map((c) => c.toLowerCase()));
  let palette = basePalette;
  if (highlightSet.size > 0 && chart.series.length === 1) {
    palette = labels.map((label) =>
      highlightSet.has(label.toLowerCase()) ? norm(tokens.palette.accent) : "D1D5DB",
    );
  }

  // Check if any series has valid numeric data
  const hasValidData = chart.series.some((seriesKey) =>
    chart.data.some((row) => typeof row[seriesKey] === "number" || !isNaN(Number(row[seriesKey]))),
  );
  if (!hasValidData) return null;

  const singleSeries = chart.series.length === 1;
  const coercedPieLike = effectiveChartType === "pie" || effectiveChartType === "doughnut";
  const isBar = effectiveChartType === "bar" || effectiveChartType === "stacked_bar"
    || effectiveChartType === "horizontal_bar" || effectiveChartType === "grouped_bar"
    || effectiveChartType === "stacked_bar_100";

  // Resolve design system archetype for this chart type + intent
  const archetype = resolveChartArchetype(effectiveChartType, chart.intent);
  const rules = archetype.renderingRules;

  // Legend: design system first, then explicit override, then fallback
  const showLegend = chart.style.showLegend ?? (
    rules.showLegend === "always" ? true :
    rules.showLegend === "never" ? false :
    // "auto" — show if multi-series or pie
    coercedPieLike ? true : singleSeries ? false : true
  );

  const baseOpts: Record<string, unknown> = {
    showTitle: false,
    showLegend,
    legendPos: rules.legendPosition === "none" ? "b" : rules.legendPosition === "right" ? "r" : "b",
    legendFontSize: 7,
    legendColor: norm(tokens.palette.muted),
    legendFontFace: tokens.typography.bodyFont,

    showCatAxisTitle: rules.categoryAxisTitle !== "none",
    catAxisLabelColor: norm(tokens.palette.ink),
    catAxisLabelFontSize: 9,
    catAxisLabelFontFace: tokens.typography.bodyFont,
    catAxisLineShow: true,
    catAxisLineColor: "D1D5DB",

    showValAxisTitle: rules.showValueAxis && rules.valueAxisTitle !== "none",
    valAxisTitle: chart.unit ?? "",
    valAxisLabelColor: norm(tokens.palette.muted),
    valAxisLabelFontSize: 8,
    valAxisLabelFontFace: tokens.typography.bodyFont,
    valAxisLineShow: false,
    // Smart number formatting: detect percentage vs currency vs plain numbers
    valAxisLabelFormatCode: detectPercentageData(chart) ? "0.0%" : detectCurrencyData(chart) ? "€#,##0" : "#,##0",
    valGridLine: { color: "F3F4F6", size: 0.5 },
    catGridLine: { style: "none" },

    chartColors: palette,
    // Data labels controlled by design system archetype
    showValue: chart.style.showValues ?? (
      rules.showDataLabels === "always" ? true :
      rules.showDataLabels === "never" ? false :
      chart.data.length <= 12  // "smart" — show if ≤12 categories
    ),
    dataLabelPosition: rules.dataLabelPosition === "above" ? "t" :
      rules.dataLabelPosition === "inside" ? "ctr" :
      rules.dataLabelPosition === "center" ? "ctr" : "outEnd",
    dataLabelFontSize: 9,
    dataLabelFormatCode: detectPercentageData(chart) ? "0.0%" : "#,##0",
    dataLabelFontFace: tokens.typography.bodyFont,
    dataLabelColor: norm(tokens.palette.ink),
    dataLabelFontBold: true,
    lineSize: 2,
    barGapWidthPct: 60,
  };

  // Bar orientation and grouping from design system
  if (rules.orientation === "horizontal" || effectiveChartType === "horizontal_bar" || effectiveChartType === "horizontal-bar") {
    baseOpts.barDir = "bar";
  } else if (effectiveChartType === "bar" || effectiveChartType === "vertical-bar") {
    baseOpts.barDir = "col";
  }

  // Bar grouping
  if (effectiveChartType === "stacked_bar" || effectiveChartType === "stacked-bar") {
    baseOpts.barDir = baseOpts.barDir ?? "col";
    baseOpts.barGrouping = "stacked";
  } else if (effectiveChartType === "stacked_bar_100" || effectiveChartType === "stacked-bar-100") {
    baseOpts.barDir = baseOpts.barDir ?? "col";
    baseOpts.barGrouping = "percentStacked";
  } else if (effectiveChartType === "grouped_bar" || effectiveChartType === "grouped-bar") {
    baseOpts.barDir = baseOpts.barDir ?? "col";
    baseOpts.barGrouping = "clustered";
  }

  // Waterfall: simulated stacked bar
  if (effectiveChartType === "waterfall") {
    const seriesKey = chart.series[0] ?? chart.yAxis;
    const values = chart.data.map((row) => Number(row[seriesKey]) || 0);
    const base: number[] = [];
    const rise: number[] = [];
    const fall: number[] = [];
    let running = 0;
    for (const v of values) {
      if (v >= 0) {
        base.push(running);
        rise.push(v);
        fall.push(0);
      } else {
        base.push(running + v);
        rise.push(0);
        fall.push(Math.abs(v));
      }
      running += v;
    }
    return {
      chartData: [
        { name: "Base", labels, values: base },
        { name: "Increase", labels, values: rise },
        { name: "Decrease", labels, values: fall },
      ],
      opts: {
        ...baseOpts,
        barDir: "bar",
        barGrouping: "stacked",
        chartColors: ["FFFFFF", norm(tokens.palette.positive), norm(tokens.palette.negative)],
        showLegend: false,
      },
      effectiveChartType: "waterfall",
    };
  }

  // Pie (only if not coerced to stacked_bar)
  if (coercedPieLike) {
    baseOpts.showPercent = true;
    baseOpts.showValue = false;
    baseOpts.showLegend = true;
    baseOpts.dataLabelPosition = "outEnd";
  }

  // Scatter: no barDir
  if (effectiveChartType === "scatter") {
    delete baseOpts.barDir;
    delete baseOpts.barGapWidthPct;
  }

  const chartData = chart.series.map((seriesKey) => ({
    name: seriesKey,
    labels,
    values: chart.data.map((row) => Number(row[seriesKey]) || 0),
  }));

  // For single-series highlight coloring, apply per-point colors
  if (highlightSet.size > 0 && singleSeries && !coercedPieLike) {
    baseOpts.chartColors = palette;
  }

  return { chartData, opts: baseOpts, effectiveChartType };
}

// ─── ELEMENT RENDERERS ──────────────────────────────────────────

function renderTitle(
  slide: PptxGenJS.Slide,
  text: string,
  region: R,
  tokens: BrandTokens,
  isCover: boolean,
): void {
  const processed = processNewlines(text);
  slide.addText(processed, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    fontFace: tokens.typography.headingFont,
    fontSize: isCover ? tokens.typography.coverTitleSize : tokens.typography.titleSize,
    bold: true,
    color: norm(isCover ? "FFFFFF" : tokens.palette.ink),
    fit: "shrink",
    breakLine: false,
    margin: 0,
    lineSpacingMultiple: 1.1,
  });
}

function renderSubtitle(
  slide: PptxGenJS.Slide,
  text: string,
  region: R,
  tokens: BrandTokens,
  isCover: boolean,
): void {
  const processed = processNewlines(text);
  slide.addText(processed, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    fontFace: tokens.typography.bodyFont,
    fontSize: tokens.typography.subtitleSize,
    color: norm(isCover ? "FFFFFF" : tokens.palette.muted),
    margin: 0,
    lineSpacingMultiple: 1.2,
  });
}

function renderBody(
  slide: PptxGenJS.Slide,
  text: string,
  region: R,
  tokens: BrandTokens,
  speakerNotesOverflow?: string[],
  maxWords?: number,
): void {
  const processed = processNewlines(text);
  const { truncated, overflow } = truncateWords(processed, maxWords ?? 80);
  if (overflow && speakerNotesOverflow) {
    speakerNotesOverflow.push(`[Overflow from body]: ${overflow}`);
  }

  // Executive prose formatting: bold the first sentence/clause for scannability
  const sentences = truncated.split(/(?<=[.!?;—:])\s+/);
  if (sentences.length >= 2) {
    const firstSentence = sentences[0];
    const rest = sentences.slice(1).join(" ");
    const props: PptxGenJS.TextProps[] = [
      {
        text: firstSentence + " ",
        options: {
          fontSize: tokens.typography.bodySize,
          fontFace: tokens.typography.bodyFont,
          color: norm(tokens.palette.ink),
          bold: true,
        },
      },
      {
        text: rest,
        options: {
          fontSize: tokens.typography.bodySize,
          fontFace: tokens.typography.bodyFont,
          color: norm(tokens.palette.ink),
          bold: false,
        },
      },
    ];
    slide.addText(props, {
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      lineSpacingMultiple: 1.4,
      valign: "top",
    });
    return;
  }

  // Single sentence or no split — render with multi-line support
  const props = textToProps(truncated, {
    fontSize: tokens.typography.bodySize,
    fontFace: tokens.typography.bodyFont,
    color: norm(tokens.palette.ink),
  });

  if (props.length <= 1) {
    slide.addText(truncated, {
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      fontSize: tokens.typography.bodySize,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.ink),
      align: "left",
      valign: "top",
      lineSpacingMultiple: 1.4,
      wrap: true,
    });
    return;
  }

  slide.addText(props, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    lineSpacingMultiple: 1.4,
    valign: "top",
  });
}

function renderBullets(
  slide: PptxGenJS.Slide,
  bullets: string[],
  region: R,
  tokens: BrandTokens,
  maxBulletsOverride?: number,
): void {
  const maxBullets = maxBulletsOverride ?? 4;
  const textProps: PptxGenJS.TextProps[] = bullets.slice(0, maxBullets).map((b) => ({
    text: processNewlines(b),
    options: {
      bullet: { indent: 12 },
      fontSize: tokens.typography.bulletSize,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.ink),
      breakLine: true,
      paraSpaceBefore: 2,
      paraSpaceAfter: 4,
    },
  }));

  slide.addText(textProps, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    valign: "top",
  });
}

function renderMetrics(
  slide: PptxGenJS.Slide,
  _pptx: PptxGenJS,
  metrics: NonNullable<V2SlideRow["metrics"]>,
  region: R,
  tokens: BrandTokens,
): void {
  const count = Math.min(metrics.length, 5);
  const gap = 0.15;
  const cardW = (region.w - gap * (count - 1)) / count;
  const cardH = Math.min(region.h, 1.3);
  const accentColor = norm(tokens.palette.accent);

  metrics.slice(0, 5).forEach((m, i) => {
    const cardX = region.x + i * (cardW + gap);

    // Card background: sharp corners, surface fill, thin border
    slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
      x: cardX,
      y: region.y,
      w: cardW,
      h: cardH,
      fill: { color: norm(tokens.palette.surface ?? "F8FAFC") },
      line: { color: norm(tokens.palette.border), pt: 0.5 },
    });

    // Left accent bar (3-4px wide, full card height)
    slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
      x: cardX,
      y: region.y,
      w: 0.04,
      h: cardH,
      fill: { color: accentColor },
    });

    // Label: ALL CAPS, bold, muted gray
    slide.addText(m.label.toUpperCase(), {
      x: cardX + 0.15,
      y: region.y + 0.08,
      w: cardW - 0.25,
      h: 0.20,
      fontSize: tokens.typography.kpiLabelSize,
      fontFace: tokens.typography.bodyFont,
      color: "6B7280",
      bold: true,
      charSpacing: 1.0,
    });

    // Value: large, bold, near-black
    slide.addText(m.value, {
      x: cardX + 0.15,
      y: region.y + 0.30,
      w: cardW - 0.25,
      h: 0.50,
      fontSize: count <= 3 ? tokens.typography.kpiValueSize : 24,
      fontFace: tokens.typography.headingFont,
      bold: true,
      color: norm(tokens.palette.ink),
      valign: "middle",
      shrinkText: true,
    });

    // Delta: plain text, semibold, green/red
    if (m.delta) {
      const isPositive = m.delta.startsWith("+") || m.delta.includes("up") || m.delta.includes("↑");
      const deltaColor = isPositive ? norm(tokens.palette.positive) : norm(tokens.palette.negative);

      slide.addText(m.delta, {
        x: cardX + 0.15,
        y: region.y + 0.85,
        w: cardW - 0.25,
        h: 0.22,
        fontSize: 10,
        fontFace: tokens.typography.bodyFont,
        bold: true,
        color: deltaColor,
        valign: "middle",
      });
    }
  });
}

function renderTable(
  slide: PptxGenJS.Slide,
  chart: V2ChartRow,
  region: R,
  tokens: BrandTokens,
  maxRowsOverride?: number,
  maxColsOverride?: number,
): void {
  const headers = [chart.xAxis, ...chart.series].filter(Boolean);
  if (headers.length === 0) return;

  const maxRows = maxRowsOverride ?? 8;
  const maxCols = maxColsOverride ?? 6;
  const visibleHeaders = headers.slice(0, maxCols);
  const rows = chart.data.slice(0, maxRows);

  // Header row: accent-color bg, white bold text, 9pt
  const headerRow: PptxGenJS.TableCell[] = visibleHeaders.map((h, colIdx) => ({
    text: h,
    options: {
      fill: { color: norm(tokens.palette.accent) },
      color: "FFFFFF",
      bold: true,
      fontSize: 9,
      fontFace: tokens.typography.bodyFont,
      align: (colIdx === 0 ? "left" : "right") as "left" | "right",
      valign: "middle" as const,
      margin: [2, 4, 2, 4],
      border: [
        { type: "solid" as const, pt: 0.5, color: "E5E7EB" },
        { type: "none" as const },
        { type: "solid" as const, pt: 0.5, color: "E5E7EB" },
        { type: "none" as const },
      ],
    },
  }));

  // Highlight keywords for focal-row detection (client brand, key entities)
  const highlightKeywords = new Set(
    (chart.style.highlightCategories ?? []).map((k: string) => k.toLowerCase()),
  );

  // Data rows: zebra striping + focal-row highlighting
  const dataRows: PptxGenJS.TableCell[][] = rows.map((row, rowIdx) => {
    const firstColVal = String(row[visibleHeaders[0]] ?? "").toLowerCase();
    const isHighlighted = highlightKeywords.size > 0 &&
      [...highlightKeywords].some((kw) => firstColVal.includes(kw));
    const zebraFill = rowIdx % 2 === 0 ? "F8FAFC" : "FFFFFF";
    const rowFill = isHighlighted ? norm(tokens.palette.accentLight) : zebraFill;

    return visibleHeaders.map((col, colIdx) => {
      const val = row[col];
      const formatted = formatValue(val);
      const isNum = isNumericValue(val);

      // Conditional coloring: positive/negative values in numeric columns (not first col)
      let cellColor = norm(tokens.palette.ink);
      if (colIdx > 0 && isNum) {
        const numStr = String(val).replace(/[^0-9.\-+%]/g, "");
        if (numStr.startsWith("-") || numStr.startsWith("−")) {
          cellColor = norm(tokens.palette.negative);
        } else if (numStr.startsWith("+")) {
          cellColor = norm(tokens.palette.positive);
        }
      }

      return {
        text: formatted,
        options: {
          fontSize: 9,
          fontFace: tokens.typography.bodyFont,
          color: cellColor,
          bold: isHighlighted || colIdx === 0,
          fill: { color: rowFill },
          align: (colIdx === 0 ? "left" : isNum ? "right" : "left") as "left" | "right",
          valign: "middle" as const,
          border: [
            { type: "none" as const },
            { type: "none" as const },
            { type: "solid" as const, pt: 0.5, color: "E5E7EB" },
            { type: "none" as const },
          ],
          margin: [2, 4, 2, 4],
        },
      };
    });
  });

  slide.addTable([headerRow, ...dataRows], {
    x: region.x,
    y: region.y,
    w: region.w,
    colW: visibleHeaders.map(() => region.w / visibleHeaders.length),
    border: { type: "none" },
    autoPage: false,
  });

  if (chart.data.length > maxRows) {
    slide.addText(`Showing top ${maxRows} of ${chart.data.length} rows`, {
      x: region.x,
      y: region.y + region.h - 0.2,
      w: region.w,
      h: 0.18,
      fontSize: 7,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.muted),
      align: "right",
      italic: true,
    });
  }
}

function renderCallout(
  slide: PptxGenJS.Slide,
  _pptx: PptxGenJS,
  text: string,
  region: R,
  tokens: BrandTokens,
  variant: "green" | "orange" | "accent" = "accent",
): void {
  const accentMap: Record<string, string> = {
    green: tokens.palette.calloutGreen,
    orange: tokens.palette.calloutOrange,
    accent: tokens.palette.accent,
  };
  const bgMap: Record<string, string> = {
    green: "F0FDF4",
    orange: "FFFBEB",
    accent: "EFF6FF",
  };
  const accentColor = accentMap[variant] || tokens.palette.accent;
  const bgColor = bgMap[variant] || "EFF6FF";
  const calloutH = 0.45;

  // Tinted background (no border, sharp corners)
  slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: calloutH,
    fill: { color: norm(bgColor) },
  });

  // Left accent bar (3-4px, full height)
  slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
    x: region.x,
    y: region.y,
    w: 0.04,
    h: calloutH,
    fill: { color: norm(accentColor) },
  });

  // Text: bold, dark gray (ink), no emoji markers
  slide.addText(processNewlines(text), {
    x: region.x + 0.16,
    y: region.y + 0.08,
    w: region.w - 0.24,
    h: calloutH - 0.16,
    fontSize: 10,
    fontFace: tokens.typography.bodyFont,
    color: norm(tokens.palette.ink),
    bold: true,
    wrap: true,
    valign: "middle",
  });
}

function renderChartElement(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  chart: V2ChartRow,
  region: R,
  tokens: BrandTokens,
  exportMode: ExportMode = "powerpoint-native",
): void {
  if (chart.chartType === "table") {
    renderTable(slide, chart, region, tokens);
    return;
  }

  const built = buildChartData(chart, tokens);
  if (!built) {
    // Render a "no data" placeholder instead of blank space
    slide.addText("Chart data unavailable", {
      x: region.x,
      y: region.y + 0.3,
      w: region.w,
      h: region.h - 0.3,
      fontSize: 10,
      color: tokens.palette.muted,
      align: "center",
      valign: "middle",
      fontFace: tokens.typography.bodyFont,
    });
    return;
  }

  const { chartData, opts, effectiveChartType } = built;

  // Chart title (small, above chart area)
  slide.addText(chart.title, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: 0.22,
    fontFace: tokens.typography.bodyFont,
    fontSize: tokens.typography.chartTitleSize,
    bold: true,
    color: norm(tokens.palette.ink),
  });

  const chartRegion = {
    x: region.x,
    y: region.y + 0.25,
    w: region.w,
    h: region.h - 0.3,
  };

  // Reserve space for source note if present
  const hasSource = Boolean(chart.sourceNote);
  const actualChartH = hasSource ? chartRegion.h - 0.2 : chartRegion.h;

  if (exportMode === "universal-compatible") {
    // Shape-built charts for cross-app compatibility (Google Slides, Keynote)
    const shapeTokens: ShapeChartTokens = {
      accent: norm(tokens.palette.accent),
      ink: norm(tokens.palette.ink),
      muted: norm(tokens.palette.muted),
      surface: norm(tokens.palette.surface ?? "F8FAFC"),
      chartPalette: (tokens.chartPalette ?? []).map(norm),
      bodyFont: tokens.typography.bodyFont,
      headingFont: tokens.typography.headingFont,
    };

    // Build shape-chart data from raw chart rows
    const shapeData = {
      labels: chart.data.map((row) => String(row[chart.xAxis] ?? "")),
      datasets: chart.series.length > 0
        ? chart.series.map((colName) => ({
            label: colName,
            data: chart.data.map((row) => {
              const v = row[colName];
              return typeof v === "number" ? v : parseFloat(String(v)) || 0;
            }),
          }))
        : [{
            label: chart.yAxis || chart.title,
            data: chart.data.map((row) => {
              const v = row[chart.yAxis];
              return typeof v === "number" ? v : parseFloat(String(v)) || 0;
            }),
          }],
    };

    const fullFrame = { x: region.x, y: region.y, w: region.w, h: region.h };
    renderShapeChart(slide, effectiveChartType, shapeData, fullFrame, shapeTokens, {
      title: chart.title,
      sourceNote: chart.sourceNote,
      unit: chart.unit,
      highlightCategories: chart.style?.highlightCategories,
    });
  } else {
    // PowerPoint Native: editable OOXML charts (best experience in PowerPoint)
    slide.addChart(
      mapPptxChartType(pptx, effectiveChartType),
      chartData as unknown as PptxGenJS.OptsChartData[],
      {
        x: chartRegion.x,
        y: chartRegion.y,
        w: chartRegion.w,
        h: actualChartH,
        ...opts,
      } as PptxGenJS.IChartOpts,
    );
  }

  // Source note below chart
  if (chart.sourceNote) {
    slide.addText(`Source: ${chart.sourceNote}`, {
      x: chartRegion.x,
      y: chartRegion.y + actualChartH + 0.02,
      w: chartRegion.w,
      h: 0.16,
      fontSize: 7,
      fontFace: tokens.typography.bodyFont,
      color: "9CA3AF",
    });
  }
}

// ─── PER-LAYOUT RENDERERS ───────────────────────────────────────

function renderCoverSlide(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  tokens: BrandTokens,
): void {
  const regions = getLayoutRegions("cover");

  // Premium cover: accent shape decoration (right side geometric element)
  slide.addShape(pptx.ShapeType.rect, {
    x: SLIDE_W - 0.08,
    y: 0,
    w: 0.08,
    h: SLIDE_H,
    fill: { color: norm(tokens.palette.accent) },
  });

  // Thin accent line above title for visual anchor
  slide.addShape(pptx.ShapeType.rect, {
    x: regions.title.x,
    y: regions.title.y - 0.12,
    w: 1.2,
    h: 0.035,
    fill: { color: norm(tokens.palette.accent) },
  });

  // Kicker on cover (e.g., company name, report type)
  if (s.kicker) {
    slide.addText(s.kicker.toUpperCase(), {
      x: regions.title.x,
      y: regions.title.y - 0.5,
      w: regions.title.w,
      h: 0.3,
      fontSize: 10,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.accent),
      bold: true,
      charSpacing: 1.5,
    });
  }

  renderTitle(slide, s.title, regions.title, tokens, true);
  if (s.subtitle && regions.subtitle) {
    renderSubtitle(slide, s.subtitle, regions.subtitle, tokens, true);
  }

  // Bottom gradient bar with accent color
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: SLIDE_H - 0.06,
    w: SLIDE_W,
    h: 0.06,
    fill: { color: norm(tokens.palette.accent) },
  });
}

function renderContentSlide(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>,
  tokens: BrandTokens,
  exportMode: ExportMode = "powerpoint-native",
): void {
  // Content slides use BASQUIO_MASTER (white bg + accent top bar + navy footer)
  const layoutId = s.layoutId || "title-body";
  const regions = getLayoutRegions(layoutId);
  const arch = getArchetypeOrDefault(layoutId);
  const bodyMaxWords = arch.slots.body?.maxWords ?? 80;
  const maxBulletsFromArch = arch.slots.bullets?.maxBullets ?? arch.slots.body?.maxBullets ?? 4;
  const tableMaxRows = arch.slots.table?.maxTableRows ?? 8;
  const tableMaxCols = arch.slots.table?.maxTableCols ?? 6;
  const notesOverflow: string[] = [];

  // Kicker (section label above title)
  if (s.kicker) {
    renderKicker(slide, s.kicker, regions.title, tokens);
  }

  // Title always rendered
  renderTitle(slide, s.title, regions.title, tokens, false);

  // Subtitle (if present and region exists)
  if (s.subtitle && regions.subtitle) {
    renderSubtitle(slide, s.subtitle, regions.subtitle, tokens, false);
  }

  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;

  switch (layoutId) {
    case "title-chart": {
      if (chart && regions.chart) {
        renderChartElement(slide, pptx, chart, regions.chart, tokens, exportMode);
      }
      // First-class callout
      if (s.callout && regions.callout) {
        renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "accent");
      }
      break;
    }

    case "chart-split":
    case "two-column": {
      // Chart on left, table on right
      if (chart) {
        if (regions.chart) {
          renderChartElement(slide, pptx, chart, regions.chart, tokens, exportMode);
        }
        // Table with same data on right
        if (regions.table) {
          renderTable(slide, chart, regions.table, tokens, tableMaxRows, tableMaxCols);
        }
      }
      // Body text in right column
      if (s.body && regions.body) {
        renderBody(slide, s.body, regions.body, tokens, notesOverflow, bodyMaxWords);
      } else if (s.bullets && s.bullets.length > 0 && regions.body) {
        renderBullets(slide, s.bullets, regions.body, tokens, maxBulletsFromArch);
      }
      // First-class callout (if provided), else derive from body/bullet
      if (regions.callout) {
        if (s.callout) {
          renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "accent");
        } else if (s.body || (s.bullets && s.bullets.length > 0)) {
          const calloutText = s.body || s.bullets?.[0] || "";
          if (calloutText) {
            renderCallout(slide, pptx, calloutText, regions.callout, tokens, "accent");
          }
        }
      }
      // Metrics at top
      if (s.metrics && s.metrics.length > 0 && regions.metrics) {
        renderMetrics(slide, pptx, s.metrics, regions.metrics, tokens);
      }
      break;
    }

    case "evidence-grid": {
      // Metrics ribbon at top
      if (s.metrics && s.metrics.length > 0 && regions.metrics) {
        renderMetrics(slide, pptx, s.metrics, regions.metrics, tokens);
      }
      // Chart on left
      if (chart && regions.chart) {
        renderChartElement(slide, pptx, chart, regions.chart, tokens, exportMode);
      }
      // Body/bullets on right
      if (regions.body) {
        if (s.bullets && s.bullets.length > 0) {
          renderBullets(slide, s.bullets, regions.body, tokens, maxBulletsFromArch);
        } else if (s.body) {
          renderBody(slide, s.body, regions.body, tokens, notesOverflow, bodyMaxWords);
        }
      }
      // First-class callout at bottom, else fallback
      if (regions.callout) {
        if (s.callout) {
          renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "green");
        } else if (s.body && s.bullets && s.bullets.length > 0) {
          renderCallout(slide, pptx, s.body, regions.callout, tokens, "green");
        }
      }
      break;
    }

    case "metrics":
    case "exec-summary": {
      if (s.metrics && s.metrics.length > 0 && regions.metrics) {
        renderMetrics(slide, pptx, s.metrics, regions.metrics, tokens);
      }
      // exec-summary uses bullets region; metrics layout uses body region
      if (layoutId === "exec-summary" && s.bullets && s.bullets.length > 0 && regions.bullets) {
        renderBullets(slide, s.bullets, regions.bullets, tokens, maxBulletsFromArch);
      } else if (s.body && regions.body) {
        renderBody(slide, s.body, regions.body, tokens, notesOverflow, bodyMaxWords);
      } else if (s.bullets && s.bullets.length > 0) {
        const fallbackRegion = regions.bullets || regions.body;
        if (fallbackRegion) {
          renderBullets(slide, s.bullets, fallbackRegion, tokens, maxBulletsFromArch);
        }
      }
      // First-class callout
      if (s.callout && regions.callout) {
        renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "accent");
      }
      break;
    }

    case "title-body":
    case "title-bullets": {
      if (s.bullets && s.bullets.length > 0 && regions.body) {
        renderBullets(slide, s.bullets, regions.body, tokens, maxBulletsFromArch);
      }
      if (s.body && regions.body) {
        const bodyY = s.bullets?.length ? regions.body.y + Math.min(s.bullets.length * 0.3, 1.5) : regions.body.y;
        const bodyH = s.bullets?.length ? regions.body.h - Math.min(s.bullets.length * 0.3, 1.5) : regions.body.h;
        if (bodyH > 0.3) {
          renderBody(slide, s.body, { ...regions.body, y: bodyY, h: bodyH }, tokens, notesOverflow, bodyMaxWords);
        }
      }
      // First-class callout
      if (s.callout && regions.callout) {
        renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "accent");
      }
      break;
    }

    case "table": {
      if (chart && regions.table) {
        renderTable(slide, chart, regions.table, tokens, tableMaxRows, tableMaxCols);
      }
      break;
    }

    case "comparison": {
      if (chart && regions.chart) {
        renderChartElement(slide, pptx, chart, regions.chart, tokens, exportMode);
      }
      // Second chart area: use bullets or body
      if (regions.chart2) {
        if (s.bullets && s.bullets.length > 0) {
          renderBullets(slide, s.bullets, regions.chart2, tokens, maxBulletsFromArch);
        } else if (s.body) {
          renderBody(slide, s.body, regions.chart2, tokens, notesOverflow, bodyMaxWords);
        }
      }
      break;
    }

    case "summary": {
      if (s.body && regions.body) {
        renderBody(slide, s.body, regions.body, tokens, notesOverflow, bodyMaxWords);
      }
      if (regions.callout) {
        if (s.callout) {
          renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "green");
        } else {
          const calloutText =
            s.bullets && s.bullets.length > 0 ? s.bullets.join(" | ") : s.body || "";
          if (calloutText && (!s.body || (s.bullets && s.bullets.length > 0))) {
            renderCallout(slide, pptx, calloutText, regions.callout, tokens, "green");
          }
        }
      }
      break;
    }

    default: {
      // Fallback: chart if available, else body/bullets
      if (chart) {
        const chartRegion = regions.chart || regions.body || { x: 0.55, y: 0.85, w: 8.9, h: 3.8 };
        renderChartElement(slide, pptx, chart, chartRegion, tokens, exportMode);
      } else if (s.body && regions.body) {
        renderBody(slide, s.body, regions.body, tokens, notesOverflow, bodyMaxWords);
      } else if (s.bullets && s.bullets.length > 0) {
        const bulletRegion =
          regions.bullets || regions.body || { x: 0.55, y: 0.85, w: 8.9, h: 3.8 };
        renderBullets(slide, s.bullets, bulletRegion, tokens, maxBulletsFromArch);
      }
      break;
    }
  }

  // Speaker notes — include any overflow text
  const notesParts: string[] = [];
  if (s.speakerNotes) notesParts.push(processNewlines(s.speakerNotes));
  if (notesOverflow.length > 0) notesParts.push(...notesOverflow);
  if (notesParts.length > 0) {
    slide.addNotes(notesParts.join("\n\n"));
  }
}

// ─── PUBLIC API ─────────────────────────────────────────────────

export async function renderV2PptxArtifact(
  input: RenderV2PptxInput,
): Promise<BinaryArtifact> {
  const tokens = resolveTokens(input.brandTokens);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "BASQUIO_16x9", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "BASQUIO_16x9";
  pptx.author = "Basquio";
  pptx.company = "Basquio";
  pptx.subject = "Basquio report output";
  pptx.title = input.deckTitle;
  pptx.theme = {
    headFontFace: tokens.typography.headingFont,
    bodyFontFace: tokens.typography.bodyFont,
  };

  // ── Slide Masters ──

  pptx.defineSlideMaster({
    title: "BASQUIO_COVER",
    background: { fill: norm(tokens.palette.coverBg) },
    objects: [],
  });

  pptx.defineSlideMaster({
    title: "BASQUIO_MASTER",
    background: { fill: norm(tokens.palette.bg) },
    objects: [
      // Top accent rule — thin 2pt colored line (consulting-grade header)
      { rect: { x: 0, y: 0.02, w: "100%", h: 0.028, fill: { color: norm(tokens.palette.accent) } } },
      // Footer hairline rule — 0.5pt gray line (not a dark band)
      { rect: { x: 0.45, y: 5.30, w: 9.1, h: 0.007, fill: { color: "E5E7EB" } } },
      // Footer left: source
      {
        text: {
          text: `Source: ${input.deckTitle}`,
          options: {
            x: 0.45,
            y: 5.34,
            w: 5,
            h: 0.20,
            fontSize: 7,
            fontFace: tokens.typography.bodyFont,
            color: "9CA3AF",
          },
        },
      },
    ],
    slideNumber: {
      x: 8.5,
      y: 5.34,
      w: 1.0,
      h: 0.20,
      fontSize: 7,
      fontFace: tokens.typography.bodyFont,
      color: "9CA3AF",
      align: "right",
    },
  });

  // Build chart lookup
  const chartsMap = new Map<string, V2ChartRow>();
  for (const chart of input.charts) {
    chartsMap.set(chart.id, chart);
  }

  const sortedSlides = [...input.slides].sort((a, b) => a.position - b.position);

  for (const slideData of sortedSlides) {
    const isCover = slideData.layoutId === "cover";
    const slide = pptx.addSlide({ masterName: isCover ? "BASQUIO_COVER" : "BASQUIO_MASTER" });

    if (isCover) {
      renderCoverSlide(slide, pptx, slideData, tokens);
    } else {
      renderContentSlide(slide, pptx, slideData, chartsMap, tokens, input.exportMode ?? "powerpoint-native");
    }

    // Speaker notes for cover
    if (isCover && slideData.speakerNotes) {
      slide.addNotes(processNewlines(slideData.speakerNotes));
    }
  }

  const rawBuffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  // Post-process PPTX for Google Slides / Keynote compatibility:
  // PptxGenJS uses multiLvlStrRef for category labels, which Google Slides
  // misreads (shows numbers instead of labels). Replace with strRef.
  // Also fixes some Keynote chart rendering issues.
  const buffer = await fixPptxChartCompatibility(rawBuffer);

  return {
    fileName: "basquio-deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  };
}

// ─── CROSS-APP COMPATIBILITY POST-PROCESSOR ─────────────────────
// Fix PptxGenJS chart XML bugs that break Google Slides and Keynote:
// 1. Replace multiLvlStrRef with strRef (Google Slides label bug, PR #1273)
// 2. Replace hardcoded Calibri font refs with safe fonts

async function fixPptxChartCompatibility(pptxBuffer: Buffer): Promise<Buffer> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(pptxBuffer);
    let modified = false;

    // Fix chart XML files
    const chartEntries = Object.keys(zip.files).filter(
      (f) => /^ppt\/charts\/chart\d+\.xml$/i.test(f),
    );

    for (const entry of chartEntries) {
      let xml = await zip.files[entry].async("text");
      const original = xml;

      // Replace multiLvlStrRef with strRef (Google Slides compat)
      // multiLvlStrRef uses <c:lvl> nesting that Google Slides can't parse
      // strRef uses flat <c:strCache> which works everywhere
      xml = xml.replace(/<c:multiLvlStrRef>/g, "<c:strRef>");
      xml = xml.replace(/<\/c:multiLvlStrRef>/g, "</c:strRef>");
      // Flatten <c:lvl> wrappers inside strRef (now-renamed from multiLvlStrRef)
      xml = xml.replace(/<c:lvl>/g, "");
      xml = xml.replace(/<\/c:lvl>/g, "");

      if (xml !== original) {
        zip.file(entry, xml);
        modified = true;
      }
    }

    // Fix hardcoded Calibri in chart Excel theme (cosmetic but prevents Keynote warnings)
    const chartStyleEntries = Object.keys(zip.files).filter(
      (f) => /^ppt\/charts\/_rels\/|^ppt\/embeddings\/.*\.xml$/i.test(f),
    );
    for (const entry of chartStyleEntries) {
      if (!zip.files[entry] || zip.files[entry].dir) continue;
      try {
        let xml = await zip.files[entry].async("text");
        const original = xml;
        xml = xml.replace(/typeface="Calibri"/g, 'typeface="Arial"');
        xml = xml.replace(/typeface="Calibri Light"/g, 'typeface="Arial"');
        if (xml !== original) {
          zip.file(entry, xml);
          modified = true;
        }
      } catch { /* skip binary entries */ }
    }

    if (modified) {
      return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    }
    return pptxBuffer;
  } catch {
    // If post-processing fails, return original buffer
    return pptxBuffer;
  }
}
