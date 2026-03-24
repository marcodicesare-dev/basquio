"use client";

import { Check, File, MagnifyingGlass, PaintBrush, Package } from "@phosphor-icons/react";
import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

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
};

type Step = {
  stage: string;
  baseStage: string;
  attempt: number;
  status: "queued" | "running" | "completed" | "failed" | "needs_input";
  detail: string;
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
  toolCallCount?: number;
};

// ─── USER-FACING PHASE MAP ─────────────────────────────────────
const USER_STEPS = [
  { id: "read", label: "Reading your files", Icon: File },
  { id: "analyze", label: "Finding the story", Icon: MagnifyingGlass },
  { id: "design", label: "Designing the deck", Icon: PaintBrush },
  { id: "export", label: "Preparing downloads", Icon: Package },
] as const;

const PHASE_TO_USER_STEP: Record<string, number> = {
  normalize: 0,
  understand: 1,
  author: 2,
  render: 2,
  polish: 2,
  critique: 2,
  revise: 2,
  export: 3,
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
  // Monotonic progress: never goes backward
  const maxProgressRef = useRef(2);
  const isTerminal = snapshot?.status === "completed" || snapshot?.status === "failed" || snapshot?.status === "needs_input";

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

  // Monotonic progress — only goes up
  const rawPercent = snapshot.status === "completed" ? 100 : snapshot.progressPercent;
  if (rawPercent > maxProgressRef.current) maxProgressRef.current = rawPercent;
  const displayPercent = snapshot.status === "completed" ? 100 : maxProgressRef.current;

  // ─── COMPLETED STATE ─────────────────────────────────────────
  if (snapshot.status === "completed" && snapshot.artifactsReady) {
    const creditsCost = 3 + slideCount;
    const elapsedMin = Math.floor(snapshot.elapsedSeconds / 60);
    const elapsedSec = snapshot.elapsedSeconds % 60;

    return (
      <div style={styles.fullPage}>
        <div style={{ ...styles.center, maxWidth: 720 }}>
          <div style={{ marginBottom: "0.5rem" }}><Check size={40} weight="bold" color="#4CC9A0" /></div>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 700, color: "#F2F0EB", marginBottom: "0.25rem" }}>
            Your deck is ready
          </h1>
          <p style={{ color: "#A09FA6", fontSize: "0.95rem", marginBottom: "2rem" }}>
            {slideCount} slides · {creditsCost} credits · {elapsedMin}m {elapsedSec}s
          </p>

          {/* Inline PDF preview */}
          <div style={{
            width: "100%",
            borderRadius: 4,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            marginBottom: "1.5rem",
            background: "#1a1a24",
          }}>
            <object
              data={`/api/artifacts/${snapshot.jobId}/pdf#toolbar=0&navpanes=0`}
              type="application/pdf"
              style={{ width: "100%", height: 420, display: "block" }}
            >
              <p style={{ padding: "2rem", color: "#A09FA6", textAlign: "center", fontSize: "0.88rem" }}>
                PDF preview not available in this browser.{" "}
                <a href={`/api/artifacts/${snapshot.jobId}/pdf`} style={{ color: "#E8A84C" }}>Download instead</a>
              </p>
            </object>
          </div>

          {/* Download actions */}
          <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem" }}>
            <a href={`/api/artifacts/${snapshot.jobId}/pptx`} style={styles.primaryButton}>
              Download PPTX
            </a>
            <a href={`/api/artifacts/${snapshot.jobId}/pdf`} style={styles.secondaryButton}>
              Download PDF
            </a>
          </div>

          {/* Run details grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1px", background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden", width: "100%", marginBottom: "2rem" }}>
            <div style={{ padding: "16px", background: "#0D0C14", textAlign: "center" }}>
              <p style={{ color: "#A09FA6", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", marginBottom: 4 }}>SLIDES</p>
              <p style={{ color: "#F2F0EB", fontSize: "1.4rem", fontWeight: 700 }}>{slideCount}</p>
            </div>
            <div style={{ padding: "16px", background: "#0D0C14", textAlign: "center" }}>
              <p style={{ color: "#A09FA6", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", marginBottom: 4 }}>CREDITS USED</p>
              <p style={{ color: "#F2F0EB", fontSize: "1.4rem", fontWeight: 700 }}>{creditsCost}</p>
            </div>
            <div style={{ padding: "16px", background: "#0D0C14", textAlign: "center" }}>
              <p style={{ color: "#A09FA6", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", marginBottom: 4 }}>QA STATUS</p>
              <p style={{ color: "#4CC9A0", fontSize: "1.4rem", fontWeight: 700 }}>Passed</p>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", justifyContent: "center", marginBottom: creditBalance !== null && creditBalance <= 0 ? "2rem" : 0 }}>
            <Link href={`/jobs/new?from=${snapshot.jobId}`} style={{ color: "#E8A84C", fontSize: "0.92rem", fontWeight: 600 }}>
              Rerun with changes
            </Link>
            <Link href="/jobs/new" style={{ color: "#A09FA6", fontSize: "0.92rem" }}>
              New report
            </Link>
            <Link href="/dashboard" style={{ color: "#A09FA6", fontSize: "0.92rem" }}>
              Dashboard
            </Link>
          </div>

          {/* Save as recipe */}
          {!recipeSaved && !showSaveRecipe ? (
            <button
              type="button"
              onClick={() => setShowSaveRecipe(true)}
              style={{ background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, padding: "10px 20px", color: "#A09FA6", fontSize: "0.84rem", cursor: "pointer", width: "100%", marginBottom: "1rem" }}
            >
              Save as recipe — rerun this report type next month
            </button>
          ) : null}

          {showSaveRecipe && !recipeSaved ? (
            <div style={{ width: "100%", padding: "16px 20px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, marginBottom: "1rem" }}>
              <p style={{ color: "#F2F0EB", fontSize: "0.88rem", fontWeight: 600, marginBottom: 10 }}>Name this recipe</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={recipeName}
                  onChange={(e) => setRecipeName(e.target.value)}
                  placeholder="Monthly Pet Care Review"
                  style={{ flex: 1, padding: "8px 12px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, color: "#F2F0EB", fontSize: "0.88rem" }}
                />
                <button
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
                  style={{ padding: "8px 16px", background: "#E8A84C", color: "#0A090D", fontWeight: 700, fontSize: "0.84rem", borderRadius: 4, border: "none", cursor: "pointer", opacity: !recipeName.trim() || recipeSaving ? 0.5 : 1 }}
                >
                  {recipeSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : null}

          {recipeSaved ? (
            <div style={{ width: "100%", padding: "12px 20px", background: "rgba(76, 201, 160, 0.08)", border: "1px solid rgba(76, 201, 160, 0.2)", borderRadius: 4, textAlign: "center", marginBottom: "1rem" }}>
              <p style={{ color: "#4CC9A0", fontSize: "0.88rem", fontWeight: 600 }}>
                Recipe saved. Find it on your dashboard to rerun next month.
              </p>
            </div>
          ) : null}

          {/* Upgrade prompt when credits are exhausted */}
          {creditBalance !== null && creditBalance <= 0 ? (
            <div style={{
              width: "100%",
              padding: "20px 24px",
              background: "rgba(232, 168, 76, 0.08)",
              border: "1px solid rgba(232, 168, 76, 0.2)",
              borderRadius: 4,
              textAlign: "center",
            }}>
              <p style={{ color: "#F2F0EB", fontSize: "0.95rem", fontWeight: 600, marginBottom: 4 }}>
                You used all your free credits
              </p>
              <p style={{ color: "#A09FA6", fontSize: "0.84rem", marginBottom: 16 }}>
                Buy a credit pack to generate your next deck. 25 credits for $15.
              </p>
              <Link href="/pricing" style={{
                display: "inline-block",
                padding: "10px 24px",
                background: "#E8A84C",
                color: "#0A090D",
                fontWeight: 700,
                fontSize: "0.88rem",
                borderRadius: 4,
                textDecoration: "none",
              }}>
                Buy credits
              </Link>
            </div>
          ) : null}
        </div>
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
    return (
      <div style={styles.fullPage}>
        <div style={styles.center}>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#F2F0EB", marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#A09FA6", fontSize: "1.05rem", maxWidth: 480, marginBottom: "1.5rem" }}>
            We hit an issue generating your deck. Try again — it won&apos;t cost extra.
          </p>
          {snapshot.failureMessage && (
            <p style={{ fontSize: "0.8rem", color: "#6B6A72", fontFamily: "monospace", maxWidth: 500, wordBreak: "break-word", marginBottom: "1.5rem" }}>
              {snapshot.failureMessage}
            </p>
          )}
          <Link href="/jobs/new" style={styles.primaryButton}>Try again</Link>
        </div>
      </div>
    );
  }

  // ─── IN-PROGRESS STATE ───────────────────────────────────────
  const elapsed = snapshot.elapsedSeconds;

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
          {USER_STEPS[currentUserStepIdx]?.label ?? "Working..."}
        </p>

        {/* Progress bar — full width, smooth, never goes backward */}
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
  } as React.CSSProperties,
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
  } as React.CSSProperties,
} as const;

// ─── HELPERS ───────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
