"use client";

import { useRouter } from "next/navigation";
import { type Dispatch, type SetStateAction, useRef, useState } from "react";

const DIRECT_TEMPLATE_UPLOAD_THRESHOLD_BYTES = 4 * 1024 * 1024;
const MAX_TEMPLATE_UPLOAD_BYTES = 50 * 1024 * 1024;

type TemplateItem = {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  failureMessage?: string | null;
  colors: string[];
  fonts: string[];
  headingFont: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type TemplateImportState =
  | { phase: "idle" }
  | { phase: "validating"; fileName: string }
  | { phase: "uploading"; fileName: string; loadedBytes: number; totalBytes: number }
  | { phase: "processing"; fileName: string; templateId: string; message: string }
  | { phase: "success"; templateId: string }
  | { phase: "error"; message: string; recoverable: boolean };

type TemplateImportResponse = {
  importJobId?: string;
  templateProfileId?: string;
  message?: string;
  error?: string;
};

type TemplatePrepareUploadResponse = {
  error?: string;
  sourceFileId?: string;
  storageBucket?: string;
  storagePath?: string;
  uploadUrl?: string;
};

// ─── IMPORT BOX ─────────────────────────────────────────────

export function TemplateImportBox() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<TemplateImportState>({ phase: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const importedTemplateId = importState.phase === "success" ? importState.templateId : null;
  const importSuccess = importState.phase === "success";
  const importing = ["validating", "uploading", "processing"].includes(importState.phase);

  async function handleImport(file: File) {
    const validationMessage = validateTemplateFile(file);
    if (validationMessage) {
      setImportState({ phase: "error", message: validationMessage, recoverable: false });
      return;
    }

    setImportState({ phase: "validating", fileName: file.name });

    try {
      let payload: TemplateImportResponse;

      if (file.size > DIRECT_TEMPLATE_UPLOAD_THRESHOLD_BYTES) {
        payload = await uploadTemplateDirect(file, setImportState);
      } else {
        setImportState({
          phase: "uploading",
          fileName: file.name,
          loadedBytes: 0,
          totalBytes: file.size,
        });
        payload = await uploadTemplateViaFallback(file, (loaded, total) => {
          setImportState({
            phase: "uploading",
            fileName: file.name,
            loadedBytes: loaded,
            totalBytes: total || file.size,
          });
        });
      }

      const templateId = payload.templateProfileId;
      if (!templateId) {
        throw new Error("Basquio queued the template import without returning a template profile ID.");
      }

      setImportState({
        phase: "processing",
        fileName: file.name,
        templateId,
        message: payload.message ?? "Processing your template...",
      });

      await pollTemplateImportStatus(templateId, file.name, router, setImportState);
    } catch (error) {
      setImportState({
        phase: "error",
        message: normalizeTemplateImportError(error),
        recoverable: true,
      });
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function handleSetAsDefault() {
    if (!importedTemplateId) return;
    try {
      await fetch(`/api/templates/${importedTemplateId}/default`, { method: "POST" });
      setImportState({ phase: "idle" });
      router.refresh();
    } catch { /* ignore */ }
  }

  function handleKeepSaved() {
    setImportState({ phase: "idle" });
  }

  return (
    <article className="panel stack">
      <div className="stack-xs">
        <p className="artifact-kind">Import new template</p>
        <h3>Import once. Reuse on every future report.</h3>
        <p className="muted">
          Basquio maps colors, fonts, and layout cues into a reusable workspace template.
        </p>
      </div>

      {importSuccess ? (
        <div className="success-panel stack-xs" style={{ padding: "1rem" }}>
          <p style={{ fontWeight: 600, margin: 0 }}>Template ready</p>
          <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
            Your template was imported successfully. Set it as the workspace default or keep it saved for later.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <button className="button small" type="button" onClick={handleSetAsDefault}>
              Set as default
            </button>
            <button className="button small secondary" type="button" onClick={handleKeepSaved}>
              Keep saved only
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            className={isDragging ? "dropzone dropzone-active" : "dropzone dropzone-secondary"}
            type="button"
            disabled={importing}
            onClick={() => inputRef.current?.click()}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleImport(file);
            }}
          >
            <span className="dropzone-icon" aria-hidden>+</span>
            <span className="dropzone-title">
              {renderTemplateImportTitle(importState)}
            </span>
            <span className="dropzone-copy">Accepted: .pptx, .json, .css, .pdf · up to 50 MB</span>
          </button>

          <input
            ref={inputRef}
            className="sr-only-input"
            type="file"
            accept=".pptx,.json,.css,.pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
            }}
          />
        </>
      )}

      {importState.phase === "uploading" ? (
        <div className="stack-xs" style={{ marginTop: "0.2rem" }}>
          <div
            aria-hidden
            style={{
              width: "100%",
              height: "0.45rem",
              borderRadius: 999,
              background: "rgba(255, 255, 255, 0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.max(6, Math.round((importState.loadedBytes / Math.max(importState.totalBytes, 1)) * 100))}%`,
                height: "100%",
                borderRadius: 999,
                background: "var(--blue, #1A6AFF)",
                transition: "width 120ms ease-out",
              }}
            />
          </div>
          <p className="muted" style={{ fontSize: "0.88rem", margin: 0 }}>
            Uploading {importState.fileName}... {Math.round((importState.loadedBytes / Math.max(importState.totalBytes, 1)) * 100)}%
            {" "}({formatFileSize(importState.loadedBytes)} / {formatFileSize(importState.totalBytes)})
          </p>
        </div>
      ) : importState.phase !== "idle" && !importSuccess ? (
        <p className="muted" style={{ fontSize: "0.88rem" }}>{renderTemplateImportMessage(importState)}</p>
      ) : null}
    </article>
  );
}

