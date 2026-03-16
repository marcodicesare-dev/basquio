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
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    coverTitleSize: number;
    titleSize: number;
    bodySize: number;
    bulletSize: number;
    chartTitleSize: number;
    sourceSize: number;
    kpiValueSize: number;
    kpiLabelSize: number;
    eyebrowSize: number;
  };
  chartPalette: string[];
};

const DEFAULT_CHART_PALETTE = [
  "0F4C81", // deep blue (accent)
  "D1D5DB", // muted gray (de-emphasis)
  "1F7A4D", // green
  "B42318", // red
  "C97A00", // amber
  "6B21A8", // purple
  "0E7490", // teal
  "78716C", // warm gray
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
  },
  typography: {
    headingFont: "Aptos Display",
    bodyFont: "Aptos",
    coverTitleSize: 32,
    titleSize: 22,
    bodySize: 11,
    bulletSize: 11,
    chartTitleSize: 9,
    sourceSize: 8,
    kpiValueSize: 26,
    kpiLabelSize: 9,
    eyebrowSize: 9,
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
const MARGIN_L = 0.55;
const MARGIN_R = 0.55;
const MARGIN_T = 0.35;
const CONTENT_W = SLIDE_W - MARGIN_L - MARGIN_R; // 8.9
const TOP_RULE_H = 0.06;
const TITLE_Y = MARGIN_T + TOP_RULE_H + 0.12; // ~0.53
const TITLE_H = 0.55;
const CONTENT_Y = TITLE_Y + TITLE_H + 0.15; // ~1.23
const SOURCE_Y = SLIDE_H - 0.32;
const SOURCE_H = 0.22;
const CONTENT_BOTTOM = SOURCE_Y - 0.08; // ~5.015
const CONTENT_H = CONTENT_BOTTOM - CONTENT_Y; // ~3.785

type R = { x: number; y: number; w: number; h: number };

// ─── CHART TRANSFORMS ───────────────────────────────────────────

function mapPptxChartType(pptx: PptxGenJS, chartType: string): PptxGenJS.CHART_NAME {
  switch (chartType) {
    case "bar": case "stacked_bar": case "waterfall": return pptx.ChartType.bar;
    case "line": return pptx.ChartType.line;
    case "pie": return pptx.ChartType.pie;
    case "doughnut": return pptx.ChartType.doughnut;
    case "scatter": return pptx.ChartType.scatter;
    case "area": return pptx.ChartType.area;
    default: return pptx.ChartType.bar;
  }
}

function buildChartData(chart: V2ChartRow, tokens: BrandTokens): {
  chartData: Array<{ name: string; labels: string[]; values: number[] }>;
  opts: Record<string, unknown>;
} {
  const labels = chart.data.map((row) => String(row[chart.xAxis] ?? ""));
  const palette = chart.style.colors?.map(norm) ?? tokens.chartPalette.map(norm);

  // Correct pptxgenjs option keys (per https://gitbrent.github.io/PptxGenJS/docs/api-charts/)
  const baseOpts: Record<string, unknown> = {
    showLegend: chart.style.showLegend ?? chart.series.length > 2,
    legendPos: "b",
    showValue: chart.style.showValues ?? (chart.data.length <= 6),
    chartColors: palette,
    // Correct axis option names
    catAxisLabelFontFace: tokens.typography.bodyFont,
    catAxisLabelFontSize: 9,
    catAxisLineShow: false,
    valAxisLabelFontFace: tokens.typography.bodyFont,
    valAxisLabelFontSize: 9,
    valAxisLineShow: false,
    valAxisLabelFormatCode: "#,##0",
    // Gridlines — only value axis, light and thin
    valGridLine: { color: norm(tokens.palette.border), size: 0.5 },
    catGridLine: { style: "none" },
    // No chart border
    plotArea: { border: { pt: 0, color: "FFFFFF" }, fill: { color: "FFFFFF" } },
    showTitle: false,
    lineSize: 2,
    legendFontFace: tokens.typography.bodyFont,
    legendFontSize: 9,
    dataLabelFontFace: tokens.typography.bodyFont,
    dataLabelFontSize: 8,
    dataLabelColor: norm(tokens.palette.muted),
  };

  // Waterfall: simulated stacked bar
  if (chart.chartType === "waterfall") {
    const seriesKey = chart.series[0] ?? chart.yAxis;
    const values = chart.data.map((row) => Number(row[seriesKey]) || 0);
    const base: number[] = [], rise: number[] = [], fall: number[] = [];
    let running = 0;
    for (const v of values) {
      if (v >= 0) { base.push(running); rise.push(v); fall.push(0); }
      else { base.push(running + v); rise.push(0); fall.push(Math.abs(v)); }
      running += v;
    }
    return {
      chartData: [
        { name: "Base", labels, values: base },
        { name: "Increase", labels, values: rise },
        { name: "Decrease", labels, values: fall },
      ],
      opts: { ...baseOpts, barGrouping: "stacked", chartColors: ["FFFFFF", norm(tokens.palette.positive), norm(tokens.palette.negative)], showLegend: false },
    };
  }

  if (chart.chartType === "stacked_bar") {
    baseOpts.barGrouping = "stacked";
  }

  // Pie: show percentages, max 6 slices
  if (chart.chartType === "pie") {
    baseOpts.showPercent = true;
    baseOpts.showValue = false;
    baseOpts.showLegend = true;
    baseOpts.dataLabelPosition = "outEnd";
  }

  const chartData = chart.series.map((seriesKey) => ({
    name: seriesKey,
    labels,
    values: chart.data.map((row) => Number(row[seriesKey]) || 0),
  }));

  return { chartData, opts: baseOpts };
}

// ─── COLOR HELPER ───────────────────────────────────────────────

function norm(color: string): string {
  return color.replace("#", "").toUpperCase();
}

// ─── TEXT HELPERS ────────────────────────────────────────────────

function splitNewlines(text: string): string[] {
  return text.split(/\n/).filter((l) => l.trim().length > 0);
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

// ─── ELEMENT RENDERERS ──────────────────────────────────────────

function renderTitle(slide: PptxGenJS.Slide, text: string, region: R, tokens: BrandTokens, isCover: boolean): void {
  const fontSize = isCover ? tokens.typography.coverTitleSize : tokens.typography.titleSize;
  slide.addText(text, {
    x: region.x, y: region.y, w: region.w, h: region.h,
    fontFace: tokens.typography.headingFont,
    fontSize,
    bold: true,
    color: norm(isCover ? tokens.palette.bg : tokens.palette.ink),
    fit: "shrink",
    breakLine: false,
    margin: 0,
    lineSpacingMultiple: 1.1,
  });
}

function renderSubtitle(slide: PptxGenJS.Slide, text: string, region: R, tokens: BrandTokens, isCover: boolean): void {
  slide.addText(text, {
    x: region.x, y: region.y, w: region.w, h: region.h,
    fontFace: tokens.typography.bodyFont,
    fontSize: 14,
    color: norm(isCover ? tokens.palette.bg : tokens.palette.muted),
    margin: 0,
    lineSpacingMultiple: 1.2,
  });
}

function renderBody(slide: PptxGenJS.Slide, text: string, region: R, tokens: BrandTokens): void {
  const truncated = truncateWords(text, 80);
  const lines = splitNewlines(truncated);

  if (lines.length <= 1) {
    slide.addText(truncated, {
      x: region.x, y: region.y, w: region.w, h: region.h,
      fontSize: tokens.typography.bodySize,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.ink),
      align: "left", valign: "top",
      lineSpacingMultiple: 1.4,
      wrap: true,
    });
    return;
  }

  const textProps: PptxGenJS.TextProps[] = lines.map((line) => ({
    text: line,
    options: {
      fontSize: tokens.typography.bodySize,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.ink),
      breakLine: true,
    },
  }));

  slide.addText(textProps, {
    x: region.x, y: region.y, w: region.w, h: region.h,
    lineSpacingMultiple: 1.4, valign: "top",
  });
}

