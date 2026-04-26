import { randomUUID } from "node:crypto";
import {
  AttemptOwnershipLostError,
  generateDeckRun,
  WorkerShutdownInterruptError,
} from "../packages/workflows/src/generate-deck";
import { classifyRuntimeError } from "../packages/workflows/src/failure-classifier";
import { shouldResetCrossAttemptBudget } from "../packages/workflows/src/cost-guard";
import { closeOpenRequestUsageRows } from "../packages/workflows/src/request-usage-lifecycle";
import { runTemplateImportJob } from "../packages/workflows/src/template-import";
import { fetchRestRows, patchRestRows, upsertRestRows } from "../packages/workflows/src/supabase";
import {
  runFileIngestLoop,
  sweepStaleFileIngestRuns,
  type FileIngestQueue,
} from "../packages/workflows/src/file-ingest-consumer";
import { loadBasquioScriptEnv } from "./load-app-env";
import { refundCredit } from "../packages/workflows/src/credits";
import {
  claimFileIngestRun,
  completeFileIngestRun,
  heartbeatFileIngestRun,
  markFileIngestRunIndexing,
  recoverStaleFileIngestRuns,
} from "../packages/workflows/src/workspace/ingest-queue";
import { processWorkspaceDocument } from "../packages/workflows/src/workspace/process";

loadBasquioScriptEnv();

const POLL_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_POLL_INTERVAL_MS ?? "5000", 10);
const STALE_RUN_MINUTES = Number.parseInt(process.env.BASQUIO_WORKER_STALE_MINUTES ?? "5", 10);
const STALE_ATTEMPT_MEANINGFUL_MINUTES = Number.parseInt(
  process.env.BASQUIO_ATTEMPT_MEANINGFUL_STALE_MINUTES ?? "8",
  10,
);
const HEARTBEAT_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_HEARTBEAT_INTERVAL_MS ?? "30000", 10);
const RECOVERY_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_RECOVERY_INTERVAL_MS ?? "60000", 10);
const MAX_CONCURRENT_RUNS = Math.max(1, Number.parseInt(process.env.BASQUIO_WORKER_MAX_CONCURRENCY ?? "10", 10));
const SHUTDOWN_DRAIN_TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.BASQUIO_WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS ?? "55000", 10));
const ACTIVE_REQUEST_GRACE_MS = Math.max(
  15 * 60_000,
  Number.parseInt(
    process.env.BASQUIO_WORKER_ACTIVE_REQUEST_GRACE_MS ??
      String(Math.max(
        Number.parseInt(process.env.BASQUIO_AUTHOR_PHASE_TIMEOUT_MS ?? "3300000", 10),
        Number.parseInt(process.env.BASQUIO_REVISE_PHASE_TIMEOUT_MS ?? "2700000", 10),
      ) + 5 * 60_000),
    10,
  ),
);
const LIVE_PHASE_STALE_MS = Math.max(
  30 * 60_000,
  Number.parseInt(
    process.env.BASQUIO_WORKER_LIVE_PHASE_STALE_MS ??
      String(Math.max(
        Number.parseInt(process.env.BASQUIO_AUTHOR_PHASE_TIMEOUT_MS ?? "3300000", 10),
        Number.parseInt(process.env.BASQUIO_REVISE_PHASE_TIMEOUT_MS ?? "2700000", 10),
      )),
    10,
  ),
);
const SHUTDOWN_RECOVERY_REASON = "worker_shutdown";
const WORKER_RPC_TIMEOUT_MS = 30_000;

type QueuedRunRow = {
  run_id: string;
  id: string;
  attempt_number: number;
};

type RunningAttemptRow = QueuedRunRow & {
  last_meaningful_event_at: string | null;
  updated_at: string;
};

type ActivePhaseRequestRow = {
  started_at: string;
  completed_at: string | null;
};

type ActiveRunState = {
  attempt: QueuedRunRow;
  promise: Promise<void>;
  stopHeartbeat: () => void;
  abortController: AbortController;
};

function getMeaningfulStaleMinutesForPhase(phase: string | null | undefined) {
  switch (phase) {
    case "author":
      return STALE_ATTEMPT_MEANINGFUL_MINUTES;
    case "understand":
      return Math.max(8, STALE_ATTEMPT_MEANINGFUL_MINUTES);
    case "revise":
      return STALE_ATTEMPT_MEANINGFUL_MINUTES;
    default:
      return STALE_ATTEMPT_MEANINGFUL_MINUTES;
  }
}

