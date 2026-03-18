import PptxGenJS from "pptxgenjs";

import { getLayoutRegions, SLIDE_W, SLIDE_H, type LayoutRegions, type R } from "@basquio/scene-graph/layout-regions";
import { getArchetypeOrDefault } from "@basquio/scene-graph/slot-archetypes";
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
};

export type RenderV2PptxInput = {
  deckTitle: string;
  slides: V2SlideRow[];
  charts: V2ChartRow[];
  brandTokens?: Partial<BrandTokens>;
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
    ink: "111827",
    muted: "4B5563",
    border: "D1D5DB",
    surface: "F8FAFC",
    bg: "FFFFFF",
    accent: "0F4C81",
    accentLight: "DCEAF7",
    positive: "1F7A4D",
    negative: "B42318",
    coverBg: "1B2541",
    calloutGreen: "16A34A",
    calloutOrange: "EA580C",
  },
  typography: {
    headingFont: "Arial",
    bodyFont: "Arial",
    coverTitleSize: 32,
    titleSize: 24,
    subtitleSize: 12,
    bodySize: 11,
    bulletSize: 11,
    chartTitleSize: 9,
    sourceSize: 7,
    kpiValueSize: 28,
    kpiLabelSize: 9,
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
    case "stacked_bar":
    case "waterfall":
      return pptx.ChartType.bar;
    case "line":
      return pptx.ChartType.line;
    case "pie":
      return pptx.ChartType.pie;
    case "doughnut":
      return pptx.ChartType.doughnut;
    case "scatter":
      return pptx.ChartType.scatter;
    case "area":
      return pptx.ChartType.area;
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
  const isBar = effectiveChartType === "bar" || effectiveChartType === "stacked_bar";

  // Show legend for multi-series charts and pies; hide only for single-series bar/line
  const showLegend = chart.style.showLegend ??
    (coercedPieLike ? true : singleSeries ? false : true);

  const baseOpts: Record<string, unknown> = {
    showTitle: false,
    showLegend,
    legendPos: coercedPieLike ? "r" : "b",
    legendFontSize: 7,
    legendColor: norm(tokens.palette.muted),
    legendFontFace: tokens.typography.bodyFont,

    showCatAxisTitle: false,
    catAxisLabelColor: norm(tokens.palette.ink),
    catAxisLabelFontSize: 9,
    catAxisLabelFontFace: tokens.typography.bodyFont,
    catAxisLineShow: true,
    catAxisLineColor: "D1D5DB",

    showValAxisTitle: false,
    valAxisLabelColor: norm(tokens.palette.muted),
    valAxisLabelFontSize: 8,
    valAxisLabelFontFace: tokens.typography.bodyFont,
    valAxisLineShow: false,
    valAxisLabelFormatCode: "#,##0",
    valGridLine: { color: "E5E7EB", size: 0.5 },
    catGridLine: { style: "none" },

    chartColors: palette,
    // Larger data labels, more visible
    // Always show data labels for readability — this is consulting-grade, not BI-export
    showValue: chart.style.showValues ?? true,
    dataLabelPosition: isBar ? "outEnd" : effectiveChartType === "line" ? "t" : "outEnd",
    dataLabelFontSize: 9,
    dataLabelFontFace: tokens.typography.bodyFont,
    dataLabelColor: norm(tokens.palette.ink),
    dataLabelFontBold: true,
    lineSize: 2,
    barGapWidthPct: 60,
  };

  // Horizontal bars for bar type
  if (effectiveChartType === "bar") {
    baseOpts.barDir = "bar";
  }

  // Stacked bar (including coerced pie/doughnut)
  if (effectiveChartType === "stacked_bar") {
    baseOpts.barDir = "bar";
    baseOpts.barGrouping = "stacked";
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
  pptx: PptxGenJS,
  metrics: NonNullable<V2SlideRow["metrics"]>,
  region: R,
  tokens: BrandTokens,
): void {
  const count = Math.min(metrics.length, 4);
  const gap = 0.12;
  const cardW = (region.w - gap * (count - 1)) / count;
  const cardH = Math.min(region.h, 1.15);

  metrics.slice(0, 4).forEach((m, i) => {
    const cardX = region.x + i * (cardW + gap);

    // Card container (rounded rectangle with surface fill)
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cardX,
      y: region.y,
      w: cardW,
      h: cardH,
      rectRadius: 0.06,
      fill: { color: norm(tokens.palette.surface) },
      line: { color: norm(tokens.palette.border), pt: 0.5 },
    });

    // Left accent strip
    slide.addShape(pptx.ShapeType.rect, {
      x: cardX,
      y: region.y,
      w: 0.045,
      h: cardH,
      fill: { color: norm(tokens.palette.accent) },
    });

    // Label (uppercase, muted)
    slide.addText(m.label.toUpperCase(), {
      x: cardX + 0.14,
      y: region.y + 0.08,
      w: cardW - 0.22,
      h: 0.22,
      fontSize: 9,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.muted),
      bold: true,
    });

    // Value (large, bold — the hero element)
    slide.addText(m.value, {
      x: cardX + 0.14,
      y: region.y + 0.28,
      w: cardW - 0.22,
      h: 0.45,
      fontSize: 28,
      fontFace: tokens.typography.headingFont,
      bold: true,
      color: norm(tokens.palette.ink),
      valign: "middle",
    });

    // Delta (color-coded)
    if (m.delta) {
      const isPositive =
        m.delta.startsWith("+") || m.delta.includes("↑") || m.delta.toLowerCase().includes("up");
      slide.addText(m.delta, {
        x: cardX + 0.14,
        y: region.y + 0.72,
        w: cardW - 0.22,
        h: 0.2,
        fontSize: 9,
        fontFace: tokens.typography.bodyFont,
        bold: true,
        color: norm(isPositive ? tokens.palette.positive : tokens.palette.negative),
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

  // Header row: dark navy bg, white bold text
  const headerRow: PptxGenJS.TableCell[] = visibleHeaders.map((h, colIdx) => ({
    text: h,
    options: {
      fill: { color: norm(tokens.palette.coverBg) },
      color: "FFFFFF",
      bold: true,
      fontSize: 8,
      fontFace: tokens.typography.bodyFont,
      align: (colIdx === 0 ? "left" : "right") as "left" | "right",
      valign: "middle" as const,
      margin: [2, 4, 2, 4],
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
      return {
        text: formatValue(val),
        options: {
          fontSize: 8,
          fontFace: tokens.typography.bodyFont,
          color: norm(tokens.palette.ink),
          bold: isHighlighted || colIdx === 0,
          fill: { color: rowFill },
          align: (colIdx === 0 ? "left" : isNumericValue(val) ? "right" : "left") as
            | "left"
            | "right",
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
  pptx: PptxGenJS,
  text: string,
  region: R,
  tokens: BrandTokens,
  variant: "green" | "orange" | "accent" = "accent",
): void {
  const fills: Record<string, string> = {
    green: tokens.palette.calloutGreen,
    orange: tokens.palette.calloutOrange,
    accent: tokens.palette.accent,
  };

  slide.addShape(pptx.ShapeType.roundRect, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    fill: { color: norm(fills[variant]) },
    rectRadius: 0.06,
  });

  slide.addText(processNewlines(text), {
    x: region.x + 0.16,
    y: region.y + 0.04,
    w: region.w - 0.32,
    h: region.h - 0.08,
    fontSize: 10,
    fontFace: tokens.typography.bodyFont,
    color: "FFFFFF",
    bold: true,
    wrap: true,
  });
}

function renderChartElement(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  chart: V2ChartRow,
  region: R,
  tokens: BrandTokens,
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

  slide.addChart(
    mapPptxChartType(pptx, effectiveChartType),
    chartData as unknown as PptxGenJS.OptsChartData[],
    {
      x: chartRegion.x,
      y: chartRegion.y,
      w: chartRegion.w,
      h: chartRegion.h,
      ...opts,
    } as PptxGenJS.IChartOpts,
  );
}

// ─── PER-LAYOUT RENDERERS ───────────────────────────────────────

function renderCoverSlide(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  tokens: BrandTokens,
): void {
  // Cover uses BASQUIO_COVER master (dark navy bg, no chrome)
  const regions = getLayoutRegions("cover");
  renderTitle(slide, s.title, regions.title, tokens, true);
  if (s.subtitle && regions.subtitle) {
    renderSubtitle(slide, s.subtitle, regions.subtitle, tokens, true);
  }
}

function renderContentSlide(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>,
  tokens: BrandTokens,
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
        renderChartElement(slide, pptx, chart, regions.chart, tokens);
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
          renderChartElement(slide, pptx, chart, regions.chart, tokens);
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
        renderChartElement(slide, pptx, chart, regions.chart, tokens);
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
        renderChartElement(slide, pptx, chart, regions.chart, tokens);
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
        renderChartElement(slide, pptx, chart, chartRegion, tokens);
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
      // Top accent rule
      { rect: { x: 0, y: 0, w: "100%", h: 0.06, fill: { color: norm(tokens.palette.accent) } } },
      // Footer bar (thinner, more refined)
      {
        rect: {
          x: 0,
          y: 5.3,
          w: "100%",
          h: 0.32,
          fill: { color: norm(tokens.palette.coverBg) },
        },
      },
      // Footer source text
      {
        text: {
          text: `Source: ${input.deckTitle} | Basquio`,
          options: {
            x: 0.45,
            y: 5.35,
            w: 6,
            h: 0.22,
            fontSize: 7,
            fontFace: tokens.typography.bodyFont,
            color: "FFFFFF",
            italic: true,
          },
        },
      },
    ],
    slideNumber: {
      x: 8.8,
      y: 5.35,
      w: 0.6,
      h: 0.22,
      fontSize: 7,
      fontFace: tokens.typography.bodyFont,
      color: "9CA3AF",
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
      renderContentSlide(slide, pptx, slideData, chartsMap, tokens);
    }

    // Speaker notes for cover
    if (isCover && slideData.speakerNotes) {
      slide.addNotes(processNewlines(slideData.speakerNotes));
    }
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  return {
    fileName: "basquio-deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  };
}
