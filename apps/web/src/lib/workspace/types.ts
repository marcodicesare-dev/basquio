/**
 * Shared workspace types.
 *
 * This file has no "server-only" import. Client components import types from
 * here to avoid pulling server-only module graphs into the client bundle.
 * Server lib files (scopes.ts, memory.ts, workspaces.ts, conversations.ts)
 * re-export or extend these types.
 */

import type { ScopeKind } from "@/lib/workspace/constants";

export type WorkspaceScope = {
  id: string;
  workspace_id: string;
  kind: ScopeKind;
  name: string;
  slug: string;
  parent_scope_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ScopeTree = Record<ScopeKind, WorkspaceScope[]>;

export type ScopeCounts = {
  scope_id: string;
  memory_count: number;
  deliverable_count: number;
  fact_count: number;
};

export type WorkspaceKind = "team_beta" | "demo_template" | "customer";
export type WorkspaceVisibility = "private" | "team" | "shareable_with_token";

export type WorkspaceRow = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  kind: WorkspaceKind;
  template_id: string | null;
  visibility: WorkspaceVisibility;
  share_token: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

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

export function isPinned(row: MemoryRow): boolean {
  return typeof row.metadata?.pinned_at === "string";
}

export function isArchived(row: MemoryRow): boolean {
  return typeof row.metadata?.archived_at === "string";
}
