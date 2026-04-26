"use client";

import {
  ArrowSquareOut,
  DownloadSimple,
  File,
  FilePdf,
  FileText,
  ImageSquare,
  Info,
  MicrosoftExcelLogo,
  MicrosoftPowerpointLogo,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import type { WorkspaceDocumentRow } from "@/lib/workspace/db";

const SourceMarkdown = dynamic(
  () => import("@/components/workspace-document-markdown-preview").then((mod) => mod.SourceMarkdown),
  {
    ssr: false,
    loading: () => (
      <div className="wbeta-docpreview-loading" role="status" aria-label="Loading markdown preview">
        <span />
        <span />
        <span />
      </div>
    ),
  },
);

type PreviewPayload =
  | { kind: "text"; text: string }
  | { kind: "spreadsheet"; sheets: Array<{ name: string; rows: string[][] }> }
  | { kind: "unsupported"; message?: string };

type PreviewState =
  | { kind: "idle" }
  | { kind: "unavailable"; documentId: string; message: string }
  | { kind: "loading"; documentId: string }
  | { kind: "ready"; documentId: string; payload: PreviewPayload }
  | { kind: "error"; documentId: string; message: string };

const STATUS_LABELS: Record<WorkspaceDocumentRow["status"], string> = {
  processing: "Reading file",
  indexed: "Searchable",
  failed: "Could not read",
  deleted: "Removed",
};

const STATUS_DESCRIPTIONS: Record<WorkspaceDocumentRow["status"], string> = {
  processing:
    "Basquio is extracting text, tables, and facts from this file so it can use the content in answers.",
  indexed:
    "Searchable means Basquio can find this file, use its excerpts, and cite it in answers or deck briefs.",
  failed:
    "Could not read means Basquio kept the original file, but the searchable copy failed. Try reading it again or replace the file.",
  deleted:
    "Removed means this file is no longer available for new retrieval. It may still appear in older history.",
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

function getExtension(doc: WorkspaceDocumentRow): string {
  const normalizedType = doc.file_type?.toLowerCase().replace(/^\./, "") ?? "";
  if (normalizedType) return normalizedType;
  return doc.filename.split(".").pop()?.toLowerCase() ?? "";
}

function getDocumentKind(doc: WorkspaceDocumentRow): "pdf" | "image" | "sheet" | "deck" | "text" | "file" {
  const extension = getExtension(doc);
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image";
  if (["xlsx", "xls", "csv"].includes(extension)) return "sheet";
  if (["pptx", "ppt"].includes(extension)) return "deck";
  if (["txt", "md", "gsp", "json", "yaml", "yml", "docx"].includes(extension)) return "text";
  return "file";
}

function getUnsupportedPreviewMessage(doc: WorkspaceDocumentRow): string {
  const kind = getDocumentKind(doc);
  if (kind === "deck") {
    return "PowerPoint preview is not available in the browser. Download the original to inspect the deck.";
  }
  return "Inline preview is not available for this file type. Download the original to inspect it.";
}

function DocumentIcon({ doc }: { doc: WorkspaceDocumentRow }) {
  const kind = getDocumentKind(doc);
  const iconProps = { size: 18, weight: "duotone" as const };
  if (kind === "pdf") return <FilePdf {...iconProps} />;
  if (kind === "image") return <ImageSquare {...iconProps} />;
  if (kind === "sheet") return <MicrosoftExcelLogo {...iconProps} />;
  if (kind === "deck") return <MicrosoftPowerpointLogo {...iconProps} />;
  if (kind === "text") return <FileText {...iconProps} />;
  return <File {...iconProps} />;
}

function buildDocumentUrl(documentId: string, mode: "preview" | "download", download = false): string {
  const params = new URLSearchParams();
  if (download) params.set("download", "1");
  return `/api/workspace/documents/${documentId}/${mode}${params.size ? `?${params.toString()}` : ""}`;
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeId) ?? null,
    [documents, activeId],
  );
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });

  useEffect(() => {
    if (activeId && !documents.some((doc) => doc.id === activeId)) {
      setActiveId(null);
      setPreview({ kind: "idle" });
    }
  }, [documents, activeId]);

  useEffect(() => {
    if (!activeDocument) {
      setPreview({ kind: "idle" });
      return;
    }

    const documentKind = getDocumentKind(activeDocument);
    if (documentKind === "pdf" || documentKind === "image") {
      setPreview({ kind: "idle" });
      return;
    }

    if (documentKind === "deck" || documentKind === "file") {
      setPreview({
        kind: "unavailable",
        documentId: activeDocument.id,
        message: getUnsupportedPreviewMessage(activeDocument),
      });
      return;
    }

    const controller = new AbortController();
    setPreview({ kind: "loading", documentId: activeDocument.id });

    fetch(buildDocumentUrl(activeDocument.id, "preview"), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as PreviewPayload & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Preview is not available.");
        }
        setPreview({ kind: "ready", documentId: activeDocument.id, payload });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setPreview({
          kind: "error",
          documentId: activeDocument.id,
          message: error instanceof Error ? error.message : "Preview is not available.",
        });
      });

    return () => controller.abort();
  }, [activeDocument]);

  function closePreview() {
    setActiveId(null);
    setPreview({ kind: "idle" });
  }

  useEffect(() => {
    if (!activeDocument) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePreview();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeDocument]);

  useEffect(() => {
    if (!activeDocument) {
      setPreview({ kind: "idle" });
    }
  }, [activeDocument]);

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
      <div className="wbeta-doclist-library">
        <div className="wbeta-doclist-headrow">
          <div>
            <h3 className="wbeta-doclist-head">{title}</h3>
            <p className="wbeta-doclist-subhead">{documents.length} source files</p>
          </div>
        </div>
        <ul className="wbeta-doclist-rows">
          {documents.map((doc) => {
            const isSelected = activeDocument?.id === doc.id;
            return (
              <li key={doc.id} className="wbeta-doclist-row">
                <button
                  type="button"
                  className={`wbeta-doclist-select ${isSelected ? "wbeta-doclist-select-active" : ""}`}
                  onClick={() => setActiveId(doc.id)}
                  aria-pressed={isSelected}
                >
                  <span className="wbeta-doclist-fileicon" aria-hidden>
                    <DocumentIcon doc={doc} />
                  </span>
                  <span className="wbeta-doclist-row-main">
                    <span className="wbeta-doclist-filename" title={doc.filename}>
                      {doc.filename}
                    </span>
                    <span className="wbeta-doclist-meta">
                      <span>{getExtension(doc).toUpperCase() || "FILE"}</span>
                      <span>{formatSize(doc.file_size_bytes)}</span>
                      <span>{formatRelativeDate(doc.created_at)}</span>
                    </span>
                  </span>
                </button>
                <div className="wbeta-doclist-side">
                  <DocumentStatus status={doc.status} documentId={doc.id} />
                  <a
                    className="wbeta-doclist-iconlink"
                    href={buildDocumentUrl(doc.id, "download", true)}
                    aria-label={`Download ${doc.filename}`}
                  >
                    <DownloadSimple size={15} weight="bold" />
                  </a>
                  {doc.status === "failed" ? <RetryDocumentButton documentId={doc.id} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <DocumentPreviewDialog document={activeDocument} preview={preview} onClose={closePreview} />
    </div>
  );
}

function DocumentStatus({
  status,
  documentId,
}: {
  status: WorkspaceDocumentRow["status"];
  documentId: string;
}) {
  const tooltipId = `source-status-tip-${documentId}`;
  return (
    <span className="wbeta-docstatus-wrap">
      <span className={`wbeta-doclist-status wbeta-doclist-status-${status}`}>
        {STATUS_LABELS[status]}
      </span>
      <span className="wbeta-docinfo">
        <button
          type="button"
          className="wbeta-docinfo-trigger"
          aria-label={`What ${STATUS_LABELS[status]} means`}
          aria-describedby={tooltipId}
        >
          <Info size={13} weight="bold" />
        </button>
        <span id={tooltipId} className="wbeta-docinfo-tip" role="tooltip">
          {STATUS_DESCRIPTIONS[status]}
        </span>
      </span>
    </span>
  );
}

function DocumentPreviewDialog({
  document,
  preview,
  onClose,
}: {
  document: WorkspaceDocumentRow | null;
  preview: PreviewState;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!document) return;
    const previouslyFocused =
      globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [document]);

  if (!document) {
    return null;
  }

  const documentKind = getDocumentKind(document);
  const canOpenInline = documentKind === "pdf" || documentKind === "image";
  const openUrl = buildDocumentUrl(document.id, "download");
  const downloadUrl = buildDocumentUrl(document.id, "download", true);

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((node) => !node.hasAttribute("disabled") && !node.getAttribute("aria-hidden"));

    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = globalThis.document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="wbeta-docpreview-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
    <aside
      ref={dialogRef}
      className="wbeta-docpreview"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wbeta-docpreview-title"
      aria-live="polite"
      onKeyDown={handleDialogKeyDown}
    >
      <div className="wbeta-docpreview-head">
        <span className="wbeta-docpreview-icon" aria-hidden>
          <DocumentIcon doc={document} />
        </span>
        <div className="wbeta-docpreview-titleblock">
          <h3 id="wbeta-docpreview-title" className="wbeta-docpreview-title" title={document.filename}>
            {document.filename}
          </h3>
          <p className="wbeta-docpreview-meta">
            {getExtension(document).toUpperCase() || "FILE"} / {formatSize(document.file_size_bytes)} /{" "}
            {document.uploaded_by}
          </p>
        </div>
        <div className="wbeta-docpreview-actions">
          {canOpenInline ? (
            <a href={openUrl} target="_blank" rel="noreferrer" className="wbeta-docpreview-action">
              <ArrowSquareOut size={15} weight="bold" />
              <span>Open</span>
            </a>
          ) : null}
          <a href={downloadUrl} className="wbeta-docpreview-action wbeta-docpreview-action-primary">
            <DownloadSimple size={15} weight="bold" />
            <span>Download</span>
          </a>
          <button
            ref={closeRef}
            type="button"
            className="wbeta-docpreview-close"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X size={18} weight="bold" />
          </button>
        </div>
      </div>

      <div className={`wbeta-docpreview-body wbeta-docpreview-body-${documentKind}`}>
        {documentKind === "pdf" ? (
          <iframe
            className="wbeta-docpreview-frame"
            src={openUrl}
            title={`Preview of ${document.filename}`}
          />
        ) : null}
        {documentKind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="wbeta-docpreview-image" src={openUrl} alt={`Preview of ${document.filename}`} />
        ) : null}
        {documentKind !== "pdf" && documentKind !== "image" ? (
          <PreviewContent preview={preview} document={document} />
        ) : null}
      </div>
    </aside>
    </div>,
    documentBody(),
  );
}

