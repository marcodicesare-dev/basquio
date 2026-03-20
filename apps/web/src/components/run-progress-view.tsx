"use client";

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
  { id: "read", label: "Reading your files", icon: "📄" },
  { id: "analyze", label: "Finding the story", icon: "🔍" },
  { id: "design", label: "Designing the deck", icon: "✨" },
  { id: "export", label: "Preparing downloads", icon: "📦" },
] as const;

const PHASE_TO_USER_STEP: Record<string, number> = {
  normalize: 0,
  understand: 1,
  author: 2,
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
  // Monotonic progress: never goes backward
  const maxProgressRef = useRef(2);
  const isTerminal = snapshot?.status === "completed" || snapshot?.status === "failed" || snapshot?.status === "needs_input";

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
    return (
      <div style={styles.fullPage}>
        <div style={styles.center}>
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>✓</div>
          <h1 style={{ fontSize: "2.2rem", fontWeight: 700, color: "#F2F0EB", marginBottom: "0.5rem" }}>
            Your deck is ready
          </h1>
          <p style={{ color: "#A09FA6", fontSize: "1.1rem", marginBottom: "2.5rem" }}>
            {slideCount} slides generated from your data.
          </p>

          <div style={{ display: "flex", gap: "1rem" }}>
            <a href={`/api/artifacts/${snapshot.jobId}/pptx`} style={styles.primaryButton}>
              Download PPTX
            </a>
            <a href={`/api/artifacts/${snapshot.jobId}/pdf`} style={styles.secondaryButton}>
              Download PDF
            </a>
          </div>

          <Link href="/jobs/new" style={{ color: "#E8A84C", fontSize: "0.95rem", marginTop: "2rem", display: "block" }}>
            Generate another deck →
          </Link>
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
            return (
              <div key={step.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "1rem",
                  background: isDone ? "#E8A84C" : isActive ? "rgba(232,168,76,0.2)" : "rgba(255,255,255,0.08)",
                  color: isDone ? "#0A090D" : isActive ? "#E8A84C" : "#6B6A72",
                  border: isActive ? "2px solid #E8A84C" : "2px solid transparent",
                  animation: isActive ? "breathe 2s ease-in-out infinite" : undefined,
                  transition: "all 0.5s ease",
                }}>
                  {isDone ? "✓" : step.icon}
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

        {/* GIF — large, centered */}
        <Script src="https://tenor.com/embed.js" strategy="afterInteractive" />
        <div style={{ borderRadius: 4, overflow: "hidden", zIndex: 1, width: "100%", maxWidth: 520 }}>
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
        <div style={{ position: "fixed", bottom: "2rem", left: "50%", transform: "translateX(-50%)", padding: "0.75rem 1.5rem", background: "#2D1B1B", borderRadius: 4, color: "#E8636F", fontSize: "0.85rem", border: "1px solid #4A2020" }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────

const styles = {
  fullPage: {
    position: "fixed" as const,
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0A090D",
    overflow: "hidden",
    zIndex: 50,
  },
  center: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    textAlign: "center" as const,
    padding: "2rem",
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
