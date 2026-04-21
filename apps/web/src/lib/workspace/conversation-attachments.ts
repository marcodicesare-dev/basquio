import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";

export type ConversationAttachmentRow = {
  id: string;
  conversation_id: string;
  document_id: string;
  workspace_id: string;
  workspace_scope_id: string | null;
  uploaded_by: string | null;
  origin: "chat-drop" | "chat-paste" | "referenced-from-workspace";
  attached_at: string;
  metadata: Record<string, unknown>;
};

export type ConversationAttachmentWithDocument = ConversationAttachmentRow & {
  filename: string | null;
  status: string | null;
  file_type: string | null;
  file_size_bytes: number | null;
  storage_path: string | null;
  inline_excerpt: string | null;
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role is not configured.");
  }
  return createServiceSupabaseClient(url, key);
}

export type RecordConversationAttachmentInput = {
  conversationId: string;
  documentId: string;
  workspaceId?: string;
  workspaceScopeId?: string | null;
  uploadedBy?: string | null;
  origin?: ConversationAttachmentRow["origin"];
  metadata?: Record<string, unknown>;
};

/**
 * Attach a knowledge_document to a workspace_conversation. Idempotent via the
 * unique (conversation_id, document_id) constraint: re-attaching the same
 * document is a no-op from the caller's perspective.
 *
 * Returns null when the conversation row does not exist yet (first turn where
 * the chat client has minted a client-side UUID but the server hasn't persisted
 * a workspace_conversations row). In that case the upload path records nothing;
 * the file is still uploaded and indexed at the workspace level and will surface
 * via workspace retrieval once the conversation row lands on chat finish.
 */
export async function recordConversationAttachment(
  input: RecordConversationAttachmentInput,
): Promise<ConversationAttachmentRow | null> {
  if (!isUuid(input.conversationId) || !isUuid(input.documentId)) {
    return null;
  }

  const db = getDb();

  // Only attach if the conversation exists; referencing a non-existent
  // conversation would fail the FK check loudly. We treat the missing-row case
  // as "not yet, skip" so uploads never fail on a race.
  const { data: conversation } = await db
    .from("workspace_conversations")
    .select("id, workspace_id, workspace_scope_id")
    .eq("id", input.conversationId)
    .maybeSingle();

  if (!conversation) {
    return null;
  }

  const workspaceId =
    input.workspaceId ??
    ((conversation as { workspace_id: string | null }).workspace_id ?? BASQUIO_TEAM_WORKSPACE_ID);
  const workspaceScopeId =
    input.workspaceScopeId ??
    ((conversation as { workspace_scope_id: string | null }).workspace_scope_id ?? null);

  const { data, error } = await db
    .from("conversation_attachments")
    .upsert(
      {
        conversation_id: input.conversationId,
        document_id: input.documentId,
        workspace_id: workspaceId,
        workspace_scope_id: workspaceScopeId,
        uploaded_by: input.uploadedBy ?? null,
        origin: input.origin ?? "chat-drop",
        metadata: input.metadata ?? {},
      },
      { onConflict: "conversation_id,document_id" },
    )
    .select(
      "id, conversation_id, document_id, workspace_id, workspace_scope_id, uploaded_by, origin, attached_at, metadata",
    )
    .single();

  if (error) {
    throw new Error(`recordConversationAttachment failed: ${error.message}`);
  }

  return data as ConversationAttachmentRow;
}

/**
 * List every knowledge_document attached to a conversation, newest first. Used
 * by both the chat retrieval rank-1 lane and the deck handoff pack builder.
 * Returns document metadata joined from knowledge_documents so callers don't
 * need a second round-trip.
 */
export async function listConversationAttachments(
  conversationId: string,
): Promise<ConversationAttachmentWithDocument[]> {
  if (!isUuid(conversationId)) {
    return [];
  }
  const db = getDb();

  const { data, error } = await db
    .from("conversation_attachments")
    .select(
      `
      id,
      conversation_id,
      document_id,
      workspace_id,
      workspace_scope_id,
      uploaded_by,
      origin,
      attached_at,
      metadata,
      knowledge_documents (
        filename,
        status,
        file_type,
        file_size_bytes,
        storage_path,
        inline_excerpt
      )
    `,
    )
    .eq("conversation_id", conversationId)
    .order("attached_at", { ascending: false });

  if (error) {
    throw new Error(`listConversationAttachments failed: ${error.message}`);
  }

  type JoinedDoc = {
    filename: string | null;
    status: string | null;
    file_type: string | null;
    file_size_bytes: number | null;
    storage_path: string | null;
    inline_excerpt: string | null;
  };

  // PostgREST returns the joined table as an array (even on FK-to-1) when the
  // relation is expressed inline. Normalize by taking the first row.
  type Joined = ConversationAttachmentRow & {
    knowledge_documents: JoinedDoc[] | JoinedDoc | null;
  };

  return ((data ?? []) as unknown as Joined[]).map((row) => {
    const doc = Array.isArray(row.knowledge_documents)
      ? (row.knowledge_documents[0] ?? null)
      : (row.knowledge_documents ?? null);
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      document_id: row.document_id,
      workspace_id: row.workspace_id,
      workspace_scope_id: row.workspace_scope_id,
      uploaded_by: row.uploaded_by,
      origin: row.origin,
      attached_at: row.attached_at,
      metadata: row.metadata ?? {},
      filename: doc?.filename ?? null,
      status: doc?.status ?? null,
      file_type: doc?.file_type ?? null,
      file_size_bytes: doc?.file_size_bytes ?? null,
      storage_path: doc?.storage_path ?? null,
      inline_excerpt: doc?.inline_excerpt ?? null,
    };
  });
}

/**
 * Count how many documents are attached to a conversation. Used by UI status
 * surfaces that don't need the full list.
 */
export async function countConversationAttachments(conversationId: string): Promise<number> {
  if (!isUuid(conversationId)) {
    return 0;
  }
  const db = getDb();
  const { count, error } = await db
    .from("conversation_attachments")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  if (error) {
    throw new Error(`countConversationAttachments failed: ${error.message}`);
  }
  return count ?? 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
