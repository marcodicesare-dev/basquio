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

// ─── BRAND TOKENS ────────────────────────────────────────────────

type BrandTokens = {
  palette: {
    text: string;
    accent: string;
    highlight: string;
    bg: string;
    surface: string;
    border: string;
    accentMuted: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    headingSize: number;
    bodySize: number;
    metricSize: number;
  };
  chartPalette: string[];
};

const DEFAULT_CHART_PALETTE = [
  "1A56DB",
  "E85D04",
  "2E7D32",
  "7B1FA2",
  "C62828",
  "00838F",
  "F9A825",
  "546E7A",
];

const DEFAULT_TOKENS: BrandTokens = {
  palette: {
    text: "2D2D2D",
    accent: "1A56DB",
    highlight: "E85D04",
    bg: "FFFFFF",
    surface: "F5F7FA",
    border: "E5E7EB",
    accentMuted: "EBF0FE",
  },
  typography: {
    headingFont: "Inter",
    bodyFont: "Inter",
    headingSize: 24,
    bodySize: 12,
    metricSize: 28,
  },
  chartPalette: DEFAULT_CHART_PALETTE,
};

function resolveTokens(partial?: Partial<BrandTokens>): BrandTokens {
  if (!partial) return DEFAULT_TOKENS;
  return {
    palette: { ...DEFAULT_TOKENS.palette, ...partial.palette },
    typography: { ...DEFAULT_TOKENS.typography, ...partial.typography },
    chartPalette: partial.chartPalette ?? DEFAULT_TOKENS.chartPalette,
  };
}

// ─── LAYOUT REGIONS ──────────────────────────────────────────────

type Region = { x: number; y: number; w: number; h: number };
type LayoutRegions = Record<string, Region>;

const LAYOUT_REGIONS: Record<string, LayoutRegions> = {
  cover: {
    title:    { x: 0.7, y: 1.5, w: 8.6, h: 1.2 },
    subtitle: { x: 0.7, y: 2.8, w: 8.6, h: 0.8 },
  },
  "title-body": {
    title: { x: 0.7, y: 0.4, w: 8.6, h: 0.8 },
    body:  { x: 0.7, y: 1.5, w: 8.6, h: 3.8 },
  },
  "title-bullets": {
    title:   { x: 0.7, y: 0.4, w: 8.6, h: 0.8 },
    bullets: { x: 0.7, y: 1.5, w: 8.6, h: 3.8 },
  },
  "title-chart": {
    title: { x: 0.7, y: 0.4, w: 8.6, h: 0.8 },
    chart: { x: 0.3, y: 1.4, w: 9.4, h: 4.0 },
  },
  "chart-split": {
    title:   { x: 0.7, y: 0.4, w: 8.6, h: 0.8 },
    chart:   { x: 0.3, y: 1.4, w: 5.2, h: 3.8 },
    content: { x: 5.7, y: 1.4, w: 4.0, h: 3.8 },
  },
  metrics: {
    title:   { x: 0.7, y: 0.4, w: 8.6, h: 0.8 },
    metrics: { x: 0.7, y: 1.5, w: 8.6, h: 1.6 },
    body:    { x: 0.7, y: 3.3, w: 8.6, h: 2.0 },
  },
  comparison: {
    title: { x: 0.7, y: 0.4, w: 8.6, h: 0.8 },
    left:  { x: 0.5, y: 1.4, w: 4.3, h: 3.8 },
    right: { x: 5.2, y: 1.4, w: 4.3, h: 3.8 },
  },
  "evidence-grid": {
    title:    { x: 0.7, y: 0.4, w: 8.6, h: 0.8 },
    metrics:  { x: 0.7, y: 1.3, w: 8.6, h: 1.2 },
    chart:    { x: 0.3, y: 2.7, w: 5.2, h: 2.7 },
    evidence: { x: 5.7, y: 2.7, w: 4.0, h: 2.7 },
  },
  table: {
    title: { x: 0.7, y: 0.4, w: 8.6, h: 0.8 },
    table: { x: 0.3, y: 1.5, w: 9.4, h: 3.8 },
  },
  summary: {
    title:   { x: 0.7, y: 0.4, w: 8.6, h: 0.8 },
    body:    { x: 0.7, y: 1.5, w: 8.6, h: 2.2 },
    callout: { x: 1.2, y: 3.9, w: 7.6, h: 1.2 },
  },
};

function getRegions(layoutId: string): LayoutRegions {
  return LAYOUT_REGIONS[layoutId] ?? LAYOUT_REGIONS["title-body"];
}

