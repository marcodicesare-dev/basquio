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

From this transcript, extract:

1. SUMMARY: 2-4 sentences capturing what was discussed.

2. DECISIONS: Any explicit or implicit decisions made.

3. ACTION_ITEMS: Things someone said they'd do, or things
   that clearly need to happen. For each:
   - title: short issue title
   - description: context from the conversation
   - category: bug | feature | improvement | feedback | finance | marketing
   - assignee: who should own this (based on roles above)
   - priority: urgent | high | medium | low

4. SALES_MENTIONS: Any companies, prospects, or deals mentioned.
   For each:
   - company: name
   - context: what was said
   - action: next step if any
   - owner: who's handling it
   - status: mentioned | researching | outreach | demo_scheduled | pilot | negotiation

5. KEY_QUOTES: 1-3 notable quotes worth preserving.

Output as JSON. Be conservative — only extract items that clearly warrant tracking. Don't create issues for casual observations or hypotheticals.`;

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