async function uploadTemplateDirect(
  file: File,
  setImportState: Dispatch<SetStateAction<TemplateImportState>>,
) {
  const prepareResponse = await fetch("/api/templates/prepare-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      mediaType: file.type || "application/octet-stream",
      setAsDefault: false,
    }),
  });
  const preparePayload = (await readTemplateApiPayload(prepareResponse)) as TemplatePrepareUploadResponse;

  if (!prepareResponse.ok) {
    throw new Error(preparePayload.error ?? "Unable to prepare the template upload.");
  }

  if (!preparePayload.sourceFileId || !preparePayload.storagePath || !preparePayload.uploadUrl) {
    throw new Error("Basquio did not return a valid upload target for this template.");
  }

  setImportState({
    phase: "uploading",
    fileName: file.name,
    loadedBytes: 0,
    totalBytes: file.size,
  });

  await uploadTemplateFileWithProgress(file, preparePayload.uploadUrl, file.type || "application/octet-stream", (loaded, total) => {
    setImportState({
      phase: "uploading",
      fileName: file.name,
      loadedBytes: loaded,
      totalBytes: total || file.size,
    });
  });

  const confirmResponse = await fetch("/api/templates/confirm-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceFileId: preparePayload.sourceFileId,
      storageBucket: preparePayload.storageBucket ?? "source-files",
      storagePath: preparePayload.storagePath,
      fileName: file.name,
      fileSize: file.size,
      mediaType: file.type || "application/octet-stream",
      setAsDefault: false,
    }),
  });
  const confirmPayload = (await readTemplateApiPayload(confirmResponse)) as TemplateImportResponse;

  if (!confirmResponse.ok) {
    throw new Error(confirmPayload.error ?? "Basquio uploaded the template but could not queue the import job.");
  }

  return confirmPayload;
}

