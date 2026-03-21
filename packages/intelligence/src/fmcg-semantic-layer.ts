// ─── FMCG SEMANTIC LAYER & QUESTION ROUTER ────────────────────────
// Executable domain logic replacing prompt-text knowledge.
// Zero LLM cost. Pure functions. Deterministic.

// ─── TYPES ────────────────────────────────────────────────────────

export type FmcgDomain = "rms" | "cps" | "price_promo" | "innovation" | "mixed";
export type FmcgGrain = "market" | "brand" | "segment" | "retailer" | "channel" | "sku" | "time";

export type FmcgMeasure =
  | "value" | "volume" | "units"
  | "share_value" | "share_volume"
  | "distribution" | "velocity" | "ros"
  | "price" | "price_index"
  | "promo_intensity" | "baseline" | "incremental"
  | "penetration" | "frequency" | "basket_size" | "loyalty"
  | "trial" | "repeat" | "incrementality"
  | "growth_value" | "growth_volume"
  | "share_change" | "mix_pct" | "mix_gap";

// ─── DERIVED METRIC PROGRAMS ──────────────────────────────────────
// Executable transformations, not analyst instructions

export type DerivedMetricProgram = {
  id: string;
  name: string;
  formula: string;
  requires: string[];
  produces: FmcgMeasure;
  compute: (inputs: Record<string, number>) => number;
};

export const DERIVED_METRICS: DerivedMetricProgram[] = [
  {
    id: "value_growth_pct",
    name: "Value Growth %",
    formula: "(cy_value - py_value) / py_value * 100",
    requires: ["cy_value", "py_value"],
    produces: "growth_value",
    compute: ({ cy_value, py_value }) => py_value === 0 ? 0 : ((cy_value - py_value) / py_value) * 100,
  },
  {
    id: "volume_growth_pct",
    name: "Volume Growth %",
    formula: "(cy_volume - py_volume) / py_volume * 100",
    requires: ["cy_volume", "py_volume"],
    produces: "growth_volume",
    compute: ({ cy_volume, py_volume }) => py_volume === 0 ? 0 : ((cy_volume - py_volume) / py_volume) * 100,
  },
  {
    id: "value_share_pct",
    name: "Value Share %",
    formula: "brand_value / total_value * 100",
    requires: ["brand_value", "total_value"],
    produces: "share_value",
    compute: ({ brand_value, total_value }) => total_value === 0 ? 0 : (brand_value / total_value) * 100,
  },
  {
    id: "share_change_pts",
    name: "Share Change (pts)",
    formula: "share_cy - share_py",
    requires: ["share_cy", "share_py"],
    produces: "share_change",
    compute: ({ share_cy, share_py }) => share_cy - share_py,
  },
  {
    id: "avg_price",
    name: "Average Price per Unit",
    formula: "value / units",
    requires: ["value", "units"],
    produces: "price",
    compute: ({ value, units }) => units === 0 ? 0 : value / units,
  },
  {
    id: "price_index",
    name: "Price Index vs Category",
    formula: "(brand_price / category_price) * 100",
    requires: ["brand_price", "category_price"],
    produces: "price_index",
    compute: ({ brand_price, category_price }) => category_price === 0 ? 100 : (brand_price / category_price) * 100,
  },
  {
    id: "mix_pct",
    name: "Mix %",
    formula: "segment_value / total_value * 100",
    requires: ["segment_value", "total_value"],
    produces: "mix_pct",
    compute: ({ segment_value, total_value }) => total_value === 0 ? 0 : (segment_value / total_value) * 100,
  },
  {
    id: "mix_gap_pp",
    name: "Mix Gap (pp)",
    formula: "brand_mix - category_mix",
    requires: ["brand_mix", "category_mix"],
    produces: "mix_gap",
    compute: ({ brand_mix, category_mix }) => brand_mix - category_mix,
  },
  {
    id: "promo_lift",
    name: "Promo Lift",
    formula: "incremental / baseline",
    requires: ["incremental", "baseline"],
    produces: "promo_intensity",
    compute: ({ incremental, baseline }) => baseline === 0 ? 0 : incremental / baseline,
  },
  {
    id: "ros_value",
    name: "Value ROS (Rate of Sale)",
    formula: "value / stores / weeks",
    requires: ["value", "stores", "weeks"],
    produces: "ros",
    compute: ({ value, stores, weeks }) => (stores * weeks) === 0 ? 0 : value / (stores * weeks),
  },
  {
    id: "penetration_growth_pct",
    name: "Penetration Growth %",
    formula: "(pen_cy - pen_py) / pen_py * 100",
    requires: ["pen_cy", "pen_py"],
    produces: "penetration",
    compute: ({ pen_cy, pen_py }) => pen_py === 0 ? 0 : ((pen_cy - pen_py) / pen_py) * 100,
  },
  {
    id: "dupont_value",
    name: "Value (DuPont Decomposition)",
    formula: "penetration * frequency * basket_size * price",
    requires: ["penetration", "frequency", "basket_size", "price"],
    produces: "value",
    compute: ({ penetration, frequency, basket_size, price }) => penetration * frequency * basket_size * price,
  },
];

