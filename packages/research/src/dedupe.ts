/**
 * Deduplication hashes for scraped articles.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §5.3.
 * Two hashes, each with a different job:
 *
 *   url_hash:     "did we already scrape this URL in the last 24 hours?"
 *                 Normalizes trailing slashes, lowercases host, strips
 *                 query-string analytics noise. Keys the scrape-cost cache.
 *   content_hash: "is this the same article republished under a different
 *                 URL?" Hashes the markdown body so a mirror on a second
 *                 domain produces a cache hit even though its url_hash
 *                 differs.
 *
 * Both hashes are SHA-256 hex, 64 chars. Supabase pg_crypto is NOT used
 * here because the hash is computed before the row inserts; we want a
 * client-side deterministic value so the dedupe check is a plain SELECT
 * by hash.
 */

import { createHash } from "node:crypto";

const ANALYTICS_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "ref",
  "ref_src",
]);

/**
 * Normalize a URL to a stable canonical form for dedupe.
 * - Lowercase the host.
 * - Drop the fragment (#...).
 * - Strip common analytics query keys (utm_*, gclid, fbclid, etc.) but
 *   keep other query parameters that might change the response (e.g.,
 *   ?page=2, ?lang=it).
 * - Collapse a trailing slash on the path (`/news/` and `/news` map
 *   to the same hash).
 * - Keep scheme, port, path segments otherwise untouched.
 *
 * Throws on malformed URLs so callers can skip them rather than
 * producing a garbage hash.
 */
export function canonicalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const params = [...url.searchParams.entries()].filter(
    ([k]) => !ANALYTICS_QUERY_KEYS.has(k.toLowerCase()),
  );
  url.search = "";
  for (const [k, v] of params) url.searchParams.append(k, v);
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
    url.pathname = path;
  }
  return url.toString();
}

export function hashUrl(rawUrl: string): string {
  const canonical = canonicalizeUrl(rawUrl);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Content-hash strategy: normalize whitespace (collapse runs of
 * whitespace to single spaces, trim leading/trailing), drop common
 * boilerplate patterns that differ between mirrors (e.g., "Share this
 * article" lines), then SHA-256 the result.
 *
 * Does NOT attempt fuzzy near-duplicate detection. Two articles that
 * share >95% text but differ in a date stamp will produce different
 * content_hashes. Upgrading to simhash or embedding similarity is a v2
 * job per spec §10 R4.
 */
export function hashContent(markdown: string): string {
  const normalized = normalizeForContentHash(markdown);
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizeForContentHash(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !isBoilerplate(line))
    .join("\n")
    .trim();
}

function isBoilerplate(line: string): boolean {
  const l = line.toLowerCase();
  if (!l) return false;
  // Narrow list of article-boilerplate patterns. Stays conservative so
  // we do not mistakenly trim real content. Update cautiously.
  return (
    l === "share this article" ||
    l === "share this post" ||
    l === "leggi anche" ||
    l === "potrebbe interessarti" ||
    l === "related posts" ||
    l === "continue reading" ||
    l === "advertisement" ||
    /^cookie(s)? (notice|policy|preferences)/.test(l)
  );
}
