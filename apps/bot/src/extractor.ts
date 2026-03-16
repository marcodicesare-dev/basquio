import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "./config.js";

// Local copy of the extraction schema to avoid ESM/CJS resolution issues
// with the workspace @basquio/types package. Keep in sync with
// packages/types/src/collaboration.ts.
const extractedActionItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.string().default("feature"),
  assignee: z.string(),
  priority: z.string().default("medium"),
});

const extractedSalesMentionSchema = z.object({
  company: z.string(),
  context: z.string(),
  action: z.string().optional(),
  owner: z.string().optional(),
  status: z.string().default("mentioned"),
});

const extractedDecisionSchema = z.object({
  decision: z.string(),
  context: z.string().optional(),
  participants: z.array(z.string()).default([]),
  category: z.string().default("general"),
});

const extractionResultSchema = z.object({
  summary: z.string(),
  decisions: z.array(extractedDecisionSchema).default([]),
  action_items: z.array(extractedActionItemSchema).default([]),
  sales_mentions: z.array(extractedSalesMentionSchema).default([]),
  key_quotes: z.array(z.string()).default([]),
});

type ExtractionResult = z.infer<typeof extractionResultSchema>;

let client: Anthropic;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

// LOCKED — do not change without Marco's approval
const EXTRACTION_PROMPT = `You are Basquio's AI assistant processing a conversation transcript from the founding team's Discord. The team is building an AI-powered market research platform for CPG/FMCG.

The founding team:
- Marco: CTO, technical founder, builds the product full-time
- Veronica (Marco's wife): CPG perspective, UI/UX, market research,
  R&D. Less time to dedicate. Works at Victorinox.
- Fra (Francesco): CFO. Anything that touches money, sense of
  profit, practical, analyst in the blood. Works at NielsenIQ.
- Rossella: B2C users, PM, main dogfood user, person with most
  product insights. Works at NielsenIQ.
- Ale (Alessandro): B2B and enterprise guy. Knows how to talk to
  companies and sell them Basquio. The big-whale contracts guy.
  Works at NielsenIQ.
- Giulia: CPG perspective, UI/UX, market research (similar to
  Veronica), plus social media and influencer expert.
  Works at Mondelez.

CRITICAL RULES — read these before extracting anything:

1. NOT EVERYTHING IS ACTIONABLE. Casual chat, greetings, jokes, small talk,
   venting, celebrations, birthday wishes, random banter — these are NOT
   action items, NOT decisions, NOT sales mentions. Return empty arrays
   if nothing meaningful was discussed.

2. ACTION_ITEMS must pass ALL of these tests:
   - Someone explicitly committed to doing something specific, OR
   - The team clearly agreed something needs to happen
   - It's concrete and completable (not vague like "think about X")
   - It would actually be useful as a Linear issue someone works on
   - If you wouldn't spend 15 minutes writing a ticket for it, don't extract it

3. DECISIONS must be real decisions that change how the team operates,
   not casual opinions or preferences expressed in passing.

4. SALES_MENTIONS must reference actual companies being evaluated as
   prospects, partners, or customers — not casual name-drops of companies
   in unrelated context (e.g. "I saw Netflix released a doc" is NOT a
   sales mention).

5. KEY_QUOTES: Only preserve quotes that capture genuine strategic insight,
   a memorable team moment, or a perspective worth revisiting. Not every
   sentence is quotable.

6. When in doubt, extract NOTHING. Empty arrays are perfectly fine.
   A clean, empty extraction is infinitely better than noisy garbage
   that clutters Linear and makes the system useless.

From this transcript, extract:

1. SUMMARY: 2-4 sentences. If the conversation was just casual chat,
   say so — e.g. "The team caught up casually, no business topics discussed."

2. DECISIONS: Only explicit or strongly implicit decisions.

3. ACTION_ITEMS: Only genuinely actionable work. For each:
   - title: short issue title
   - description: context from the conversation
   - category: whatever fits best (bug, feature, improvement, etc.)
   - assignee: who should own this (based on roles above)
   - priority: urgent | high | medium | low

4. SALES_MENTIONS: Only real prospect/deal discussions. For each:
   - company: name
   - context: what was said
   - action: next step if any
   - owner: who's handling it
   - status: whatever fits best

5. KEY_QUOTES: 0-3 genuinely notable quotes. Zero is fine.

Output as JSON.`;

/**
 * Extract structured data from a transcript using Claude.
 */
export async function extractFromTranscript(
  transcript: string,
  sessionType: "voice" | "text" = "voice",
): Promise<ExtractionResult> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}

--- TRANSCRIPT (${sessionType} session) ---
${transcript}
--- END TRANSCRIPT ---

Respond with only valid JSON matching this structure:
{
  "summary": "string",
  "decisions": [{ "decision": "string", "context": "string", "participants": ["string"], "category": "string" }],
  "action_items": [{ "title": "string", "description": "string", "category": "string", "assignee": "string", "priority": "string" }],
  "sales_mentions": [{ "company": "string", "context": "string", "action": "string", "owner": "string", "status": "string" }],
  "key_quotes": ["string"]
}`,
      },
    ],
  });

  // Extract JSON from response
  const responseText =
    message.content[0]?.type === "text" ? message.content[0].text : "";

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Failed to extract JSON from Claude response:", responseText);
    return {
      summary: "Failed to process transcript",
      decisions: [],
      action_items: [],
      sales_mentions: [],
      key_quotes: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Failed to parse JSON from Claude response:", jsonMatch[0].slice(0, 200));
    return {
      summary: "Failed to parse extraction result",
      decisions: [],
      action_items: [],
      sales_mentions: [],
      key_quotes: [],
    };
  }

  const result = extractionResultSchema.safeParse(parsed);

  if (!result.success) {
    console.error("Extraction schema validation failed:", result.error.issues);
    const p = parsed as Record<string, unknown>;
    const fallback = extractionResultSchema.safeParse({
      summary: p.summary ?? "Processing error",
      decisions: p.decisions ?? [],
      action_items: p.action_items ?? [],
      sales_mentions: p.sales_mentions ?? [],
      key_quotes: p.key_quotes ?? [],
    });
    return fallback.success
      ? fallback.data
      : { summary: "Processing error", decisions: [], action_items: [], sales_mentions: [], key_quotes: [] };
  }

  return result.data;
}
