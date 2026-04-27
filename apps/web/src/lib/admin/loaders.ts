import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";

/**
 * Memory v1 Brief 6 admin-console data loaders. All reads. The admin
 * layout already gates the request through is_super_admin; loaders
 * use the service role for cross-workspace visibility.
 */

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

// Schema reality: chat_tool_telemetry has id, conversation_id, user_id,
// tool_name, input_hash, started_at, completed_at (not finished_at),
// duration_ms (not latency_ms), status, error_message, result_size_bytes,
// created_at, plus the Brief 2 cache + classifier columns. NO workspace_id.
// Workspace context is reachable via workspace_conversations.id when
// needed (see resolveWorkspaceForConversations below, used by the cost
// aggregator).
export type AdminChatTurnRow = {
  id: string;
  conversation_id: string | null;
  user_id: string | null;
  started_at: string;
  completed_at: string | null;
  cost_usd: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  cache_read_input_tokens: number | null;
  intents: string[] | null;
  active_tools: string[] | null;
};

const CHAT_TURN_COLUMNS =
  "id, conversation_id, user_id, started_at, completed_at, cost_usd, " +
  "total_input_tokens, total_output_tokens, cache_read_input_tokens, " +
  "intents, active_tools";

export async function listAdminChatTurns(limit = 50): Promise<AdminChatTurnRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from("chat_tool_telemetry")
    .select(CHAT_TURN_COLUMNS)
    .eq("tool_name", "__chat_turn__")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`admin chat turns failed: ${error.message}`);
  return (data ?? []) as unknown as AdminChatTurnRow[];
}

export async function getAdminChatTurn(turnId: string): Promise<AdminChatTurnRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("chat_tool_telemetry")
    .select(CHAT_TURN_COLUMNS)
    .eq("id", turnId)
    .maybeSingle();
  if (error) throw new Error(`admin chat turn failed: ${error.message}`);
  return (data ?? null) as unknown as AdminChatTurnRow | null;
}

export type AdminToolCallRow = {
  id: string;
  tool_name: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status: string | null;
  error_message: string | null;
};

export async function listToolCallsForTurn(conversationId: string): Promise<AdminToolCallRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from("chat_tool_telemetry")
    .select("id, tool_name, started_at, completed_at, duration_ms, status, error_message")
    .eq("conversation_id", conversationId)
    .neq("tool_name", "__chat_turn__")
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`tool calls failed: ${error.message}`);
  return (data ?? []) as unknown as AdminToolCallRow[];
}

// Resolve workspace_id for a list of conversation ids. chat_tool_telemetry
// stores conversation_id as TEXT; workspace_conversations.id is UUID.
// Casts are implicit when comparing TEXT to UUID via .in() on a UUID
// column; supabase-js / PostgREST handle the cast as long as the values
// are valid UUID strings.
async function resolveWorkspaceForConversations(
  conversationIds: string[],
): Promise<Map<string, string>> {
  if (conversationIds.length === 0) return new Map();
  const db = getDb();
  const unique = Array.from(new Set(conversationIds));
  const { data, error } = await db
    .from("workspace_conversations")
    .select("id, workspace_id")
    .in("id", unique);
  if (error) {
    console.error("[admin loaders] workspace_conversations resolve failed", error);
    return new Map();
  }
  const out = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; workspace_id: string }>) {
    out.set(row.id, row.workspace_id);
  }
  return out;
}

export type AdminAuditRow = {
  id: number;
  organization_id: string;
  workspace_id: string | null;
  table_name: string;
  row_id: string;
  action: string;
  actor: string;
  occurred_at: string;
};

export async function listAdminAudit(options: {
  table?: string;
  actor?: string;
  workspaceId?: string;
  limit?: number;
} = {}): Promise<AdminAuditRow[]> {
  const db = getDb();
  let q = db
    .from("memory_audit")
    .select("id, organization_id, workspace_id, table_name, row_id, action, actor, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(options.limit ?? 100);
  if (options.table) q = q.eq("table_name", options.table);
  if (options.actor) q = q.ilike("actor", `%${options.actor}%`);
  if (options.workspaceId) q = q.eq("workspace_id", options.workspaceId);
  const { data, error } = await q;
  if (error) throw new Error(`admin audit list failed: ${error.message}`);
  return (data ?? []) as AdminAuditRow[];
}

export type AdminCandidateRow = {
  id: string;
  workspace_id: string;
  kind: string;
  status: string;
  confidence: number;
  evidence_excerpt: string;
  source_conversation_id: string | null;
  created_at: string;
  approved_at: string | null;
  dismissed_reason: string | null;
};

export async function listAdminCandidates(limit = 100): Promise<AdminCandidateRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from("memory_candidates")
    .select(
      "id, workspace_id, kind, status, confidence, evidence_excerpt, source_conversation_id, created_at, approved_at, dismissed_reason",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`admin candidates failed: ${error.message}`);
  return (data ?? []) as AdminCandidateRow[];
}

