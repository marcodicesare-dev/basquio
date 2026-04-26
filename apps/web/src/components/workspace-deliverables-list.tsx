import Link from "next/link";

import type { WorkspaceDeliverableRow } from "@/lib/workspace/db";

const STATUS_LABELS: Record<WorkspaceDeliverableRow["status"], string> = {
  generating: "Thinking",
  ready: "Ready",
  failed: "Could not finish",
  archived: "Archived",
};

function formatRelativeDate(iso: string): string {
  const created = new Date(iso);
  const diffSec = Math.round((Date.now() - created.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days < 7) return `${days}d ago`;
  return created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WorkspaceDeliverablesList({
  deliverables,
}: {
  deliverables: WorkspaceDeliverableRow[];
}) {
  if (deliverables.length === 0) return null;

  return (
    <div className="wbeta-deliverables">
      <h3 className="wbeta-deliverables-head">Recent answers</h3>
      <ul className="wbeta-deliverables-rows">
        {deliverables.map((deliverable) => {
          const citationCount = Array.isArray(deliverable.citations)
            ? deliverable.citations.length
            : 0;
          return (
            <li key={deliverable.id} className="wbeta-deliverables-row">
              <Link href={`/workspace/deliverable/${deliverable.id}`} className="wbeta-deliverables-link">
                <div className="wbeta-deliverables-row-main">
                  <p className="wbeta-deliverables-title" title={deliverable.title}>
                    {deliverable.title}
                  </p>
                  <p className="wbeta-deliverables-meta">
                    <span>{deliverable.kind}</span>
                    {deliverable.scope ? (
                      <>
                        <span aria-hidden> · </span>
                        <span>{deliverable.scope}</span>
                      </>
                    ) : null}
                    <span aria-hidden> · </span>
                    <span>{formatRelativeDate(deliverable.created_at)}</span>
                    {citationCount > 0 ? (
                      <>
                        <span aria-hidden> · </span>
                        <span>{citationCount} citations</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <span className={`wbeta-deliverables-status wbeta-deliverables-status-${deliverable.status}`}>
                  {STATUS_LABELS[deliverable.status]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
