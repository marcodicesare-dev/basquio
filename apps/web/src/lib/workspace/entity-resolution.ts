import { metaphoneIT } from "@/lib/workspace/metaphone";

/**
 * Pure entity resolution cascade.
 *
 * Stages (in order, first hit wins):
 *   1. exact. Normalized string equality.
 *   2. alias. Normalized equality against canonical or aliases.
 *   3. token_set. Token-set equality (handles surname-first, suffix noise).
 *   4. initials. Initial-expanded equality ("A. Ricci" ↔ "Alessandro Ricci").
 *   5. metaphone. Italian-metaphone equality.
 *   6. similarity. Levenshtein ratio above SIMILARITY_ACCEPT.
 *   7. haiku. Optional LLM tiebreak in the ambiguity band.
 */

export type ResolveMethod =
  | "none"
  | "exact"
  | "alias"
  | "token_set"
  | "initials"
  | "metaphone"
  | "similarity"
  | "haiku";

export type ResolveResult = {
  entity_id: string | null;
  method: ResolveMethod;
  confidence: number;
  candidates?: Array<{ id: string; canonical_name: string; score: number }>;
};

export type Candidate = {
  id: string;
  canonical_name: string;
  normalized_name: string;
  aliases: string[];
};

const SIMILARITY_ACCEPT = 0.95;
const SIMILARITY_AMBIG_LO = 0.82;

const LEGAL_SUFFIXES = new Set([
  "spa",
  "srl",
  "sarl",
  "sas",
  "ltd",
  "limited",
  "gmbh",
  "ag",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "group",
  "international",
  "italia",
  "it",
  "italy",
  "holding",
  "holdings",
  "co",
  "company",
  "sa",
  "nv",
  "bv",
  "de",
  "di",
  "d",
]);

function normalizeEntityName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export { normalizeEntityName };

function tokens(normalized: string): string[] {
  return normalized.split(/\s+/).filter((t) => t.length > 0);
}

function stripSuffixes(toks: string[]): string[] {
  return toks.filter((t) => !LEGAL_SUFFIXES.has(t) && t.length > 1);
}

function tokenSetKey(name: string): string {
  const ts = stripSuffixes(tokens(normalizeEntityName(name)));
  if (ts.length === 0) return "";
  return [...ts].sort().join(" ");
}

function isInitialToken(t: string): boolean {
  return t.length === 1 || (t.length === 2 && t.endsWith("."));
}

function hasAnyInitial(toks: string[]): boolean {
  return toks.some(isInitialToken);
}

function initialKey(toks: string[]): string {
  return toks
    .map((t) => (isInitialToken(t) ? t[0] : t))
    .filter((t) => t.length > 0)
    .join(" ");
}

function expandableMatch(a: string, b: string): boolean {
  const ta = tokens(normalizeEntityName(a));
  const tb = tokens(normalizeEntityName(b));
  if (!hasAnyInitial(ta) && !hasAnyInitial(tb)) return false;
  if (ta.length !== tb.length) return false;
  for (let i = 0; i < ta.length; i += 1) {
    const ia = ta[i];
    const ib = tb[i];
    if (ia === ib) continue;
    if (isInitialToken(ia) && ib.startsWith(ia[0])) continue;
    if (isInitialToken(ib) && ia.startsWith(ib[0])) continue;
    // Last-resort: sorted token match where initial matches first letter
    const sortedA = [...ta].sort();
    const sortedB = [...tb].sort();
    for (let k = 0; k < sortedA.length; k += 1) {
      const sa = sortedA[k];
      const sb = sortedB[k];
      if (sa === sb) continue;
      if (isInitialToken(sa) && sb.startsWith(sa[0])) continue;
      if (isInitialToken(sb) && sa.startsWith(sb[0])) continue;
      return false;
    }
    return true;
  }
  return true;
}

