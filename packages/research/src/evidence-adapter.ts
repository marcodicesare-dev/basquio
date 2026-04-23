/**
 * Scraped-article to EvidenceRef adapter.
 *
 * Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §5.4.
 * Turns a `source_catalog_scrapes` row plus its parent `source_catalog`
 * row into an `EvidenceRef` that the deck pipeline's `rankInsights()`
 * validator accepts without modification.
 *
 * ID format: `firecrawl:<url_hash>` per spec §5.4. The `insights.ts`
 * validator (line 115-152) filters against a Set of ids derived from
 * `analyticsResult.evidenceRefs`; hallucinated urls Claude might
 * invent cannot enter that set, so unsupported citations are dropped
 * before the deck ships.
 */

import type { EvidenceRef, SourceCatalogEntry } from "./types";
import { evidenceRefSchema } from "./types";

export type SourceCatalogScrape = {
  url: string;
  urlHash: string;
  contentHash: string;
  title: string | null;
  publishedAt: Date | null;
  contentMarkdown: string;
  language: string | null;
  fetchedAt: Date;
};

export function scrapeToEvidenceRef(
  scrape: SourceCatalogScrape,
  source: Pick<
    SourceCatalogEntry,
    "id" | "host" | "tier" | "sourceType" | "language" | "domainTags" | "trustScore"
  >,
): EvidenceRef {
  const summary = buildSummary(scrape);
  const ref: EvidenceRef = {
    id: `firecrawl:${scrape.urlHash}`,
    sourceFileId: source.id,
    fileName: scrape.url,
    fileRole: `tier${source.tier}-${source.sourceType}`,
    sheet: source.host,
    metric: "scraped_article",
    summary,
    confidence: clamp01(source.trustScore / 100),
    sourceLocation: scrape.url,
    rawValue: scrape.contentMarkdown,
    derivedTable: null,
    dimensions: {
      language: source.language,
      published_at: scrape.publishedAt?.toISOString() ?? "unknown",
      tier: String(source.tier),
      source_type: source.sourceType,
      domain_tags: source.domainTags.join(","),
      fetched_at: scrape.fetchedAt.toISOString(),
      content_hash: scrape.contentHash,
    },
  };
  // Defensive: validate before the caller merges into
  // analyticsResult.evidenceRefs. A malformed ref reaching rankInsights()
  // would cause the insight to be silently dropped (empty evidenceRefIds
  // Set), which is worse than a loud parse failure here.
  return evidenceRefSchema.parse(ref);
}

/**
 * Materialize every scrape into its EvidenceRef in one pass. Logs
 * any scrape that fails schema validation and excludes it from the
 * returned array so one malformed row does not poison the batch.
 */
export function scrapesToEvidenceRefs(
  entries: Array<{ scrape: SourceCatalogScrape; source: SourceCatalogEntry }>,
  onInvalid?: (scrape: SourceCatalogScrape, error: Error) => void,
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const { scrape, source } of entries) {
    try {
      refs.push(scrapeToEvidenceRef(scrape, source));
    } catch (err) {
      onInvalid?.(scrape, err instanceof Error ? err : new Error(String(err)));
    }
  }
  return refs;
}

function buildSummary(scrape: SourceCatalogScrape): string {
  if (scrape.title && scrape.title.trim().length > 0) {
    return scrape.title.trim().slice(0, 240);
  }
  const firstLine = scrape.contentMarkdown
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#"));
  if (firstLine) return firstLine.slice(0, 240);
  return scrape.contentMarkdown.slice(0, 240).replace(/\s+/g, " ").trim();
}

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
