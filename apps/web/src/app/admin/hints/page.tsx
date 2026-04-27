import { listAdminHints } from "@/lib/admin/loaders";

export const dynamic = "force-dynamic";

export default async function AdminHintsPage() {
  const hints = await listAdminHints(200);
  const counts = hints.reduce<Record<string, number>>((acc, h) => {
    acc[h.status] = (acc[h.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="wbeta-admin-page">
      <header>
        <h2>Hint ledger</h2>
        <p className="wbeta-admin-summary">
          Anticipation hints across all workspaces. Status counts in the last 200 rows:{" "}
          <code className="wbeta-admin-mono">
            candidate {counts.candidate ?? 0} · shown {counts.shown ?? 0} · accepted{" "}
            {counts.accepted ?? 0} · dismissed {counts.dismissed ?? 0} · snoozed{" "}
            {counts.snoozed ?? 0} · suppressed {counts.suppressed ?? 0} · expired{" "}
            {counts.expired ?? 0}
          </code>
        </p>
      </header>

      <table className="wbeta-admin-table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Workspace</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Title</th>
            <th>Cooldown key</th>
            <th>Conf</th>
          </tr>
        </thead>
        <tbody>
          {hints.length === 0 ? (
            <tr>
              <td colSpan={7} className="wbeta-admin-summary">
                No hints recorded yet.
              </td>
            </tr>
          ) : null}
          {hints.map((h) => (
            <tr key={h.id}>
              <td className="wbeta-admin-mono">{h.created_at.slice(0, 19).replace("T", " ")}</td>
              <td className="wbeta-admin-mono">{h.workspace_id.slice(0, 8)}</td>
              <td>{h.kind}</td>
              <td>{h.status}</td>
              <td>{h.title}</td>
              <td className="wbeta-admin-mono">{h.cooldown_key.slice(0, 24)}</td>
              <td className="wbeta-admin-mono">{Number(h.confidence).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