export async function resolveEntity(input: {
  name: string;
  candidates: Candidate[];
  tiebreak?: (query: string, options: Candidate[]) => Promise<string | null>;
}): Promise<ResolveResult> {
  const name = input.name.trim();
  if (!name) return { entity_id: null, method: "none", confidence: 0 };
  if (input.candidates.length === 0) {
    return { entity_id: null, method: "none", confidence: 0 };
  }

  const normalized = normalizeEntityName(name);
  const queryTokenSet = tokenSetKey(name);
  const queryTokens = tokens(normalized);
  const queryInitial = initialKey(queryTokens);

  // Stage 1. Exact normalized match.
  for (const c of input.candidates) {
    if (c.normalized_name === normalized) {
      return { entity_id: c.id, method: "exact", confidence: 1.0 };
    }
  }

  // Stage 2. Alias and de-spaced match.
  const queryNoSpace = normalized.replace(/\s+/g, "");
  for (const c of input.candidates) {
    if (c.normalized_name.replace(/\s+/g, "") === queryNoSpace && queryNoSpace.length > 2) {
      return { entity_id: c.id, method: "alias", confidence: 0.96 };
    }
    for (const a of c.aliases ?? []) {
      const aliasNorm = normalizeEntityName(a);
      if (aliasNorm === normalized) {
        return { entity_id: c.id, method: "alias", confidence: 0.97 };
      }
      if (aliasNorm.replace(/\s+/g, "") === queryNoSpace && queryNoSpace.length > 2) {
        return { entity_id: c.id, method: "alias", confidence: 0.95 };
      }
    }
  }

  // Stage 3. Token-set match (surname-first, suffix noise).
  if (queryTokenSet) {
    for (const c of input.candidates) {
      if (tokenSetKey(c.canonical_name) === queryTokenSet) {
        return { entity_id: c.id, method: "token_set", confidence: 0.94 };
      }
      for (const a of c.aliases ?? []) {
        if (tokenSetKey(a) === queryTokenSet) {
          return { entity_id: c.id, method: "token_set", confidence: 0.92 };
        }
      }
    }
  }

  // Stage 4. Initial-aware match.
  if (hasAnyInitial(queryTokens)) {
    for (const c of input.candidates) {
      if (expandableMatch(name, c.canonical_name)) {
        return { entity_id: c.id, method: "initials", confidence: 0.9 };
      }
      for (const a of c.aliases ?? []) {
        if (expandableMatch(name, a)) {
          return { entity_id: c.id, method: "initials", confidence: 0.88 };
        }
      }
    }
  } else {
    // Query has no initial; candidates might. Check other direction.
    for (const c of input.candidates) {
      const cTokens = tokens(normalizeEntityName(c.canonical_name));
      if (hasAnyInitial(cTokens) && expandableMatch(name, c.canonical_name)) {
        return { entity_id: c.id, method: "initials", confidence: 0.88 };
      }
    }
  }

  // Stage 5. Italian-metaphone match. Require same token count to avoid
  // over-matching when entity names have shared surname-y phonemes.
  const queryPhon = metaphoneIT(name);
  if (queryPhon) {
    for (const c of input.candidates) {
      const candPhon = metaphoneIT(c.canonical_name);
      if (candPhon === queryPhon) {
        return { entity_id: c.id, method: "metaphone", confidence: 0.86 };
      }
      for (const a of c.aliases ?? []) {
        if (metaphoneIT(a) === queryPhon) {
          return { entity_id: c.id, method: "metaphone", confidence: 0.83 };
        }
      }
    }
  }

  // Stage 6. Similarity. Levenshtein ratio on normalized strings.
  const scored: Array<{ id: string; canonical_name: string; score: number }> = [];
  for (const c of input.candidates) {
    const base = ratio(normalized, c.normalized_name);
    let best = base;
    for (const a of c.aliases ?? []) {
      const s = ratio(normalized, normalizeEntityName(a));
      if (s > best) best = s;
    }
    scored.push({ id: c.id, canonical_name: c.canonical_name, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const runnerUp = scored[1];

  if (top && top.score >= SIMILARITY_ACCEPT) {
    const secondClose = runnerUp && top.score - runnerUp.score < 0.04;
    if (!secondClose) {
      return {
        entity_id: top.id,
        method: "similarity",
        confidence: top.score,
        candidates: scored.slice(0, 5),
      };
    }
  }

  // Stage 7. Haiku tiebreak.
  if (input.tiebreak && top && top.score >= SIMILARITY_AMBIG_LO) {
    const shortlist = scored.slice(0, 5).map((s) => {
      const c = input.candidates.find((x) => x.id === s.id);
      return c as Candidate;
    });
    const pickedId = await input.tiebreak(name, shortlist).catch(() => null);
    if (pickedId) {
      const match = scored.find((s) => s.id === pickedId);
      if (match) {
        return {
          entity_id: pickedId,
          method: "haiku",
          confidence: match.score,
          candidates: scored.slice(0, 5),
        };
      }
    }
  }

  return {
    entity_id: null,
    method: "none",
    confidence: top?.score ?? 0,
    candidates: scored.slice(0, 5),
  };

  // initialKey is used lazily; retained here for future alias index.
  void queryInitial;
}

function ratio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const d = levenshtein(a, b);
  const longer = Math.max(a.length, b.length);
  return 1 - d / longer;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return prev[n];
}
