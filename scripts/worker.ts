import { generateDeckRun } from "../packages/workflows/src/generate-deck";
import { fetchRestRows, patchRestRows } from "../packages/workflows/src/supabase";
import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

const POLL_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_POLL_INTERVAL_MS ?? "5000", 10);
const STALE_RUN_MINUTES = Number.parseInt(process.env.BASQUIO_WORKER_STALE_MINUTES ?? "30", 10);
const HEARTBEAT_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_HEARTBEAT_INTERVAL_MS ?? "60000", 10);
const RECOVERY_INTERVAL_MS = Number.parseInt(process.env.BASQUIO_WORKER_RECOVERY_INTERVAL_MS ?? "60000", 10);

type QueuedRunRow = {
  id: string;
};

async function main() {
  const config = resolveConfig();
  let lastRecoveryAt = 0;

  console.log("[basquio-worker] starting");
  await recoverStaleRuns(config);
  lastRecoveryAt = Date.now();

  for (;;) {
    try {
      if (Date.now() - lastRecoveryAt >= RECOVERY_INTERVAL_MS) {
        await recoverStaleRuns(config);
        lastRecoveryAt = Date.now();
      }

      const runId = await claimNextQueuedRun(config);

      if (runId) {
        const startedAt = Date.now();
        console.log(`[basquio-worker] claimed run ${runId}`);
        const stopHeartbeat = startHeartbeat(config, runId);

        try {
          await generateDeckRun(runId);
          console.log(
            `[basquio-worker] completed run ${runId} in ${Math.round((Date.now() - startedAt) / 1000)}s`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[basquio-worker] run ${runId} failed: ${message}`);
        } finally {
          stopHeartbeat();
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[basquio-worker] poll loop error: ${message}`);
    }

    await sleep(POLL_INTERVAL_MS);
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

async function recoverStaleRuns(config: ReturnType<typeof resolveConfig>) {
  const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();

  const recovered = await patchRestRows<{ id: string }>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: {
      status: "eq.running",
      updated_at: `lt.${staleBefore}`,
    },
    select: "id",
    payload: {
      status: "queued",
      current_phase: null,
      phase_started_at: null,
      failure_message: null,
      failure_phase: null,
      delivery_status: "draft",
      updated_at: new Date().toISOString(),
    },
  }).catch(() => []);

  if (recovered.length > 0) {
    console.log(`[basquio-worker] re-queued ${recovered.length} stale runs`);
  }
}

async function claimNextQueuedRun(config: ReturnType<typeof resolveConfig>) {
  const queuedRuns = await fetchRestRows<QueuedRunRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: {
      select: "id",
      status: "eq.queued",
      order: "created_at.asc",
      limit: "1",
    },
  }).catch(() => []);

  const candidate = queuedRuns[0];
  if (!candidate) {
    return null;
  }

  const claimed = await patchRestRows<{ id: string }>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: {
      id: `eq.${candidate.id}`,
      status: "eq.queued",
    },
    select: "id",
    payload: {
      status: "running",
      current_phase: "normalize",
      phase_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      failure_message: null,
      failure_phase: null,
      delivery_status: "draft",
    },
  }).catch(() => []);

  return claimed[0]?.id ?? null;
}

function startHeartbeat(config: ReturnType<typeof resolveConfig>, runId: string) {
  const timer = setInterval(() => {
    void patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        id: `eq.${runId}`,
        status: "eq.running",
      },
      payload: {
        updated_at: new Date().toISOString(),
      },
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[basquio-worker] heartbeat failed for ${runId}: ${message}`);
    });
  }, HEARTBEAT_INTERVAL_MS);

  timer.unref?.();

  return () => clearInterval(timer);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[basquio-worker] fatal startup error: ${message}`);
  process.exit(1);
});
