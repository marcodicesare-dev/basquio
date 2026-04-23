#!/usr/bin/env -S node --import tsx
/**
 * Wraps extractEntitiesFromDocument with raw-response logging to
 * diagnose why 19/20 R7 eval articles returned zero entities.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

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
] as const;

const extractedEntitySchema = z.object({
  type: z.enum(ENTITY_TYPES),
  canonical_name: z.string().min(1).max(200),
  aliases: z.array(z.string().max(200)).default([]),
  role: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
});

const extractedFactSchema = z.object({
  subject_canonical_name: z.string().min(1).max(200),
  subject_type: z.enum(ENTITY_TYPES),
  predicate: z.string().min(1).max(120),
  object_value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.unknown())]),
  object_canonical_name: z.string().max(200).optional(),
  object_type: z.enum(ENTITY_TYPES).optional(),
  valid_from: z.string().max(40).optional(),
  valid_to: z.string().max(40).optional(),
  evidence_excerpt: z.string().max(400).optional(),
  confidence: z.number().min(0).max(1).default(0.7),
});

const extractionResultSchema = z.object({
  entities: z.array(extractedEntitySchema).default([]),
  facts: z.array(extractedFactSchema).default([]),
});

const SYSTEM_PROMPT_LONG = `You read a document an FMCG/CPG insights analyst uploaded to their workspace. Extract every concrete entity and fact you can ground in the text. Return strict JSON only, no commentary.

Entity types: person, organization, brand, category, sub_category, sku, retailer, metric, deliverable, question, meeting, email, document.

Return JSON with entities[] and facts[] arrays. Each entity has type + canonical_name + aliases (array) + optional role + optional description. Each fact has subject_canonical_name + subject_type + predicate + object_value + optional object_canonical_name + optional object_type + optional valid_from + optional valid_to + optional evidence_excerpt + confidence (0-1 number).

Rules: object_value must be string, number, boolean, null, or object. Never an array. Never omit canonical_name. Skip if you cannot ground it. Empty arrays are fine.`;

async function main(): Promise<void> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/source_catalog_scrapes`);
  url.searchParams.set("select", "id,url,title,content_markdown,language");
  url.searchParams.set("order", "fetched_at.desc");
  url.searchParams.set("limit", "20");
  const response = await fetch(url.toString(), {
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const rows = (await response.json()) as Array<{
    id: string;
    url: string;
    title: string | null;
    content_markdown: string;
    language: string | null;
  }>;

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY! });
  const outcomes: Array<{
    id: string;
    parse: "ok" | "no_match" | "json_parse_fail" | "schema_fail";
    issues?: string[];
    entities: number;
    facts: number;
    rawTail?: string;
  }> = [];

  for (const row of rows.slice(0, 20)) {
    const truncated = row.content_markdown.slice(0, 80_000);
    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT_LONG,
        messages: [
          {
            role: "user",
            content: `Document filename: ${row.title ?? row.url}\n\n--- DOCUMENT ---\n${truncated}\n--- END DOCUMENT ---\n\nRespond with JSON only matching this shape:\n{ "entities": [{"type": "...", "canonical_name": "...", "aliases": [], "role": "...", "description": "..."}], "facts": [{"subject_canonical_name": "...", "subject_type": "...", "predicate": "...", "object_value": ..., "confidence": 0.0}] }`,
          },
        ],
      });
      const text = message.content[0]?.type === "text" ? message.content[0].text : "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        outcomes.push({ id: row.id, parse: "no_match", entities: 0, facts: 0, rawTail: text.slice(-200) });
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        outcomes.push({
          id: row.id,
          parse: "json_parse_fail",
          entities: 0,
          facts: 0,
          rawTail: match[0].slice(-300),
        });
        continue;
      }
      const result = extractionResultSchema.safeParse(parsed);
      if (!result.success) {
        outcomes.push({
          id: row.id,
          parse: "schema_fail",
          entities: 0,
          facts: 0,
          issues: result.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`),
        });
        continue;
      }
      outcomes.push({
        id: row.id,
        parse: "ok",
        entities: result.data.entities.length,
        facts: result.data.facts.length,
      });
    } catch (err) {
      outcomes.push({
        id: row.id,
        parse: "no_match",
        entities: 0,
        facts: 0,
        issues: [err instanceof Error ? err.message : String(err)],
      });
    }
    console.log(
      `${row.id.slice(0, 8)} ${row.language ?? "?"} → ${outcomes[outcomes.length - 1].parse} entities=${outcomes[outcomes.length - 1].entities}`,
    );
  }

  const summary = {
    ok: outcomes.filter((o) => o.parse === "ok").length,
    no_match: outcomes.filter((o) => o.parse === "no_match").length,
    json_parse_fail: outcomes.filter((o) => o.parse === "json_parse_fail").length,
    schema_fail: outcomes.filter((o) => o.parse === "schema_fail").length,
  };
  console.log("\n=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\n=== First non-ok outcome ===");
  const firstFail = outcomes.find((o) => o.parse !== "ok");
  if (firstFail) console.log(JSON.stringify(firstFail, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
