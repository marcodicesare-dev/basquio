export type PublishedDeliveryStatus = "reviewed" | "degraded";

export function resolvePublishedDeliveryStatus(qaReport: {
  passed?: unknown;
  tier?: unknown;
  qualityPassport?: { classification?: unknown } | null;
}): PublishedDeliveryStatus {
  const classification = qaReport.qualityPassport?.classification;

  if (qaReport.passed === true) {
    return qaReport.tier === "green" && classification !== "bronze" && classification !== "recovery"
      ? "reviewed"
      : "degraded";
  }

  if (qaReport.passed === false) {
    return "degraded";
  }

  if (qaReport.tier === "green") {
    return classification === "bronze" || classification === "recovery" ? "degraded" : "reviewed";
  }

  if (qaReport.tier === "yellow" || qaReport.tier === "red") {
    return "degraded";
  }

  // Older report shapes may not include tier/passed; preserve historical
  // reviewed status only for explicitly strong quality-passport grades.
  if (classification === "gold" || classification === "silver") {
    return "reviewed";
  }

  return "degraded";
}