// ─── QUESTION ROUTER ──────────────────────────────────────────────

export type QuestionRoute = {
  id: string;
  name: string;
  patterns: RegExp[];
  domain: FmcgDomain;
  requiredEvidence: string[];
  allowedChartFamilies: string[];
  diagnosticMotifs: string[];
  recommendationLevers: string[];
};

export const QUESTION_ROUTES: QuestionRoute[] = [
  {
    id: "share_loss",
    name: "Share Loss Analysis",
    patterns: [/los(ing|t|e)\s+share/i, /share\s+(declin|eros|loss|drop)/i, /quota\s+(in\s+calo|persa|diminui)/i, /perdiamo\s+quota/i],
    domain: "rms",
    requiredEvidence: ["value_share_pct", "share_change_pts", "value_growth_pct"],
    allowedChartFamilies: ["ranked_share_bar", "cy_vs_py_grouped", "trend_line"],
    diagnosticMotifs: ["share_erosion", "velocity_problem", "hero_concentration"],
    recommendationLevers: ["distribution_expansion", "hero_renovation", "portfolio_rebalancing"],
  },
  {
    id: "distribution_gap",
    name: "Distribution Gap Analysis",
    patterns: [/under[- ]?distribut/i, /distribution\s+(gap|opportunit)/i, /where\s+(should|can)\s+.*distribut/i, /distribuzione\s+(mancante|gap)/i],
    domain: "rms",
    requiredEvidence: ["distribution", "velocity", "ros_value"],
    allowedChartFamilies: ["dist_vs_velocity_scatter", "ranked_share_bar"],
    diagnosticMotifs: ["availability_problem"],
    recommendationLevers: ["distribution_expansion"],
  },
  {
    id: "promo_dependence",
    name: "Promo Dependence Analysis",
    patterns: [/promo(tion)?\s+(depend|relian|intensit|effect)/i, /over[- ]?promot/i, /promozione\s+(dipendenz|efficac)/i, /troppa\s+promo/i],
    domain: "price_promo",
    requiredEvidence: ["promo_intensity", "baseline", "incremental"],
    allowedChartFamilies: ["promo_baseline_stack", "trend_line"],
    diagnosticMotifs: ["promo_dependence"],
    recommendationLevers: ["promo_optimization", "pricing"],
  },
  {
    id: "portfolio_mismatch",
    name: "Portfolio Mix Analysis",
    patterns: [/mix\s+(gap|mismatch|wrong|imbalanc)/i, /portfolio\s+(review|analys|mismatch)/i, /portafoglio\s+(sbilanciat|analisi|mix)/i],
    domain: "rms",
    requiredEvidence: ["mix_pct", "mix_gap_pp", "value_growth_pct"],
    allowedChartFamilies: ["mix_comparison_stack", "ranked_share_bar"],
    diagnosticMotifs: ["portfolio_mismatch"],
    recommendationLevers: ["portfolio_rebalancing", "tail_pruning"],
  },
  {
    id: "innovation_potential",
    name: "Innovation / Launch Assessment",
    patterns: [/launch\s+(new|product|sku)/i, /should\s+(i|we)\s+launch/i, /innovation\s+(potenti|pipeline|assess)/i, /lanciare\s+(un\s+)?nuovo/i],
    domain: "innovation",
    requiredEvidence: ["trial", "repeat", "incrementality"],
    allowedChartFamilies: ["kpi_delta_card", "ranked_share_bar"],
    diagnosticMotifs: [],
    recommendationLevers: ["pack_architecture", "distribution_expansion"],
  },
  {
    id: "price_tension",
    name: "Pricing Strategy Analysis",
    patterns: [/pric(e|ing)\s+(strateg|tension|posit|index|gap)/i, /price\s+vs/i, /prezzo\s+(strate|posizion|indice|gap)/i],
    domain: "rms",
    requiredEvidence: ["price", "price_index", "value_growth_pct"],
    allowedChartFamilies: ["cy_vs_py_grouped", "ranked_share_bar"],
    diagnosticMotifs: ["price_mix_tension"],
    recommendationLevers: ["pricing", "pack_architecture"],
  },
  {
    id: "hero_concentration",
    name: "SKU Concentration Risk",
    patterns: [/hero\s+(concentrat|depend|risk)/i, /sku\s+(concentrat|depend|risk)/i, /top\s+\d+\s+sku/i, /concentrazione\s+(sku|prodotti|hero)/i],
    domain: "rms",
    requiredEvidence: ["value_share_pct", "value_growth_pct"],
    allowedChartFamilies: ["hero_concentration_pareto", "ranked_share_bar"],
    diagnosticMotifs: ["hero_concentration"],
    recommendationLevers: ["hero_renovation", "tail_pruning"],
  },
  {
    id: "channel_strategy",
    name: "Channel Strategy (Discount Focus)",
    patterns: [/discount\s+(channel|strateg|grow)/i, /channel\s+(strateg|mix|perform)/i, /canale\s+(discount|strateg)/i, /crescere\s+(nel|in)\s+discount/i],
    domain: "mixed",
    requiredEvidence: ["share_value", "price_index", "distribution"],
    allowedChartFamilies: ["ranked_share_bar", "cy_vs_py_grouped"],
    diagnosticMotifs: ["price_mix_tension", "availability_problem"],
    recommendationLevers: ["pricing", "distribution_expansion", "pack_architecture"],
  },
  {
    id: "category_review",
    name: "Full Category Performance Review",
    patterns: [/category\s+(review|perform|analys|overview)/i, /full\s+(review|analys)/i, /analisi\s+(categori|mercato|performance)/i, /come\s+(sta|va)\s+(il\s+)?(mercato|categori)/i],
    domain: "mixed",
    requiredEvidence: ["value", "share_value", "growth_value", "distribution", "price"],
    allowedChartFamilies: ["ranked_share_bar", "cy_vs_py_grouped", "mix_comparison_stack", "trend_line", "kpi_delta_card"],
    diagnosticMotifs: ["share_erosion", "availability_problem", "velocity_problem", "promo_dependence", "portfolio_mismatch", "hero_concentration"],
    recommendationLevers: ["distribution_expansion", "pricing", "pack_architecture", "promo_optimization", "portfolio_rebalancing", "hero_renovation"],
  },
  {
    id: "competitive_response",
    name: "Competitive Response",
    patterns: [/compet(itor|itive)\s+(respon|threat|action|analys)/i, /respond\s+to\s+compet/i, /concorrenz(a|e)\s+(rispost|analisi|minaccia)/i],
    domain: "mixed",
    requiredEvidence: ["share_value", "share_change", "growth_value", "price_index"],
    allowedChartFamilies: ["ranked_share_bar", "cy_vs_py_grouped", "trend_line"],
    diagnosticMotifs: ["share_erosion", "price_mix_tension"],
    recommendationLevers: ["pricing", "distribution_expansion", "hero_renovation"],
  },
];

