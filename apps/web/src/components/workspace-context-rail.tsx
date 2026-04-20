"use client";

import Link from "next/link";
import { useState } from "react";
import { CaretRight } from "@phosphor-icons/react";

import { WorkspaceUploadZone } from "@/components/workspace-upload-zone";
import { SUPPORTED_UPLOAD_LABEL } from "@/lib/workspace/constants";

type EntityGroupRow = {
  id: string;
  label: string;
  sub?: string | null;
};

type EntityGroup = {
  type: string;
  label: string;
  count: number;
  rows: EntityGroupRow[];
};

export type WorkspaceContextRailProps = {
  workspaceName: string;
  stats: {
    files: number;
    entities: number;
    answers: number;
  };
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

export function WorkspaceContextRail({ stats, entityGroups, recentAnswers, workspaceName }: WorkspaceContextRailProps) {
  return (
    <aside className="wbeta-rail" aria-label="Workspace context">
      <header className="wbeta-rail-head">
        <div>
          <p className="wbeta-rail-kicker">Workspace</p>
          <h2 className="wbeta-rail-title">{workspaceName}</h2>
        </div>
      </header>

      <ul className="wbeta-rail-stats">
        <li>
          <span className="wbeta-rail-stat-num">{stats.files}</span>
          <span className="wbeta-rail-stat-label">Files</span>
        </li>
        <li>
          <span className="wbeta-rail-stat-num">{stats.entities}</span>
          <span className="wbeta-rail-stat-label">Entities</span>
        </li>
        <li>
          <span className="wbeta-rail-stat-num">{stats.answers}</span>
          <span className="wbeta-rail-stat-label">Answers</span>
        </li>
      </ul>

      <section className="wbeta-rail-section">
        <header className="wbeta-rail-section-head">
          <h3 className="wbeta-rail-section-title">Add context</h3>
        </header>
        <WorkspaceUploadZone supportedLabel={SUPPORTED_UPLOAD_LABEL} variant="inline" />
      </section>

      {recentAnswers.length > 0 ? (
        <section className="wbeta-rail-section">
          <header className="wbeta-rail-section-head">
            <h3 className="wbeta-rail-section-title">Recent answers</h3>
            <span className="wbeta-rail-section-meta">{recentAnswers.length}</span>
          </header>
          <ul className="wbeta-rail-list">
            {recentAnswers.slice(0, 6).map((a) => (
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
            <h3 className="wbeta-rail-section-title">Timeline</h3>
            <span className="wbeta-rail-section-meta">What Basquio knows</span>
          </header>
          {entityGroups.map((group) => (
            <RailEntityGroup key={group.type} group={group} />
          ))}
        </section>
      ) : null}
    </aside>
  );
}

function RailEntityGroup({ group }: { group: EntityGroup }) {
  const [open, setOpen] = useState(group.count <= 4);
  const displayRows = open ? group.rows : group.rows.slice(0, 3);

  return (
    <div className="wbeta-rail-group">
      <button
        type="button"
        className="wbeta-rail-group-head"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <CaretRight size={10} weight="bold" className={open ? "wbeta-rail-group-caret-open" : ""} />
        <span className="wbeta-rail-group-label">{group.label}</span>
        <span className="wbeta-rail-group-count">{group.count}</span>
      </button>
      {displayRows.length > 0 ? (
        <ul className="wbeta-rail-group-list">
          {displayRows.map((row) => (
            <li key={row.id} className="wbeta-rail-group-item">
              <span className="wbeta-rail-group-item-name">{row.label}</span>
              {row.sub ? <span className="wbeta-rail-group-item-sub">{row.sub}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
