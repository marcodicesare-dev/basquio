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

// ─── NIQ-SAFE EXHIBIT LIBRARY ────────────────────────────────────
// Deterministic exhibit families for the NielsenIQ / FMCG wedge.
// Each family defines: when to use, required data fields, allowed title forms,
// allowed callout forms, and how to highlight the focal brand.
// The author picks from this menu — no improvisation.

export type NiqExhibitFamily = {
  id: string;
  name: string;
  questionTypes: QuestionType[];
  chartType: ExhibitType;
  requiredDimensions: string[];  // Column roles needed (e.g., "brand", "period")
  requiredMeasures: string[];    // Measure types needed (e.g., "sales_value", "share")
  titlePattern: string;          // Template: "{focal} {verb} {metric} {comparison}"
  calloutPattern: string;        // Template for the "now what" action
  highlightRule: "focal_amber" | "top_n" | "diverging" | "none";
  maxCategories: number;
  sortRule: "desc" | "asc" | "natural" | "none";
};

export const NIQ_EXHIBIT_FAMILIES: NiqExhibitFamily[] = [
  {
    id: "ranked_share_bar",
    name: "Ranked Share Bar",
    questionTypes: ["sizing", "ranking"],
    chartType: "horizontal_bar",
    requiredDimensions: ["brand"],
    requiredMeasures: ["sales_value"],
    titlePattern: "{focal} ranks #{rank} with {value} ({share} share) in {market}",
    calloutPattern: "Expand distribution of {focal} in {channel} to close {gap} gap",
    highlightRule: "focal_amber",
    maxCategories: 12,
    sortRule: "desc",
  },
  {
    id: "cy_vs_py_grouped",
    name: "Current vs Prior Year Grouped Bar",
    questionTypes: ["comparison"],
    chartType: "grouped_bar",
    requiredDimensions: ["brand"],
    requiredMeasures: ["sales_value", "sales_value_py"],
    titlePattern: "{focal} {grew/declined} {delta}% while {competitor} {grew/declined} {delta}%",
    calloutPattern: "{action} to {recover/sustain} {metric} momentum",
    highlightRule: "focal_amber",
    maxCategories: 8,
    sortRule: "desc",
  },
  {
    id: "pvm_waterfall",
    name: "Price Volume Mix Waterfall",
    questionTypes: ["bridge"],
    chartType: "waterfall",
    requiredDimensions: [],
    requiredMeasures: ["sales_value", "sales_value_py", "sales_volume", "sales_volume_py"],
    titlePattern: "Revenue bridge: {driver1} and {driver2} drive {direction} of {delta}",
    calloutPattern: "{primary_lever} accounts for {pct}% of the {direction} — {action}",
    highlightRule: "diverging",
    maxCategories: 8,
    sortRule: "none",
  },
  {
    id: "mix_comparison_stack",
    name: "Mix / Composition Stacked Bar",
    questionTypes: ["composition"],
    chartType: "stacked_bar_100",
    requiredDimensions: ["segment"],
    requiredMeasures: ["sales_value"],
    titlePattern: "{focal} over-indexed in {segment1} ({pct1}% vs category {pct2}%)",
    calloutPattern: "Rebalance portfolio: grow {underweight_segment} from {current}% to {target}%",
    highlightRule: "focal_amber",
    maxCategories: 6,
    sortRule: "none",
  },
  {
    id: "trend_line",
    name: "Trend Line (4+ Periods)",
    questionTypes: ["trend"],
    chartType: "line",
    requiredDimensions: ["period"],
    requiredMeasures: ["sales_value"],
    titlePattern: "{focal} {metric} {trend_direction} {delta}% over {period_count} periods",
    calloutPattern: "If trend continues, {focal} will {projection} by {date}",
    highlightRule: "focal_amber",
    maxCategories: 52,
    sortRule: "natural",
  },
  {
    id: "dist_vs_velocity_scatter",
    name: "Distribution vs Velocity Scatter",
    questionTypes: ["correlation"],
    chartType: "scatter",
    requiredDimensions: ["product"],
    requiredMeasures: ["weighted_distribution", "ros_value"],
    titlePattern: "{count} high-velocity SKUs under-distributed by {gap}+ pts vs portfolio",
    calloutPattern: "List {sku1} and {sku2} at {retailer} to capture {value}",
    highlightRule: "focal_amber",
    maxCategories: 20,
    sortRule: "none",
  },
  {
    id: "hero_concentration_pareto",
    name: "Hero Concentration Pareto",
    questionTypes: ["concentration"],
    chartType: "pareto",
    requiredDimensions: ["product"],
    requiredMeasures: ["sales_value"],
    titlePattern: "Top {n} SKUs account for {pct}% of {focal} value — hero risk",
    calloutPattern: "Renovate {declining_hero} and prune bottom {n} SKUs to fund growth",
    highlightRule: "top_n",
    maxCategories: 15,
    sortRule: "desc",
  },
  {
    id: "promo_baseline_stack",
    name: "Promo vs Baseline Stacked Bar",
    questionTypes: ["composition", "comparison"],
    chartType: "stacked_bar",
    requiredDimensions: ["brand"],
    requiredMeasures: ["baseline_value", "promo_value"],
    titlePattern: "{focal} promo intensity at {pct}% — {above/below} category average of {cat_pct}%",
    calloutPattern: "Shift {amount} from promo to baseline growth via {lever}",
    highlightRule: "focal_amber",
    maxCategories: 8,
    sortRule: "desc",
  },
  {
    id: "kpi_delta_card",
    name: "KPI Delta Card (Flat Market)",
    questionTypes: ["flat"],
    chartType: "kpi_card",
    requiredDimensions: [],
    requiredMeasures: ["sales_value"],
    titlePattern: "{market} flat at {value} — {focal} {gained/lost} {delta} pts share",
    calloutPattern: "Focus on {lever}: {specific_action} to capture {value}",
    highlightRule: "none",
    maxCategories: 0,
    sortRule: "none",
  },
];

