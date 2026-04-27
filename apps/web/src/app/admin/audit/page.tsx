import { listAdminAudit } from "@/lib/admin/loaders";

export const dynamic = "force-dynamic";

const ALLOWED_TABLES = new Set([
  "workspace_rule",
  "brand_guideline",
  "anticipation_hints",
  "facts",
  "memory_entries",
]);

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const table = typeof params.table === "string" && ALLOWED_TABLES.has(params.table) ? params.table : undefined;
  const actor = typeof params.actor === "string" ? params.actor : undefined;
  const workspaceId = typeof params.workspace === "string" ? params.workspace : undefined;
  const rows = await listAdminAudit({ table, actor, workspaceId, limit: 200 });

  return (
    <section className="wbeta-admin-page">
      <header>
        <h2>Audit log</h2>
        <p className="wbeta-admin-summary">
          Append-only memory mutations across all workspaces. Filter via query string:
          <code> ?table=workspace_rule</code>, <code>?actor=user:</code>,
          <code> ?workspace=&lt;uuid&gt;</code>.
        </p>
      </header>

      <table className="wbeta-admin-table">
        <thead>
          <tr>
            <th>Occurred at</th>
            <th>Table</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Workspace</th>
            <th>Row</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="wbeta-admin-summary">
                No audit rows match these filters.
              </td>
            </tr>
          ) : null}
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="wbeta-admin-mono">{r.occurred_at.slice(0, 19).replace("T", " ")}</td>
              <td>{r.table_name}</td>
              <td>{r.action}</td>
              <td className="wbeta-admin-mono">{r.actor}</td>
              <td className="wbeta-admin-mono">{r.workspace_id?.slice(0, 8) ?? "-"}</td>
              <td className="wbeta-admin-mono">{r.row_id.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
