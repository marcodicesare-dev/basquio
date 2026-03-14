import Link from "next/link";

import { BASQUIO_PIPELINE_STAGES } from "@basquio/core";

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

export default async function DashboardPage() {
  const runs = await listGenerationRuns(6);
  const latestRun = runs[0] ?? null;
  const artifactCount = runs.reduce((total, run) => total + run.artifacts.length, 0);
  const slideCount = latestRun?.slidePlan.slides.length ?? 0;

  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-lg">
            <div className="stack">
              <p className="section-label">Workspace</p>
              <h1>Executive reporting workspace</h1>
              <p className="page-copy">
                Monitor the evidence-to-artifact pipeline, keep the CSV-first testing path honest, and review the latest
                planned report before it leaves the system as a PPTX and PDF pair.
              </p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Start new run
              </Link>
              <Link className="button secondary" href="/artifacts">
                Open artifact library
              </Link>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Current focus</p>
            <p>{latestRun ? latestRun.story.keyMessages[0] ?? latestRun.objective : "No run in progress yet"}</p>
            <p className="muted">
              {latestRun
                ? `${summarizeRunBrief(latestRun)}. Latest output captured ${formatDate(latestRun.createdAt)}.`
                : "Use New run to submit the first evidence package and generate the initial artifact pair."}
            </p>
          </aside>
        </div>

        <div className="summary-strip">
          <article className="summary-card">
            <span className="summary-value">{runs.length}</span>
            <span className="summary-label">Recent runs recorded</span>
          </article>
          <article className="summary-card">
            <span className="summary-value">{artifactCount}</span>
            <span className="summary-label">Artifacts currently paired to those runs</span>
          </article>
          <article className="summary-card">
            <span className="summary-value">{slideCount}</span>
            <span className="summary-label">Slides in the latest planned report</span>
          </article>
        </div>
      </section>

      <section className="workspace-board">
        <article className="panel stack-xl">
          <div className="stack">
            <p className="section-label">Latest run</p>
            <h2>{latestRun ? latestRun.story.keyMessages[0] ?? latestRun.objective : "No completed runs yet"}</h2>
            <p className="muted">
              {latestRun
                ? `${summarizeRunSources(latestRun)}. ${summarizeRunBrief(latestRun)}.`
                : "Once a run completes, the dashboard surfaces the key message, highlights, and deliverable buttons here."}
            </p>
          </div>

          {latestRun ? (
            <>
              <div className="meta-grid">
                <article className="meta-card stack">
                  <p className="artifact-kind">Audience</p>
                  <p>{latestRun.audience}</p>
                  <p className="muted">{latestRun.objective}</p>
                </article>
                <article className="meta-card stack">
                  <p className="artifact-kind">Evidence package</p>
                  <p>{summarizeRunSources(latestRun)}</p>
                  <p className="muted">{latestRun.datasetProfile.sheets.length} parsed sheet views</p>
                </article>
                <article className="meta-card stack">
                  <p className="artifact-kind">Created</p>
                  <p>{formatDate(latestRun.createdAt)}</p>
                  <p className="muted">{latestRun.slidePlan.slides.length} slides planned before rendering</p>
                </article>
              </div>

              {latestRun.insights.length > 0 ? (
                <div className="stack">
                  <p className="artifact-kind">Analytical highlights</p>
                  <ul className="clean-list">
                    {latestRun.insights.slice(0, 3).map((insight) => (
                      <li key={insight.id}>{insight.title}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="row">
                {latestRun.artifacts.map((artifact) => (
                  <a key={artifact.kind} className="button" href={buildArtifactDownloadUrl(latestRun.jobId, artifact.kind)}>
                    Download {artifact.kind.toUpperCase()}
                  </a>
                ))}
              </div>
            </>
          ) : null}
        </article>

        <article className="technical-panel stack-xl">
          <div className="stack">
            <p className="section-label light">Canonical pipeline</p>
            <h2>Every run still follows the evidence-first contract.</h2>
            <p className="muted">
              The app is productizing the real flow, not decorating around it: parse, analyze, insight, narrative,
              slide planning, then dual rendering.
            </p>
          </div>

          <div className="stack">
            {BASQUIO_PIPELINE_STAGES.map((stage, index) => (
              <div key={stage} className="terminal-row">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{stage}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel stack-xl">
        <div className="stack">
          <p className="section-label">Recent activity</p>
          <h2>Generated runs stay visible as report work, not anonymous jobs.</h2>
        </div>

        {runs.length === 0 ? (
          <div className="empty-state">
            <p>No completed runs yet.</p>
          </div>
        ) : (
          <div className="cards">
            {runs.map((run) => (
              <article key={run.jobId} className="artifact-card">
                <div className="stack">
                  <p className="artifact-kind">{summarizeRunSources(run)}</p>
                  <h3>{run.story.keyMessages[0] ?? run.objective}</h3>
                  <p className="muted">{summarizeRunBrief(run)}</p>
                </div>

                <div className="row">
                  <span className="run-pill">{formatDate(run.createdAt)}</span>
                  <span className="run-pill">{run.slidePlan.slides.length} planned slides</span>
                </div>

                <Link className="button secondary" href={`/artifacts?jobId=${run.jobId}`}>
                  Open run
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
