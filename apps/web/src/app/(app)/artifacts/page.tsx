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

export default async function ArtifactsPage() {
  const viewer = await getViewerState();
  const runs = await listGenerationRuns(24, viewer.user?.id);

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Your reports</h1>

        <Link className="button" href="/jobs/new">
          New report
        </Link>
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
          <Link className="button" href="/jobs/new">
            Create your first report
          </Link>
        </section>
      ) : (
        <section className="presentation-list">
          {runs.map((run) => (
            <article key={run.jobId} className="panel presentation-card">
              <div className="presentation-card-head">
                <div className="stack">
                  <p className="artifact-kind">{summarizeRunSources(run)}</p>
                  <h2>{run.story.keyMessages[0] ?? run.objective}</h2>
                  <p className="muted">{summarizeRunBrief(run)}</p>
                </div>

                <div className="download-actions">
                  {run.status === "running" ? (
                    <Link className="button" href={`/jobs/${run.jobId}`}>View progress</Link>
                  ) : run.status === "failed" ? (
                    <Link className="button secondary" href={`/jobs/${run.jobId}`}>View details</Link>
                  ) : run.artifacts.length > 0 ? (
                    run.artifacts.map((artifact) => (
                      <a key={artifact.kind} className="button" href={buildArtifactDownloadUrl(run.jobId, artifact.kind)}>
                        Download {artifact.kind.toUpperCase()}
                      </a>
                    ))
                  ) : (
                    <Link className="button secondary" href={`/jobs/${run.jobId}`}>View run</Link>
                  )}
                </div>
              </div>

              <div className="compact-meta-row">
                <span className="run-pill">{formatDate(run.createdAt)}</span>
                <span className="run-pill">{summarizeRunSources(run)}</span>
                {run.slidePlan.slides.length > 0 ? (
                  <span className="run-pill">{run.slidePlan.slides.length} slides</span>
                ) : null}
                {run.status === "running" ? <span className="run-pill">Generating...</span> : null}
                {run.status === "failed" ? <span className="run-pill">Failed</span> : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
