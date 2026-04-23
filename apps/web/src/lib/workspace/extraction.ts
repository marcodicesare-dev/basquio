import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Entity taxonomy. Day 1 shipped with 13 types tuned for the chat-
// paste use case (email, meeting, document, question). R7 (2026-04-24,
// docs/2026-04-24-extraction-quality-report.md) showed that scraped
// trade-press content naturally mentions regions, locations, events,
// and channels. Without those in the enum, Haiku returns valid
// extractions that fail Zod validation and the whole row drops to
// zero entities. Added 4 types to unblock scraped-article extraction;
// kept all prior values for backward-compat with uploaded-file
// ingestion.
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

export type EntityType = (typeof ENTITY_TYPES)[number];

// R7 hardening: wrap each row in `.catch(() => null)` so a single
// malformed entity or fact drops that row rather than rejecting the
// whole response. Prior behavior (strict enum) meant one unknown
// subject_type = zero entities for the article. The outer transform
// filters the nulls so downstream code sees only valid rows.
const extractedEntitySchema = z
  .object({
    type: z.enum(ENTITY_TYPES),
    canonical_name: z.string().min(1).max(200),
    aliases: z.array(z.string().max(200)).default([]),
    role: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
  })
  .catch(null as unknown as never);

const extractedFactSchema = z
  .object({
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
  })
  .catch(null as unknown as never);

const extractionResultSchema = z
  .object({
    entities: z.array(extractedEntitySchema.nullable()).default([]),
    facts: z.array(extractedFactSchema.nullable()).default([]),
  })
  .transform((r) => ({
    entities: r.entities.filter(
      (x): x is NonNullable<typeof x> => x !== null && typeof x !== "undefined",
    ),
    facts: r.facts.filter(
      (x): x is NonNullable<typeof x> => x !== null && typeof x !== "undefined",
    ),
  }));

export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;
export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export type EntityExtractionResult = z.infer<typeof extractionResultSchema>;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set.");
    }
    client = new Anthropic({
      apiKey,
      timeout: 60_000,
      maxRetries: 2,
    });
  }
  return client;
}

const MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You read a document an FMCG/CPG insights analyst uploaded to their workspace. Extract every concrete entity and fact you can ground in the text. Return strict JSON only, no commentary.

Entity types and what each captures:
- person: a named individual (Elena Bianchi, Head of Category at Victorinox)
- organization: a company, agency, vendor (Mondelez Italy, NielsenIQ)
- brand: a brand the analyst tracks (Oreo, Victorinox, Kellogg)
- category: an FMCG category (Snack Salati, Pasta, Hair Care)
- sub_category: a sub-category if the doc gets granular (Crackers Aromatizzati)
- sku: a specific SKU when named (Oreo Original 220g)
- retailer: a retail chain (Coop, Conad, Esselunga, Carrefour Italia)
- metric: a measurable indicator (sales value, market share, ROS, distribution)
- deliverable: a named past deck/memo/workbook produced by anyone (Q4 Snack Salati Review)
- question: an analytical question someone asked (Why did Brand X lose share in October?)
- meeting / email / document: when the text references one explicitly
- region: a subnational or supranational area (Emilia Romagna, EMEA, Mezzogiorno, Northern Italy)
- location: a specific city, country, or facility (Milan, Vietnam, Piacenza distribution center)
- event: a trade show, launch, convention, or dated occurrence (Anuga 2026, Milan Fashion Week Spring 2026)
- channel: a sales or media channel (modern trade, e-commerce, convenience, on-trade)

Hard rules:
- canonical_name: the most specific real name from the text. Title Case proper nouns. No quotes.
- aliases: exact spelling variations seen in the text. Skip if none.
- role: short descriptor for people only ("Head of Category, Victorinox").
- description: one short sentence for entities that need disambiguation.
- Skip pronouns, generic nouns ("the team", "the brand"), and anything you cannot ground in the text.

Facts:
- predicate: short slug, snake_case ("share_in_period", "manages_category", "reports_to", "launched_at_retailer")
- object_value: literal value from the text. Use a number if the text gives a number, a string for names or descriptions, an object for structured values like { period: "Q4 2025", value: 12.4, unit: "%" }.
- object_canonical_name + object_type: only when the object is itself an entity already in your entities array.
- valid_from / valid_to: ISO date or quarter string ("2025-Q4", "2026-01-15") if the text states a time.
- evidence_excerpt: short verbatim snippet from the text supporting the fact (max 200 chars).
- confidence: 0.5 if the fact is implicit, 0.8 if stated, 1.0 if explicitly verified.

Return at most 60 entities and 60 facts per document. Skip noise. Empty arrays are fine.`;

const USER_TEMPLATE = (text: string, filename: string) => `Document filename: ${filename}

--- DOCUMENT ---
${text}
--- END DOCUMENT ---

Respond with JSON only matching this shape:
{
  "entities": [{ "type": "...", "canonical_name": "...", "aliases": [], "role": "...", "description": "..." }],
  "facts": [{ "subject_canonical_name": "...", "subject_type": "...", "predicate": "...", "object_value": ..., "object_canonical_name": "...", "object_type": "...", "valid_from": "...", "valid_to": "...", "evidence_excerpt": "...", "confidence": 0.0 }]
}`;

const MAX_DOCUMENT_CHARS = 80_000;

export async function extractEntitiesFromDocument(
  text: string,
  filename: string,
): Promise<EntityExtractionResult> {
  if (!text.trim()) {
    return { entities: [], facts: [] };
  }

  const truncated = text.length > MAX_DOCUMENT_CHARS ? text.slice(0, MAX_DOCUMENT_CHARS) : text;

  const anthropic = getClient();
  const message = await anthropic.messages.create({
    model: MODEL,
    // R7: bumped from 4096 to 8192. Long scraped trade-press articles
    // routinely need 4800-6000 output tokens for the JSON; the prior
    // cap truncated mid-object and the regex parse returned empty.
    // docs/2026-04-24-extraction-quality-report.md.
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: USER_TEMPLATE(truncated, filename),
      },
    ],
  });

  const responseText = message.content[0]?.type === "text" ? message.content[0].text : "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { entities: [], facts: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { entities: [], facts: [] };
  }

  const result = extractionResultSchema.safeParse(parsed);
  if (!result.success) {
    return { entities: [], facts: [] };
  }
  return result.data;
}

export function normalizeEntityName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