// ─── COLOR HELPERS ───────────────────────────────────────────────

function norm(color: string): string {
  return color.replace("#", "").toUpperCase();
}

// ─── CHART TRANSFORMS ────────────────────────────────────────────

type PptxChartType = "bar" | "line" | "pie" | "scatter" | "doughnut" | "area";

function mapChartType(chartType: string): PptxChartType {
  switch (chartType) {
    case "bar":
    case "stacked_bar":
    case "waterfall":
      return "bar";
    case "line":
      return "line";
    case "pie":
      return "pie";
    case "scatter":
      return "scatter";
    default:
      return "bar";
  }
}

function buildWaterfallSeries(
  chart: V2ChartRow,
  labels: string[],
): {
  chartData: Array<{ name: string; labels: string[]; values: number[] }>;
  opts: Record<string, unknown>;
} {
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
      barGrouping: "stacked",
      chartColors: ["FFFFFF", "2E7D32", "C62828"],
      chartColorsOpacity: [0, 100, 100],
      showLegend: false,
    },
  };
}

function toChartData(
  chart: V2ChartRow,
  tokens: BrandTokens,
): {
  pptxType: PptxChartType;
  chartData: Array<{ name: string; labels: string[]; values: number[] }>;
  opts: Record<string, unknown>;
} {
  const labels = chart.data.map((row) => String(row[chart.xAxis] ?? ""));
  const palette =
    chart.style.colors?.map((c) => norm(c)) ??
    tokens.chartPalette.map((c) => norm(c));

  const baseOpts: Record<string, unknown> = {
    showLegend: chart.style.showLegend ?? chart.series.length > 1,
    legendPos: "b",
    showValue: chart.style.showValues ?? false,
    chartColors: palette,
    catAxisLabelFontFace: tokens.typography.bodyFont,
    catAxisLabelFontSize: 9,
    valAxisLabelFontFace: tokens.typography.bodyFont,
    valAxisLabelFontSize: 9,
    catAxisColor: norm(tokens.palette.border),
    valAxisColor: norm(tokens.palette.border),
    gridLine: { color: norm(tokens.palette.border), transparency: 55 },
    valAxisLabelFormatCode: "#,##0",
    showTitle: false,
    lineSize: 2,
    legendColor: norm(tokens.palette.text),
    legendFontFace: tokens.typography.bodyFont,
    legendFontSize: 9,
  };

  if (chart.chartType === "waterfall") {
    const wf = buildWaterfallSeries(chart, labels);
    return {
      pptxType: "bar",
      chartData: wf.chartData,
      opts: { ...baseOpts, ...wf.opts },
    };
  }

  if (chart.chartType === "stacked_bar") {
    baseOpts.barGrouping = "stacked";
  }

  const chartData = chart.series.map((seriesKey) => ({
    name: seriesKey,
    labels,
    values: chart.data.map((row) => Number(row[seriesKey]) || 0),
  }));

  return {
    pptxType: mapChartType(chart.chartType),
    chartData,
    opts: baseOpts,
  };
}

function resolvePptxChartType(
  pptx: PptxGenJS,
  pptxType: PptxChartType,
): PptxGenJS.CHART_NAME {
  switch (pptxType) {
    case "bar":
      return pptx.ChartType.bar;
    case "line":
      return pptx.ChartType.line;
    case "pie":
      return pptx.ChartType.pie;
    case "scatter":
      return pptx.ChartType.scatter;
    case "doughnut":
      return pptx.ChartType.doughnut;
    case "area":
      return pptx.ChartType.area;
    default:
      return pptx.ChartType.bar;
  }
}

// ─── TABLE RENDERING ─────────────────────────────────────────────

