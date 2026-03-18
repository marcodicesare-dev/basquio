/**
 * Basquio Chart & Component Design System
 *
 * This is the canonical contract for all visual components in Basquio.
 * Both PPTX and PDF renderers consume these types.
 * The author agent builds charts using these archetypes.
 * The renderer applies the rendering rules deterministically.
 *
 * Architecture: Author → ChartSpec (contract) → Scene Graph → Renderer
 */

// ─── CHART ARCHETYPES ──────────────────────────────────────────────
// Each chart archetype defines:
// 1. What analytical intent it serves
// 2. Required/optional data fields
// 3. Rendering rules (axis, legend, labels, formatting)
// 4. How it maps to PptxGenJS chart types
// 5. Whether it needs shape-built rendering (for cross-app compat)

export type ChartArchetype = {
  id: string;
  name: string;
  intent: AnalyticalIntent;
  pptxChartType: PptxNativeType | "shape-built";
  requiredFields: string[];
  optionalFields: string[];
  renderingRules: ChartRenderingRules;
  constraints: ChartConstraints;
};

export type AnalyticalIntent =
  | "rank"           // "Who is biggest?" → horizontal bar
  | "trend"          // "How is it changing?" → line / area
  | "composition"    // "What's the mix?" → stacked bar / pie / donut
  | "bridge"         // "What drove the change?" → waterfall
  | "correlation"    // "Are these related?" → scatter / bubble
  | "comparison"     // "How do these differ?" → grouped bar
  | "distribution"   // "How is it spread?" → histogram / box
  | "flow"           // "Where does it go?" → funnel / sankey
  | "detail"         // "Show me the data" → table
  | "positioning"    // "Where do they sit?" → scatter quadrant / matrix
  | "timeline"       // "When did it happen?" → gantt / timeline
  | "proportion";    // "What share?" → marimekko / treemap

export type PptxNativeType =
  | "bar"            // PptxGenJS BAR (vertical columns)
  | "bar-horizontal" // PptxGenJS BAR with barDir: "bar"
  | "bar-stacked"    // PptxGenJS BAR with barGrouping: "stacked"
  | "bar-100"        // PptxGenJS BAR with barGrouping: "percentStacked"
  | "bar-grouped"    // PptxGenJS BAR with barGrouping: "clustered"
  | "line"           // PptxGenJS LINE
  | "area"           // PptxGenJS AREA
  | "pie"            // PptxGenJS PIE
  | "doughnut"       // PptxGenJS DOUGHNUT
  | "scatter"        // PptxGenJS SCATTER
  | "bubble"         // PptxGenJS BUBBLE
  | "radar";         // PptxGenJS RADAR

export type ChartRenderingRules = {
  // Axis policy
  showCategoryAxis: boolean;
  showValueAxis: boolean;
  categoryAxisTitle: "auto" | "none" | "from-xAxis";  // auto = derive from field name
  valueAxisTitle: "auto" | "none" | "from-unit";
  valueAxisFormat: "auto" | "number" | "percent" | "currency" | "compact";

  // Label policy
  showDataLabels: "always" | "never" | "smart";  // smart = show if ≤12 categories
  dataLabelFormat: "auto" | "number" | "percent" | "currency" | "compact";
  dataLabelPosition: "outEnd" | "inside" | "above" | "center";

  // Legend policy
  showLegend: "auto" | "always" | "never";  // auto = show if multi-series
  legendPosition: "bottom" | "right" | "top" | "none";

  // Visual policy
  orientation: "vertical" | "horizontal";
  highlightFocal: boolean;       // Highlight focal entity in different color
  showGridLines: boolean;
  showBenchmarkLine: boolean;    // Reference line (e.g., industry average)
  sortBars: "none" | "asc" | "desc";
  maxCategories: number;
};

export type ChartConstraints = {
  minCategories: number;
  maxCategories: number;
  minSeries: number;
  maxSeries: number;
  supportsHighlight: boolean;
  supportsBenchmark: boolean;
};

// ─── SEMANTIC CHART FIELDS ─────────────────────────────────────────
// These are the fields the author agent provides beyond raw data.
// They tell the renderer HOW to present the chart, not just WHAT data.

