import "server-only";

import type { createServiceSupabaseClient } from "@/lib/supabase/admin";
import type { ViewerState } from "@/lib/supabase/auth";
import { getCurrentWorkspace, type WorkspaceRow } from "@/lib/workspace/workspaces";

type ServiceDb = ReturnType<typeof createServiceSupabaseClient>;

export type WorkspaceDocumentAccessRow = {
  id: string;
  filename: string | null;
  file_type: string | null;
  storage_path: string | null;
  status: string | null;
  workspace_id: string | null;
  organization_id: string | null;
  is_team_beta: boolean | null;
};

export async function resolveWorkspaceDocumentAccess({
  db,
  documentId,
  conversationId,
  viewer,
}: {
  db: ServiceDb;
  documentId: string;
  conversationId: string | null;
  viewer?: ViewerState | null;
}): Promise<WorkspaceDocumentAccessRow | null> {
  const workspace = await getCurrentWorkspace(viewer ?? null);
  if (conversationId) {
    return resolveConversationDocument(db, workspace, documentId, conversationId);
  }
  return resolveRepositoryDocument(db, workspace, documentId);
}

async function resolveConversationDocument(
  db: ServiceDb,
  workspace: WorkspaceRow,
  documentId: string,
  conversationId: string,
): Promise<WorkspaceDocumentAccessRow | null> {
  const { data: attachment, error } = await db
    .from("conversation_attachments")
    .select(`
      id,
      workspace_id,
      conversation_id,
      document_id,
      knowledge_documents (
        id,
        filename,
        file_type,
        storage_path,
        status,
        workspace_id,
        organization_id,
        is_team_beta
      )
    `)
    .eq("conversation_id", conversationId)
    .eq("document_id", documentId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  const doc = Array.isArray(attachment?.knowledge_documents)
    ? attachment.knowledge_documents[0]
    : attachment?.knowledge_documents;
  if (error || !attachment || !doc) return null;
  return canAccessDocument(doc as WorkspaceDocumentAccessRow, workspace)
    ? (doc as WorkspaceDocumentAccessRow)
    : null;
}

async function resolveRepositoryDocument(
  db: ServiceDb,
  workspace: WorkspaceRow,
  documentId: string,
): Promise<WorkspaceDocumentAccessRow | null> {
  const { data: doc, error } = await db
    .from("knowledge_documents")
    .select(
      "id, filename, file_type, storage_path, status, workspace_id, organization_id, is_team_beta",
    )
    .eq("id", documentId)
    .eq("organization_id", workspace.organization_id)
    .neq("status", "deleted")
    .maybeSingle();

  if (error || !doc) return null;
  return canAccessDocument(doc as WorkspaceDocumentAccessRow, workspace)
    ? (doc as WorkspaceDocumentAccessRow)
    : null;
}

function canAccessDocument(doc: WorkspaceDocumentAccessRow, workspace: WorkspaceRow): boolean {
  if (doc.status === "deleted") return false;
  if (doc.workspace_id && doc.workspace_id !== workspace.id) return false;
  if (doc.organization_id && doc.organization_id !== workspace.organization_id) return false;
  return true;
}
