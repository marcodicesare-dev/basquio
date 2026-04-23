#!/usr/bin/env -S node --import tsx
/**
 * R7 debug: pull a single scrape, call Haiku directly, dump the raw
 * response text so we can see why extractEntitiesFromDocument returns
 * empty on 19/20 articles.
 */

import Anthropic from "@anthropic-ai/sdk";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const TARGET_ID = process.argv[2] ?? "0b98ecf3-6e71-495e-be22-065da596ab22"; // Italian freshplaza

async function main(): Promise<void> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/source_catalog_scrapes`);
  url.searchParams.set("select", "id,url,title,content_markdown,language");
  url.searchParams.set("id", `eq.${TARGET_ID}`);
  const response = await fetch(url.toString(), {
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [row] = (await response.json()) as Array<{
    id: string;
    url: string;
    title: string | null;
    content_markdown: string;
    language: string | null;
  }>;
  console.log(`[debug] article: ${row.title}`);
  console.log(`[debug] url: ${row.url}`);
  console.log(`[debug] language: ${row.language}`);
  console.log(`[debug] content_length: ${row.content_markdown.length}`);
  console.log(`[debug] content_preview: ${row.content_markdown.slice(0, 400)}`);
  console.log("---");

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY! });
  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    system: `You read a document. Extract every entity and fact. Return strict JSON only.

Entity types: person, organization, brand, category, sub_category, sku, retailer, metric, deliverable, question, meeting, email, document.

Return: { "entities": [...], "facts": [...] }`,
    messages: [
      {
        role: "user",
        content: `Document filename: ${row.title ?? row.url}\n\n--- DOCUMENT ---\n${row.content_markdown.slice(0, 20_000)}\n--- END DOCUMENT ---\n\nRespond with JSON only:\n{ "entities": [{"type": "...", "canonical_name": "...", "aliases": [], "role": "...", "description": "..."}], "facts": [...] }`,
      },
    ],
  });

  const text = message.content[0]?.type === "text" ? message.content[0].text : "";
  console.log(`[debug] raw response (${text.length} chars):`);
  console.log(text.slice(0, 3000));
  console.log("---");
  console.log(`[debug] stop_reason: ${message.stop_reason}`);
  console.log(`[debug] usage: ${JSON.stringify(message.usage)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