function uploadTemplateViaFallback(
  file: File,
  onProgress: (loaded: number, total: number) => void,
) {
  return new Promise<TemplateImportResponse>((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("setAsDefault", "false");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/templates/import");

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : file.size;
      onProgress(event.loaded, total);
    };

    xhr.onerror = () => {
      reject(new Error("Upload interrupted. Check your connection and try again."));
    };

    xhr.onabort = () => {
      reject(new Error("Upload interrupted. Check your connection and try again."));
    };

    xhr.onload = () => {
      const payload = readXhrPayload(xhr.responseText, xhr.status);
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size, file.size);
        resolve(payload as TemplateImportResponse);
        return;
      }

      reject(new Error(payload.error ?? "Template import failed."));
    };

    xhr.send(formData);
  });
}

async function pollTemplateImportStatus(
  templateId: string,
  fileName: string,
  router: ReturnType<typeof useRouter>,
  setImportState: Dispatch<SetStateAction<TemplateImportState>>,
) {
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(3000);

    try {
      const templatesRes = await fetch("/api/templates", { cache: "no-store" });
      if (!templatesRes.ok) {
        continue;
      }

      const data = await templatesRes.json() as { templates?: Array<{ id: string; status: string }> };
      const imported = data.templates?.find((template) => template.id === templateId);

      if (!imported) {
        continue;
      }

      if (imported.status === "ready") {
        setImportState({ phase: "success", templateId });
        router.refresh();
        return;
      }

      if (imported.status === "failed") {
        setImportState({
          phase: "error",
          message: "Template import failed during processing. Check the card below for details.",
          recoverable: true,
        });
        router.refresh();
        return;
      }
    } catch {
      // Keep polling on transient fetch failures.
    }
  }

  setImportState({
    phase: "processing",
    fileName,
    templateId,
    message: "This template is still processing. Large PPTX files can take a few minutes. The import job is still running and the card below will update when it finishes.",
  });
  router.refresh();
}

async function readTemplateApiPayload(response: Response) {
  if (response.status === 413) {
    return {
      error: "This upload was rejected before Basquio could read it. Large templates should use the direct-to-storage upload path.",
    };
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = (await response.text()).trim();
  return { error: text || "Request failed." };
}

function uploadTemplateFileWithProgress(
  file: File,
  uploadUrl: string,
  mediaType: string,
  onProgress: (loaded: number, total: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("cache-control", "3600");
    xhr.setRequestHeader("content-type", mediaType);
    xhr.setRequestHeader("x-upsert", "true");

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : file.size;
      onProgress(event.loaded, total);
    };

    xhr.onerror = () => {
      reject(new Error("Upload interrupted. Check your connection and try again."));
    };

    xhr.onabort = () => {
      reject(new Error("Upload interrupted. Check your connection and try again."));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size, file.size);
        resolve();
        return;
      }

      reject(new Error(readUploadErrorBody(xhr.responseText) ?? `Unable to upload ${file.name}.`));
    };

    xhr.send(file);
  });
}

function validateTemplateFile(file: File) {
  if (file.size === 0) {
    return "This file is empty. Upload a non-empty PPTX, JSON, CSS, or PDF template file.";
  }

  if (file.size > MAX_TEMPLATE_UPLOAD_BYTES) {
    return `This file is too large (${formatFileSize(file.size)}). Templates must be under 50 MB. Try removing embedded images or sample slides.`;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["pptx", "json", "css", "pdf"].includes(extension)) {
    return "Unsupported template type. Upload a PPTX, JSON, CSS, or PDF file.";
  }

  return null;
}

function normalizeTemplateImportError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Basquio could not import this template. Check your connection and try again.";
}

function renderTemplateImportTitle(state: TemplateImportState) {
  switch (state.phase) {
    case "validating":
      return "Checking your template...";
    case "uploading":
      return "Uploading directly to secure storage...";
    case "processing":
      return "Template uploaded. Processing now...";
    case "error":
      return state.recoverable ? "Template import needs another try" : "Template needs attention";
    default:
      return "Drop a PPTX, JSON, CSS, or PDF file here";
  }
}

