import { aggregateChatCostByWorkspace } from "@/lib/admin/loaders";

export const dynamic = "force-dynamic";

export default async function AdminCostPage() {
  const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const buckets = await aggregateChatCostByWorkspace(since30d);
  const total = buckets.reduce((s, b) => s + b.total_cost_usd, 0);
  const totalTurns = buckets.reduce((s, b) => s + b.turn_count, 0);

  return (
    <section className="wbeta-admin-page">
      <header>
        <h2>Cost (last 30 days)</h2>
        <p className="wbeta-admin-summary">
          Chat-turn cost by workspace from <code>chat_tool_telemetry</code>{" "}
          <code>tool_name=&apos;__chat_turn__&apos;</code>. Excludes deck-pipeline runs
          (<code>deck_run_request_usage</code>) and scrape costs (<code>research_runs</code>);
          those have their own dashboards.
        </p>
      </header>

      <div className="wbeta-admin-grid">
        <div className="wbeta-admin-stat">
          <span className="wbeta-admin-stat-num">${total.toFixed(2)}</span>
          <span className="wbeta-admin-stat-label">Total chat cost (30d)</span>
        </div>
        <div className="wbeta-admin-stat">
          <span className="wbeta-admin-stat-num">{totalTurns}</span>
          <span className="wbeta-admin-stat-label">Chat turns (30d)</span>
        </div>
        <div className="wbeta-admin-stat">
          <span className="wbeta-admin-stat-num">
            ${totalTurns > 0 ? (total / totalTurns).toFixed(4) : "0.0000"}
          </span>
          <span className="wbeta-admin-stat-label">Average cost / turn</span>
        </div>
      </div>

      <table className="wbeta-admin-table">
        <thead>
          <tr>
            <th>Workspace</th>
            <th>Turns</th>
            <th>Total cost</th>
            <th>Avg / turn</th>
          </tr>
        </thead>
        <tbody>
          {buckets.length === 0 ? (
            <tr>
              <td colSpan={4} className="wbeta-admin-summary">
                No chat turns in the last 30 days.
              </td>
            </tr>
          ) : null}
          {buckets.map((b) => (
            <tr key={b.workspace_id}>
              <td className="wbeta-admin-mono">{b.workspace_id}</td>
              <td className="wbeta-admin-mono">{b.turn_count}</td>
              <td className="wbeta-admin-mono">${b.total_cost_usd.toFixed(4)}</td>
              <td className="wbeta-admin-mono">
                ${b.turn_count > 0 ? (b.total_cost_usd / b.turn_count).toFixed(4) : "0.0000"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
