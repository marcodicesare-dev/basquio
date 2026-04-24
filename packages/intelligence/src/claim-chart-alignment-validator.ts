import {
  normalizeLabel,
} from "./fidelity/helpers";
import type {
  FidelitySheetInput,
  FidelitySlideInput,
  FidelityViolation,
} from "./fidelity/types";

const ROTATION_TOKENS = ["rotation", "rotazioni", "rotazione", "ros", "velocity", "productivity", "produttiv"];
const PRICE_TOKENS = ["price", "prezzo", "pricing", "inflation", "inflazione", "price-led", "guidato da prezzo"];
const DISTRIBUTION_TOKENS = ["distribution", "distribuzione", "wd", "weighted distribution", "numeric distribution", "availability", "listings"];
const PROMO_DISTRIBUTION_TOKENS = [
  "wd promo",
  "wd_promo",
  "wdpromo",
  "dp promo",
  "weighted distribution any promo",
  "weighted distribution promo",
];
const COMM_IN_STORE_TOKENS = [
  "comm in store",
  "comm. in store",
  "communication in store",
];
const PRODUCTIVITY_PROOF_TOKENS = [
  ...ROTATION_TOKENS,
  "sales per point",
  "value per distribution point",
  "fair share",
  "fair-share",
];

export function validateClaimChartAlignment(
  slide: FidelitySlideInput,
  sheet?: FidelitySheetInput,
): FidelityViolation[] {
  if (!slide.chart || !sheet) {
    return [];
  }

  const text = normalizeLabel([
    slide.title,
    slide.body ?? "",
    ...(slide.bullets ?? []),
    slide.callout?.text ?? "",
    slide.pageIntent ?? "",
  ].join(" "));
  const chartText = normalizeLabel([
    slide.chart.title ?? "",
    slide.chart.xAxisLabel ?? "",
    slide.chart.yAxisLabel ?? "",
    ...sheet.headers,
  ].join(" "));

  const violations: FidelityViolation[] = [];
  const talksAboutRotation = containsAny(text, ROTATION_TOKENS);
  const chartShowsRotation = containsAny(chartText, PRODUCTIVITY_PROOF_TOKENS);
  if (talksAboutRotation && !chartShowsRotation) {
    violations.push({
      rule: "claim_chart_metric_mismatch",
      severity: "major",
      position: slide.position,
      message: "Slide claims a rotation/productivity issue, but the linked chart data does not show rotation, ROS, or another productivity metric.",
    });
  }

  const talksAboutPriceMechanics = containsAny(text, PRICE_TOKENS);
  const chartShowsPriceMechanics = containsAny(chartText, PRICE_TOKENS) || (
    containsAny(chartText, ["value", "valore"]) && containsAny(chartText, ["volume", "volumi"])
  );
  if (talksAboutPriceMechanics && !chartShowsPriceMechanics) {
    violations.push({
      rule: "claim_chart_metric_mismatch",
      severity: "major",
      position: slide.position,
      message: "Slide commentary says the story is price-led, but the hero chart does not show price mechanics or value-vs-volume decomposition.",
    });
  }

  const talksAboutDistributionOpportunity = /\b(opportunity|opportunit[àa]|expand|increase|gain|bridge)\b/.test(text)
    && containsAny(text, DISTRIBUTION_TOKENS);
  const chartShowsDistribution = containsAny(chartText, DISTRIBUTION_TOKENS);
  const chartShowsProductivityProof = containsAny(chartText, PRODUCTIVITY_PROOF_TOKENS);
  if (talksAboutDistributionOpportunity && (!chartShowsDistribution || !chartShowsProductivityProof)) {
    violations.push({
      rule: "distribution_claim_without_productivity_proof",
      severity: "major",
      position: slide.position,
      message: "Distribution opportunity claim lacks direct productivity proof in the linked chart data. Show distribution plus rotation/ROS/productivity evidence.",
    });
  }

  const talksAboutPromoDistribution = containsAny(text, PROMO_DISTRIBUTION_TOKENS);
  const chartShowsPromoDistribution = containsAny(chartText, PROMO_DISTRIBUTION_TOKENS);
  if (talksAboutPromoDistribution && !chartShowsPromoDistribution) {
    violations.push({
      rule: "claim_chart_metric_mismatch",
      severity: "major",
      position: slide.position,
      message: "Slide commentary mentions WD Promo or DP promo, but the linked chart data does not show a promo distribution metric.",
    });
  }

  const talksAboutCommunicationMechanic = containsAny(text, COMM_IN_STORE_TOKENS);
  const chartShowsCommunicationMechanic = containsAny(chartText, COMM_IN_STORE_TOKENS);
  if (talksAboutCommunicationMechanic && !chartShowsCommunicationMechanic) {
    violations.push({
      rule: "claim_chart_metric_mismatch",
      severity: "major",
      position: slide.position,
      message: "Slide commentary mentions Communication In Store, but the linked chart data does not show that promo mechanic.",
    });
  }

  return violations;
}

function containsAny(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(normalizeLabel(token)));
}
