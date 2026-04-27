import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminChatTurn, listToolCallsForTurn } from "@/lib/admin/loaders";

export const dynamic = "force-dynamic";

export default async function AdminTurnReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const turn = await getAdminChatTurn(id);
  if (!turn) notFound();
  const toolCalls = turn.conversation_id
    ? ((await listToolCallsForTurn(turn.conversation_id)) as Array<{
        id: string;
        tool_name: string;
        started_at: string;
        latency_ms: number | null;
        status: string | null;
        error_message: string | null;
      }>)
    : [];

  return (
    <section className="wbeta-admin-page">
      <header>
        <p className="wbeta-admin-eyebrow">Single turn replay</p>
        <h2>{turn.started_at.slice(0, 19).replace("T", " ")} UTC</h2>
        <p className="wbeta-admin-summary">
          <Link href="/admin/runs">Back to all runs</Link>
        </p>
      </header>

      <div className="wbeta-admin-grid">
        <Stat label="Input tokens" value={turn.total_input_tokens ?? "-"} />
        <Stat label="Output tokens" value={turn.total_output_tokens ?? "-"} />
        <Stat label="Cache read" value={turn.cache_read_input_tokens ?? "-"} />
        <Stat
          label="Cost"
          value={turn.cost_usd !== null ? `$${Number(turn.cost_usd).toFixed(4)}` : "-"}
        />
      </div>

      <section>
        <h3>Classifier</h3>
        <table className="wbeta-admin-table">
          <tbody>
            <tr>
              <th>Intents</th>
              <td>{(turn.intents ?? []).join(", ") || "-"}</td>
            </tr>
            <tr>
              <th>Active tools</th>
              <td>{(turn.active_tools ?? []).join(", ") || "-"}</td>
            </tr>
            <tr>
              <th>Workspace</th>
              <td className="wbeta-admin-mono">{turn.workspace_id ?? "-"}</td>
            </tr>
            <tr>
              <th>Conversation</th>
              <td className="wbeta-admin-mono">{turn.conversation_id ?? "-"}</td>
            </tr>
            <tr>
              <th>User</th>
              <td className="wbeta-admin-mono">{turn.user_id ?? "-"}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>Tool calls in this conversation (recent 50)</h3>
        <table className="wbeta-admin-table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Tool</th>
              <th>Latency (ms)</th>
              <th>Status</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {toolCalls.length === 0 ? (
              <tr>
                <td colSpan={5} className="wbeta-admin-summary">
                  No tool calls recorded.
                </td>
              </tr>
            ) : null}
            {toolCalls.map((tc) => (
              <tr key={tc.id}>
                <td className="wbeta-admin-mono">{tc.started_at.slice(0, 19).replace("T", " ")}</td>
                <td>{tc.tool_name}</td>
                <td className="wbeta-admin-mono">{tc.latency_ms ?? "-"}</td>
                <td>{tc.status ?? "-"}</td>
                <td className="wbeta-admin-mono">{tc.error_message ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
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
