import { randomUUID } from "node:crypto";
import { AttemptOwnershipLostError, generateDeckRun } from "../packages/workflows/src/generate-deck";
import { classifyRuntimeError } from "../packages/workflows/src/failure-classifier";
import { runTemplateImportJob } from "../packages/workflows/src/template-import";
import { fetchRestRows, patchRestRows, upsertRestRows } from "../packages/workflows/src/supabase";
import { loadBasquioScriptEnv } from "./load-app-env";
import { refundCredit } from "../apps/web/src/lib/credits";

loadBasquioScriptEnv();

const POLL_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_POLL_INTERVAL_MS ?? "5000", 10);
const STALE_RUN_MINUTES = Number.parseInt(process.env.BASQUIO_WORKER_STALE_MINUTES ?? "5", 10);
const STALE_ATTEMPT_MEANINGFUL_MINUTES = Number.parseInt(
  process.env.BASQUIO_ATTEMPT_MEANINGFUL_STALE_MINUTES ?? "8",
  10,
);
const HEARTBEAT_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_HEARTBEAT_INTERVAL_MS ?? "30000", 10);
const RECOVERY_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_RECOVERY_INTERVAL_MS ?? "60000", 10);
const MAX_CONCURRENT_RUNS = Math.max(1, Number.parseInt(process.env.BASQUIO_WORKER_MAX_CONCURRENCY ?? "2", 10));
const SHUTDOWN_DRAIN_TIMEOUT_MS = Math.max(1_000, Number.parseInt(process.env.BASQUIO_WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS ?? "25000", 10));
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

type ActiveRunState = {
  attempt: QueuedRunRow;
  promise: Promise<void>;
  stopHeartbeat: () => void;
};

function getMeaningfulStaleMinutesForPhase(phase: string | null | undefined) {
  switch (phase) {
    case "author":
      return 30;
    case "understand":
      return 12;
    case "revise":
      return 18;
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

        claimedRun = true;
        const startedAt = Date.now();
        console.log(
          `[basquio-worker] claimed run ${attempt.run_id} attempt ${attempt.attempt_number} (${activeRuns.size + 1}/${MAX_CONCURRENT_RUNS})`,
        );
        const stopHeartbeat = startHeartbeat(config, attempt);
        const promise = processRun(config, attempt, startedAt)
          .finally(() => {
            stopHeartbeat();
            activeRuns.delete(attempt.run_id);
          });
        activeRuns.set(attempt.run_id, { attempt, promise, stopHeartbeat });
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

  if (activeRuns.size > 0) {
    console.warn(`[basquio-worker] handing off ${activeRuns.size} active runs before shutdown`);
    await handoffActiveRuns(config, activeRuns);
  }

  if (activeRuns.size > 0) {
    console.log(`[basquio-worker] waiting up to ${SHUTDOWN_DRAIN_TIMEOUT_MS}ms for ${activeRuns.size} active runs to finish`);
    await Promise.race([
      Promise.allSettled([...activeRuns.values()].map((entry) => entry.promise)),
      sleep(SHUTDOWN_DRAIN_TIMEOUT_MS),
    ]);
  }

  if (activeRuns.size > 0) {
    console.warn(`[basquio-worker] shutdown drain timed out; leaving ${activeRuns.size} in-flight attempts for stale recovery`);
    for (const [runId, { attempt, stopHeartbeat }] of activeRuns) {
      stopHeartbeat();
      console.warn(
        `[basquio-worker] did not requeue attempt ${attempt.id} for run ${runId}; duplicate execution is worse than waiting for stale recovery`,
      );
    }
  }

  console.log("[basquio-worker] shutdown complete");
}

async function processRun(
  config: ReturnType<typeof resolveConfig>,
  attempt: QueuedRunRow,
  startedAt: number,
) {
  try {
    await generateDeckRun(attempt.run_id, {
      id: attempt.id,
      attemptNumber: attempt.attempt_number,
    });
    console.log(
      `[basquio-worker] completed run ${attempt.run_id} attempt ${attempt.attempt_number} in ${Math.round((Date.now() - startedAt) / 1000)}s`,
    );
  } catch (error) {
    if (error instanceof AttemptOwnershipLostError) {
      console.warn(
        `[basquio-worker] attempt ${attempt.id} for run ${attempt.run_id} lost ownership to a newer attempt; stopping old worker path`,
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
  const handedOffRunIds: string[] = [];

  for (const [runId, { attempt, stopHeartbeat }] of activeRuns) {
    stopHeartbeat();
    const now = new Date().toISOString();

    try {
      const recoveryRows = await callWorkerRpc<Array<{ attempt_id: string; attempt_number: number }>>({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        functionName: "recover_deck_run_attempt",
        params: {
          p_run_id: runId,
          p_old_attempt_id: attempt.id,
          p_new_attempt_id: randomUUID(),
          p_new_attempt_number: attempt.attempt_number + 1,
          p_recovery_reason: SHUTDOWN_RECOVERY_REASON,
          p_now: now,
          p_expected_old_status: "running",
          p_old_status_override: "failed",
          p_failure_phase: SHUTDOWN_RECOVERY_REASON,
          p_failure_message: "Worker shutdown interrupted the run; Basquio automatically requeued it.",
        },
      });

      if (recoveryRows[0]) {
        handedOffRunIds.push(runId);
        console.warn(
          `[basquio-worker] handed off run ${runId} to attempt ${recoveryRows[0].attempt_number} before shutdown`,
        );
        continue;
      }
    } catch (error) {
      console.error(
        `[basquio-worker] shutdown handoff failed for ${runId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    console.warn(
      `[basquio-worker] leaving run ${runId} on active attempt ${attempt.id}; stale recovery will supersede it after shutdown if direct handoff could not be recorded`,
    );
  }

  if (handedOffRunIds.length > 0) {
    console.log(`[basquio-worker] shutdown handoff queued superseding attempts for: ${handedOffRunIds.join(", ")}`);
  }
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
    }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        select: "id,current_phase,active_attempt_id",
        id: `eq.${attempt.run_id}`,
        limit: "1",
      },
    }).catch(() => []);

    const runRow = parentRun[0];
    if (!runRow || runRow.active_attempt_id !== attempt.id) {
      continue;
    }

    const staleMinutes = getMeaningfulStaleMinutesForPhase(runRow.current_phase);
    const staleBefore = Date.now() - staleMinutes * 60_000;
    const progressAt = Date.parse(attempt.last_meaningful_event_at ?? attempt.updated_at);
    if (Number.isFinite(progressAt) && progressAt < staleBefore) {
      staleAttempts.push({
        id: attempt.id,
        run_id: attempt.run_id,
        attempt_number: attempt.attempt_number,
      });
    }
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
    // Recover stale running imports (stuck > 5 minutes)
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
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
