import Image from "next/image";
import Link from "next/link";

import { BASQUIO_PIPELINE_STAGES, BASQUIO_RENDER_POLICY } from "@basquio/core";

import {
  buildArtifactDownloadUrl,
  listGenerationRuns,
  summarizeRunBrief,
  summarizeRunSources,
} from "@/lib/job-runs";

const productPillars = [
  {
    label: "Package understanding",
    title: "Structured evidence packages, not one-shot prompts.",
    copy:
      "Basquio reads tabular files, supporting notes, and optional brand assets as one report job before any narrative planning begins.",
  },
  {
    label: "Narrative discipline",
    title: "Deterministic analytics anchor the story.",
    copy:
      "Measures are profiled and ranked first, then translated into key messages, slide plans, and report sections leadership can act on.",
  },
  {
    label: "Artifact contract",
    title: "One slide plan drives both outputs.",
    copy:
      "Editable PPTX and polished PDF stay coupled to the same structured report contract instead of drifting into separate render paths.",
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
        <Image src="/brand/svg/logo/basquio-logo-light-bg-mono.svg" alt="Basquio" width={188} height={30} priority />

        <div className="row landing-nav-copy">
          <span className="nav-pill">Executive report generation</span>
          <Link className="button secondary" href="/dashboard">
            Open workspace
          </Link>
          <Link className="button" href="/jobs/new">
            Generate first deck
          </Link>
        </div>
      </section>

      <section className="hero-stage">
        <div className="hero-main">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label light">Intelligence-first presentation system</p>
              <h1>Turn evidence packages into executive-grade PPTX and PDF artifacts.</h1>
              <p className="hero-copy">
                Basquio is built for structured evidence-backed reporting. It ingests data files, a report brief, and
                optional brand direction, computes deterministic analysis before narrative planning, and renders both
                outputs from one canonical slide plan.
              </p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Start a generation run
              </Link>
              <Link className="button secondary inverted" href="/artifacts">
                Review recent artifacts
              </Link>
            </div>
          </div>

          <div className="hero-metrics">
            <article className="metric-card">
              <span className="metric-value">{runs.length}</span>
              <span className="metric-label">Recent report runs visible in this workspace</span>
            </article>
            <article className="metric-card">
              <span className="metric-value">{artifactCount}</span>
              <span className="metric-label">PPTX and PDF artifacts currently downloadable</span>
            </article>
            <article className="metric-card">
              <span className="metric-value">{sourceFileCount}</span>
              <span className="metric-label">Evidence files understood across the latest visible runs</span>
            </article>
          </div>
        </div>

        <aside className="hero-terminal">
          <div className="row split">
            <div className="stack">
              <p className="section-label light">Operating model</p>
              <h2 className="stage-title">One pipeline for evidence understanding, story planning, and deliverables.</h2>
            </div>
            <Image src="/brand/svg/icon/basquio-icon-amber.svg" alt="" width={30} height={24} aria-hidden />
          </div>

          <div className="signal-grid">
            <article className="signal-card stack">
              <p className="artifact-kind">Input</p>
              <p>Evidence package</p>
              <p className="muted">CSV or workbook data plus support files, methodology notes, and validation context.</p>
            </article>
            <article className="signal-card stack">
              <p className="artifact-kind">Brief</p>
              <p>Audience, objective, thesis</p>
              <p className="muted">The reporting ask stays explicit so Basquio builds a persuasive narrative spine.</p>
            </article>
            <article className="signal-card stack">
              <p className="artifact-kind">Style</p>
              <p>Template or brand contract</p>
              <p className="muted">PPTX remains the editable template input. Brand tokens map through `TemplateProfile`.</p>
            </article>
            <article className="signal-card stack">
              <p className="artifact-kind">Output</p>
              <p>Deck pair</p>
              <p className="muted">PPTX for iteration, PDF for distribution, both tied to the same slide specification.</p>
            </article>
          </div>

          <div className="stack">
            <p className="artifact-kind">Canonical pipeline</p>
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
            <p className="section-label">Why Basquio reads as product, not polish</p>
            <h2>The workflow is opinionated around executive reporting constraints.</h2>
          </div>

          <div className="evidence-list">
            <div className="evidence-row">
              <p className="artifact-kind">01</p>
              <div className="stack">
                <p>Evidence comes before copy.</p>
                <p className="muted">
                  Deterministic summaries and high-signal measures are computed before the system writes any story.
                </p>
              </div>
            </div>
            <div className="evidence-row">
              <p className="artifact-kind">02</p>
              <div className="stack">
                <p>The report brief is part of the contract.</p>
                <p className="muted">
                  Audience, objective, stakes, and thesis influence the outline instead of being treated as loose prompt text.
                </p>
              </div>
            </div>
            <div className="evidence-row">
              <p className="artifact-kind">03</p>
              <div className="stack">
                <p>Rendering stays subordinate to planning.</p>
                <p className="muted">
                  {BASQUIO_RENDER_POLICY.pptx}. {BASQUIO_RENDER_POLICY.pdf}. {BASQUIO_RENDER_POLICY.charts}.
                </p>
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
          <p className="section-label">Recent outputs</p>
          <h2>Runs in this workspace already read like deliverables, not placeholder files.</h2>
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
