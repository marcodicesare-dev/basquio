/**
 * Humanize pending memory candidates so an analyst sees prose, not JSON.
 *
 * Background: Francesco's Apr 30 2026 feedback flagged that the pending queue
 * rendered candidates as `JSON.stringify(content, null, 2)` which "looks like
 * SQL". SOTA pattern (Glean, Granola, Notion AI) renders extracted facts as a
 * single declarative sentence with subject + object as visually distinct
 * chips and a verbal-hedge confidence label.
 *
 * For a CPG analyst tool with a known fixed set of predicates a hand-written
 * predicate-to-template map beats neural verbalization (deterministic, zero
 * latency, zero cost). New predicates fall back to a generic renderer that
 * reads "X has Y for Z" instead of dumping JSON.
 *
 * This file is server-and-client safe (pure functions, no I/O).
 */

import type { MemoryCandidateKind } from "@/lib/workspace/candidates";

export type FactPayload = {
  predicate?: string;
  subject_entity_name?: string;
  subject_entity_type?: string;
  object_entity_name?: string | null;
  object_entity_type?: string | null;
  object_value?: unknown;
  valid_from?: string | null;
  valid_to?: string | null;
};

export type FormattedCandidate = {
  /** One-line declarative sentence in the analyst's local language. */
  headline: string;
  /** Optional second-line metadata (date range, source). */
  detail: string | null;
  /** Verbal hedge for confidence: "Very likely", "Likely", "Possibly". */
  confidenceLabel: string;
  /** Numeric percent for tooltip / accessibility. */
  confidencePercent: number;
};

/**
 * Predicate templates. Subject + object are passed as positional arguments,
 * sentence is in Italian by default to match Marco's audience. New
 * predicates extracted by the model fall through to the generic verbalizer.
 *
 * Each template returns the part of the sentence AFTER the subject, so the
 * caller composes "{subject} {template(object)}".
 */
const PREDICATE_TEMPLATES_IT: Record<
  string,
  (object: string | null, value?: unknown) => string
> = {
  manages_account: (obj) => `gestisce l'account ${obj ?? "(?)"}`,
  works_at: (obj) => `lavora in ${obj ?? "(?)"}`,
  reports_to: (obj) => `riporta a ${obj ?? "(?)"}`,
  role_at: (obj, val) => {
    const role = typeof val === "string" ? val : extractValueLabel(val);
    return obj ? `ricopre il ruolo di ${role ?? "(?)"} in ${obj}` : `ricopre il ruolo di ${role ?? "(?)"}`;
  },
  prefers: (obj, val) => {
    const what = typeof val === "string" ? val : extractValueLabel(val);
    return what ? `preferisce ${what}` : `preferisce ${obj ?? "(?)"}`;
  },
  speaks_language: (_obj, val) => {
    const lang = typeof val === "string" ? val : extractValueLabel(val);
    return `parla ${lang ?? "(?)"}`;
  },
  brand_owned_by: (obj) => `è di proprietà di ${obj ?? "(?)"}`,
  competitor_of: (obj) => `compete con ${obj ?? "(?)"}`,
  category_of: (obj) => `appartiene alla categoria ${obj ?? "(?)"}`,
  distributed_in: (obj) => `è distribuito da ${obj ?? "(?)"}`,
  market_share_pct: (_obj, val) => {
    const v = extractValueLabel(val);
    return v ? `ha quota di mercato ${v}%` : "ha una quota di mercato";
  },
  share_value_pct: (_obj, val) => {
    const v = extractValueLabel(val);
    return v ? `ha quota a valore ${v}%` : "ha una quota a valore";
  },
  rms_skus_in_panel: (_obj, val) => {
    const v = extractValueLabel(val);
    return v ? `ha ${v} SKU nel panel RMS` : "ha referenze nel panel RMS";
  },
  parent_brand: (obj) => `è una sotto-marca di ${obj ?? "(?)"}`,
  stakeholder_of: (obj, val) => {
    const role = typeof val === "string" ? val : extractValueLabel(val);
    return obj && role ? `è ${role} di ${obj}` : `è uno stakeholder${obj ? ` di ${obj}` : ""}`;
  },
  headquartered_in: (_obj, val) => {
    if (val && typeof val === "object") {
      const v = val as Record<string, unknown>;
      const city = typeof v.city === "string" ? v.city : null;
      const country = typeof v.country === "string" ? v.country : null;
      if (city && country) return `ha sede a ${city}, ${country}`;
      if (city) return `ha sede a ${city}`;
      if (country) return `ha sede in ${country}`;
    }
    return "ha sede";
  },
};

