"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { WorkspaceDocumentRow } from "@/lib/workspace/db";

const STATUS_LABELS: Record<WorkspaceDocumentRow["status"], string> = {
  processing: "Parsing",
  indexed: "Ready",
  failed: "Needs attention",
  deleted: "Removed",
};

const DEFAULT_EMPTY_BODY =
  "Drop a brief, a transcript, a prior deck, or a data export above. " +
  "Basquio parses, extracts entities, and adds them to the timeline within about 30 seconds.";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeDate(iso: string): string {
  const created = new Date(iso);
  const now = Date.now();
  const diffSec = Math.round((now - created.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days < 7) return `${days}d ago`;
  return created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WorkspaceDocumentList({
  documents,
  title = "Recent uploads",
  emptyTitle = "Upload your first file.",
  emptyBody = DEFAULT_EMPTY_BODY,
}: {
  documents: WorkspaceDocumentRow[];
  title?: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (documents.length === 0) {
    return (
      <div className="wbeta-doclist-empty">
        <p className="wbeta-doclist-empty-title">{emptyTitle}</p>
        <p className="wbeta-doclist-empty-body">{emptyBody}</p>
      </div>
    );
  }

  return (
    <div className="wbeta-doclist">
      <h3 className="wbeta-doclist-head">{title}</h3>
      <ul className="wbeta-doclist-rows">
        {documents.map((doc) => (
          <li key={doc.id} className="wbeta-doclist-row">
            <div className="wbeta-doclist-row-main">
              <p className="wbeta-doclist-filename" title={doc.filename}>
                {doc.filename}
              </p>
              <p className="wbeta-doclist-meta">
                <span>{doc.file_type.toUpperCase()}</span>
                <span aria-hidden> · </span>
                <span>{formatSize(doc.file_size_bytes)}</span>
                <span aria-hidden> · </span>
                <span>{formatRelativeDate(doc.created_at)}</span>
                <span aria-hidden> · </span>
                <span>{doc.uploaded_by}</span>
              </p>
              {doc.error_message ? (
                <p className="wbeta-doclist-error">{doc.error_message}</p>
              ) : null}
            </div>
            <div className="wbeta-doclist-side">
              <span className={`wbeta-doclist-status wbeta-doclist-status-${doc.status}`}>
                {STATUS_LABELS[doc.status]}
              </span>
              {doc.status === "failed" ? <RetryDocumentButton documentId={doc.id} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RetryDocumentButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/documents/${documentId}/retry`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Retry failed.");
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="wbeta-doclist-retry"
        onClick={handleClick}
        disabled={busy}
        aria-label="Retry processing this document"
      >
        {busy ? "Retrying..." : "Retry"}
      </button>
      {error ? <p className="wbeta-doclist-error">{error}</p> : null}
    </>
  );
}
