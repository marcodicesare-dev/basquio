import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";

/**
 * Memory v1 Brief 4 candidates queue server-side helpers.
 *
 * The chat-extraction worker writes here via SECURITY DEFINER RPCs. The
 * Memory Inspector UI reads pending candidates and routes user
 * decisions back through approve_memory_candidate /
 * dismiss_memory_candidate / expire_pending_candidates RPCs. All
 * audited mutations go through the SECURITY DEFINER helpers per the
 * Brief 1 pivot.
 */

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export type MemoryCandidateKind = "fact" | "rule" | "preference" | "alias" | "entity";
export type MemoryCandidateStatus = "pending" | "approved" | "dismissed" | "expired";

export type MemoryCandidateRow = {
  id: string;
  workspace_id: string;
  scope_id: string | null;
  kind: MemoryCandidateKind;
  content: unknown;
  evidence_excerpt: string;
  source_conversation_id: string | null;
  source_message_id: string | null;
  confidence: number;
  status: MemoryCandidateStatus;
  approved_by: string | null;
  approved_at: string | null;
  dismissed_reason: string | null;
  dismissed_at: string | null;
  expires_at: string;
  workflow_run_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const CANDIDATE_SELECT =
  "id, workspace_id, scope_id, kind, content, evidence_excerpt, " +
  "source_conversation_id, source_message_id, confidence, status, " +
  "approved_by, approved_at, dismissed_reason, dismissed_at, expires_at, " +
  "workflow_run_id, metadata, created_at, updated_at";

export async function listPendingCandidates(
  workspaceId: string,
  scopeId?: string | null,
  limit = 100,
): Promise<MemoryCandidateRow[]> {
  const db = getDb();
  let q = db
    .from("memory_candidates")
    .select(CANDIDATE_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (scopeId !== undefined) {
    if (scopeId === null) {
      q = q.is("scope_id", null);
    } else {
      q = q.eq("scope_id", scopeId);
    }
  }
  const { data, error } = await q;
  if (error) throw new Error(`memory_candidates list failed: ${error.message}`);
  return (data ?? []) as unknown as MemoryCandidateRow[];
}

export async function approveCandidate(
  candidateId: string,
  userId: string,
  edits: Record<string, unknown> = {},
): Promise<{ kind: string; durable_id: string } & Record<string, unknown>> {
  const db = getDb();
  const { data, error } = await db.rpc("approve_memory_candidate", {
    p_candidate_id: candidateId,
    p_user_id: userId,
    p_edits: edits,
    p_actor: `user:${userId}`,
  });
  if (error) throw new Error(`approve_memory_candidate failed: ${error.message}`);
  return data as { kind: string; durable_id: string };
}

export async function dismissCandidate(
  candidateId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const db = getDb();
  const { error } = await db.rpc("dismiss_memory_candidate", {
    p_candidate_id: candidateId,
    p_user_id: userId,
    p_reason: reason,
    p_actor: `user:${userId}`,
  });
  if (error) throw new Error(`dismiss_memory_candidate failed: ${error.message}`);
}

export async function expirePendingCandidates(olderThanDays?: number): Promise<number> {
  const db = getDb();
  const { data, error } = await db.rpc("expire_pending_candidates", {
    p_older_than_days: olderThanDays ?? null,
    p_actor: "system:operator:expire-candidates",
  });
  if (error) throw new Error(`expire_pending_candidates failed: ${error.message}`);
  return Number(data ?? 0);
}