function PreviewContent({
  preview,
  document,
}: {
  preview: PreviewState;
  document: WorkspaceDocumentRow;
}) {
  if (preview.kind === "idle") {
    return (
      <div className="wbeta-docpreview-loading" role="status" aria-label="Loading document preview">
        <span />
        <span />
        <span />
      </div>
    );
  }

  if (preview.kind === "loading" || preview.documentId !== document.id) {
    return (
      <div className="wbeta-docpreview-loading" role="status" aria-label="Loading document preview">
        <span />
        <span />
        <span />
      </div>
    );
  }

  if (preview.kind === "error") {
    return (
      <div className="wbeta-docpreview-message">
        <p className="wbeta-docpreview-message-title">Preview unavailable.</p>
        <p>{preview.message}</p>
      </div>
    );
  }

  if (preview.kind === "unavailable") {
    return (
      <div className="wbeta-docpreview-message">
        <p className="wbeta-docpreview-message-title">Download original.</p>
        <p>{preview.message}</p>
      </div>
    );
  }

  if (preview.kind === "ready") {
    if (preview.payload.kind === "text") {
      const text = preview.payload.text || "No preview text found.";
      if (isMarkdownDocument(document)) {
        return <SourceMarkdown source={text} />;
      }
      return <pre className="wbeta-docpreview-text">{text}</pre>;
    }

    if (preview.payload.kind === "spreadsheet") {
      const sheet = preview.payload.sheets[0];
      if (!sheet || sheet.rows.length === 0) {
        return (
          <div className="wbeta-docpreview-message">
            <p className="wbeta-docpreview-message-title">Empty sheet.</p>
            <p>The file opened, but the first sheet has no rows to preview.</p>
          </div>
        );
      }
      return (
        <div className="wbeta-docpreview-tablewrap">
          <p className="wbeta-docpreview-sheet">{sheet.name}</p>
          <table className="wbeta-docpreview-table">
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                <tr key={`${rowIndex}-${row.join("|")}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="wbeta-docpreview-message">
        <p className="wbeta-docpreview-message-title">Original file ready.</p>
        <p>{preview.payload.message ?? "This file type can be opened or downloaded."}</p>
      </div>
    );
  }

  return null;
}

function isMarkdownDocument(doc: WorkspaceDocumentRow): boolean {
  return ["md", "markdown", "gsp"].includes(getExtension(doc));
}

function documentBody(): HTMLElement {
  return document.body;
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
        aria-label="Read this file again"
      >
        {busy ? "Reading..." : "Read again"}
      </button>
      {error ? <p className="wbeta-doclist-error">{error}</p> : null}
    </>
  );
}
