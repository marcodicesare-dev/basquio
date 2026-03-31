"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { calculateRunCredits } from "@/lib/credits";
import type { V2RunCard } from "@/lib/job-runs";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running" || status === "queued") return <span className="run-pill run-pill-active">Generating...</span>;
  if (status === "failed") return <span className="run-pill run-pill-failed">Failed</span>;
  if (status === "completed") return <span className="run-pill run-pill-ready">Ready</span>;
  return null;
}

function RunActions({ run }: { run: V2RunCard }) {
  if (run.status === "running" || run.status === "queued") {
    return <Link className="button small" href={`/jobs/${run.id}`}>View progress</Link>;
  }
  if (run.status === "failed") {
    return <Link className="button small secondary" href={`/jobs/${run.id}`}>View details</Link>;
  }
  if (run.artifacts.length > 0) {
    return (
      <>
        {run.artifacts.map((a) => (
          <a key={a.kind} className="button small" href={a.downloadUrl}>
            Download {a.kind.toUpperCase()}
          </a>
        ))}
        <Link className="button small secondary" href={`/jobs/new?from=${run.id}`}>
          Rerun
        </Link>
      </>
    );
  }
  return <Link className="button small secondary" href={`/jobs/${run.id}`}>View run</Link>;
}

type FilterState = {
  search: string;
  status: "all" | "completed" | "running" | "failed";
};

export function ReportsList({ runs }: { runs: V2RunCard[] }) {
  const [filters, setFilters] = useState<FilterState>({ search: "", status: "all" });

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (filters.status !== "all" && run.status !== filters.status) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const searchable = [run.headline, run.client, run.objective, run.sourceFileName].join(" ").toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [runs, filters]);

  return (
    <>
      <div className="reports-filter-bar">
        <input
          className="reports-search-input"
          type="text"
          placeholder="Search by client, title, or file name..."
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <div className="reports-status-filters">
          {(["all", "completed", "running", "failed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={filters.status === s ? "reports-status-btn active" : "reports-status-btn"}
              onClick={() => setFilters((f) => ({ ...f, status: s }))}
            >
              {s === "all" ? "All" : s === "completed" ? "Ready" : s === "running" ? "In progress" : "Failed"}
            </button>
          ))}
        </div>
      </div>

      {filteredRuns.length === 0 ? (
        <div className="panel workspace-empty-card workspace-empty-card-compact">
          <p className="muted">
            {filters.search || filters.status !== "all"
              ? "No reports match your filters."
              : "No reports yet."}
          </p>
        </div>
      ) : (
        <section className="presentation-list">
          {filteredRuns.map((run) => {
            const displaySlideCount = run.slideCount > 0 ? run.slideCount : run.targetSlideCount;

            return (
            <article key={run.id} className="panel presentation-card">
              <div className="presentation-card-head">
                <div className="stack">
                  <p className="artifact-kind">{run.sourceFileName}</p>
                  <h2>{run.headline}</h2>
                  <p className="muted">{[run.client, run.objective].filter(Boolean).join(" — ")}</p>
                </div>
                <div className="download-actions">
                  <RunActions run={run} />
                </div>
              </div>
              <div className="compact-meta-row">
                <span className="run-pill">{formatDate(run.createdAt)}</span>
                {displaySlideCount > 0 ? <span className="run-pill">{displaySlideCount} slides</span> : null}
                <span className="run-pill">{calculateRunCredits(displaySlideCount, run.authorModel)} credits</span>
                <StatusBadge status={run.status} />
              </div>
            </article>
            );
          })}
        </section>
      )}
    </>
  );
}
