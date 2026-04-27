import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";

import type { AnticipationHint, HintKind } from "@/lib/workspace/types";

/**
 * Memory v1 Brief 5 PART C: anticipation hints.
 *
 * Three concurrent hint passes per Monday-morning generation, each
 * producing 0-1 hints. Workspace home shows at most 3 hints (the
 * three-hint cap from spec §9 acceptance gate #1). Dismissed hints
 * suppress the same cooldown_key for 14 days; this is enforced inside
 * the insert_anticipation_hint SECURITY DEFINER RPC.
 *
 * For Brief 5 v1 the generators are intentionally simple: they look
 * at memory_candidates pending count, recently-extracted brand_guideline
 * rows, and recently-superseded facts. Brief 6 admin console + future
 * brief tuning can add more sophisticated signal sources (find_stale_
 * claims_in_drafts, on-deliverable-edited preference deltas, etc.).
 */

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

const HINT_SELECT =
  "id, workspace_id, scope_id, user_id, kind, status, title, reason, " +
  "source_refs, target_action, confidence, urgency, cooldown_key, " +
  "expires_at, created_at, shown_at, acted_at, acted_by, " +
  "workflow_run_id, metadata";

export function isAnticipationEnabled(): boolean {
  return process.env.ANTICIPATION_ENABLED === "true";
}

export async function listActiveHints(
  workspaceId: string,
  userId: string,
  cap = 3,
): Promise<AnticipationHint[]> {
  const db = getDb();
  const { data, error } = await db
    .from("anticipation_hints")
    .select(HINT_SELECT)
    .eq("workspace_id", workspaceId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .in("status", ["candidate", "shown"])
    .gt("expires_at", new Date().toISOString())
    .order("urgency", { ascending: true })
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(cap);
  if (error) throw new Error(`anticipation_hints list failed: ${error.message}`);
  return (data ?? []) as unknown as AnticipationHint[];
}

export async function dismissHint(hintId: string, userId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.rpc("dismiss_anticipation_hint", {
    p_hint_id: hintId,
    p_user_id: userId,
    p_actor: `user:${userId}`,
  });
  if (error) throw new Error(`dismiss_anticipation_hint failed: ${error.message}`);
}

export async function snoozeHint(
  hintId: string,
  userId: string,
  snoozeDays = 7,
): Promise<void> {
  const db = getDb();
  const { error } = await db.rpc("snooze_anticipation_hint", {
    p_hint_id: hintId,
    p_user_id: userId,
    p_snooze_days: snoozeDays,
    p_actor: `user:${userId}`,
  });
  if (error) throw new Error(`snooze_anticipation_hint failed: ${error.message}`);
}

export async function acceptHint(hintId: string, userId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.rpc("accept_anticipation_hint", {
    p_hint_id: hintId,
    p_user_id: userId,
    p_actor: `user:${userId}`,
  });
  if (error) throw new Error(`accept_anticipation_hint failed: ${error.message}`);
}

type GeneratorInput = {
  workspaceId: string;
  userId: string | null;
};

type CandidateHintFields = {
  kind: HintKind;
  title: string;
  reason: string;
  sourceRefs: unknown;
  targetAction: unknown;
  confidence: number;
  urgency: 1 | 2 | 3;
  cooldownKey: string;
  expiresInDays: number;
};

async function callInsertHint(
  workspaceId: string,
  userId: string | null,
  fields: CandidateHintFields,
): Promise<string | null> {
  const db = getDb();
  const status = isAnticipationEnabled() ? "candidate" : "suppressed";
  const expiresAt = new Date(Date.now() + fields.expiresInDays * 86_400_000).toISOString();
  const { data, error } = await db.rpc("insert_anticipation_hint", {
    p_workspace_id: workspaceId,
    p_scope_id: null,
    p_user_id: userId,
    p_kind: fields.kind,
    p_title: fields.title,
    p_reason: fields.reason,
    p_source_refs: fields.sourceRefs,
    p_target_action: fields.targetAction,
    p_confidence: fields.confidence,
    p_urgency: fields.urgency,
    p_cooldown_key: fields.cooldownKey,
    p_expires_at: expiresAt,
    p_workflow_run_id: null,
    p_status: status,
    p_actor: "system:workflow:hint-generator",
  });
  if (error) {
    console.error("[anticipation] insert_anticipation_hint failed", error);
    return null;
  }
  return data as string;
}

/**
 * Reactive hint: pending memory candidates older than 3 days. Surfaces
 * the queue when the user has stopped reviewing.
 */
async function findReactiveHint(input: GeneratorInput): Promise<CandidateHintFields | null> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("memory_candidates")
    .select("id", { count: "exact", head: false })
    .eq("workspace_id", input.workspaceId)
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .limit(1);
  if (error) {
    console.error("[anticipation] reactive query failed", error);
    return null;
  }
  if (!data || data.length === 0) return null;
  return {
    kind: "reactive",
    title: "Memory candidates are waiting for review",
    reason: "Some pending candidates have been waiting more than 3 days. Reviewing them turns them into durable rules and facts.",
    sourceRefs: { table: "memory_candidates", filter: { status: "pending", older_than_days: 3 } },
    targetAction: { kind: "open_route", payload: { href: "/workspace/memory#pending" } },
    confidence: 0.85,
    urgency: 2,
    cooldownKey: `pending-candidates-stale:${input.workspaceId}`,
    expiresInDays: 7,
  };
}

