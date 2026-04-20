import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
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
