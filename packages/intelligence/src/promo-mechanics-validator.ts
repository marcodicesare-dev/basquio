import { normalizeLabel } from "./fidelity/helpers";
import type {
  FidelitySheetInput,
  FidelitySlideInput,
  FidelityViolation,
} from "./fidelity/types";

const COMM_IN_STORE_TOKENS = [
  "comm in store",
  "comm. in store",
  "communication in store",
];

const DISCOUNT_TIER_TOKENS = [
  "10<20",
  "20<30",
  "30<40",
  ">40",
  ">n%",
  "discount",
  "taglio prezzo",
  "price cut",
  "tpr",
];

const DISPLAY_TOKENS = ["display only", "display"];
const FOLDER_TOKENS = ["folder only", "folder", "leaflet", "volantino"];
const PROMO_DISTRIBUTION_TOKENS = [
  "wd promo",
  "wd_promo",
  "wdpromo",
  "dp promo",
  "weighted distribution any promo",
  "weighted distribution promo",
];

type MechanicFamily =
  | "discount_tier"
  | "display"
  | "folder"
  | "promo_distribution"
  | "comm_in_store";

export function validatePromoMechanicCoverage(
  slide: FidelitySlideInput,
  sheet?: FidelitySheetInput,
  sourceHeaders: string[] = [],
): FidelityViolation[] {
  if (!slide.chart || !sheet || sourceHeaders.length === 0) {
    return [];
  }

  const sourceText = normalizeLabel(sourceHeaders.join(" "));
  if (!containsAny(sourceText, COMM_IN_STORE_TOKENS)) {
    return [];
  }

  const chartText = normalizeLabel([
    slide.chart.title ?? "",
    slide.chart.xAxisLabel ?? "",
    slide.chart.yAxisLabel ?? "",
    ...sheet.headers,
  ].join(" "));
  const shownFamilies = collectMechanicFamilies(chartText);
  if (shownFamilies.size < 2 || shownFamilies.has("comm_in_store")) {
    return [];
  }

  return [{
    rule: "promo_mechanic_coverage_gap",
    severity: "major",
    position: slide.position,
    message: "Linked promo-mechanics exhibit omits Communication In Store even though that mechanic exists in the uploaded workbook. Add the communication series alongside discount, display, folder, or WD Promo mechanics.",
  }];
}

function collectMechanicFamilies(value: string) {
  const families = new Set<MechanicFamily>();

  if (containsAny(value, DISCOUNT_TIER_TOKENS)) {
    families.add("discount_tier");
  }
  if (containsAny(value, DISPLAY_TOKENS)) {
    families.add("display");
  }
  if (containsAny(value, FOLDER_TOKENS)) {
    families.add("folder");
  }
  if (containsAny(value, PROMO_DISTRIBUTION_TOKENS)) {
    families.add("promo_distribution");
  }
  if (containsAny(value, COMM_IN_STORE_TOKENS)) {
    families.add("comm_in_store");
  }

  return families;
}

function containsAny(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(normalizeLabel(token)));
}
