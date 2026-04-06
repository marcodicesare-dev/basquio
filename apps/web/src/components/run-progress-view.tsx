"use client";

import { Check } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { DEFAULT_AUTHOR_MODEL, calculateRunCredits } from "@/lib/credits";

type TemplateDiagnostics = {
  status: "not_provided" | "parsed_successfully" | "partially_applied" | "fallback_default";
  source: "system_default" | "saved_profile" | "uploaded_file";
  effect: "layout_and_theme" | "theme_only" | "none";
  reason: string;
  templateName: string | null;
  warnings: string[];
};

type Summary = {
  jobId?: string;
  story?: { title: string; keyMessages: string[] };
  objective?: string;
  insights?: Array<{ id: string; title: string }>;
  slidePlan?: { slides: Array<{ id: string }> };
  artifacts?: Array<{ kind: string; fileName: string }>;
  slideCount?: number;
  pageCount?: number;
  qaPassed?: boolean;
  templateDiagnostics?: TemplateDiagnostics;
  brief?: {
    businessContext?: string;
    client?: string;
    audience?: string;
    objective?: string;
    thesis?: string;
    stakes?: string;
  };
  inputs?: Array<{ id?: string; kind: string; fileName: string }>;
  failureGuidance?: string[];
};

type Step = {
  stage: string;
  baseStage: string;
  attempt: number;
  status: "queued" | "running" | "completed" | "failed" | "needs_input";
  detail: string;
};

type FailureClassification = {
  class: string;
  headline: string;
  explanation: string;
  retryAdvice: string;
};

export type RunProgressSnapshot = {
  jobId: string;
  authorModel?: string;
  attemptNumber?: number;
  pipelineVersion?: "v2";
  status: "queued" | "running" | "completed" | "failed" | "needs_input";
  artifactsReady: boolean;
  createdAt: string;
  updatedAt?: string;
  currentStage: string;
  currentStageLabel?: string;
  currentDetail: string;
  progressPercent: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number | null;
  estimatedRemainingLowSeconds?: number | null;
  estimatedRemainingHighSeconds?: number | null;
  estimatedRemainingConfidence?: "high" | "medium" | "low";
  steps: Step[];
  summary: Summary | null;
  templateDiagnostics?: TemplateDiagnostics;
  failureMessage?: string;
  failureClassification?: FailureClassification;
  toolCallCount?: number;
  runHealth?: "healthy" | "stale" | "recovering" | "late_heartbeat";
  notifyOnComplete?: boolean;
};

// ─── COMPONENT ─────────────────────────────────────────────────