async function main() {
  const config = resolveConfig();
  let shuttingDown = false;
  const activeRuns = new Map<string, ActiveRunState>();
  let recoveryInFlight = false;

  const requestShutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.warn(`[basquio-worker] received ${signal}; stopping claims and draining ${activeRuns.size} active runs`);
  };

  process.on("SIGTERM", () => requestShutdown("SIGTERM"));
  process.on("SIGINT", () => requestShutdown("SIGINT"));

  console.log(`[basquio-worker] starting (max concurrency ${MAX_CONCURRENT_RUNS})`);
  await recoverStaleAttempts(config);

  // File-ingest consumer: independent poll loop claiming file_ingest_runs
  // rows produced by chat uploads, research scrapes, and the transactional
  // dual-write RPC (B4a). Shares the worker's shutdown signal but has
  // its own claim + heartbeat + terminal-state flow. The deck_run loop
  // and this loop never touch the same rows; the recovery RPC below
  // is a separate table. Per Apr 21 forensic: new service topology
  // changes are out of scope, so the consumer rides inline in this
  // process. See docs/railway-services.md.
  const fileIngestQueue: FileIngestQueue = {
    claim: (workerId) => claimFileIngestRun(workerId),
    markIndexing: (runId) => markFileIngestRunIndexing(runId),
    heartbeat: (runId) => heartbeatFileIngestRun(runId),
    complete: (input) =>
      completeFileIngestRun({
        runId: input.runId,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata,
      }),
    recoverStale: (minutes) => recoverStaleFileIngestRuns(minutes),
  };
  const fileIngestWorkerId = `file-ingest-${randomUUID().slice(0, 8)}`;
  const fileIngestLoop = runFileIngestLoop({
    workerId: fileIngestWorkerId,
    queue: fileIngestQueue,
    processor: async ({ documentId }) => {
      const outcome = await processWorkspaceDocument(documentId);
      return outcome.status === "indexed" ? "indexed" : "failed";
    },
    pollIntervalMs: POLL_INTERVAL_MS,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    isShuttingDown: () => shuttingDown,
    log: (msg) => console.log(msg),
    errorLog: (msg) => console.error(msg),
  });
  // Fire-and-forget: the loop returns when shuttingDown flips. We
  // awaitable-reference it during the shutdown drain below.

  const recoveryTimer = setInterval(() => {
    if (recoveryInFlight) {
      return;
    }

    recoveryInFlight = true;
    void recoverStaleAttempts(config)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[basquio-worker] recovery loop error: ${message}`);
      })
      .finally(() => {
        recoveryInFlight = false;
      });
  }, RECOVERY_INTERVAL_MS);
  recoveryTimer.unref?.();

  // File-ingest stale sweep. Runs alongside the deck_run recovery tick
  // above so operators see both rescue streams in one log surface.
  const fileIngestRecoveryTimer = setInterval(() => {
    void sweepStaleFileIngestRuns(fileIngestQueue, 30).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[basquio-worker] file-ingest recovery error: ${message}`);
    });
  }, RECOVERY_INTERVAL_MS);
  fileIngestRecoveryTimer.unref?.();

  for (;;) {
    if (shuttingDown) {
      break;
    }

    try {
      let claimedRun = false;
      while (!shuttingDown && activeRuns.size < MAX_CONCURRENT_RUNS) {
        const attempt = await claimNextQueuedAttempt(config, new Set(activeRuns.keys()));
        if (!attempt) {
          break;
        }

        if (shuttingDown) {
          console.warn(
            `[basquio-worker] shutdown raced with claim for run ${attempt.run_id} attempt ${attempt.attempt_number}; requeueing before start`,
          );
          await handoffClaimedAttemptOnShutdown(config, attempt);
          break;
        }

        claimedRun = true;
        const startedAt = Date.now();
        console.log(
          `[basquio-worker] claimed run ${attempt.run_id} attempt ${attempt.attempt_number} (${activeRuns.size + 1}/${MAX_CONCURRENT_RUNS})`,
        );
        const stopHeartbeat = startHeartbeat(config, attempt);
        const abortController = new AbortController();
        const promise = processRun(config, attempt, startedAt, abortController.signal)
          .finally(() => {
            stopHeartbeat();
            activeRuns.delete(attempt.run_id);
          });
        activeRuns.set(attempt.run_id, { attempt, promise, stopHeartbeat, abortController });
      }

      // Process queued template import jobs (lightweight, no heartbeat needed)
      if (!shuttingDown && !claimedRun) {
        await processTemplateImportJobs(config);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[basquio-worker] poll loop error: ${message}`);
    }

    if (shuttingDown) {
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  clearInterval(recoveryTimer);
  clearInterval(fileIngestRecoveryTimer);

  // Drain the file-ingest loop alongside deck runs. The loop returns
  // when isShuttingDown is true; since shuttingDown is already set
  // here, awaiting its promise just lets any in-flight processor call
  // finish before we exit. Cap the wait at the same drain budget.
  await Promise.race([fileIngestLoop.catch(() => undefined), sleep(SHUTDOWN_DRAIN_TIMEOUT_MS)]);

  if (activeRuns.size > 0) {
    console.log(`[basquio-worker] waiting up to ${SHUTDOWN_DRAIN_TIMEOUT_MS}ms for ${activeRuns.size} active runs to finish`);
    await Promise.race([
      Promise.allSettled([...activeRuns.values()].map((entry) => entry.promise)),
      sleep(SHUTDOWN_DRAIN_TIMEOUT_MS),
    ]);
  }

  if (activeRuns.size > 0) {
    const interruptedRuns = new Map(activeRuns);
    console.warn(
      `[basquio-worker] shutdown drain timed out; aborting and handing off ${interruptedRuns.size} in-flight attempts`,
    );
    for (const { abortController } of interruptedRuns.values()) {
      abortController.abort();
    }
    await handoffActiveRuns(config, interruptedRuns);
    await Promise.race([
      Promise.allSettled([...interruptedRuns.values()].map((entry) => entry.promise)),
      sleep(Math.min(10_000, SHUTDOWN_DRAIN_TIMEOUT_MS)),
    ]);
  }

  console.log("[basquio-worker] shutdown complete");
}

async function processRun(
  config: ReturnType<typeof resolveConfig>,
  attempt: QueuedRunRow,
  startedAt: number,
  abortSignal: AbortSignal,
) {
  try {
    await generateDeckRun(attempt.run_id, {
      id: attempt.id,
      attemptNumber: attempt.attempt_number,
      abortSignal,
    });
    console.log(
      `[basquio-worker] completed run ${attempt.run_id} attempt ${attempt.attempt_number} in ${Math.round((Date.now() - startedAt) / 1000)}s`,
    );
  } catch (error) {
    if (error instanceof AttemptOwnershipLostError) {
      const now = new Date().toISOString();
      await closeOpenRequestUsageRows({
        config,
        attemptId: attempt.id,
        status: "superseded",
        completedAt: now,
        note: "Attempt lost ownership to a newer active attempt.",
      });
      await finalizeSupersededAttempt({
        config,
        attemptId: attempt.id,
        completedAt: now,
        status: "failed",
        failurePhase: "attempt_superseded",
        failureMessage: "Attempt lost ownership to a newer active attempt.",
      });
      console.warn(
        `[basquio-worker] attempt ${attempt.id} for run ${attempt.run_id} lost ownership to a newer attempt; stopping old worker path`,
      );
      return;
    }
    if (error instanceof WorkerShutdownInterruptError) {
      console.warn(
        `[basquio-worker] run ${attempt.run_id} attempt ${attempt.attempt_number} interrupted for shutdown; awaiting superseding attempt handoff`,
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[basquio-worker] run ${attempt.run_id} attempt ${attempt.attempt_number} failed: ${message}`);

    // Layer 2: automatic superseding attempt for transient provider/network failures
    // Layer E: template fallback — if a template-backed run fails, allow one fallback attempt
    const failureClass = classifyRuntimeError(error);
    const MAX_TRANSIENT_ATTEMPTS = 3;
    const shouldAutoRecover =
      (failureClass === "transient_provider" || failureClass === "transient_network") &&
      attempt.attempt_number < MAX_TRANSIENT_ATTEMPTS;

    if (shouldAutoRecover) {
      try {
        const newAttemptId = randomUUID();
        const newAttemptNumber = attempt.attempt_number + 1;
        const now = new Date().toISOString();
        const recoveryReason = failureClass === "transient_network"
          ? "transient_network_retry"
          : "transient_provider_retry";

        const recoveryRows = await callWorkerRpc<Array<{ attempt_id: string; attempt_number: number }>>({
          supabaseUrl: config.supabaseUrl,
          serviceKey: config.serviceKey,
          functionName: "recover_deck_run_attempt",
          params: {
            p_run_id: attempt.run_id,
            p_old_attempt_id: attempt.id,
            p_new_attempt_id: newAttemptId,
            p_new_attempt_number: newAttemptNumber,
            p_recovery_reason: recoveryReason,
            p_now: now,
          },
        });
        if (!recoveryRows[0]) {
          throw new Error("superseding attempt was not created");
        }
        await finalizeSupersededAttempt({
          config,
          attemptId: attempt.id,
          completedAt: now,
          status: "failed",
        });

        console.log(
          `[basquio-worker] ${failureClass} on run ${attempt.run_id} — created superseding attempt ${newAttemptNumber}/${MAX_TRANSIENT_ATTEMPTS}`,
        );
      } catch (recoveryError) {
        const recoveryMsg = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
        console.error(`[basquio-worker] failed to create superseding attempt for ${attempt.run_id}: ${recoveryMsg}`);
        // Fall through to credit refund
        await refundCreditSafe(config, attempt.run_id);
      }
    } else {
      // E: Template fallback — only trigger when failure is plausibly template-related.
      // Template interpretation happens in normalize/understand. Failures in author/critique/
      // revise/export are not template-caused and should not silently switch to Basquio Standard.
      const runForFallback = await fetchRestRows<{ template_profile_id: string | null; failure_phase: string | null }>({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_runs",
        query: { select: "template_profile_id,failure_phase", id: `eq.${attempt.run_id}`, limit: "1" },
      }).catch(() => []);
      const isTemplateBacked = Boolean(runForFallback[0]?.template_profile_id);
      const failurePhase = runForFallback[0]?.failure_phase ?? "";
      const isTemplateRelatedPhase = ["normalize", "understand"].includes(failurePhase);
      const canFallback = isTemplateBacked && attempt.attempt_number === 1 && isTemplateRelatedPhase;

      if (canFallback) {
        try {
          const newAttemptId = randomUUID();
          const now = new Date().toISOString();

          const fallbackRows = await callWorkerRpc<Array<{ attempt_id: string; attempt_number: number }>>({
            supabaseUrl: config.supabaseUrl,
            serviceKey: config.serviceKey,
            functionName: "recover_deck_run_attempt",
            params: {
              p_run_id: attempt.run_id,
              p_old_attempt_id: attempt.id,
              p_new_attempt_id: newAttemptId,
              p_new_attempt_number: 2,
              p_recovery_reason: "template_fallback",
              p_now: now,
            },
          });
          if (!fallbackRows[0]) {
            throw new Error("template fallback attempt was not created");
          }
          await finalizeSupersededAttempt({
            config,
            attemptId: attempt.id,
            completedAt: now,
            status: "failed",
          });

          console.log(`[basquio-worker] template-backed run ${attempt.run_id} failed — created template_fallback attempt`);
        } catch (fallbackError) {
          const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          console.error(`[basquio-worker] template fallback failed for ${attempt.run_id}: ${fallbackMsg}`);
          await refundCreditSafe(config, attempt.run_id);
        }
      } else {
        // Non-transient, non-template or budget exhausted — refund credit
        await refundCreditSafe(config, attempt.run_id);
      }
    }
  }
}

