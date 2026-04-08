"use client";

import { BASQUIO_PHASES } from "@basquio/core";
import { Check } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";

import { DEFAULT_AUTHOR_MODEL, calculateRunCredits, estimateRunMinutes } from "@/lib/credits";
import { clearRunLaunchDraft, readRunLaunchDraft, type RunLaunchDraft } from "@/lib/run-launch-draft";
import { buildPhaseProgressModel, estimateRemainingSecondsForPhase } from "@/lib/run-progress";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

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

type DeckRunRealtimeRow = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "needs_input";
  author_model: string | null;
  current_phase: string | null;
  phase_started_at: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  latest_attempt_number: number | null;
  notify_on_complete: boolean | null;
};

const V2_PHASES = BASQUIO_PHASES;
const WORKER_STALE_RUN_SECONDS = 8 * 60;
const STALE_RUN_UI_SECONDS = Math.min(180, WORKER_STALE_RUN_SECONDS);
const PHASE_ESTIMATES: Record<string, { label: string; activeDetail: string; completedDetail: string }> = {
  normalize: {
    label: "Reading your files",
    activeDetail: "Indexing files and finding the usable evidence.",
    completedDetail: "Files indexed.",
  },
  understand: {
    label: "Finding the story",
    activeDetail: "Inspecting the data and working out the commercial angle.",
    completedDetail: "Storyline approved.",
  },
  author: {
    label: "Designing the deck",
    activeDetail: "Writing the first full draft and building the charts.",
    completedDetail: "First draft generated.",
  },
  render: {
    label: "Designing the deck",
    activeDetail: "Collecting the generated deck artifacts.",
    completedDetail: "Artifacts collected.",
  },
  critique: {
    label: "Reviewing and polishing",
    activeDetail: "Draft complete. Running visual review.",
    completedDetail: "Rendered pages reviewed.",
  },
  revise: {
    label: "Reviewing and polishing",
    activeDetail: "Repairing weak slides, chart fit, and formatting problems.",
    completedDetail: "Deck repaired.",
  },
  export: {
    label: "Exporting",
    activeDetail: "Deck repaired. Final export checks in progress.",
    completedDetail: "Downloads published.",
  },
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
  const router = useRouter();
  const initialLaunchDraft = readRunLaunchDraft(input.jobId);
  const [snapshot, setSnapshot] = useState<RunProgressSnapshot | null>(input.initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [hasLaunchDraft, setHasLaunchDraft] = useState(() => Boolean(initialLaunchDraft));
  const [missingPollCount, setMissingPollCount] = useState(0);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [showSaveRecipe, setShowSaveRecipe] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [recipeSaved, setRecipeSaved] = useState(false);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [showCompletionToast, setShowCompletionToast] = useState(false);
  const [elapsedTickMs, setElapsedTickMs] = useState(() => Date.now());
  const prevStatusRef = useRef<string | null>(null);
  const snapshotRef = useRef<RunProgressSnapshot | null>(input.initialSnapshot);
  const isTerminalRef = useRef(false);
  const realtimeSubscribedRef = useRef(false);
  const terminalHydrationRef = useRef(false);
  const launchStartedRef = useRef(false);
  const isTerminal = snapshot?.status === "completed" || snapshot?.status === "failed" || snapshot?.status === "needs_input";

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    isTerminalRef.current = isTerminal;
  }, [isTerminal]);

  useEffect(() => {
    if (!snapshot || isTerminal) {
      return;
    }

    const interval = window.setInterval(() => {
      setElapsedTickMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isTerminal, snapshot]);

  useEffect(() => {
    if (input.initialSnapshot || snapshotRef.current) {
      return;
    }

    const launchDraft = initialLaunchDraft ?? readRunLaunchDraft(input.jobId);
    if (!launchDraft) {
      return;
    }

    setSnapshot(buildPendingLaunchSnapshot(launchDraft));
  }, [initialLaunchDraft, input.initialSnapshot, input.jobId]);

  useEffect(() => {
    const launchDraft = initialLaunchDraft ?? readRunLaunchDraft(input.jobId);

    if (!launchDraft || launchStartedRef.current) {
      return;
    }

    launchStartedRef.current = true;
    let active = true;

    void (async () => {
      let shouldClearDraft = false;
      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jobId: launchDraft.runId,
            sourceFiles: launchDraft.sourceFiles,
            existingSourceFileIds: launchDraft.existingSourceFileIds,
            templateProfileId: launchDraft.templateProfileId ?? undefined,
            targetSlideCount: launchDraft.targetSlideCount,
            authorModel: launchDraft.authorModel,
            recipeId: launchDraft.recipeId ?? undefined,
            brief: launchDraft.brief,
            businessContext: launchDraft.brief.businessContext,
            client: launchDraft.brief.client,
            audience: launchDraft.brief.audience,
            objective: launchDraft.brief.objective,
            thesis: launchDraft.brief.thesis,
            stakes: launchDraft.brief.stakes,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string; pricingUrl?: string };
        if (!active) {
          return;
        }
        if (response.status === 402) {
          shouldClearDraft = true;
          clearRunLaunchDraft(input.jobId);
          setHasLaunchDraft(false);
          router.replace(payload.pricingUrl ?? "/pricing");
          return;
        }
        if (!response.ok) {
          shouldClearDraft = response.status >= 400 && response.status < 500;
          throw new Error(payload.error ?? "Generation failed.");
        }

        clearRunLaunchDraft(input.jobId);
        setHasLaunchDraft(false);
        setLaunchError(null);
      } catch (launchFailure) {
        if (!active) {
          return;
        }

        if (shouldClearDraft) {
          clearRunLaunchDraft(input.jobId);
          setHasLaunchDraft(false);
        }
        setLaunchError(launchFailure instanceof Error ? launchFailure.message : "Unable to start the run.");
      }
    })();

    return () => {
      active = false;
    };
  }, [initialLaunchDraft, input.jobId, router]);

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

  // Initial snapshot + realtime subscription
  useEffect(() => {
    let active = true;
    let fallbackTimeout: number | null = null;
    const supabase = getSupabaseBrowserClient();

    const clearFallbackPolling = () => {
      if (fallbackTimeout !== null) {
        window.clearTimeout(fallbackTimeout);
        fallbackTimeout = null;
      }
    };

    const fetchSnapshot = async () => {
      try {
        const response = await fetch(`/api/jobs/${input.jobId}`, { cache: "no-store" });
        const payload = (await response.json()) as RunProgressSnapshot & { error?: string };
        if (!active) return;
        if (!response.ok) {
          if (response.status === 404 && !snapshotRef.current) {
            setMissingPollCount((c) => c + 1);
            setError(null);
            startFallbackPolling();
            return;
          }
          throw new Error(payload.error ?? "Something went wrong.");
        }
        setSnapshot(payload);
        setMissingPollCount(0);
        setError(null);
        terminalHydrationRef.current = payload.status === "completed" || payload.status === "failed" || payload.status === "needs_input";
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Something went wrong.");
        startFallbackPolling();
      }
    };

    const startFallbackPolling = () => {
      if (fallbackTimeout !== null || isTerminalRef.current) {
        return;
      }

      const schedulePoll = () => {
        if (!active) {
          return;
        }
        const elapsedSeconds = snapshotRef.current?.elapsedSeconds ?? 0;
        fallbackTimeout = window.setTimeout(() => {
          void fetchSnapshot();
          clearFallbackPolling();
          if (
            !terminalHydrationRef.current &&
            !isTerminalRef.current &&
            (!realtimeSubscribedRef.current || !snapshotRef.current)
          ) {
            schedulePoll();
          }
        }, elapsedSeconds >= 120 ? 10_000 : 2_500);
      };

      schedulePoll();
    };

    const handleRealtimeUpdate = (row: DeckRunRealtimeRow) => {
      const nextStatus = row.status === "queued" && (row.latest_attempt_number ?? 1) > 1 ? "running" : row.status;
      if (nextStatus === "completed" || nextStatus === "failed" || nextStatus === "needs_input" || row.completed_at) {
        if (!terminalHydrationRef.current) {
          terminalHydrationRef.current = true;
          void fetchSnapshot();
        }
        return;
      }

      setSnapshot((current) => applyRealtimeRunUpdate(current, row));
      setError(null);
      clearFallbackPolling();
    };

    void fetchSnapshot();

    if (!supabase) {
      startFallbackPolling();
      return () => {
        active = false;
        clearFallbackPolling();
      };
    }

    const channel = supabase
      .channel(`run-${input.jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "deck_runs",
          filter: `id=eq.${input.jobId}`,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = parseRealtimeRunRow(payload.new);
          if (!row || !active) {
            return;
          }
          handleRealtimeUpdate(row);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "deck_runs",
          filter: `id=eq.${input.jobId}`,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = parseRealtimeRunRow(payload.new);
          if (!row || !active) {
            return;
          }
          handleRealtimeUpdate(row);
        },
      )
      .subscribe((status) => {
        if (!active) {
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeSubscribedRef.current = false;
          startFallbackPolling();
        } else if (status === "SUBSCRIBED") {
          realtimeSubscribedRef.current = true;
          if (snapshotRef.current) {
            clearFallbackPolling();
          }
        }
      });

    return () => {
      active = false;
      realtimeSubscribedRef.current = false;
      clearFallbackPolling();
      void supabase.removeChannel(channel);
    };
  }, [input.jobId]);

  // ─── WAITING STATE ───────────────────────────────────────────
  if (!snapshot) {
    const showMissingRunState = missingPollCount > 6 && !hasLaunchDraft && !launchError;
    return (
      <div style={styles.fullPage}>
        <div style={styles.center}>
          <div style={styles.spinner} />
          <p style={{ color: "#A09FA6", fontSize: "1.1rem", marginTop: "1.5rem" }}>
            {launchError
              ? "We couldn't start this run."
              : showMissingRunState
              ? "This run was not found."
              : "Starting up..."}
          </p>
          {launchError ? (
            <p style={{ color: "#F4B4B4", fontSize: "0.95rem", marginTop: "0.85rem", maxWidth: 420, textAlign: "center" }}>
              {launchError}
            </p>
          ) : null}
          {showMissingRunState ? (
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
              <Link href="/artifacts" style={styles.leaveRunButton}>
                See reports
              </Link>
              <Link href="/jobs/new" style={styles.leaveRunButton}>
                New report
              </Link>
            </div>
          ) : null}
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
  const elapsedLabel = formatElapsedLabel(getDisplayedElapsedSeconds(snapshot, elapsedTickMs));
  const estimatedSlideCount = initialLaunchDraft?.targetSlideCount ?? 10;
  const estimatedMinutes = estimateRunMinutes(estimatedSlideCount, snapshot.authorModel ?? DEFAULT_AUTHOR_MODEL);
  const leaveRunCopy = snapshot.notifyOnComplete !== false
    ? "This runs in the background. Close this page and we'll email you when it's ready."
    : "This runs in the background. Close this page and come back from Reports or Dashboard later.";
  const progressStatusMessage = launchError
    ? launchError
    : error
      ? "Progress updates paused. Retrying automatically."
      : null;

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
              src="/brand/svg/icon/basquio-icon-ultramarine.svg"
              alt=""
              width={72}
              height={72}
              className="run-status-logo-image"
              priority
            />
          </div>
        </div>

        <h1 className="run-status-title">{title}</h1>
        <p className="run-status-elapsed">
          {elapsedLabel}
          <span className="run-status-estimate"> · ~{estimatedMinutes} min total</span>
        </p>

        <div style={styles.leaveRunCard}>
          <p style={styles.leaveRunTitle}>Need to step away?</p>
          <p style={styles.leaveRunCopy}>{leaveRunCopy}</p>
          {progressStatusMessage ? (
            <p style={styles.leaveRunError}>{progressStatusMessage}</p>
          ) : null}
          <div style={styles.leaveRunActions}>
            <Link href="/artifacts" style={styles.leaveRunButton}>
              See reports
            </Link>
            <Link href="/dashboard" style={styles.leaveRunButton}>
              Dashboard
            </Link>
            <Link href="/" style={styles.leaveRunButton}>
              Website
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
  leaveRunTitle: {
    margin: 0,
    color: "#F2F0EB",
    fontSize: "1rem",
    fontWeight: 600,
    letterSpacing: "-0.02em",
  } as CSSProperties,
  leaveRunCopy: {
    margin: "0.55rem 0 0",
    color: "#A09FA6",
    fontSize: "0.9rem",
    lineHeight: 1.5,
  } as CSSProperties,
  leaveRunError: {
    margin: "0.55rem 0 0",
    color: "#F2F0EB",
    fontSize: "0.86rem",
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

function formatElapsedLabel(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    const remainingMinutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}:${String(remainingMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} elapsed`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")} elapsed`;
}

function getDisplayedElapsedSeconds(snapshot: RunProgressSnapshot, nowMs: number) {
  if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "needs_input") {
    return snapshot.elapsedSeconds;
  }

  const createdAtMs = new Date(snapshot.createdAt).getTime();
  if (Number.isNaN(createdAtMs)) {
    return snapshot.elapsedSeconds;
  }

  return Math.max(snapshot.elapsedSeconds, Math.max(1, Math.round((nowMs - createdAtMs) / 1000)));
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

function buildPendingLaunchSnapshot(draft: RunLaunchDraft): RunProgressSnapshot {
  return {
    jobId: draft.runId,
    authorModel: draft.authorModel,
    attemptNumber: 1,
    pipelineVersion: "v2",
    status: "queued",
    artifactsReady: false,
    createdAt: draft.createdAt,
    updatedAt: draft.createdAt,
    currentStage: "queued",
    currentStageLabel: "Starting your run",
    currentDetail: "Uploading files and reserving the worker.",
    progressPercent: 2,
    elapsedSeconds: 1,
    estimatedRemainingSeconds: null,
    estimatedRemainingLowSeconds: null,
    estimatedRemainingHighSeconds: null,
    estimatedRemainingConfidence: "low",
    steps: [],
    summary: null,
    notifyOnComplete: true,
  };
}

function parseRealtimeRunRow(value: Record<string, unknown>): DeckRunRealtimeRow | null {
  if (typeof value.id !== "string" || typeof value.status !== "string" || typeof value.created_at !== "string") {
    return null;
  }

  if (!["queued", "running", "completed", "failed", "needs_input"].includes(value.status)) {
    return null;
  }

  return {
    id: value.id,
    status: value.status as DeckRunRealtimeRow["status"],
    author_model: typeof value.author_model === "string" ? value.author_model : null,
    current_phase: typeof value.current_phase === "string" ? value.current_phase : null,
    phase_started_at: typeof value.phase_started_at === "string" ? value.phase_started_at : null,
    failure_message: typeof value.failure_message === "string" ? value.failure_message : null,
    created_at: value.created_at,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
    completed_at: typeof value.completed_at === "string" ? value.completed_at : null,
    latest_attempt_number: typeof value.latest_attempt_number === "number" ? value.latest_attempt_number : null,
    notify_on_complete: typeof value.notify_on_complete === "boolean" ? value.notify_on_complete : null,
  };
}

function applyRealtimeRunUpdate(
  current: RunProgressSnapshot | null,
  row: DeckRunRealtimeRow,
): RunProgressSnapshot {
  const now = Date.now();
  const nextStatus = row.status === "queued" && (row.latest_attempt_number ?? 1) > 1 ? "running" : row.status;
  const previousStage = current?.currentStage ?? null;
  const currentPhase = row.current_phase ?? previousStage ?? V2_PHASES[0];
  const completedPhases = new Set(
    current?.steps
      ?.filter((step) => step.status === "completed")
      .map((step) => step.stage) ?? [],
  );

  if (previousStage && previousStage !== currentPhase && current?.status === "running") {
    completedPhases.add(previousStage);
  }

  const createdAtMs = new Date(row.created_at).getTime();
  const updatedAtMs = row.updated_at ? new Date(row.updated_at).getTime() : createdAtMs;
  const completedAtMs = row.completed_at ? new Date(row.completed_at).getTime() : null;
  const elapsedToMs = nextStatus === "completed" && completedAtMs ? completedAtMs : now;
  const elapsedSeconds = Math.max(1, Math.round((elapsedToMs - createdAtMs) / 1000));
  const heartbeatLate = nextStatus === "running" && now - updatedAtMs > STALE_RUN_UI_SECONDS * 1000;
  const recoveryEligibleStale = nextStatus === "running" && now - updatedAtMs > WORKER_STALE_RUN_SECONDS * 1000;
  const progressClockMs = heartbeatLate ? updatedAtMs : now;
  const progressModel = buildPhaseProgressModel({
    phases: V2_PHASES,
    currentPhase,
    completedPhases,
    phaseStartedAt: row.phase_started_at,
    nowMs: progressClockMs,
  });
  const estimatedRemaining = estimateRemainingSecondsForPhase({
    phases: V2_PHASES,
    currentPhase,
    completedPhases,
    elapsedInPhaseSeconds: progressModel.elapsedInPhaseSeconds,
  });
  const phaseMeta = PHASE_ESTIMATES[currentPhase] ?? PHASE_ESTIMATES.normalize;
  const progressPercent = nextStatus === "completed"
    ? 100
    : nextStatus === "failed" || nextStatus === "needs_input"
      ? Math.max(2, Math.round((completedPhases.size / V2_PHASES.length) * 100))
      : Math.max(2, Math.min(96, Math.round(progressModel.progressPercent)));

  return {
    ...(current ?? {
      jobId: row.id,
      artifactsReady: false,
      status: nextStatus,
      createdAt: row.created_at,
      currentStage: currentPhase,
      currentDetail: phaseMeta.activeDetail,
      progressPercent,
      elapsedSeconds,
      estimatedRemainingSeconds: estimatedRemaining.midpointSeconds,
      steps: [],
      summary: null,
    }),
    jobId: row.id,
    authorModel: row.author_model ?? current?.authorModel,
    attemptNumber: row.latest_attempt_number ?? current?.attemptNumber,
    status: nextStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? current?.updatedAt,
    currentStage: currentPhase,
    currentStageLabel: phaseMeta.label,
    currentDetail: nextStatus === "failed" || nextStatus === "needs_input"
      ? row.failure_message ?? current?.failureMessage ?? "Run failed."
      : nextStatus === "completed"
        ? "Generation finished. Checking artifact availability."
        : phaseMeta.activeDetail,
    progressPercent,
    elapsedSeconds,
    estimatedRemainingSeconds: nextStatus === "completed" || nextStatus === "failed" || nextStatus === "needs_input"
      ? 0
      : estimatedRemaining.midpointSeconds,
    estimatedRemainingLowSeconds: nextStatus === "completed" || nextStatus === "failed" || nextStatus === "needs_input"
      ? 0
      : estimatedRemaining.lowSeconds,
    estimatedRemainingHighSeconds: nextStatus === "completed" || nextStatus === "failed" || nextStatus === "needs_input"
      ? 0
      : estimatedRemaining.highSeconds,
    estimatedRemainingConfidence: nextStatus === "completed" || nextStatus === "failed" || nextStatus === "needs_input"
      ? "high"
      : estimatedRemaining.confidence,
    steps: V2_PHASES.map((phase) => {
      const completed = completedPhases.has(phase);
      const stepStatus: Step["status"] = completed
        ? "completed"
        : phase === currentPhase
          ? nextStatus === "needs_input"
            ? "needs_input"
            : nextStatus === "failed"
              ? "failed"
              : "running"
          : "queued";
      const stepMeta = PHASE_ESTIMATES[phase] ?? PHASE_ESTIMATES.normalize;
      return {
        stage: phase,
        baseStage: phase,
        attempt: row.latest_attempt_number ?? current?.attemptNumber ?? 1,
        status: stepStatus,
        detail: stepStatus === "completed"
          ? stepMeta.completedDetail
          : stepStatus === "running"
            ? stepMeta.activeDetail
            : "",
      };
    }),
    notifyOnComplete: row.notify_on_complete ?? current?.notifyOnComplete,
    failureMessage: row.failure_message ?? current?.failureMessage,
    runHealth: recoveryEligibleStale ? "stale" : heartbeatLate ? "late_heartbeat" : "healthy",
  };
}