function renderTable(
  slide: PptxGenJS.Slide,
  chart: V2ChartRow,
  region: Region,
  tokens: BrandTokens,
): void {
  const headers = [chart.xAxis, ...chart.series].filter(Boolean);
  if (headers.length === 0) return;

  const maxRows = 20;
  const maxCols = 8;
  const visibleHeaders = headers.slice(0, maxCols);

  const headerRow: PptxGenJS.TableCell[] = visibleHeaders.map((h) => ({
    text: h,
    options: {
      bold: true,
      fill: { color: norm(tokens.palette.accent) },
      color: "FFFFFF",
      fontSize: 10,
      fontFace: tokens.typography.bodyFont,
      align: "center" as const,
      valign: "middle" as const,
    },
  }));

  const dataRows: PptxGenJS.TableCell[][] = chart.data
    .slice(0, maxRows)
    .map((row, i) =>
      visibleHeaders.map((col) => ({
        text: String(row[col] ?? ""),
        options: {
          fill: {
            color: norm(i % 2 === 0 ? tokens.palette.surface : tokens.palette.bg),
          },
          fontSize: 9,
          fontFace: tokens.typography.bodyFont,
          color: norm(tokens.palette.text),
          valign: "middle" as const,
        },
      })),
    );

  slide.addTable([headerRow, ...dataRows], {
    x: region.x,
    y: region.y,
    w: region.w,
    colW: visibleHeaders.map(() => region.w / visibleHeaders.length),
    border: {
      type: "solid",
      pt: 0.5,
      color: norm(tokens.palette.border),
    },
    autoPage: false,
  });

  if (chart.data.length > maxRows) {
    slide.addText(`Showing top ${maxRows} of ${chart.data.length} rows`, {
      x: region.x,
      y: region.y + region.h - 0.3,
      w: region.w,
      h: 0.25,
      fontSize: 8,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.border),
      align: "right",
      italic: true,
    });
  }
}

// ─── CHART RENDERING ─────────────────────────────────────────────

function renderChartElement(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  chart: V2ChartRow,
  region: Region,
  tokens: BrandTokens,
): void {
  if (chart.chartType === "table") {
    renderTable(slide, chart, region, tokens);
    return;
  }

  const { pptxType, chartData, opts } = toChartData(chart, tokens);

  if (chartData.length === 0) return;

  // Chart title label
  slide.addText(chart.title, {
    x: region.x + 0.1,
    y: region.y + 0.08,
    w: region.w - 0.2,
    h: 0.3,
    fontFace: tokens.typography.bodyFont,
    fontSize: 9,
    bold: true,
    color: norm(tokens.palette.text),
  });

  slide.addChart(
    resolvePptxChartType(pptx, pptxType),
    chartData as unknown as PptxGenJS.OptsChartData[],
    {
      x: region.x + 0.08,
      y: region.y + 0.4,
      w: region.w - 0.16,
      h: region.h - 0.52,
      ...opts,
    } as PptxGenJS.IChartOpts,
  );
}

// ─── METRIC CARDS ────────────────────────────────────────────────

function renderMetrics(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  metrics: NonNullable<V2SlideRow["metrics"]>,
  region: Region,
  tokens: BrandTokens,
): void {
  const count = Math.min(metrics.length, 4);
  const cardW = (region.w - 0.15 * (count - 1)) / count;

  metrics.slice(0, 4).forEach((m, i) => {
    const cardX = region.x + i * (cardW + 0.15);

    // Card background
    slide.addShape(pptx.ShapeType.roundRect, {
      x: cardX,
      y: region.y,
      w: cardW,
      h: region.h,
      fill: { color: norm(tokens.palette.surface) },
      rectRadius: 0.1,
    });

    // Label
    slide.addText(m.label, {
      x: cardX,
      y: region.y + 0.1,
      w: cardW,
      h: 0.35,
      fontSize: 9,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.text),
      align: "center",
      bold: true,
    });

    // Value
    slide.addText(m.value, {
      x: cardX,
      y: region.y + 0.4,
      w: cardW,
      h: 0.55,
      fontSize: tokens.typography.metricSize,
      fontFace: tokens.typography.headingFont,
      color: norm(tokens.palette.accent),
      align: "center",
      bold: true,
    });

    // Delta
    if (m.delta) {
      const isPositive =
        m.delta.startsWith("+") ||
        m.delta.startsWith("\u2191") ||
        m.delta.toLowerCase().includes("up");
      const deltaColor = isPositive ? "2E7D32" : "C62828";

      slide.addText(m.delta, {
        x: cardX,
        y: region.y + 0.95,
        w: cardW,
        h: 0.3,
        fontSize: 9,
        fontFace: tokens.typography.bodyFont,
        color: deltaColor,
        align: "center",
      });
    }
  });
}

// ─── TEXT ELEMENTS ───────────────────────────────────────────────

function renderTitle(
  slide: PptxGenJS.Slide,
  text: string,
  region: Region,
  tokens: BrandTokens,
  isCover: boolean,
): void {
  slide.addText(text, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    fontFace: tokens.typography.headingFont,
    fontSize: isCover
      ? tokens.typography.headingSize + 8
      : tokens.typography.headingSize,
    bold: true,
    color: norm(isCover ? tokens.palette.bg : tokens.palette.text),
    fit: "shrink",
    breakLine: false,
    margin: 0,
  });
}

