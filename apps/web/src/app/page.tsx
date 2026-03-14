import Image from "next/image";
import Link from "next/link";

import {
  buildArtifactDownloadUrl,
  listGenerationRuns,
  summarizeRunBrief,
  summarizeRunSources,
} from "@/lib/job-runs";

const productPillars = [
  {
    label: "Data understanding",
    title: "Reads your data before writing a single slide.",
    copy:
      "Basquio profiles every measure, ranks what matters, and identifies patterns before any narrative or design begins.",
  },
  {
    label: "Narrative intelligence",
    title: "Builds the story your audience needs.",
    copy:
      "Findings become key messages, structured into sections that move from context to insight to recommendation.",
  },
  {
    label: "Dual output",
    title: "One analysis, two deliverables.",
    copy:
      "Editable PowerPoint for your revisions. Polished PDF for distribution. Both from the same analysis.",
  },
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function HomePage() {
  const runs = await listGenerationRuns(3);
  const latestRun = runs[0] ?? null;
  const artifactCount = runs.reduce((total, run) => total + run.artifacts.length, 0);
  const sourceFileCount = runs.reduce((total, run) => {
    const files = run.datasetProfile.manifest?.files ?? run.datasetProfile.sourceFiles ?? [];
    return total + (files.length > 0 ? files.length : 1);
  }, 0);

  return (
    <div className="landing-shell">
      <section className="landing-nav-panel">
        <div className="row landing-nav-copy">
          <Image
            src="/brand/svg/logo/basquio-logo-light-bg-mono.svg"
            alt="Basquio"
            width={188}
            height={30}
            priority
          />
          <span className="nav-pill">Beautiful Intelligence.</span>
        </div>

        <div className="row landing-nav-copy">
          <Link className="button secondary" href="/dashboard">
            Open workspace
          </Link>
          <Link className="button" href="/jobs/new">
            Try it with your data
          </Link>
        </div>
      </section>

      <section className="hero-stage">
        <div className="hero-main">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label light">Beautiful Intelligence.</p>
              <h1>Two weeks of analysis. Delivered in hours.</h1>
              <p className="hero-copy">
                Upload your data. Get back a finished analysis — actionable insights, compelling narrative, and a
                presentation you&apos;d put your name on.
              </p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Try it with your data
              </Link>
              <Link className="button secondary inverted" href="/artifacts">
                See recent outputs
              </Link>
            </div>
          </div>

          <div className="hero-metrics">
            <article className="metric-card">
              <span className="metric-value">{runs.length}</span>
              <span className="metric-label">Analyses completed</span>
            </article>
            <article className="metric-card">
              <span className="metric-value">{artifactCount}</span>
              <span className="metric-label">Presentations delivered</span>
            </article>
            <article className="metric-card">
              <span className="metric-value">{sourceFileCount}</span>
              <span className="metric-label">Data files processed</span>
            </article>
          </div>
        </div>

        <aside className="hero-terminal">
          <div className="row split">
            <div className="stack">
              <p className="section-label light">How it works</p>
              <h2 className="stage-title">From raw data to finished presentation in three steps.</h2>
            </div>
            <Image src="/brand/svg/icon/basquio-icon-amber.svg" alt="" width={30} height={24} aria-hidden />
          </div>

          <div className="signal-grid">
            <article className="signal-card stack">
              <p className="artifact-kind">1. Upload</p>
              <p>Add your data and context</p>
              <p className="muted">Spreadsheets, supporting files, audience, objective, and what matters most.</p>
            </article>
            <article className="signal-card stack">
              <p className="artifact-kind">2. Analyze</p>
              <p>Basquio finds the insights</p>
              <p className="muted">Measures are profiled, patterns identified, and key findings ranked by importance.</p>
            </article>
            <article className="signal-card stack">
              <p className="artifact-kind">3. Deliver</p>
              <p>Get your presentation</p>
              <p className="muted">Editable PowerPoint and polished PDF, both built from the same analysis.</p>
            </article>
          </div>
        </aside>
      </section>

      <section className="landing-pillars">
        {productPillars.map((pillar) => (
          <article key={pillar.label} className="editorial-card">
            <p className="section-label">{pillar.label}</p>
            <h2>{pillar.title}</h2>
            <p className="muted">{pillar.copy}</p>
          </article>
        ))}
      </section>

      <section className="landing-duo">
        <article className="panel stack-xl">
          <div className="stack">
            <p className="section-label">Why it&apos;s different</p>
            <h2>Analysis first. Slides second.</h2>
          </div>

          <div className="evidence-list">
            <div className="evidence-row">
              <p className="artifact-kind">01</p>
              <div className="stack">
                <p>Data drives the narrative.</p>
                <p className="muted">Basquio reads and ranks your data before writing any story. No guessing, no hallucination.</p>
              </div>
            </div>
            <div className="evidence-row">
              <p className="artifact-kind">02</p>
              <div className="stack">
                <p>Your brief shapes the output.</p>
                <p className="muted">Audience, objective, and stakes guide the narrative — not buried as an afterthought.</p>
              </div>
            </div>
            <div className="evidence-row">
              <p className="artifact-kind">03</p>
              <div className="stack">
                <p>Both outputs stay in sync.</p>
                <p className="muted">The PowerPoint and PDF come from the same analysis. Change one brief, both update.</p>
              </div>
            </div>
          </div>
        </article>

        <article className="dark-panel stack-xl">
          <div className="stack">
            <p className="section-label light">Latest result</p>
            <h2>{latestRun ? latestRun.story.keyMessages[0] ?? latestRun.objective : "No analyses yet"}</h2>
            <p className="muted">
              {latestRun
                ? `${summarizeRunBrief(latestRun)}. Created ${formatDate(latestRun.createdAt)}.`
                : "Run your first analysis to see results here."}
            </p>
          </div>

          {latestRun ? (
            <>
              <div className="deliverable-grid">
                {latestRun.artifacts.map((artifact) => (
                  <article key={artifact.kind} className="signal-card stack">
                    <p className="artifact-kind">{artifact.kind.toUpperCase()}</p>
                    <h3>{artifact.fileName}</h3>
                    <p className="muted">
                      {artifact.kind === "pptx"
                        ? "Editable PowerPoint for your revisions."
                        : "Polished PDF ready to share."}
                    </p>
                    <a className="button secondary inverted" href={buildArtifactDownloadUrl(latestRun.jobId, artifact.kind)}>
                      Download {artifact.kind.toUpperCase()}
                    </a>
                  </article>
                ))}
              </div>

              {latestRun.story.recommendedActions.length > 0 ? (
                <div className="action-list">
                  <p className="artifact-kind">Recommended actions</p>
                  {latestRun.story.recommendedActions.map((action) => (
                    <p key={action}>{action}</p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </article>
      </section>

      <section className="panel stack-xl">
        <div className="stack">
          <p className="section-label">Recent outputs</p>
          <h2>Your latest analyses and presentations.</h2>
        </div>

        {runs.length === 0 ? (
          <div className="empty-state">
            <p>No analyses yet.</p>
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

                <div className="deliverable-grid">
                  {run.artifacts.map((artifact) => (
                    <article key={artifact.kind} className="deliverable-tile stack">
                      <p className="artifact-kind">{artifact.kind.toUpperCase()}</p>
                      <p className="deliverable-label">{artifact.fileName}</p>
                      <a className="button secondary" href={buildArtifactDownloadUrl(run.jobId, artifact.kind)}>
                        Open {artifact.kind.toUpperCase()}
                      </a>
                    </article>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
