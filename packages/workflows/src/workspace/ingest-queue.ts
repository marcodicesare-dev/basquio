import { createServiceSupabaseClient } from "../supabase";
import { BASQUIO_TEAM_WORKSPACE_ID } from "./constants";

/**
 * Durable queue for Lane B (background chunking + embedding). The Railway
 * worker claims rows via `claim_file_ingest_run(worker_id)` RPC and drives
 * them to terminal state. Enqueue from anywhere a chunk/embed job should
 * start: upload confirm, retry endpoint, admin reprocess, tests.
 *
 * One row per document_id enforced by UNIQUE , calling enqueueFileIngestRun
 * for a document that already has a queue row is safe: we reset status to
 * 'queued' and bump attempt_count.
 */

export type FileIngestStatus = "queued" | "claimed" | "indexing" | "indexed" | "failed";

export type FileIngestRun = {
  id: string;
  document_id: string;
  workspace_id: string;
  status: FileIngestStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  attempt_count: number;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

/**
 * Enqueue or reset a file_ingest_run for a document. Resets status to 'queued'
 * on re-enqueue (retry path) so the worker picks it up on the next poll.
 * Never throws on conflict , if the row already exists, we UPDATE it.
 */
export async function enqueueFileIngestRun(input: {
  documentId: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<FileIngestRun> {
  const db = getDb();
  const workspaceId = input.workspaceId ?? BASQUIO_TEAM_WORKSPACE_ID;

  const { data, error } = await db
    .from("file_ingest_runs")
    .upsert(
      {
        document_id: input.documentId,
        workspace_id: workspaceId,
        status: "queued",
        claimed_by: null,
        claimed_at: null,
        error_message: null,
        metadata: input.metadata ?? {},
      },
      { onConflict: "document_id" },
    )
    .select(
      "id, document_id, workspace_id, status, claimed_by, claimed_at, attempt_count, error_message, metadata, created_at, updated_at",
    )
    .single();

  if (error || !data) {
    throw new Error(
      `enqueueFileIngestRun failed for document ${input.documentId}: ${error?.message ?? "no row"}`,
    );
  }
  return data as FileIngestRun;
}

/**
 * Claim the next queued run for a worker. Atomic via the SQL side; multiple
 * worker replicas can call this safely. Returns null when the queue is empty.
 */
export async function claimFileIngestRun(workerId: string): Promise<{
  runId: string;
  documentId: string;
  workspaceId: string;
  attemptCount: number;
} | null> {
  const db = getDb();
  const { data, error } = await db.rpc("claim_file_ingest_run", { worker_id: workerId });
  if (error) {
    throw new Error(`claimFileIngestRun failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    run_id: string;
    document_id: string;
    workspace_id: string;
    attempt_count: number;
  }>;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    runId: row.run_id,
    documentId: row.document_id,
    workspaceId: row.workspace_id,
    attemptCount: row.attempt_count,
  };
}

/**
 * Move a claimed run to 'indexing' so the stale-recovery sweep can find it.
 * Call before the actual chunk/embed work starts.
 */
export async function markFileIngestRunIndexing(runId: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("file_ingest_runs")
    .update({ status: "indexing" })
    .eq("id", runId);
  if (error) {
    throw new Error(`markFileIngestRunIndexing failed: ${error.message}`);
  }
}

/**
 * Record terminal state. Called after the worker finishes (or a non-retryable
 * error bubbles up).
 */
export async function completeFileIngestRun(input: {
  runId: string;
  status: Extract<FileIngestStatus, "indexed" | "failed">;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("file_ingest_runs")
    .update({
      status: input.status,
      error_message: input.errorMessage ?? null,
      metadata: input.metadata ?? {},
    })
    .eq("id", input.runId);
  if (error) {
    throw new Error(`completeFileIngestRun failed: ${error.message}`);
  }
}

/**
 * Rescue runs stuck in claimed/indexing past stale_after_minutes. Called
 * periodically by the worker's recovery tick.
 */
export async function recoverStaleFileIngestRuns(
  staleAfterMinutes = 30,
): Promise<number> {
  const db = getDb();
  const { data, error } = await db.rpc("recover_stale_file_ingest_runs", {
    stale_after_minutes: staleAfterMinutes,
  });
  if (error) {
    throw new Error(`recoverStaleFileIngestRuns failed: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}

/**
 * Write a minor progress marker on a run without changing status. Used by the
 * worker to heartbeat through long chunk-insert loops so stale recovery leaves
 * them alone.
 */
export async function heartbeatFileIngestRun(runId: string): Promise<void> {
  const db = getDb();
  await db
    .from("file_ingest_runs")
    .update({ metadata: { heartbeat_at: new Date().toISOString() } })
    .eq("id", runId)
    .throwOnError();
}
