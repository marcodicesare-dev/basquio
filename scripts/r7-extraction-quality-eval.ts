#!/usr/bin/env -S node --import tsx
/**
 * R7 extraction-quality evaluation harness (B6).
 *
 * Loads the N most recent source_catalog_scrapes rows, runs the Haiku
 * extractor (extractEntitiesFromDocument) against each, and dumps a
 * JSON report the implementation agent uses to hand-grade precision +
 * recall for docs/2026-04-24-extraction-quality-report.md.
 *
 * Usage:
 *   source apps/web/.env.local && \
 *     node --import tsx scripts/r7-extraction-quality-eval.ts 20
 *
 * Cost: ~$0.02 per extraction call. 20 articles = ~$0.40 total.
 *
 * Output: writes docs/2026-04-24-extraction-quality-eval.json with
 * { article, extraction } tuples so the markdown report can ingest
 * the grid deterministically.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { extractEntitiesFromDocument } from "../apps/web/src/lib/workspace/extraction";

type ScrapeRow = {
  id: string;
  url: string;
  title: string | null;
  content_markdown: string;
  language: string | null;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. Source apps/web/.env.local first.");
  process.exit(2);
}

const SAMPLE_SIZE = Number.parseInt(process.argv[2] ?? "20", 10);
const OUT_PATH = path.join(process.cwd(), "docs/2026-04-24-extraction-quality-eval.json");

async function loadSample(limit: number): Promise<ScrapeRow[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/source_catalog_scrapes`);
  url.searchParams.set("select", "id,url,title,content_markdown,language");
  url.searchParams.set("order", "fetched_at.desc");
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!response.ok) {
    throw new Error(`source_catalog_scrapes fetch failed: ${response.status}`);
  }
  return (await response.json()) as ScrapeRow[];
}

async function main(): Promise<void> {
  console.log(`[r7-eval] sampling ${SAMPLE_SIZE} scrapes from source_catalog_scrapes`);
  const scrapes = await loadSample(SAMPLE_SIZE);
  console.log(`[r7-eval] loaded ${scrapes.length} scrapes`);

  const results: Array<{
    id: string;
    url: string;
    title: string | null;
    language: string | null;
    contentLength: number;
    entities: Array<{ type: string; canonical_name: string; role?: string | null }>;
    facts: Array<{
      subject: string;
      subject_type: string;
      predicate: string;
      object: unknown;
      confidence: number;
    }>;
    elapsedMs: number;
  }> = [];

  for (let i = 0; i < scrapes.length; i += 1) {
    const row = scrapes[i];
    const started = Date.now();
    try {
      const filename = row.title ?? new URL(row.url).hostname;
      const extraction = await extractEntitiesFromDocument(row.content_markdown, filename);
      results.push({
        id: row.id,
        url: row.url,
        title: row.title,
        language: row.language,
        contentLength: row.content_markdown.length,
        entities: extraction.entities.map((e) => ({
          type: e.type,
          canonical_name: e.canonical_name,
          role: e.role ?? null,
        })),
        facts: extraction.facts.map((f) => ({
          subject: f.subject_canonical_name,
          subject_type: f.subject_type,
          predicate: f.predicate,
          object: f.object_value,
          confidence: f.confidence,
        })),
        elapsedMs: Date.now() - started,
      });
      console.log(
        `[r7-eval] ${i + 1}/${scrapes.length} ${row.language ?? "?"} ${extraction.entities.length}e ${extraction.facts.length}f (${Date.now() - started}ms)`,
      );
    } catch (err) {
      console.error(
        `[r7-eval] ${i + 1}/${scrapes.length} FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
      results.push({
        id: row.id,
        url: row.url,
        title: row.title,
        language: row.language,
        contentLength: row.content_markdown.length,
        entities: [],
        facts: [],
        elapsedMs: Date.now() - started,
      });
    }
  }

  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), sample_size: scrapes.length, results },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(`[r7-eval] wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("[r7-eval] unhandled error", err);
  process.exit(1);
});
