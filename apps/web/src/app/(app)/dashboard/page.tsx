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
              {latestRun.artifacts.map((artifact) => (
                <a key={artifact.kind} className="button" href={buildArtifactDownloadUrl(latestRun.jobId, artifact.kind)}>
                  {artifact.kind.toUpperCase()}
                </a>
              ))}
            </div>
          </div>

          <div className="compact-meta-row">
            <span className="run-pill">{formatDate(latestRun.createdAt)}</span>
            <span className="run-pill">{summarizeRunSources(latestRun)}</span>
            <span className="run-pill">{latestRun.slidePlan.slides.length} slides</span>
          </div>

          {latestRun.insights.length > 0 ? (
            <div className="stack-xs">
              <p className="section-label">Highlights</p>
              <ul className="clean-list">
                {latestRun.insights.slice(0, 3).map((insight) => (
                  <li key={insight.id}>{insight.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="panel workspace-empty-card onboarding-card">
          <div className="stack">
            <h2>Create your first report</h2>
            <p className="muted">
              It takes about 5 minutes. Here&apos;s what you&apos;ll need:
            </p>
          </div>

          <div className="onboarding-steps">
            <div className="onboarding-step">
              <span className="onboarding-step-number">1</span>
              <div className="stack-xs">
                <strong>Your data files</strong>
                <p className="muted">CSVs, spreadsheets, or PDFs from one reporting cycle.</p>
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
                <p className="muted">Upload a PPTX template and Basquio will match your brand.</p>
              </div>
            </div>
          </div>

          <Link className="button" href="/jobs/new">
            Start your first report →
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
                <div className="stack">
                  <p className="artifact-kind">{summarizeRunSources(run)}</p>
                  <h3>{run.story.keyMessages[0] ?? run.objective}</h3>
                  <p className="muted">{summarizeRunBrief(run)}</p>
                </div>

                <div className="compact-meta-row">
                  <span className="run-pill">{formatDate(run.createdAt)}</span>
                  <span className="run-pill">{run.slidePlan.slides.length} slides</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
