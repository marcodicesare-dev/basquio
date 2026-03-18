import Link from "next/link";

import { getViewerState } from "@/lib/supabase/auth";
import { listV2RunCards, type V2RunCard } from "@/lib/job-runs";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function RunActions({ run }: { run: V2RunCard }) {
  if (run.status === "running" || run.status === "queued") {
    return <Link className="button" href={`/jobs/${run.id}`}>View progress</Link>;
  }
  if (run.status === "failed") {
    return <Link className="button secondary" href={`/jobs/${run.id}`}>View details</Link>;
  }
  if (run.artifacts.length > 0) {
    return (
      <>
        {run.artifacts.map((a) => (
          <a key={a.kind} className="button" href={a.downloadUrl}>
            Download {a.kind.toUpperCase()}
          </a>
        ))}
      </>
    );
  }
  return <Link className="button secondary" href={`/jobs/${run.id}`}>View run</Link>;
}

export default async function ArtifactsPage() {
  const viewer = await getViewerState();
  const runs = await listV2RunCards(24, viewer.user?.id);

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Your reports</h1>
        <Link className="button" href="/jobs/new">New report</Link>
      </section>

      {runs.length === 0 ? (
        <section className="panel workspace-empty-card">
          <div className="empty-illustration" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="stack">
            <h2>Ready when you are</h2>
            <p className="muted">Upload your data and Basquio will build your first report.</p>
          </div>
          <Link className="button" href="/jobs/new">Create your first report</Link>
        </section>
      ) : (
        <section className="presentation-list">
          {runs.map((run) => (
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
                {run.slideCount > 0 ? <span className="run-pill">{run.slideCount} slides</span> : null}
                {run.status === "running" || run.status === "queued" ? <span className="run-pill">Generating...</span> : null}
                {run.status === "failed" ? <span className="run-pill">Failed</span> : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