export type AdminHintRow = {
  id: string;
  workspace_id: string;
  kind: string;
  status: string;
  title: string;
  reason: string;
  cooldown_key: string;
  confidence: number;
  urgency: number;
  created_at: string;
  shown_at: string | null;
  acted_at: string | null;
  expires_at: string;
};

export async function listAdminHints(limit = 100): Promise<AdminHintRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from("anticipation_hints")
    .select(
      "id, workspace_id, kind, status, title, reason, cooldown_key, confidence, urgency, created_at, shown_at, acted_at, expires_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`admin hints failed: ${error.message}`);
  return (data ?? []) as AdminHintRow[];
}

export type AdminCostBucket = {
  workspace_id: string;
  total_cost_usd: number;
  turn_count: number;
};

export async function aggregateChatCostByWorkspace(sinceIso: string): Promise<AdminCostBucket[]> {
  const db = getDb();
  const { data, error } = await db
    .from("chat_tool_telemetry")
    .select("conversation_id, cost_usd")
    .eq("tool_name", "__chat_turn__")
    .gt("started_at", sinceIso)
    .limit(5000);
  if (error) throw new Error(`admin cost aggregate failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ conversation_id: string | null; cost_usd: number | null }>;

  // chat_tool_telemetry has no workspace_id; resolve via workspace_conversations.
  const conversationIds = rows
    .map((r) => r.conversation_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const conversationToWorkspace = await resolveWorkspaceForConversations(conversationIds);

  const buckets = new Map<string, AdminCostBucket>();
  for (const row of rows) {
    const workspaceId = row.conversation_id
      ? conversationToWorkspace.get(row.conversation_id) ?? "(unknown)"
      : "(unknown)";
    const existing = buckets.get(workspaceId) ?? {
      workspace_id: workspaceId,
      total_cost_usd: 0,
      turn_count: 0,
    };
    existing.total_cost_usd += Number(row.cost_usd ?? 0);
    existing.turn_count += 1;
    buckets.set(workspaceId, existing);
  }
  return [...buckets.values()].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
}

export async function listDriftSignals(limit = 50): Promise<{
  dismissedCooldowns: Array<{ workspace_id: string; cooldown_key: string; count: number }>;
  staleCandidates: AdminCandidateRow[];
}> {
  const db = getDb();
  const { data: dismissals, error: dismissErr } = await db
    .from("anticipation_hints")
    .select("workspace_id, cooldown_key")
    .eq("status", "dismissed")
    .gt("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
    .limit(2000);
  if (dismissErr) throw new Error(`drift dismissals failed: ${dismissErr.message}`);
  const counts = new Map<string, { workspace_id: string; cooldown_key: string; count: number }>();
  for (const row of (dismissals ?? []) as Array<{ workspace_id: string; cooldown_key: string }>) {
    const key = `${row.workspace_id}:${row.cooldown_key}`;
    const existing = counts.get(key) ?? { workspace_id: row.workspace_id, cooldown_key: row.cooldown_key, count: 0 };
    existing.count += 1;
    counts.set(key, existing);
  }
  const dismissedCooldowns = [...counts.values()]
    .filter((b) => b.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const staleSince = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: stale, error: staleErr } = await db
    .from("memory_candidates")
    .select(
      "id, workspace_id, kind, status, confidence, evidence_excerpt, source_conversation_id, created_at, approved_at, dismissed_reason",
    )
    .eq("status", "pending")
    .lt("created_at", staleSince)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (staleErr) throw new Error(`drift stale candidates failed: ${staleErr.message}`);

  return {
    dismissedCooldowns,
    staleCandidates: (stale ?? []) as AdminCandidateRow[],
  };
}