export type ChartSemantics = {
  intent: AnalyticalIntent;
  unit?: string;              // "€M", "%", "units", "pp" (percentage points)
  benchmarkLabel?: string;    // "Industry average", "Target", "Previous year"
  benchmarkValue?: number;    // The reference line value
  focalEntity?: string;       // The entity to highlight (client brand)
  axisTitle?: string;         // Override axis title
  sourceNote?: string;        // "Source: NielsenIQ, MAT Dec 2025"
  positiveDirection?: "up" | "down";  // Is higher better or worse?
};

// ─── THE ARCHETYPE LIBRARY ─────────────────────────────────────────

export const CHART_ARCHETYPES: Record<string, ChartArchetype> = {
  // ── RANKING ──
  "horizontal-bar": {
    id: "horizontal-bar",
    name: "Horizontal Bar (Ranking)",
    intent: "rank",
    pptxChartType: "bar-horizontal",
    requiredFields: ["categories", "values"],
    optionalFields: ["highlightEntity", "benchmarkValue", "unit"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: true,
      categoryAxisTitle: "none",
      valueAxisTitle: "auto",
      valueAxisFormat: "auto",
      showDataLabels: "always",
      dataLabelFormat: "auto",
      dataLabelPosition: "outEnd",
      showLegend: "auto",
      legendPosition: "bottom",
      orientation: "horizontal",
      highlightFocal: true,
      showGridLines: false,
      showBenchmarkLine: true,
      sortBars: "desc",
      maxCategories: 12,
    },
    constraints: { minCategories: 3, maxCategories: 15, minSeries: 1, maxSeries: 3, supportsHighlight: true, supportsBenchmark: true },
  },

  "vertical-bar": {
    id: "vertical-bar",
    name: "Vertical Bar (Comparison)",
    intent: "comparison",
    pptxChartType: "bar",
    requiredFields: ["categories", "values"],
    optionalFields: ["highlightEntity", "benchmarkValue", "unit"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: true,
      categoryAxisTitle: "none",
      valueAxisTitle: "auto",
      valueAxisFormat: "auto",
      showDataLabels: "smart",
      dataLabelFormat: "auto",
      dataLabelPosition: "outEnd",
      showLegend: "auto",
      legendPosition: "bottom",
      orientation: "vertical",
      highlightFocal: true,
      showGridLines: true,
      showBenchmarkLine: true,
      sortBars: "none",
      maxCategories: 10,
    },
    constraints: { minCategories: 2, maxCategories: 12, minSeries: 1, maxSeries: 4, supportsHighlight: true, supportsBenchmark: true },
  },

  "grouped-bar": {
    id: "grouped-bar",
    name: "Grouped Bar (Side-by-side Comparison)",
    intent: "comparison",
    pptxChartType: "bar-grouped",
    requiredFields: ["categories", "series"],
    optionalFields: ["highlightEntity", "unit"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: true,
      categoryAxisTitle: "none",
      valueAxisTitle: "auto",
      valueAxisFormat: "auto",
      showDataLabels: "smart",
      dataLabelFormat: "auto",
      dataLabelPosition: "outEnd",
      showLegend: "always",
      legendPosition: "bottom",
      orientation: "vertical",
      highlightFocal: false,
      showGridLines: true,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 8,
    },
    constraints: { minCategories: 2, maxCategories: 10, minSeries: 2, maxSeries: 5, supportsHighlight: false, supportsBenchmark: false },
  },

  // ── COMPOSITION ──
  "stacked-bar": {
    id: "stacked-bar",
    name: "Stacked Bar (Composition)",
    intent: "composition",
    pptxChartType: "bar-stacked",
    requiredFields: ["categories", "series"],
    optionalFields: ["unit"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: true,
      categoryAxisTitle: "none",
      valueAxisTitle: "auto",
      valueAxisFormat: "auto",
      showDataLabels: "smart",
      dataLabelFormat: "auto",
      dataLabelPosition: "center",
      showLegend: "always",
      legendPosition: "bottom",
      orientation: "vertical",
      highlightFocal: false,
      showGridLines: false,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 8,
    },
    constraints: { minCategories: 2, maxCategories: 10, minSeries: 2, maxSeries: 6, supportsHighlight: false, supportsBenchmark: false },
  },

  "stacked-bar-100": {
    id: "stacked-bar-100",
    name: "100% Stacked Bar (Share of Total)",
    intent: "composition",
    pptxChartType: "bar-100",
    requiredFields: ["categories", "series"],
    optionalFields: ["unit"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: false,
      categoryAxisTitle: "none",
      valueAxisTitle: "none",
      valueAxisFormat: "percent",
      showDataLabels: "always",
      dataLabelFormat: "percent",
      dataLabelPosition: "center",
      showLegend: "always",
      legendPosition: "bottom",
      orientation: "vertical",
      highlightFocal: false,
      showGridLines: false,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 8,
    },
    constraints: { minCategories: 2, maxCategories: 10, minSeries: 2, maxSeries: 6, supportsHighlight: false, supportsBenchmark: false },
  },

  "pie": {
    id: "pie",
    name: "Pie Chart (Share/Proportion)",
    intent: "proportion",
    pptxChartType: "pie",
    requiredFields: ["categories", "values"],
    optionalFields: ["highlightEntity"],
    renderingRules: {
      showCategoryAxis: false,
      showValueAxis: false,
      categoryAxisTitle: "none",
      valueAxisTitle: "none",
      valueAxisFormat: "percent",
      showDataLabels: "always",
      dataLabelFormat: "percent",
      dataLabelPosition: "outEnd",
      showLegend: "always",
      legendPosition: "right",
      orientation: "vertical",
      highlightFocal: true,
      showGridLines: false,
      showBenchmarkLine: false,
      sortBars: "desc",
      maxCategories: 6,
    },
    constraints: { minCategories: 2, maxCategories: 8, minSeries: 1, maxSeries: 1, supportsHighlight: true, supportsBenchmark: false },
  },

  "doughnut": {
    id: "doughnut",
    name: "Donut Chart (Share with Center Metric)",
    intent: "proportion",
    pptxChartType: "doughnut",
    requiredFields: ["categories", "values"],
    optionalFields: ["highlightEntity"],
    renderingRules: {
      showCategoryAxis: false,
      showValueAxis: false,
      categoryAxisTitle: "none",
      valueAxisTitle: "none",
      valueAxisFormat: "percent",
      showDataLabels: "always",
      dataLabelFormat: "percent",
      dataLabelPosition: "outEnd",
      showLegend: "always",
      legendPosition: "right",
      orientation: "vertical",
      highlightFocal: true,
      showGridLines: false,
      showBenchmarkLine: false,
      sortBars: "desc",
      maxCategories: 6,
    },
    constraints: { minCategories: 2, maxCategories: 8, minSeries: 1, maxSeries: 1, supportsHighlight: true, supportsBenchmark: false },
  },

  // ── TREND ──
  "line": {
    id: "line",
    name: "Line Chart (Trend Over Time)",
    intent: "trend",
    pptxChartType: "line",
    requiredFields: ["categories", "series"],
    optionalFields: ["benchmarkValue", "benchmarkLabel", "unit"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: true,
      categoryAxisTitle: "none",
      valueAxisTitle: "auto",
      valueAxisFormat: "auto",
      showDataLabels: "smart",
      dataLabelFormat: "auto",
      dataLabelPosition: "above",
      showLegend: "auto",
      legendPosition: "bottom",
      orientation: "vertical",
      highlightFocal: false,
      showGridLines: true,
      showBenchmarkLine: true,
      sortBars: "none",
      maxCategories: 20,
    },
    constraints: { minCategories: 3, maxCategories: 24, minSeries: 1, maxSeries: 5, supportsHighlight: false, supportsBenchmark: true },
  },

  "area": {
    id: "area",
    name: "Area Chart (Volume Trend)",
    intent: "trend",
    pptxChartType: "area",
    requiredFields: ["categories", "series"],
    optionalFields: ["unit"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: true,
      categoryAxisTitle: "none",
      valueAxisTitle: "auto",
      valueAxisFormat: "auto",
      showDataLabels: "never",
      dataLabelFormat: "auto",
      dataLabelPosition: "above",
      showLegend: "auto",
      legendPosition: "bottom",
      orientation: "vertical",
      highlightFocal: false,
      showGridLines: true,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 20,
    },
    constraints: { minCategories: 3, maxCategories: 24, minSeries: 1, maxSeries: 4, supportsHighlight: false, supportsBenchmark: false },
  },

  // ── BRIDGE / WATERFALL ──
  "waterfall": {
    id: "waterfall",
    name: "Waterfall (Bridge / Decomposition)",
    intent: "bridge",
    pptxChartType: "bar-stacked",  // Simulated with 3-series stacked: base/rise/fall
    requiredFields: ["categories", "values"],
    optionalFields: ["unit"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: false,
      categoryAxisTitle: "none",
      valueAxisTitle: "none",
      valueAxisFormat: "auto",
      showDataLabels: "always",
      dataLabelFormat: "auto",
      dataLabelPosition: "outEnd",
      showLegend: "never",
      legendPosition: "none",
      orientation: "vertical",
      highlightFocal: false,
      showGridLines: false,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 10,
    },
    constraints: { minCategories: 3, maxCategories: 12, minSeries: 1, maxSeries: 1, supportsHighlight: false, supportsBenchmark: false },
  },

  // ── CORRELATION / POSITIONING ──
  "scatter": {
    id: "scatter",
    name: "Scatter Plot (Correlation)",
    intent: "correlation",
    pptxChartType: "scatter",
    requiredFields: ["xValues", "yValues"],
    optionalFields: ["labels", "bubbleSize", "quadrantLabels"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: true,
      categoryAxisTitle: "from-xAxis",
      valueAxisTitle: "from-unit",
      valueAxisFormat: "auto",
      showDataLabels: "always",
      dataLabelFormat: "auto",
      dataLabelPosition: "above",
      showLegend: "auto",
      legendPosition: "bottom",
      orientation: "vertical",
      highlightFocal: true,
      showGridLines: true,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 30,
    },
    constraints: { minCategories: 3, maxCategories: 50, minSeries: 1, maxSeries: 5, supportsHighlight: true, supportsBenchmark: false },
  },

  // ── SHAPE-BUILT CHARTS (cross-app safe, not native PptxGenJS) ──
  "marimekko": {
    id: "marimekko",
    name: "Marimekko / Mekko (Market Map)",
    intent: "proportion",
    pptxChartType: "shape-built",
    requiredFields: ["categories", "segments", "widths", "heights"],
    optionalFields: ["highlightEntity"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: false,
      categoryAxisTitle: "none",
      valueAxisTitle: "none",
      valueAxisFormat: "percent",
      showDataLabels: "always",
      dataLabelFormat: "percent",
      dataLabelPosition: "center",
      showLegend: "always",
      legendPosition: "bottom",
      orientation: "vertical",
      highlightFocal: true,
      showGridLines: false,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 8,
    },
    constraints: { minCategories: 2, maxCategories: 10, minSeries: 2, maxSeries: 6, supportsHighlight: true, supportsBenchmark: false },
  },

  "funnel": {
    id: "funnel",
    name: "Funnel (Conversion / Pipeline)",
    intent: "flow",
    pptxChartType: "shape-built",
    requiredFields: ["stages", "values"],
    optionalFields: ["conversionRates"],
    renderingRules: {
      showCategoryAxis: false,
      showValueAxis: false,
      categoryAxisTitle: "none",
      valueAxisTitle: "none",
      valueAxisFormat: "auto",
      showDataLabels: "always",
      dataLabelFormat: "auto",
      dataLabelPosition: "center",
      showLegend: "never",
      legendPosition: "none",
      orientation: "vertical",
      highlightFocal: false,
      showGridLines: false,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 8,
    },
    constraints: { minCategories: 3, maxCategories: 8, minSeries: 1, maxSeries: 1, supportsHighlight: false, supportsBenchmark: false },
  },

  "matrix": {
    id: "matrix",
    name: "Matrix / Heatmap (Positioning)",
    intent: "positioning",
    pptxChartType: "shape-built",
    requiredFields: ["rows", "columns", "values"],
    optionalFields: ["highlightEntity", "colorScale"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: true,
      categoryAxisTitle: "from-xAxis",
      valueAxisTitle: "from-unit",
      valueAxisFormat: "auto",
      showDataLabels: "always",
      dataLabelFormat: "auto",
      dataLabelPosition: "center",
      showLegend: "always",
      legendPosition: "right",
      orientation: "vertical",
      highlightFocal: true,
      showGridLines: false,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 10,
    },
    constraints: { minCategories: 2, maxCategories: 10, minSeries: 2, maxSeries: 10, supportsHighlight: true, supportsBenchmark: false },
  },

  "quadrant": {
    id: "quadrant",
    name: "Quadrant Chart (Strategic Positioning)",
    intent: "positioning",
    pptxChartType: "shape-built",
    requiredFields: ["entities", "xValues", "yValues"],
    optionalFields: ["bubbleSize", "quadrantLabels", "highlightEntity"],
    renderingRules: {
      showCategoryAxis: true,
      showValueAxis: true,
      categoryAxisTitle: "from-xAxis",
      valueAxisTitle: "from-unit",
      valueAxisFormat: "auto",
      showDataLabels: "always",
      dataLabelFormat: "auto",
      dataLabelPosition: "above",
      showLegend: "never",
      legendPosition: "none",
      orientation: "vertical",
      highlightFocal: true,
      showGridLines: true,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 20,
    },
    constraints: { minCategories: 3, maxCategories: 30, minSeries: 1, maxSeries: 1, supportsHighlight: true, supportsBenchmark: false },
  },

  // ── DETAIL / TABLE ──
  "table": {
    id: "table",
    name: "Data Table (Detail View)",
    intent: "detail",
    pptxChartType: "shape-built",
    requiredFields: ["headers", "rows"],
    optionalFields: ["highlightEntity", "conditionalFormatting"],
    renderingRules: {
      showCategoryAxis: false,
      showValueAxis: false,
      categoryAxisTitle: "none",
      valueAxisTitle: "none",
      valueAxisFormat: "auto",
      showDataLabels: "never",
      dataLabelFormat: "auto",
      dataLabelPosition: "center",
      showLegend: "never",
      legendPosition: "none",
      orientation: "vertical",
      highlightFocal: true,
      showGridLines: false,
      showBenchmarkLine: false,
      sortBars: "none",
      maxCategories: 20,
    },
    constraints: { minCategories: 1, maxCategories: 50, minSeries: 1, maxSeries: 10, supportsHighlight: true, supportsBenchmark: false },
  },
};

