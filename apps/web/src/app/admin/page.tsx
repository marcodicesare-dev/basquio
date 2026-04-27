import { createServiceSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

async function safeCount(table: string, since: string): Promise<number> {
  try {
    const db = getDb();
    const { count, error } = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .gt("created_at", since);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function safeWorkflowRunCount(since: string): Promise<{ success: number; failure: number }> {
  try {
    const db = getDb();
    const { data, error } = await db
      .from("memory_workflow_runs")
      .select("status")
      .gt("started_at", since)
      .limit(5000);
    if (error) return { success: 0, failure: 0 };
    let success = 0;
    let failure = 0;
    for (const row of (data ?? []) as Array<{ status: string }>) {
      if (row.status === "success") success += 1;
      else if (row.status === "failure") failure += 1;
    }
    return { success, failure };
  } catch {
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
    safeCount("memory_candidates", since7d),
    safeCount("memory_audit", since7d).then(async (c) =>
      c === 0
        ? // memory_audit lacks created_at; uses occurred_at. Re-query.
          (async () => {
            try {
              const db = getDb();
              const { count, error } = await db
                .from("memory_audit")
                .select("*", { count: "exact", head: true })
                .gt("occurred_at", since7d);
              if (error) return 0;
              return count ?? 0;
            } catch {
              return 0;
            }
          })()
        : c,
    ),
    safeCount("anticipation_hints", since7d),
    (async () => {
      try {
        const db = getDb();
        const { count, error } = await db
          .from("chat_tool_telemetry")
          .select("*", { count: "exact", head: true })
          .eq("tool_name", "__chat_turn__")
          .gt("started_at", since7d);
        if (error) return 0;
        return count ?? 0;
      } catch {
        return 0;
      }
    })(),
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
