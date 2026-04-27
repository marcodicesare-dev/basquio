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
  last_activity_at?: string | null;
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
  procedural: "Instructions",
  semantic: "Context",
  episodic: "Examples",
};

export const MEMORY_TYPE_DESCRIPTIONS: Record<MemoryType, string> = {
  procedural: "How Basquio should write, analyze, cite, and format.",
  semantic: "Stable client, category, market, and glossary context.",
  episodic: "Good prior outputs or decisions Basquio should repeat.",
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

/* ────────────────────────────────────────────────────────────
 * Memory v1 foundation tables (storage-only behind MEMORY_V2_ENABLED)
 * Schema: supabase/migrations/20260428100000_memory_architecture_foundation.sql
 *         supabase/migrations/20260428120000_memory_audit_log.sql
 * Spec:   docs/research/2026-04-25-sota-implementation-specs.md §1, §3
 * ──────────────────────────────────────────────────────────── */

export type WorkspaceRuleType =
  | "always"
  | "never"
  | "precedence"
  | "format"
  | "tone"
  | "source"
  | "approval"
  | "style";

export type WorkspaceRuleOrigin = "user" | "inferred" | "template";

export type WorkspaceRule = {
  id: string;
  workspace_id: string;
  scope_id: string | null;
  rule_type: WorkspaceRuleType;
  rule_text: string;
  applies_to: string[];
  forbidden: string[];
  origin: WorkspaceRuleOrigin;
  origin_evidence: unknown[];
  priority: number;
  active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  expired_at: string | null;
  confidence: number;
  approved_by: string | null;
  approved_at: string | null;
  last_applied_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type BrandGuidelineExtractionMethod =
  | "instructor"
  | "baml"
  | "outlines"
  | "manual";

export type BrandGuideline = {
  id: string;
  workspace_id: string;
  brand_entity_id: string | null;
  brand: string;
  version: string;
  source_document_id: string | null;
  typography: unknown[];
  colour: Record<string, unknown>;
  tone: unknown[];
  imagery: unknown[];
  forbidden: string[];
  language_preferences: Record<string, unknown>;
  layout: unknown[];
  logo: unknown[];
  extraction_method: BrandGuidelineExtractionMethod;
  extraction_confidence: number;
  extracted_at: string;
  approved_by: string | null;
  approved_at: string | null;
  superseded_by: string | null;
  metadata: Record<string, unknown>;
};

export type HintKind = "reactive" | "proactive" | "optimisation";

export type HintStatus =
  | "candidate"
  | "shown"
  | "accepted"
  | "dismissed"
  | "snoozed"
  | "expired"
  | "suppressed";

export type AnticipationHint = {
  id: string;
  workspace_id: string;
  scope_id: string | null;
  user_id: string | null;
  kind: HintKind;
  status: HintStatus;
  title: string;
  reason: string;
  source_refs: unknown[];
  target_action: Record<string, unknown>;
  confidence: number;
  urgency: 1 | 2 | 3;
  cooldown_key: string;
  expires_at: string;
  created_at: string;
  shown_at: string | null;
  acted_at: string | null;
  acted_by: string | null;
  workflow_run_id: string | null;
  metadata: Record<string, unknown>;
};

export type MemoryWorkflowTrigger =
  | "on_upload"
  | "on_session_end"
  | "on_deliverable_edit"
  | "cron"
  | "on_deadline";

export type MemoryWorkflow = {
  id: string;
  organization_id: string;
  name: string;
  version: number;
  trigger_kind: MemoryWorkflowTrigger;
  schedule_cron: string | null;
  skill_ref: string;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MemoryWorkflowRunStatus =
  | "running"
  | "success"
  | "failure"
  | "cancelled";

export type MemoryWorkflowRun = {
  id: string;
  organization_id: string;
  workflow_id: string;
  workspace_id: string | null;
  scope_id: string | null;
  trigger_payload: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
  status: MemoryWorkflowRunStatus;
  candidates_created: number;
  hints_created: number;
  rules_proposed: number;
  prompt_version: string | null;
  skill_version: string | null;
  cost_usd: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
};

export type MemoryAuditAction =
  | "insert"
  | "update"
  | "delete"
  | "supersede"
  | "invalidate"
  | "pin"
  | "archive";

export type MemoryAudit = {
  id: number;
  organization_id: string;
  workspace_id: string | null;
  scope_id: string | null;
  table_name: string;
  row_id: string;
  action: MemoryAuditAction;
  actor: string;
  actor_user_id: string | null;
  workflow_run_id: string | null;
  occurred_at: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  source_refs: unknown[] | null;
  metadata: Record<string, unknown>;
};
