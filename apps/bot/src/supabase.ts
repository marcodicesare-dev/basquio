import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ExtractionResult,
  ExtractedDecision,
  ExtractedSalesMention,
} from "@basquio/types";
import { env } from "./config.js";

let supabase: SupabaseClient;

function getClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return supabase;
}

// ── Transcripts ────────────────────────────────────────────────────

export interface SaveTranscriptInput {
  sessionType: "voice" | "text";
  startedAt: Date;
  endedAt: Date;
  participants: string[];
  rawTranscript: string;
  extraction: ExtractionResult;
  audioStoragePath?: string;
  discordMessageId?: string;
}

export async function saveTranscript(input: SaveTranscriptInput): Promise<string> {
  const db = getClient();

  const { data, error } = await db
    .from("transcripts")
    .insert({
      session_type: input.sessionType,
      started_at: input.startedAt.toISOString(),
      ended_at: input.endedAt.toISOString(),
      duration_seconds: Math.round((input.endedAt.getTime() - input.startedAt.getTime()) / 1000),
      participants: input.participants,
      raw_transcript: input.rawTranscript,
      ai_summary: input.extraction.summary,
      decisions: input.extraction.decisions,
      action_items: input.extraction.action_items,
      key_quotes: input.extraction.key_quotes,
      sales_mentions: input.extraction.sales_mentions,
      audio_storage_path: input.audioStoragePath ?? null,
      discord_message_id: input.discordMessageId ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to save transcript: ${error.message}`);
  return data.id;
}

// ── CRM Leads ──────────────────────────────────────────────────────

export async function upsertLead(
  mention: ExtractedSalesMention,
  transcriptId: string,
): Promise<string> {
  const db = getClient();

  // Check if lead already exists
  const { data: existing } = await db
    .from("crm_leads")
    .select("id, status")
    .ilike("company_name", mention.company)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Update existing lead
    await db
      .from("crm_leads")
      .update({
        last_mentioned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(mention.owner ? { owner: mention.owner } : {}),
      })
      .eq("id", existing.id);

    // Add event
    await addCrmEvent(existing.id, {
      event_type: "mentioned",
      description: mention.context,
      source_transcript_id: transcriptId,
      actor: mention.owner,
    });

    return existing.id;
  }

  // Create new lead
  const { data, error } = await db
    .from("crm_leads")
    .insert({
      company_name: mention.company,
      status: mention.status ?? "mentioned",
      owner: mention.owner ?? null,
      context: mention.context,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create lead: ${error.message}`);

  // Add initial event
  await addCrmEvent(data.id, {
    event_type: "mentioned",
    description: mention.context,
    source_transcript_id: transcriptId,
    actor: mention.owner,
  });

  return data.id;
}

// ── CRM Events ─────────────────────────────────────────────────────

interface CrmEventInput {
  event_type: string;
  description: string;
  source_transcript_id?: string;
  actor?: string;
}

async function addCrmEvent(leadId: string, event: CrmEventInput): Promise<void> {
  const db = getClient();
  const { error } = await db.from("crm_events").insert({
    lead_id: leadId,
    ...event,
  });
  if (error) console.error(`Failed to add CRM event: ${error.message}`);
}

// ── Decisions ──────────────────────────────────────────────────────

export async function saveDecisions(
  decisions: ExtractedDecision[],
  transcriptId: string,
): Promise<void> {
  if (decisions.length === 0) return;

  const db = getClient();
  const rows = decisions.map((d) => ({
    decision: d.decision,
    context: d.context ?? null,
    participants: d.participants,
    source_transcript_id: transcriptId,
    category: d.category ?? "general",
  }));

  const { error } = await db.from("decisions").insert(rows);
  if (error) console.error(`Failed to save decisions: ${error.message}`);
}

// ── Audio Storage ──────────────────────────────────────────────────

export async function uploadAudio(buffer: Buffer, path: string): Promise<string> {
  const db = getClient();

  const { error } = await db.storage
    .from("voice-recordings")
    .upload(path, buffer, { contentType: "audio/mpeg", upsert: false });

  if (error) throw new Error(`Failed to upload audio: ${error.message}`);
  return path;
}

// ── Search ─────────────────────────────────────────────────────────

export async function searchTranscripts(
  query: string,
  limit = 10,
): Promise<Array<{ id: string; ai_summary: string; started_at: string; participants: string[] }>> {
  const db = getClient();

  const { data, error } = await db
    .from("transcripts")
    .select("id, ai_summary, started_at, participants")
    .textSearch("raw_transcript", query, { type: "websearch" })
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Search failed: ${error.message}`);
  return data ?? [];
}

// ── Weekly Digest Aggregation ──────────────────────────────────────

export interface WeeklyDigest {
  sessionCount: number;
  totalMinutes: number;
  issueCount: number;
  decisionCount: number;
  leadCount: number;
  topQuotes: string[];
}

export async function getWeeklyDigest(): Promise<WeeklyDigest> {
  const db = getClient();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [transcripts, decisions, leads] = await Promise.all([
    db
      .from("transcripts")
      .select("id, duration_seconds, key_quotes, action_items")
      .gte("started_at", oneWeekAgo),
    db.from("decisions").select("id").gte("created_at", oneWeekAgo),
    db.from("crm_leads").select("id").gte("created_at", oneWeekAgo),
  ]);

  const sessions = transcripts.data ?? [];
  const totalSeconds = sessions.reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0);
  const allQuotes = sessions.flatMap((s) => (s.key_quotes as string[]) ?? []);
  const allActionItems = sessions.flatMap((s) => (s.action_items as unknown[]) ?? []);

  return {
    sessionCount: sessions.length,
    totalMinutes: Math.round(totalSeconds / 60),
    issueCount: allActionItems.length,
    decisionCount: decisions.data?.length ?? 0,
    leadCount: leads.data?.length ?? 0,
    topQuotes: allQuotes.slice(0, 5),
  };
}
