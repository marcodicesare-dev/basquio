/**
 * Deterministic domain contracts for intelligent deck planning.
 * These are CODE-level intelligence, not prompt-level suggestions.
 * They enforce exhibit selection, formatting, and quality gates.
 * Zero LLM cost.
 */

// ─── EXHIBIT PLANNER (deterministic chart selection) ─────────────

export type QuestionType =
  | "sizing"        // How big is each segment?
  | "ranking"       // Who is biggest/smallest?
  | "comparison"    // CY vs PY, A vs B
  | "composition"   // What's the mix/breakdown?
  | "trend"         // How has it changed over time?
  | "concentration" // How concentrated is it?
  | "correlation"   // How do two variables relate?
  | "bridge"        // What drove the change?
  | "flat"          // Nothing changed (stable)
  | "unknown";

export type ExhibitType =
  | "horizontal_bar"
  | "grouped_bar"
  | "stacked_bar"
  | "stacked_bar_100"
  | "waterfall"
  | "line"
  | "doughnut"
  | "scatter"
  | "pareto"
  | "heatmap"
  | "table"
  | "kpi_card"
  | "none";

const EXHIBIT_MAP: Record<QuestionType, { preferred: ExhibitType[]; forbidden: ExhibitType[] }> = {
  sizing:        { preferred: ["horizontal_bar"],          forbidden: ["line", "scatter"] },
  ranking:       { preferred: ["horizontal_bar"],          forbidden: ["line", "doughnut"] },
  comparison:    { preferred: ["grouped_bar", "waterfall"],forbidden: ["line"] }, // NEVER line for 2-period
  composition:   { preferred: ["stacked_bar_100", "doughnut"], forbidden: ["line", "scatter"] },
  trend:         { preferred: ["line"],                    forbidden: [] }, // line OK only for 4+ periods
  concentration: { preferred: ["pareto", "horizontal_bar"],forbidden: ["line", "scatter"] },
  correlation:   { preferred: ["scatter"],                 forbidden: ["line", "doughnut"] },
  bridge:        { preferred: ["waterfall"],               forbidden: ["line", "doughnut"] },
  flat:          { preferred: ["kpi_card"],                forbidden: ["line", "scatter"] },
  unknown:       { preferred: ["horizontal_bar"],          forbidden: [] },
};

/**
 * Given a question type, return the best exhibit and forbidden list.
 * If the proposed chart type is forbidden, return the first preferred alternative.
 */
export function enforceExhibit(
  questionType: QuestionType,
  proposedChartType: string,
  periodCount: number,
): { chartType: string; wasOverridden: boolean; reason?: string } {
  const rule = EXHIBIT_MAP[questionType] ?? EXHIBIT_MAP.unknown;
  const normalized = proposedChartType.toLowerCase().replace(/[-\s]/g, "_");

  // Special case: line charts require 4+ periods
  if ((normalized === "line" || normalized === "area") && periodCount < 4) {
    return {
      chartType: rule.preferred[0] ?? "horizontal_bar",
      wasOverridden: true,
      reason: `Line/area charts require 4+ time periods (found ${periodCount}). Using ${rule.preferred[0]} instead.`,
    };
  }

  // Check if proposed type is forbidden for this question
  if (rule.forbidden.includes(normalized as ExhibitType)) {
    return {
      chartType: rule.preferred[0] ?? "horizontal_bar",
      wasOverridden: true,
      reason: `${proposedChartType} is not appropriate for ${questionType} questions. Using ${rule.preferred[0]} instead.`,
    };
  }

  return { chartType: proposedChartType, wasOverridden: false };
}

// ─── QUESTION TYPE INFERENCE (from finding claims) ──────────────