async function handoffActiveRuns(
  config: ReturnType<typeof resolveConfig>,
  activeRuns: ReadonlyMap<string, ActiveRunState>,
) {
  const handoffResults = await Promise.allSettled(
    [...activeRuns.entries()].map(async ([runId, { attempt, stopHeartbeat }]) => {
      stopHeartbeat();
      const recovery = await recoverAttemptForShutdown(config, runId, attempt);
      if (recovery) {
        console.warn(
          `[basquio-worker] handed off run ${runId} to attempt ${recovery.attempt_number} before shutdown`,
        );
        return runId;
      }
      console.warn(
        `[basquio-worker] leaving run ${runId} on active attempt ${attempt.id}; stale recovery will supersede it after shutdown if direct handoff could not be recorded`,
      );
      return null;
    }),
  );

  const handedOffRunIds = handoffResults
    .filter((result): result is PromiseFulfilledResult<string | null> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((value): value is string => typeof value === "string");

  for (const result of handoffResults) {
    if (result.status === "rejected") {
      console.error(`[basquio-worker] shutdown handoff failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  }

  if (handedOffRunIds.length > 0) {
    console.log(`[basquio-worker] shutdown handoff queued superseding attempts for: ${handedOffRunIds.join(", ")}`);
  }
}

async function handoffClaimedAttemptOnShutdown(
  config: ReturnType<typeof resolveConfig>,
  attempt: QueuedRunRow,
) {
  try {
    const recovery = await recoverAttemptForShutdown(config, attempt.run_id, attempt);
    if (recovery) {
      console.warn(
        `[basquio-worker] requeued claimed run ${attempt.run_id} to attempt ${recovery.attempt_number} during shutdown`,
      );
      return;
    }
  } catch (error) {
    console.error(
      `[basquio-worker] failed to requeue claimed run ${attempt.run_id} during shutdown: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  console.warn(
    `[basquio-worker] leaving claimed run ${attempt.run_id} on attempt ${attempt.id}; stale recovery will supersede it after shutdown if direct handoff could not be recorded`,
  );
}

async function recoverAttemptForShutdown(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: QueuedRunRow,
) {
  const now = new Date().toISOString();
  const priorAttempt = await fetchRestRows<{ recovery_reason: string | null }>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "recovery_reason",
      id: `eq.${attempt.id}`,
      limit: "1",
    },
  }).catch(() => []);
  const inheritedRecoveryReason = priorAttempt[0]?.recovery_reason ?? null;
  const recoveryReason = shouldResetCrossAttemptBudget(inheritedRecoveryReason)
    ? inheritedRecoveryReason!
    : SHUTDOWN_RECOVERY_REASON;
  await closeOpenRequestUsageRows({
    config,
    attemptId: attempt.id,
    status: "interrupted_shutdown",
    completedAt: now,
    note: "Worker shutdown interrupted the in-flight provider request before completion.",
  });
  const recoveryRows = await callWorkerRpc<Array<{ attempt_id: string; attempt_number: number }>>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    functionName: "recover_deck_run_attempt",
    params: {
      p_run_id: runId,
      p_old_attempt_id: attempt.id,
      p_new_attempt_id: randomUUID(),
      p_new_attempt_number: attempt.attempt_number + 1,
      p_recovery_reason: recoveryReason,
      p_now: now,
      p_expected_old_status: "running",
      p_old_status_override: "failed",
      p_failure_phase: SHUTDOWN_RECOVERY_REASON,
      p_failure_message: "Worker shutdown interrupted the run; Basquio automatically requeued it.",
    },
  });

  if (recoveryRows[0]) {
    await finalizeSupersededAttempt({
      config,
      attemptId: attempt.id,
      completedAt: now,
      status: "failed",
    });
  }

  return recoveryRows[0] ?? null;
}

function resolveConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required.");
  }

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
  }

  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  return {
    supabaseUrl,
    serviceKey,
  };
}

function resolveWorkerDeploymentId() {
  return process.env.RAILWAY_DEPLOYMENT_ID ?? process.env.RAILWAY_RELEASE_ID ?? process.env.HOSTNAME ?? "local-worker";
}

async function callWorkerRpc<T>(input: {
  supabaseUrl: string;
  serviceKey: string;
  functionName: string;
  params?: Record<string, unknown>;
}) {
  const url = new URL(`/rest/v1/rpc/${input.functionName}`, input.supabaseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: buildWorkerServiceHeaders(input.serviceKey, {
      Accept: "application/json",
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input.params ?? {}),
    signal: AbortSignal.timeout(WORKER_RPC_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(await readWorkerError(response, `Unable to execute RPC ${input.functionName}.`));
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

function buildWorkerServiceHeaders(serviceKey: string, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("apikey", serviceKey);

  if (isJwtLikeKey(serviceKey) && !isSupabaseSecretKey(serviceKey)) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }

  return headers;
}

function isSupabaseSecretKey(value: string) {
  return value.startsWith("sb_secret_");
}

function isJwtLikeKey(value: string) {
  return value.split(".").length === 3;
}

async function readWorkerError(response: Response, fallback: string) {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { error?: string; message?: string };
      return payload.error ?? payload.message ?? fallback;
    }

    const text = await response.text();
    return text || fallback;
  } catch {
    return fallback;
  }
}

async function recoverStaleAttempts(config: ReturnType<typeof resolveConfig>) {
  const runningAttempts = await fetchRestRows<RunningAttemptRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,run_id,attempt_number,last_meaningful_event_at,updated_at",
      status: "eq.running",
      superseded_by_attempt_id: "is.null",
      order: "created_at.asc",
    },
  }).catch(() => []);

  const staleAttempts: QueuedRunRow[] = [];
  for (const attempt of runningAttempts) {
    const parentRun = await fetchRestRows<{
      id: string;
      current_phase: string | null;
      active_attempt_id: string | null;
      phase_started_at: string | null;
    }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        select: "id,current_phase,active_attempt_id,phase_started_at",
        id: `eq.${attempt.run_id}`,
        limit: "1",
      },
    }).catch(() => []);

    const runRow = parentRun[0];
    if (!runRow || runRow.active_attempt_id !== attempt.id) {
      continue;
    }

    const activePhaseRequests = await fetchRestRows<ActivePhaseRequestRow>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_request_usage",
      query: {
        select: "started_at,completed_at",
        attempt_id: `eq.${attempt.id}`,
        request_kind: "eq.phase_generation",
        completed_at: "is.null",
        order: "started_at.desc",
        limit: "1",
        ...(runRow.current_phase ? { phase: `eq.${runRow.current_phase}` } : {}),
      },
    }).catch(() => []);

    const activeRequest = activePhaseRequests[0];
    const activeRequestStartedAt = Date.parse(activeRequest?.started_at ?? "");
    const activeRequestWithinGrace =
      Boolean(activeRequest) &&
      Number.isFinite(activeRequestStartedAt) &&
      activeRequestStartedAt >= Date.now() - ACTIVE_REQUEST_GRACE_MS;
    if (activeRequestWithinGrace) {
      continue;
    }

    const updatedAt = Date.parse(attempt.updated_at);
    const workerLikelyDead = !Number.isFinite(updatedAt) || updatedAt < Date.now() - STALE_RUN_MINUTES * 60_000;
    if (workerLikelyDead) {
      staleAttempts.push({
        id: attempt.id,
        run_id: attempt.run_id,
        attempt_number: attempt.attempt_number,
      });
      continue;
    }

    const staleMinutes = getMeaningfulStaleMinutesForPhase(runRow.current_phase);
    const staleBefore = Date.now() - staleMinutes * 60_000;
    const progressAt = Date.parse(attempt.last_meaningful_event_at ?? attempt.updated_at);
    if (!Number.isFinite(progressAt) || progressAt >= staleBefore) {
      continue;
    }
    const phaseStartedAt = Date.parse(runRow.phase_started_at ?? "");
    const livePhaseExceeded =
      !Number.isFinite(phaseStartedAt) ||
      phaseStartedAt < Date.now() - LIVE_PHASE_STALE_MS;
    if (!livePhaseExceeded) {
      continue;
    }
    staleAttempts.push({
      id: attempt.id,
      run_id: attempt.run_id,
      attempt_number: attempt.attempt_number,
    });
  }

  // D1: Also recover stale queued attempts (new — stranded queued work)
  const staleQueuedBefore = new Date(Date.now() - STALE_RUN_MINUTES * 2 * 60_000).toISOString();
  const staleQueuedAttempts = await fetchRestRows<QueuedRunRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,run_id,attempt_number",
      status: "eq.queued",
      superseded_by_attempt_id: "is.null",
      updated_at: `lt.${staleQueuedBefore}`,
      order: "created_at.asc",
    },
  }).catch(() => []);

  // For stale queued attempts, verify the parent run still references them.
  // If so, re-stamp updated_at so the main poll loop picks them up.
  // If the parent run has moved on, mark them as failed.
  for (const attempt of staleQueuedAttempts) {
    const parentRun = await fetchRestRows<{
      id: string;
      active_attempt_id: string | null;
      latest_attempt_id: string | null;
      status: string;
    }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        select: "id,active_attempt_id,latest_attempt_id,status",
        id: `eq.${attempt.run_id}`,
        limit: "1",
      },
    }).catch(() => []);

    const runRow = parentRun[0];
    const stillReferenced = runRow && (runRow.active_attempt_id === attempt.id || runRow.latest_attempt_id === attempt.id);
    const now = new Date().toISOString();

    if (stillReferenced && (runRow.status === "queued" || runRow.status === "running")) {
      // Re-stamp so poll loop picks it up
      await patchRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_run_attempts",
        query: { id: `eq.${attempt.id}`, status: "eq.queued" },
        payload: { updated_at: now },
      }).catch(() => []);
      await patchRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_runs",
        query: { id: `eq.${attempt.run_id}` },
        payload: { status: "queued", updated_at: now },
      }).catch(() => []);
      console.log(`[basquio-worker] re-stamped stale queued attempt ${attempt.id} for run ${attempt.run_id}`);
    } else {
      // Orphaned or parent moved on — mark as failed
      await patchRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_run_attempts",
        query: { id: `eq.${attempt.id}`, status: "eq.queued" },
        payload: {
          status: "failed",
          completed_at: now,
          failure_phase: "queue_integrity",
          failure_message: "Stale queued attempt no longer referenced by parent run.",
          updated_at: now,
        },
      }).catch(() => []);
      console.log(`[basquio-worker] marked orphaned stale queued attempt ${attempt.id} as failed`);
    }
  }

  if (staleQueuedAttempts.length > 0) {
    console.log(`[basquio-worker] processed ${staleQueuedAttempts.length} stale queued attempts`);
  }

  const now = new Date().toISOString();
  const recoveredRunIds: string[] = [];
  const recoveryFailures: string[] = [];
  for (const attempt of staleAttempts) {
    const newAttemptId = randomUUID();
    const newAttemptNumber = attempt.attempt_number + 1;

    await closeOpenRequestUsageRows({
      config,
      attemptId: attempt.id,
      status: "stale_timeout",
      completedAt: now,
      note: "Attempt was automatically recovered after stale timeout.",
    });

    const recovered = await callWorkerRpc<Array<{ attempt_id: string; attempt_number: number }>>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      functionName: "recover_deck_run_attempt",
      params: {
        p_run_id: attempt.run_id,
        p_old_attempt_id: attempt.id,
        p_new_attempt_id: newAttemptId,
        p_new_attempt_number: newAttemptNumber,
        p_recovery_reason: "stale_timeout",
        p_now: now,
        p_expected_old_status: "running",
        p_old_status_override: "failed",
        p_failure_phase: "stale_timeout",
        p_failure_message: "Run timed out and was automatically recovered.",
      },
    }).catch((error) => {
      recoveryFailures.push(`${attempt.run_id}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    if (!recovered[0]) {
      recoveryFailures.push(`${attempt.run_id}: no superseding attempt created`);
      continue;
    }
    await finalizeSupersededAttempt({
      config,
      attemptId: attempt.id,
      completedAt: now,
      status: "failed",
    }).catch((error) => {
      recoveryFailures.push(
        `${attempt.run_id}: failed to stamp superseded attempt terminal state (${error instanceof Error ? error.message : String(error)})`,
      );
    });
    recoveredRunIds.push(attempt.run_id);
  }

  if (recoveredRunIds.length > 0) {
    console.log(
      `[basquio-worker] recovered ${recoveredRunIds.length} stale attempts with new superseding attempts: ${recoveredRunIds.join(", ")}`,
    );
  }
  if (recoveryFailures.length > 0) {
    console.warn(`[basquio-worker] stale recovery failures: ${recoveryFailures.join(" | ")}`);
  }
}

async function finalizeSupersededAttempt(input: {
  config: ReturnType<typeof resolveConfig>;
  attemptId: string;
  completedAt: string;
  status?: "failed" | "completed";
  failurePhase?: string;
  failureMessage?: string;
}) {
  const payload: Record<string, string> = {
    updated_at: input.completedAt,
    completed_at: input.completedAt,
  };

  if (input.status) {
    payload.status = input.status;
  }
  if (input.failurePhase) {
    payload.failure_phase = input.failurePhase;
  }
  if (input.failureMessage) {
    payload.failure_message = input.failureMessage;
  }

  await patchRestRows({
    supabaseUrl: input.config.supabaseUrl,
    serviceKey: input.config.serviceKey,
    table: "deck_run_attempts",
    query: {
      id: `eq.${input.attemptId}`,
      superseded_by_attempt_id: "not.is.null",
      completed_at: "is.null",
    },
    payload,
  }).catch(() => []);
}

async function claimNextQueuedAttempt(
  config: ReturnType<typeof resolveConfig>,
  excludedRunIds: ReadonlySet<string> = new Set(),
) {
  const queuedAttempts = await fetchRestRows<QueuedRunRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,run_id,attempt_number",
      status: "eq.queued",
      superseded_by_attempt_id: "is.null",
      order: "created_at.asc",
      limit: "25",
    },
  }).catch(() => []);

  for (const candidate of queuedAttempts) {
    if (excludedRunIds.has(candidate.run_id)) {
      continue;
    }

    const parentRun = await fetchRestRows<{
      id: string;
      active_attempt_id: string | null;
      latest_attempt_id: string | null;
      status: string;
    }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        select: "id,active_attempt_id,latest_attempt_id,status",
        id: `eq.${candidate.run_id}`,
        limit: "1",
      },
    }).catch(() => []);

    const runRow = parentRun[0];
    const stillReferenced = runRow && (runRow.active_attempt_id === candidate.id || runRow.latest_attempt_id === candidate.id);
    if (!stillReferenced) {
      await patchRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_run_attempts",
        query: {
          id: `eq.${candidate.id}`,
          status: "eq.queued",
        },
        payload: {
          status: "failed",
          failure_phase: "queue_integrity",
          failure_message: "Queued attempt no longer referenced by parent run.",
          updated_at: new Date().toISOString(),
        },
      }).catch(() => []);
      continue;
    }

    const now = new Date().toISOString();
    const claimed = await callWorkerRpc<Array<QueuedRunRow>>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      functionName: "claim_deck_run_attempt",
      params: {
        p_attempt_id: candidate.id,
        p_started_at: now,
        p_worker_deployment_id: resolveWorkerDeploymentId(),
      },
    }).catch(() => []);

    if (!claimed[0]) {
      continue;
    }

    return claimed[0] ?? null;
  }

  return null;
}

function startHeartbeat(config: ReturnType<typeof resolveConfig>, attempt: QueuedRunRow) {
  const timer = setInterval(() => {
    const now = new Date().toISOString();
    void Promise.all([
      patchRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_runs",
        query: {
          id: `eq.${attempt.run_id}`,
          status: "eq.running",
          active_attempt_id: `eq.${attempt.id}`,
        },
        payload: {
          updated_at: now,
        },
      }),
      patchRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_run_attempts",
        query: {
          id: `eq.${attempt.id}`,
          status: "eq.running",
          superseded_by_attempt_id: "is.null",
        },
        payload: {
          updated_at: now,
        },
      }),
    ]).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[basquio-worker] heartbeat failed for ${attempt.run_id} attempt ${attempt.attempt_number}: ${message}`);
    });
  }, HEARTBEAT_INTERVAL_MS);

  timer.unref?.();

  return () => clearInterval(timer);
}

