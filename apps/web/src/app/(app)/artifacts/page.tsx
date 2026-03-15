import Link from "next/link";

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
  const runs = await listGenerationRuns(24);

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Your presentations</h1>

        <Link className="button" href="/jobs/new">
          New analysis
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
            <h2>No presentations yet</h2>
            <p className="muted">Create your first analysis to generate a PPTX and PDF.</p>
          </div>
          <Link className="button" href="/jobs/new">
            Create your first analysis
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
                  {run.artifacts.map((artifact) => (
                    <a key={artifact.kind} className="button" href={buildArtifactDownloadUrl(run.jobId, artifact.kind)}>
                      {artifact.kind.toUpperCase()}
                    </a>
                  ))}
                </div>
              </div>

              <div className="compact-meta-row">
                <span className="run-pill">{formatDate(run.createdAt)}</span>
                <span className="run-pill">{summarizeRunSources(run)}</span>
                <span className="run-pill">{run.slidePlan.slides.length} slides</span>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