// ─── COMPONENT VARIANTS ────────────────────────────────────────────

export type KPICardVariant = "standard" | "compact" | "hero" | "delta-only";
export type TableVariant = "standard" | "comparison" | "scorecard" | "matrix";
export type CalloutVariant = "insight" | "recommendation" | "warning" | "action";

export type KPICardSpec = {
  variant: KPICardVariant;
  label: string;
  value: string;
  delta?: string;
  target?: string;
  unit?: string;
  trend?: "up" | "down" | "flat";
  accentColor?: string;
};

export type CalloutSpec = {
  variant: CalloutVariant;
  text: string;
  icon?: "arrow" | "check" | "warning" | "lightbulb" | "star";
};

// ─── HELPER: resolve archetype from author's chart type + intent ──

export function resolveChartArchetype(
  chartType: string,
  intent?: string,
): ChartArchetype {
  // Direct match
  if (CHART_ARCHETYPES[chartType]) return CHART_ARCHETYPES[chartType];

  // Map old chart types to new archetypes
  const typeMap: Record<string, string> = {
    "bar": "vertical-bar",
    "horizontal_bar": "horizontal-bar",
    "stacked_bar": "stacked-bar",
    "line": "line",
    "area": "area",
    "pie": "pie",
    "doughnut": "doughnut",
    "scatter": "scatter",
    "waterfall": "waterfall",
    "table": "table",
    "funnel": "funnel",
    "marimekko": "marimekko",
    "matrix": "matrix",
    "quadrant": "quadrant",
    "grouped_bar": "grouped-bar",
    "stacked_bar_100": "stacked-bar-100",
  };

  const mapped = typeMap[chartType];
  if (mapped && CHART_ARCHETYPES[mapped]) return CHART_ARCHETYPES[mapped];

  // Infer from intent
  if (intent) {
    const intentMap: Record<string, string> = {
      "rank": "horizontal-bar",
      "trend": "line",
      "composition": "stacked-bar",
      "bridge": "waterfall",
      "correlation": "scatter",
      "comparison": "grouped-bar",
      "detail": "table",
      "proportion": "pie",
      "flow": "funnel",
      "positioning": "quadrant",
    };
    const inferred = intentMap[intent];
    if (inferred && CHART_ARCHETYPES[inferred]) return CHART_ARCHETYPES[inferred];
  }

  // Default fallback
  return CHART_ARCHETYPES["vertical-bar"];
}

// ─── HELPER: get all supported chart types for the author tool ──

export function getSupportedChartTypes(): string[] {
  return Object.keys(CHART_ARCHETYPES);
}

// ─── HELPER: get rendering rules for a chart type ──

export function getChartRenderingRules(chartType: string, intent?: string): ChartRenderingRules {
  return resolveChartArchetype(chartType, intent).renderingRules;
}
