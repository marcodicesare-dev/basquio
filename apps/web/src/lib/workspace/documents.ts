import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";

export type AttachedWorkspaceFile = {
  documentId: string;
  filename: string;
  fileType: string | null;
  storagePath: string;
  anthropicFileId: string | null;
  buffer: Buffer;
  contentType: string;
};

export async function fetchAttachedFilesByDocumentIds(
  workspaceId: string,
  documentIds: string[],
): Promise<AttachedWorkspaceFile[]> {
  const ids = Array.from(new Set(documentIds)).slice(0, 8);
  if (ids.length === 0) return [];

  const db = getDb();
  const { data, error } = await db
    .from("knowledge_documents")
    .select("id, filename, file_type, storage_path, status, anthropic_file_id")
    .eq("workspace_id", workspaceId)
    .in("id", ids);

  if (error) {
    throw new Error(`fetchAttachedFilesByDocumentIds failed: ${error.message}`);
  }

  type Row = {
    id: string;
    filename: string | null;
    file_type: string | null;
    storage_path: string | null;
    status: string | null;
    anthropic_file_id: string | null;
  };

  const rows = ((data ?? []) as Row[]).filter(
    (row) => row.status === "indexed" && row.storage_path && row.filename,
  );

  const files: AttachedWorkspaceFile[] = [];
  for (const row of rows) {
    const { data: blob, error: downloadError } = await db.storage
      .from("knowledge-base")
      .download(row.storage_path as string);
    if (downloadError || !blob) {
      throw new Error(
        `Could not download ${row.filename ?? row.id}: ${downloadError?.message ?? "missing blob"}`,
      );
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    files.push({
      documentId: row.id,
      filename: row.filename as string,
      fileType: row.file_type,
      storagePath: row.storage_path as string,
      anthropicFileId: row.anthropic_file_id,
      buffer,
      contentType: guessContentType(row.file_type ?? row.filename ?? ""),
    });
  }
  return files;
}

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

function guessContentType(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes("/")) return lower;
  if (lower.endsWith(".pdf") || lower === "pdf") return "application/pdf";
  if (lower.endsWith(".docx") || lower === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".pptx") || lower === "pptx")
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".xlsx") || lower === "xlsx")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls") || lower === "xls") return "application/vnd.ms-excel";
  if (lower.endsWith(".csv") || lower === "csv") return "text/csv";
  if (lower.endsWith(".md") || lower === "md") return "text/markdown";
  if (lower.endsWith(".txt") || lower === "txt" || lower.endsWith(".gsp") || lower === "gsp")
    return "text/plain";
  if (lower.endsWith(".json") || lower === "json") return "application/json";
  if (lower.endsWith(".png") || lower === "png") return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower === "jpg" || lower === "jpeg")
    return "image/jpeg";
  if (lower.endsWith(".webp") || lower === "webp") return "image/webp";
  return "application/octet-stream";
}
