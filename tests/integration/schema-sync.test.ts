import { describe, expect, it } from "vitest";

import { evidenceRefSchema, type EvidenceRef } from "@basquio/research";

/**
 * Schema-sync contract test. The research package's `evidenceRefSchema`
 * must stay byte-parity with the inline `llmEvidenceRefSchema` in
 * `packages/intelligence/src/insights.ts:26-39`. If someone adds,
 * removes, or renames a field on either side, the fetcher's output
 * silently drops out of the deck pipeline's validator Set at
 * `rankInsights()` and insights cited against scraped evidence
 * disappear from the final deck.
 *
 * Ten fixtures cover the range of rawValue types, empty strings, empty
 * dimensions map, extreme confidence bounds, long content, and Unicode.
 * Every fixture must round-trip through `evidenceRefSchema.parse` and
 * produce the same object.
 */

const FIXTURES: EvidenceRef[] = [
  {
    id: "firecrawl:abc123",
    sourceFileId: "source-1",
    fileName: "https://mark-up.it/articoli/snack",
    fileRole: "tier1-trade_press",
    sheet: "mark-up.it",
    metric: "scraped_article",
    summary: "Snack salati trend 2026",
    confidence: 0.85,
    sourceLocation: "https://mark-up.it/articoli/snack",
    rawValue: "# Snack salati\n\nContent body.",
    derivedTable: null,
    dimensions: {
      language: "it",
      tier: "1",
      source_type: "trade_press",
    },
  },
  {
    id: "graph:fact:fact-42",
    sourceFileId: "doc-42",
    fileName: "kellanova-briefing.md",
    fileRole: "graph-fact",
    sheet: "knowledge-graph",
    metric: "supplies",
    summary: "Kellanova Italia supplies snack salati to Esselunga",
    confidence: 0.95,
    sourceLocation: "kellanova-briefing.md",
    rawValue: "snack salati",
    derivedTable: null,
    dimensions: { keyword: "kellanova", subject_entity: "entity-1" },
  },
  {
    id: "firecrawl:empty-summary",
    sourceFileId: "s",
    fileName: "f",
    fileRole: "r",
    sheet: "x",
    metric: "m",
    summary: "",
    confidence: 0,
    sourceLocation: "",
    rawValue: null,
    derivedTable: null,
    dimensions: {},
  },
  {
    id: "firecrawl:numeric-raw",
    sourceFileId: "s",
    fileName: "f",
    fileRole: "r",
    sheet: "x",
    metric: "m",
    summary: "numeric value",
    confidence: 1,
    sourceLocation: "loc",
    rawValue: 42.5,
    derivedTable: null,
    dimensions: { n: "1" },
  },
  {
    id: "firecrawl:boolean-raw",
    sourceFileId: "s",
    fileName: "f",
    fileRole: "r",
    sheet: "x",
    metric: "m",
    summary: "boolean",
    confidence: 0.5,
    sourceLocation: "loc",
    rawValue: true,
    derivedTable: null,
    dimensions: {},
  },
  {
    id: "firecrawl:unicode",
    sourceFileId: "s",
    fileName: "è.md",
    fileRole: "r",
    sheet: "à",
    metric: "ò",
    summary: "Mandarini italiani e israeliani",
    confidence: 0.7,
    sourceLocation: "https://freshplaza.it/articolo/ò",
    rawValue: "càffe ristretto",
    derivedTable: null,
    dimensions: { lang: "it", note: "àèìòù" },
  },
  {
    id: "firecrawl:long-rawvalue",
    sourceFileId: "s",
    fileName: "f",
    fileRole: "r",
    sheet: "x",
    metric: "m",
    summary: "long article",
    confidence: 0.8,
    sourceLocation: "loc",
    rawValue: "x".repeat(50_000),
    derivedTable: null,
    dimensions: {},
  },
  {
    id: "firecrawl:derived-table",
    sourceFileId: "s",
    fileName: "f",
    fileRole: "r",
    sheet: "x",
    metric: "m",
    summary: "has derived",
    confidence: 0.6,
    sourceLocation: "loc",
    rawValue: "content",
    derivedTable: "table-123",
    dimensions: { metric_family: "value_sales" },
  },
  {
    id: "firecrawl:many-dimensions",
    sourceFileId: "s",
    fileName: "f",
    fileRole: "r",
    sheet: "x",
    metric: "m",
    summary: "lots of dimensions",
    confidence: 0.72,
    sourceLocation: "loc",
    rawValue: "content",
    derivedTable: null,
    dimensions: {
      language: "it",
      tier: "1",
      source_type: "trade_press",
      domain_tags: "gdo,retail,fmcg,cpg,italia",
      fetched_at: "2026-04-23T14:11:39.969Z",
      content_hash: "a".repeat(64),
      keyword: "snack",
    },
  },
  {
    id: "graph:chunk:chunk-7",
    sourceFileId: "doc-7",
    fileName: "scraped-article-7.md",
    fileRole: "graph-chunk-scraped_article",
    sheet: "knowledge-graph",
    metric: "graph_chunk",
    summary: "First sentence of a scraped chunk.",
    confidence: 0.85,
    sourceLocation: "https://mark-up.it/articoli/chunk-7",
    rawValue: "First sentence of a scraped chunk.\n\nSecond paragraph.",
    derivedTable: null,
    dimensions: {
      keyword: "snack",
      document_kind: "scraped_article",
      retrieval_score: "0.812",
    },
  },
];

describe("schema-sync contract", () => {
  it.each(FIXTURES.map((f, i) => [i, f]))(
    "fixture %i round-trips through evidenceRefSchema without loss",
    (_index, fixture) => {
      const parsed = evidenceRefSchema.parse(fixture);
      expect(parsed).toEqual(fixture);
    },
  );

  it("rejects a ref missing any required field", () => {
    const broken = {
      id: "firecrawl:x",
      sourceFileId: "s",
      fileName: "f",
      fileRole: "r",
      sheet: "x",
      metric: "m",
      summary: "broken",
      confidence: 0.5,
      sourceLocation: "loc",
      rawValue: null,
      derivedTable: null,
      // dimensions: missing
    };
    expect(() => evidenceRefSchema.parse(broken)).toThrow();
  });

  it("rejects a ref with confidence out of [0,1]", () => {
    const bad = {
      ...FIXTURES[0]!,
      confidence: 1.5,
    };
    expect(() => evidenceRefSchema.parse(bad)).toThrow();
  });

  it("rejects a ref with non-string dimension values", () => {
    const bad = {
      ...FIXTURES[0]!,
      dimensions: { bad_value: 42 as unknown as string },
    };
    expect(() => evidenceRefSchema.parse(bad)).toThrow();
  });
});
