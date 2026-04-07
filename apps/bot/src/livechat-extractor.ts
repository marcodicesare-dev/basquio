import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "./config.js";

const livechatFeatureRequestSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(["urgent", "high", "medium", "low"]).default("medium"),
});

const livechatBugReportSchema = z.object({
  title: z.string(),
  description: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]).default("medium"),
});

const livechatSalesSignalSchema = z.object({
  company: z.string(),
  contact: z.string().optional(),
  signal: z.string(),
  status: z.enum([
    "mentioned",
    "researching",
    "outreach",
    "demo_scheduled",
    "pilot",
    "negotiation",
    "closed_won",
    "closed_lost",
  ]).default("mentioned"),
});

const livechatExtractionSchema = z.object({
  customer: z.object({
    name: z.string().nullable().default(null),
    email: z.string().nullable().default(null),
    company: z.string().nullable().default(null),
  }).default({ name: null, email: null, company: null }),
  sentiment: z.enum(["positive", "neutral", "frustrated", "angry"]).default("neutral"),
  category: z.enum(["support", "feature_request", "bug_report", "sales_inquiry", "general"]).default("general"),
  summary: z.string(),
  resolution: z.enum(["resolved", "pending", "escalated"]).nullable().default(null),
  featureRequests: z.array(livechatFeatureRequestSchema).default([]),
  bugReports: z.array(livechatBugReportSchema).default([]),
  salesSignals: z.array(livechatSalesSignalSchema).default([]),
  keyQuotes: z.array(z.string()).default([]),
});

export type LivechatExtraction = z.infer<typeof livechatExtractionSchema>;

let client: Anthropic;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

const LIVECHAT_EXTRACTION_PROMPT = `You are analyzing a customer support conversation from Basquio's live chat.
The conversation is between a customer or visitor and the Basquio team.

Extract the following. Return empty arrays or null when nothing applies.

1. customer: { name, email, company }
2. sentiment: positive | neutral | frustrated | angry
3. category: support | feature_request | bug_report | sales_inquiry | general
4. summary: 2-3 sentences of what the customer needed and whether it was resolved
5. resolution: resolved | pending | escalated | null
6. featureRequests: [{ title, description, priority }] only if the customer explicitly asked for a capability that does not exist
7. bugReports: [{ title, description, severity }] only if the customer reported something broken
8. salesSignals: [{ company, contact, signal, status }] only if there is real buying intent
9. keyQuotes: up to 2 memorable customer quotes

Rules:
- "How do I..." is support, not a feature request.
- Only create bugReports for things that are actually broken.
- Only create salesSignals when the transcript shows real intent, a real company, or a real evaluation path.
- Empty extraction is better than noisy extraction.
- The customer's words matter more than the team's responses for classification.
- Keep keyQuotes to actual customer language, not team paraphrases.

Respond with JSON only.`;

export async function extractFromLivechat(transcript: string): Promise<LivechatExtraction> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `${LIVECHAT_EXTRACTION_PROMPT}

--- LIVE CHAT TRANSCRIPT ---
${transcript}
--- END LIVE CHAT TRANSCRIPT ---

Respond with JSON matching:
{
  "customer": { "name": "string|null", "email": "string|null", "company": "string|null" },
  "sentiment": "positive|neutral|frustrated|angry",
  "category": "support|feature_request|bug_report|sales_inquiry|general",
  "summary": "string",
  "resolution": "resolved|pending|escalated|null",
  "featureRequests": [{ "title": "string", "description": "string", "priority": "urgent|high|medium|low" }],
  "bugReports": [{ "title": "string", "description": "string", "severity": "critical|high|medium|low" }],
  "salesSignals": [{ "company": "string", "contact": "string", "signal": "string", "status": "mentioned|researching|outreach|demo_scheduled|pilot|negotiation|closed_won|closed_lost" }],
  "keyQuotes": ["string"]
}`,
      },
    ],
  });

  const responseText = message.content[0]?.type === "text" ? message.content[0].text : "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    console.error("Failed to extract livechat JSON:", responseText);
    return {
      customer: { name: null, email: null, company: null },
      sentiment: "neutral",
      category: "general",
      summary: "Failed to process the live chat transcript.",
      resolution: null,
      featureRequests: [],
      bugReports: [],
      salesSignals: [],
      keyQuotes: [],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    const result = livechatExtractionSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    console.error("Livechat extraction schema validation failed:", result.error.issues);
  } catch (error) {
    console.error("Failed to parse livechat extraction JSON:", error);
  }

  return {
    customer: { name: null, email: null, company: null },
    sentiment: "neutral",
    category: "general",
    summary: "Failed to process the live chat transcript.",
    resolution: null,
    featureRequests: [],
    bugReports: [],
    salesSignals: [],
    keyQuotes: [],
  };
}
