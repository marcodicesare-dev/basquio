import Link from "next/link";

import { getViewerState } from "@/lib/supabase/auth";
import {
  buildArtifactDownloadUrl,
  listGenerationRuns,
  summarizeRunBrief,
  summarizeRunSources,
} from "@/lib/job-runs";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function statusBadge(status: string) {
  switch (status) {
    case "completed": return null; // Don't show badge for completed
    case "running": return <span className="run-pill">Generating...</span>;
    case "failed": return <span className="run-pill">Failed</span>;
    default: return <span className="run-pill">{status}</span>;
  }
}

export default async function DashboardPage() {
  const viewer = await getViewerState();
  const runs = await listGenerationRuns(8, viewer.user?.id);
  const latestRun = runs[0] ?? null;
  const recentRuns = latestRun ? runs.slice(1, 5) : [];

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Dashboard</h1>

        <Link className="button" href="/jobs/new">
          New report
        </Link>
      </section>

      {latestRun ? (
        <section className="panel featured-analysis-card stack-xl">
          <div className="run-card-head">
            <div className="stack">
              <p className="artifact-kind">Latest report</p>
              <h2>{latestRun.story.keyMessages[0] ?? latestRun.objective}</h2>
              <p className="muted">{summarizeRunBrief(latestRun)}</p>
            </div>

            <div className="row">
              {latestRun.status === "running" ? (
                <Link className="button" href={`/jobs/${latestRun.jobId}`}>
                  View progress
                </Link>
              ) : latestRun.status === "failed" ? (
                <Link className="button secondary" href={`/jobs/${latestRun.jobId}`}>
                  View details
                </Link>
              ) : latestRun.artifacts.length > 0 ? (
                latestRun.artifacts.map((artifact) => (
                  <a key={artifact.kind} className="button" href={buildArtifactDownloadUrl(latestRun.jobId, artifact.kind)}>
                    Download {artifact.kind.toUpperCase()}
                  </a>
                ))
              ) : (
                <Link className="button secondary" href={`/jobs/${latestRun.jobId}`}>
                  View run
                </Link>
              )}
            </div>
          </div>

          <div className="compact-meta-row">
            <span className="run-pill">{formatDate(latestRun.createdAt)}</span>
            <span className="run-pill">{summarizeRunSources(latestRun)}</span>
            {latestRun.slidePlan.slides.length > 0 ? (
              <span className="run-pill">{latestRun.slidePlan.slides.length} slides</span>
            ) : null}
            {statusBadge(latestRun.status)}
          </div>
        </section>
      ) : (
        <section className="panel workspace-empty-card onboarding-card">
          <div className="stack">
            <h2>Create your first report</h2>
            <p className="muted">
              Upload your data, describe the brief, and Basquio builds a consulting-grade deck.
            </p>
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

          <Link className="button" href="/jobs/new">
            Start your first report
          </Link>
        </section>
      )}

      {recentRuns.length > 0 ? (
        <section className="stack-lg">
          <div className="workspace-section-head">
            <h2>Recent reports</h2>
            <Link className="button secondary" href="/artifacts">
              All reports
            </Link>
          </div>

          <div className="presentation-list">
            {recentRuns.map((run) => (
              <article key={run.jobId} className="panel presentation-card">
                <div className="presentation-card-head">
                  <div className="stack">
                    <p className="artifact-kind">{summarizeRunSources(run)}</p>
                    <h3>{run.story.keyMessages[0] ?? run.objective}</h3>
                    <p className="muted">{summarizeRunBrief(run)}</p>
                  </div>

                  <div className="download-actions">
                    {run.status === "running" ? (
                      <Link className="button secondary" href={`/jobs/${run.jobId}`}>View</Link>
                    ) : run.artifacts.length > 0 ? (
                      run.artifacts.map((artifact) => (
                        <a key={artifact.kind} className="button secondary" href={buildArtifactDownloadUrl(run.jobId, artifact.kind)}>
                          {artifact.kind.toUpperCase()}
                        </a>
                      ))
                    ) : (
                      <Link className="button secondary" href={`/jobs/${run.jobId}`}>View</Link>
                    )}
                  </div>
                </div>

                <div className="compact-meta-row">
                  <span className="run-pill">{formatDate(run.createdAt)}</span>
                  {run.slidePlan.slides.length > 0 ? (
                    <span className="run-pill">{run.slidePlan.slides.length} slides</span>
                  ) : null}
                  {statusBadge(run.status)}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
