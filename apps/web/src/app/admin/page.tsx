import { createServiceSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

/**
 * Per-table time-column-aware counter. memory_audit uses `occurred_at`,
 * memory_workflow_runs uses `started_at`, the rest use `created_at`.
 * Brief 6 PUSH 5 fix: the original implementation queried `created_at`
 * blindly which produced a Postgres "column does not exist" log on
 * memory_audit. The catch-and-retry chain hid the user-facing failure
 * but the error logs were noisy. Now every query uses the right
 * column up front; no fallback retries.
 */
async function safeCountByTime(
  table: string,
  timeColumn: string,
  sinceIso: string,
  filters: Array<[string, string]> = [],
): Promise<number> {
  try {
    const db = getDb();
    let q = db.from(table).select("*", { count: "exact", head: true }).gt(timeColumn, sinceIso);
    for (const [col, val] of filters) {
      q = q.eq(col, val);
    }
    const { count, error } = await q;
    if (error) {
      console.error(`[admin overview] count failed for ${table}.${timeColumn}`, error);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.error(`[admin overview] count threw for ${table}.${timeColumn}`, err);
    return 0;
  }
}

async function safeWorkflowRunCount(sinceIso: string): Promise<{ success: number; failure: number }> {
  try {
    const db = getDb();
    const { data, error } = await db
      .from("memory_workflow_runs")
      .select("status")
      .gt("started_at", sinceIso)
      .limit(5000);
    if (error) {
      console.error("[admin overview] workflow runs query failed", error);
      return { success: 0, failure: 0 };
    }
    let success = 0;
    let failure = 0;
    for (const row of (data ?? []) as Array<{ status: string }>) {
      if (row.status === "success") success += 1;
      else if (row.status === "failure") failure += 1;
    }
    return { success, failure };
  } catch (err) {
    console.error("[admin overview] workflow runs threw", err);
    return { success: 0, failure: 0 };
  }
}

export default async function AdminOverviewPage() {
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [
    candidatesCount,
    auditCount,
    hintsCount,
    chatTurnsCount,
    workflowRuns,
  ] = await Promise.all([
    safeCountByTime("memory_candidates", "created_at", since7d),
    safeCountByTime("memory_audit", "occurred_at", since7d),
    safeCountByTime("anticipation_hints", "created_at", since7d),
    safeCountByTime("chat_tool_telemetry", "started_at", since7d, [["tool_name", "__chat_turn__"]]),
    safeWorkflowRunCount(since7d),
  ]);

  return (
    <section className="wbeta-admin-page">
      <header>
        <h2>Last 7 days</h2>
        <p className="wbeta-admin-summary">
          Cross-workspace memory + chat activity counters. Click any tab in the sidebar for
          drill-down.
        </p>
      </header>
      <div className="wbeta-admin-grid">
        <Stat label="Chat turns" value={chatTurnsCount} />
        <Stat label="Memory candidates created" value={candidatesCount} />
        <Stat label="Memory mutations audited" value={auditCount} />
        <Stat label="Anticipation hints generated" value={hintsCount} />
        <Stat
          label="Workflow runs (success / failure)"
          value={`${workflowRuns.success} / ${workflowRuns.failure}`}
        />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="wbeta-admin-stat">
      <span className="wbeta-admin-stat-num">{value}</span>
      <span className="wbeta-admin-stat-label">{label}</span>
    </div>
  );
}
