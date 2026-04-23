import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { isTeamBetaEmail } from "@/lib/team-beta";
import { BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";

export type WorkspaceRow = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  kind: "team_beta" | "demo_template" | "customer";
  template_id: string | null;
  visibility: "private" | "team" | "shareable_with_token";
  share_token: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export async function getWorkspace(workspaceId: string): Promise<WorkspaceRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("workspaces")
    .select(
      "id, organization_id, name, slug, kind, template_id, visibility, share_token, metadata, created_by, created_at, updated_at",
    )
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`getWorkspace failed: ${error.message}`);
  return data ? (data as WorkspaceRow) : null;
}

/**
 * V2 workspace resolution for the authenticated user.
 *
 * For V1 team beta: every @basquio.com user shares the single BASQUIO_TEAM_WORKSPACE_ID row.
 * For V2 customer / demo-template future: look up workspace membership by user_id.
 * This helper is the single read path new code uses; it isolates the lookup so the
 * membership migration is a one-file change.
 */
export async function getCurrentWorkspace(): Promise<WorkspaceRow> {
  const workspace = await getWorkspace(BASQUIO_TEAM_WORKSPACE_ID);
  if (!workspace) {
    throw new Error(
      "Team beta workspace row is missing. Check migration 20260420120000_v2_workspace_tables.",
    );
  }
  return workspace;
}

export function isWorkspaceOnboarded(workspace: WorkspaceRow): boolean {
  const onboardedAt = workspace.metadata?.onboarded_at;
  return typeof onboardedAt === "string" && onboardedAt.length > 0;
}

export async function markWorkspaceOnboarded(
  workspaceId: string,
  userId: string | null,
  role: string | null,
): Promise<WorkspaceRow> {
  const db = getDb();
  const existing = await getWorkspace(workspaceId);
  if (!existing) throw new Error("Workspace not found.");
  const metadata: Record<string, unknown> = {
    ...existing.metadata,
    onboarded_at: new Date().toISOString(),
    onboarded_by: userId ?? existing.metadata?.onboarded_by ?? null,
  };
  if (role) metadata.onboarded_role = role;
  const { data, error } = await db
    .from("workspaces")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", workspaceId)
    .select(
      "id, organization_id, name, slug, kind, template_id, visibility, share_token, metadata, created_by, created_at, updated_at",
    )
    .single();
  if (error) throw new Error(`markWorkspaceOnboarded failed: ${error.message}`);
  return data as WorkspaceRow;
}

export type CreateWorkspaceInput = {
  organizationId: string;
  name: string;
  slug: string;
  kind: WorkspaceRow["kind"];
  templateId?: string | null;
  visibility?: WorkspaceRow["visibility"];
  shareToken?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
};

export async function createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRow> {
  const db = getDb();
  const { data, error } = await db
    .from("workspaces")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      template_id: input.templateId ?? null,
      visibility: input.visibility ?? "private",
      share_token: input.shareToken ?? null,
      metadata: input.metadata ?? {},
      created_by: input.createdBy ?? null,
    })
    .select(
      "id, organization_id, name, slug, kind, template_id, visibility, share_token, metadata, created_by, created_at, updated_at",
    )
    .single();
  if (error) throw new Error(`createWorkspace failed: ${error.message}`);
  return data as WorkspaceRow;
}

/**
 * Deep-clones a template workspace into a fresh workspace for the given
 * organization. Copies:
 *   - workspace_scopes (maps old → new scope ids)
 *   - entities (type, canonical_name, aliases, metadata)
 *   - memory_entries (non-archived, with remapped workspace_scope_id)
 *
 * Does NOT copy deliverables, documents, or facts. Those are conversation
 * artifacts that belong to the user who generates them, not to the template.
 *
 * Returns the new workspace row.
 */
