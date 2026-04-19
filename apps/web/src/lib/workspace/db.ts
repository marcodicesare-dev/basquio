import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID } from "@/lib/workspace/constants";

export type WorkspaceDocumentRow = {
  id: string;
  filename: string;
  file_type: string;
  file_size_bytes: number;
  storage_path: string;
  uploaded_by: string;
  uploaded_by_user_id: string | null;
  upload_context: string | null;
  status: "processing" | "indexed" | "failed" | "deleted";
  chunk_count: number | null;
  page_count: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role is not configured.");
  }
  return createServiceSupabaseClient(url, key);
}

export async function listRecentWorkspaceDocuments(limit = 20): Promise<WorkspaceDocumentRow[]> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("knowledge_documents")
    .select(
      "id, filename, file_type, file_size_bytes, storage_path, uploaded_by, uploaded_by_user_id, upload_context, status, chunk_count, page_count, error_message, metadata, created_at",
    )
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("is_team_beta", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list workspace documents: ${error.message}`);
  }

  return (data ?? []) as WorkspaceDocumentRow[];
}

export async function findWorkspaceDocumentByHash(hash: string): Promise<WorkspaceDocumentRow | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("knowledge_documents")
    .select(
      "id, filename, file_type, file_size_bytes, storage_path, uploaded_by, uploaded_by_user_id, upload_context, status, chunk_count, page_count, error_message, metadata, created_at",
    )
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("is_team_beta", true)
    .eq("content_hash", hash)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find workspace document by hash: ${error.message}`);
  }

  return (data ?? null) as WorkspaceDocumentRow | null;
}

export type CreateWorkspaceDocumentInput = {
  filename: string;
  fileType: string;
  fileSizeBytes: number;
  storagePath: string;
  contentHash: string;
  uploadedByEmail: string;
  uploadedByUserId: string;
  uploadContext?: string | null;
};

export async function createWorkspaceDocument(input: CreateWorkspaceDocumentInput): Promise<string> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("knowledge_documents")
    .insert({
      filename: input.filename,
      file_type: input.fileType,
      file_size_bytes: input.fileSizeBytes,
      storage_path: input.storagePath,
      content_hash: input.contentHash,
      uploaded_by: input.uploadedByEmail,
      uploaded_by_user_id: input.uploadedByUserId,
      uploaded_by_discord_id: null,
      upload_context: input.uploadContext ?? null,
      organization_id: BASQUIO_TEAM_ORG_ID,
      is_team_beta: true,
      status: "processing",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create workspace document: ${error.message}`);
  }

  return data.id as string;
}

export async function uploadWorkspaceFileToStorage(
  buffer: Buffer,
  storagePath: string,
  contentType: string,
): Promise<void> {
  const db = getServiceClient();
  const { error } = await db.storage
    .from("knowledge-base")
    .upload(storagePath, buffer, { contentType, upsert: false });
  if (error) {
    throw new Error(`Failed to upload file to storage: ${error.message}`);
  }
}