// ─── MEASURE NORMALIZATION ───────────────────────────────────────
// Maps any column name form (raw Italian, canonical English, snake_case ID)
// to a set of snake_case measure IDs for exhibit family matching.
// This is the bridge between what the data has and what families require.

const MEASURE_NORMALIZE_MAP: Array<{ pattern: RegExp; ids: string[] }> = [
  // Sales value
  { pattern: /sales.?value|v\.?\s*valore|revenue|turnover/i, ids: ["sales_value"] },
  { pattern: /sales.?value.*py|v\.?\s*valore.*anno\s*prec|sales.?value.*prior/i, ids: ["sales_value_py"] },
  // Sales volume
  { pattern: /sales.?volume|v\.?\s*\(all\)|volume.*cy/i, ids: ["sales_volume"] },
  { pattern: /sales.?volume.*py|v\.?\s*\(all\).*anno\s*prec/i, ids: ["sales_volume_py"] },
  // Sales units
  { pattern: /sales.?units|v\.?\s*confezioni|packs/i, ids: ["sales_units"] },
  // Share
  { pattern: /value.?share|quota.*val/i, ids: ["value_share"] },
  { pattern: /share.?change|var\.?\s*ass.*quota/i, ids: ["share_change"] },
  // Price
  { pattern: /avg.?price|prezzo.?medio|average.?price/i, ids: ["avg_price"] },
  { pattern: /price.?index|idx.*pr/i, ids: ["price_index"] },
  // Distribution
  { pattern: /weighted.?dist|distr\.?\s*pond/i, ids: ["weighted_distribution"] },
  { pattern: /numeric.?dist|distr\.?\s*num/i, ids: ["numeric_distribution"] },
  // ROS / Velocity
  { pattern: /rate.?of.?sales|ros|rotazioni|velocity/i, ids: ["ros_value"] },
  // Promotion
  { pattern: /promo.*value|promo.*sales|any.?promo.*val/i, ids: ["promo_value"] },
  { pattern: /baseline.*value|baseline.*sales|no.?promo.*val/i, ids: ["baseline_value"] },
  { pattern: /promo.*intensity|promo.*int.*idx/i, ids: ["promo_intensity"] },
  // Growth / Change
  { pattern: /growth|var\.?\s*%|change.*%|yoy/i, ids: ["growth_pct"] },
];