export async function cloneWorkspace(input: {
  templateId: string;
  organizationId: string;
  name: string;
  slug: string;
  visibility?: WorkspaceRow["visibility"];
  createdBy?: string | null;
}): Promise<WorkspaceRow> {
  const db = getDb();
  const template = await getWorkspace(input.templateId);
  if (!template) throw new Error("Template workspace not found.");
  if (template.kind !== "demo_template") {
    throw new Error("Only demo_template workspaces can be cloned.");
  }

  const newWorkspace = await createWorkspace({
    organizationId: input.organizationId,
    name: input.name,
    slug: input.slug,
    kind: "customer",
    templateId: template.id,
    visibility: input.visibility ?? "private",
    metadata: {
      ...template.metadata,
      cloned_from: template.id,
      cloned_at: new Date().toISOString(),
    },
    createdBy: input.createdBy ?? null,
  });

  const { data: scopes, error: scopesListErr } = await db
    .from("workspace_scopes")
    .select("id, kind, name, slug, parent_scope_id, metadata")
    .eq("workspace_id", template.id);
  if (scopesListErr) {
    throw new Error(`cloneWorkspace scope list failed: ${scopesListErr.message}`);
  }

  const scopeIdMap = new Map<string, string>();
  for (const s of ((scopes ?? []) as Array<{
    id: string;
    kind: string;
    name: string;
    slug: string;
    parent_scope_id: string | null;
    metadata: Record<string, unknown>;
  }>)) {
    const { data: inserted, error: scopeErr } = await db
      .from("workspace_scopes")
      .insert({
        workspace_id: newWorkspace.id,
        kind: s.kind,
        name: s.name,
        slug: s.slug,
        parent_scope_id: null,
        metadata: { ...s.metadata, cloned_from: s.id },
      })
      .select("id")
      .single();
    if (scopeErr || !inserted) {
      throw new Error(
        `cloneWorkspace scope insert failed for ${s.kind}:${s.slug}: ${scopeErr?.message ?? "no row returned"}`,
      );
    }
    scopeIdMap.set(s.id, inserted.id as string);
  }

  // Patch parent_scope_id in a second pass once all new ids exist.
  for (const s of ((scopes ?? []) as Array<{ id: string; parent_scope_id: string | null }>)) {
    if (s.parent_scope_id && scopeIdMap.has(s.id) && scopeIdMap.has(s.parent_scope_id)) {
      const { error: parentErr } = await db
        .from("workspace_scopes")
        .update({ parent_scope_id: scopeIdMap.get(s.parent_scope_id)! })
        .eq("id", scopeIdMap.get(s.id)!);
      if (parentErr) {
        throw new Error(`cloneWorkspace parent_scope_id patch failed: ${parentErr.message}`);
      }
    }
  }

  // Clone entities (type + canonical_name + aliases + metadata)
  const { data: entities, error: entListErr } = await db
    .from("entities")
    .select("type, canonical_name, normalized_name, aliases, metadata")
    .eq("workspace_id", template.id);
  if (entListErr) {
    throw new Error(`cloneWorkspace entity list failed: ${entListErr.message}`);
  }
  const entityBatch = ((entities ?? []) as Array<{
    type: string;
    canonical_name: string;
    normalized_name: string;
    aliases: string[];
    metadata: Record<string, unknown>;
  }>).map((e) => ({
    workspace_id: newWorkspace.id,
    organization_id: newWorkspace.id,
    is_team_beta: false,
    type: e.type,
    canonical_name: e.canonical_name,
    normalized_name: e.normalized_name,
    aliases: e.aliases ?? [],
    metadata: { ...e.metadata, cloned_from_workspace: template.id },
  }));
  if (entityBatch.length > 0) {
    const { error: entErr } = await db.from("entities").insert(entityBatch);
    if (entErr) {
      throw new Error(`cloneWorkspace entity insert failed: ${entErr.message}`);
    }
  }

  // Clone memory entries (non-archived)
  const { data: memories, error: memListErr } = await db
    .from("memory_entries")
    .select("workspace_scope_id, scope, memory_type, path, content, metadata")
    .eq("workspace_id", template.id);
  if (memListErr) {
    throw new Error(`cloneWorkspace memory list failed: ${memListErr.message}`);
  }
  const memoryBatch = ((memories ?? []) as Array<{
    workspace_scope_id: string | null;
    scope: string;
    memory_type: string;
    path: string;
    content: string;
    metadata: Record<string, unknown>;
  }>)
    .filter((m) => !m.metadata?.archived_at)
    .map((m) => ({
      workspace_id: newWorkspace.id,
      organization_id: newWorkspace.id,
      is_team_beta: false,
      workspace_scope_id: m.workspace_scope_id ? scopeIdMap.get(m.workspace_scope_id) ?? null : null,
      scope: m.scope,
      memory_type: m.memory_type,
      path: m.path,
      content: m.content,
      metadata: { ...m.metadata, cloned_from_workspace: template.id },
    }));
  if (memoryBatch.length > 0) {
    const { error: memErr } = await db.from("memory_entries").insert(memoryBatch);
    if (memErr) {
      throw new Error(`cloneWorkspace memory insert failed: ${memErr.message}`);
    }
  }

  return newWorkspace;
}

export async function listWorkspaces(): Promise<WorkspaceRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from("workspaces")
    .select(
      "id, organization_id, name, slug, kind, template_id, visibility, share_token, metadata, created_by, created_at, updated_at",
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listWorkspaces failed: ${error.message}`);
  return (data ?? []) as WorkspaceRow[];
}

/**
 * Resolve the authenticated user's personal workspace, creating it on first
 * call. Wraps the `ensure_private_workspace` RPC from migration 20260423130000.
 *
 * Identity: visibility='private', kind='customer', metadata.is_personal=true,
 * created_by=userId. One workspace per user, enforced by partial unique index.
 *
 * This sits alongside getCurrentWorkspace() (which returns the team singleton)
 * and does NOT replace it. The UI layer decides which surface a given request
 * targets. The chat+research spec shell-UX work wires the actual switcher. No
 * route consumes this helper at Day 0; subsequent days of the shell-UX spec
 * wire the workspace switcher that routes between team and personal surfaces.
 *
 * Access gate: mirrors the team-access-mode policy. Only team-beta emails
 * (@basquio.com plus the unlimited-access allowlist) can own a private
 * workspace. Non-team callers get a 404-equivalent error so the database
 * never acquires orphan private workspaces for unauthorized identities.
 */
export async function ensurePrivateWorkspace(
  userId: string,
  userEmail: string | null,
): Promise<WorkspaceRow> {
  if (!userId) throw new Error("ensurePrivateWorkspace requires a userId.");
  if (!isTeamBetaEmail(userEmail)) {
    throw new Error("ensurePrivateWorkspace is not available for this account.");
  }
  const db = getDb();
  const { data: rpcData, error: rpcError } = await db.rpc("ensure_private_workspace", {
    p_user_id: userId,
    p_user_email: userEmail,
  });
  if (rpcError) {
    throw new Error(`ensurePrivateWorkspace RPC failed: ${rpcError.message}`);
  }
  const workspaceId = extractUuidFromRpcResult(rpcData);
  if (!workspaceId) {
    throw new Error("ensurePrivateWorkspace RPC returned no workspace id.");
  }
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(
      `ensurePrivateWorkspace resolved id ${workspaceId} but the row is missing.`,
    );
  }
  return workspace;
}

function extractUuidFromRpcResult(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      const record = first as Record<string, unknown>;
      const candidate = record.ensure_private_workspace ?? record.id ?? null;
      if (typeof candidate === "string") return candidate;
    }
  }
  return null;
}
