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

export default async function ArtifactsPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>;
}) {
  const { jobId } = await searchParams;
  const runs = await listGenerationRuns(24);
  const activeRun = runs.find((run) => run.jobId === jobId) ?? runs[0] ?? null;
  const artifactCount = runs.reduce((total, run) => total + run.artifacts.length, 0);

  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-lg">
            <div className="stack">
              <p className="section-label">Artifacts</p>
              <h1>Generated deliverables stay paired and reviewable.</h1>
              <p className="page-copy">
                Each run stores the editable PPTX and the distribution-ready PDF together so the artifact library behaves
                like a report workspace, not a generic file dump.
              </p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Start new run
              </Link>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Current selection</p>
            <p>{activeRun ? activeRun.story.keyMessages[0] ?? activeRun.objective : "No artifacts yet"}</p>
            <p className="muted">
              {activeRun
                ? `${summarizeRunBrief(activeRun)}.`
                : "Generate the first run to populate the library with the PPTX and PDF pair."}
            </p>
          </aside>
        </div>

        <div className="summary-strip">
          <article className="summary-card">
            <span className="summary-value">{runs.length}</span>
            <span className="summary-label">Runs currently represented in the library</span>
          </article>
          <article className="summary-card">
            <span className="summary-value">{artifactCount}</span>
            <span className="summary-label">Paired artifacts downloadable right now</span>
          </article>
          <article className="summary-card">
            <span className="summary-value">{activeRun?.slidePlan.slides.length ?? 0}</span>
            <span className="summary-label">Slides in the active run’s planned report</span>
          </article>
        </div>
      </section>

      {runs.length === 0 ? (
        <section className="panel empty-state">
          <p>
            No artifacts yet. Generate the first run from <Link href="/jobs/new">New run</Link>.
          </p>
        </section>
      ) : (
        <section className="stack-xl">
          {runs.map((run) => {
            const active = jobId === run.jobId || (!jobId && activeRun?.jobId === run.jobId);

            return (
              <article key={run.jobId} className={active ? "panel run-card active-run" : "panel run-card"}>
                <div className="run-card-head">
                  <div className="stack">
                    <p className="artifact-kind">{summarizeRunSources(run)}</p>
                    <h2>{run.story.keyMessages[0] ?? run.objective}</h2>
                    <p className="muted">{summarizeRunBrief(run)}</p>
                  </div>

                  <div className="row">
                    {run.artifacts.map((artifact) => (
                      <a key={artifact.kind} className="button" href={buildArtifactDownloadUrl(run.jobId, artifact.kind)}>
                        Download {artifact.kind.toUpperCase()}
                      </a>
                    ))}
                  </div>
                </div>

                <div className="meta-grid">
                  <article className="meta-card stack">
                    <p className="artifact-kind">Created</p>
                    <p>{formatDate(run.createdAt)}</p>
                    <p className="muted">Job ID: {run.jobId}</p>
                  </article>
                  <article className="meta-card stack">
                    <p className="artifact-kind">Audience</p>
                    <p>{run.audience}</p>
                    <p className="muted">{run.objective}</p>
                  </article>
                  <article className="meta-card stack">
                    <p className="artifact-kind">Dataset</p>
                    <p>{run.datasetProfile.sheets.length} sheet view{run.datasetProfile.sheets.length === 1 ? "" : "s"}</p>
                    <p className="muted">{run.datasetProfile.sourceFileName}</p>
                  </article>
                  <article className="meta-card stack">
                    <p className="artifact-kind">Slides</p>
                    <p>{run.slidePlan.slides.length}</p>
                    <p className="muted">Planned before rendering</p>
                  </article>
                </div>

                <div className="deliverable-grid">
                  {run.artifacts.map((artifact) => (
                    <article key={artifact.kind} className="deliverable-tile stack">
                      <p className="artifact-kind">{artifact.kind === "pptx" ? "Editable deck" : "Distribution PDF"}</p>
                      <h4>{artifact.fileName}</h4>
                      <p className="muted">
                        {artifact.kind === "pptx"
                          ? "Use this file for working edits and executive iteration."
                          : "Use this file for polished handoff and presentation-ready sharing."}
                      </p>
                      <Link className="button secondary" href={`/artifacts?jobId=${run.jobId}`}>
                        Focus run
                      </Link>
                    </article>
                  ))}
                </div>

                {run.deterministicAnalysis.highlights.length > 0 ? (
                  <div className="stack">
                    <p className="section-label">Analytical highlights</p>
                    <ul className="clean-list">
                      {run.deterministicAnalysis.highlights.map((highlight) => (
                        <li key={highlight}>{highlight}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
