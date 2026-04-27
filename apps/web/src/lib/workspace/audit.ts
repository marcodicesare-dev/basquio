import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";

/**
 * Memory mutation audit helper.
 *
 * Wraps a body of memory writes so that the audit_memory_change trigger
 * (see supabase/migrations/20260428120000_memory_audit_log.sql) can populate
 * memory_audit.actor and memory_audit.workflow_run_id from session-local
 * Postgres config.
 *
 * Actor format (canonical):
 *   'user:UUID'                       (interactive user write)
 *   'system:extractor'                (chat-turn extraction worker)
 *   'system:workflow:{workflow-name}' (named meta-workflow run)
 *   'admin:UUID'                      (super-admin override)
 *
 * Brief 1 (this file) ships the helper without any callers. Brief 2 onwards
 * adopts it for every memory write. The audit trigger reads the session
 * variables via current_setting('app.actor') and falls back to
 * 'system:unknown' when unset.
 *
 * Implementation note: set_config(..., is_local := true) scopes the variable
 * to the current Postgres transaction. PostgREST opens a new transaction per
 * RPC call, so when fn() issues subsequent .rpc() / .from() calls they will
 * not see the actor unless the wider call chain is funneled through a single
 * Postgres function. The expected end-state, finalised in a later brief, is
 * to expose audited memory mutations as SECURITY DEFINER RPCs that accept
 * actor as a parameter and call set_config(..., true) themselves before
 * doing the write. This helper documents the contract; the trigger already
 * tolerates 'system:unknown' so any unaudited write is still logged with a
 * truthful (if generic) actor.
 */
export async function withActor<T>(
  actor: string,
  workflowRunId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("withActor: Supabase service role is not configured.");
  }

  const client = createServiceSupabaseClient(supabaseUrl, serviceKey);

  await client.rpc("set_config", {
    setting_name: "app.actor",
    new_value: actor,
    is_local: true,
  });
  if (workflowRunId) {
    await client.rpc("set_config", {
      setting_name: "app.workflow_run_id",
      new_value: workflowRunId,
      is_local: true,
    });
  }

  try {
    return await fn();
  } finally {
    await client.rpc("set_config", {
      setting_name: "app.actor",
      new_value: "",
      is_local: true,
    });
    if (workflowRunId) {
      await client.rpc("set_config", {
        setting_name: "app.workflow_run_id",
        new_value: "",
        is_local: true,
      });
    }
  }
}

export type MemoryAuditActorPrefix =
  | "user"
  | "system"
  | "admin";

export function buildUserActor(userId: string): string {
  return `user:${userId}`;
}

export function buildSystemActor(workflowName?: string): string {
  return workflowName ? `system:workflow:${workflowName}` : "system:extractor";
}

export function buildAdminActor(userId: string): string {
  return `admin:${userId}`;
}
