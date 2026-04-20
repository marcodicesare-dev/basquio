"use client";

import Link from "next/link";

type EntityGroup = {
  type: string;
  label: string;
  count: number;
};

export type RecentConversation = {
  id: string;
  title: string;
  lastMessageAt: string;
  isCurrent?: boolean;
};

export type WorkspaceContextRailProps = {
  entityGroups: EntityGroup[];
  recentConversations: RecentConversation[];
};

function relativeTime(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WorkspaceContextRail({ entityGroups, recentConversations }: WorkspaceContextRailProps) {
  if (entityGroups.length === 0 && recentConversations.length === 0) return null;

  return (
    <aside className="wbeta-rail" aria-label="Workspace context">
      {recentConversations.length > 0 ? (
        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Recent chats</h3>
            <Link href="/workspace" className="wbeta-rail-new-chat" aria-label="New chat">
              New
            </Link>
          </header>
          <ul className="wbeta-rail-list">
            {recentConversations.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/workspace/chat/${c.id}`}
                  className={
                    c.isCurrent
                      ? "wbeta-rail-item wbeta-rail-item-active"
                      : "wbeta-rail-item"
                  }
                  aria-current={c.isCurrent ? "page" : undefined}
                >
                  <span className="wbeta-rail-item-title">{c.title}</span>
                  <span className="wbeta-rail-item-meta">{relativeTime(c.lastMessageAt)}</span>
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
