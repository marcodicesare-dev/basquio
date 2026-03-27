"use client";

import { Check, File, MagnifyingGlass, PaintBrush, Package } from "@phosphor-icons/react";
import Link from "next/link";
import Script from "next/script";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

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
  runHealth?: "healthy" | "stale" | "recovering";
  notifyOnComplete?: boolean;
};

// ─── USER-FACING PHASE MAP ─────────────────────────────────────
const USER_STEPS = [
  { id: "read", label: "Reading your files", Icon: File },
  { id: "analyze", label: "Finding the story", Icon: MagnifyingGlass },
  { id: "design", label: "Designing the deck", Icon: PaintBrush },
  { id: "review", label: "Reviewing and polishing", Icon: MagnifyingGlass },
  { id: "export", label: "Exporting", Icon: Package },
] as const;

const PHASE_TO_USER_STEP: Record<string, number> = {
  normalize: 0,
  understand: 1,
  author: 2,
  render: 2,
  polish: 3,
  critique: 3,
  revise: 3,
  export: 4,
};

// ─── COMPONENT ─────────────────────────────────────────────────

export function RunProgressView(input: {
  jobId: string;
  initialSnapshot: RunProgressSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState<RunProgressSnapshot | null>(input.initialSnapshot);
  const [error, setError] = useState<string | null>(null);
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
  const currentUserStepIdx = PHASE_TO_USER_STEP[snapshot.currentStage] ?? 0;

  const displayPercent = snapshot.status === "completed" ? 100 : snapshot.progressPercent;

  // ─── COMPLETED STATE ─────────────────────────────────────────
  if (snapshot.status === "completed" && snapshot.artifactsReady) {
    const creditsCost = 3 + slideCount;
    const elapsedMin = Math.floor(snapshot.elapsedSeconds / 60);
    const elapsedSec = snapshot.elapsedSeconds % 60;
    const pdfDownloadHref = `/api/artifacts/${snapshot.jobId}/pdf`;
    const pdfPreviewHref = `${pdfDownloadHref}?disposition=inline#toolbar=0&navpanes=0&view=FitH`;
    const pptxDownloadHref = `/api/artifacts/${snapshot.jobId}/pptx`;
    const hasDocxArtifact = Boolean(snapshot.summary?.artifacts?.some((artifact) => artifact.kind === "docx"));
    const docxDownloadHref = `/api/artifacts/${snapshot.jobId}/docx`;
    const templateSummary = describeTemplateDiagnostics(
      snapshot.summary?.templateDiagnostics ?? snapshot.templateDiagnostics,
    );

    return (
      <div className="page-shell job-result-page">
        {showCompletionToast && (
          <div style={{
            position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
            background: "#1a6aff", color: "#fff", padding: "12px 24px", borderRadius: 12,
            fontSize: "0.92rem", fontWeight: 600, zIndex: 1000, display: "flex",
            alignItems: "center", gap: "12px", boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
          }}>
            Your deck is ready.
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
              <h1>Your deck is ready</h1>
              <p className="muted">
                {slideCount} slides · {creditsCost} credits · {elapsedMin}m {elapsedSec}s
              </p>
            </div>

            <div className="job-result-actions">
              <a className="button" href={pptxDownloadHref}>
                Download PPTX
              </a>
              <a className="button secondary" href={pdfDownloadHref}>
                Download PDF
              </a>
              {hasDocxArtifact ? (
                <a className="button secondary" href={docxDownloadHref}>
                  Download DOCX
                </a>
              ) : (
                <span className="muted" style={{ fontSize: "0.82rem" }}>
                  DOCX was not generated for this run.
                </span>
              )}
              <a className="button small secondary" href={pdfPreviewHref} target="_blank" rel="noreferrer">
                Open preview
              </a>
            </div>

            <div className="compact-meta-row">
              <span className="run-pill">Editable in PowerPoint</span>
              <span className="run-pill">PDF preview embedded below</span>
              {snapshot.summary?.qaPassed === true ? <span className="run-pill run-pill-ready">Ready to review</span> : null}
              {snapshot.summary?.qaPassed === false ? <span className="run-pill run-pill-failed">Review suggested</span> : null}
              <span className="run-pill">{templateSummary.badge}</span>
            </div>
            <p className="muted" style={{ marginTop: "0.85rem", maxWidth: 560 }}>
              {templateSummary.detail}
            </p>
          </div>

          <div className="job-result-preview-shell">
            <object
              className="job-result-preview-frame"
              data={pdfPreviewHref}
              type="application/pdf"
              aria-label="Deck PDF preview"
            >
              <div className="panel workspace-empty-card workspace-empty-card-compact">
                <p className="muted">PDF preview is not available in this browser.</p>
                <div className="job-result-links">
                  <a className="button small secondary" href={pdfPreviewHref} target="_blank" rel="noreferrer">
                    Open preview
                  </a>
                  <a className="button small secondary" href={pdfDownloadHref}>
                    Download PDF
                  </a>
                </div>
              </div>
            </object>
          </div>
        </section>

        <div className="billing-stats-row">
          <article className="panel billing-stat-card">
            <p className="billing-stat-label">Slides</p>
            <p className="billing-stat-value">{slideCount}</p>
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
                See pricing to keep generating reports or move this workflow into a team workspace.
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
  const elapsed = snapshot.elapsedSeconds;
  const etaText = formatEta(snapshot);
  const templateSummary = describeTemplateDiagnostics(snapshot.templateDiagnostics);
  const staleWarning = snapshot.runHealth === "stale";
  const recoveringWarning = snapshot.runHealth === "recovering";

  return (
    <div style={styles.fullPage}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes breathe { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
      `}</style>

      <div style={styles.center}>
        {/* Ambient glow */}
        <div style={styles.glow} />

        {/* Title */}
        <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#F2F0EB", marginBottom: "0.3rem", zIndex: 1 }}>
          Building your deck
        </h1>
        <p style={{ color: "#A09FA6", fontSize: "1.05rem", marginBottom: "2.5rem", zIndex: 1 }}>
          {snapshot.currentStageLabel ?? USER_STEPS[currentUserStepIdx]?.label ?? "Working..."}
        </p>
        {typeof snapshot.attemptNumber === "number" && snapshot.attemptNumber > 1 ? (
          <p style={{ color: "#6B6A72", fontSize: "0.82rem", marginTop: "-1.8rem", marginBottom: "1.8rem", zIndex: 1 }}>
            Recovery attempt {snapshot.attemptNumber}
          </p>
        ) : null}
        {staleWarning ? (
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              marginBottom: "1.5rem",
              padding: "0.9rem 1rem",
              borderRadius: 18,
              border: "1px solid rgba(255,196,87,0.35)",
              background: "rgba(255,196,87,0.08)",
              color: "#F2F0EB",
              zIndex: 1,
            }}
          >
            This run stopped heartbeating and looks stalled. Basquio is trying to recover it automatically.
          </div>
        ) : null}
        {recoveringWarning ? (
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              marginBottom: "1.5rem",
              padding: "0.9rem 1rem",
              borderRadius: 18,
              border: "1px solid rgba(26,106,255,0.35)",
              background: "rgba(26,106,255,0.08)",
              color: "#F2F0EB",
              zIndex: 1,
            }}
          >
            Retrying automatically after a temporary service issue. You don&apos;t need to restart the run.
          </div>
        ) : null}

        {/* Progress bar — full width, monotonic display of the model-based estimate */}
        <div style={{ width: "100%", maxWidth: 480, marginBottom: "2.5rem", zIndex: 1 }}>
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressFill,
                width: `${displayPercent}%`,
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem" }}>
            <span style={{ color: "#6B6A72", fontSize: "0.8rem" }}>{formatTime(elapsed)} elapsed</span>
            <span style={{ color: "#A09FA6", fontSize: "0.8rem", fontWeight: 600 }}>{displayPercent}%</span>
          </div>
          <div style={{ marginTop: "0.9rem", textAlign: "left" }}>
            <p style={{ color: "#F2F0EB", fontSize: "0.92rem", margin: 0 }}>
              {snapshot.currentDetail}
            </p>
            <p style={{ color: "#A09FA6", fontSize: "0.8rem", margin: "0.45rem 0 0" }}>
              {etaText}
            </p>
            <p style={{ color: "#6B6A72", fontSize: "0.78rem", margin: "0.45rem 0 0" }}>
              {templateSummary.detail}
            </p>
          </div>
        </div>

        <div style={styles.leaveRunCard}>
          <p style={styles.leaveRunEyebrow}>Need to step away?</p>
          <p style={styles.leaveRunCopy}>
            This run keeps going in your workspace even if you leave this page. You can come back from Reports or Dashboard later.
          </p>
          <div style={{ marginTop: "0.75rem" }}>
            {snapshot.notifyOnComplete !== false ? (
              <p style={styles.leaveRunCopy}>We&apos;ll email you when the report is ready.</p>
            ) : (
              <p style={styles.leaveRunCopy}>Email notifications are off. Turn them on in Settings.</p>
            )}
          </div>
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

        {/* Steps — minimal, horizontal */}
        <div style={{ display: "flex", gap: "2rem", zIndex: 1, marginBottom: "2rem" }}>
          {USER_STEPS.map((step, idx) => {
            const isDone = idx < currentUserStepIdx || snapshot.status === "completed";
            const isActive = idx === currentUserStepIdx;
            const StepIcon = step.Icon;
            return (
              <div key={step.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: isDone ? "#E8A84C" : isActive ? "rgba(232,168,76,0.2)" : "rgba(255,255,255,0.08)",
                  color: isDone ? "#0A090D" : isActive ? "#E8A84C" : "#6B6A72",
                  border: isActive ? "2px solid #E8A84C" : "2px solid transparent",
                  animation: isActive ? "breathe 2s ease-in-out infinite" : undefined,
                  transition: "all 0.5s ease",
                }}>
                  {isDone ? <Check size={16} weight="bold" /> : <StepIcon size={16} weight={isActive ? "fill" : "regular"} />}
                </div>
                <span style={{
                  fontSize: "0.75rem", fontWeight: isActive ? 600 : 400,
                  color: isDone ? "#A09FA6" : isActive ? "#F2F0EB" : "#6B6A72",
                  transition: "color 0.5s ease",
                }}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* GIF — large, centered, fills panel width */}
        <Script src="https://tenor.com/embed.js" strategy="afterInteractive" />
        <div style={{ borderRadius: 4, overflow: "hidden", zIndex: 1, width: "100%", maxWidth: 600 }}>
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
        </div>
      </div>

      {error && (
        <div style={{ position: "absolute", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)", padding: "0.75rem 1.5rem", background: "#2D1B1B", borderRadius: 4, color: "#E8636F", fontSize: "0.85rem", border: "1px solid #4A2020", zIndex: 2 }}>
          {error}
        </div>
      )}
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
  progressTrack: {
    height: 4,
    borderRadius: 1,
    background: "rgba(255,255,255,0.08)",
    overflow: "hidden" as const,
  },
  progressFill: {
    height: "100%",
    borderRadius: 1,
    background: "linear-gradient(90deg, #E8A84C, #F0CC6B, #E8A84C)",
    backgroundSize: "200% 100%",
    animation: "shimmer 2s ease-in-out infinite",
    transition: "width 2s ease-out",
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
  secondaryButton: {
    display: "inline-block",
    padding: "0.85rem 2.5rem",
    background: "transparent",
    color: "#F2F0EB",
    fontWeight: 600,
    fontSize: "1rem",
    borderRadius: 4,
    border: "1px solid rgba(255,255,255,0.2)",
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

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatEta(snapshot: RunProgressSnapshot) {
  if (snapshot.status === "completed") return "Finished.";
  if (snapshot.estimatedRemainingSeconds === null) return "Estimating time remaining...";
  if (snapshot.estimatedRemainingConfidence === "low") return "Phase-timing estimate only. Timing is variable right now.";
  if (
    typeof snapshot.estimatedRemainingLowSeconds === "number" &&
    typeof snapshot.estimatedRemainingHighSeconds === "number" &&
    snapshot.estimatedRemainingHighSeconds > snapshot.estimatedRemainingLowSeconds
  ) {
    return `Estimated ${formatEtaRange(snapshot.estimatedRemainingLowSeconds, snapshot.estimatedRemainingHighSeconds)} left based on the current workflow phase.`;
  }
  return `Estimated ${formatTime(snapshot.estimatedRemainingSeconds)} left based on the current workflow phase.`;
}

function formatEtaRange(lowSeconds: number, highSeconds: number) {
  if (highSeconds < 60) {
    return `${lowSeconds}s-${highSeconds}s`;
  }
  const lowMinutes = Math.max(1, Math.round(lowSeconds / 60));
  const highMinutes = Math.max(lowMinutes, Math.round(highSeconds / 60));
  return `${lowMinutes}-${highMinutes} min`;
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
