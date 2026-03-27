import { randomUUID } from "node:crypto";
import { generateDeckRun } from "../packages/workflows/src/generate-deck";
import { isTransientProviderError } from "../packages/workflows/src/failure-classifier";
import { runTemplateImportJob } from "../packages/workflows/src/template-import";
import { fetchRestRows, patchRestRows, upsertRestRows } from "../packages/workflows/src/supabase";
import { loadBasquioScriptEnv } from "./load-app-env";
import { refundCredit } from "../apps/web/src/lib/credits";

loadBasquioScriptEnv();

const POLL_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_POLL_INTERVAL_MS ?? "5000", 10);
const STALE_RUN_MINUTES = Number.parseInt(process.env.BASQUIO_WORKER_STALE_MINUTES ?? "5", 10);
const HEARTBEAT_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_HEARTBEAT_INTERVAL_MS ?? "30000", 10);
const RECOVERY_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_RECOVERY_INTERVAL_MS ?? "60000", 10);

type QueuedRunRow = {
  run_id: string;
  id: string;
  attempt_number: number;
};

async function main() {
  const config = resolveConfig();
  let shuttingDown = false;
  let activeAttempt: QueuedRunRow | null = null;
  let lastActiveAttempt: QueuedRunRow | null = null; // preserved for shutdown requeue
  let recoveryInFlight = false;

  const requestShutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.warn(`[basquio-worker] received ${signal}; draining before shutdown`);

    if (!activeAttempt) {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => requestShutdown("SIGTERM"));
  process.on("SIGINT", () => requestShutdown("SIGINT"));

  console.log("[basquio-worker] starting");
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
      const attempt = await claimNextQueuedAttempt(config);

      if (attempt) {
        const startedAt = Date.now();
        activeAttempt = attempt;
        console.log(`[basquio-worker] claimed run ${attempt.run_id} attempt ${attempt.attempt_number}`);
        const stopHeartbeat = startHeartbeat(config, attempt);

        try {
          await generateDeckRun(attempt.run_id, {
            id: attempt.id,
            attemptNumber: attempt.attempt_number,
          });
          console.log(
            `[basquio-worker] completed run ${attempt.run_id} attempt ${attempt.attempt_number} in ${Math.round((Date.now() - startedAt) / 1000)}s`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[basquio-worker] run ${attempt.run_id} attempt ${attempt.attempt_number} failed: ${message}`);

          // Layer 2: automatic superseding attempt for transient provider failures
          // Layer E: template fallback — if a template-backed run fails, allow one fallback attempt
          const isTransient = isTransientProviderError(error);
          const MAX_TRANSIENT_ATTEMPTS = 3;
          const shouldAutoRecover = isTransient && attempt.attempt_number < MAX_TRANSIENT_ATTEMPTS;

          if (shouldAutoRecover) {
            try {
              const newAttemptId = randomUUID();
              const newAttemptNumber = attempt.attempt_number + 1;
              const now = new Date().toISOString();

              // Mark current attempt as failed-transient
              await patchRestRows({
                supabaseUrl: config.supabaseUrl,
                serviceKey: config.serviceKey,
                table: "deck_run_attempts",
                query: { id: `eq.${attempt.id}` },
                payload: {
                  superseded_by_attempt_id: newAttemptId,
                  updated_at: now,
                },
              }).catch(() => []);

              // Create superseding attempt
              await upsertRestRows({
                supabaseUrl: config.supabaseUrl,
                serviceKey: config.serviceKey,
                table: "deck_run_attempts",
                onConflict: "id",
                rows: [{
                  id: newAttemptId,
                  run_id: attempt.run_id,
                  attempt_number: newAttemptNumber,
                  status: "queued",
                  recovery_reason: "transient_provider_retry",
                  created_at: now,
                  updated_at: now,
                }],
              });

              // Requeue the parent run
              await patchRestRows({
                supabaseUrl: config.supabaseUrl,
                serviceKey: config.serviceKey,
                table: "deck_runs",
                query: { id: `eq.${attempt.run_id}` },
                payload: {
                  status: "queued",
                  failure_message: null,
                  failure_phase: null,
                  delivery_status: "draft",
                  updated_at: now,
                  active_attempt_id: newAttemptId,
                  latest_attempt_id: newAttemptId,
                  latest_attempt_number: newAttemptNumber,
                },
              });

              console.log(
                `[basquio-worker] transient failure on run ${attempt.run_id} — created superseding attempt ${newAttemptNumber}/${MAX_TRANSIENT_ATTEMPTS}`,
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

                await patchRestRows({
                  supabaseUrl: config.supabaseUrl,
                  serviceKey: config.serviceKey,
                  table: "deck_run_attempts",
                  query: { id: `eq.${attempt.id}` },
                  payload: { superseded_by_attempt_id: newAttemptId, updated_at: now },
                }).catch(() => []);

                await upsertRestRows({
                  supabaseUrl: config.supabaseUrl,
                  serviceKey: config.serviceKey,
                  table: "deck_run_attempts",
                  onConflict: "id",
                  rows: [{
                    id: newAttemptId,
                    run_id: attempt.run_id,
                    attempt_number: 2,
                    status: "queued",
                    recovery_reason: "template_fallback",
                    created_at: now,
                    updated_at: now,
                  }],
                });

                await patchRestRows({
                  supabaseUrl: config.supabaseUrl,
                  serviceKey: config.serviceKey,
                  table: "deck_runs",
                  query: { id: `eq.${attempt.run_id}` },
                  payload: {
                    status: "queued",
                    failure_message: null,
                    failure_phase: null,
                    delivery_status: "draft",
                    updated_at: now,
                    active_attempt_id: newAttemptId,
                    latest_attempt_id: newAttemptId,
                    latest_attempt_number: 2,
                  },
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
        } finally {
          stopHeartbeat();
          lastActiveAttempt = activeAttempt;
          activeAttempt = null;
        }
      }

      // Process queued template import jobs (lightweight, no heartbeat needed)
      if (!shuttingDown) {
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

  // I: Worker deploy safety — requeue the active attempt on graceful shutdown
  // so it is not orphaned and will be picked up by the next worker instance.
  // Use lastActiveAttempt because activeAttempt is nulled in the finally block
  // before the loop exits.
  const attemptToRequeue = activeAttempt ?? lastActiveAttempt;
  if (attemptToRequeue && shuttingDown) {
    console.log(`[basquio-worker] requeueing in-flight attempt ${attemptToRequeue.id} for run ${attemptToRequeue.run_id}`);
    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_attempts",
      query: { id: `eq.${attemptToRequeue.id}`, status: "eq.running" },
      payload: {
        status: "queued",
        updated_at: new Date().toISOString(),
      },
    }).catch((error) => {
      console.error(`[basquio-worker] failed to requeue attempt: ${error instanceof Error ? error.message : String(error)}`);
    });
    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: { id: `eq.${attemptToRequeue.run_id}`, status: "eq.running" },
      payload: {
        status: "queued",
        updated_at: new Date().toISOString(),
      },
    }).catch(() => {});
  }

  console.log("[basquio-worker] shutdown complete");
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

async function recoverStaleAttempts(config: ReturnType<typeof resolveConfig>) {
  const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();

  const staleAttempts = await fetchRestRows<QueuedRunRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,run_id,attempt_number",
      status: "eq.running",
      superseded_by_attempt_id: "is.null",
      updated_at: `lt.${staleBefore}`,
      order: "created_at.asc",
    },
  }).catch(() => []);

  const now = new Date().toISOString();
  for (const attempt of staleAttempts) {
    const newAttemptId = randomUUID();
    const newAttemptNumber = attempt.attempt_number + 1;

    // 1. Mark the stale attempt as failed. If another worker already recovered it,
    // do not create a duplicate superseding attempt.
    const markedStale = await patchRestRows<{ id: string }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_attempts",
      query: { id: `eq.${attempt.id}`, status: "eq.running", superseded_by_attempt_id: "is.null" },
      select: "id",
      payload: {
        status: "failed",
        failure_phase: "stale_timeout",
        failure_message: "Run timed out and was automatically recovered.",
        updated_at: now,
      },
    }).catch(() => []);
    if (!markedStale[0]) {
      continue;
    }

    // 2. Create a new superseding attempt
    await upsertRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_attempts",
      onConflict: "id",
      rows: [{
        id: newAttemptId,
        run_id: attempt.run_id,
        attempt_number: newAttemptNumber,
        status: "queued",
        recovery_reason: "stale_timeout",
        created_at: now,
        updated_at: now,
      }],
    }).catch(() => []);

    // 3. Link old attempt to the new one
    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_attempts",
      query: { id: `eq.${attempt.id}` },
      payload: {
        superseded_by_attempt_id: newAttemptId,
      },
    }).catch(() => []);

    // 4. Update the parent run to point at the new attempt
    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: { id: `eq.${attempt.run_id}`, active_attempt_id: `eq.${attempt.id}` },
      payload: {
        status: "queued",
        failure_message: null,
        failure_phase: null,
        delivery_status: "draft",
        updated_at: now,
        active_attempt_id: newAttemptId,
        latest_attempt_id: newAttemptId,
        latest_attempt_number: newAttemptNumber,
      },
    }).catch(() => []);
  }

  if (staleAttempts.length > 0) {
    console.log(`[basquio-worker] recovered ${staleAttempts.length} stale attempts with new superseding attempts`);
  }
}

async function claimNextQueuedAttempt(config: ReturnType<typeof resolveConfig>) {
  const queuedAttempts = await fetchRestRows<QueuedRunRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,run_id,attempt_number",
      status: "eq.queued",
      superseded_by_attempt_id: "is.null",
      order: "created_at.asc",
      limit: "1",
    },
  }).catch(() => []);

  const candidate = queuedAttempts[0];
  if (!candidate) {
    return null;
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
    return null;
  }

  const now = new Date().toISOString();
  const claimed = await patchRestRows<QueuedRunRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      id: `eq.${candidate.id}`,
      status: "eq.queued",
    },
    select: "id,run_id,attempt_number",
    payload: {
      status: "running",
      started_at: now,
      updated_at: now,
      worker_deployment_id: resolveWorkerDeploymentId(),
      failure_message: null,
      failure_phase: null,
    },
  }).catch(() => []);

  if (!claimed[0]) {
    return null;
  }

  try {
    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        id: `eq.${claimed[0].run_id}`,
      },
      payload: {
        status: "running",
        current_phase: "normalize",
        phase_started_at: now,
        updated_at: now,
        failure_message: null,
        failure_phase: null,
        delivery_status: "draft",
        active_attempt_id: claimed[0].id,
        latest_attempt_id: claimed[0].id,
        latest_attempt_number: claimed[0].attempt_number,
      },
    });
  } catch (error) {
    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_attempts",
      query: {
        id: `eq.${claimed[0].id}`,
        status: "eq.running",
      },
      payload: {
        status: "queued",
        updated_at: new Date().toISOString(),
      },
    }).catch(() => []);
    throw error;
  }

  return claimed[0] ?? null;
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
  if (!process.env.STRIPE_SECRET_KEY) return;
  try {
    const run = await fetchRestRows<{ requested_by: string }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: { select: "requested_by", id: `eq.${runId}`, limit: "1" },
    });
    if (run[0]?.requested_by) {
      await refundCredit({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        userId: run[0].requested_by,
        runId,
      });
      console.log(`[basquio-worker] refunded credit for failed run ${runId}`);
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
