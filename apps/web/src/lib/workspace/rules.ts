import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";

import type { WorkspaceRule } from "@/lib/workspace/types";

/**
 * Memory v1 Brief 5 PART A: workspace_rule server-side helpers.
 *
 * Brief 1 created the workspace_rule table. Brief 5 promotes it from
 * storage-only into a live mutation surface. All audited mutations go
 * through SECURITY DEFINER RPCs from
 * supabase/migrations/20260512100000_workspace_rule_rpcs.sql.
 *
 * Three caller surfaces:
 *   - chat tools (teachRule, editRule) -> upsert_workspace_rule, edit_workspace_rule
 *   - Memory Inspector v2 row actions -> pin / edit / forget
 *   - chat-extraction auto_promote_high_confidence (Brief 4) writes
 *     directly via write_durable_memory_from_candidate, no need to go
 *     through these RPCs (it has its own transactional path)
 */

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

const RULE_SELECT =
  "id, workspace_id, scope_id, rule_type, rule_text, applies_to, forbidden, " +
  "origin, origin_evidence, priority, active, valid_from, valid_to, expired_at, " +
  "confidence, approved_by, approved_at, last_applied_at, metadata, " +
  "created_at, updated_at";

export type ListActiveRulesQuery = {
  scopeId?: string | null;
  ruleType?: WorkspaceRule["rule_type"];
  appliesTo?: string;
  limit?: number;
};

export async function listActiveRules(
  workspaceId: string,
  query: ListActiveRulesQuery = {},
): Promise<WorkspaceRule[]> {
  const db = getDb();
  let q = db
    .from("workspace_rule")
    .select(RULE_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .is("expired_at", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(query.limit ?? 100);
  if (query.scopeId !== undefined) {
    if (query.scopeId === null) {
      q = q.is("scope_id", null);
    } else {
      // include both scope-specific rules and workspace-wide (NULL scope) rules.
      q = q.or(`scope_id.eq.${query.scopeId},scope_id.is.null`);
    }
  }
  if (query.ruleType) {
    q = q.eq("rule_type", query.ruleType);
  }
  const { data, error } = await q;
  if (error) throw new Error(`workspace_rule list failed: ${error.message}`);
  let rules = (data ?? []) as unknown as WorkspaceRule[];
  if (query.appliesTo) {
    const surface = query.appliesTo;
    rules = rules.filter(
      (r) => r.applies_to.length === 0 || r.applies_to.includes(surface),
    );
  }
  return rules;
}

export async function listAllRules(
  workspaceId: string,
  limit = 200,
): Promise<WorkspaceRule[]> {
  const db = getDb();
  const { data, error } = await db
    .from("workspace_rule")
    .select(RULE_SELECT)
    .eq("workspace_id", workspaceId)
    .order("active", { ascending: false })
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`workspace_rule list-all failed: ${error.message}`);
  return (data ?? []) as unknown as WorkspaceRule[];
}

export type UpsertRuleInput = {
  workspaceId: string;
  scopeId?: string | null;
  ruleType: WorkspaceRule["rule_type"];
  ruleText: string;
  appliesTo?: string[];
  forbidden?: string[];
  origin: WorkspaceRule["origin"];
  originEvidence?: unknown[];
  priority?: number;
  actor: string;
};

export async function upsertRule(input: UpsertRuleInput): Promise<string> {
  const db = getDb();
  const { data, error } = await db.rpc("upsert_workspace_rule", {
    p_workspace_id: input.workspaceId,
    p_scope_id: input.scopeId ?? null,
    p_rule_type: input.ruleType,
    p_rule_text: input.ruleText,
    p_applies_to: input.appliesTo ?? [],
    p_forbidden: input.forbidden ?? [],
    p_origin: input.origin,
    p_origin_evidence: input.originEvidence ?? [],
    p_priority: input.priority ?? null,
    p_actor: input.actor,
  });
  if (error) throw new Error(`upsert_workspace_rule failed: ${error.message}`);
  return String(data);
}

export async function pinRule(
  ruleId: string,
  userId: string,
): Promise<void> {
  const db = getDb();
  const { error } = await db.rpc("pin_workspace_rule", {
    p_rule_id: ruleId,
    p_user_id: userId,
    p_actor: `user:${userId}`,
  });
  if (error) throw new Error(`pin_workspace_rule failed: ${error.message}`);
}

export async function editRule(
  ruleId: string,
  userId: string,
  edits: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const { error } = await db.rpc("edit_workspace_rule", {
    p_rule_id: ruleId,
    p_user_id: userId,
    p_edits: edits,
    p_actor: `user:${userId}`,
  });
  if (error) throw new Error(`edit_workspace_rule failed: ${error.message}`);
}

export async function forgetRule(
  ruleId: string,
  userId: string,
): Promise<void> {
  const db = getDb();
  const { error } = await db.rpc("forget_workspace_rule", {
    p_rule_id: ruleId,
    p_user_id: userId,
    p_actor: `user:${userId}`,
  });
  if (error) throw new Error(`forget_workspace_rule failed: ${error.message}`);
}

/**
 * Format active rules into a markdown block that buildScopeContextPack
 * can include in the chat agent's scope context. Grouped by rule_type,
 * ordered by priority desc within each group. Returns empty string when
 * there are no active rules so callers can drop the section cleanly.
 */
export function formatActiveRulesForScope(rules: WorkspaceRule[]): string {
  if (rules.length === 0) return "";
  const grouped = new Map<string, WorkspaceRule[]>();
  for (const r of rules) {
    const list = grouped.get(r.rule_type) ?? [];
    list.push(r);
    grouped.set(r.rule_type, list);
  }
  const lines: string[] = ["## Active workspace rules"];
  for (const [type, group] of grouped) {
    lines.push(`\n### ${type}`);
    const sorted = [...group].sort((a, b) => b.priority - a.priority);
    for (const r of sorted) {
      const surfaces = r.applies_to.length > 0 ? ` [applies_to: ${r.applies_to.join(", ")}]` : "";
      const forbid = r.forbidden.length > 0 ? ` [forbidden: ${r.forbidden.join(", ")}]` : "";
      lines.push(`- ${r.rule_text}${surfaces}${forbid} (priority ${r.priority}, origin ${r.origin})`);
    }
  }
  return lines.join("\n");
}