// ─── ROUTING FUNCTION ─────────────────────────────────────────────

export function routeQuestion(brief: string, availableMeasures: string[] = []): QuestionRoute[] {
  const briefLower = brief.toLowerCase();
  const matches: Array<{ route: QuestionRoute; score: number }> = [];

  for (const route of QUESTION_ROUTES) {
    let score = 0;
    for (const pattern of route.patterns) {
      if (pattern.test(brief)) {
        score += 10;
      }
    }
    // Boost if available measures match required evidence
    for (const req of route.requiredEvidence) {
      if (availableMeasures.some(m => m.toLowerCase().includes(req.replace(/_/g, " ")) || m.toLowerCase().includes(req))) {
        score += 2;
      }
    }
    // Boost for domain keywords
    if (route.domain === "rms" && /share|distribut|price|volume|value|quota|distribuz|prezzo/i.test(briefLower)) score += 3;
    if (route.domain === "cps" && /penetrat|loyalty|basket|frequency|consumer|panel|acquist/i.test(briefLower)) score += 3;
    if (route.domain === "price_promo" && /promo|baseline|incremental|elasticit|prezzo/i.test(briefLower)) score += 3;
    if (route.domain === "innovation" && /launch|innovation|new\s+product|trial|repeat|lanci|innov/i.test(briefLower)) score += 3;

    if (score > 0) {
      matches.push({ route, score });
    }
  }

  // If nothing matched, default to category_review
  if (matches.length === 0) {
    const categoryReview = QUESTION_ROUTES.find(r => r.id === "category_review");
    if (categoryReview) return [categoryReview];
  }

  return matches.sort((a, b) => b.score - a.score).map(m => m.route);
}

// ─── DERIVATIVE DISCOVERY ─────────────────────────────────────────

