import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import {
  BASQUIO_TEAM_WORKSPACE_ID,
  type ScopeKind,
  SCOPE_KIND_LABELS,
} from "@/lib/workspace/constants";
import type { ScopeCounts, ScopeTree, WorkspaceScope } from "@/lib/workspace/types";

export type { ScopeCounts, ScopeTree, WorkspaceScope };

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function listScopes(
  workspaceId: string = BASQUIO_TEAM_WORKSPACE_ID,
): Promise<WorkspaceScope[]> {
  const db = getDb();
  const { data, error } = await db
    .from("workspace_scopes")
    .select("id, workspace_id, kind, name, slug, parent_scope_id, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`listScopes failed: ${error.message}`);
  return (data ?? []) as WorkspaceScope[];
}

export async function listScopesGrouped(
  workspaceId: string = BASQUIO_TEAM_WORKSPACE_ID,
): Promise<ScopeTree> {
  const all = await listScopes(workspaceId);
  const tree: ScopeTree = { client: [], category: [], function: [], system: [] };
  for (const scope of all) {
    tree[scope.kind].push(scope);
  }
  return tree;
}

export async function getScope(scopeId: string): Promise<WorkspaceScope | null> {
  const db = getDb();
  const { data, error } = await db
    .from("workspace_scopes")
    .select("id, workspace_id, kind, name, slug, parent_scope_id, metadata, created_at")
    .eq("id", scopeId)
    .maybeSingle();
  if (error) throw new Error(`getScope failed: ${error.message}`);
  return data ? (data as WorkspaceScope) : null;
}

export async function getScopeByKindSlug(
  workspaceId: string,
  kind: ScopeKind,
  slug: string,
): Promise<WorkspaceScope | null> {
  const db = getDb();
  const { data, error } = await db
    .from("workspace_scopes")
    .select("id, workspace_id, kind, name, slug, parent_scope_id, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .eq("kind", kind)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`getScopeByKindSlug failed: ${error.message}`);
  return data ? (data as WorkspaceScope) : null;
}

export async function createScope(input: {
  workspaceId?: string;
  kind: ScopeKind;
  name: string;
  slug?: string;
  parentScopeId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<WorkspaceScope> {
  const workspaceId = input.workspaceId ?? BASQUIO_TEAM_WORKSPACE_ID;
  const slug = input.slug ?? slugify(input.name);
  if (!slug) throw new Error("Cannot derive a slug from the given name.");

  const db = getDb();
  const { data, error } = await db
    .from("workspace_scopes")
    .insert({
      workspace_id: workspaceId,
      kind: input.kind,
      name: input.name,
      slug,
      parent_scope_id: input.parentScopeId ?? null,
      metadata: input.metadata ?? {},
    })
    .select("id, workspace_id, kind, name, slug, parent_scope_id, metadata, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`A scope already exists in ${SCOPE_KIND_LABELS[input.kind]} with slug "${slug}".`);
    }
    throw new Error(`createScope failed: ${error.message}`);
  }
  return data as WorkspaceScope;
}

export async function renameScope(scopeId: string, newName: string, newSlug?: string): Promise<WorkspaceScope> {
  const slug = newSlug ?? slugify(newName);
  const db = getDb();
  const { data, error } = await db
    .from("workspace_scopes")
    .update({ name: newName, slug })
    .eq("id", scopeId)
    .select("id, workspace_id, kind, name, slug, parent_scope_id, metadata, created_at")
    .single();
  if (error) throw new Error(`renameScope failed: ${error.message}`);
  return data as WorkspaceScope;
}

export async function deleteScope(scopeId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("workspace_scopes").delete().eq("id", scopeId);
  if (error) throw new Error(`deleteScope failed: ${error.message}`);
}

/**
 * Scope counts for left-rail badges. Counts memory entries and deliverables per scope
 * for the current workspace. Used by WorkspaceSidebar to render "12 rules, 4 answers".
 * Type lives in lib/workspace/types.ts.
 */
export async function countByScope(
  workspaceId: string = BASQUIO_TEAM_WORKSPACE_ID,
): Promise<Map<string, ScopeCounts>> {
  const db = getDb();
  const [memoryRes, deliverableRes, factRes] = await Promise.all([
    db
      .from("memory_entries")
      .select("workspace_scope_id")
      .eq("workspace_id", workspaceId)
      .not("workspace_scope_id", "is", null),
    db
      .from("workspace_deliverables")
      .select("workspace_scope_id")
      .eq("workspace_id", workspaceId)
      .neq("status", "archived")
      .not("workspace_scope_id", "is", null),
    db
      .from("facts")
      .select("workspace_scope_id")
      .eq("workspace_id", workspaceId)
      .is("superseded_by", null)
      .not("workspace_scope_id", "is", null),
  ]);

  const counts = new Map<string, ScopeCounts>();
  function bump(scopeId: string, field: keyof Omit<ScopeCounts, "scope_id">) {
    let row = counts.get(scopeId);
    if (!row) {
      row = { scope_id: scopeId, memory_count: 0, deliverable_count: 0, fact_count: 0 };
      counts.set(scopeId, row);
    }
    row[field] += 1;
  }

  for (const row of (memoryRes.data ?? []) as Array<{ workspace_scope_id: string }>) {
    bump(row.workspace_scope_id, "memory_count");
  }
  for (const row of (deliverableRes.data ?? []) as Array<{ workspace_scope_id: string }>) {
    bump(row.workspace_scope_id, "deliverable_count");
  }
  for (const row of (factRes.data ?? []) as Array<{ workspace_scope_id: string }>) {
    bump(row.workspace_scope_id, "fact_count");
  }
  return counts;
}
