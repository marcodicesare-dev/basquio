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

export type WorkspaceEntityRow = {
  id: string;
  type: string;
  canonical_name: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type EntityWithCount = WorkspaceEntityRow & {
  mention_count: number;
  fact_count: number;
};

export async function listWorkspaceEntitiesGrouped(): Promise<Record<string, EntityWithCount[]>> {
  const db = getServiceClient();

  const { data: entities, error: entityError } = await db
    .from("entities")
    .select("id, type, canonical_name, aliases, metadata, created_at")
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("is_team_beta", true)
    .order("created_at", { ascending: false })
    .limit(500);

  if (entityError) {
    throw new Error(`Failed to list workspace entities: ${entityError.message}`);
  }

  const rows = (entities ?? []) as WorkspaceEntityRow[];
  if (rows.length === 0) return {};

  const entityIds = rows.map((row) => row.id);

  const [{ data: mentions }, { data: facts }] = await Promise.all([
    db
      .from("entity_mentions")
      .select("entity_id")
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
      .in("entity_id", entityIds),
    db
      .from("facts")
      .select("subject_entity")
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
      .in("subject_entity", entityIds),
  ]);

  const mentionCounts = new Map<string, number>();
  for (const row of mentions ?? []) {
    const id = (row as { entity_id: string }).entity_id;
    mentionCounts.set(id, (mentionCounts.get(id) ?? 0) + 1);
  }

  const factCounts = new Map<string, number>();
  for (const row of facts ?? []) {
    const id = (row as { subject_entity: string }).subject_entity;
    factCounts.set(id, (factCounts.get(id) ?? 0) + 1);
  }

  const grouped: Record<string, EntityWithCount[]> = {};
  for (const row of rows) {
    const enriched: EntityWithCount = {
      ...row,
      mention_count: mentionCounts.get(row.id) ?? 0,
      fact_count: factCounts.get(row.id) ?? 0,
    };
    if (!grouped[row.type]) grouped[row.type] = [];
    grouped[row.type].push(enriched);
  }

  for (const type of Object.keys(grouped)) {
    grouped[type].sort((a, b) => {
      if (b.mention_count !== a.mention_count) return b.mention_count - a.mention_count;
      return a.canonical_name.localeCompare(b.canonical_name);
    });
  }

  return grouped;
}

export type EntityDetail = WorkspaceEntityRow & {
  mentions: Array<{
    id: string;
    source_type: string;
    source_id: string;
    excerpt: string | null;
    created_at: string;
    document_filename: string | null;
  }>;
  facts: Array<{
    id: string;
    predicate: string;
    object_value: unknown;
    valid_from: string | null;
    valid_to: string | null;
    confidence: number;
    metadata: Record<string, unknown>;
    source_id: string | null;
    source_type: string | null;
    document_filename: string | null;
  }>;
};

export async function getWorkspaceEntityDetail(entityId: string): Promise<EntityDetail | null> {
  const db = getServiceClient();

  const { data: entity, error: entityError } = await db
    .from("entities")
    .select("id, type, canonical_name, aliases, metadata, created_at")
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("id", entityId)
    .maybeSingle();

  if (entityError) {
    throw new Error(`Failed to load entity: ${entityError.message}`);
  }
  if (!entity) return null;

  const [{ data: mentions }, { data: facts }] = await Promise.all([
    db
      .from("entity_mentions")
      .select("id, source_type, source_id, excerpt, created_at")
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("facts")
      .select(
        "id, predicate, object_value, valid_from, valid_to, confidence, metadata, source_id, source_type",
      )
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
      .eq("subject_entity", entityId)
      .order("ingested_at", { ascending: false })
      .limit(50),
  ]);

  const documentIds = new Set<string>();
  for (const m of mentions ?? []) {
    if ((m as { source_type: string }).source_type === "document") {
      documentIds.add((m as { source_id: string }).source_id);
    }
  }
  for (const f of facts ?? []) {
    if ((f as { source_type: string | null }).source_type === "document" && (f as { source_id: string | null }).source_id) {
      documentIds.add((f as { source_id: string }).source_id);
    }
  }

  let filenameById = new Map<string, string>();
  if (documentIds.size > 0) {
    const { data: docs } = await db
      .from("knowledge_documents")
      .select("id, filename")
      .in("id", Array.from(documentIds));
    filenameById = new Map((docs ?? []).map((d) => [(d as { id: string }).id, (d as { filename: string }).filename]));
  }

  return {
    ...(entity as WorkspaceEntityRow),
    mentions: (mentions ?? []).map((m) => ({
      id: (m as { id: string }).id,
      source_type: (m as { source_type: string }).source_type,
      source_id: (m as { source_id: string }).source_id,
      excerpt: (m as { excerpt: string | null }).excerpt,
      created_at: (m as { created_at: string }).created_at,
      document_filename:
        (m as { source_type: string }).source_type === "document"
          ? filenameById.get((m as { source_id: string }).source_id) ?? null
          : null,
    })),
    facts: (facts ?? []).map((f) => ({
      id: (f as { id: string }).id,
      predicate: (f as { predicate: string }).predicate,
      object_value: (f as { object_value: unknown }).object_value,
      valid_from: (f as { valid_from: string | null }).valid_from,
      valid_to: (f as { valid_to: string | null }).valid_to,
      confidence: (f as { confidence: number }).confidence,
      metadata: ((f as { metadata: Record<string, unknown> }).metadata ?? {}) as Record<string, unknown>,
      source_id: (f as { source_id: string | null }).source_id,
      source_type: (f as { source_type: string | null }).source_type,
      document_filename:
        (f as { source_type: string | null }).source_type === "document" && (f as { source_id: string | null }).source_id
          ? filenameById.get((f as { source_id: string }).source_id) ?? null
          : null,
    })),
  };
}

export function countProcessingDocuments(documents: WorkspaceDocumentRow[]): number {
  return documents.filter((d) => d.status === "processing").length;
}