function renderTemplateImportMessage(state: TemplateImportState) {
  switch (state.phase) {
    case "validating":
      return `Checking ${state.fileName} before upload...`;
    case "processing":
      return state.message;
    case "error":
      return state.message;
    default:
      return null;
  }
}

function readUploadErrorBody(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: string; message?: string };
    return parsed.error ?? parsed.message ?? null;
  } catch {
    return trimmed;
  }
}

function readXhrPayload(raw: string, status: number) {
  if (status === 413) {
    return {
      error: "This upload was rejected before Basquio could read it. Large templates should use the direct-to-storage upload path.",
    };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Request failed." };
  }

  try {
    return JSON.parse(trimmed) as TemplateImportResponse;
  } catch {
    return { error: trimmed };
  }
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── ACTIVE DEFAULT CARD ──────────────────────────────────────

export function ActiveDefaultCard({ defaultTemplate, hasCustomDefault }: {
  defaultTemplate: TemplateItem | null;
  hasCustomDefault: boolean;
}) {
  const router = useRouter();
  const [clearing, setClearing] = useState(false);

  async function handleClearDefault() {
    setClearing(true);
    try {
      await fetch("/api/templates/default/clear", { method: "POST" });
      router.refresh();
    } finally {
      setClearing(false);
    }
  }

  return (
    <article className="panel stack">
      <div className="row split">
        <div className="stack-xs">
          <p className="artifact-kind">Workspace default</p>
          <h2>{hasCustomDefault && defaultTemplate
            ? defaultTemplate.name
            : "Basquio Standard"}</h2>
        </div>
        <span className="run-pill run-pill-ready">Active</span>
      </div>

      <p className="muted">
        {hasCustomDefault
          ? "This template is used automatically on every new report unless you override it."
          : "Basquio's built-in editorial style. Used automatically on every new report."}
      </p>

      {hasCustomDefault && defaultTemplate?.colors && defaultTemplate.colors.length > 0 ? (
        <div className="brand-preview-strip">
          {defaultTemplate.colors.slice(0, 6).map((color) => (
            <div key={color} className="brand-preview-swatch">
              <span className="swatch-color" style={{ backgroundColor: color }} />
              <span>{color}</span>
            </div>
          ))}
        </div>
      ) : null}

      {hasCustomDefault ? (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button
            className="button small secondary"
            type="button"
            disabled={clearing}
            onClick={handleClearDefault}
          >
            {clearing ? "Switching..." : "Switch back to Basquio Standard"}
          </button>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: "0.85rem", fontStyle: "italic" }}>
          Basquio Standard is active. Import a template below to use your own brand.
        </p>
      )}
    </article>
  );
}

// ─── TEMPLATE CARD ────────────────────────────────────────────

