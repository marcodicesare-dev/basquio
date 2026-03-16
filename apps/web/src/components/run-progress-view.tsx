"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useMemo, useState } from "react";


type ArtifactRecord = {
  kind: "pptx" | "pdf";
  fileName: string;
};

type ValidationIssue = {
  message: string;
  severity: "error" | "warning";
};

type Summary = {
  jobId: string;
  story: {
    title: string;
    keyMessages: string[];
  };
  objective: string;
  insights: Array<{ id: string; title: string }>;
  slidePlan: { slides: Array<{ id: string }> };
  validationReport?: { issues: ValidationIssue[]; targetStage?: string };
  revisionHistory?: Array<{ attempt: number; targetStage: string }>;
  artifacts: ArtifactRecord[];
};

type Step = {
  stage: string;
  baseStage: string;
  attempt: number;
  status: "queued" | "running" | "completed" | "failed" | "needs_input";
  detail: string;
  completedAt?: string;
};

export type RunProgressSnapshot = {
  jobId: string;
  pipelineVersion?: "v2";
  status: "queued" | "running" | "completed" | "failed" | "needs_input";
  artifactsReady: boolean;
  createdAt: string;
  updatedAt?: string;
  currentStage: string;
  currentDetail: string;
  progressPercent: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number | null;
  steps: Step[];
  summary: Summary | null;
  failureMessage?: string;
};

const V2_PHASES = ["normalize", "understand", "author", "critique", "revise", "export"] as const;

