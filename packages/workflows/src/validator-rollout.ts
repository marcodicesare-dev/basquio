export type DataPrimacyValidatorMode = "off" | "warn" | "block-hero";
export type CitationFidelityValidatorMode = "off" | "warn" | "block";

export function resolveDataPrimacyValidatorMode(
  raw = process.env.BASQUIO_DATA_PRIMACY_VALIDATOR_MODE,
): DataPrimacyValidatorMode {
  const normalized = (raw ?? "warn").trim().toLowerCase();
  if (normalized === "off" || normalized === "warn" || normalized === "block-hero") {
    return normalized;
  }
  if (normalized === "block") {
    return "block-hero";
  }
  return "warn";
}

export function resolveCitationFidelityValidatorMode(
  raw = process.env.BASQUIO_CITATION_FIDELITY_VALIDATOR_MODE,
): CitationFidelityValidatorMode {
  const normalized = (raw ?? "warn").trim().toLowerCase();
  if (normalized === "off" || normalized === "warn" || normalized === "block") {
    return normalized;
  }
  if (normalized === "block-hero") {
    return "block";
  }
  return "warn";
}

export function shouldRunDataPrimacyDuringGeneration(mode: DataPrimacyValidatorMode) {
  return mode === "block-hero";
}

export function shouldRunCitationFidelityDuringGeneration(mode: CitationFidelityValidatorMode) {
  return mode === "block";
}
