import Image from "next/image";
import Link from "next/link";

import { BASQUIO_PIPELINE_STAGES } from "@basquio/core";

import {
  buildArtifactDownloadUrl,
  listGenerationRuns,
  summarizeRunBrief,
  summarizeRunSources,
} from "@/lib/job-runs";

const productPillars = [
  {
    label: "Your data, understood",
    title: "It reads the data, not just the headers.",
    copy:
      "Basquio profiles every measure, ranks what matters, and finds the insights worth presenting before building a single slide.",
  },
  {
    label: "Your story, built",
    title: "From insight to narrative, automatically.",
    copy:
      "Every presentation follows a clear story arc from context to findings to recommendations. Not random charts, a real narrative.",
  },
  {
    label: "Your deck, delivered",
    title: "Editable PowerPoint. Polished PDF. Same story.",
    copy:
      "Both outputs come from the same analysis. Edit the deck for your team, share the PDF with leadership. They always match.",
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
          <span className="artifact-kind muted">Beautiful Intelligence.</span>
        </div>

        <div className="row landing-nav-copy">
          <Link className="button secondary" href="/dashboard">
            Dashboard
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
              <h1>Two weeks of analysis. Delivered in hours.</h1>
              <p className="hero-copy">
                Upload your data. Get back a finished analysis: actionable insights, compelling narrative, and a
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
              <span className="metric-label">Reports generated</span>
            </article>
            <article className="metric-card">
              <span className="metric-value">{artifactCount}</span>
              <span className="metric-label">Presentations delivered</span>
            </article>
            <article className="metric-card">
              <span className="metric-value">{sourceFileCount}</span>
              <span className="metric-label">Data files analyzed</span>
            </article>
          </div>
        </div>

        <aside className="hero-terminal">
          <div className="row split">
            <div className="stack">
              <h2 className="stage-title">How it works</h2>
            </div>
            <Image src="/brand/svg/icon/basquio-icon-amber.svg" alt="" width={30} height={24} aria-hidden />
          </div>

          <div className="signal-grid">
            <article className="signal-card stack">
              <p className="artifact-kind">Upload</p>
              <p>Your spreadsheet, your data files, your template.</p>
            </article>
            <article className="signal-card stack">
              <p className="artifact-kind">Analyze</p>
              <p>Basquio reads the data, finds the insights, builds the narrative.</p>
            </article>
            <article className="signal-card stack">
              <p className="artifact-kind">Deliver</p>
              <p>Editable PowerPoint and polished PDF, ready to present.</p>
            </article>
          </div>

          <div className="stack">
            <p className="artifact-kind">Under the hood</p>
            {BASQUIO_PIPELINE_STAGES.map((stage, index) => (
              <div key={stage} className="terminal-row">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{stage}</strong>
              </div>
            ))}
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
            <h2>Built for analysis, not just slides.</h2>
          </div>

          <div className="evidence-list">
            <div className="evidence-row">
              <p className="artifact-kind">01</p>
              <div className="stack">
                <p>Analysis first, slides second.</p>
                <p className="muted">Basquio computes real analytics from your data before writing a single word of narrative.</p>
              </div>
            </div>
            <div className="evidence-row">
              <p className="artifact-kind">02</p>
              <div className="stack">
                <p>Your brief shapes the story.</p>
                <p className="muted">Tell it who the audience is, what the objective is, and what&apos;s at stake. The narrative adapts.</p>
              </div>
            </div>
            <div className="evidence-row">
              <p className="artifact-kind">03</p>
              <div className="stack">
                <p>One plan, two outputs.</p>
                <p className="muted">The PowerPoint and the PDF are generated from the same structured plan. No drift, no inconsistency.</p>
              </div>
            </div>
          </div>
        </article>

        <article className="dark-panel stack-xl">
          <div className="stack">
            <p className="section-label light">Latest visible run</p>
            <h2>{latestRun ? latestRun.story.keyMessages[0] ?? latestRun.objective : "No report runs yet"}</h2>
            <p className="muted">
              {latestRun
                ? `${summarizeRunBrief(latestRun)}. Created ${formatDate(latestRun.createdAt)}.`
                : "Generate the first run to see the output contract, artifact pair, and analytical highlights here."}
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
                        ? "Editable working deck generated from the current slide plan."
                        : "Presentation-ready PDF rendered from the same report contract."}
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
          <p className="section-label">Recent results</p>
          <h2>Real analyses, generated from real data.</h2>
        </div>

        {runs.length === 0 ? (
          <div className="empty-state">
            <p>
              No generation runs yet. Start from <Link href="/jobs/new">New run</Link>.
            </p>
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
