import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";

/**
 * DAL for quick_slide_runs. Service-role only; the API layer enforces
 * tenancy via getCurrentWorkspace + workspace_id match before calling
 * any of these.
 */

export type QuickSlideStatus = "queued" | "running" | "ready" | "error";

export type QuickSlideBrief = {
  topic: string;
  audience?: string;
  data_focus?: string;
  language: "it" | "en";
  extra_instructions?: string;
};

export type QuickSlideRow = {
  id: string;
  workspace_id: string;
  workspace_scope_id: string | null;
  conversation_id: string | null;
  created_by: string;
  brief: QuickSlideBrief;
  evidence_doc_ids: string[];
  status: QuickSlideStatus;
  pptx_storage_path: string | null;
  last_event_phase: string | null;
  last_event_message: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

const SELECT_FIELDS =
  "id, workspace_id, workspace_scope_id, conversation_id, created_by, brief, evidence_doc_ids, status, pptx_storage_path, last_event_phase, last_event_message, cost_usd, duration_ms, error_message, created_at, updated_at";

export async function createQuickSlideRun(input: {
  workspaceId: string;
  workspaceScopeId: string | null;
  conversationId: string | null;
  createdBy: string;
  brief: QuickSlideBrief;
  evidenceDocIds: string[];
}): Promise<QuickSlideRow> {
  const db = getDb();
  const { data, error } = await db
    .from("quick_slide_runs")
    .insert({
      workspace_id: input.workspaceId,
      workspace_scope_id: input.workspaceScopeId,
      conversation_id: input.conversationId,
      created_by: input.createdBy,
      brief: input.brief,
      evidence_doc_ids: input.evidenceDocIds,
    })
    .select(SELECT_FIELDS)
    .single();
  if (error) throw new Error(`createQuickSlideRun failed: ${error.message}`);
  return data as QuickSlideRow;
}

export async function getQuickSlideRun(id: string): Promise<QuickSlideRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("quick_slide_runs")
    .select(SELECT_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getQuickSlideRun failed: ${error.message}`);
  return data ? (data as QuickSlideRow) : null;
}

export async function updateQuickSlideRun(
  id: string,
  patch: Partial<{
    status: QuickSlideStatus;
    pptx_storage_path: string | null;
    last_event_phase: string | null;
    last_event_message: string | null;
    cost_usd: number | null;
    duration_ms: number | null;
    error_message: string | null;
  }>,
): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("quick_slide_runs")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(`updateQuickSlideRun failed: ${error.message}`);
}

/**
 * Per-user soft cap: 12 quick slides per hour. Returns true if the user
 * is currently rate-limited (12 or more runs in the last 60 minutes).
 *
 * The pipeline is the wrong place to enforce this; the tool calls
 * isQuickSlideRateLimited before creating the row so the agent can tell
 * the user they have used their hourly budget.
 */
export async function isQuickSlideRateLimited(userId: string): Promise<boolean> {
  const db = getDb();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from("quick_slide_runs")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .gte("created_at", oneHourAgo);
  if (error) {
    console.error("[isQuickSlideRateLimited] count failed", error);
    return false;
  }
  return (count ?? 0) >= 12;
}