const QUESTION_PATTERNS: Array<{ pattern: RegExp; type: QuestionType }> = [
  // Sizing / ranking
  { pattern: /largest|biggest|smallest|leading|top \d|rank|size/i, type: "sizing" },
  { pattern: /dominat|concentrated|hero|pareto|top.*account/i, type: "concentration" },
  // Comparison (CY vs PY)
  { pattern: /vs\.?\s*(prior|prev|last|anno|year|py|cy|yoy)/i, type: "comparison" },
  { pattern: /grew|declined|increased|decreased|change|growth|fell/i, type: "comparison" },
  { pattern: /flat|stable|unchanged|stagnant/i, type: "flat" },
  // Composition / mix
  { pattern: /mix|composition|split|breakdown|share.*of|portion|segment/i, type: "composition" },
  { pattern: /over-?indexed|under-?indexed|gap|mismatch|imbalance/i, type: "composition" },
  // Bridge / drivers
  { pattern: /driven by|due to|because|bridge|decompos|contribut/i, type: "bridge" },
  // Trend
  { pattern: /trend|trajectory|over time|month.*over|quarter.*over|weekly/i, type: "trend" },
  // Correlation
  { pattern: /correlat|relationship|vs\.|versus|scatter/i, type: "correlation" },
];

/**
 * Infer the analytical question type from a finding's claim text.
 */
export function inferQuestionType(claim: string): QuestionType {
  for (const { pattern, type } of QUESTION_PATTERNS) {
    if (pattern.test(claim)) return type;
  }
  return "unknown";
}

// ─── FORMATTING CONTRACT ────────────────────────────────────────

export type UnitContract = {
  type: "currency" | "percentage" | "count" | "index" | "points" | "ratio" | "unknown";
  currencyCode?: string;  // EUR, USD, GBP, CHF, JPY
  currencySymbol?: string; // €, $, £
  displayPrecision: number; // decimal places
  abbreviate: boolean; // use K/M/B
};

/**
 * Infer the unit contract from column name and sample values.
 * Deterministic, $0 cost.
 */
export function inferUnitContract(columnName: string, sampleValues: string[]): UnitContract {
  const lower = columnName.toLowerCase();

  // Percentage indicators
  if (lower.includes("%") || lower.includes("pct") || lower.includes("quota") || lower.includes("share") || lower.includes("intensity")) {
    return { type: "percentage", displayPrecision: 1, abbreviate: false };
  }

  // Index indicators
  if (lower.includes("index") || lower.includes("idx")) {
    return { type: "index", displayPrecision: 0, abbreviate: false };
  }

  // Points indicators
  if (lower.includes("pts") || lower.includes("points") || lower.includes("pp") || lower.includes("var.ass")) {
    return { type: "points", displayPrecision: 1, abbreviate: false };
  }

  // Currency detection from sample values
  const CURRENCY_MAP: Record<string, { code: string; symbol: string }> = {
    "€": { code: "EUR", symbol: "€" },
    "$": { code: "USD", symbol: "$" },
    "£": { code: "GBP", symbol: "£" },
    "CHF": { code: "CHF", symbol: "CHF" },
    "¥": { code: "JPY", symbol: "¥" },
  };

  for (const val of sampleValues.slice(0, 10)) {
    const trimmed = String(val).trim();
    for (const [pattern, info] of Object.entries(CURRENCY_MAP)) {
      if (trimmed.includes(pattern)) {
        return {
          type: "currency",
          currencyCode: info.code,
          currencySymbol: info.symbol,
          displayPrecision: 0,
          abbreviate: true,
        };
      }
    }
  }

  // Value/volume columns without explicit currency
  if (lower.includes("valore") || lower.includes("value") || lower.includes("revenue") || lower.includes("sales")) {
    return { type: "currency", displayPrecision: 0, abbreviate: true };
  }

  if (lower.includes("volume") || lower.includes("confezioni") || lower.includes("units") || lower.includes("packs")) {
    return { type: "count", displayPrecision: 0, abbreviate: true };
  }

  return { type: "unknown", displayPrecision: 1, abbreviate: false };
}

// ─── ONTOLOGY MAPPER (Italian → English) ────────────────────────

