import { listAdminCandidates } from "@/lib/admin/loaders";

export const dynamic = "force-dynamic";

export default async function AdminCandidatesPage() {
  const candidates = await listAdminCandidates(200);
  const counts = candidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="wbeta-admin-page">
      <header>
        <h2>Memory candidates</h2>
        <p className="wbeta-admin-summary">
          All candidates produced by the chat extractor across workspaces. Pending /
          approved / dismissed / expired counts in the last 200 rows:{" "}
          <code className="wbeta-admin-mono">
            pending {counts.pending ?? 0} · approved {counts.approved ?? 0} · dismissed{" "}
            {counts.dismissed ?? 0} · expired {counts.expired ?? 0}
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
            <th>Confidence</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {candidates.length === 0 ? (
            <tr>
              <td colSpan={6} className="wbeta-admin-summary">
                No candidates recorded yet.
              </td>
            </tr>
          ) : null}
          {candidates.map((c) => (
            <tr key={c.id}>
              <td className="wbeta-admin-mono">{c.created_at.slice(0, 19).replace("T", " ")}</td>
              <td className="wbeta-admin-mono">{c.workspace_id.slice(0, 8)}</td>
              <td>{c.kind}</td>
              <td>{c.status}</td>
              <td className="wbeta-admin-mono">{Number(c.confidence).toFixed(2)}</td>
              <td>{c.evidence_excerpt.slice(0, 120)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
