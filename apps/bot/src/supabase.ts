import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ExtractionResult,
  ExtractedDecision,
  ExtractedSalesMention,
} from "@basquio/types";
import { env } from "./config.js";
import type { HybridSearchRow } from "./kb-types.js";

let supabase: SupabaseClient;

function getClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return supabase;
}

// ── Transcripts ────────────────────────────────────────────────────

export interface SaveTranscriptInput {
  sessionType: "voice" | "text" | "livechat";
  startedAt: Date;
  endedAt: Date;
  participants: string[];
  rawTranscript: string;
  extraction: ExtractionResult;
  audioStoragePath?: string;
  discordMessageId?: string;
  metadata?: Record<string, unknown>;
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
      metadata: input.metadata ?? {},
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

/**
 * Generate a signed URL for a voice recording (7-day expiry).
 * The bucket is private so raw URLs return 404.
 */
export async function getSignedAudioUrl(path: string): Promise<string | null> {
  const db = getClient();
  const { data, error } = await db.storage
    .from("voice-recordings")
    .createSignedUrl(path, 7 * 24 * 60 * 60); // 7 days
  if (error || !data?.signedUrl) {
    console.error(`Failed to sign audio URL for ${path}:`, error);
    return null;
  }
  return data.signedUrl;
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

// ── Knowledge Base ──────────────────────────────────────────────

export async function uploadKbFile(buffer: Buffer, path: string, contentType: string): Promise<void> {
  const db = getClient();
  const { error } = await db.storage
    .from("knowledge-base")
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Failed to upload KB file: ${error.message}`);
}

export async function createDocument(input: {
  filename: string;
  fileType: string;
  fileSizeBytes: number;
  storagePath: string;
  uploadedBy: string;
  uploadedByDiscordId: string;
  uploadContext?: string;
  contentHash: string;
}): Promise<string> {
  const db = getClient();
  const { data, error } = await db
    .from("knowledge_documents")
    .insert({
      filename: input.filename,
      file_type: input.fileType,
      file_size_bytes: input.fileSizeBytes,
      storage_path: input.storagePath,
      uploaded_by: input.uploadedBy,
      uploaded_by_discord_id: input.uploadedByDiscordId,
      upload_context: input.uploadContext ?? null,
      content_hash: input.contentHash,
      status: "processing",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create document: ${error.message}`);
  return data.id;
}

export async function insertChunks(
  documentId: string,
  chunks: Array<{ content: string; embedding: number[]; metadata: Record<string, unknown> }>,
): Promise<void> {
  const db = getClient();
  const rows = chunks.map((c, i) => ({
    document_id: documentId,
    chunk_index: i,
    content: c.content,
    embedding: JSON.stringify(c.embedding),
    token_count: Math.ceil(c.content.length / 4),
    metadata: c.metadata,
  }));
  const { error } = await db.from("knowledge_chunks").insert(rows);
  if (error) throw new Error(`Failed to insert chunks: ${error.message}`);
}

export async function updateDocumentStatus(
  docId: string,
  status: "indexed" | "failed",
  opts?: { chunkCount?: number; pageCount?: number; errorMessage?: string },
): Promise<void> {
  const db = getClient();
  const { error } = await db
    .from("knowledge_documents")
    .update({
      status,
      chunk_count: opts?.chunkCount ?? undefined,
      page_count: opts?.pageCount ?? undefined,
      error_message: opts?.errorMessage ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", docId);
  if (error) console.error(`Failed to update document status: ${error.message}`);
}

export async function findDocumentByHash(hash: string): Promise<{ id: string; status: string } | null> {
  const db = getClient();
  const { data } = await db
    .from("knowledge_documents")
    .select("id, status")
    .eq("content_hash", hash)
    .limit(1)
    .maybeSingle();
  return data;
}

export async function hybridSearch(
  queryText: string,
  queryEmbedding: number[],
  matchCount = 10,
): Promise<HybridSearchRow[]> {
  const db = getClient();
  const { data, error } = await db.rpc("hybrid_search", {
    query_text: queryText,
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: matchCount,
  });
  if (error) throw new Error(`Hybrid search failed: ${error.message}`);
  return data ?? [];
}

export async function getDocumentMeta(docId: string): Promise<{
  filename: string;
  storage_path: string;
  file_type: string;
} | null> {
  const db = getClient();
  const { data } = await db
    .from("knowledge_documents")
    .select("filename, storage_path, file_type")
    .eq("id", docId)
    .maybeSingle();
  return data;
}

/**
 * List all indexed document filenames (for AI intent classification).
 */
export async function listIndexedDocuments(): Promise<Array<{ id: string; filename: string }>> {
  const db = getClient();
  const { data } = await db
    .from("knowledge_documents")
    .select("id, filename")
    .eq("status", "indexed")
    .order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * Fetch all chunks for a specific document by ID, in order.
 */
export async function getDocumentChunksById(
  docId: string,
): Promise<Array<{ content: string; metadata: Record<string, unknown> }>> {
  const db = getClient();
  const { data } = await db
    .from("knowledge_chunks")
    .select("content, metadata")
    .eq("document_id", docId)
    .order("chunk_index", { ascending: true });
  return (data ?? []) as Array<{ content: string; metadata: Record<string, unknown> }>;
}

export async function getTranscriptMeta(transcriptId: string): Promise<{
  started_at: string;
  participants: string[];
  session_type: "voice" | "text" | "livechat";
} | null> {
  const db = getClient();
  const { data } = await db
    .from("transcripts")
    .select("started_at, participants, session_type")
    .eq("id", transcriptId)
    .maybeSingle();
  return data;
}

// ── Intercom Thread Mapping ─────────────────────────────────────

export interface IntercomThreadRecord {
  intercom_conversation_id: string;
  discord_thread_id: string;
  customer_name: string | null;
  customer_email: string | null;
  status: string;
  last_customer_message_signature: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export async function getIntercomThreadByDiscordThreadId(
  discordThreadId: string,
): Promise<IntercomThreadRecord | null> {
  const db = getClient();
  const { data, error } = await db
    .from("intercom_threads")
    .select(
      "intercom_conversation_id, discord_thread_id, customer_name, customer_email, status, last_customer_message_signature, metadata, created_at, updated_at",
    )
    .eq("discord_thread_id", discordThreadId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load Intercom thread mapping: ${error.message}`);
  }

  return data as IntercomThreadRecord | null;
}

// ── Transcript Embedding ────────────────────────────────────────

export async function insertTranscriptChunks(
  transcriptId: string,
  chunks: Array<{ content: string; embedding: number[]; speaker?: string; metadata: Record<string, unknown> }>,
): Promise<void> {
  const db = getClient();
  const rows = chunks.map((c, i) => ({
    transcript_id: transcriptId,
    chunk_index: i,
    content: c.content,
    embedding: JSON.stringify(c.embedding),
    speaker: c.speaker ?? null,
    metadata: c.metadata,
  }));
  const { error } = await db.from("transcript_chunks").insert(rows);
  if (error) throw new Error(`Failed to insert transcript chunks: ${error.message}`);
}

export async function hasTranscriptChunks(transcriptId: string): Promise<boolean> {
  const db = getClient();
  const { count } = await db
    .from("transcript_chunks")
    .select("id", { count: "exact", head: true })
    .eq("transcript_id", transcriptId);
  return (count ?? 0) > 0;
}

export async function getAllTranscripts(): Promise<Array<{
  id: string;
  raw_transcript: string;
  participants: string[];
}>> {
  const db = getClient();
  const all: Array<{ id: string; raw_transcript: string; participants: string[] }> = [];
  let from = 0;
  const PAGE = 50;

  while (true) {
    const { data, error } = await db
      .from("transcripts")
      .select("id, raw_transcript, participants")
      .order("started_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to fetch transcripts: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return all;
}
