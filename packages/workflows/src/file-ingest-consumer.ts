/**
 * File-ingest consumer loop (B4b).
 *
 * Runs inside the Railway deck-worker process (scripts/worker.ts) as a
 * second, independent poll loop alongside the deck_run claim loop.
 * Polls `file_ingest_runs` via claim_file_ingest_run RPC; for each
 * claimed row it invokes the provided processor (processWorkspaceDocument
 * from packages/workflows/src/workspace/process.ts) with a heartbeat running
 * every HEARTBEAT_INTERVAL_MS so the stale-run recovery RPC leaves
 * in-progress work alone.
 *
 * Contract with the deck-worker process:
 *  - SIGTERM handling: the caller passes an AbortSignal (or toggles a
 *    flag) that this loop polls. On shutdown it stops claiming new
 *    runs, lets the current run finish, then returns.
 *  - Heartbeat ownership: only the consumer heartbeats file_ingest_runs
 *    rows. The deck worker heartbeats deck_run_attempts. The two
 *    channels do not overlap.
 *  - Stale recovery: called by the top-level worker's recovery tick so
 *    operators do not need a second recovery timer.
 *
 * Testability: the processor is injected so unit tests can supply a
 * stub without pulling the full extraction chain into vitest.
 */

export type FileIngestClaim = {
  runId: string;
  documentId: string;
  workspaceId: string;
  attemptCount: number;
};

export type FileIngestProcessor = (input: {
  documentId: string;
  signal: AbortSignal;
}) => Promise<"indexed" | "failed">;

export type FileIngestQueue = {
  claim(workerId: string): Promise<FileIngestClaim | null>;
  markIndexing(runId: string): Promise<void>;
  heartbeat(runId: string): Promise<void>;
  complete(input: {
    runId: string;
    status: "indexed" | "failed";
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  recoverStale(staleAfterMinutes?: number): Promise<number>;
};

export type FileIngestLoopOptions = {
  workerId: string;
  queue: FileIngestQueue;
  processor: FileIngestProcessor;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
  errorLog?: (message: string, extra?: Record<string, unknown>) => void;
  /**
   * Return true when the loop must stop claiming new rows. The loop
   * still lets the current run finish before returning.
   */
  isShuttingDown: () => boolean;
};

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export async function runFileIngestLoop(options: FileIngestLoopOptions): Promise<void> {
  const {
    workerId,
    queue,
    processor,
    isShuttingDown,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    log = noop,
    errorLog = noop,
  } = options;

  log(`[file-ingest-consumer] start worker=${workerId}`);

  while (!isShuttingDown()) {
    let claim: FileIngestClaim | null = null;
    try {
      claim = await queue.claim(workerId);
    } catch (err) {
      errorLog(
        `[file-ingest-consumer] claim failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await sleep(pollIntervalMs);
      continue;
    }

    if (!claim) {
      // Empty queue. Wait before polling again so we do not beat
      // PostgREST with no-op calls.
      await sleep(pollIntervalMs);
      continue;
    }

    log(
      `[file-ingest-consumer] claimed runId=${claim.runId} documentId=${claim.documentId} attempt=${claim.attemptCount}`,
    );

    // Move from 'claimed' to 'indexing' so the stale-recovery sweep
    // sees a distinct state and timestamp.
    try {
      await queue.markIndexing(claim.runId);
    } catch (err) {
      errorLog(
        `[file-ingest-consumer] markIndexing failed runId=${claim.runId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Don't block on a heartbeat-bucket failure; the recovery
      // sweeper handles stuck 'claimed' rows.
    }

    const abortController = new AbortController();
    const heartbeatTimer = setInterval(() => {
      queue.heartbeat(claim!.runId).catch((err) => {
        errorLog(
          `[file-ingest-consumer] heartbeat failed runId=${claim!.runId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();

    let status: "indexed" | "failed" = "failed";
    let errorMessage: string | null = null;
    const startedAt = Date.now();
    try {
      status = await processor({
        documentId: claim.documentId,
        signal: abortController.signal,
      });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      status = "failed";
      errorLog(
        `[file-ingest-consumer] processor crashed runId=${claim.runId}: ${errorMessage}`,
      );
    } finally {
      clearInterval(heartbeatTimer);
    }

    const elapsedMs = Date.now() - startedAt;
    try {
      await queue.complete({
        runId: claim.runId,
        status,
        errorMessage,
        metadata: {
          finished_by: workerId,
          elapsed_ms: elapsedMs,
        },
      });
      log(
        `[file-ingest-consumer] completed runId=${claim.runId} status=${status} elapsed_ms=${elapsedMs}`,
      );
    } catch (err) {
      errorLog(
        `[file-ingest-consumer] complete failed runId=${claim.runId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // If we cannot mark terminal state, the recovery RPC will
      // reset the row after staleAfterMinutes. Do not crash the loop.
    }
  }

  log("[file-ingest-consumer] loop exiting (shutdown requested)");
}

/**
 * Convenience helper for the deck worker's periodic recovery tick.
 * Returns the number of rows rescued so the caller can log it.
 */
export async function sweepStaleFileIngestRuns(
  queue: FileIngestQueue,
  staleAfterMinutes = 30,
): Promise<number> {
  return queue.recoverStale(staleAfterMinutes);
}

function noop(): void {
  /* intentional */
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
