import Link from "next/link";

import { listAdminChatTurns } from "@/lib/admin/loaders";

export const dynamic = "force-dynamic";

export default async function AdminRunsPage() {
  const turns = await listAdminChatTurns(100);
  return (
    <section className="wbeta-admin-page">
      <header>
        <h2>Chat turns</h2>
        <p className="wbeta-admin-summary">
          Last {turns.length} chat turns across all workspaces. Click a row for the single-turn
          replay.
        </p>
      </header>
      <table className="wbeta-admin-table">
        <thead>
          <tr>
            <th>Started</th>
            <th>Workspace</th>
            <th>Intents</th>
            <th>Active tools</th>
            <th>In</th>
            <th>Out</th>
            <th>Cache read</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {turns.length === 0 ? (
            <tr>
              <td colSpan={8} className="wbeta-admin-summary">
                No chat turns recorded yet.
              </td>
            </tr>
          ) : null}
          {turns.map((t) => (
            <tr key={t.id}>
              <td>
                <Link href={`/admin/runs/${t.id}`} className="wbeta-admin-mono">
                  {t.started_at.slice(0, 19).replace("T", " ")}
                </Link>
              </td>
              <td className="wbeta-admin-mono">{t.workspace_id?.slice(0, 8) ?? "-"}</td>
              <td>{(t.intents ?? []).join(", ") || "-"}</td>
              <td>{(t.active_tools ?? []).join(", ") || "-"}</td>
              <td className="wbeta-admin-mono">{t.total_input_tokens ?? "-"}</td>
              <td className="wbeta-admin-mono">{t.total_output_tokens ?? "-"}</td>
              <td className="wbeta-admin-mono">{t.cache_read_input_tokens ?? "-"}</td>
              <td className="wbeta-admin-mono">
                {t.cost_usd !== null ? `$${Number(t.cost_usd).toFixed(4)}` : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
