import assert from "node:assert/strict";

import {
  canonicalizeUrl,
  hashContent,
  hashUrl,
} from "../packages/research/src/dedupe";
import {
  DAY_4_FIRECRAWL_USD_CAP,
  DAY_4_SMOKE_BUDGET,
  checkBudget,
  creditsToUsd,
  newCostAccumulator,
  recordCost,
} from "../packages/research/src/budget";
import {
  scrapeToEvidenceRef,
  type SourceCatalogScrape,
} from "../packages/research/src/evidence-adapter";
import type { SourceCatalogEntry } from "../packages/research/src/types";

/**
 * Day 4 unit tests for the research fetcher's pure building blocks:
 * dedupe, budget, evidence-adapter. The fetcher itself exercises live
 * network via the smoke harness; these tests stay offline and cover
 * the deterministic layers.
 */

// ── dedupe ──────────────────────────────────────────────────────────

function testDedupeHandlesBasicCanonicalization() {
  assert.equal(
    canonicalizeUrl("https://Example.com/path/"),
    "https://example.com/path",
    "lowercase host plus trailing slash strip",
  );
  assert.equal(
    canonicalizeUrl("https://mark-up.it/news/1?utm_source=x&utm_medium=y"),
    "https://mark-up.it/news/1",
    "utm_* stripped",
  );
  assert.equal(
    canonicalizeUrl("https://mark-up.it/news/1?page=2"),
    "https://mark-up.it/news/1?page=2",
    "non-analytics params preserved",
  );
  assert.equal(
    canonicalizeUrl("https://mark-up.it/news/1#section"),
    "https://mark-up.it/news/1",
    "fragment dropped",
  );
}

function testHashUrlDeterministic() {
  const a = hashUrl("https://mark-up.it/articoli/snack");
  const b = hashUrl("https://mark-up.it/articoli/snack/?utm_source=x");
  assert.equal(a, b, "analytics params must not change the url_hash");
  assert.equal(a.length, 64, "SHA-256 hex should be 64 chars");
}

function testHashContentDeterministic() {
  const a = hashContent("# Title\n\nContent body\n\nShare this article\n");
  const b = hashContent("# Title\n\nContent body\n");
  assert.equal(a, b, "boilerplate trim should normalize both strings to the same hash");
  const c = hashContent("# Different content\n");
  assert.notEqual(a, c, "distinct content must produce distinct hashes");
}

function testHashUrlRejectsGarbage() {
  assert.throws(() => canonicalizeUrl("not a url"), /Invalid URL|invalid/i);
}

// ── budget ─────────────────────────────────────────────────────────

function testBudgetWithinEnvelope() {
  const acc = newCostAccumulator();
  const verdict = checkBudget({
    accumulator: acc,
    proposedUrls: 3,
    proposedFirecrawlUsd: 0.01,
    proposedFiberUsd: 0,
    budget: DAY_4_SMOKE_BUDGET,
    firecrawlCap: DAY_4_FIRECRAWL_USD_CAP,
  });
  assert.equal(verdict.status, "within_budget");
}

function testBudgetMaxUrlsCap() {
  const acc = newCostAccumulator();
  recordCost(acc, { urlsFetched: 14 });
  const verdict = checkBudget({
    accumulator: acc,
    proposedUrls: 3,
    proposedFirecrawlUsd: 0.001,
    proposedFiberUsd: 0,
    budget: DAY_4_SMOKE_BUDGET,
    firecrawlCap: DAY_4_FIRECRAWL_USD_CAP,
  });
  assert.equal(verdict.status, "cap_hit");
  if (verdict.status === "cap_hit") {
    assert.equal(verdict.reason, "max_urls");
  }
}

function testBudgetFirecrawlCap() {
  const acc = newCostAccumulator();
  recordCost(acc, { firecrawlUsd: 0.29 });
  const verdict = checkBudget({
    accumulator: acc,
    proposedUrls: 1,
    proposedFirecrawlUsd: 0.05,
    proposedFiberUsd: 0,
    budget: DAY_4_SMOKE_BUDGET,
    firecrawlCap: DAY_4_FIRECRAWL_USD_CAP,
  });
  assert.equal(verdict.status, "cap_hit");
  if (verdict.status === "cap_hit") {
    assert.equal(verdict.reason, "max_firecrawl_usd");
  }
}

function testBudgetTotalCap() {
  const acc = newCostAccumulator();
  recordCost(acc, { firecrawlUsd: 0.2, fiberUsd: 0.25 });
  const verdict = checkBudget({
    accumulator: acc,
    proposedUrls: 1,
    proposedFirecrawlUsd: 0,
    proposedFiberUsd: 0.1,
    budget: DAY_4_SMOKE_BUDGET,
    firecrawlCap: DAY_4_FIRECRAWL_USD_CAP,
  });
  assert.equal(verdict.status, "cap_hit");
  if (verdict.status === "cap_hit") {
    assert.equal(verdict.reason, "max_total_usd");
  }
}