export function RunProgressView(input: {
  jobId: string;
  initialSnapshot: RunProgressSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState<RunProgressSnapshot | null>(input.initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [missingPollCount, setMissingPollCount] = useState(0);
  const isTerminal = snapshot?.status === "completed" || snapshot?.status === "failed" || snapshot?.status === "needs_input";

  useEffect(() => {
    if (isTerminal) {
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${input.jobId}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as RunProgressSnapshot & { error?: string };

        if (!active) {
          return;
        }

        if (!response.ok) {
          if (response.status === 404 && !snapshot) {
            setMissingPollCount((current) => current + 1);
            setError(null);
            return;
          }
          throw new Error(payload.error ?? "Unable to load run progress.");
        }

        setSnapshot(payload);
        setMissingPollCount(0);
        setError(null);
      } catch (pollError) {
        if (!active) {
          return;
        }
        setError(pollError instanceof Error ? pollError.message : "Unable to load run progress.");
      }
    };

    void poll();
    const interval = window.setInterval(poll, 2500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [input.jobId, isTerminal, snapshot]);

  const stageList = V2_PHASES;
  const stageSet = useMemo(() => new Map(snapshot?.steps.map((step) => [step.baseStage, step]) ?? []), [snapshot?.steps]);

  if (!snapshot) {
    return (
      <section className="page-shell">
        <article className="panel empty-state">
          <p>
            {missingPollCount > 6
              ? "Basquio is still waiting for this run to register. If this takes much longer, the run key may be invalid or the hosted state may still be recovering."
              : "Basquio is waiting for this run to register. Refresh in a moment."}
          </p>
        </article>
      </section>
    );
  }

  const title = snapshot.summary?.story.title || snapshot.summary?.story.keyMessages[0] || "Basquio is building your report";

  return (
    <div className="page-shell">
      <Script src="https://tenor.com/embed.js" strategy="afterInteractive" />

      <section className="page-hero loading-hero">
        <div className="page-header-grid">
          <div className="stack-lg">
            <div className="stack">
              <p className="section-label light">Generation run</p>
              <h1>{isTerminal ? title : "Basquio is thinking through the deck."}</h1>
              <p className="page-copy loading-copy">
                {snapshot.currentDetail ||
                  "The system is reading the package, planning the metrics, shaping the narrative, and preparing the final artifact pair."}
              </p>
            </div>

            <div className="loading-progress-card stack">
              <div className="row loading-progress-head">
                <div className="stack-xs">
                  <p className="artifact-kind">{humanizeStatus(snapshot.status)}</p>
                  <p className="loading-stage-title">{humanizeStage(snapshot.currentStage)}</p>
                </div>
                <strong className="loading-progress-value">{snapshot.progressPercent}%</strong>
              </div>

              <div className="loading-progress-track" aria-hidden="true">
                <div className="loading-progress-fill" style={{ width: `${snapshot.progressPercent}%` }} />
              </div>

              <div className="loading-stat-strip">
                <article className="loading-stat">
                  <span className="loading-stat-label">Elapsed</span>
                  <strong>{formatDuration(snapshot.elapsedSeconds)}</strong>
                </article>
                <article className="loading-stat">
                  <span className="loading-stat-label">Estimated left</span>
                  <strong>{snapshot.estimatedRemainingSeconds === null ? "Calculating" : formatDuration(snapshot.estimatedRemainingSeconds)}</strong>
                </article>
                <article className="loading-stat">
                  <span className="loading-stat-label">Run ID</span>
                  <strong>{snapshot.jobId.slice(-8)}</strong>
                </article>
              </div>
            </div>

            <div className="row">
              <Link className="button secondary" href="/artifacts">
                Open artifact library
              </Link>
            </div>
          </div>

          <aside className="loading-aside stack">
            {snapshot.artifactsReady ? (
              <article className="panel stack">
                <p className="artifact-kind">Artifacts ready</p>
                <p className="muted">
                  {snapshot.summary?.slidePlan.slides.length ?? 0} slides planned and rendered into the paired deliverables.
                </p>
                <div className="row">
                  <a className="button" href={`/api/artifacts/${snapshot.jobId}/pptx`}>Download PPTX</a>
                  <a className="button secondary" href={`/api/artifacts/${snapshot.jobId}/pdf`}>Download PDF</a>
                </div>
              </article>
            ) : (
              <article className="loading-gif-shell">
                <div
                  className="tenor-gif-embed"
                  data-postid="5925040"
                  data-share-method="host"
                  data-aspect-ratio="2.31481"
                  data-width="100%"
                >
                  <a href="https://tenor.com/view/mathew-wolf-gif-5925040">Mathew Wolf GIF</a>
                  from <a href="https://tenor.com/search/mathew-gifs">Mathew GIFs</a>
                </div>
              </article>
            )}

            <article className="panel stack">
              <p className="artifact-kind">What Basquio is doing</p>
              <p className="muted">
                Long runs are expected here. Bigger decks can spend more time in planning, critique, and revision before rendering.
              </p>
            </article>
          </aside>
        </div>
      </section>

      {error ? <article className="panel danger-panel">{error}</article> : null}

      <section className="loading-board">
        <article className="technical-panel stack-xl">
          <div className="stack">
            <p className="section-label light">Pipeline state</p>
            <h2>Every stage is visible while the run is in flight.</h2>
          </div>

          <div className="loading-stage-list">
            {stageList.map((stage, index) => {
              const step = stageSet.get(stage);
              const status = step?.status ?? (snapshot.status === "queued" && index === 0 ? "queued" : "queued");
              return (
                <article key={stage} className={`loading-stage-card status-${status}`}>
                  <div className="loading-stage-kicker">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{humanizeStage(stage)}</strong>
                  </div>
                  <p>{step?.detail || defaultV2PhaseCopy(stage)}</p>
                  <span className="loading-stage-pill">{humanizeStatus(status)}</span>
                </article>
              );
            })}
          </div>
        </article>

        <article className="panel stack-xl">
          <div className="stack">
            <p className="section-label">Run output</p>
            <h2>{title}</h2>
            <p className="muted">
              {snapshot.summary
                ? `${snapshot.summary.insights.length} insight${snapshot.summary.insights.length === 1 ? "" : "s"} ranked before rendering.`
                : "The final report shape appears here as soon as the validated plan is ready."}
            </p>
          </div>

          {snapshot.summary?.insights?.length ? (
            <ul className="clean-list">
              {snapshot.summary.insights.slice(0, 5).map((insight) => (
                <li key={insight.id}>{insight.title}</li>
              ))}
            </ul>
          ) : (
            <div className="loading-placeholder-grid">
              <div className="loading-placeholder-block" />
              <div className="loading-placeholder-block short" />
              <div className="loading-placeholder-block" />
            </div>
          )}

          {snapshot.status === "needs_input" && snapshot.summary?.validationReport?.issues?.length ? (
            <div className="stack">
              <p className="artifact-kind">Reviewer feedback</p>
              <ul className="clean-list">
                {snapshot.summary.validationReport.issues.slice(0, 5).map((issue, index) => (
                  <li key={`${issue.message}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {snapshot.summary?.revisionHistory?.length ? (
            <div className="stack">
              <p className="artifact-kind">Revision history</p>
              <ul className="clean-list">
                {snapshot.summary.revisionHistory.slice(0, 4).map((revision) => (
                  <li key={`${revision.attempt}-${revision.targetStage}`}>
                    Attempt {revision.attempt} routed back to {revision.targetStage}.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {snapshot.failureMessage ? <div className="danger-panel">{snapshot.failureMessage}</div> : null}
        </article>
      </section>
    </div>
  );
}

function humanizeStage(stage: string) {
  return stage.replaceAll("-", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

function humanizeStatus(status: RunProgressSnapshot["status"] | Step["status"]) {
  switch (status) {
    case "completed":
      return "Complete";
    case "running":
      return "In flight";
    case "needs_input":
      return "Needs review";
    case "failed":
      return "Failed";
    default:
      return "Queued";
  }
}

function formatDuration(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function defaultV2PhaseCopy(phase: string) {
  switch (phase) {
    case "normalize":
      return "Basquio is normalizing uploaded files into structured profiles and workbook schemas.";
    case "understand":
      return "The analyst agent is exploring the data, computing metrics, and identifying insights.";
    case "author":
      return "The author agent is building the narrative, slide plan, and chart bindings.";
    case "critique":
      return "An independent critic agent is reviewing the deck for accuracy and argument quality.";
    case "revise":
      return "The author is revising slides based on critic feedback.";
    case "export":
      return "Basquio is rendering the final PPTX and PDF artifacts.";
    default:
      return "This phase is queued for the current run.";
  }
}