export function TemplateCard({ template }: { template: TemplateItem }) {
  const router = useRouter();
  const [acting, setActing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(template.name);

  async function setAsDefault() {
    setActing(true);
    try {
      await fetch(`/api/templates/${template.id}/default`, { method: "POST" });
      router.refresh();
    } finally {
      setActing(false);
    }
  }

  async function handleDelete() {
    setActing(true);
    try {
      await fetch(`/api/templates/${template.id}/delete`, { method: "POST" });
      router.refresh();
    } finally {
      setActing(false);
      setConfirming(false);
    }
  }

  async function handleRename() {
    if (!newName.trim() || newName.trim() === template.name) {
      setRenaming(false);
      return;
    }
    setActing(true);
    try {
      await fetch(`/api/templates/${template.id}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      router.refresh();
    } finally {
      setActing(false);
      setRenaming(false);
    }
  }

  const statusBadge = template.status === "ready"
    ? template.isDefault ? "Default" : "Ready"
    : template.status === "processing"
      ? "Processing"
      : "Failed";

  const statusClass = template.status === "failed"
    ? "run-pill run-pill-failed"
    : template.isDefault
      ? "run-pill run-pill-ready"
      : "run-pill";

  return (
    <article className="panel presentation-card">
      <div className="stack">
        <div className="row split">
          <div className="stack-xs">
            <p className="artifact-kind">{sourceTypeLabel(template.sourceType)}</p>
            {renaming ? (
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(false); }}
                  style={{ fontSize: "1rem", padding: "0.3rem 0.5rem", border: "1px solid var(--border)", borderRadius: 4, width: 200 }}
                  // biome-ignore lint: autofocus is intentional for rename UX
                  autoFocus
                />
                <button className="button small" type="button" disabled={acting} onClick={handleRename}>
                  Save
                </button>
                <button className="button small secondary" type="button" onClick={() => setRenaming(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <h3>{template.name}</h3>
            )}
          </div>
          <span className={statusClass}>{statusBadge}</span>
        </div>

        {template.status === "failed" && template.failureMessage ? (
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            We couldn&apos;t process this template. {template.failureMessage}
          </p>
        ) : null}
      </div>

      {template.colors.length > 0 ? (
        <div className="brand-preview-strip">
          {(template.colors as string[]).slice(0, 4).map((color) => (
            <div key={color} className="brand-preview-swatch">
              <span className="swatch-color" style={{ backgroundColor: color }} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="compact-meta-row">
        {template.headingFont ? <span className="run-pill">{template.headingFont}</span> : null}
        {template.fonts.length > 0 ? <span className="run-pill">{template.fonts[0]}</span> : null}
        <span className="run-pill">{formatDate(template.createdAt)}</span>
      </div>

      {/* Actions by state */}
      <div className="template-card-actions">
        {template.status === "ready" && !template.isDefault ? (
          <>
            <button className="button small" type="button" disabled={acting} onClick={setAsDefault}>
              {acting ? "Setting..." : "Use as workspace default"}
            </button>
            <button className="button small secondary" type="button" onClick={() => setRenaming(true)}>
              Rename
            </button>
            {confirming ? (
              <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.82rem", color: "var(--text-soft)" }}>Remove this template?</span>
                <button className="button small" type="button" disabled={acting} onClick={handleDelete} style={{ background: "#e8636f", color: "#fff" }}>
                  Confirm
                </button>
                <button className="button small secondary" type="button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="button small secondary" type="button" onClick={() => setConfirming(true)}>
                Remove
              </button>
            )}
          </>
        ) : null}

        {template.status === "ready" && template.isDefault ? (
          <>
            <button className="button small secondary" type="button" onClick={() => setRenaming(true)}>
              Rename
            </button>
            {confirming ? (
              <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.82rem", color: "var(--text-soft)" }}>
                  This will also switch the default back to Basquio Standard.
                </span>
                <button className="button small" type="button" disabled={acting} onClick={handleDelete} style={{ background: "#e8636f", color: "#fff" }}>
                  Remove
                </button>
                <button className="button small secondary" type="button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="button small secondary" type="button" onClick={() => setConfirming(true)}>
                Remove
              </button>
            )}
          </>
        ) : null}

        {template.status === "processing" ? (
          <span className="muted" style={{ fontSize: "0.85rem" }}>Processing... this usually takes a few seconds.</span>
        ) : null}

        {template.status === "failed" ? (
          <>
            {confirming ? (
              <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
                <button className="button small" type="button" disabled={acting} onClick={handleDelete} style={{ background: "#e8636f", color: "#fff" }}>
                  Confirm remove
                </button>
                <button className="button small secondary" type="button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="button small secondary" type="button" onClick={() => setConfirming(true)}>
                Remove
              </button>
            )}
          </>
        ) : null}
      </div>
    </article>
  );
}

function sourceTypeLabel(sourceType: string) {
  switch (sourceType) {
    case "pptx": return "PowerPoint template";
    case "brand-tokens": return "Brand tokens (JSON/CSS)";
    case "pdf-style-reference": return "PDF style reference";
    case "pdf": return "PDF style reference";
    case "system": return "Basquio default";
    default: return "Custom template";
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