export type CanonicalColumn = {
  originalName: string;
  canonicalName: string;
  role: "dimension" | "measure" | "identifier" | "period_marker";
  domain: "hierarchy" | "brand" | "product" | "sales" | "share" | "price" | "distribution" | "promotion" | "other";
  unit?: UnitContract;
};

const COLUMN_MAP: Array<{ pattern: RegExp; canonical: string; role: CanonicalColumn["role"]; domain: CanonicalColumn["domain"] }> = [
  // Hierarchy
  { pattern: /^AREA.?ECR/i, canonical: "Category Area", role: "dimension", domain: "hierarchy" },
  { pattern: /^COMPARTO.?ECR/i, canonical: "Segment", role: "dimension", domain: "hierarchy" },
  { pattern: /^FAMIGLIA.?ECR/i, canonical: "Sub-segment", role: "dimension", domain: "hierarchy" },
  { pattern: /^MERCATO.?ECR/i, canonical: "Market", role: "dimension", domain: "hierarchy" },
  // Brand
  { pattern: /^FORNITORE$/i, canonical: "Manufacturer", role: "dimension", domain: "brand" },
  { pattern: /^MARCA$/i, canonical: "Brand", role: "dimension", domain: "brand" },
  // Product
  { pattern: /^ITEM$/i, canonical: "Product Description", role: "identifier", domain: "product" },
  { pattern: /^UPC$/i, canonical: "Barcode", role: "identifier", domain: "product" },
  { pattern: /ITEM.?CODE/i, canonical: "Item Code", role: "identifier", domain: "product" },
  // Sales
  { pattern: /^V\.?\s*Valore$/i, canonical: "Sales Value (CY)", role: "measure", domain: "sales" },
  { pattern: /V\.?\s*Valore\s*Anno\s*prec/i, canonical: "Sales Value (PY)", role: "measure", domain: "sales" },
  { pattern: /^V\.?\s*\(ALL\)$/i, canonical: "Sales Volume (CY)", role: "measure", domain: "sales" },
  { pattern: /V\.?\s*\(ALL\)\s*Anno\s*prec/i, canonical: "Sales Volume (PY)", role: "measure", domain: "sales" },
  { pattern: /^V\.?\s*Confezioni$/i, canonical: "Sales Units (CY)", role: "measure", domain: "sales" },
  { pattern: /V\.?\s*Confezioni\s*Anno\s*prec/i, canonical: "Sales Units (PY)", role: "measure", domain: "sales" },
  // Price
  { pattern: /IDX\s*PR/i, canonical: "Price Index", role: "measure", domain: "price" },
  { pattern: /IDX\s*FORMATO/i, canonical: "Format Index", role: "measure", domain: "price" },
  { pattern: /FASCIA\s*IDX\s*PR/i, canonical: "Price Band", role: "dimension", domain: "price" },
  { pattern: /FASCIA\s*IDX\s*FORMATO/i, canonical: "Format Band", role: "dimension", domain: "price" },
  // Var (change indicators)
  { pattern: /Var\.?\s*%/i, canonical: "% Change", role: "measure", domain: "sales" },
  { pattern: /Var\.?\s*Ass/i, canonical: "Absolute Change", role: "measure", domain: "sales" },
];

/**
 * Map raw column names to canonical English names with roles and domains.
 * Deterministic, $0 cost.
 */
