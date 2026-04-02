import { z } from "zod";

// ── Extraction output schemas ──────────────────────────────────────

export const extractedActionItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.enum(["bug", "feature", "improvement", "feedback", "finance", "marketing"]),
  assignee: z.string(),
  priority: z.enum(["urgent", "high", "medium", "low"]),
}).passthrough();

export const extractedSalesMentionSchema = z.object({
  company: z.string(),
  context: z.string(),
  action: z.string().optional(),
  owner: z.string().optional(),
  status: z.enum([
    "mentioned",
    "researching",
    "outreach",
    "demo_scheduled",
    "pilot",
    "negotiation",
  ]),
}).passthrough();

export const extractedDecisionSchema = z.object({
  decision: z.string(),
  context: z.string().optional(),
  participants: z.array(z.string()).default([]),
  category: z
    .enum(["product", "technical", "financial", "sales", "marketing", "general"])
    .default("general"),
}).passthrough();

export const extractionResultSchema = z.object({
  summary: z.string(),
  decisions: z.array(extractedDecisionSchema).default([]),
  action_items: z.array(extractedActionItemSchema).default([]),
  sales_mentions: z.array(extractedSalesMentionSchema).default([]),
  key_quotes: z.array(z.string()).default([]),
}).passthrough();

// ── Transcript schemas ─────────────────────────────────────────────

export const sessionTypeSchema = z.enum(["voice", "text"]);

export const transcriptRecordSchema = z.object({
  id: z.string().uuid().optional(),
  session_type: sessionTypeSchema,
  started_at: z.string(),
  ended_at: z.string().optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  participants: z.array(z.string()).default([]),
  raw_transcript: z.string(),
  ai_summary: z.string().optional(),
  decisions: z.array(extractedDecisionSchema).default([]),
  action_items: z.array(extractedActionItemSchema).default([]),
  key_quotes: z.array(z.string()).default([]),
  sales_mentions: z.array(extractedSalesMentionSchema).default([]),
  audio_storage_path: z.string().optional(),
  discord_message_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// ── CRM schemas ────────────────────────────────────────────────────

export const crmLeadStatusSchema = z.enum([
  "mentioned",
  "researching",
  "outreach",
  "demo_scheduled",
  "pilot",
  "negotiation",
  "closed_won",
  "closed_lost",
]);

export const crmLeadSchema = z.object({
  id: z.string().uuid().optional(),
  company_name: z.string(),
  status: crmLeadStatusSchema.default("mentioned"),
  owner: z.string().optional(),
  context: z.string().optional(),
  last_mentioned_at: z.string().optional(),
  notes: z.array(z.unknown()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const crmEventTypeSchema = z.enum([
  "mentioned",
  "status_change",
  "note_added",
  "demo",
  "follow_up",
]);

export const crmEventSchema = z.object({
  id: z.string().uuid().optional(),
  lead_id: z.string().uuid(),
  event_type: crmEventTypeSchema,
  description: z.string(),
  source_transcript_id: z.string().uuid().optional(),
  actor: z.string().optional(),
});

// ── Inferred types ─────────────────────────────────────────────────

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type ExtractedActionItem = z.infer<typeof extractedActionItemSchema>;
export type ExtractedSalesMention = z.infer<typeof extractedSalesMentionSchema>;
export type ExtractedDecision = z.infer<typeof extractedDecisionSchema>;
export type TranscriptRecord = z.infer<typeof transcriptRecordSchema>;
export type CrmLead = z.infer<typeof crmLeadSchema>;
export type CrmLeadStatus = z.infer<typeof crmLeadStatusSchema>;
export type CrmEvent = z.infer<typeof crmEventSchema>;
export type SessionType = z.infer<typeof sessionTypeSchema>;
