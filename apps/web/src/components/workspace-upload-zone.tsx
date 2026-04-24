"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { uploadWorkspaceFile } from "@/lib/workspace/upload-client";

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string; progressPct: number }
  | { kind: "success"; filename: string; deduplicated: boolean }
  | { kind: "error"; message: string };

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

  const uploadFile = useCallback(
    async (file: File) => {
      setState({ kind: "uploading", filename: file.name, progressPct: 0 });

      try {
        const data = await uploadWorkspaceFile(file, {
          onProgress(progressPct) {
            setState({ kind: "uploading", filename: file.name, progressPct });
          },
        });

        setState({
          kind: "success",
          filename: file.name,
          deduplicated: data.deduplicated ?? false,
        });

        startTransition(() => {
          router.refresh();
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed. Try again.";
        setState({ kind: "error", message });
      }
    },
    [router],
  );

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      for (const file of Array.from(fileList)) {
        await uploadFile(file);
      }
    },
    [uploadFile],
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
      onClick={() => inputRef.current?.click()}
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

function UploadStatus({ state }: { state: UploadState }) {
  if (state.kind === "idle") return null;

  if (state.kind === "uploading") {
    return (
      <p className="wbeta-drop-status wbeta-drop-status-busy">
        <WorkspaceSkeleton density="line" width={72} label={`Uploading ${state.filename}`} />
        <span>Uploading {state.filename}. {state.progressPct}%</span>
      </p>
    );
  }

  if (state.kind === "success") {
    return (
      <p className="wbeta-drop-status wbeta-drop-status-ok">
        {state.deduplicated
          ? `Already in the workspace: ${state.filename}.`
          : `Uploaded ${state.filename}. Parsing runs next.`}
      </p>
    );
  }

  return <p className="wbeta-drop-status wbeta-drop-status-err">{state.message}</p>;
}