function testCreditsToUsd() {
  assert.equal(creditsToUsd(10, 0.001), 0.01);
  assert.equal(creditsToUsd(0, 0.0063), 0);
}

// ── evidence-adapter ────────────────────────────────────────────────

function buildFixtureSource(): SourceCatalogEntry {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    workspaceId: "15cc947e-70cb-455a-b0df-d8c34b760d71",
    url: "https://mark-up.it",
    host: "mark-up.it",
    tier: 1,
    language: "it",
    sourceType: "trade_press",
    domainTags: ["gdo", "retail"],
    crawlPatterns: {},
    trustScore: 90,
    status: "active",
  };
}

function buildFixtureScrape(override: Partial<SourceCatalogScrape> = {}): SourceCatalogScrape {
  return {
    url: "https://mark-up.it/articoli/snack-salati-2026",
    urlHash: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd",
    contentHash: "def456def456def456def456def456def456def456def456def456def456dee0",
    title: "Snack salati Italia 2026 trend",
    publishedAt: new Date("2026-03-15T10:00:00Z"),
    contentMarkdown: "# Snack salati\n\nArticolo di prova.\n",
    language: "it",
    fetchedAt: new Date("2026-04-23T14:00:00Z"),
    ...override,
  };
}

function testEvidenceRefShape() {
  const source = buildFixtureSource();
  const scrape = buildFixtureScrape();
  const ref = scrapeToEvidenceRef(scrape, source);
  assert.equal(ref.id, `firecrawl:${scrape.urlHash}`);
  assert.equal(ref.sourceFileId, source.id);
  assert.equal(ref.fileName, scrape.url);
  assert.equal(ref.fileRole, `tier${source.tier}-${source.sourceType}`);
  assert.equal(ref.sheet, source.host);
  assert.equal(ref.metric, "scraped_article");
  assert.equal(ref.summary, scrape.title);
  assert.equal(ref.confidence, 0.9);
  assert.equal(ref.sourceLocation, scrape.url);
  assert.equal(ref.rawValue, scrape.contentMarkdown);
  assert.equal(ref.derivedTable, null);
  assert.equal(ref.dimensions.language, source.language);
  assert.equal(ref.dimensions.published_at, "2026-03-15T10:00:00.000Z");
  assert.equal(ref.dimensions.tier, "1");
  assert.equal(ref.dimensions.source_type, "trade_press");
  assert.equal(ref.dimensions.domain_tags, "gdo,retail");
  assert.equal(ref.dimensions.content_hash, scrape.contentHash);
}

function testEvidenceRefSummaryFallsBackToFirstLine() {
  const source = buildFixtureSource();
  const scrape = buildFixtureScrape({
    title: null,
    contentMarkdown: "# Headline\n\nReal first paragraph that should become the summary.\n",
  });
  const ref = scrapeToEvidenceRef(scrape, source);
  assert.equal(ref.summary, "Real first paragraph that should become the summary.");
}

function testEvidenceRefConfidenceClampedFromTrustScore() {
  const source: SourceCatalogEntry = { ...buildFixtureSource(), trustScore: 120 };
  const scrape = buildFixtureScrape();
  const ref = scrapeToEvidenceRef(scrape, source);
  assert.equal(ref.confidence, 1, "confidence must clamp to [0,1] even on a corrupt trust_score");
}

function testEvidenceRefIdFormatGraphVsFirecrawl() {
  const source = buildFixtureSource();
  const scrape = buildFixtureScrape();
  const ref = scrapeToEvidenceRef(scrape, source);
  assert.match(ref.id, /^firecrawl:/, "scraped refs use firecrawl: prefix per spec §5.4");
}

// ── main ───────────────────────────────────────────────────────────

function main() {
  testDedupeHandlesBasicCanonicalization();
  testHashUrlDeterministic();
  testHashContentDeterministic();
  testHashUrlRejectsGarbage();

  testBudgetWithinEnvelope();
  testBudgetMaxUrlsCap();
  testBudgetFirecrawlCap();
  testBudgetTotalCap();
  testCreditsToUsd();

  testEvidenceRefShape();
  testEvidenceRefSummaryFallsBackToFirstLine();
  testEvidenceRefConfidenceClampedFromTrustScore();
  testEvidenceRefIdFormatGraphVsFirecrawl();

  console.log("research fetcher: dedupe + budget + evidence-adapter ok");
}

main();
