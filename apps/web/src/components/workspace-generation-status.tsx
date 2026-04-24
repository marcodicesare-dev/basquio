"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowSquareOut,
  CheckCircle,
  FileArrowDown,
  Presentation,
  Sparkle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

export type ActiveGeneration = {
  runId: string;
  progressUrl: string;
  title: string;
  startedAt: number;
};

type RunStatus = {
  status: string;
  phase?: string | null;
  pptxUrl?: string | null;
  pdfUrl?: string | null;
  narrativeUrl?: string | null;
  error?: string | null;
};

/**
 * Sticky pill that sits just above the chat composer while a generation runs.
 * Polls /api/v2/runs/[runId] every 5 seconds. When status transitions to
 * "ready" or "delivered", renders the "Deck ready" card with download links
 * for ~15s before auto-dismissing. On "failed" shows the error inline.
 */
export function WorkspaceGenerationStatus({
  active,
  onDismiss,
}: {
  active: ActiveGeneration;
  onDismiss: (runId: string) => void;
}) {
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/v2/runs/${active.runId}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          status?: string;
          phase?: string | null;
          artifacts?: {
            pptx_url?: string;
            pdf_url?: string;
            narrative_url?: string;
          };
          error?: string | null;
        };
        if (cancelled) return;
        setRunStatus({
          status: data.status ?? "queued",
          phase: data.phase ?? null,
          pptxUrl: data.artifacts?.pptx_url ?? null,
          pdfUrl: data.artifacts?.pdf_url ?? null,
          narrativeUrl: data.artifacts?.narrative_url ?? null,
          error: data.error ?? null,
        });
      } catch {
        // Ignore transient network errors; keep showing the last known state.
      }
    }
    poll();
    intervalRef.current = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, [active.runId]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - active.startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [active.startedAt]);

  const isReady = runStatus?.status === "ready" || runStatus?.status === "delivered";
  const isFailed = runStatus?.status === "failed";

  const elapsedLabel = useMemo(() => {
    if (elapsed < 60) return `${elapsed}s`;
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    return `${m}m ${s}s`;
  }, [elapsed]);

  if (isReady) {
    return (
      <div className="wbeta-genstatus wbeta-genstatus-ready" role="status" aria-live="polite">
        <div className="wbeta-genstatus-icon">
          <CheckCircle size={16} weight="fill" />
        </div>
        <div className="wbeta-genstatus-body">
          <p className="wbeta-genstatus-title">Deck ready: {active.title}</p>
          <div className="wbeta-genstatus-links">
            <Link href={active.progressUrl} className="wbeta-genstatus-link-primary">
              <Presentation size={11} weight="regular" /> Open run
              <ArrowSquareOut size={10} weight="regular" />
            </Link>
            {runStatus?.pptxUrl ? (
              <a href={runStatus.pptxUrl} className="wbeta-genstatus-link" target="_blank" rel="noreferrer">
                <FileArrowDown size={11} weight="regular" /> PPTX
              </a>
            ) : null}
            {runStatus?.pdfUrl ? (
              <a href={runStatus.pdfUrl} className="wbeta-genstatus-link" target="_blank" rel="noreferrer">
                <FileArrowDown size={11} weight="regular" /> PDF
              </a>
            ) : null}
            {runStatus?.narrativeUrl ? (
              <a
                href={runStatus.narrativeUrl}
                className="wbeta-genstatus-link"
                target="_blank"
                rel="noreferrer"
              >
                <FileArrowDown size={11} weight="regular" /> Narrative
              </a>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="wbeta-genstatus-close"
          onClick={() => onDismiss(active.runId)}
          aria-label="Dismiss"
        >
          <X size={12} weight="bold" />
        </button>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div className="wbeta-genstatus wbeta-genstatus-failed" role="alert">
        <div className="wbeta-genstatus-icon">
          <WarningCircle size={16} weight="fill" />
        </div>
        <div className="wbeta-genstatus-body">
          <p className="wbeta-genstatus-title">Generation failed: {active.title}</p>
          <p className="wbeta-genstatus-sub">
            {runStatus?.error ?? "Something went wrong."}{" "}
            <Link href={active.progressUrl} className="wbeta-genstatus-inline-link">
              Open run
            </Link>
          </p>
        </div>
        <button
          type="button"
          className="wbeta-genstatus-close"
          onClick={() => onDismiss(active.runId)}
          aria-label="Dismiss"
        >
          <X size={12} weight="bold" />
        </button>
      </div>
    );
  }

  return (
    <div className="wbeta-genstatus" role="status" aria-live="polite">
      <div className="wbeta-genstatus-icon wbeta-genstatus-icon-pulse">
        <Sparkle size={14} weight="fill" />
      </div>
      <div className="wbeta-genstatus-body">
        <p className="wbeta-genstatus-title">Generating: {active.title}</p>
        <p className="wbeta-genstatus-sub">
          {runStatus?.phase ?? runStatus?.status ?? "queued"} · {elapsedLabel}
        </p>
      </div>
      <Link href={active.progressUrl} className="wbeta-genstatus-track">
        Track
      </Link>
    </div>
  );
}