async function processTemplateImportJobs(config: ReturnType<typeof resolveConfig>) {
  try {
    // Recover stale running imports. Large PPTX templates can legitimately take several minutes.
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const staleImports = await fetchRestRows<{ id: string; template_profile_id: string | null }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "template_import_jobs",
      query: {
        select: "id,template_profile_id",
        status: "eq.running",
        updated_at: `lt.${staleBefore}`,
        limit: "5",
      },
    }).catch(() => []);

    for (const stale of staleImports) {
      await patchRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "template_import_jobs",
        query: { id: `eq.${stale.id}`, status: "eq.running" },
        payload: {
          status: "queued",
          updated_at: new Date().toISOString(),
        },
      }).catch(() => []);
      console.log(`[basquio-worker] recovered stale template import ${stale.id}`);
    }

    // Process queued imports
    const queued = await fetchRestRows<{ id: string }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "template_import_jobs",
      query: {
        select: "id",
        status: "eq.queued",
        order: "created_at.asc",
        limit: "1",
      },
    }).catch(() => []);

    for (const job of queued) {
      // Claim the job atomically
      const claimed = await patchRestRows<{ id: string }>({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "template_import_jobs",
        query: { id: `eq.${job.id}`, status: "eq.queued" },
        select: "id",
        payload: {
          status: "running",
          updated_at: new Date().toISOString(),
        },
      }).catch(() => []);

      if (!claimed[0]) continue;

      console.log(`[basquio-worker] processing template import ${job.id}`);
      try {
        await runTemplateImportJob(job.id, config);
        console.log(`[basquio-worker] template import ${job.id} completed`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[basquio-worker] template import ${job.id} failed: ${message}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[basquio-worker] template import poll error: ${message}`);
  }
}

async function refundCreditSafe(config: ReturnType<typeof resolveConfig>, runId: string) {
  try {
    const run = await fetchRestRows<{ requested_by: string }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: { select: "requested_by", id: `eq.${runId}`, limit: "1" },
    });
    if (run[0]?.requested_by) {
      const result = await refundCredit({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        userId: run[0].requested_by,
        runId,
      });
      if (result.status === "refunded") {
        console.log(`[basquio-worker] refunded ${result.amount} credits for failed run ${runId}`);
      } else if (result.status === "already_refunded") {
        console.log(`[basquio-worker] refund already exists for failed run ${runId}`);
      } else {
        console.error(`[basquio-worker] refund lookup found no debit for failed run ${runId}`);
      }
    }
  } catch (refundError) {
    const refundMsg = refundError instanceof Error ? refundError.message : String(refundError);
    console.error(`[basquio-worker] credit refund failed for ${runId}: ${refundMsg}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[basquio-worker] fatal startup error: ${message}`);
  process.exit(1);
});