const PREDICATE_TEMPLATES_EN: Record<
  string,
  (object: string | null, value?: unknown) => string
> = {
  manages_account: (obj) => `manages the ${obj ?? "(?)"} account`,
  works_at: (obj) => `works at ${obj ?? "(?)"}`,
  reports_to: (obj) => `reports to ${obj ?? "(?)"}`,
  role_at: (obj, val) => {
    const role = typeof val === "string" ? val : extractValueLabel(val);
    return obj ? `is ${role ?? "(?)"} at ${obj}` : `is ${role ?? "(?)"}`;
  },
  prefers: (obj, val) => {
    const what = typeof val === "string" ? val : extractValueLabel(val);
    return what ? `prefers ${what}` : `prefers ${obj ?? "(?)"}`;
  },
  speaks_language: (_obj, val) => {
    const lang = typeof val === "string" ? val : extractValueLabel(val);
    return `speaks ${lang ?? "(?)"}`;
  },
  brand_owned_by: (obj) => `is owned by ${obj ?? "(?)"}`,
  competitor_of: (obj) => `competes with ${obj ?? "(?)"}`,
  category_of: (obj) => `belongs to category ${obj ?? "(?)"}`,
  distributed_in: (obj) => `is distributed by ${obj ?? "(?)"}`,
  parent_brand: (obj) => `is a sub-brand of ${obj ?? "(?)"}`,
  stakeholder_of: (obj, val) => {
    const role = typeof val === "string" ? val : extractValueLabel(val);
    return obj && role ? `is the ${role} of ${obj}` : `is a stakeholder${obj ? ` of ${obj}` : ""}`;
  },
};

function extractValueLabel(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if ("value" in obj) {
      const parts: string[] = [String(obj.value ?? "")];
      if (obj.unit) parts.push(String(obj.unit));
      return parts.filter(Boolean).join(" ");
    }
  }
  return null;
}

function humanizePredicate(predicate: string): string {
  return predicate.replace(/_/g, " ");
}

function verbalConfidence(confidence: number): string {
  if (confidence >= 0.9) return "Very likely";
  if (confidence >= 0.75) return "Likely";
  if (confidence >= 0.55) return "Possibly";
  return "Tentative";
}

function verbalConfidenceIt(confidence: number): string {
  if (confidence >= 0.9) return "Molto probabile";
  if (confidence >= 0.75) return "Probabile";
  if (confidence >= 0.55) return "Possibile";
  return "Da verificare";
}

function formatFactSentence(
  fact: FactPayload,
  locale: "en" | "it",
): string {
  const subject = fact.subject_entity_name?.trim() || "(soggetto sconosciuto)";
  const predicate = (fact.predicate ?? "").trim();
  const object = fact.object_entity_name?.trim() || null;
  const value = fact.object_value;

  const templates = locale === "it" ? PREDICATE_TEMPLATES_IT : PREDICATE_TEMPLATES_EN;
  const template = templates[predicate];
  if (template) {
    return `${subject} ${template(object, value)}`;
  }

  // Generic fallback: subject + humanized predicate + object/value.
  const verb = humanizePredicate(predicate || "is related to");
  const objLabel = object ?? extractValueLabel(value);
  if (objLabel) return `${subject} ${verb} ${objLabel}`;
  return `${subject} ${verb}`;
}

