import PptxGenJS from "pptxgenjs";

import type { BinaryArtifact } from "@basquio/types";

// ─── V2 INPUT TYPES ──────────────────────────────────────────────

export type V2SlideRow = {
  id: string;
  position: number;
  layoutId: string;
  title: string;
  subtitle: string | undefined;
  body: string | undefined;
  bullets: string[] | undefined;
  chartId: string | undefined;
  evidenceIds: string[];
  metrics: { label: string; value: string; delta?: string }[] | undefined;
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
    titleSize: 22,
    subtitleSize: 14,
    bodySize: 11,
    bulletSize: 11,
    chartTitleSize: 9,
    sourceSize: 7,
    kpiValueSize: 24,
    kpiLabelSize: 7,
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

// ─── GEOMETRY ───────────────────────────────────────────────────

const SLIDE_W = 10;
const SLIDE_H = 5.625;

type R = { x: number; y: number; w: number; h: number };

// ─── LAYOUT REGIONS ─────────────────────────────────────────────
// Every layout defines exact { x, y, w, h } for each content zone.

type LayoutRegions = {
  title: R;
  subtitle?: R;
  body?: R;
  chart?: R;
  chart2?: R;
  table?: R;
  metrics?: R;
  callout?: R;
  bullets?: R;
};

function getLayoutRegions(layoutId: string): LayoutRegions {
  switch (layoutId) {
    case "cover":
      return {
        title: { x: 0.55, y: 1.8, w: 8.9, h: 1.5 },
        subtitle: { x: 0.55, y: 3.2, w: 8.9, h: 0.6 },
      };
    case "title-body":
    case "title-bullets":
      return {
        title: { x: 0.55, y: 0.25, w: 8.9, h: 0.5 },
        body: { x: 0.55, y: 0.85, w: 8.9, h: 3.8 },
      };
    case "title-chart":
      return {
        title: { x: 0.55, y: 0.25, w: 8.9, h: 0.5 },
        chart: { x: 0.55, y: 0.85, w: 8.9, h: 3.8 },
      };
    case "chart-split":
    case "two-column":
      return {
        title: { x: 0.55, y: 0.25, w: 8.9, h: 0.5 },
        chart: { x: 0.55, y: 0.85, w: 5.0, h: 3.2 },
        table: { x: 5.7, y: 0.85, w: 3.75, h: 3.2 },
        callout: { x: 0.55, y: 4.2, w: 8.9, h: 0.45 },
        metrics: { x: 0.55, y: 4.7, w: 8.9, h: 0.35 },
      };
    case "evidence-grid":
      return {
        title: { x: 0.55, y: 0.25, w: 8.9, h: 0.5 },
        metrics: { x: 0.55, y: 0.85, w: 8.9, h: 0.5 },
        chart: { x: 0.55, y: 1.45, w: 5.0, h: 2.6 },
        body: { x: 5.7, y: 1.45, w: 3.75, h: 2.6 },
        callout: { x: 0.55, y: 4.2, w: 8.9, h: 0.45 },
      };
    case "metrics":
      return {
        title: { x: 0.55, y: 0.25, w: 8.9, h: 0.5 },
        metrics: { x: 0.55, y: 0.85, w: 8.9, h: 1.0 },
        body: { x: 0.55, y: 2.0, w: 8.9, h: 2.5 },
      };
    case "comparison":
      return {
        title: { x: 0.55, y: 0.25, w: 8.9, h: 0.5 },
        chart: { x: 0.55, y: 0.85, w: 4.3, h: 3.2 },
        chart2: { x: 5.0, y: 0.85, w: 4.45, h: 3.2 },
      };
    case "table":
      return {
        title: { x: 0.55, y: 0.25, w: 8.9, h: 0.5 },
        table: { x: 0.55, y: 0.85, w: 8.9, h: 3.8 },
      };
    case "summary":
      return {
        title: { x: 0.55, y: 0.25, w: 8.9, h: 0.5 },
        body: { x: 0.55, y: 0.85, w: 8.9, h: 2.5 },
        callout: { x: 0.55, y: 3.5, w: 8.9, h: 0.5 },
      };
    case "exec-summary":
      return {
        title: { x: 0.55, y: 0.25, w: 8.9, h: 0.5 },
        metrics: { x: 0.55, y: 0.85, w: 8.9, h: 1.0 },
        bullets: { x: 0.55, y: 2.0, w: 8.9, h: 2.5 },
      };
    default:
      // Fallback: title-body
      return {
        title: { x: 0.55, y: 0.25, w: 8.9, h: 0.5 },
        body: { x: 0.55, y: 0.85, w: 8.9, h: 3.8 },
      };
  }
}

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
} | null {
  if (!chart.data || chart.data.length === 0) return null;
  if (!chart.series || chart.series.length === 0) return null;

  const labels = chart.data.map((row) => String(row[chart.xAxis] ?? ""));
  const palette = chart.style.colors?.map(norm) ?? tokens.chartPalette.map(norm);

  // Check if any series has valid numeric data
  const hasValidData = chart.series.some((seriesKey) =>
    chart.data.some((row) => typeof row[seriesKey] === "number" || !isNaN(Number(row[seriesKey]))),
  );
  if (!hasValidData) return null;

  const baseOpts: Record<string, unknown> = {
    showTitle: false,
    showLegend: chart.style.showLegend ?? chart.series.length > 2,
    legendPos: "b",
    legendFontSize: 8,
    legendColor: norm(tokens.palette.muted),
    legendFontFace: tokens.typography.bodyFont,

    catAxisLabelColor: norm(tokens.palette.muted),
    catAxisLabelFontSize: 8,
    catAxisLabelFontFace: tokens.typography.bodyFont,
    catAxisLineShow: false,

    valAxisLabelColor: norm(tokens.palette.muted),
    valAxisLabelFontSize: 8,
    valAxisLabelFontFace: tokens.typography.bodyFont,
    valAxisLineShow: false,
    valAxisLabelFormatCode: "#,##0",
    valGridLine: { color: "E5E7EB", size: 0.5 },
    catGridLine: { style: "none" },

    chartColors: palette,
    showValue: chart.style.showValues ?? (chart.data.length <= 6),
    dataLabelPosition: "outEnd",
    dataLabelFontSize: 8,
    dataLabelFontFace: tokens.typography.bodyFont,
    dataLabelColor: norm(tokens.palette.ink),
    lineSize: 2,
    barGapWidthPct: 80,
  };

  // Horizontal bars for bar type
  if (chart.chartType === "bar") {
    baseOpts.barDir = "bar";
  }

  // Stacked bar
  if (chart.chartType === "stacked_bar") {
    baseOpts.barDir = "bar";
    baseOpts.barGrouping = "stacked";
  }

  // Waterfall: simulated stacked bar
  if (chart.chartType === "waterfall") {
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
    };
  }

  // Pie
  if (chart.chartType === "pie" || chart.chartType === "doughnut") {
    baseOpts.showPercent = true;
    baseOpts.showValue = false;
    baseOpts.showLegend = true;
    baseOpts.dataLabelPosition = "outEnd";
  }

  // Scatter: no barDir
  if (chart.chartType === "scatter") {
    delete baseOpts.barDir;
    delete baseOpts.barGapWidthPct;
  }

  const chartData = chart.series.map((seriesKey) => ({
    name: seriesKey,
    labels,
    values: chart.data.map((row) => Number(row[seriesKey]) || 0),
  }));

  return { chartData, opts: baseOpts };
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
): void {
  const processed = processNewlines(text);
  const { truncated, overflow } = truncateWords(processed, 80);
  if (overflow && speakerNotesOverflow) {
    speakerNotesOverflow.push(`[Overflow from body]: ${overflow}`);
  }

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
): void {
  const maxBullets = 4;
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
  const cardW = region.w / count - 0.08;

  metrics.slice(0, 4).forEach((m, i) => {
    const cardX = region.x + i * (region.w / count);

    // Left accent border
    slide.addShape(pptx.ShapeType.rect, {
      x: cardX,
      y: region.y,
      w: 0.04,
      h: 0.6,
      fill: { color: norm(tokens.palette.accent) },
    });

    // Label (small, uppercase)
    slide.addText(m.label.toUpperCase(), {
      x: cardX + 0.12,
      y: region.y,
      w: cardW - 0.12,
      h: 0.18,
      fontSize: tokens.typography.kpiLabelSize,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.muted),
      bold: true,
    });

    // Value (large)
    slide.addText(m.value, {
      x: cardX + 0.12,
      y: region.y + 0.16,
      w: cardW - 0.12,
      h: 0.28,
      fontSize: tokens.typography.kpiValueSize,
      fontFace: tokens.typography.headingFont,
      bold: true,
      color: norm(tokens.palette.ink),
    });

    // Delta (green/red)
    if (m.delta) {
      const isPositive =
        m.delta.startsWith("+") || m.delta.includes("↑") || m.delta.toLowerCase().includes("up");
      slide.addText(m.delta, {
        x: cardX + 0.12,
        y: region.y + 0.42,
        w: cardW - 0.12,
        h: 0.16,
        fontSize: 8,
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
): void {
  const headers = [chart.xAxis, ...chart.series].filter(Boolean);
  if (headers.length === 0) return;

  const maxRows = 8;
  const maxCols = 8;
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

  // Data rows: subtle bottom borders, right-aligned numbers
  const dataRows: PptxGenJS.TableCell[][] = rows.map((row) =>
    visibleHeaders.map((col, colIdx) => {
      const val = row[col];
      return {
        text: formatValue(val),
        options: {
          fontSize: 8,
          fontFace: tokens.typography.bodyFont,
          color: norm(tokens.palette.ink),
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
    }),
  );

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

  const { chartData, opts } = built;

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
    mapPptxChartType(pptx, chart.chartType),
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
  const notesOverflow: string[] = [];

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
          renderTable(slide, chart, regions.table, tokens);
        }
      }
      // Callout (from body or first bullet)
      if (regions.callout && (s.body || (s.bullets && s.bullets.length > 0))) {
        const calloutText = s.body || s.bullets?.[0] || "";
        if (calloutText) {
          renderCallout(slide, pptx, calloutText, regions.callout, tokens, "accent");
        }
      }
      // Metrics at bottom
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
          renderBullets(slide, s.bullets, regions.body, tokens);
        } else if (s.body) {
          renderBody(slide, s.body, regions.body, tokens, notesOverflow);
        }
      }
      // Callout at bottom
      if (regions.callout && s.body && s.bullets && s.bullets.length > 0) {
        // Use body as callout if bullets took the body region
        renderCallout(slide, pptx, s.body, regions.callout, tokens, "green");
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
        renderBullets(slide, s.bullets, regions.bullets, tokens);
      } else if (s.body && regions.body) {
        renderBody(slide, s.body, regions.body, tokens, notesOverflow);
      } else if (s.bullets && s.bullets.length > 0) {
        const fallbackRegion = regions.bullets || regions.body;
        if (fallbackRegion) {
          renderBullets(slide, s.bullets, fallbackRegion, tokens);
        }
      }
      break;
    }

    case "title-body":
    case "title-bullets": {
      if (s.bullets && s.bullets.length > 0 && regions.body) {
        renderBullets(slide, s.bullets, regions.body, tokens);
      }
      if (s.body && regions.body) {
        const bodyY = s.bullets?.length ? regions.body.y + Math.min(s.bullets.length * 0.3, 1.5) : regions.body.y;
        const bodyH = s.bullets?.length ? regions.body.h - Math.min(s.bullets.length * 0.3, 1.5) : regions.body.h;
        if (bodyH > 0.3) {
          renderBody(slide, s.body, { ...regions.body, y: bodyY, h: bodyH }, tokens, notesOverflow);
        }
      }
      break;
    }

    case "table": {
      if (chart && regions.table) {
        renderTable(slide, chart, regions.table, tokens);
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
          renderBullets(slide, s.bullets, regions.chart2, tokens);
        } else if (s.body) {
          renderBody(slide, s.body, regions.chart2, tokens, notesOverflow);
        }
      }
      break;
    }

    case "summary": {
      if (s.body && regions.body) {
        renderBody(slide, s.body, regions.body, tokens, notesOverflow);
      }
      if (regions.callout) {
        const calloutText =
          s.bullets && s.bullets.length > 0 ? s.bullets.join(" | ") : s.body || "";
        if (calloutText && (!s.body || (s.bullets && s.bullets.length > 0))) {
          renderCallout(slide, pptx, calloutText, regions.callout, tokens, "green");
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
        renderBody(slide, s.body, regions.body, tokens, notesOverflow);
      } else if (s.bullets && s.bullets.length > 0) {
        const bulletRegion =
          regions.bullets || regions.body || { x: 0.55, y: 0.85, w: 8.9, h: 3.8 };
        renderBullets(slide, s.bullets, bulletRegion, tokens);
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
      // Footer bar
      {
        rect: {
          x: 0,
          y: 5.15,
          w: "100%",
          h: 0.475,
          fill: { color: norm(tokens.palette.coverBg) },
        },
      },
      // Footer text left
      {
        text: {
          text: "Source: Company data analysis | Basquio",
          options: {
            x: 0.55,
            y: 5.22,
            w: 5,
            h: 0.3,
            fontSize: tokens.typography.sourceSize,
            fontFace: tokens.typography.bodyFont,
            color: "FFFFFF",
            italic: true,
          },
        },
      },
    ],
    slideNumber: {
      x: 8.8,
      y: 5.22,
      w: 0.6,
      h: 0.3,
      fontSize: tokens.typography.sourceSize,
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
