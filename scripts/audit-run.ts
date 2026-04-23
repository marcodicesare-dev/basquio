/**
 * Schema-safe run audit tool.
 *
 * Usage: pnpm tsx scripts/audit-run.ts <run-id>
 *
 * Outputs a structured summary of a run's state, attempts, request usage,
 * and artifact manifest. Uses only columns verified against migrations.
 */

import { loadBasquioScriptEnv } from "./load-app-env";
import { fetchRestRows } from "../packages/workflows/src/supabase";

loadBasquioScriptEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function dedupeRequestUsageRows(rows: Array<Record<string, unknown>>) {
  const deduped = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const requestId = typeof row.anthropic_request_id === "string" ? row.anthropic_request_id.trim() : "";
    const attemptNumber = String(row.attempt_number ?? "");
    const rowId = String(row.id ?? "");
    const key = requestId ? `${attemptNumber}:${requestId}` : rowId;
    const existing = deduped.get(key);
    const currentKind = String(row.request_kind ?? "");
    const existingKind = String(existing?.request_kind ?? "");
    const preferCurrent = !existing || currentKind !== "request_record" || existingKind === "request_record";

    if (preferCurrent) {
      deduped.set(key, row);
    }
  }

  return [...deduped.values()];
}

async function auditRun(runId: string) {
  console.log(`\n=== Run Audit: ${runId} ===\n`);

  // 1. Run state
  const runs = await fetchRestRows<Record<string, unknown>>({
    supabaseUrl,
    serviceKey,
    table: "deck_runs",
    query: {
      select: "id,status,current_phase,failure_message,failure_phase,delivery_status,created_at,updated_at,completed_at,template_profile_id,latest_attempt_number,cost_telemetry",
      id: `eq.${runId}`,
      limit: "1",
    },
  });

  if (runs.length === 0) {
    console.log("Run not found.");
    return;
  }

  const run = runs[0];
  console.log("Run state:");
  console.log(`  status: ${run.status}`);
  console.log(`  delivery_status: ${run.delivery_status}`);
  console.log(`  current_phase: ${run.current_phase}`);
  console.log(`  failure_phase: ${run.failure_phase ?? "none"}`);
  console.log(`  failure_message: ${run.failure_message ? String(run.failure_message).slice(0, 200) : "none"}`);
  console.log(`  created_at: ${run.created_at}`);
  console.log(`  completed_at: ${run.completed_at ?? "null"}`);
  console.log(`  template_profile_id: ${run.template_profile_id ?? "none (Basquio Standard)"}`);
  console.log(`  latest_attempt_number: ${run.latest_attempt_number}`);

  const costTelemetry = run.cost_telemetry as Record<string, unknown> | null;
  if (costTelemetry) {
    console.log(`  estimated_cost_usd: $${costTelemetry.estimatedCostUsd ?? 0}`);
    console.log(`  template_mode: ${costTelemetry.templateMode ?? "unknown"}`);
  }

  // State integrity check
  if (run.status === "failed" && run.completed_at) {
    console.log("\n  ⚠ STATE INTEGRITY: failed run has completed_at populated");
  }

  // 2. Attempts
  console.log("\nAttempts:");
  const attempts = await fetchRestRows<Record<string, unknown>>({
    supabaseUrl,
    serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,attempt_number,status,recovery_reason,failure_phase,failure_message,started_at,completed_at,superseded_by_attempt_id,cost_telemetry",
      run_id: `eq.${runId}`,
      order: "attempt_number.asc",
      limit: "10",
    },
  });

  for (const attempt of attempts) {
    const cost = (attempt.cost_telemetry as Record<string, unknown>)?.estimatedCostUsd ?? 0;
    console.log(`  #${attempt.attempt_number} [${attempt.status}] ${attempt.recovery_reason ? `(recovery: ${attempt.recovery_reason})` : ""}`);
    console.log(`    failure: ${attempt.failure_phase ?? "none"} - ${attempt.failure_message ? String(attempt.failure_message).slice(0, 150) : "none"}`);
    console.log(`    cost: $${cost}`);
    if (attempt.superseded_by_attempt_id) {
      console.log(`    superseded_by: ${attempt.superseded_by_attempt_id}`);
    }
  }

  // 3. Request usage
  console.log("\nRequest usage:");
  const requests = await fetchRestRows<Record<string, unknown>>({
    supabaseUrl,
    serviceKey,
    table: "deck_run_request_usage",
    query: {
      select: "id,attempt_number,phase,request_kind,model,anthropic_request_id,usage,started_at,completed_at",
      run_id: `eq.${runId}`,
      order: "started_at.asc",
      limit: "50",
    },
  });
  const dedupedRequests = dedupeRequestUsageRows(requests);

  if (dedupedRequests.length === 0) {
    console.log("  No request usage records.");
  }
  console.log(`  deduped view: ${dedupedRequests.length} logical requests (${requests.length} raw rows)`);
  for (const req of dedupedRequests) {
    const usage = req.usage as Record<string, number> | null;
    console.log(`  [${req.phase}/${req.request_kind}] ${req.model} | tokens: ${usage?.totalTokens ?? 0} | req: ${req.anthropic_request_id ?? "none"}`);
  }

  // 4. Artifact manifest
  console.log("\nArtifact manifest:");
  const manifests = await fetchRestRows<Record<string, unknown>>({
    supabaseUrl,
    serviceKey,
    table: "artifact_manifests_v2",
    query: {
      select: "slide_count,page_count,qa_passed,artifacts",
      run_id: `eq.${runId}`,
      limit: "1",
    },
  });

  if (manifests.length === 0) {
    console.log("  No artifact manifest.");
  } else {
    const m = manifests[0];
    console.log(`  slides: ${m.slide_count} | pages: ${m.page_count} | qa_passed: ${m.qa_passed}`);
    const artifacts = m.artifacts as Array<Record<string, unknown>>;
    for (const a of artifacts) {
      console.log(`  - ${a.kind}: ${a.fileName} (${a.fileBytes} bytes)`);
    }
  }

  console.log("\n=== End Audit ===\n");
}

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: pnpm tsx scripts/audit-run.ts <run-id>");
  process.exit(1);
}

void auditRun(runId);
