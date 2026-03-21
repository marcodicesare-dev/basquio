// ─── RENDERING COMPATIBILITY CONTRACT ─────────────────────────────
// Defines the deliberately constrained rendering surface proven safe
// across PowerPoint, Google Slides, and Keynote.
// Everything outside this contract is either image-rendered or rejected.

// ─── SUPPORTED LAYOUTS ────────────────────────────────────────────

export const SUPPORTED_LAYOUTS = [
  "cover", "section-divider", "exec-summary", "metrics",
  "title-chart", "chart-split", "evidence-grid", "comparison",
  "title-body", "title-bullets", "table", "summary",
] as const;
export type SupportedLayout = typeof SUPPORTED_LAYOUTS[number];

export function isSupportedLayout(layout: string): layout is SupportedLayout {
  return (SUPPORTED_LAYOUTS as readonly string[]).includes(layout);
}

// ─── CHART TYPE SAFETY TIERS ──────────────────────────────────────

// Tier 1: Shape-built, works identically everywhere
export const SAFE_CHART_TYPES = [
  "bar", "horizontal_bar", "grouped_bar",
  "stacked_bar", "stacked_bar_100",
  "line", "area",
  "pie", "doughnut",
  "scatter", "waterfall", "table",
] as const;
export type SafeChartType = typeof SAFE_CHART_TYPES[number];

// Tier 2: Rendered as PNG images — universal but not editable
export const IMAGE_ONLY_CHART_TYPES = [
  "bubble", "radar", "combo", "pareto", "heatmap",
  "funnel", "marimekko", "matrix", "quadrant", "timeline",
] as const;
export type ImageOnlyChartType = typeof IMAGE_ONLY_CHART_TYPES[number];

export function isSafeChartType(t: string): t is SafeChartType {
  return (SAFE_CHART_TYPES as readonly string[]).includes(t);
}

export function isImageOnlyChartType(t: string): t is ImageOnlyChartType {
  return (IMAGE_ONLY_CHART_TYPES as readonly string[]).includes(t);
}

export function requiresImageRender(t: string): boolean {
  return isImageOnlyChartType(t);
}

// ─── SAFE FONTS ───────────────────────────────────────────────────
// Only fonts guaranteed pixel-identical across PowerPoint, Google Slides, Keynote

export const SAFE_FONTS = {
  heading: "Arial",
  body: "Arial",
  mono: "Courier New",
} as const;

// ─── OOXML RULES ──────────────────────────────────────────────────

export const OOXML_RULES = {
  shapes: true,
  images: true,
  nativeCharts: false,      // Break across apps
  fontEmbedding: false,     // Requires Aspose ($1700/yr)
  animations: false,        // Break in Slides/Keynote
  transitions: false,       // Break in Slides/Keynote
  masterSlides: false,      // Template-dependent
  maxSlidesPerDeck: 15,
  maxChartsPerDeck: 12,
  maxBulletsPerSlide: 4,
  maxMetricsPerSlide: 6,
  maxBodyWords: {
    "chart-split": 30,
    "title-chart": 30,
    "evidence-grid": 30,
    "title-body": 50,
    "summary": 30,
    "exec-summary": 25,
    "comparison": 30,
    "recommendation": 30,
  } as Record<string, number>,
  maxTitleWords: 16,
  maxCalloutWords: 25,
} as const;

// ─── VALIDATION ───────────────────────────────────────────────────

export type ContractViolation = { rule: string; message: string };

