import { normalizeLabel } from "./fidelity/helpers";
import type {
  FidelitySheetInput,
  FidelitySlideInput,
  FidelityViolation,
} from "./fidelity/types";

export function validateRequiredDeltaColumns(
  slide: FidelitySlideInput,
  sheet?: FidelitySheetInput,
): FidelityViolation[] {
  if (!sheet || sheet.headers.length === 0) {
    return [];
  }

  const normalizedHeaders = sheet.headers.map(normalizeLabel);
  const hasQuota = normalizedHeaders.some((header) => header.includes("quota") || header.includes("share"));
  const hasPrice = normalizedHeaders.some((header) => header.includes("prezzo") || header.includes("price"));
  const hasQuotaDelta = normalizedHeaders.some((header) =>
    (header.includes("quota") || header.includes("share")) &&
    (header.includes("delta") || header.includes("var") || header.includes("pp")),
  );
  const hasPriceDelta = normalizedHeaders.some((header) =>
    (header.includes("prezzo") || header.includes("price")) &&
    (header.includes("delta") || header.includes("var") || header.includes("%")),
  );

  const violations: FidelityViolation[] = [];
  if (hasQuota && !hasQuotaDelta) {
    violations.push({
      rule: "missing_delta_quota",
      severity: "major",
      position: slide.position,
      message: `Sheet ${sheet.name} shows share/quota but omits a delta quota column.`,
    });
  }
  if (hasPrice && !hasPriceDelta) {
    violations.push({
      rule: "missing_delta_price",
      severity: "major",
      position: slide.position,
      message: `Sheet ${sheet.name} shows price but omits a delta price column.`,
    });
  }

  return violations;
}
