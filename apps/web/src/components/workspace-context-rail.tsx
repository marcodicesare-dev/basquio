"use client";

import Link from "next/link";

type EntityGroup = {
  type: string;
  label: string;
  count: number;
};

export type WorkspaceContextRailProps = {
  entityGroups: EntityGroup[];
  recentAnswers: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    citations: number;
  }>;
};

function relativeTime(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WorkspaceContextRail({ entityGroups, recentAnswers }: WorkspaceContextRailProps) {
  if (entityGroups.length === 0 && recentAnswers.length === 0) return null;

  return (
    <aside className="wbeta-rail" aria-label="Workspace context">
      {recentAnswers.length > 0 ? (
        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Recent answers</h3>
            <span className="wbeta-rail-section-meta">{recentAnswers.length}</span>
          </header>
          <ul className="wbeta-rail-list">
            {recentAnswers.slice(0, 5).map((a) => (
              <li key={a.id}>
                <Link href={`/workspace/deliverable/${a.id}`} className="wbeta-rail-item">
                  <span className="wbeta-rail-item-title">{a.title}</span>
                  <span className="wbeta-rail-item-meta">
                    {relativeTime(a.createdAt)} · {a.citations} cited
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {entityGroups.length > 0 ? (
        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">What Basquio knows</h3>
          </header>
          <ul className="wbeta-rail-chips">
            {entityGroups.map((group) => (
              <li key={group.type} className="wbeta-rail-chip">
                <span className="wbeta-rail-chip-label">{group.label}</span>
                <span className="wbeta-rail-chip-count">{group.count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}
