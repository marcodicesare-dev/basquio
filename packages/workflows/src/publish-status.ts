export type PublishedDeliveryStatus = "reviewed" | "degraded";

export function resolvePublishedDeliveryStatus(qaReport: {
  passed?: unknown;
  tier?: unknown;
  qualityPassport?: { classification?: unknown } | null;
}): PublishedDeliveryStatus {
  if (qaReport.passed === true) {
    return "reviewed";
  }

  // Older report shapes may not include `passed`; yellow means the hard
  // artifact gate passed and only internal advisories remain.
  if (qaReport.tier === "green" || qaReport.tier === "yellow") {
    return "reviewed";
  }

  const classification = qaReport.qualityPassport?.classification;
  if (classification === "gold" || classification === "silver") {
    return "reviewed";
  }

  return "degraded";
}
