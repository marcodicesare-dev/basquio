#!/usr/bin/env -S node --import tsx
/**
 * R7 validation: re-run all 20 articles with two surgical fixes:
 *  1. ENTITY_TYPES extended with "region" (and a few others Haiku
 *     naturally emits: "location", "event", "channel").
 *  2. max_tokens bumped from 4096 to 8192 so longer articles don't
 *     truncate mid-JSON.
 *  3. Schema relaxed: unknown subject_type / type drops the row but
 *     keeps the rest of the response rather than rejecting the whole
 *     parse.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Extended entity types reflecting what Haiku naturally emits on
// scraped trade-press content (vs the Day 1 chat-centric taxonomy).
const ENTITY_TYPES = [
  "person",
  "organization",
  "brand",
  "category",
  "sub_category",
  "sku",
  "retailer",
  "metric",
  "deliverable",
  "question",
  "meeting",
  "email",
  "document",
  "region",
  "location",
  "event",
  "channel",
] as const;

const entitySchema = z
  .object({
    type: z.enum(ENTITY_TYPES).or(z.string()),
    canonical_name: z.string().min(1).max(200),
    aliases: z.array(z.string().max(200)).default([]),
    role: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
  })
  .catch(null as unknown as never);

const factSchema = z
  .object({
    subject_canonical_name: z.string().min(1).max(200),
    subject_type: z.enum(ENTITY_TYPES).or(z.string()),
    predicate: z.string().min(1).max(120),
    object_value: z.unknown(),
    object_canonical_name: z.string().max(200).optional(),
    object_type: z.enum(ENTITY_TYPES).or(z.string()).optional(),
    valid_from: z.string().max(40).optional(),
    valid_to: z.string().max(40).optional(),
    evidence_excerpt: z.string().max(400).optional(),
    confidence: z.number().min(0).max(1).default(0.7),
  })
  .catch(null as unknown as never);

const resultSchema = z
  .object({
    entities: z.array(entitySchema.nullable()).default([]),
    facts: z.array(factSchema.nullable()).default([]),
  })
  .transform((r) => ({
    entities: r.entities.filter((x): x is NonNullable<typeof x> => x !== null),
    facts: r.facts.filter((x): x is NonNullable<typeof x> => x !== null),
  }));

const SYSTEM_PROMPT = `You read a document an FMCG/CPG insights analyst uploaded. Extract every concrete entity and fact you can ground in the text. Return strict JSON only.

Entity types: person, organization, brand, category, sub_category, sku, retailer, metric, deliverable, question, meeting, email, document, region, location, event, channel.

Return { "entities": [...], "facts": [...] }. Each entity has type + canonical_name + aliases (array) + optional role + optional description. Each fact has subject_canonical_name + subject_type + predicate + object_value + optional object_canonical_name + optional object_type + optional valid_from + valid_to + evidence_excerpt + confidence (0-1).

Rules: object_value must be a string, number, boolean, null, or object. Never an array. Never omit canonical_name.`;

async function main(): Promise<void> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/source_catalog_scrapes`);
  url.searchParams.set("select", "id,url,title,content_markdown,language");
  url.searchParams.set("order", "fetched_at.desc");
  url.searchParams.set("limit", "20");
  const rows = await fetch(url.toString(), {
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  }).then((r) => r.json() as Promise<Array<{ id: string; url: string; title: string | null; content_markdown: string; language: string | null }>>);

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY! });
  const outcomes: Array<{
    id: string;
    language: string | null;
    parse: "ok" | "parse_fail";
    entities: number;
    facts: number;
  }> = [];

  for (const row of rows) {
    const truncated = row.content_markdown.slice(0, 80_000);
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Document: ${row.title ?? row.url}\n\n${truncated}\n\nReturn JSON: { "entities": [...], "facts": [...] }`,
        },
      ],
    });
    const text = message.content[0]?.type === "text" ? message.content[0].text : "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      outcomes.push({ id: row.id, language: row.language, parse: "parse_fail", entities: 0, facts: 0 });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      outcomes.push({ id: row.id, language: row.language, parse: "parse_fail", entities: 0, facts: 0 });
      continue;
    }
    const result = resultSchema.safeParse(parsed);
    if (!result.success) {
      outcomes.push({ id: row.id, language: row.language, parse: "parse_fail", entities: 0, facts: 0 });
      continue;
    }
    outcomes.push({
      id: row.id,
      language: row.language,
      parse: "ok",
      entities: result.data.entities.length,
      facts: result.data.facts.length,
    });
    console.log(
      `${row.id.slice(0, 8)} ${row.language ?? "?"} → entities=${result.data.entities.length} facts=${result.data.facts.length}`,
    );
  }

  const ok = outcomes.filter((o) => o.parse === "ok");
  const totalEntities = ok.reduce((s, o) => s + o.entities, 0);
  const totalFacts = ok.reduce((s, o) => s + o.facts, 0);
  const avgEntities = ok.length > 0 ? (totalEntities / ok.length).toFixed(1) : "0";
  const avgFacts = ok.length > 0 ? (totalFacts / ok.length).toFixed(1) : "0";

  console.log("\n=== Summary (with R7 fixes) ===");
  console.log(`articles_ok: ${ok.length} / ${outcomes.length}`);
  console.log(`entities_total: ${totalEntities} (avg ${avgEntities}/article)`);
  console.log(`facts_total: ${totalFacts} (avg ${avgFacts}/article)`);
  console.log(`italian_ok: ${ok.filter((o) => o.language === "it").length} / ${outcomes.filter((o) => o.language === "it").length}`);
  console.log(`english_ok: ${ok.filter((o) => o.language === "en").length} / ${outcomes.filter((o) => o.language === "en").length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