function renderSubtitle(
  slide: PptxGenJS.Slide,
  text: string,
  region: Region,
  tokens: BrandTokens,
  isCover: boolean,
): void {
  slide.addText(text, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    fontFace: tokens.typography.bodyFont,
    fontSize: 14,
    color: norm(isCover ? tokens.palette.bg : tokens.palette.text),
    fit: "shrink",
    breakLine: true,
    margin: 0,
  });
}

function renderBody(
  slide: PptxGenJS.Slide,
  text: string,
  region: Region,
  tokens: BrandTokens,
): void {
  slide.addText(text, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    fontSize: tokens.typography.bodySize,
    fontFace: tokens.typography.bodyFont,
    color: norm(tokens.palette.text),
    align: "left",
    valign: "top",
    lineSpacingMultiple: 1.3,
    wrap: true,
  });
}

function renderBullets(
  slide: PptxGenJS.Slide,
  bullets: string[],
  region: Region,
  tokens: BrandTokens,
): void {
  const textObjs: PptxGenJS.TextProps[] = bullets.map((b) => ({
    text: b,
    options: {
      bullet: { code: "2022" },
      fontSize: 11,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.text),
      breakLine: true,
    },
  }));

  slide.addText(textObjs, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    paraSpaceAfter: 6,
    valign: "top",
  });
}

function renderCallout(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  text: string,
  region: Region,
  tokens: BrandTokens,
): void {
  slide.addShape(pptx.ShapeType.roundRect, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    fill: { color: norm(tokens.palette.accentMuted) },
    rectRadius: 0.1,
  });

  slide.addText(text, {
    x: region.x + 0.2,
    y: region.y + 0.15,
    w: region.w - 0.4,
    h: region.h - 0.3,
    fontSize: tokens.typography.bodySize + 1,
    fontFace: tokens.typography.bodyFont,
    color: norm(tokens.palette.text),
    bold: true,
    valign: "middle",
    wrap: true,
  });
}

// ─── SLIDE BACKGROUND ────────────────────────────────────────────

function applySlideBackground(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  layoutId: string,
  tokens: BrandTokens,
): void {
  const isCover = layoutId === "cover";

  slide.background = {
    color: norm(isCover ? tokens.palette.accent : tokens.palette.bg),
  };

  if (!isCover) {
    // Accent top bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 10,
      h: 0.16,
      fill: { color: norm(tokens.palette.accent) },
      line: { color: norm(tokens.palette.accent) },
    });
  }
}

// ─── PER-LAYOUT RENDERING ────────────────────────────────────────

function renderCover(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  tokens: BrandTokens,
): void {
  const r = getRegions("cover");
  renderTitle(slide, s.title, r.title, tokens, true);
  if (s.subtitle) {
    renderSubtitle(slide, s.subtitle, r.subtitle, tokens, true);
  }
}

function renderTitleBody(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  tokens: BrandTokens,
): void {
  const r = getRegions("title-body");
  renderTitle(slide, s.title, r.title, tokens, false);
  if (s.body) {
    renderBody(slide, s.body, r.body, tokens);
  }
}

function renderTitleBullets(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  tokens: BrandTokens,
): void {
  const r = getRegions("title-bullets");
  renderTitle(slide, s.title, r.title, tokens, false);
  if (s.bullets && s.bullets.length > 0) {
    renderBullets(slide, s.bullets, r.bullets, tokens);
  }
}

function renderTitleChart(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>,
  tokens: BrandTokens,
): void {
  const r = getRegions("title-chart");
  renderTitle(slide, s.title, r.title, tokens, false);

  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;
  if (chart) {
    renderChartElement(slide, pptx, chart, r.chart, tokens);
  }
}

function renderChartSplit(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>,
  tokens: BrandTokens,
): void {
  const r = getRegions("chart-split");
  renderTitle(slide, s.title, r.title, tokens, false);

  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;
  if (chart) {
    renderChartElement(slide, pptx, chart, r.chart, tokens);
  }

  // Content panel: bullets take precedence, then body
  if (s.bullets && s.bullets.length > 0) {
    renderBullets(slide, s.bullets, r.content, tokens);
  } else if (s.body) {
    renderBody(slide, s.body, r.content, tokens);
  }
}

function renderMetricsLayout(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  tokens: BrandTokens,
): void {
  const r = getRegions("metrics");
  renderTitle(slide, s.title, r.title, tokens, false);

  if (s.metrics && s.metrics.length > 0) {
    renderMetrics(slide, pptx, s.metrics, r.metrics, tokens);
  }

  if (s.body) {
    renderBody(slide, s.body, r.body, tokens);
  }
}

