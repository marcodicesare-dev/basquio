import { listDriftSignals } from "@/lib/admin/loaders";

export const dynamic = "force-dynamic";

export default async function AdminDriftPage() {
  const drift = await listDriftSignals(50);

  return (
    <section className="wbeta-admin-page">
      <header>
        <h2>Drift</h2>
        <p className="wbeta-admin-summary">
          Signals that the memory system is drifting from analyst preferences. The two
          patterns to watch: hint patterns the analyst keeps rejecting (3 or more times in
          the last 30 days), and memory candidates older than 14 days that no one reviewed.
        </p>
      </header>

      <section>
        <h3>Hint patterns dismissed 3+ times in 30 days</h3>
        <table className="wbeta-admin-table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Pattern</th>
              <th>Dismissals</th>
            </tr>
          </thead>
          <tbody>
            {drift.dismissedCooldowns.length === 0 ? (
              <tr>
                <td colSpan={3} className="wbeta-admin-summary">
                  No hint cooldowns crossed the 3-dismissal threshold in the last 30 days.
                </td>
              </tr>
            ) : null}
            {drift.dismissedCooldowns.map((d) => (
              <tr key={`${d.workspace_id}:${d.cooldown_key}`}>
                <td className="wbeta-admin-mono">{d.workspace_id.slice(0, 8)}</td>
                <td className="wbeta-admin-mono">{d.cooldown_key}</td>
                <td className="wbeta-admin-mono">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Memory candidates older than 14 days that no one reviewed</h3>
        <table className="wbeta-admin-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Workspace</th>
              <th>Kind</th>
              <th>Confidence</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {drift.staleCandidates.length === 0 ? (
              <tr>
                <td colSpan={5} className="wbeta-admin-summary">
                  No stale pending candidates.
                </td>
              </tr>
            ) : null}
            {drift.staleCandidates.map((c) => (
              <tr key={c.id}>
                <td className="wbeta-admin-mono">{c.created_at.slice(0, 10)}</td>
                <td className="wbeta-admin-mono">{c.workspace_id.slice(0, 8)}</td>
                <td>{c.kind}</td>
                <td className="wbeta-admin-mono">{Number(c.confidence).toFixed(2)}</td>
                <td>{c.evidence_excerpt.slice(0, 120)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