function renderBullets(slide: PptxGenJS.Slide, bullets: string[], region: R, tokens: BrandTokens): void {
  const maxBullets = 5;
  const textProps: PptxGenJS.TextProps[] = bullets.slice(0, maxBullets).map((b) => ({
    text: b,
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
    x: region.x, y: region.y, w: region.w, h: region.h,
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
  const cardW = (region.w - 0.2 * (count - 1)) / count;
  const accentBarW = 0.04;

  metrics.slice(0, 4).forEach((m, i) => {
    const cx = region.x + i * (cardW + 0.2);

    // Left accent bar (consulting-style KPI indicator)
    slide.addShape(pptx.ShapeType.rect, {
      x: cx, y: region.y, w: accentBarW, h: region.h,
      fill: { color: norm(tokens.palette.accent) },
    });

    // Label (top, small, muted)
    slide.addText(m.label.toUpperCase(), {
      x: cx + accentBarW + 0.1, y: region.y + 0.05,
      w: cardW - accentBarW - 0.15, h: 0.25,
      fontSize: tokens.typography.kpiLabelSize,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.muted),
      bold: true,
      align: "left",
    });

    // Value (large, left-aligned)
    slide.addText(m.value, {
      x: cx + accentBarW + 0.1, y: region.y + 0.3,
      w: cardW - accentBarW - 0.15, h: 0.5,
      fontSize: tokens.typography.kpiValueSize,
      fontFace: tokens.typography.headingFont,
      color: norm(tokens.palette.ink),
      bold: true,
      align: "left",
    });

    // Delta (small, colored)
    if (m.delta) {
      const isPositive = m.delta.startsWith("+") || m.delta.startsWith("↑") || m.delta.toLowerCase().includes("up");
      const deltaColor = isPositive ? tokens.palette.positive : tokens.palette.negative;
      const arrow = isPositive ? "▲ " : "▼ ";
      slide.addText(arrow + m.delta, {
        x: cx + accentBarW + 0.1, y: region.y + 0.8,
        w: cardW - accentBarW - 0.15, h: 0.2,
        fontSize: 9,
        fontFace: tokens.typography.bodyFont,
        color: norm(deltaColor),
        align: "left",
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

  // Header row: bold, no fill, bottom border only
  const headerRow: PptxGenJS.TableCell[] = visibleHeaders.map((h) => ({
    text: h,
    options: {
      bold: true,
      fontSize: 9,
      fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.ink),
      align: "left" as const,
      valign: "bottom" as const,
      border: [
        { type: "none" as const },
        { type: "none" as const },
        { type: "solid" as const, pt: 1, color: norm(tokens.palette.ink) },
        { type: "none" as const },
      ],
      margin: [2, 4, 4, 4],
    },
  }));

  // Data rows: subtle separators, right-align numbers
  const dataRows: PptxGenJS.TableCell[][] = chart.data
    .slice(0, maxRows)
    .map((row, rowIdx) =>
      visibleHeaders.map((col, colIdx) => {
        const val = row[col];
        const isNum = typeof val === "number" || (typeof val === "string" && /^[\d.,%-]+$/.test(val));
        return {
          text: String(val ?? ""),
          options: {
            fontSize: 9,
            fontFace: tokens.typography.bodyFont,
            color: norm(tokens.palette.ink),
            align: (colIdx === 0 ? "left" : isNum ? "right" : "left") as "left" | "right",
            valign: "middle" as const,
            border: [
              { type: "none" as const },
              { type: "none" as const },
              { type: "solid" as const, pt: 0.25, color: norm(tokens.palette.border) },
              { type: "none" as const },
            ],
            margin: [2, 4, 2, 4],
            fill: { color: rowIdx % 2 === 0 ? norm(tokens.palette.bg) : norm(tokens.palette.surface) },
          },
        };
      }),
    );

  slide.addTable([headerRow, ...dataRows], {
    x: region.x, y: region.y, w: region.w,
    colW: visibleHeaders.map(() => region.w / visibleHeaders.length),
    border: { type: "none" },
    autoPage: false,
  });

  if (chart.data.length > maxRows) {
    slide.addText(`Showing top ${maxRows} of ${chart.data.length} rows`, {
      x: region.x, y: region.y + region.h - 0.2, w: region.w, h: 0.18,
      fontSize: 7, fontFace: tokens.typography.bodyFont,
      color: norm(tokens.palette.muted), align: "right", italic: true,
    });
  }
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

  const { chartData, opts } = buildChartData(chart, tokens);
  if (chartData.length === 0) return;

  // Chart title (small, above chart area)
  slide.addText(chart.title, {
    x: region.x, y: region.y,
    w: region.w, h: 0.22,
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
      x: chartRegion.x, y: chartRegion.y,
      w: chartRegion.w, h: chartRegion.h,
      ...opts,
    } as PptxGenJS.IChartOpts,
  );
}

function renderSourceNote(slide: PptxGenJS.Slide, tokens: BrandTokens): void {
  slide.addText("Source: Company data analysis  |  Basquio", {
    x: MARGIN_L, y: SOURCE_Y, w: CONTENT_W * 0.7, h: SOURCE_H,
    fontSize: tokens.typography.sourceSize,
    fontFace: tokens.typography.bodyFont,
    color: norm(tokens.palette.muted),
    italic: true,
    align: "left",
    valign: "bottom",
  });
}

function renderSlideNumber(slide: PptxGenJS.Slide, num: number, total: number, tokens: BrandTokens): void {
  slide.addText(`${num} / ${total}`, {
    x: SLIDE_W - MARGIN_R - 0.8, y: SOURCE_Y, w: 0.8, h: SOURCE_H,
    fontSize: 8,
    fontFace: tokens.typography.bodyFont,
    color: norm(tokens.palette.border),
    align: "right",
    valign: "bottom",
  });
}

function renderCallout(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  text: string,
  region: R,
  tokens: BrandTokens,
): void {
  // Left accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: region.x, y: region.y, w: 0.04, h: region.h,
    fill: { color: norm(tokens.palette.accent) },
  });

  // Background
  slide.addShape(pptx.ShapeType.rect, {
    x: region.x + 0.04, y: region.y, w: region.w - 0.04, h: region.h,
    fill: { color: norm(tokens.palette.accentLight) },
  });

  slide.addText(text, {
    x: region.x + 0.2, y: region.y + 0.1,
    w: region.w - 0.4, h: region.h - 0.2,
    fontSize: tokens.typography.bodySize + 1,
    fontFace: tokens.typography.bodyFont,
    color: norm(tokens.palette.ink),
    bold: true,
    valign: "middle",
    wrap: true,
    lineSpacingMultiple: 1.3,
  });
}

// ─── SLIDE CHROME ───────────────────────────────────────────────

function applyCoverChrome(slide: PptxGenJS.Slide, pptx: PptxGenJS, tokens: BrandTokens): void {
  slide.background = { color: norm(tokens.palette.accent) };
}

function applyContentChrome(slide: PptxGenJS.Slide, pptx: PptxGenJS, tokens: BrandTokens): void {
  slide.background = { color: norm(tokens.palette.bg) };

  // Thin accent top rule
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: TOP_RULE_H,
    fill: { color: norm(tokens.palette.accent) },
    line: { color: norm(tokens.palette.accent), width: 0 },
  });

  // Subtle title underline
  slide.addShape(pptx.ShapeType.line, {
    x: MARGIN_L, y: TITLE_Y + TITLE_H + 0.04,
    w: CONTENT_W, h: 0,
    line: { color: norm(tokens.palette.border), width: 0.5 },
  });
}

// ─── PER-LAYOUT RENDERERS ───────────────────────────────────────

function renderCover(slide: PptxGenJS.Slide, pptx: PptxGenJS, s: V2SlideRow, tokens: BrandTokens): void {
  applyCoverChrome(slide, pptx, tokens);
  renderTitle(slide, s.title, { x: 0.8, y: 1.2, w: 8.4, h: 1.5 }, tokens, true);
  if (s.subtitle) {
    renderSubtitle(slide, s.subtitle, { x: 0.8, y: 2.9, w: 8.4, h: 0.8 }, tokens, true);
  }
}

function renderTitleChart(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>, tokens: BrandTokens,
): void {
  applyContentChrome(slide, pptx, tokens);
  renderTitle(slide, s.title, { x: MARGIN_L, y: TITLE_Y, w: CONTENT_W, h: TITLE_H }, tokens, false);

  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;
  if (chart) {
    renderChartElement(slide, pptx, chart, { x: MARGIN_L - 0.1, y: CONTENT_Y, w: CONTENT_W + 0.2, h: CONTENT_H }, tokens);
  }
}

function renderChartSplit(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>, tokens: BrandTokens,
): void {
  applyContentChrome(slide, pptx, tokens);
  renderTitle(slide, s.title, { x: MARGIN_L, y: TITLE_Y, w: CONTENT_W, h: TITLE_H }, tokens, false);

  const chartW = CONTENT_W * 0.58;
  const contentW = CONTENT_W * 0.38;
  const gap = CONTENT_W * 0.04;

  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;
  if (chart) {
    renderChartElement(slide, pptx, chart, { x: MARGIN_L, y: CONTENT_Y, w: chartW, h: CONTENT_H }, tokens);
  }

  const contentX = MARGIN_L + chartW + gap;
  if (s.bullets && s.bullets.length > 0) {
    renderBullets(slide, s.bullets, { x: contentX, y: CONTENT_Y, w: contentW, h: CONTENT_H }, tokens);
  } else if (s.body) {
    renderBody(slide, s.body, { x: contentX, y: CONTENT_Y, w: contentW, h: CONTENT_H }, tokens);
  }
}

function renderMetricsLayout(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, s: V2SlideRow, tokens: BrandTokens,
): void {
  applyContentChrome(slide, pptx, tokens);
  renderTitle(slide, s.title, { x: MARGIN_L, y: TITLE_Y, w: CONTENT_W, h: TITLE_H }, tokens, false);

  if (s.metrics && s.metrics.length > 0) {
    renderMetrics(slide, pptx, s.metrics, { x: MARGIN_L, y: CONTENT_Y, w: CONTENT_W, h: 1.1 }, tokens);
  }

  if (s.body) {
    renderBody(slide, s.body, { x: MARGIN_L, y: CONTENT_Y + 1.3, w: CONTENT_W, h: CONTENT_H - 1.3 }, tokens);
  }
}

function renderTitleBody(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, s: V2SlideRow, tokens: BrandTokens,
): void {
  applyContentChrome(slide, pptx, tokens);
  renderTitle(slide, s.title, { x: MARGIN_L, y: TITLE_Y, w: CONTENT_W, h: TITLE_H }, tokens, false);
  if (s.body) {
    renderBody(slide, s.body, { x: MARGIN_L, y: CONTENT_Y, w: CONTENT_W, h: CONTENT_H }, tokens);
  }
}

function renderTitleBullets(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, s: V2SlideRow, tokens: BrandTokens,
): void {
  applyContentChrome(slide, pptx, tokens);
  renderTitle(slide, s.title, { x: MARGIN_L, y: TITLE_Y, w: CONTENT_W, h: TITLE_H }, tokens, false);
  if (s.bullets && s.bullets.length > 0) {
    renderBullets(slide, s.bullets, { x: MARGIN_L, y: CONTENT_Y, w: CONTENT_W, h: CONTENT_H }, tokens);
  }
}

function renderEvidenceGrid(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>, tokens: BrandTokens,
): void {
  applyContentChrome(slide, pptx, tokens);
  renderTitle(slide, s.title, { x: MARGIN_L, y: TITLE_Y, w: CONTENT_W, h: TITLE_H }, tokens, false);

  // Top: metrics ribbon
  if (s.metrics && s.metrics.length > 0) {
    renderMetrics(slide, pptx, s.metrics, { x: MARGIN_L, y: CONTENT_Y, w: CONTENT_W, h: 1.0 }, tokens);
  }

  const chartY = s.metrics && s.metrics.length > 0 ? CONTENT_Y + 1.15 : CONTENT_Y;
  const chartH = CONTENT_BOTTOM - chartY;
  const chartW = CONTENT_W * 0.56;
  const evidenceW = CONTENT_W * 0.40;
  const gap = CONTENT_W * 0.04;

  // Bottom-left: chart
  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;
  if (chart) {
    renderChartElement(slide, pptx, chart, { x: MARGIN_L, y: chartY, w: chartW, h: chartH }, tokens);
  }

  // Bottom-right: evidence text
  const evidenceX = MARGIN_L + chartW + gap;
  if (s.bullets && s.bullets.length > 0) {
    renderBullets(slide, s.bullets, { x: evidenceX, y: chartY, w: evidenceW, h: chartH }, tokens);
  } else if (s.body) {
    renderBody(slide, s.body, { x: evidenceX, y: chartY, w: evidenceW, h: chartH }, tokens);
  }
}

function renderTableLayout(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>, tokens: BrandTokens,
): void {
  applyContentChrome(slide, pptx, tokens);
  renderTitle(slide, s.title, { x: MARGIN_L, y: TITLE_Y, w: CONTENT_W, h: TITLE_H }, tokens, false);

  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;
  if (chart) {
    renderTable(slide, chart, { x: MARGIN_L, y: CONTENT_Y, w: CONTENT_W, h: CONTENT_H }, tokens);
  }
}

function renderComparison(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>, tokens: BrandTokens,
): void {
  applyContentChrome(slide, pptx, tokens);
  renderTitle(slide, s.title, { x: MARGIN_L, y: TITLE_Y, w: CONTENT_W, h: TITLE_H }, tokens, false);

  const halfW = (CONTENT_W - 0.2) / 2;

  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;
  if (chart) {
    renderChartElement(slide, pptx, chart, { x: MARGIN_L, y: CONTENT_Y, w: halfW, h: CONTENT_H }, tokens);
  }

  if (s.bullets && s.bullets.length > 0) {
    renderBullets(slide, s.bullets, { x: MARGIN_L + halfW + 0.2, y: CONTENT_Y, w: halfW, h: CONTENT_H }, tokens);
  } else if (s.body) {
    renderBody(slide, s.body, { x: MARGIN_L + halfW + 0.2, y: CONTENT_Y, w: halfW, h: CONTENT_H }, tokens);
  }
}

function renderSummary(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, s: V2SlideRow, tokens: BrandTokens,
): void {
  applyContentChrome(slide, pptx, tokens);
  renderTitle(slide, s.title, { x: MARGIN_L, y: TITLE_Y, w: CONTENT_W, h: TITLE_H }, tokens, false);

  if (s.body) {
    renderBody(slide, s.body, { x: MARGIN_L, y: CONTENT_Y, w: CONTENT_W, h: 2.0 }, tokens);
  }

  // Callout box for key recommendation
  if (s.bullets && s.bullets.length > 0) {
    const calloutText = s.bullets.join("\n");
    renderCallout(slide, pptx, calloutText, { x: MARGIN_L + 0.5, y: CONTENT_Y + 2.2, w: CONTENT_W - 1.0, h: 1.2 }, tokens);
  }
}

// ─── SLIDE DISPATCH ─────────────────────────────────────────────

function renderV2Slide(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>,
  tokens: BrandTokens,
  slideNum: number,
  totalSlides: number,
): void {
  const isCover = s.layoutId === "cover";

  switch (s.layoutId) {
    case "cover":
      renderCover(slide, pptx, s, tokens);
      break;
    case "title-chart":
      renderTitleChart(slide, pptx, s, chartsMap, tokens);
      break;
    case "chart-split":
      renderChartSplit(slide, pptx, s, chartsMap, tokens);
      break;
    case "metrics":
    case "exec-summary":
      renderMetricsLayout(slide, pptx, s, tokens);
      break;
    case "title-body":
      renderTitleBody(slide, pptx, s, tokens);
      break;
    case "title-bullets":
      renderTitleBullets(slide, pptx, s, tokens);
      break;
    case "evidence-grid":
      renderEvidenceGrid(slide, pptx, s, chartsMap, tokens);
      break;
    case "table":
      renderTableLayout(slide, pptx, s, chartsMap, tokens);
      break;
    case "comparison":
    case "two-column":
      renderComparison(slide, pptx, s, chartsMap, tokens);
      break;
    case "summary":
      renderSummary(slide, pptx, s, tokens);
      break;
    default:
      // Fallback: if slide has a chart, use title-chart; else title-body
      if (s.chartId && chartsMap.has(s.chartId)) {
        renderTitleChart(slide, pptx, s, chartsMap, tokens);
      } else {
        renderTitleBody(slide, pptx, s, tokens);
      }
      break;
  }

  // Source note + slide number on non-cover slides
  if (!isCover) {
    renderSourceNote(slide, tokens);
    renderSlideNumber(slide, slideNum, totalSlides, tokens);
  }

  // Speaker notes
  if (s.speakerNotes) {
    slide.addNotes(s.speakerNotes);
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

  // Build chart lookup
  const chartsMap = new Map<string, V2ChartRow>();
  for (const chart of input.charts) {
    chartsMap.set(chart.id, chart);
  }

  const sortedSlides = [...input.slides].sort((a, b) => a.position - b.position);
  const totalSlides = sortedSlides.length;

  for (const slideData of sortedSlides) {
    const slide = pptx.addSlide();
    renderV2Slide(slide, pptx, slideData, chartsMap, tokens, slideData.position, totalSlides);
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  return {
    fileName: "basquio-deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  };
}