/**
 * Proactive hint: a brand_guideline row was extracted in the last 7
 * days. Tells the user to spot-check the typed rules before relying on
 * them in client decks.
 */
async function findProactiveHint(input: GeneratorInput): Promise<CandidateHintFields | null> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("brand_guideline")
    .select("id, brand")
    .eq("workspace_id", input.workspaceId)
    .gt("extracted_at", cutoff)
    .order("extracted_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[anticipation] proactive query failed", error);
    return null;
  }
  if (!data || data.length === 0) return null;
  const row = data[0] as { id: string; brand: string };
  return {
    kind: "proactive",
    title: `Spot-check the ${row.brand} brand rules`,
    reason: "A brand book was extracted recently. Reviewing the typed rules before using them in client decks catches anything the validator let through.",
    sourceRefs: [{ table: "brand_guideline", id: row.id, brand: row.brand }],
    targetAction: { kind: "open_route", payload: { href: "/workspace/memory#rules" } },
    confidence: 0.80,
    urgency: 3,
    cooldownKey: `brand-spotcheck:${row.id}`,
    expiresInDays: 14,
  };
}

/**
 * Optimisation hint: workspace_rule edited or pinned three or more
 * times in the last 14 days. Suggests a procedural pattern worth
 * promoting from individual rules into a higher-priority cluster.
 */
async function findOptimisationHint(input: GeneratorInput): Promise<CandidateHintFields | null> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("workspace_rule")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId)
    .eq("active", true)
    .gt("updated_at", cutoff);
  if (error) {
    console.error("[anticipation] optimisation query failed", error);
    return null;
  }
  const count = data === null ? 0 : 0;
  // The count from { head: true } lives on the response object; we can
  // re-fetch with rows when a tighter signal is needed. For now, do a
  // simpler read: count rows manually below.
  void count;
  const { data: recentRules, error: rowsError } = await db
    .from("workspace_rule")
    .select("id, rule_text")
    .eq("workspace_id", input.workspaceId)
    .eq("active", true)
    .gt("updated_at", cutoff)
    .limit(50);
  if (rowsError) {
    console.error("[anticipation] optimisation rule rows failed", rowsError);
    return null;
  }
  const total = (recentRules ?? []).length;
  if (total < 3) return null;
  return {
    kind: "optimisation",
    title: `${total} workspace rules updated in the last 2 weeks`,
    reason: "Recent rule activity often signals a workflow pattern worth pinning. Memory Inspector lets you bump priority on the rules you rely on.",
    sourceRefs: { table: "workspace_rule", count: total, since_days: 14 },
    targetAction: { kind: "open_route", payload: { href: "/workspace/memory#rules" } },
    confidence: 0.75,
    urgency: 3,
    cooldownKey: `rule-burst:${input.workspaceId}:${Math.floor(Date.now() / (7 * 86_400_000))}`,
    expiresInDays: 7,
  };
}

export type GenerateHintsResult = {
  reactive: string | null;
  proactive: string | null;
  optimisation: string | null;
  flagState: "live" | "shadow";
};

/**
 * Monday-morning hint pass. Three concurrent generators each produce
 * 0-1 hints. Status ('candidate' vs 'suppressed') is gated by
 * ANTICIPATION_ENABLED. Suppressed hints still write to the table for
 * shadow-observation calibration before the user-facing surface ships.
 */
export async function generateMondayMorningHints(input: GeneratorInput): Promise<GenerateHintsResult> {
  const [reactive, proactive, optimisation] = await Promise.all([
    findReactiveHint(input).catch((err) => {
      console.error("[anticipation] reactive failed", err);
      return null;
    }),
    findProactiveHint(input).catch((err) => {
      console.error("[anticipation] proactive failed", err);
      return null;
    }),
    findOptimisationHint(input).catch((err) => {
      console.error("[anticipation] optimisation failed", err);
      return null;
    }),
  ]);

  const flagState = isAnticipationEnabled() ? "live" : "shadow";
  const out: GenerateHintsResult = {
    reactive: null,
    proactive: null,
    optimisation: null,
    flagState,
  };
  if (reactive) {
    out.reactive = await callInsertHint(input.workspaceId, input.userId, reactive);
  }
  if (proactive) {
    out.proactive = await callInsertHint(input.workspaceId, input.userId, proactive);
  }
  if (optimisation) {
    out.optimisation = await callInsertHint(input.workspaceId, input.userId, optimisation);
  }
  return out;
}