function formatRuleSentence(payload: Record<string, unknown>, locale: "en" | "it"): string {
  const text = typeof payload.text === "string" ? payload.text : null;
  const ruleText = typeof payload.rule_text === "string" ? payload.rule_text : null;
  return text ?? ruleText ?? (locale === "it" ? "Regola senza testo" : "Untitled rule");
}

function formatPreferenceSentence(payload: Record<string, unknown>, locale: "en" | "it"): string {
  const subject = typeof payload.subject_entity_name === "string"
    ? payload.subject_entity_name
    : (locale === "it" ? "Stakeholder" : "Stakeholder");
  const value = extractValueLabel(payload.object_value) ?? extractValueLabel(payload.value);
  const aspect = typeof payload.aspect === "string" ? payload.aspect : null;
  if (aspect && value) {
    return locale === "it"
      ? `${subject} preferisce ${aspect}: ${value}`
      : `${subject} prefers ${aspect}: ${value}`;
  }
  if (value) {
    return locale === "it" ? `${subject} preferisce ${value}` : `${subject} prefers ${value}`;
  }
  return locale === "it" ? `${subject} ha una preferenza` : `${subject} has a preference`;
}

function formatAliasSentence(payload: Record<string, unknown>, locale: "en" | "it"): string {
  const canonical = typeof payload.canonical_name === "string" ? payload.canonical_name : null;
  const alias = typeof payload.alias === "string" ? payload.alias : null;
  if (canonical && alias) {
    return locale === "it"
      ? `«${alias}» è un altro nome di ${canonical}`
      : `"${alias}" is another name for ${canonical}`;
  }
  return locale === "it" ? "Alias proposto" : "Proposed alias";
}

function formatEntitySentence(payload: Record<string, unknown>, locale: "en" | "it"): string {
  const name = typeof payload.canonical_name === "string"
    ? payload.canonical_name
    : (typeof payload.name === "string" ? payload.name : null);
  const type = typeof payload.type === "string" ? payload.type : null;
  if (name && type) {
    return locale === "it"
      ? `Nuova entità ${humanizePredicate(type)}: ${name}`
      : `New ${humanizePredicate(type)}: ${name}`;
  }
  return locale === "it" ? "Nuova entità da confermare" : "New entity to confirm";
}

function formatDateRange(from: unknown, to: unknown, locale: "en" | "it"): string | null {
  const fromIso = typeof from === "string" ? from : null;
  const toIso = typeof to === "string" ? to : null;
  if (!fromIso && !toIso) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "it" ? "it-IT" : "en-US", {
      month: "short",
      year: "numeric",
    });
  if (fromIso && toIso) return `${fmt(fromIso)} → ${fmt(toIso)}`;
  if (fromIso) return locale === "it" ? `Dal ${fmt(fromIso)}` : `From ${fmt(fromIso)}`;
  if (toIso) return locale === "it" ? `Fino al ${fmt(toIso)}` : `Until ${fmt(toIso)}`;
  return null;
}

export function formatCandidate(input: {
  kind: MemoryCandidateKind;
  content: unknown;
  confidence: number;
  locale?: "en" | "it";
}): FormattedCandidate {
  const locale = input.locale ?? "it";
  const content = (input.content ?? {}) as Record<string, unknown>;
  let headline: string;
  let detail: string | null = null;

  switch (input.kind) {
    case "fact":
      headline = formatFactSentence(content as FactPayload, locale);
      detail = formatDateRange(content.valid_from, content.valid_to, locale);
      break;
    case "rule":
      headline = formatRuleSentence(content, locale);
      break;
    case "preference":
      headline = formatPreferenceSentence(content, locale);
      break;
    case "alias":
      headline = formatAliasSentence(content, locale);
      break;
    case "entity":
      headline = formatEntitySentence(content, locale);
      break;
    default:
      headline = locale === "it" ? "Candidato non riconosciuto" : "Unknown candidate";
  }

  return {
    headline,
    detail,
    confidenceLabel:
      locale === "it" ? verbalConfidenceIt(input.confidence) : verbalConfidence(input.confidence),
    confidencePercent: Math.round(input.confidence * 100),
  };
}
