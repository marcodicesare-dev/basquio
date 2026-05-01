import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";

export type ConversationRow = {
  id: string;
  workspace_id: string;
  workspace_scope_id: string | null;
  created_by: string | null;
  title: string | null;
  summary: string | null;
  messages: unknown[];
  last_message_at: string;
  archived_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export async function listConversations(params: {
  workspaceId?: string;
  scopeId?: string | null;
  limit?: number;
}): Promise<ConversationRow[]> {
  const workspaceId = params.workspaceId ?? BASQUIO_TEAM_WORKSPACE_ID;
  const limit = params.limit ?? 25;
  const db = getDb();
  let query = db
    .from("workspace_conversations")
    .select(
      "id, workspace_id, workspace_scope_id, created_by, title, summary, messages, last_message_at, archived_at, metadata, created_at, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (params.scopeId === null) {
    query = query.is("workspace_scope_id", null);
  } else if (typeof params.scopeId === "string") {
    query = query.eq("workspace_scope_id", params.scopeId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listConversations failed: ${error.message}`);
  return (data ?? []) as ConversationRow[];
}

export async function getConversation(id: string): Promise<ConversationRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("workspace_conversations")
    .select(
      "id, workspace_id, workspace_scope_id, created_by, title, summary, messages, last_message_at, archived_at, metadata, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getConversation failed: ${error.message}`);
  return data ? (data as ConversationRow) : null;
}

export type SaveConversationInput = {
  id: string;
  workspaceId?: string;
  scopeId?: string | null;
  createdBy: string;
  title?: string | null;
  summary?: string | null;
  messages: unknown[];
  metadata?: Record<string, unknown>;
};

export async function saveConversation(input: SaveConversationInput): Promise<ConversationRow> {
  const workspaceId = input.workspaceId ?? BASQUIO_TEAM_WORKSPACE_ID;
  const now = new Date().toISOString();
  const db = getDb();
  const { data, error } = await db
    .from("workspace_conversations")
    .upsert(
      {
        id: input.id,
        workspace_id: workspaceId,
        workspace_scope_id: input.scopeId ?? null,
        created_by: input.createdBy,
        title: input.title ?? null,
        summary: input.summary ?? null,
        messages: input.messages,
        last_message_at: now,
        metadata: input.metadata ?? {},
        updated_at: now,
      },
      { onConflict: "id" },
    )
    .select(
      "id, workspace_id, workspace_scope_id, created_by, title, summary, messages, last_message_at, archived_at, metadata, created_at, updated_at",
    )
    .single();
  if (error) throw new Error(`saveConversation failed: ${error.message}`);
  return data as ConversationRow;
}

export async function archiveConversation(id: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("workspace_conversations")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`archiveConversation failed: ${error.message}`);
}

/**
 * Lift the archived flag. Used by the sidebar context menu "Restore"
 * action and by the /workspace/chats archived tab.
 */
export async function unarchiveConversation(id: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("workspace_conversations")
    .update({ archived_at: null })
    .eq("id", id);
  if (error) throw new Error(`unarchiveConversation failed: ${error.message}`);
}

/**
 * Update the human-readable title shown in the sidebar and chat header.
 * Trims, clamps to 200 chars, treats empty string as "no title set" so
 * we fall back to the auto-title.
 */
export async function renameConversation(id: string, title: string | null): Promise<void> {
  const next = title?.trim() || null;
  if (next && next.length > 200) {
    throw new Error("renameConversation: title too long (max 200 chars).");
  }
  const db = getDb();
  const { error } = await db
    .from("workspace_conversations")
    .update({ title: next, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`renameConversation failed: ${error.message}`);
}

/**
 * Permanent delete. Used by the sidebar Trash action. Cascade FKs on
 * conversation_attachments + conversation_memory_facts handle the joins.
 * Prefer archiveConversation for the default action; this is the explicit
 * destructive path the user must confirm.
 */
export async function deleteConversation(id: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("workspace_conversations").delete().eq("id", id);
  if (error) throw new Error(`deleteConversation failed: ${error.message}`);
}

/**
 * Ensure a workspace_conversations row exists for the given id. Used by upload
 * and similar pre-chat hooks that want to reference the conversation (via FK)
 * before the first assistant turn fires saveConversation.
 *
 * Idempotent: calling on an existing id is a no-op that returns the existing
 * row. Never overwrites messages / title / scope on an existing conversation.
 */
export async function ensureConversationRow(input: {
  id: string;
  workspaceId?: string;
  scopeId?: string | null;
  createdBy: string;
}): Promise<ConversationRow> {
  const db = getDb();

  const existing = await getConversation(input.id);
  if (existing) {
    return existing;
  }

  const workspaceId = input.workspaceId ?? BASQUIO_TEAM_WORKSPACE_ID;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("workspace_conversations")
    .insert({
      id: input.id,
      workspace_id: workspaceId,
      workspace_scope_id: input.scopeId ?? null,
      created_by: input.createdBy,
      title: null,
      summary: null,
      messages: [],
      last_message_at: now,
      metadata: { seeded_by: "ensureConversationRow" },
    })
    .select(
      "id, workspace_id, workspace_scope_id, created_by, title, summary, messages, last_message_at, archived_at, metadata, created_at, updated_at",
    )
    .single();

  if (error) {
    // Race: another request created the row between our check and insert.
    // Re-fetch and return; the insert's unique constraint would have caught it.
    if (error.code === "23505") {
      const fresh = await getConversation(input.id);
      if (fresh) return fresh;
    }
    throw new Error(`ensureConversationRow failed: ${error.message}`);
  }

  return data as ConversationRow;
}