function renderComparison(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>,
  tokens: BrandTokens,
): void {
  const r = getRegions("comparison");
  renderTitle(slide, s.title, r.title, tokens, false);

  // For comparison, if there's one chart, put it on the left.
  // If body or bullets, put them on the right.
  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;
  if (chart) {
    renderChartElement(slide, pptx, chart, r.left, tokens);
  }

  if (s.bullets && s.bullets.length > 0) {
    renderBullets(slide, s.bullets, r.right, tokens);
  } else if (s.body) {
    renderBody(slide, s.body, r.right, tokens);
  }
}

function renderEvidenceGrid(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>,
  tokens: BrandTokens,
): void {
  const r = getRegions("evidence-grid");
  renderTitle(slide, s.title, r.title, tokens, false);

  if (s.metrics && s.metrics.length > 0) {
    renderMetrics(slide, pptx, s.metrics, r.metrics, tokens);
  }

  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;
  if (chart) {
    renderChartElement(slide, pptx, chart, r.chart, tokens);
  }

  // Evidence panel: bullets or body
  if (s.bullets && s.bullets.length > 0) {
    renderBullets(slide, s.bullets, r.evidence, tokens);
  } else if (s.body) {
    renderBody(slide, s.body, r.evidence, tokens);
  }
}

function renderTableLayout(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>,
  tokens: BrandTokens,
): void {
  const r = getRegions("table");
  renderTitle(slide, s.title, r.title, tokens, false);

  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;
  if (chart) {
    renderTable(slide, chart, r.table, tokens);
  }
}

function renderSummary(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  tokens: BrandTokens,
): void {
  const r = getRegions("summary");
  renderTitle(slide, s.title, r.title, tokens, false);

  if (s.body) {
    renderBody(slide, s.body, r.body, tokens);
  }

  // Callout: use first bullet or last paragraph of body as a summary highlight
  if (s.bullets && s.bullets.length > 0) {
    renderCallout(slide, pptx, s.bullets.join(" "), r.callout, tokens);
  }
}

// ─── SLIDE DISPATCH ──────────────────────────────────────────────

function renderV2Slide(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>,
  tokens: BrandTokens,
): void {
  applySlideBackground(slide, pptx, s.layoutId, tokens);

  switch (s.layoutId) {
    case "cover":
      renderCover(slide, pptx, s, tokens);
      break;
    case "title-body":
      renderTitleBody(slide, pptx, s, tokens);
      break;
    case "title-bullets":
      renderTitleBullets(slide, pptx, s, tokens);
      break;
    case "title-chart":
      renderTitleChart(slide, pptx, s, chartsMap, tokens);
      break;
    case "chart-split":
      renderChartSplit(slide, pptx, s, chartsMap, tokens);
      break;
    case "metrics":
      renderMetricsLayout(slide, pptx, s, tokens);
      break;
    case "comparison":
      renderComparison(slide, pptx, s, chartsMap, tokens);
      break;
    case "evidence-grid":
      renderEvidenceGrid(slide, pptx, s, chartsMap, tokens);
      break;
    case "table":
      renderTableLayout(slide, pptx, s, chartsMap, tokens);
      break;
    case "summary":
      renderSummary(slide, pptx, s, tokens);
      break;
    default:
      // Unknown layout: fall back to title-body
      renderTitleBody(slide, pptx, s, tokens);
      break;
  }

  // Speaker notes (always, regardless of layout)
  if (s.speakerNotes) {
    slide.addNotes(s.speakerNotes);
  }
}

// ─── PUBLIC API ──────────────────────────────────────────────────

export async function renderV2PptxArtifact(
  input: RenderV2PptxInput,
): Promise<BinaryArtifact> {
  const tokens = resolveTokens(input.brandTokens);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "BASQUIO_16x9", width: 10, height: 5.625 });
  pptx.layout = "BASQUIO_16x9";
  pptx.author = "Basquio";
  pptx.company = "Basquio";
  pptx.subject = "Basquio report output";
  pptx.title = input.deckTitle;
  pptx.theme = {
    headFontFace: tokens.typography.headingFont,
    bodyFontFace: tokens.typography.bodyFont,
  };

  // Build chart lookup map
  const chartsMap = new Map<string, V2ChartRow>();
  for (const chart of input.charts) {
    chartsMap.set(chart.id, chart);
  }

  // Render slides in position order
  const sortedSlides = [...input.slides].sort(
    (a, b) => a.position - b.position,
  );

  for (const slideData of sortedSlides) {
    const slide = pptx.addSlide();
    renderV2Slide(slide, pptx, slideData, chartsMap, tokens);
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  return {
    fileName: "basquio-deck.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  };
}
