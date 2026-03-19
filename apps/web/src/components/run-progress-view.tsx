"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useState } from "react";

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
// Internal pipeline has 6 phases. User sees 4 simple steps.
// No jargon. No "normalize". No "critique". No "revise".
const USER_STEPS = [
  { id: "read", label: "Reading your files", phases: ["normalize"] },
  { id: "analyze", label: "Finding the story", phases: ["understand"] },
  { id: "design", label: "Designing the deck", phases: ["author", "critique", "revise"] },
  { id: "export", label: "Preparing downloads", phases: ["export"] },
] as const;

function getUserStep(internalPhase: string): typeof USER_STEPS[number] {
  return USER_STEPS.find((s) => (s.phases as readonly string[]).includes(internalPhase)) ?? USER_STEPS[0];
}

function getUserStepIndex(internalPhase: string): number {
  return USER_STEPS.findIndex((s) => (s.phases as readonly string[]).includes(internalPhase));
}

// ─── COMPONENT ─────────────────────────────────────────────────

export function RunProgressView(input: {
  jobId: string;
  initialSnapshot: RunProgressSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState<RunProgressSnapshot | null>(input.initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [missingPollCount, setMissingPollCount] = useState(0);
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
      <section className="page-shell">
        <article className="panel empty-state" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ fontSize: "1.1rem" }}>
            {missingPollCount > 6
              ? "This is taking longer than expected. Try refreshing the page."
              : "Starting up..."}
          </p>
        </article>
      </section>
    );
  }

  const slideCount = snapshot.summary?.slideCount ?? snapshot.summary?.slidePlan?.slides?.length ?? 0;
  const currentUserStep = getUserStep(snapshot.currentStage);
  const currentUserStepIdx = getUserStepIndex(snapshot.currentStage);

  // ─── COMPLETED STATE ─────────────────────────────────────────
  if (snapshot.status === "completed" && snapshot.artifactsReady) {
    return (
      <div className="page-shell">
        <section className="page-hero loading-hero">
          <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
            <div className="stack" style={{ alignItems: "center", gap: "1rem" }}>
              <div style={{ fontSize: "3rem" }}>&#10003;</div>
              <h1 style={{ fontSize: "2rem" }}>Your deck is ready</h1>
              <p className="muted" style={{ fontSize: "1.1rem", maxWidth: 480 }}>
                {slideCount} slides generated from your data. Download below.
              </p>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "2rem" }}>
              <a
                className="button"
                href={`/api/artifacts/${snapshot.jobId}/pptx`}
                style={{ fontSize: "1rem", padding: "0.75rem 2rem" }}
              >
                Download PPTX
              </a>
              <a
                className="button secondary"
                href={`/api/artifacts/${snapshot.jobId}/pdf`}
                style={{ fontSize: "1rem", padding: "0.75rem 2rem", border: "1px solid #E2E8F0", color: "#334155" }}
              >
                Download PDF
              </a>
            </div>

            <div style={{ marginTop: "2rem" }}>
              <Link href="/jobs/new" style={{ color: "#2563EB", fontSize: "0.9rem" }}>
                Generate another report
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ─── FAILED STATE ────────────────────────────────────────────
  if (snapshot.status === "failed") {
    return (
      <div className="page-shell">
        <section className="page-hero loading-hero">
          <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
            <div className="stack" style={{ alignItems: "center", gap: "1rem" }}>
              <h1 style={{ fontSize: "2rem" }}>Something went wrong</h1>
              <p className="muted" style={{ fontSize: "1.1rem", maxWidth: 480 }}>
                We hit an issue while generating your deck. You can try again — it won&apos;t cost you extra.
              </p>
              {snapshot.failureMessage && (
                <p style={{ fontSize: "0.85rem", color: "#94A3B8", fontFamily: "monospace", maxWidth: 500, wordBreak: "break-word" }}>
                  {snapshot.failureMessage}
                </p>
              )}
            </div>
            <div style={{ marginTop: "2rem" }}>
              <Link className="button" href="/jobs/new">Try again</Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ─── IN-PROGRESS STATE ───────────────────────────────────────
  const elapsed = snapshot.elapsedSeconds;
  const remaining = snapshot.estimatedRemainingSeconds;

  return (
    <div className="page-shell">
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .progress-bar-fill {
          transition: width 1.5s ease-out;
          background: linear-gradient(90deg, #2563EB, #60A5FA, #2563EB);
          background-size: 200% 100%;
          animation: shimmer 2s ease-in-out infinite;
        }
        .step-dot {
          width: 32px; height: 32px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.8rem; font-weight: 700; flex-shrink: 0;
        }
        .step-dot.done { background: #2563EB; color: white; }
        .step-dot.active { background: #2563EB; color: white; animation: pulse 1.5s ease-in-out infinite; }
        .step-dot.waiting { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.4); }
        .step-label { font-size: 0.95rem; }
        .step-label.active { color: #FFFFFF; font-weight: 600; }
        .step-label.done { color: rgba(255,255,255,0.6); }
        .step-label.waiting { color: rgba(255,255,255,0.35); }
      `}</style>
      <Script src="https://tenor.com/embed.js" strategy="afterInteractive" />

      <section className="page-hero loading-hero">
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {/* Header */}
          <div className="stack" style={{ textAlign: "center", marginBottom: "2rem" }}>
            <h1 style={{ fontSize: "1.8rem", color: "#FFFFFF" }}>Building your deck</h1>
            <p style={{ fontSize: "1.05rem", color: "rgba(255,255,255,0.6)" }}>
              {currentUserStep.label}...
            </p>
          </div>

          {/* Progress bar */}
          <div style={{ marginBottom: "2rem" }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginBottom: "0.5rem", fontSize: "0.85rem", color: "rgba(255,255,255,0.5)",
            }}>
              <span>{remaining != null && remaining > 0 ? `About ${formatTime(remaining)} left` : elapsed < 10 ? "Starting..." : "Almost there..."}</span>
              <span>{snapshot.progressPercent}%</span>
            </div>
            <div style={{
              height: 6, borderRadius: 3, background: "rgba(255,255,255,0.15)", overflow: "hidden",
            }}>
              <div
                className="progress-bar-fill"
                style={{ height: "100%", borderRadius: 3, width: `${snapshot.progressPercent}%` }}
              />
            </div>
          </div>

          {/* Steps */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2rem" }}>
            {USER_STEPS.map((step, idx) => {
              const isDone = idx < currentUserStepIdx || snapshot.status === "completed";
              const isActive = idx === currentUserStepIdx && snapshot.status === "running";
              const dotClass = isDone ? "done" : isActive ? "active" : "waiting";
              const labelClass = isDone ? "done" : isActive ? "active" : "waiting";

              return (
                <div key={step.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div className={`step-dot ${dotClass}`}>
                    {isDone ? "\u2713" : idx + 1}
                  </div>
                  <span className={`step-label ${labelClass}`}>{step.label}</span>
                </div>
              );
            })}
          </div>

          {/* GIF */}
          <div style={{ borderRadius: 12, overflow: "hidden", marginBottom: "1.5rem" }}>
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

          {/* Elapsed time — small, unobtrusive */}
          <p style={{ textAlign: "center", fontSize: "0.8rem", color: "rgba(255,255,255,0.35)" }}>
            {formatTime(elapsed)} elapsed
          </p>
        </div>
      </section>

      {error && (
        <div style={{ maxWidth: 640, margin: "1rem auto", padding: "1rem", background: "#FEF2F2", borderRadius: 8, color: "#991B1B", fontSize: "0.9rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─── HELPERS ───────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
