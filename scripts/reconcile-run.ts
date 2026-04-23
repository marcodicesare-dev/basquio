/**
 * Operator-facing run reconciliation script.
 * Answers: what requests happened, which phase, which attempt, what the total was.
 *
 * Usage: tsx scripts/reconcile-run.ts <run_id>
 */
import { loadBasquioScriptEnv } from "./load-app-env";
import { fetchRestRows } from "../packages/workflows/src/supabase";

loadBasquioScriptEnv();

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: tsx scripts/reconcile-run.ts <run_id>");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type RequestUsageRow = {
  id: string;
  attempt_id: string;
  attempt_number: number;
  phase: string;
  request_kind: string;
  provider: string;
  model: string;
  anthropic_request_id: string | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    status?: string;
  } | null;
  started_at: string | null;
  completed_at: string | null;
};

function dedupeRequestUsageRows(rows: RequestUsageRow[]) {
  const deduped = new Map<string, RequestUsageRow>();

  for (const row of rows) {
    const requestId = row.anthropic_request_id?.trim() ?? "";
    const key = requestId
      ? `${row.attempt_id}:${requestId}`
      : `${row.id}`;
    const existing = deduped.get(key);
    const preferCurrent =
      !existing ||
      row.request_kind !== "request_record" ||
      existing.request_kind === "request_record";

    if (preferCurrent) {
      deduped.set(key, row);
    }
  }

  return [...deduped.values()];
}

type AttemptRow = {
  id: string;
  attempt_number: number;
  status: string;
  recovery_reason: string | null;
  failure_phase: string | null;
  cost_telemetry: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
};

type RunRow = {
  id: string;
  status: string;
  cost_telemetry: Record<string, unknown> | null;
  template_profile_id: string | null;
};

async function main() {
  const runs = await fetchRestRows<RunRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_runs",
    query: {
      select: "id,status,cost_telemetry,template_profile_id",
      id: `eq.${runId}`,
      limit: "1",
    },
  });

  if (!runs[0]) {
    console.error(`Run ${runId} not found.`);
    process.exit(1);
  }

  const run = runs[0];
  console.log(`\n── Run ${run.id} ──`);
  console.log(`Status: ${run.status}`);
  console.log(`Template: ${run.template_profile_id ?? "basquio_standard"}`);
  console.log(`Template mode: ${(run.cost_telemetry as Record<string, unknown>)?.templateMode ?? "unknown"}`);
  console.log(`Estimated cost: $${(run.cost_telemetry as Record<string, unknown>)?.estimatedCostUsd ?? "?"}`);

  const attempts = await fetchRestRows<AttemptRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,attempt_number,status,recovery_reason,failure_phase,cost_telemetry,started_at,completed_at",
      run_id: `eq.${runId}`,
      order: "attempt_number.asc",
      limit: "20",
    },
  });

  console.log(`\n── Attempts (${attempts.length}) ──`);
  for (const attempt of attempts) {
    const cost = typeof attempt.cost_telemetry?.estimatedCostUsd === "number"
      ? `$${attempt.cost_telemetry.estimatedCostUsd}`
      : "?";
    const duration = attempt.started_at && attempt.completed_at
      ? `${Math.round((new Date(attempt.completed_at).getTime() - new Date(attempt.started_at).getTime()) / 1000)}s`
      : "?";
    console.log(`  #${attempt.attempt_number} [${attempt.status}] cost=${cost} duration=${duration} recovery=${attempt.recovery_reason ?? "none"} fail_phase=${attempt.failure_phase ?? "none"}`);
  }

  const requests = await fetchRestRows<RequestUsageRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_run_request_usage",
    query: {
      select: "id,attempt_id,attempt_number,phase,request_kind,provider,model,anthropic_request_id,usage,started_at,completed_at",
      run_id: `eq.${runId}`,
      order: "started_at.asc.nullsfirst",
      limit: "200",
    },
  });
  const dedupedRequests = dedupeRequestUsageRows(requests);

  console.log(`\n── Requests (${dedupedRequests.length} deduped / ${requests.length} raw) ──`);

  // Group by attempt
  const byAttempt = new Map<number, RequestUsageRow[]>();
  for (const req of dedupedRequests) {
    const list = byAttempt.get(req.attempt_number) ?? [];
    list.push(req);
    byAttempt.set(req.attempt_number, list);
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const [attemptNum, reqs] of Array.from(byAttempt.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`\n  Attempt #${attemptNum}:`);
    for (const req of reqs) {
      const input = req.usage?.inputTokens ?? 0;
      const output = req.usage?.outputTokens ?? 0;
      const status = req.usage?.status ?? (req.completed_at ? "completed" : "in-flight");
      const reqId = req.anthropic_request_id ? req.anthropic_request_id.slice(0, 12) + "..." : "pending";
      console.log(`    ${req.phase}/${req.request_kind} [${req.model}] in=${input} out=${output} status=${status} req=${reqId}`);
      totalInputTokens += input;
      totalOutputTokens += output;
    }
  }

  console.log(`\n── Totals ──`);
  console.log(`  Input tokens:  ${totalInputTokens.toLocaleString()}`);
  console.log(`  Output tokens: ${totalOutputTokens.toLocaleString()}`);
  console.log(`  Total tokens:  ${(totalInputTokens + totalOutputTokens).toLocaleString()}`);
  console.log("");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