export function RunProgressView(input: {
  jobId: string;
  initialSnapshot: RunProgressSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState<RunProgressSnapshot | null>(input.initialSnapshot);
  const [, setError] = useState<string | null>(null);
  const [missingPollCount, setMissingPollCount] = useState(0);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [showSaveRecipe, setShowSaveRecipe] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [recipeSaved, setRecipeSaved] = useState(false);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [showCompletionToast, setShowCompletionToast] = useState(false);
  const prevStatusRef = useRef<string | null>(null);
  const isTerminal = snapshot?.status === "completed" || snapshot?.status === "failed" || snapshot?.status === "needs_input";

  // Detect live completion transition for toast
  useEffect(() => {
    if (prevStatusRef.current && prevStatusRef.current !== "completed" && snapshot?.status === "completed") {
      setShowCompletionToast(true);
      const timer = setTimeout(() => setShowCompletionToast(false), 8000);
      return () => clearTimeout(timer);
    }
    if (snapshot?.status) {
      prevStatusRef.current = snapshot.status;
    }
  }, [snapshot?.status]);

  // Fetch credit balance when run completes
  useEffect(() => {
    if (snapshot?.status !== "completed") return;
    fetch("/api/credits", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setCreditBalance(data.balance ?? null))
      .catch(() => {});
  }, [snapshot?.status]);

  // Polling
  useEffect(() => {
    if (isTerminal) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${input.jobId}`, { cache: "no-store" });
        const payload = (await response.json()) as RunProgressSnapshot & { error?: string };
        if (!active) return;
        if (!response.ok) {
          if (response.status === 404 && !snapshot) {
            setMissingPollCount((c) => c + 1);
            setError(null);
            return;
          }
          throw new Error(payload.error ?? "Something went wrong.");
        }
        setSnapshot(payload);
        setMissingPollCount(0);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    };
    void poll();
    const interval = window.setInterval(poll, 2500);
    return () => { active = false; window.clearInterval(interval); };
  }, [input.jobId, isTerminal, snapshot]);

  // ─── WAITING STATE ───────────────────────────────────────────
  if (!snapshot) {
    return (
      <div style={styles.fullPage}>
        <div style={styles.center}>
          <div style={styles.spinner} />
          <p style={{ color: "#A09FA6", fontSize: "1.1rem", marginTop: "1.5rem" }}>
            {missingPollCount > 6
              ? "This is taking longer than expected. Try refreshing."
              : "Starting up..."}
          </p>
        </div>
      </div>
    );
  }

  const slideCount = snapshot.summary?.slideCount ?? snapshot.summary?.slidePlan?.slides?.length ?? 0;
  // ─── COMPLETED STATE ─────────────────────────────────────────
  if (snapshot.status === "completed" && snapshot.artifactsReady) {
    const authorModel = snapshot.authorModel ?? DEFAULT_AUTHOR_MODEL;
    const creditsCost = calculateRunCredits(slideCount, authorModel);
    const elapsedMin = Math.floor(snapshot.elapsedSeconds / 60);
    const elapsedSec = snapshot.elapsedSeconds % 60;
    const hasPptxArtifact = Boolean(snapshot.summary?.artifacts?.some((artifact) => artifact.kind === "pptx"));
    const hasPdfArtifact = Boolean(snapshot.summary?.artifacts?.some((artifact) => artifact.kind === "pdf"));
    const hasMdArtifact = Boolean(snapshot.summary?.artifacts?.some((artifact) => artifact.kind === "md"));
    const hasXlsxArtifact = Boolean(snapshot.summary?.artifacts?.some((artifact) => artifact.kind === "xlsx"));
    const pptxDownloadHref = `/api/artifacts/${snapshot.jobId}/pptx`;
    const pdfDownloadHref = `/api/artifacts/${snapshot.jobId}/pdf`;
    const mdDownloadHref = `/api/artifacts/${snapshot.jobId}/md`;
    const xlsxDownloadHref = `/api/artifacts/${snapshot.jobId}/xlsx`;
    const templateSummary = describeTemplateDiagnostics(
      snapshot.summary?.templateDiagnostics ?? snapshot.templateDiagnostics,
    );
    const isReportOnlyResult = !hasPptxArtifact && hasMdArtifact && hasXlsxArtifact;
    const readyLabel = isReportOnlyResult ? "Your report is ready" : "Your deck is ready";
    const resultMeta = isReportOnlyResult
      ? `Report + data pack · ${creditsCost} credits · ${elapsedMin}m ${elapsedSec}s`
      : `${slideCount} slides · ${creditsCost} credits · ${elapsedMin}m ${elapsedSec}s`;
    const capabilityPills = isReportOnlyResult
      ? ["Markdown report", "Audit-ready Excel workbook"]
      : ["Editable in PowerPoint", "Report + data workbook included"];

    return (
      <div className="page-shell job-result-page">
        {showCompletionToast && (
          <div style={{
            position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
            background: "#1a6aff", color: "#fff", padding: "12px 24px", borderRadius: 12,
            fontSize: "0.92rem", fontWeight: 600, zIndex: 1000, display: "flex",
            alignItems: "center", gap: "12px", boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
          }}>
            {readyLabel}
            <button type="button" onClick={() => setShowCompletionToast(false)} style={{
              background: "rgba(255,255,255,0.2)", border: "none", color: "#fff",
              padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: "0.82rem",
            }}>Dismiss</button>
          </div>
        )}
        <section className="panel job-result-hero">
          <div className="stack-lg job-result-copy">
            <div className="stack">
              <span className="job-result-check" aria-hidden>
                <Check size={18} weight="bold" />
              </span>
              <p className="artifact-kind">Export complete</p>
              <h1>{readyLabel}</h1>
              <p className="muted">
                {resultMeta}
              </p>
            </div>

            <div className="job-result-actions">
              {hasPptxArtifact ? (
                <a className="button" href={pptxDownloadHref}>
                  Download PPTX
                </a>
              ) : null}
              {hasPdfArtifact ? (
                <a className="button secondary" href={pdfDownloadHref}>
                  Download PDF
                </a>
              ) : null}
              {hasMdArtifact ? (
                <a className="button secondary" href={mdDownloadHref}>
                  Download Report
                </a>
              ) : (
                <span className="muted" style={{ fontSize: "0.82rem" }}>
                  Narrative report was not generated for this run.
                </span>
              )}
              {hasXlsxArtifact ? (
                <a className="button secondary" href={xlsxDownloadHref}>
                  Download Data
                </a>
              ) : null}
            </div>

            <div className="compact-meta-row">
              {capabilityPills.map((pill) => <span key={pill} className="run-pill">{pill}</span>)}
              {snapshot.summary?.qaPassed === true ? <span className="run-pill run-pill-ready">Ready to review</span> : null}
              {snapshot.summary?.qaPassed === false ? <span className="run-pill run-pill-failed">Review suggested</span> : null}
              <span className="run-pill">{templateSummary.badge}</span>
            </div>
            <p className="muted" style={{ marginTop: "0.85rem", maxWidth: 560 }}>
              {templateSummary.detail}
            </p>
          </div>

        </section>

        <div className="billing-stats-row">
          <article className="panel billing-stat-card">
            <p className="billing-stat-label">{isReportOnlyResult ? "Artifacts" : "Slides"}</p>
            <p className="billing-stat-value">{isReportOnlyResult ? "MD + XLSX" : slideCount}</p>
          </article>
          <article className="panel billing-stat-card">
            <p className="billing-stat-label">Credits used</p>
            <p className="billing-stat-value">{creditsCost}</p>
          </article>
          <article className="panel billing-stat-card">
            <p className="billing-stat-label">Status</p>
            <p className={`billing-stat-value job-result-qa ${snapshot.summary?.qaPassed === false ? "job-result-qa-failed" : "job-result-qa-passed"}`}>
              {snapshot.summary?.qaPassed === false ? "Review suggested" : snapshot.summary?.qaPassed === true ? "Ready" : "Available"}
            </p>
          </article>
        </div>

        <section className="panel stack-lg">
          <div className="workspace-section-head">
            <h2>Next step</h2>
          </div>
          <div className="job-result-links">
            <Link className="button small secondary" href={`/jobs/new?from=${snapshot.jobId}`}>
              Rerun with changes
            </Link>
            <Link className="button small secondary" href="/jobs/new">
              New report
            </Link>
            <Link className="button small secondary" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </section>

        <section className="panel stack-lg">
          <div className="stack-xs">
            <p className="artifact-kind">Recipe</p>
            <h2>Reuse this setup later</h2>
            <p className="muted">
              Save this report configuration and rerun it next month with fresh source files.
            </p>
          </div>

          {!recipeSaved && !showSaveRecipe ? (
            <button
              className="button small secondary job-result-recipe-toggle"
              type="button"
              onClick={() => setShowSaveRecipe(true)}
            >
              Save as recipe
            </button>
          ) : null}

          {showSaveRecipe && !recipeSaved ? (
            <div className="job-result-recipe-form">
              <input
                className="job-result-recipe-input"
                type="text"
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                placeholder="Monthly Pet Care Review"
              />
              <button
                className="button small"
                type="button"
                disabled={!recipeName.trim() || recipeSaving}
                onClick={async () => {
                  setRecipeSaving(true);
                  try {
                    const res = await fetch("/api/recipes", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ name: recipeName.trim(), runId: snapshot.jobId }),
                    });
                    if (res.ok) {
                      setRecipeSaved(true);
                      setShowSaveRecipe(false);
                    }
                  } catch { /* ignore */ }
                  setRecipeSaving(false);
                }}
              >
                {recipeSaving ? "Saving..." : "Save recipe"}
              </button>
            </div>
          ) : null}

          {recipeSaved ? (
            <div className="success-panel job-result-feedback">
              <p>Recipe saved. Find it on your dashboard to rerun next month.</p>
            </div>
          ) : null}
        </section>

        {creditBalance !== null && creditBalance <= 0 ? (
          <section className="panel job-result-upgrade">
            <div className="stack-xs">
              <p className="artifact-kind">Credits exhausted</p>
              <h2>You used all your free credits</h2>
              <p className="muted">
                See pricing to keep generating reports or move this workflow onto a paid plan with cheaper credits.
              </p>
            </div>
            <Link className="button" href="/pricing">
              See pricing
            </Link>
          </section>
        ) : null}
      </div>
    );
  }

  if (snapshot.status === "completed" && !snapshot.artifactsReady) {
    return (
      <div style={styles.fullPage}>
        <div style={styles.center}>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#F2F0EB", marginBottom: "0.5rem" }}>
            Generation finished, but artifacts are unavailable
          </h1>
          <p style={{ color: "#A09FA6", fontSize: "1.05rem", maxWidth: 520, marginBottom: "1.5rem" }}>
            The run completed without a published artifact manifest. This deck should not be treated as ready.
          </p>
          {snapshot.failureMessage && (
            <p style={{ fontSize: "0.8rem", color: "#6B6A72", fontFamily: "monospace", maxWidth: 500, wordBreak: "break-word", marginBottom: "1.5rem" }}>
              {snapshot.failureMessage}
            </p>
          )}
          <Link href="/jobs/new" style={styles.primaryButton}>Start a new run</Link>
        </div>
      </div>
    );
  }

  // ─── FAILED STATE ────────────────────────────────────────────
  if (snapshot.status === "failed") {
    const failedInputs = snapshot.summary?.inputs ?? [];
    const failedBrief = snapshot.summary?.brief;
    const fc = snapshot.failureClassification;
    const headline = fc?.headline ?? "Something went wrong";
    const explanation = fc?.explanation ?? "We hit an issue generating your deck.";
    const retryAdvice = fc?.retryAdvice ?? "Try again — it won't cost extra.";

    return (
      <div style={styles.fullPage}>
        <div style={styles.center}>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#F2F0EB", marginBottom: "0.5rem" }}>
            {headline}
          </h1>
          <p style={{ color: "#A09FA6", fontSize: "1.05rem", maxWidth: 480, marginBottom: "1.5rem" }}>
            {explanation}
          </p>
          <div style={{ width: "100%", maxWidth: 560, textAlign: "left", marginBottom: "1.5rem" }}>
            <p style={{ color: "#F2F0EB", fontWeight: 600, marginBottom: "0.4rem" }}>
              Failed during: {snapshot.currentStageLabel ?? snapshot.currentStage}
            </p>
            {failedInputs.length > 0 ? (
              <div style={{ marginBottom: "1rem" }}>
                <p style={{ color: "#A09FA6", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.35rem" }}>
                  Uploaded files
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
                  {failedInputs.map((file) => (
                    <span
                      key={`${file.kind}-${file.fileName}`}
                      style={{
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 999,
                        padding: "0.35rem 0.65rem",
                        color: "#D7D3CD",
                        fontSize: "0.86rem",
                      }}
                    >
                      {file.fileName} ({file.kind})
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {failedBrief?.businessContext || failedBrief?.audience || failedBrief?.objective ? (
              <div style={{ marginBottom: "1rem" }}>
                <p style={{ color: "#A09FA6", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.35rem" }}>
                  Brief
                </p>
                {failedBrief?.businessContext ? (
                  <p style={{ color: "#D7D3CD", marginBottom: "0.35rem" }}>{failedBrief.businessContext}</p>
                ) : null}
                <p style={{ color: "#A09FA6", fontSize: "0.92rem", marginBottom: 0 }}>
                  Audience: {failedBrief?.audience || "n/a"} · Objective: {failedBrief?.objective || "n/a"}
                </p>
              </div>
            ) : null}
            <div style={{ marginBottom: "1rem" }}>
              <p style={{ color: "#A09FA6", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.35rem" }}>
                What to do
              </p>
              <p style={{ color: "#D7D3CD", fontSize: "0.92rem", margin: 0 }}>
                {retryAdvice}
              </p>
            </div>
          </div>
          <Link href={`/jobs/new?from=${snapshot.jobId}`} style={styles.primaryButton}>Try again</Link>
        </div>
      </div>
    );
  }

  // ─── IN-PROGRESS STATE ───────────────────────────────────────
  const isReportOnlyRun = snapshot.authorModel === "claude-haiku-4-5";
  const title = isReportOnlyRun ? "Building your report" : "Building your deck";
  const elapsedLabel = formatElapsedLabel(snapshot.elapsedSeconds);
  const leaveRunCopy = snapshot.notifyOnComplete !== false
    ? "This runs in the background. Close this page and we'll email you when it's ready."
    : "This runs in the background. Close this page and come back from Reports or Dashboard later.";

  return (
    <div style={styles.fullPage}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={styles.center}>
        <div style={styles.glow} />

        <div className="run-status-logo-shell" aria-hidden>
          <div className="run-status-logo-glow" />
          <div className="run-status-logo-frame">
            <Image
              src="/brand/svg/icon/basquio-icon-white.svg"
              alt=""
              width={72}
              height={72}
              className="run-status-logo-image"
              priority
            />
          </div>
        </div>

        <h1 className="run-status-title">{title}</h1>
        <p className="run-status-elapsed">{elapsedLabel}</p>

        <div style={styles.leaveRunCard}>
          <p style={styles.leaveRunEyebrow}>This keeps running</p>
          <p style={styles.leaveRunCopy}>{leaveRunCopy}</p>
          {snapshot.notifyOnComplete === false ? (
            <p style={styles.leaveRunCopy}>Email notifications are off. Turn them on in Settings.</p>
          ) : null}
          <div style={styles.leaveRunActions}>
            <Link href="/artifacts" style={styles.leaveRunButton}>
              See reports
            </Link>
            <Link href="/dashboard" style={styles.leaveRunButton}>
              Back to dashboard
            </Link>
            <Link href="/" style={styles.leaveRunButton}>
              Visit website
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────

const styles = {
  fullPage: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "calc(100vh - 160px)",
    borderRadius: 6,
    background: "linear-gradient(180deg, #0D0C14 0%, #0A090D 100%)",
    border: "1px solid rgba(255,255,255,0.06)",
    overflow: "hidden",
    position: "relative" as const,
  },
  center: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    textAlign: "center" as const,
    padding: "3rem 2rem",
    maxWidth: 640,
    width: "100%",
    position: "relative" as const,
  },
  glow: {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 500,
    height: 500,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(232,168,76,0.06) 0%, transparent 70%)",
    pointerEvents: "none" as const,
    filter: "blur(60px)",
  },
  spinner: {
    width: 40,
    height: 40,
    border: "3px solid rgba(255,255,255,0.1)",
    borderTop: "3px solid #E8A84C",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  primaryButton: {
    display: "inline-block",
    padding: "0.85rem 2.5rem",
    background: "#E8A84C",
    color: "#0A090D",
    fontWeight: 700,
    fontSize: "1rem",
    borderRadius: 4,
    textDecoration: "none",
  } as CSSProperties,
  leaveRunCard: {
    width: "100%",
    maxWidth: 560,
    marginBottom: "2rem",
    padding: "1rem 1.1rem",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    zIndex: 1,
    textAlign: "left",
  } as CSSProperties,
  leaveRunEyebrow: {
    margin: 0,
    color: "#F2F0EB",
    fontSize: "0.82rem",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  } as CSSProperties,
  leaveRunCopy: {
    margin: "0.55rem 0 0",
    color: "#A09FA6",
    fontSize: "0.9rem",
    lineHeight: 1.5,
  } as CSSProperties,
  leaveRunActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.65rem",
    marginTop: "0.95rem",
  } as CSSProperties,
  leaveRunButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "38px",
    padding: "0 0.95rem",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    color: "#F2F0EB",
    background: "rgba(255,255,255,0.04)",
    textDecoration: "none",
    fontSize: "0.88rem",
    fontWeight: 600,
  } as CSSProperties,
} as const;

// ─── HELPERS ───────────────────────────────────────────────────

function formatElapsedLabel(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s elapsed`;
  }

  const minutes = Math.floor(seconds / 60);
  return `${minutes} min elapsed`;
}

function describeTemplateDiagnostics(template: TemplateDiagnostics | null | undefined) {
  if (!template || template.status === "not_provided") {
    return {
      badge: "No template attached",
      detail: "Using the Basquio house style because this run did not include a template or brand file.",
    };
  }

  if (template.status === "fallback_default") {
    return {
      badge: "Template fallback",
      detail: `${template.templateName ?? "Uploaded template"} could not be parsed cleanly, so Basquio fell back to the system style. ${template.warnings[0] ?? ""}`.trim(),
    };
  }

  if (template.status === "partially_applied") {
    return {
      badge: "Template guidance partial",
      detail: `${template.templateName ?? "Template"} provided ${template.effect === "theme_only" ? "theme guidance only" : "partial layout guidance"}. This reflects template interpretation status, not a final fidelity score. ${template.warnings[0] ?? ""}`.trim(),
    };
  }

  return {
    badge: template.source === "saved_profile" ? "Saved template parsed" : "Uploaded template parsed",
    detail: `${template.templateName ?? "Template"} parsed cleanly and is available to guide ${template.effect === "layout_and_theme" ? "layout and theme choices" : "theme choices"} for this run. This reflects template interpretation status, not a final fidelity score.`,
  };
}
