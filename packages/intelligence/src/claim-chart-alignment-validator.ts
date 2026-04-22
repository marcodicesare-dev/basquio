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

  return violations;
}

function containsAny(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(normalizeLabel(token)));
}
