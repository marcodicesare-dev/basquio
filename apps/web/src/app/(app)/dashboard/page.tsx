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

function StatusBadge({ status }: { status: string }) {
  if (status === "running" || status === "queued") return <span className="run-pill">Generating...</span>;
  if (status === "failed") return <span className="run-pill">Failed</span>;
  return null;
}

export default async function DashboardPage() {
  const viewer = await getViewerState();
  const runs = await listV2RunCards(8, viewer.user?.id);
  const latestRun = runs[0] ?? null;
  const recentRuns = latestRun ? runs.slice(1, 5) : [];

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Dashboard</h1>
        <Link className="button" href="/jobs/new">New report</Link>
      </section>

      {latestRun ? (
        <section className="panel featured-analysis-card stack-xl">
          <div className="run-card-head">
            <div className="stack">
              <p className="artifact-kind">Latest report</p>
              <h2>{latestRun.headline}</h2>
              <p className="muted">
                {[latestRun.client, latestRun.objective].filter(Boolean).join(" — ")}
              </p>
            </div>
            <div className="row">
              <RunActions run={latestRun} />
            </div>
          </div>
          <div className="compact-meta-row">
            <span className="run-pill">{formatDate(latestRun.createdAt)}</span>
            <span className="run-pill">{latestRun.sourceFileName}</span>
            {latestRun.slideCount > 0 ? <span className="run-pill">{latestRun.slideCount} slides</span> : null}
            <StatusBadge status={latestRun.status} />
          </div>
        </section>
      ) : (
        <section className="panel workspace-empty-card onboarding-card">
          <div className="stack">
            <h2>Create your first report</h2>
            <p className="muted">Upload your data, describe the brief, and Basquio builds a consulting-grade deck.</p>
          </div>
          <div className="onboarding-steps">
            <div className="onboarding-step">
              <span className="onboarding-step-number">1</span>
              <div className="stack-xs">
                <strong>Your data files</strong>
                <p className="muted">CSVs, spreadsheets, PDFs, or any structured evidence.</p>
              </div>
            </div>
            <div className="onboarding-step">
              <span className="onboarding-step-number">2</span>
              <div className="stack-xs">
                <strong>A short brief</strong>
                <p className="muted">Who&apos;s the audience? What decision should the deck support?</p>
              </div>
            </div>
            <div className="onboarding-step">
              <span className="onboarding-step-number">3</span>
              <div className="stack-xs">
                <strong>Brand template (optional)</strong>
                <p className="muted">Upload a PPTX template and Basquio matches your brand automatically.</p>
              </div>
            </div>
          </div>
          <Link className="button" href="/jobs/new">Start your first report</Link>
        </section>
      )}

      {recentRuns.length > 0 ? (
        <section className="stack-lg">
          <div className="workspace-section-head">
            <h2>Recent reports</h2>
            <Link className="button secondary" href="/artifacts">All reports</Link>
          </div>
          <div className="presentation-list">
            {recentRuns.map((run) => (
              <article key={run.id} className="panel presentation-card">
                <div className="presentation-card-head">
                  <div className="stack">
                    <p className="artifact-kind">{run.sourceFileName}</p>
                    <h3>{run.headline}</h3>
                    <p className="muted">{[run.client, run.objective].filter(Boolean).join(" — ")}</p>
                  </div>
                  <div className="download-actions">
                    <RunActions run={run} />
                  </div>
                </div>
                <div className="compact-meta-row">
                  <span className="run-pill">{formatDate(run.createdAt)}</span>
                  {run.slideCount > 0 ? <span className="run-pill">{run.slideCount} slides</span> : null}
                  <StatusBadge status={run.status} />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