export function validateSlideContract(slide: {
  layoutId: string;
  chartType?: string;
  title?: string;
  body?: string;
  bullets?: string[];
  metrics?: unknown[];
  callout?: { text?: string };
}): { valid: boolean; violations: ContractViolation[] } {
  const violations: ContractViolation[] = [];

  if (!isSupportedLayout(slide.layoutId)) {
    violations.push({ rule: "unsupported_layout", message: `Layout "${slide.layoutId}" is not in the supported set` });
  }

  if (slide.chartType && !isSafeChartType(slide.chartType) && !isImageOnlyChartType(slide.chartType)) {
    violations.push({ rule: "unknown_chart_type", message: `Chart type "${slide.chartType}" is not recognized` });
  }

  if (slide.title) {
    const titleWords = slide.title.split(/\s+/).length;
    if (titleWords > OOXML_RULES.maxTitleWords) {
      violations.push({ rule: "title_too_long", message: `Title has ${titleWords} words (max ${OOXML_RULES.maxTitleWords})` });
    }
  }

  if (slide.body) {
    const bodyWords = slide.body.split(/\s+/).length;
    const maxWords = OOXML_RULES.maxBodyWords[slide.layoutId] ?? 50;
    if (bodyWords > maxWords) {
      violations.push({ rule: "body_too_long", message: `Body has ${bodyWords} words (max ${maxWords} for ${slide.layoutId})` });
    }
  }

  if (slide.bullets && slide.bullets.length > OOXML_RULES.maxBulletsPerSlide) {
    violations.push({ rule: "too_many_bullets", message: `${slide.bullets.length} bullets (max ${OOXML_RULES.maxBulletsPerSlide})` });
  }

  if (slide.metrics && Array.isArray(slide.metrics) && slide.metrics.length > OOXML_RULES.maxMetricsPerSlide) {
    violations.push({ rule: "too_many_metrics", message: `${slide.metrics.length} metrics (max ${OOXML_RULES.maxMetricsPerSlide})` });
  }

  if (slide.callout?.text) {
    const calloutWords = slide.callout.text.split(/\s+/).length;
    if (calloutWords > OOXML_RULES.maxCalloutWords) {
      violations.push({ rule: "callout_too_long", message: `Callout has ${calloutWords} words (max ${OOXML_RULES.maxCalloutWords})` });
    }
  }

  return { valid: violations.length === 0, violations };
}

export function validateDeckContract(slides: Array<{
  layoutId: string;
  chartType?: string;
}>): { valid: boolean; violations: ContractViolation[] } {
  const violations: ContractViolation[] = [];

  if (slides.length > OOXML_RULES.maxSlidesPerDeck) {
    violations.push({ rule: "too_many_slides", message: `${slides.length} slides (max ${OOXML_RULES.maxSlidesPerDeck})` });
  }

  const chartCount = slides.filter(s => s.chartType && s.chartType !== "table").length;
  if (chartCount > OOXML_RULES.maxChartsPerDeck) {
    violations.push({ rule: "too_many_charts", message: `${chartCount} charts (max ${OOXML_RULES.maxChartsPerDeck})` });
  }

  if (slides.length > 0 && slides[0].layoutId !== "cover") {
    violations.push({ rule: "no_cover", message: "First slide must be a cover" });
  }

  const lastSlide = slides[slides.length - 1];
  // Accept summary, title-body, or title-bullets as valid closing layouts.
  // "recommendation" is a slide role, not a layout — it maps to "summary" or "title-body" at render time.
  if (slides.length > 2 && lastSlide && !["summary", "title-body", "title-bullets"].includes(lastSlide.layoutId)) {
    violations.push({ rule: "no_summary", message: "Last slide should be summary or recommendation layout" });
  }

  const layoutCounts: Record<string, number> = {};
  for (const s of slides) {
    layoutCounts[s.layoutId] = (layoutCounts[s.layoutId] ?? 0) + 1;
  }
  const uniqueLayouts = Object.keys(layoutCounts).length;
  if (slides.length > 4 && uniqueLayouts < 3) {
    violations.push({ rule: "low_layout_variety", message: `Only ${uniqueLayouts} distinct layouts (min 3 for decks > 4 slides)` });
  }

  return { valid: violations.length === 0, violations };
}

// ─── CHART TYPE COERCION ──────────────────────────────────────────

const COERCION_MAP: Record<string, SafeChartType> = {
  bubble: "scatter",
  combo: "grouped_bar",
  funnel: "horizontal_bar",
  marimekko: "stacked_bar_100",
  matrix: "scatter",
  quadrant: "scatter",
  timeline: "horizontal_bar",
  heatmap: "table",
  radar: "bar",
  pareto: "horizontal_bar",
};

export function coerceToSafeChartType(proposed: string): SafeChartType | null {
  if (isSafeChartType(proposed)) return proposed;
  return COERCION_MAP[proposed] ?? null;
}