export function mapColumns(columnNames: string[], sampleValues?: Record<string, string[]>): CanonicalColumn[] {
  return columnNames.map((name) => {
    const match = COLUMN_MAP.find((m) => m.pattern.test(name));
    const samples = sampleValues?.[name] ?? [];
    const unit = inferUnitContract(name, samples);

    if (match) {
      return {
        originalName: name,
        canonicalName: match.canonical,
        role: match.role,
        domain: match.domain,
        unit,
      };
    }

    // Default: infer from name patterns
    const lower = name.toLowerCase();
    const isNumeric = samples.some((s) => !isNaN(Number(String(s).replace(/[€$£,.']/g, ""))));
    return {
      originalName: name,
      canonicalName: name, // keep original if no mapping
      role: isNumeric ? "measure" as const : "dimension" as const,
      domain: "other" as const,
      unit,
    };
  });
}

// ─── SLIDE KILL QA (deterministic post-author gate) ─────────────

export type SlideQualityResult = {
  position: number;
  pass: boolean;
  issues: string[];
};

/**
 * Deterministic quality gate for each slide.
 * Returns pass/fail with specific issues.
 * Failed slides get removed from the final deck (not just flagged).
 */
export function evaluateSlideQuality(slide: {
  position: number;
  layoutId: string;
  title: string;
  body?: string;
  bullets?: string[];
  chartId?: string | null;
  callout?: { text: string } | null;
  metrics?: Array<{ label: string; value: string; delta?: string }> | null;
}): SlideQualityResult {
  const issues: string[] = [];

  // 1. Title must be an insight, not a topic label
  const TOPIC_LABELS = /^(overview|summary|introduction|background|context|analysis|conclusion|appendix|next steps|agenda|table of contents)/i;
  if (TOPIC_LABELS.test(slide.title.trim())) {
    issues.push(`Topic-label title: "${slide.title}" — must be a specific finding with a number`);
  }

  // 2. Title should contain at least one number (except cover/divider/summary/recommendation)
  const hasNumber = /\d/.test(slide.title);
  const numberExemptLayouts = ["cover", "section-divider", "summary", "title-body", "title-bullets"];
  if (!hasNumber && !numberExemptLayouts.includes(slide.layoutId)) {
    issues.push("Title has no number — analytical titles need quantification");
  }

  // 3. Chart-layout slides MUST have a chart
  const chartLayouts = ["title-chart", "chart-split", "evidence-grid", "comparison"];
  if (chartLayouts.includes(slide.layoutId) && !slide.chartId) {
    issues.push(`Layout ${slide.layoutId} requires a chart but none is linked`);
  }

  // 4. Content slides should have a callout (except cover)
  if (!slide.callout && !["cover", "section-divider", "table"].includes(slide.layoutId)) {
    issues.push("Missing callout — every content slide needs a 'so what'");
  }

  // 5. Metrics deltas must be numeric
  if (slide.metrics) {
    for (const m of slide.metrics) {
      if (m.delta && !/^[+-]?\d|flat|stable/i.test(m.delta.trim())) {
        issues.push(`Metric "${m.label}" has non-numeric delta: "${m.delta}"`);
      }
    }
  }

  // 6. Body text too long for chart layouts
  if (chartLayouts.includes(slide.layoutId) && slide.body && slide.body.length > 200) {
    issues.push(`Body text too long for ${slide.layoutId} (${slide.body.length} chars, max 200)`);
  }

  // 7. Too many bullets
  if (slide.bullets && slide.bullets.length > 5) {
    issues.push(`Too many bullets (${slide.bullets.length}, max 5)`);
  }

  // Only kill truly broken slides (3+ issues). 1-2 issues = degraded but keep.
  // A slide with a chart but missing callout is still better than no slide.
  const pass = issues.length <= 2;

  return { position: slide.position, pass, issues };
}

/**
 * Filter slides: remove those that fail quality gate.
 * Always keep: cover (position 1), exec-summary, and at least the last slide.
 * Minimum 3 slides output.
 */
export function filterSlidesByQuality<T extends { position: number; layoutId?: string; layout_id?: string }>(
  slides: T[],
  qualityResults: SlideQualityResult[],
): T[] {
  const failedPositions = new Set(
    qualityResults.filter((r) => !r.pass).map((r) => r.position),
  );

  // Protected positions: first slide (cover), second slide (exec-summary), last slide
  const protectedPositions = new Set([
    slides[0]?.position,
    slides[1]?.position,
    slides[slides.length - 1]?.position,
  ]);

  const filtered = slides.filter((s) => {
    if (protectedPositions.has(s.position)) return true; // always keep
    return !failedPositions.has(s.position);
  });

  // Minimum 3 slides
  if (filtered.length < 3) return slides;

  return filtered;
}
