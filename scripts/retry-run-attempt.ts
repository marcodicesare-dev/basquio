import { randomUUID } from "node:crypto";

import { fetchRestRows, patchRestRows, upsertRestRows } from "../packages/workflows/src/supabase";
import { loadBasquioScriptEnv } from "./load-app-env";

loadBasquioScriptEnv();

type RunRow = {
  id: string;
  status: string;
  active_attempt_id: string | null;
  latest_attempt_number: number;
};

type AttemptRow = {
  id: string;
  attempt_number: number;
  status: string;
  superseded_by_attempt_id?: string | null;
};

async function main() {
  const [runId, ...flags] = process.argv.slice(2);
  if (!runId) {
    throw new Error("Usage: pnpm tsx scripts/retry-run-attempt.ts <runId> --reason <text> --yes");
  }

  const yes = flags.includes("--yes");
  if (!yes) {
    throw new Error("Refusing to mutate production state without --yes.");
  }

  const reasonIndex = flags.indexOf("--reason");
  const reason = reasonIndex >= 0 ? flags[reasonIndex + 1] ?? "operator_retry" : "operator_retry";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials.");
  }

  const runs = await fetchRestRows<RunRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_runs",
    query: {
      select: "id,status,active_attempt_id,latest_attempt_number",
      id: `eq.${runId}`,
      limit: "1",
    },
  });

  const run = runs[0];
  if (!run) {
    throw new Error(`Run ${runId} not found.`);
  }

  if (run.active_attempt_id) {
    throw new Error(`Run ${runId} already has an active attempt ${run.active_attempt_id}. Resolve or supersede it first.`);
  }

  const existingAttempts = await fetchRestRows<AttemptRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,attempt_number,status",
      run_id: `eq.${runId}`,
      order: "attempt_number.asc",
      limit: "50",
    },
  }).catch(() => []);

  const activeSibling = existingAttempts.find((attempt) => attempt.status === "queued" || attempt.status === "running");
  if (activeSibling) {
    throw new Error(`Run ${runId} already has active sibling attempt ${activeSibling.id}.`);
  }

  const nextAttemptNumber = Math.max(run.latest_attempt_number ?? 0, ...existingAttempts.map((attempt) => attempt.attempt_number), 0) + 1;
  const supersedesAttemptId = existingAttempts.length > 0 ? existingAttempts[existingAttempts.length - 1]?.id ?? null : null;
  const attemptId = randomUUID();
  const now = new Date().toISOString();

  if (supersedesAttemptId) {
    const previousAttempt = existingAttempts[existingAttempts.length - 1] ?? null;
    await patchRestRows({
      supabaseUrl,
      serviceKey,
      table: "deck_run_attempts",
      query: { id: `eq.${supersedesAttemptId}` },
      payload: {
        ...(previousAttempt && (previousAttempt.status === "queued" || previousAttempt.status === "running")
          ? { status: "superseded" }
          : {}),
        updated_at: now,
      },
    }).catch(() => {});
  }

  await upsertRestRows({
    supabaseUrl,
    serviceKey,
    table: "deck_run_attempts",
    onConflict: "id",
    rows: [
      {
        id: attemptId,
        run_id: runId,
        attempt_number: nextAttemptNumber,
        status: "queued",
        recovery_reason: reason,
        supersedes_attempt_id: supersedesAttemptId,
        created_at: now,
        updated_at: now,
      },
    ],
  });

  if (supersedesAttemptId) {
    await patchRestRows({
      supabaseUrl,
      serviceKey,
      table: "deck_run_attempts",
      query: { id: `eq.${supersedesAttemptId}`, superseded_by_attempt_id: "is.null" },
      payload: {
        superseded_by_attempt_id: attemptId,
        updated_at: now,
      },
    }).catch(() => {});
  }

  await patchRestRows({
    supabaseUrl,
    serviceKey,
    table: "deck_runs",
    query: { id: `eq.${runId}` },
    payload: {
      status: "queued",
      current_phase: null,
      phase_started_at: null,
      failure_message: null,
      failure_phase: null,
      updated_at: now,
      delivery_status: "draft",
      active_attempt_id: attemptId,
      latest_attempt_id: attemptId,
      latest_attempt_number: nextAttemptNumber,
    },
  });

  console.log(JSON.stringify({
    runId,
    attemptId,
    attemptNumber: nextAttemptNumber,
    recoveryReason: reason,
    supersedesAttemptId,
  }, null, 2));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