export function getRequiredDerivatives(route: QuestionRoute, availableColumns: string[]): DerivedMetricProgram[] {
  const colsLower = availableColumns.map(c => c.toLowerCase());
  const applicable: DerivedMetricProgram[] = [];

  for (const metric of DERIVED_METRICS) {
    // Check if the route needs this metric's output
    if (!route.requiredEvidence.includes(metric.produces)) continue;

    // Check if the inputs are available in the data
    const hasAllInputs = metric.requires.every(req => {
      const reqLower = req.toLowerCase().replace(/_/g, " ");
      return colsLower.some(c =>
        c.includes(reqLower) ||
        c.includes(req.replace(/_/g, ".")) ||
        c.includes(req)
      );
    });

    if (hasAllInputs) {
      applicable.push(metric);
    }
  }

  return applicable;
}

// ─── EVIDENCE VALIDATION ──────────────────────────────────────────

export function validateSlideEvidence(
  slideTitle: string,
  requiredEvidence: string[],
  computedEvidenceIds: string[],
): { valid: boolean; missing: string[]; coverage: number } {
  const evidenceLower = computedEvidenceIds.map(e => e.toLowerCase());
  const missing: string[] = [];

  for (const req of requiredEvidence) {
    const found = evidenceLower.some(e =>
      e.includes(req.replace(/_/g, "-")) ||
      e.includes(req.replace(/_/g, " ")) ||
      e.includes(req)
    );
    if (!found) missing.push(req);
  }

  const coverage = requiredEvidence.length === 0
    ? 1
    : (requiredEvidence.length - missing.length) / requiredEvidence.length;

  return { valid: missing.length === 0, missing, coverage };
}

// ─── RECOMMENDATION LEVERS ────────────────────────────────────────

export type RecommendationLever = {
  id: string;
  name: string;
  template_en: string;
  template_it: string;
  requiredFields: string[];
};

export const RECOMMENDATION_LEVERS: RecommendationLever[] = [
  {
    id: "distribution_expansion",
    name: "Distribution Expansion",
    template_en: "List {sku} in {retailer} to capture {value}",
    template_it: "Listare {sku} in {retailer} per catturare {value}",
    requiredFields: ["sku", "retailer", "value"],
  },
  {
    id: "pack_architecture",
    name: "Pack Architecture",
    template_en: "Launch {format} targeting {segment} at {price} price point",
    template_it: "Lanciare {format} per il segmento {segment} al prezzo di {price}",
    requiredFields: ["format", "segment", "price"],
  },
  {
    id: "promo_optimization",
    name: "Promo Optimization",
    template_en: "Shift {pct}% of promo spend from {from_channel} to {to_channel}",
    template_it: "Spostare {pct}% dell'investimento promo da {from_channel} a {to_channel}",
    requiredFields: ["pct", "from_channel", "to_channel"],
  },
  {
    id: "portfolio_rebalancing",
    name: "Portfolio Rebalancing",
    template_en: "Increase {segment} mix from {from_pct}% to {to_pct}%",
    template_it: "Aumentare il mix {segment} da {from_pct}% a {to_pct}%",
    requiredFields: ["segment", "from_pct", "to_pct"],
  },
  {
    id: "hero_renovation",
    name: "Hero Renovation",
    template_en: "Refresh {sku} packaging to recover {pts}pp of velocity",
    template_it: "Rinnovare il packaging di {sku} per recuperare {pts}pp di rotazione",
    requiredFields: ["sku", "pts"],
  },
  {
    id: "tail_pruning",
    name: "Tail Pruning",
    template_en: "Delist bottom {n} SKUs to fund {action}",
    template_it: "Delistare i {n} SKU a peggior performance per finanziare {action}",
    requiredFields: ["n", "action"],
  },
  {
    id: "pricing",
    name: "Pricing Strategy",
    template_en: "Reposition price index to {target} vs category (currently {current})",
    template_it: "Riposizionare l'indice prezzo a {target} vs categoria (attuale {current})",
    requiredFields: ["target", "current"],
  },
  {
    id: "channel_strategy",
    name: "Channel Strategy",
    template_en: "Develop {channel}-specific assortment with {n} SKUs at {price_point}",
    template_it: "Sviluppare assortimento {channel} con {n} SKU al prezzo di {price_point}",
    requiredFields: ["channel", "n", "price_point"],
  },
];

export function getLeversForRoute(routeId: string): RecommendationLever[] {
  const route = QUESTION_ROUTES.find(r => r.id === routeId);
  if (!route) return [];
  return RECOMMENDATION_LEVERS.filter(l => route.recommendationLevers.includes(l.id));
}
