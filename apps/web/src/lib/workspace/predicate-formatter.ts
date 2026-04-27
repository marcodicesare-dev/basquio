/**
 * Memory Inspector Facts tab humanization (Brief 7 PUSH 2).
 *
 * Predicates land in `facts.predicate` as snake_case engineer keys
 * because the deck pipeline + chat extractor write them that way.
 * Object payloads land as JSONB blobs in many shapes. The Facts tab
 * needs to read as a consultant artifact, not a database dump, while
 * power users still want the technical key reachable on hover.
 */

const PREDICATE_LABELS: Record<string, string> = {
  // Deck pipeline workbook evidence (deterministic packet fields).
  published_by: "published by",
  covers_category: "covers",
  covers_brand: "covers brand",
  covers_market: "covers market",
  item_rows_in_extract: "rows in extract",
  portfolio_item_rows_in_extract: "rows in portfolio extract",
  outlet_rows_in_extract: "rows in outlet extract",
  // Stakeholder / preference predicates.
  stakeholder_of: "stakeholder of",
  reports_to: "reports to",
  works_at: "works at",
  deck_output_preference: "deck preference",
  language_preference: "language preference",
  tone_preference: "tone preference",
  chart_preference: "chart preference",
  review_day: "review day",
  // Brand + entity relationships.
  owns: "owns",
  owned_by: "owned by",
  acquired: "acquired",
  acquired_by: "acquired by",
  launched: "launched",
  launched_by: "launched by",
  ships_in: "ships in",
  shipped_unit_count: "units shipped",
};

/**
 * Render a predicate as a short human phrase. Snake_case without an
 * explicit mapping falls back to a space-separated lowercase form.
 */
export function formatPredicate(predicate: string): string {
  if (!predicate) return "";
  const known = PREDICATE_LABELS[predicate];
  if (known) return known;
  return predicate.replace(/_/g, " ").toLowerCase();
}

/**
 * Best-effort one-sentence rendering of a fact's object_value column.
 * Recognised shapes (in priority order):
 *   { value, unit, file }   "{value} {unit} from {file}"
 *   { value, unit }         "{value} {unit}"
 *   { value, file }         "{value} from {file}"
 *   { value }               "{value}"
 *   { url }                 "{url}"
 *   string / number / bool  passthrough
 *   any other object        compact "key: value, key: value"
 */
export function formatFactObject(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return value
      .map((entry) => formatFactObject(entry))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;

  const valueField = obj.value ?? obj.amount ?? obj.count;
  const unit = typeof obj.unit === "string" ? obj.unit : null;
  const file = typeof obj.file === "string" ? obj.file : null;

  if (valueField !== undefined && unit && file) {
    return `${formatScalar(valueField)} ${unit} from ${file}`;
  }
  if (valueField !== undefined && unit) {
    return `${formatScalar(valueField)} ${unit}`;
  }
  if (valueField !== undefined && file) {
    return `${formatScalar(valueField)} from ${file}`;
  }
  if (valueField !== undefined) {
    return formatScalar(valueField);
  }
  if (typeof obj.url === "string") return obj.url;
  if (typeof obj.text === "string") return obj.text;

  const entries = Object.entries(obj).slice(0, 3);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${formatScalar(v)}`)
    .join(", ");
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toString();
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return JSON.stringify(value).slice(0, 60);
}

/**
 * Detect filename-shaped subject names. Examples that match:
 *   "Estrazione Item Pet 2025.csv"
 *   "Shifting Analysis - Product Template Guide"
 *   "Q3 Brief.pdf"
 * We treat a subject as a document when it has a known file extension
 * or matches the "Template / Guide / Extract / Brief" suffix vocabulary
 * the workspace uses.
 */
export function isDocumentLikeSubject(name: string): boolean {
  if (!name) return false;
  if (/\.(pdf|docx|pptx|xlsx|xls|csv|md|txt|json|yaml|yml|gsp)$/i.test(name)) return true;
  if (/\b(Guide|Template|Extract|Brief|Report|Memo|Deck)\b/i.test(name)) return true;
  return false;
}
