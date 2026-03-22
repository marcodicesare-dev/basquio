import PptxGenJS from "pptxgenjs";

import { getLayoutRegions, SLIDE_W, SLIDE_H, type LayoutRegions, type R } from "@basquio/scene-graph/layout-regions";
import { getArchetypeOrDefault } from "@basquio/scene-graph/slot-archetypes";
import { resolveChartArchetype, type ChartRenderingRules } from "@basquio/scene-graph/chart-design-system";
import { renderShapeChart, type ShapeChartTokens } from "./shape-charts";
import { renderV2ChartSvg, type V2ChartImageTheme } from "@basquio/render-charts";
import type { BinaryArtifact } from "@basquio/types";

// ─── HELPERS ────────────────────────────────────────────────────

/** Discrete title size to avoid PptxGenJS fit:"shrink" distortion */
function discreteTitleSize(text: string, baseSize: number): number {
  const len = text.length;
  if (len <= 60) return baseSize;
  if (len <= 80) return baseSize - 2;
  if (len <= 100) return baseSize - 4;
  return baseSize - 6;
}

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
  templateName?: string;
  exportMode?: ExportMode;
};

// ─── CONSULTING-GRADE DESIGN SYSTEM ─────────────────────────────

type BrandTokens = {
  palette: {
    ink: string;
    muted: string;
    dim: string;
    border: string;
    surface: string;
    card: string;
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
    monoFont: string;
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
  "E8A84C",  // amber — brand / primary
  "4CC9A0",  // green — positive / secondary
  "6B8EE8",  // blue — info / tertiary
  "9B7AE0",  // purple — accent
  "E8636F",  // red — danger / competitor
  "5AC4D4",  // cyan — highlight
  "E8B86C",  // warm amber variant
  "7ABBE0",  // light blue variant
];

// ─── "SLATE" HOUSE TEMPLATE (default) ─────────────────────────────
// Premium dark-mode design. Ported from basquio-deck-templates-v2.jsx.
// Deep near-black backgrounds with warm amber accent.
// 8-color chart palette tuned for dark surfaces.

const DEFAULT_TOKENS: BrandTokens = {
  palette: {
    ink: "F2F0EB",        // JSX: text
    muted: "A09FA6",      // JSX: textSec
    dim: "6B6A72",        // JSX: textDim — metadata, labels, source notes
    border: "272630",     // JSX: border
    surface: "13121A",    // JSX: surface — slide content bg
    card: "16151E",       // JSX: card — KPI card, chart container bg
    bg: "0A090D",         // JSX: bg — cover slide deepest black
    accent: "E8A84C",     // JSX: amber
    accentLight: "1A1922", // JSX: surfaceAlt
    positive: "4CC9A0",   // JSX: green
    negative: "E8636F",   // JSX: red
    coverBg: "0A090D",    // JSX: bg
    calloutGreen: "4CC9A0",
    calloutOrange: "E8A84C",
  },
  typography: {
    // Font strategy: Arial ONLY for maximum cross-platform compatibility.
    // Georgia renders differently across PowerPoint, Google Slides, and Keynote.
    // Arial is the ONE font guaranteed pixel-identical everywhere.
    // PptxGenJS cannot embed fonts — so we must use universally-installed fonts.
    headingFont: "Arial",        // Sans — universal, identical on all platforms
    bodyFont: "Arial",           // Sans — universal, identical on all platforms
    monoFont: "Courier New",     // Mono — universal, identical on all platforms
    coverTitleSize: 40,          // JSX: 56px → scaled for PPTX
    titleSize: 22,               // JSX: 24px → action titles
    subtitleSize: 14,            // JSX: 12px body → slightly larger for PPTX readability
    bodySize: 12,                // JSX: 12px → consulting-grade body
    bulletSize: 12,              // Same as body
    chartTitleSize: 12,          // JSX: 14px card title → scaled
    sourceSize: 9,               // JSX: 9pt mono source notes
    kpiValueSize: 30,            // JSX: 30px serif large number
    kpiLabelSize: 9,             // JSX: 9px mono uppercase
  },
  chartPalette: ["E8A84C", "4CC9A0", "6B8EE8", "9B7AE0", "E8636F", "5AC4D4", "E8B86C", "7ABBE0"],
};

// ─── "OBSIDIAN" HOUSE TEMPLATE — Dark Executive ─────────────────
const OBSIDIAN_TOKENS: BrandTokens = {
  palette: {
    ink: "F8FAFC",        // Light text on dark
    muted: "94A3B8",      // Slate 400
    dim: "64748B",        // Slate 700
    border: "334155",     // Slate 700
    surface: "1E293B",    // Slate 800 (card bg on dark)
    card: "1E293B",       // Slate 800
    bg: "0F172A",         // Slate 900 (main bg)
    accent: "F59E0B",     // Amber 500 (warm accent on dark)
    accentLight: "451A03", // Amber 950 (subtle on dark)
    positive: "22C55E",   // Green 500
    negative: "EF4444",   // Red 500
    coverBg: "020617",    // Slate 950
    calloutGreen: "22C55E",
    calloutOrange: "F59E0B",
  },
  typography: {
    headingFont: "Arial",
    bodyFont: "Arial",
    monoFont: "Courier New",
    coverTitleSize: 36,
    titleSize: 24,
    subtitleSize: 14,
    bodySize: 14,
    bulletSize: 14,
    chartTitleSize: 12,
    sourceSize: 8,
    kpiValueSize: 44,
    kpiLabelSize: 10,
  },
  chartPalette: ["F59E0B", "3B82F6", "10B981", "EF4444", "8B5CF6", "EC4899", "06B6D4", "D97706"],
};

// ─── "BOWER" HOUSE TEMPLATE — MBB Consulting Classic ────────────
const BOWER_TOKENS: BrandTokens = {
  palette: {
    ink: "1A1A2E",        // Near-black with warmth
    muted: "6B7280",      // Gray 500
    dim: "9CA3AF",        // Gray 400
    border: "D1D5DB",     // Gray 300
    surface: "F9FAFB",    // Gray 50
    card: "F9FAFB",       // Gray 50
    bg: "FFFFFF",
    accent: "1F2937",     // Gray 800 (McKinsey-style: authority from contrast, not color)
    accentLight: "F3F4F6", // Gray 100
    positive: "059669",   // Emerald 600
    negative: "DC2626",   // Red 600
    coverBg: "1F2937",    // Gray 800
    calloutGreen: "059669",
    calloutOrange: "D97706",
  },
  typography: {
    headingFont: "Arial",    // All-Arial for cross-platform pixel consistency
    bodyFont: "Arial",
    monoFont: "Courier New",
    coverTitleSize: 36,
    titleSize: 24,
    subtitleSize: 14,
    bodySize: 14,
    bulletSize: 14,
    chartTitleSize: 12,
    sourceSize: 8,
    kpiValueSize: 44,
    kpiLabelSize: 10,
  },
  // Chart palette: lead with vibrant blue + teal for Discount/TI comparisons.
  // Dark authority gray moves to position 6 (rarely used in 2-series charts).
  chartPalette: ["2563EB", "F59E0B", "059669", "DC2626", "7C3AED", "1F2937", "0891B2", "6B7280"],
};

// ─── "SIGNAL" HOUSE TEMPLATE — Data-Heavy ───────────────────────
const SIGNAL_TOKENS: BrandTokens = {
  palette: {
    ink: "111827",        // Gray 900
    muted: "6B7280",      // Gray 500
    dim: "9CA3AF",        // Gray 400
    border: "E5E7EB",     // Gray 200
    surface: "F3F4F6",    // Gray 100
    card: "F3F4F6",       // Gray 100
    bg: "FFFFFF",
    accent: "7C3AED",     // Violet 600 (distinctive for data viz)
    accentLight: "EDE9FE", // Violet 100
    positive: "16A34A",   // Green 600
    negative: "DC2626",   // Red 600
    coverBg: "111827",    // Gray 900
    calloutGreen: "16A34A",
    calloutOrange: "EA580C",
  },
  typography: {
    headingFont: "Arial",
    bodyFont: "Arial",
    monoFont: "Courier New",
    coverTitleSize: 36,
    titleSize: 22,         // Slightly smaller — more room for data
    subtitleSize: 12,
    bodySize: 12,          // Smaller body — data-dense slides
    bulletSize: 12,
    chartTitleSize: 11,
    sourceSize: 7,
    kpiValueSize: 40,
    kpiLabelSize: 9,
  },
  chartPalette: ["7C3AED", "2563EB", "059669", "F59E0B", "EC4899", "DC2626", "0891B2", "A78BFA"],
};

// ─── "VERSO" HOUSE TEMPLATE — Bold Modern / VC Pitch ────────────
const VERSO_TOKENS: BrandTokens = {
  palette: {
    ink: "18181B",        // Zinc 900
    muted: "71717A",      // Zinc 500
    dim: "A1A1AA",        // Zinc 400
    border: "E4E4E7",     // Zinc 200
    surface: "FAFAFA",    // Zinc 50
    card: "FAFAFA",       // Zinc 50
    bg: "FFFFFF",
    accent: "E11D48",     // Rose 600 (bold, energetic)
    accentLight: "FFE4E6", // Rose 100
    positive: "16A34A",
    negative: "DC2626",
    coverBg: "18181B",    // Zinc 900
    calloutGreen: "16A34A",
    calloutOrange: "EA580C",
  },
  typography: {
    headingFont: "Arial",
    bodyFont: "Arial",
    monoFont: "Courier New",
    coverTitleSize: 40,    // Bolder, larger cover
    titleSize: 26,         // Bolder titles
    subtitleSize: 14,
    bodySize: 14,
    bulletSize: 14,
    chartTitleSize: 12,
    sourceSize: 8,
    kpiValueSize: 48,      // Even bigger KPI numbers
    kpiLabelSize: 10,
  },
  chartPalette: ["E11D48", "2563EB", "059669", "F59E0B", "7C3AED", "0891B2", "18181B", "FB7185"],
};

// ─── TEMPLATE LOOKUP MAP ────────────────────────────────────────
const TEMPLATE_MAP: Record<string, BrandTokens> = {
  slate: DEFAULT_TOKENS,
  obsidian: OBSIDIAN_TOKENS,
  bower: BOWER_TOKENS,
  signal: SIGNAL_TOKENS,
  verso: VERSO_TOKENS,
};

function resolveTokens(partial?: Partial<BrandTokens>, templateName?: string): BrandTokens {
  // Default to BOWER (light, consulting-grade) not SLATE (dark).
  // Dark themes don't survive PPTX export: Google Slides, Keynote, and many
  // PowerPoint versions strip or ignore custom slide backgrounds, leaving
  // near-white text invisible on the default white canvas.
  const base = (templateName && TEMPLATE_MAP[templateName.toLowerCase()]) || BOWER_TOKENS;
  if (!partial) return base;
  return {
    palette: { ...base.palette, ...(partial.palette as Partial<BrandTokens["palette"]>) },
    typography: { ...base.typography, ...(partial.typography as Partial<BrandTokens["typography"]>) },
    chartPalette: partial.chartPalette ?? base.chartPalette,
  };
}

// ─── GEOMETRY + LAYOUT REGIONS ───────────────────────────────────
// Imported from @basquio/scene-graph/layout-regions (single source of truth)
// Re-exported types used locally: R, LayoutRegions, SLIDE_W, SLIDE_H, getLayoutRegions

// ─── COLOR HELPERS ──────────────────────────────────────────────

function norm(color: string): string {
  return color.replace("#", "").toUpperCase();
}

/** Blend `fg` onto `bg` at `alpha` (0-1). Produces a tinted color that works on any background. */
function tintColor(fg: string, bg: string, alpha: number): string {
  const fgHex = fg.replace("#", "");
  const bgHex = bg.replace("#", "");
  const fr = parseInt(fgHex.slice(0, 2), 16) || 0;
  const fg_ = parseInt(fgHex.slice(2, 4), 16) || 0;
  const fb = parseInt(fgHex.slice(4, 6), 16) || 0;
  const br = parseInt(bgHex.slice(0, 2), 16) || 0;
  const bg_ = parseInt(bgHex.slice(2, 4), 16) || 0;
  const bb = parseInt(bgHex.slice(4, 6), 16) || 0;
  const r = Math.round(fr * alpha + br * (1 - alpha));
  const g = Math.round(fg_ * alpha + bg_ * (1 - alpha));
  const b = Math.round(fb * alpha + bb * (1 - alpha));
  return [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// ─── TEXT HELPERS ────────────────────────────────────────────────

/** Replace literal \\n and \n sequences (from LLM output) with real newlines */
function processNewlines(text: string): string {
  return text
    .replace(/\\\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\*\*([^*]+)\*\*/g, "$1")  // Strip markdown bold **text** → text
    .replace(/\*([^*]+)\*/g, "$1")       // Strip markdown italic *text* → text
    .replace(/`([^`]+)`/g, "$1")         // Strip markdown code `text` → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // Strip markdown links [text](url) → text
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
  region: R,
  tokens: BrandTokens,
  useDirectRegion = false,
): void {
  slide.addText(text.toUpperCase(), {
    x: region.x,
    y: useDirectRegion ? region.y : region.y - 0.25,
    w: region.w,
    h: useDirectRegion ? region.h : 0.2,
    fontSize: 9,
    fontFace: tokens.typography.monoFont,
    color: norm(tokens.palette.accent),
    bold: true,
    margin: 0,
    charSpacing: 1.5,
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

  // Truncate long category labels to prevent overlap in PPTX charts
  const MAX_LABEL_LEN = 25;
  const labels = chart.data.map((row) => {
    const raw = String(row[chart.xAxis] ?? "");
    return raw.length > MAX_LABEL_LEN ? raw.slice(0, MAX_LABEL_LEN - 1) + "\u2026" : raw;
  });
  const basePalette = chart.style.colors?.map(norm) ?? tokens.chartPalette.map(norm);

  // Highlight-bar coloring: if highlightCategories specified, color focal bars with accent,
  // all others with a muted gray (Change 7)
  const highlightCats = chart.style.highlightCategories ?? [];
  const highlightSet = new Set(highlightCats.map((c) => c.toLowerCase()));
  let palette = basePalette;
  if (highlightSet.size > 0 && chart.series.length === 1) {
    palette = labels.map((label) =>
      highlightSet.has(label.toLowerCase()) ? norm(tokens.palette.accent) : norm(tokens.palette.muted),
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
    catAxisLabelColor: norm(tokens.palette.muted),
    catAxisLabelFontSize: 8,
    catAxisLabelFontFace: tokens.typography.bodyFont,
    catAxisLineShow: true,
    catAxisLineColor: norm(tokens.palette.border),
    // Rotate labels when categories have long names (common in Italian FMCG data)
    catAxisLabelRotate: chart.data.length > 4 ? 45 : 0,

    showValAxisTitle: rules.showValueAxis && rules.valueAxisTitle !== "none",
    valAxisTitle: chart.unit ?? "",
    valAxisLabelColor: norm(tokens.palette.muted),
    valAxisLabelFontSize: 8,
    valAxisLabelFontFace: tokens.typography.bodyFont,
    valAxisLineShow: false,
    // Smart number formatting: detect percentage vs currency vs plain numbers
    valAxisLabelFormatCode: detectPercentageData(chart) ? "0.0%" : detectCurrencyData(chart) ? "€#,##0" : "#,##0",
    valGridLine: { color: norm(tokens.palette.border), size: 0.5 },
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
  // Strip markdown bold/italic from titles
  const cleaned = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  const processed = processNewlines(cleaned);
  slide.addText(processed, {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    fontFace: tokens.typography.headingFont,
    fontSize: discreteTitleSize(processed, isCover ? tokens.typography.coverTitleSize : tokens.typography.titleSize),
    bold: true,
    color: norm(tokens.palette.ink), // ink is F2F0EB (near-white) — works on both cover and content slides
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
    color: norm(tokens.palette.muted), // muted is A09FA6 — readable on both dark cover and content bg
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
  // Strip markdown bold/italic markers (** and *)
  const cleaned = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  const processed = processNewlines(cleaned);
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
  speakerNotesOverflow?: string[],
): void {
  const maxBullets = maxBulletsOverride ?? 4;
  const MAX_BULLET_WORDS = 20;
  // Capture dropped bullets to speaker notes
  if (bullets.length > maxBullets && speakerNotesOverflow) {
    speakerNotesOverflow.push(`[Overflow bullets]: ${bullets.slice(maxBullets).join(" | ")}`);
  }
  const textProps: PptxGenJS.TextProps[] = bullets.slice(0, maxBullets).map((b) => {
    const cleaned = b.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
    const words = cleaned.split(/\s+/);
    let truncated = cleaned;
    if (words.length > MAX_BULLET_WORDS) {
      truncated = words.slice(0, MAX_BULLET_WORDS).join(" ") + "\u2026";
      if (speakerNotesOverflow) {
        speakerNotesOverflow.push(`[Truncated bullet]: ${cleaned}`);
      }
    }
    return {
      text: processNewlines(truncated),
      options: {
        bullet: { indent: 12 },
        fontSize: tokens.typography.bulletSize,
        fontFace: tokens.typography.bodyFont,
        color: norm(tokens.palette.ink),
        breakLine: true,
        paraSpaceBefore: 2,
        paraSpaceAfter: 4,
      },
    };
  });

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
  const count = Math.min(metrics.length, 6); // JSX: max 6 KPIs
  const gap = 0.12;
  const cardW = (region.w - gap * (count - 1)) / count;
  const cardH = Math.min(region.h, 1.2);

  metrics.slice(0, 6).forEach((m, i) => {
    const cardX = region.x + i * (cardW + gap);

    // Card background: card fill, thin border (JSX: Card component)
    slide.addText("", {
      x: cardX,
      y: region.y,
      w: cardW,
      h: cardH,
      fill: { color: norm(tokens.palette.card ?? tokens.palette.surface) },
      line: { color: norm(tokens.palette.border), pt: 0.5 },
    });

    // TOP semantic bar: 2.5px, green/red (JSX: position absolute top, height 2.5)
    const isPositive = m.delta ? (m.delta.startsWith("+") || m.delta.includes("↑")) : true;
    slide.addText("", {
      x: cardX,
      y: region.y,
      w: cardW,
      h: 0.035,  // ~2.5px at 72dpi
      fill: { color: norm(isPositive ? tokens.palette.positive : tokens.palette.negative), transparency: 40 },
    });

    // Label: monospace, ALL CAPS, dim color, 1.5 letter-spacing (JSX: T.mono 9px textDim)
    slide.addText(m.label.toUpperCase(), {
      x: cardX + 0.15,
      y: region.y + 0.08,
      w: cardW - 0.25,
      h: 0.18,
      fontSize: tokens.typography.kpiLabelSize,
      fontFace: tokens.typography.monoFont,
      color: norm(tokens.palette.dim ?? tokens.palette.muted),
      bold: false,
      charSpacing: 1.5,
    });

    // Value: serif, large, bold (JSX: T.serif 30px text, letterSpacing -1)
    const valueSize = count <= 3 ? tokens.typography.kpiValueSize : count <= 4 ? 26 : 22;
    slide.addText(m.value, {
      x: cardX + 0.15,
      y: region.y + 0.28,
      w: cardW - 0.25,
      h: 0.45,
      fontSize: valueSize,
      fontFace: tokens.typography.headingFont,
      bold: true,
      color: norm(tokens.palette.ink),
      valign: "middle",
    });

    // Delta + sub on same row (JSX: delta then sub with marginLeft 8)
    if (m.delta) {
      const deltaColor = isPositive ? norm(tokens.palette.positive) : norm(tokens.palette.negative);
      slide.addText(m.delta, {
        x: cardX + 0.15,
        y: region.y + 0.78,
        w: cardW * 0.45,
        h: 0.20,
        fontSize: 11,
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
        { type: "solid" as const, pt: 0.5, color: norm(tokens.palette.border) },
        { type: "none" as const },
        { type: "solid" as const, pt: 0.5, color: norm(tokens.palette.border) },
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
    const zebraFill = rowIdx % 2 === 0 ? norm(tokens.palette.surface) : norm(tokens.palette.bg);
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
            { type: "solid" as const, pt: 0.5, color: norm(tokens.palette.border) },
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
  speakerNotesOverflow?: string[],
): void {
  const accentMap: Record<string, string> = {
    green: tokens.palette.calloutGreen,
    orange: tokens.palette.calloutOrange,
    accent: tokens.palette.accent,
  };
  // Derive callout background from the accent color at ~10% opacity on the surface color.
  // Works on both dark (Slate/Obsidian) and light (Bower/Signal/Verso) templates.
  const accentColor = accentMap[variant] || tokens.palette.accent;
  const bgColor = tintColor(accentColor, tokens.palette.surface ?? tokens.palette.bg, 0.12);
  const calloutH = Math.min(region.h, 0.45); // Respect region height — never overflow

  // Tinted background (no border, sharp corners)
  slide.addText("", {
    x: region.x,
    y: region.y,
    w: region.w,
    h: calloutH,
    fill: { color: norm(bgColor) },
  });

  // Left accent bar (3-4px, full height)
  slide.addText("", {
    x: region.x,
    y: region.y,
    w: 0.04,
    h: calloutH,
    fill: { color: norm(accentColor) },
  });

  // Text: bold, ink color, strip markdown markers, cap at 25 words
  const MAX_CALLOUT_WORDS = 25;
  let cleanText = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  const calloutWords = cleanText.split(/\s+/);
  if (calloutWords.length > MAX_CALLOUT_WORDS) {
    if (speakerNotesOverflow) {
      speakerNotesOverflow.push(`[Truncated callout]: ${cleanText}`);
    }
    cleanText = calloutWords.slice(0, MAX_CALLOUT_WORDS).join(" ") + "\u2026";
  }
  slide.addText(processNewlines(cleanText), {
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

/**
 * Decide whether a chart should render as native PptxGenJS or shape-built.
 * Native = editable in PowerPoint but may break in Keynote/Google Slides.
 * Shape-built = universal but not editable.
 */
function selectChartRenderStrategy(
  chartType: string,
  exportMode: ExportMode,
): "native" | "shape-built" {
  // Shape-built always for these (no good native support anywhere)
  const alwaysShapeBuilt = new Set(["waterfall", "funnel", "marimekko", "treemap"]);
  if (alwaysShapeBuilt.has(chartType)) return "shape-built";

  // In universal mode, use shape-built for types that break in Keynote
  if (exportMode === "universal-compatible") {
    // Bar, line, pie are reasonably safe in Google Slides after multiLvlStrRef fix
    // But Keynote has issues with most native chart types
    return "shape-built";
  }

  // PowerPoint-native mode: use native for standard types
  const nativeSafe = new Set(["bar", "grouped_bar", "stacked_bar_100", "horizontal_bar", "line", "pie", "doughnut", "scatter", "area", "stacked_bar"]);
  if (nativeSafe.has(chartType)) return "native";

  // Default to shape-built for unknown types
  return "shape-built";
}

function renderChartElement(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  chart: V2ChartRow,
  region: R,
  tokens: BrandTokens,
  exportMode: ExportMode = "powerpoint-native",
  slideTitle?: string,
  chartImageMap?: Map<string, Buffer>,
): void {
  if (chart.chartType === "table") {
    renderTable(slide, chart, region, tokens);
    return;
  }

  // ── IMAGE MODE: pixel-perfect chart as embedded PNG ──
  // If we have a pre-rendered image for this chart, use it.
  // This gives pixel-perfect rendering across PowerPoint, Google Slides, and Keynote.
  const chartImage = chartImageMap?.get(chart.id);
  if (chartImage) {
    slide.addImage({
      data: `image/png;base64,${chartImage.toString("base64")}`,
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      rounding: false,
    });

    // Source note below chart (still editable text)
    if (chart.sourceNote) {
      slide.addText(`Source: ${chart.sourceNote}`, {
        x: region.x,
        y: region.y + region.h - 0.15,
        w: region.w,
        h: 0.15,
        fontSize: tokens.typography.sourceSize,
        fontFace: tokens.typography.monoFont,
        color: norm(tokens.palette.dim),
      });
    }
    return;
  }

  // ── FALLBACK: shape-built or native chart (when image rendering failed) ──

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

  const strategy = selectChartRenderStrategy(effectiveChartType, exportMode);

  // Suppress chart title when it duplicates the slide title (common LLM failure mode)
  const chartTitleNorm = (chart.title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const slideTitleNorm = (slideTitle ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const chartTitleIsDuplicate = chartTitleNorm.length > 0 && slideTitleNorm.length > 0 &&
    (chartTitleNorm === slideTitleNorm || slideTitleNorm.includes(chartTitleNorm) || chartTitleNorm.includes(slideTitleNorm));
  const showChartTitle = !chartTitleIsDuplicate && Boolean(chart.title);

  // For native: render chart title externally (above the chart object)
  // For shape-built: shape-chart renders its own title, so skip external title
  if (strategy === "native" && showChartTitle) {
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
  }

  // Reclaim title space when chart title is suppressed (duplicate of slide title)
  const titleOffset = (strategy === "native" && showChartTitle) ? 0.25 : 0;
  const titleReduction = (strategy === "native" && showChartTitle) ? 0.3 : 0;
  const chartRegion = {
    x: region.x,
    y: strategy === "shape-built" ? region.y : region.y + titleOffset,
    w: region.w,
    h: strategy === "shape-built" ? region.h : region.h - titleReduction,
  };

  // Reserve space for source note if present
  const hasSource = Boolean(chart.sourceNote);
  const actualChartH = hasSource ? chartRegion.h - 0.2 : chartRegion.h;

  if (strategy === "shape-built") {
    // Shape-built charts for cross-app compatibility (Google Slides, Keynote)
    const shapeTokens: ShapeChartTokens = {
      accent: norm(tokens.palette.accent),
      ink: norm(tokens.palette.ink),
      muted: norm(tokens.palette.muted),
      surface: norm(tokens.palette.surface ?? "13121A"),
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
      title: showChartTitle ? chart.title : undefined,
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

  // Source note below chart — clamped to never overlap footer (max y = 6.6")
  if (chart.sourceNote) {
    const sourceY = Math.min(chartRegion.y + actualChartH + 0.02, 6.6);
    slide.addText(`Source: ${chart.sourceNote}`, {
      x: chartRegion.x,
      y: sourceY,
      w: chartRegion.w,
      h: 0.16,
      fontSize: tokens.typography.sourceSize,
      fontFace: tokens.typography.monoFont,
      color: norm(tokens.palette.muted),
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
  // Subtle amber glow simulation — large centered translucent amber rectangle
  slide.addText("", {
    x: SLIDE_W / 2 - 3.5,
    y: SLIDE_H / 2 - 2.5,
    w: 7,
    h: 5,
    fill: { color: norm(tokens.palette.accent), transparency: 92 },
  });

  // Cover slides NEVER have a kicker — removed entirely.
  // The orchestration clears it (finalKicker = "" for cover) but the LLM
  // sometimes generates one anyway. Defense in depth: don't render it.

  // Title: serif, centered, large (JSX: Playfair Display 56px)
  // Cover uses WHITE text because cover background is always dark (coverBg).
  // This works whether the background renders (dark bg + white text) or not
  // (white bg + fallback). Content slides use ink (dark text on light bg).
  const coverTextColor = "FFFFFF";
  const titleY = SLIDE_H / 2 - 1.2;
  slide.addText(processNewlines(s.title), {
    x: 1.5,
    y: titleY,
    w: SLIDE_W - 3.0,
    h: 1.6,
    fontFace: tokens.typography.headingFont,
    fontSize: discreteTitleSize(s.title, tokens.typography.coverTitleSize),
    bold: true,
    color: coverTextColor,
    align: "center",
    valign: "middle",
    lineSpacingMultiple: 1.08,
  });

  // Subtitle: sans, centered, muted (JSX: DM Sans 16px textSec)
  if (s.subtitle) {
    slide.addText(processNewlines(s.subtitle), {
      x: 2.0,
      y: titleY + 1.7,
      w: SLIDE_W - 4.0,
      h: 0.8,
      fontFace: tokens.typography.bodyFont,
      fontSize: 14,
      color: "D1D5DB", // Light gray on dark cover bg
      align: "center",
      valign: "top",
      lineSpacingMultiple: 1.5,
    });
  }

  // Subtle bottom border — thin, muted, not an accent bar (accent bars are AI hallmarks)
  slide.addText("", {
    x: 0,
    y: SLIDE_H - 0.007,
    w: SLIDE_W,
    h: 0.007,
    fill: { color: norm(tokens.palette.border) },
  });
}

function renderContentSlide(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  s: V2SlideRow,
  chartsMap: Map<string, V2ChartRow>,
  tokens: BrandTokens,
  exportMode: ExportMode = "powerpoint-native",
  chartImageMap?: Map<string, Buffer>,
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

  // Kicker (section label above title) — use kicker region if available
  if (s.kicker) {
    if (regions.kicker) {
      renderKicker(slide, s.kicker, regions.kicker, tokens, true);
    } else {
      renderKicker(slide, s.kicker, regions.title, tokens, false);
    }
  }

  // Title always rendered (except section-divider which handles its own)
  if (layoutId !== "section-divider") {
    renderTitle(slide, s.title, regions.title, tokens, false);

    // Subtitle (if present and region exists)
    if (s.subtitle && regions.subtitle) {
      renderSubtitle(slide, s.subtitle, regions.subtitle, tokens, false);
    }
  }

  const chart = s.chartId ? chartsMap.get(s.chartId) : undefined;

  switch (layoutId) {
    case "section-divider": {
      // Dark background fill
      slide.background = { fill: norm(tokens.palette.accent ?? "1E293B") };
      // Title: white, centered vertically
      slide.addText(processNewlines(s.title), {
        x: regions.title.x,
        y: regions.title.y,
        w: regions.title.w,
        h: regions.title.h,
        fontFace: tokens.typography.headingFont,
        fontSize: 32,
        bold: true,
        color: "FFFFFF",
        valign: "middle",
        margin: 0,
        lineSpacingMultiple: 1.1,
      });
      // Subtitle: light gray below title
      if (s.subtitle && regions.subtitle) {
        slide.addText(processNewlines(s.subtitle), {
          x: regions.subtitle.x,
          y: regions.subtitle.y,
          w: regions.subtitle.w,
          h: regions.subtitle.h,
          fontFace: tokens.typography.bodyFont,
          fontSize: 16,
          color: norm(tokens.palette.dim),
          valign: "top",
          margin: 0,
        });
      }
      break;
    }

    case "title-chart": {
      if (chart && regions.chart) {
        renderChartElement(slide, pptx, chart, regions.chart, tokens, exportMode, s.title, chartImageMap);
      }
      // First-class callout
      if (s.callout && regions.callout) {
        renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "accent", notesOverflow);
      }
      break;
    }

    case "chart-split":
    case "two-column": {
      // Chart on left
      if (chart && regions.chart) {
        renderChartElement(slide, pptx, chart, regions.chart, tokens, exportMode, s.title, chartImageMap);
      }
      // Right column: body/bullets text OR data table (never both — that causes overlap)
      const hasTextContent = (s.body && s.body.length > 0) || (s.bullets && s.bullets.length > 0);
      if (hasTextContent) {
        if (s.bullets && s.bullets.length > 0) {
          const bulletRegion = regions.bullets || regions.body;
          if (bulletRegion) renderBullets(slide, s.bullets, bulletRegion, tokens, maxBulletsFromArch, notesOverflow);
        } else if (s.body && regions.body) {
          renderBody(slide, s.body, regions.body, tokens, notesOverflow, bodyMaxWords);
        }
      } else if (chart && regions.table) {
        // Only show data table when there's no text content
        renderTable(slide, chart, regions.table, tokens, tableMaxRows, tableMaxCols);
      }
      // First-class callout (if provided), else derive from body/bullet
      if (regions.callout) {
        if (s.callout) {
          renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "accent", notesOverflow);
        } else if (s.body || (s.bullets && s.bullets.length > 0)) {
          const calloutText = s.body || s.bullets?.[0] || "";
          if (calloutText) {
            renderCallout(slide, pptx, calloutText, regions.callout, tokens, "accent", notesOverflow);
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
        renderChartElement(slide, pptx, chart, regions.chart, tokens, exportMode, s.title, chartImageMap);
      }
      // Body/bullets on right
      if (regions.body) {
        if (s.bullets && s.bullets.length > 0) {
          renderBullets(slide, s.bullets, regions.body, tokens, maxBulletsFromArch, notesOverflow);
        } else if (s.body) {
          renderBody(slide, s.body, regions.body, tokens, notesOverflow, bodyMaxWords);
        }
      }
      // First-class callout at bottom, else fallback
      if (regions.callout) {
        if (s.callout) {
          renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "green", notesOverflow);
        } else if (s.body && s.bullets && s.bullets.length > 0) {
          renderCallout(slide, pptx, s.body, regions.callout, tokens, "green", notesOverflow);
        }
      }
      break;
    }

    case "metrics":
    case "exec-summary": {
      if (s.metrics && s.metrics.length > 0 && regions.metrics) {
        renderMetrics(slide, pptx, s.metrics, regions.metrics, tokens);
      }
      // Chart support for exec-summary (JSX: metrics on top, chart below)
      if (chart && regions.chart) {
        renderChartElement(slide, pptx, chart, regions.chart, tokens, exportMode, s.title, chartImageMap);
      } else if (layoutId === "exec-summary" && s.bullets && s.bullets.length > 0 && regions.bullets) {
        // Fallback to bullets if no chart
        renderBullets(slide, s.bullets, regions.bullets, tokens, maxBulletsFromArch, notesOverflow);
      } else if (s.body && regions.body) {
        renderBody(slide, s.body, regions.body, tokens, notesOverflow, bodyMaxWords);
      } else if (s.bullets && s.bullets.length > 0) {
        const fallbackRegion = regions.bullets || regions.body;
        if (fallbackRegion) {
          renderBullets(slide, s.bullets, fallbackRegion, tokens, maxBulletsFromArch, notesOverflow);
        }
      }
      // First-class callout
      if (s.callout && regions.callout) {
        renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "accent", notesOverflow);
      }
      break;
    }

    case "title-body":
    case "title-bullets": {
      if (s.bullets && s.bullets.length > 0 && regions.body) {
        renderBullets(slide, s.bullets, regions.body, tokens, maxBulletsFromArch, notesOverflow);
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
        renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "accent", notesOverflow);
      }
      break;
    }

    case "table": {
      if (chart && regions.table) {
        renderTable(slide, chart, regions.table, tokens, tableMaxRows, tableMaxCols);
      } else if (!s.body && !s.bullets && s.callout && regions.callout) {
        // Empty table slide — render only callout (skip empty content area)
        break;
      } else if (s.body && regions.table) {
        // Parse pipe-delimited body into a real table if it contains | separators
        const bodyText = processNewlines(s.body);
        if (bodyText.includes("|")) {
          const lines = bodyText.split(/\n/).filter((l) => l.trim().length > 0 && l.includes("|"));
          if (lines.length > 0) {
            const rows = lines.map((line) =>
              line.split("|").map((cell) => cell.trim()).filter((c) => c.length > 0),
            );
            // First row is header
            const headerRow = rows[0].map((cell) => ({
              text: cell,
              options: {
                bold: true,
                fontSize: 10,
                fontFace: tokens.typography.bodyFont,
                color: "FFFFFF",
                fill: { color: norm(tokens.palette.accent) },
              },
            }));
            const dataRows = rows.slice(1).map((row, rowIdx) =>
              row.map((cell) => ({
                text: cell,
                options: {
                  fontSize: 10,
                  fontFace: tokens.typography.bodyFont,
                  color: norm(tokens.palette.ink),
                  fill: rowIdx % 2 === 0
                    ? { color: norm(tokens.palette.surface) }
                    : { color: norm(tokens.palette.bg) },
                },
              })),
            );
            slide.addTable([headerRow, ...dataRows], {
              x: regions.table.x,
              y: regions.table.y,
              w: regions.table.w,
              rowH: 0.35,
              border: { type: "solid", color: norm(tokens.palette.border), pt: 0.5 },
              autoPage: false,
            });
          }
        } else {
          renderBody(slide, s.body, regions.table, tokens, notesOverflow, bodyMaxWords);
        }
      }
      break;
    }

    case "comparison": {
      // Metrics at top (if present, shift chart down)
      let chartYOffset = 0;
      if (s.metrics && s.metrics.length > 0) {
        const metricsRegion = { x: regions.chart?.x ?? 0.6, y: 1.5, w: (regions.chart?.w ?? 5.8) + (regions.chart2?.w ?? 5.8) + 0.5, h: 1.2 };
        renderMetrics(slide, pptx, s.metrics, metricsRegion, tokens);
        chartYOffset = 1.4; // Push chart below metrics
      }
      if (chart && regions.chart) {
        const adjustedChart = chartYOffset > 0
          ? { ...regions.chart, y: regions.chart.y + chartYOffset, h: regions.chart.h - chartYOffset }
          : regions.chart;
        renderChartElement(slide, pptx, chart, adjustedChart, tokens, exportMode, s.title, chartImageMap);
      }
      // Second chart area: use bullets or body
      if (regions.chart2) {
        const adjusted2 = chartYOffset > 0
          ? { ...regions.chart2, y: regions.chart2.y + chartYOffset, h: regions.chart2.h - chartYOffset }
          : regions.chart2;
        if (s.bullets && s.bullets.length > 0) {
          renderBullets(slide, s.bullets, adjusted2, tokens, maxBulletsFromArch, notesOverflow);
        } else if (s.body) {
          renderBody(slide, s.body, adjusted2, tokens, notesOverflow, bodyMaxWords);
        }
      }
      // Callout
      if (s.callout && regions.callout) {
        renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "accent", notesOverflow);
      }
      break;
    }

    case "summary": {
      // Chart on left if available (recommendation slides — chart-split style)
      if (chart && regions.chart) {
        renderChartElement(slide, pptx, chart, regions.chart, tokens, exportMode, s.title, chartImageMap);
      }
      // Metrics if available
      if (s.metrics && s.metrics.length > 0 && regions.metrics) {
        renderMetrics(slide, pptx, s.metrics, regions.metrics, tokens);
      }
      // Body on right (or full width if no chart)
      if (s.body && regions.body) {
        const bodyRegion = (!chart || !regions.chart)
          ? { ...regions.body, x: regions.body.x - (regions.body.x - (regions.callout?.x ?? 0.6)), w: regions.callout?.w ?? regions.body.w + 4 }
          : regions.body;
        renderBody(slide, s.body, bodyRegion, tokens, notesOverflow, bodyMaxWords);
      }
      // Bullets below body on right (or full width if no chart)
      if (s.bullets && s.bullets.length > 0 && regions.bullets) {
        const bulletRegion = (!chart || !regions.chart)
          ? { ...regions.bullets, x: regions.body?.x ?? 0.6, w: regions.callout?.w ?? regions.bullets.w + 4 }
          : regions.bullets;
        renderBullets(slide, s.bullets, bulletRegion, tokens, maxBulletsFromArch, notesOverflow);
      }
      // Callout
      if (regions.callout) {
        if (s.callout) {
          renderCallout(slide, pptx, s.callout.text, regions.callout, tokens, s.callout.tone ?? "green", notesOverflow);
        } else {
          const calloutText = s.bullets && s.bullets.length > 0 ? s.bullets.join(" | ") : s.body || "";
          if (calloutText && (!s.body || (s.bullets && s.bullets.length > 0))) {
            renderCallout(slide, pptx, calloutText, regions.callout, tokens, "green", notesOverflow);
          }
        }
      }
      break;
    }

    default: {
      // Fallback: chart if available, else body/bullets
      if (chart) {
        const chartRegion = regions.chart || regions.body || { x: 0.55, y: 0.85, w: 8.9, h: 3.8 };
        renderChartElement(slide, pptx, chart, chartRegion, tokens, exportMode, s.title, chartImageMap);
      } else if (s.body && regions.body) {
        renderBody(slide, s.body, regions.body, tokens, notesOverflow, bodyMaxWords);
      } else if (s.bullets && s.bullets.length > 0) {
        const bulletRegion =
          regions.bullets || regions.body || { x: 0.55, y: 0.85, w: 8.9, h: 3.8 };
        renderBullets(slide, s.bullets, bulletRegion, tokens, maxBulletsFromArch, notesOverflow);
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
  const tokens = resolveTokens(input.brandTokens, input.templateName);

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
    background: { fill: norm(tokens.palette.surface) },
    objects: [
      // Footer hairline rule — 0.5pt gray line at y=7.1"
      { rect: { x: 0.6, y: 7.1, w: 12.133, h: 0.007, fill: { color: norm(tokens.palette.border) } } },
      // Footer left: source note
      {
        text: {
          text: "Basquio | Confidential",
          options: {
            x: 0.6,
            y: 7.15,
            w: 6,
            h: 0.25,
            fontSize: 8,
            fontFace: tokens.typography.monoFont,
            color: norm(tokens.palette.muted),
          },
        },
      },
    ],
    slideNumber: {
      x: 12.0,
      y: 7.15,
      w: 0.733,
      h: 0.25,
      fontSize: 8,
      fontFace: tokens.typography.monoFont,
      color: "94A3B8",
      align: "right",
    },
  });

  // Build chart lookup
  const chartsMap = new Map<string, V2ChartRow>();
  for (const chart of input.charts) {
    chartsMap.set(chart.id, chart);
  }

  // ── Pre-render all charts to PNG images (pixel-perfect, universal compatibility) ──
  // Charts are rendered as high-res images via ECharts SSR + sharp.
  // Text remains editable OOXML. Charts are pixel-perfect images.
  const chartImageMap = new Map<string, Buffer>();
  const chartTheme: V2ChartImageTheme = {
    background: tokens.palette.surface,
    cardBg: tokens.palette.card,
    ink: tokens.palette.ink,
    muted: tokens.palette.muted,
    dim: tokens.palette.dim,
    border: tokens.palette.border,
    chartPalette: tokens.chartPalette,
    headingFont: tokens.typography.headingFont,
    bodyFont: tokens.typography.bodyFont,
  };

  // Find which charts duplicate their slide's title (for suppression)
  const chartSlideMap = new Map<string, string>(); // chartId → slideTitle
  for (const s of input.slides) {
    if (s.chartId) chartSlideMap.set(s.chartId, s.title);
  }

  // Initialize resvg WASM once — this is the WASM build that works everywhere
  // (Vercel serverless, Edge, local). No native binaries, no node-gyp, no webpack issues.
  // Same engine @vercel/og uses internally for OG image generation.
  // Load resvg WASM for SVG→PNG rasterization.
  // Uses @resvg/resvg-wasm (pure WASM, no native binaries).
  // webpack asyncWebAssembly experiment is enabled in next.config.ts.
  // serverExternalPackages includes @resvg/resvg-wasm to prevent bundling through transpilePackages.
  let ResvgClass: (new (svg: string, opts: Record<string, unknown>) => { render: () => { asPng: () => Uint8Array } }) | null = null;
  try {
    const resvgWasm = await import(/* webpackIgnore: true */ "@resvg/resvg-wasm");
    try {
      const wasmPath = require.resolve(/* webpackIgnore: true */ "@resvg/resvg-wasm/index_bg.wasm");
      const { readFileSync } = await import(/* webpackIgnore: true */ "fs");
      await resvgWasm.initWasm(readFileSync(wasmPath));
    } catch {
      // Already initialized — ignore
    }
    ResvgClass = resvgWasm.Resvg;
  } catch (wasmErr) {
    console.warn("[render-v2] Failed to load @resvg/resvg-wasm:", wasmErr);
  }

  for (const chart of input.charts) {
    if (chart.chartType === "table") continue; // Tables stay as OOXML
    if (!ResvgClass) break; // WASM not available — all charts will be native shapes
    try {
      const slideTitle = chartSlideMap.get(chart.id);
      const titleNorm = (chart.title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const slideTitleNorm = (slideTitle ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const suppressTitle = titleNorm.length > 0 && slideTitleNorm.length > 0 &&
        (titleNorm === slideTitleNorm || slideTitleNorm.includes(titleNorm) || titleNorm.includes(slideTitleNorm));

      // Render at 2x resolution for retina-quality images
      const svg = renderV2ChartSvg(chart, chartTheme, 1920, 1080, suppressTitle);
      const resvg = new ResvgClass(svg, {
        fitTo: { mode: "width" as const, value: 1920 },
      });
      const pngData = resvg.render();
      const pngBuffer = Buffer.from(pngData.asPng());
      chartImageMap.set(chart.id, pngBuffer);
    } catch (err) {
      console.warn(`[render-v2] Chart image render failed for ${chart.id}, falling back to shape:`, err);
    }
  }

  const sortedSlides = [...input.slides].sort((a, b) => a.position - b.position);

  for (const slideData of sortedSlides) {
    const isCover = slideData.layoutId === "cover";
    const slide = pptx.addSlide({ masterName: isCover ? "BASQUIO_COVER" : "BASQUIO_MASTER" });
    // Explicit per-slide background — Google Slides often ignores slide master backgrounds
    slide.background = { fill: norm(isCover ? tokens.palette.coverBg : tokens.palette.surface) };

    if (isCover) {
      renderCoverSlide(slide, pptx, slideData, tokens);
    } else {
      renderContentSlide(slide, pptx, slideData, chartsMap, tokens, input.exportMode ?? "universal-compatible", chartImageMap);
    }

    // Speaker notes for cover
    if (isCover && slideData.speakerNotes) {
      slide.addNotes(processNewlines(slideData.speakerNotes));
    }
  }

  const rawBuffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  // Post-process for ALL export modes.
  // The multiLvlStrRef→strRef fix is safe for PowerPoint (flat string refs are valid OOXML)
  // and required for Google Slides / Keynote compatibility.
  const postProcessed = await fixPptxChartCompatibility(rawBuffer);

  // Validate OOXML structure — warn but don't block export
  const validation = await validateOoxmlStructure(postProcessed);
  if (!validation.valid) {
    console.warn(`[render-v2] OOXML validation errors: ${validation.errors.join("; ")}`);
  }
  if (validation.warnings.length > 0) {
    console.warn(`[render-v2] OOXML compatibility warnings: ${validation.warnings.join("; ")}`);
  }
  const buffer = postProcessed;

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

    // Fix hardcoded Calibri everywhere — theme XML, chart Excel, slide layouts, embeddings
    // Keynote reads font declarations from theme1.xml and shows warnings for missing Calibri
    // Font fallback strategy: Replace ALL Calibri/Aptos with universally safe fonts.
    // PptxGenJS does NOT support font embedding. The OOXML file specifies font names,
    // and the host app (PowerPoint, Slides, Keynote) resolves them from system fonts.
    // Safe chain: Georgia (heading) → Arial (body) → Courier New (mono)
    // These are installed on Windows, macOS, and available in Google Slides.
    const FONT_REPLACEMENTS: Array<[RegExp, string]> = [
      [/typeface="Calibri"/g, 'typeface="Arial"'],
      [/typeface="Calibri Light"/g, 'typeface="Arial"'],
      [/typeface="Aptos"/g, 'typeface="Arial"'],
      [/typeface="Aptos Display"/g, 'typeface="Arial"'],
      [/typeface="Aptos Narrow"/g, 'typeface="Arial Narrow"'],
    ];

    // Apply font replacements across ALL XML entries (theme, charts, layouts, notes, handouts)
    const fontFixEntries = Object.keys(zip.files).filter(
      (f) => /^ppt\/charts\/_rels\/|^ppt\/embeddings\/.*\.xml$|^ppt\/theme\/.*\.xml$|^ppt\/slideLayouts\/.*\.xml$|^ppt\/slideMasters\/.*\.xml$|^ppt\/notesMaster.*\.xml$|^ppt\/notesSlides\/.*\.xml$|^ppt\/handoutMasters\/.*\.xml$|^docProps\/.*\.xml$/i.test(f),
    );
    for (const entry of fontFixEntries) {
      if (!zip.files[entry] || zip.files[entry].dir) continue;
      try {
        let xml = await zip.files[entry].async("text");
        const original = xml;
        for (const [pattern, replacement] of FONT_REPLACEMENTS) {
          xml = xml.replace(pattern, replacement);
        }
        if (xml !== original) {
          zip.file(entry, xml);
          modified = true;
        }
      } catch { /* skip binary entries */ }
    }

    // Also fix fonts in ALL slide XML files (PptxGenJS sometimes hardcodes Calibri in text runs)
    const slideEntries = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f));
    for (const entry of slideEntries) {
      try {
        let xml = await zip.files[entry].async("text");
        const original = xml;
        for (const [pattern, replacement] of FONT_REPLACEMENTS) {
          xml = xml.replace(pattern, replacement);
        }
        if (xml !== original) {
          zip.file(entry, xml);
          modified = true;
        }
      } catch { /* skip */ }
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

// ─── OOXML STRUCTURE VALIDATION ──────────────────────────────────
// Lightweight check that the PPTX ZIP contains required OOXML files
// and that all referenced slides exist. Warns but never blocks export.

async function validateOoxmlStructure(buffer: Buffer): Promise<{ valid: boolean; warnings: string[]; errors: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);

    // Check required OOXML files exist
    const required = ["[Content_Types].xml", "ppt/presentation.xml", "_rels/.rels"];
    for (const path of required) {
      if (!zip.file(path)) {
        errors.push(`Missing required OOXML file: ${path}`);
      }
    }

    // Check that slide files referenced in content types exist
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    if (contentTypes) {
      const slideRefs = contentTypes.match(/PartName="\/ppt\/slides\/slide\d+\.xml"/g) ?? [];
      for (const ref of slideRefs) {
        const slidePath = ref.match(/PartName="\/(.+?)"/)?.[1];
        if (slidePath && !zip.file(slidePath)) {
          errors.push(`Referenced slide missing from ZIP: ${slidePath}`);
        }
      }

      // Check slide count makes sense
      if (slideRefs.length === 0) {
        errors.push("No slides found in [Content_Types].xml");
      }
    }

    // Check for theme file (Keynote reads fonts from here)
    const themeFile = zip.file("ppt/theme/theme1.xml");
    if (!themeFile) {
      warnings.push("Missing ppt/theme/theme1.xml — Keynote may show font warnings");
    }

    // Check for broken XML in ALL slides (common PptxGenJS issue)
    const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f));
    for (const slideFile of slideFiles) {
      try {
        const xml = await zip.files[slideFile].async("text");
        // Check for unclosed tags (basic well-formedness)
        if (xml.includes("<<") || xml.includes(">>")) {
          errors.push(`Malformed XML in ${slideFile}: double angle brackets`);
        }
        // Check for Calibri residue (should have been cleaned by fixPptxChartCompatibility)
        if (xml.includes('typeface="Calibri"')) {
          warnings.push(`${slideFile} still contains Calibri font reference — may cause Keynote warnings`);
        }
      } catch { /* skip if can't read */ }
    }

    // Check for slide relationships (Google Slides needs these)
    for (const slideFile of slideFiles) {
      const relPath = slideFile.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
      if (!zip.file(relPath)) {
        warnings.push(`Missing relationship file: ${relPath} — Google Slides may fail to import`);
      }
    }

    // ─── CHART XML INTEGRITY ──────────────────────────────────────
    const chartFiles = Object.keys(zip.files).filter(f => /^ppt\/charts\/chart\d+\.xml$/i.test(f));
    for (const chartFile of chartFiles) {
      try {
        const xml = await zip.files[chartFile].async("text");
        // Check for data series presence (chart must have at least one series)
        if (!xml.includes("<c:ser>") && !xml.includes("<c:val>")) {
          warnings.push(`${chartFile}: no data series — chart may render empty in all apps`);
        }
        // Check for category references (labels)
        if (!xml.includes("<c:cat>") && !xml.includes("<c:strRef>") && !xml.includes("<c:numRef>")) {
          warnings.push(`${chartFile}: no category/label references — axis labels may be missing`);
        }
        // Check for unclosed CDATA sections
        const cdataOpen = (xml.match(/<!\[CDATA\[/g) ?? []).length;
        const cdataClose = (xml.match(/\]\]>/g) ?? []).length;
        if (cdataOpen !== cdataClose) {
          errors.push(`${chartFile}: unclosed CDATA section (${cdataOpen} open, ${cdataClose} close)`);
        }
        // Check for multiLvlStrRef remnants (should have been cleaned)
        if (xml.includes("<c:multiLvlStrRef>")) {
          warnings.push(`${chartFile}: still contains multiLvlStrRef — Google Slides will break`);
        }
      } catch { /* skip binary entries */ }
    }

    // Check chart relationship files exist
    for (const chartFile of chartFiles) {
      const relPath = chartFile.replace("ppt/charts/", "ppt/charts/_rels/") + ".rels";
      if (!zip.file(relPath)) {
        warnings.push(`Missing chart relationship: ${relPath}`);
      }
    }

    // ─── MEDIA INTEGRITY ──────────────────────────────────────────
    // Collect all referenced media from all relationship files
    const relEntries = Object.keys(zip.files).filter(f => f.includes("_rels") && f.endsWith(".rels"));
    const allRelText: string[] = [];
    for (const rel of relEntries) {
      try {
        allRelText.push(await zip.files[rel].async("text"));
      } catch { /* skip */ }
    }
    const combinedRelText = allRelText.join("\n");

    // Check that media files are referenced (orphaned media = bloat or missing content)
    const mediaFiles = Object.keys(zip.files).filter(f => /^ppt\/media\//i.test(f));
    for (const media of mediaFiles) {
      const mediaName = media.split("/").pop();
      if (mediaName && !combinedRelText.includes(mediaName)) {
        warnings.push(`Orphaned media file: ${media} — not referenced by any relationship`);
      }
    }

    // ─── PRESENTATION.XML CONSISTENCY ─────────────────────────────
    const presXml = await zip.file("ppt/presentation.xml")?.async("string");
    if (presXml) {
      const presSlideRefs = presXml.match(/r:id="rId\d+"/g) ?? [];
      if (presSlideRefs.length === 0) {
        errors.push("ppt/presentation.xml has no slide references — file is structurally broken");
      }
    }

    return { valid: errors.length === 0, warnings, errors };
  } catch (e) {
    errors.push(`ZIP parse failed: ${e instanceof Error ? e.message : String(e)}`);
    return { valid: false, warnings, errors };
  }
}