/**
 * Normalize a list of column names (any form) to snake_case measure IDs.
 * Accepts: raw Italian ("V. Valore"), canonical English ("Sales Value (CY)"),
 * or already-normalized snake_case ("sales_value").
 * Deterministic, $0 cost.
 */
function normalizeMeasureIds(columnNames: string[]): Set<string> {
  const ids = new Set<string>();
  for (const col of columnNames) {
    const lower = col.toLowerCase().trim();
    // Direct match (already snake_case)
    if (/^[a-z_]+$/.test(lower)) {
      ids.add(lower);
    }
    // Pattern match
    for (const { pattern, ids: matchIds } of MEASURE_NORMALIZE_MAP) {
      if (pattern.test(col)) {
        for (const id of matchIds) ids.add(id);
      }
    }
  }
  return ids;
}

// ─── DIMENSION ROLE NORMALIZATION ──────────────────────────────
// Maps column names (Italian, English, snake_case) to semantic dimension roles.
// This is the bridge between what the data has and what families require.

const DIMENSION_NORMALIZE_MAP: Array<{ pattern: RegExp; role: string }> = [
  { pattern: /brand|marca|marchio|manufacturer|produttore/i, role: "brand" },
  { pattern: /period|periodo|year|anno|quarter|trimestre|month|mese|week|settimana|date|data/i, role: "period" },
  { pattern: /segment|segmento|category|categoria|subcategory|sotto.?cat/i, role: "segment" },
  { pattern: /product|prodotto|sku|item|articolo|ean|barcode/i, role: "product" },
  { pattern: /channel|canale|retailer|insegna|customer|cliente/i, role: "channel" },
  { pattern: /region|regione|area|geography|territorio/i, role: "region" },
];

function normalizeDimensionRoles(columnNames: string[]): Set<string> {
  const roles = new Set<string>();
  for (const col of columnNames) {
    for (const { pattern, role } of DIMENSION_NORMALIZE_MAP) {
      if (pattern.test(col)) roles.add(role);
    }
  }
  return roles;
}

/**
 * Find the best NIQ exhibit family for a given question type and available data.
 * Accepts column names in any form: raw Italian, canonical English, or snake_case.
 * Now validates BOTH measures AND dimensions for accurate matching.
 * Returns the family and whether it's a confident match.
 * Deterministic, $0 cost.
 */
export function findBestExhibitFamily(
  questionType: QuestionType,
  availableMeasures: string[],
  availableDimensions?: string[],
): { family: NiqExhibitFamily | null; confidence: "high" | "medium" | "low" } {
  const normalizedIds = normalizeMeasureIds(availableMeasures);
  const normalizedDims = availableDimensions ? normalizeDimensionRoles(availableDimensions) : null;

  const candidates = NIQ_EXHIBIT_FAMILIES.filter(f =>
    f.questionTypes.includes(questionType)
  );

  if (candidates.length === 0) return { family: null, confidence: "low" };

  // Score by how many required measures + dimensions are in the normalized sets
  const scored = candidates.map(f => {
    const measureMatched = f.requiredMeasures.filter(m => normalizedIds.has(m)).length;
    const measureTotal = f.requiredMeasures.length;
    const measureScore = measureTotal === 0 ? 1 : measureMatched / measureTotal;

    // Dimension score (if dimensions provided and family requires them)
    let dimScore = 1;
    if (normalizedDims && f.requiredDimensions.length > 0) {
      const dimMatched = f.requiredDimensions.filter(d => normalizedDims.has(d)).length;
      dimScore = dimMatched / f.requiredDimensions.length;
    }

    // Combined: 70% measures, 30% dimensions
    const score = measureScore * 0.7 + dimScore * 0.3;
    return { family: f, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const confidence = best.score >= 0.8 ? "high" : best.score >= 0.5 ? "medium" : "low";
  return { family: best.family, confidence };
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
