"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { uploadWorkspaceFile } from "@/lib/workspace/upload-client";

type ToastState = {
  brandBookFilenames: string[];
};

type UploadState =
  | { kind: "idle" }
  | { kind: "review"; pdfs: PendingFile[] }
  | { kind: "uploading"; filename: string; progressPct: number; remaining: number }
  | { kind: "success"; filenames: string[]; deduplicatedCount: number; toast: ToastState | null }
  | { kind: "error"; message: string };

type PendingFile = {
  id: string;
  file: File;
  isBrandBook: boolean;
};

function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return /\.pdf$/i.test(file.name);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspaceUploadZone({
  supportedLabel,
  variant = "inline",
  title,
  subtitle,
}: {
  supportedLabel: string;
  variant?: "inline" | "hero";
  title?: string;
  subtitle?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPending, startTransition] = useTransition();

  const uploadOne = useCallback(
    async (
      file: File,
      isBrandBook: boolean,
      onProgress: (pct: number) => void,
    ): Promise<{ deduplicated: boolean }> => {
      const data = await uploadWorkspaceFile(file, {
        kind: isBrandBook ? "brand_book" : "uploaded_file",
        onProgress,
      });
      return { deduplicated: data.deduplicated ?? false };
    },
    [],
  );

  const runUploads = useCallback(
    async (queue: Array<{ file: File; isBrandBook: boolean }>) => {
      const succeeded: string[] = [];
      const brandBookFiles: string[] = [];
      let deduplicatedCount = 0;
      try {
        for (let i = 0; i < queue.length; i += 1) {
          const entry = queue[i];
          const remaining = queue.length - i - 1;
          setState({
            kind: "uploading",
            filename: entry.file.name,
            progressPct: 0,
            remaining,
          });
          const result = await uploadOne(entry.file, entry.isBrandBook, (progressPct) => {
            setState({
              kind: "uploading",
              filename: entry.file.name,
              progressPct,
              remaining,
            });
          });
          succeeded.push(entry.file.name);
          if (result.deduplicated) deduplicatedCount += 1;
          if (entry.isBrandBook) brandBookFiles.push(entry.file.name);
        }
        setState({
          kind: "success",
          filenames: succeeded,
          deduplicatedCount,
          toast: brandBookFiles.length > 0 ? { brandBookFilenames: brandBookFiles } : null,
        });
        startTransition(() => router.refresh());
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed. Try again.";
        setState({ kind: "error", message });
      }
    },
    [router, uploadOne],
  );

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      const pdfs = files.filter(isPdfFile);
      const nonPdfs = files.filter((f) => !isPdfFile(f));

      // Non-PDF files upload immediately as "uploaded_file". The brand-book
      // toggle is PDF-only since brand extraction targets PDFs.
      if (pdfs.length === 0) {
        await runUploads(nonPdfs.map((file) => ({ file, isBrandBook: false })));
        return;
      }

      // At least one PDF: stage the queue for per-file review. Non-PDFs in
      // the same drop flow through the queue too with their toggles
      // disabled, so the user sees the full batch.
      const pending: PendingFile[] = [
        ...pdfs.map((file, i) => ({ id: `pdf-${Date.now()}-${i}`, file, isBrandBook: false })),
        ...nonPdfs.map((file, i) => ({
          id: `other-${Date.now()}-${i}`,
          file,
          isBrandBook: false,
        })),
      ];
      setState({ kind: "review", pdfs: pending });
    },
    [runUploads],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      void handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  const isBusy = state.kind === "uploading" || isPending;
  const isReview = state.kind === "review";

  if (state.kind === "review") {
    return (
      <ReviewQueue
        pending={state.pdfs}
        onCancel={() => setState({ kind: "idle" })}
        onConfirm={async (queue) => {
          await runUploads(queue);
        }}
        onUpdate={(updated) => setState({ kind: "review", pdfs: updated })}
      />
    );
  }

  return (
    <div
      className={[
        "wbeta-drop",
        variant === "hero" ? "wbeta-drop-hero" : "wbeta-drop-inline",
        isDragOver ? "wbeta-drop-over" : "",
        isBusy ? "wbeta-drop-busy" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onDragOver={(event) => {
        event.preventDefault();
        if (!isDragOver) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => (isReview ? null : inputRef.current?.click())}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      aria-busy={isBusy}
      aria-label={`Upload files. ${supportedLabel}. Press Enter or Space to open the picker.`}
    >
      <input
        ref={inputRef}
        type="file"
        className="wbeta-drop-input"
        multiple
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="wbeta-drop-headline">
        <span className="wbeta-drop-title">
          {title ?? (variant === "hero" ? "Drop your first file." : "Drop a file.")}
        </span>
        <span className="wbeta-drop-sub">
          {subtitle ??
            (variant === "hero"
              ? `Or click anywhere on this card. ${supportedLabel}. Up to 50 MB.`
              : `Or click to browse. ${supportedLabel}.`)}
        </span>
      </div>

      <UploadStatus state={state} />
    </div>
  );
}

function ReviewQueue({
  pending,
  onUpdate,
  onCancel,
  onConfirm,
}: {
  pending: PendingFile[];
  onUpdate: (updated: PendingFile[]) => void;
  onCancel: () => void;
  onConfirm: (queue: Array<{ file: File; isBrandBook: boolean }>) => Promise<void>;
}) {
  const brandBookCount = pending.filter((p) => p.isBrandBook).length;
  const regularCount = pending.length - brandBookCount;
  const submitLabel =
    brandBookCount > 0
      ? `Upload ${pending.length} ${pending.length === 1 ? "file" : "files"} (${brandBookCount} brand book${brandBookCount === 1 ? "" : "s"}, ${regularCount} regular)`
      : `Upload ${pending.length} ${pending.length === 1 ? "file" : "files"}`;

  function setBrandBook(id: string, value: boolean) {
    onUpdate(pending.map((p) => (p.id === id ? { ...p, isBrandBook: value } : p)));
  }

  return (
    <div className="wbeta-drop wbeta-drop-review">
      <div className="wbeta-drop-headline">
        <span className="wbeta-drop-title">Confirm uploads.</span>
        <span className="wbeta-drop-sub">
          Brand books extract typography, colour, tone, and imagery as typed rules
          ($3 to $5 each). Other PDFs chunk for search only.
        </span>
      </div>
      <ul className="wbeta-drop-review-list">
        {pending.map((p) => {
          const eligible = isPdfFile(p.file);
          return (
            <li key={p.id} className="wbeta-drop-review-row">
              <div className="wbeta-drop-review-meta">
                <span className="wbeta-drop-review-name">{p.file.name}</span>
                <span className="wbeta-drop-review-size">{formatSize(p.file.size)}</span>
              </div>
              {eligible ? (
                <label className="wbeta-drop-review-toggle">
                  <input
                    type="checkbox"
                    checked={p.isBrandBook}
                    onChange={(event) => setBrandBook(p.id, event.target.checked)}
                  />
                  <span>This is a brand book</span>
                </label>
              ) : (
                <span className="wbeta-drop-review-non-pdf">Regular file</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="wbeta-drop-review-actions">
        <button
          type="button"
          className="wbeta-drop-review-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="wbeta-drop-review-confirm"
          onClick={() =>
            onConfirm(pending.map((p) => ({ file: p.file, isBrandBook: p.isBrandBook })))
          }
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function UploadStatus({ state }: { state: UploadState }) {
  if (state.kind === "idle" || state.kind === "review") return null;

  if (state.kind === "uploading") {
    return (
      <p className="wbeta-drop-status wbeta-drop-status-busy">
        <WorkspaceSkeleton density="line" width={72} label={`Uploading ${state.filename}`} />
        <span>
          Uploading {state.filename}. {state.progressPct}%
          {state.remaining > 0 ? ` (${state.remaining} more after this)` : ""}
        </span>
      </p>
    );
  }

  if (state.kind === "success") {
    const count = state.filenames.length;
    const dedup = state.deduplicatedCount;
    const summary =
      dedup === 0
        ? `Uploaded ${count} ${count === 1 ? "file" : "files"}. Parsing runs next.`
        : dedup === count
          ? `Already in the workspace: ${count} ${count === 1 ? "file" : "files"}.`
          : `Uploaded ${count - dedup} of ${count} (${dedup} already in the workspace). Parsing runs next.`;
    return (
      <div className="wbeta-drop-status wbeta-drop-status-ok">
        <p>{summary}</p>
        {state.toast ? (
          <p className="wbeta-drop-toast">
            Brand extraction queued for{" "}
            {state.toast.brandBookFilenames.length === 1
              ? state.toast.brandBookFilenames[0]
              : `${state.toast.brandBookFilenames.length} files`}
            . Open <a href="/workspace/memory">Memory</a> in 1 to 3 minutes to see the
            extracted rules.
          </p>
        ) : null}
      </div>
    );
  }

  return <p className="wbeta-drop-status wbeta-drop-status-err">{state.message}</p>;
}
