import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";

export type MemoryType = "procedural" | "semantic" | "episodic";

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  procedural: "Rules",
  semantic: "Facts",
  episodic: "Wins",
};

export const MEMORY_TYPE_DESCRIPTIONS: Record<MemoryType, string> = {
  procedural: "Things Basquio does for you, in your style.",
  semantic: "Things Basquio knows about your world.",
  episodic: "Things Basquio remembers from the last time.",
};

export type MemoryRow = {
  id: string;
  workspace_id: string;
  workspace_scope_id: string | null;
  scope: string;
  memory_type: MemoryType;
  path: string;
  content: string;
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

export async function listMemoryEntries(params: {
  workspaceId?: string;
  scopeId?: string;
  memoryType?: MemoryType;
  includeArchived?: boolean;
  limit?: number;
}): Promise<MemoryRow[]> {
  const workspaceId = params.workspaceId ?? BASQUIO_TEAM_WORKSPACE_ID;
  const limit = params.limit ?? 200;
  const db = getDb();

  let query = db
    .from("memory_entries")
    .select(
      "id, workspace_id, workspace_scope_id, scope, memory_type, path, content, metadata, created_at, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (params.scopeId) query = query.eq("workspace_scope_id", params.scopeId);
  if (params.memoryType) query = query.eq("memory_type", params.memoryType);

  const { data, error } = await query;
  if (error) throw new Error(`listMemoryEntries failed: ${error.message}`);
  const rows = (data ?? []) as MemoryRow[];
  if (params.includeArchived) return rows;
  return rows.filter((row) => !row.metadata?.archived_at);
}

export async function getMemoryEntry(id: string): Promise<MemoryRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("memory_entries")
    .select(
      "id, workspace_id, workspace_scope_id, scope, memory_type, path, content, metadata, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getMemoryEntry failed: ${error.message}`);
  return data ? (data as MemoryRow) : null;
}

export type CreateMemoryInput = {
  workspaceId?: string;
  workspaceScopeId: string;
  memoryType: MemoryType;
  content: string;
  path?: string;
  metadata?: Record<string, unknown>;
  scope?: string;
};

export async function createMemoryEntry(input: CreateMemoryInput): Promise<MemoryRow> {
  const workspaceId = input.workspaceId ?? BASQUIO_TEAM_WORKSPACE_ID;
  const path = input.path ?? generateMemoryPath(input.memoryType);
  const db = getDb();
  const { data, error } = await db
    .from("memory_entries")
    .insert({
      organization_id: workspaceId,
      is_team_beta: true,
      workspace_id: workspaceId,
      workspace_scope_id: input.workspaceScopeId,
      scope: input.scope ?? "workspace",
      memory_type: input.memoryType,
      path,
      content: input.content,
      metadata: input.metadata ?? {},
    })
    .select(
      "id, workspace_id, workspace_scope_id, scope, memory_type, path, content, metadata, created_at, updated_at",
    )
    .single();
  if (error) throw new Error(`createMemoryEntry failed: ${error.message}`);
  return data as MemoryRow;
}

export async function updateMemoryEntry(
  id: string,
  patch: { content?: string; memoryType?: MemoryType; metadata?: Record<string, unknown> },
): Promise<MemoryRow> {
  const db = getDb();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.content !== undefined) update.content = patch.content;
  if (patch.memoryType !== undefined) update.memory_type = patch.memoryType;
  if (patch.metadata !== undefined) update.metadata = patch.metadata;

  const { data, error } = await db
    .from("memory_entries")
    .update(update)
    .eq("id", id)
    .select(
      "id, workspace_id, workspace_scope_id, scope, memory_type, path, content, metadata, created_at, updated_at",
    )
    .single();
  if (error) throw new Error(`updateMemoryEntry failed: ${error.message}`);
  return data as MemoryRow;
}

export async function togglePinMemoryEntry(id: string, pin: boolean): Promise<MemoryRow> {
  const existing = await getMemoryEntry(id);
  if (!existing) throw new Error("Memory entry not found.");
  const metadata = { ...(existing.metadata ?? {}) };
  if (pin) {
    metadata.pinned_at = new Date().toISOString();
  } else {
    delete metadata.pinned_at;
  }
  return updateMemoryEntry(id, { metadata });
}

export async function archiveMemoryEntry(id: string): Promise<MemoryRow> {
  const existing = await getMemoryEntry(id);
  if (!existing) throw new Error("Memory entry not found.");
  const metadata = { ...(existing.metadata ?? {}), archived_at: new Date().toISOString() };
  return updateMemoryEntry(id, { metadata });
}

export async function deleteMemoryEntry(id: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("memory_entries").delete().eq("id", id);
  if (error) throw new Error(`deleteMemoryEntry failed: ${error.message}`);
}

function generateMemoryPath(memoryType: MemoryType): string {
  const folder =
    memoryType === "procedural" ? "preferences" : memoryType === "semantic" ? "facts" : "wins";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `/${folder}/${ts}.md`;
}

export function isPinned(row: MemoryRow): boolean {
  return typeof row.metadata?.pinned_at === "string";
}

export function isArchived(row: MemoryRow): boolean {
  return typeof row.metadata?.archived_at === "string";
}
