"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

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

// ─── IMPORT BOX ─────────────────────────────────────────────

export function TemplateImportBox() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [importedTemplateId, setImportedTemplateId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function handleImport(file: File) {
    setImporting(true);
    setImportMessage(null);
    setImportSuccess(false);
    setImportedTemplateId(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("setAsDefault", "false");

      const response = await fetch("/api/templates/import", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        setImportMessage(payload.error ?? "Import failed.");
        return;
      }

      setImportMessage("Processing your template...");
      const templateId = payload.templateProfileId as string | undefined;

      if (templateId) {
        setImportedTemplateId(templateId);
        let attempts = 0;
        const maxAttempts = 20;
        const pollInterval = setInterval(async () => {
          attempts += 1;
          try {
            const templatesRes = await fetch("/api/templates", { cache: "no-store" });
            if (templatesRes.ok) {
              const data = await templatesRes.json();
              const imported = (data.templates as Array<{ id: string; status: string }>)
                ?.find((t) => t.id === templateId);
              if (imported && (imported.status === "ready" || imported.status === "failed")) {
                clearInterval(pollInterval);
                if (imported.status === "ready") {
                  setImportSuccess(true);
                  setImportMessage("Template ready");
                } else {
                  setImportMessage("Template import failed. Check the card below for details.");
                }
                router.refresh();
                return;
              }
            }
          } catch { /* continue polling */ }

          if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            setImportMessage("This can take a little longer on larger templates. We'll email you when it's ready.");
            router.refresh();
          }
        }, 3000);
      }
    } catch {
      setImportMessage("Import failed. Try again.");
    } finally {
      setImporting(false);
    }
  }

  async function handleSetAsDefault() {
    if (!importedTemplateId) return;
    try {
      await fetch(`/api/templates/${importedTemplateId}/default`, { method: "POST" });
      setImportSuccess(false);
      setImportMessage(null);
      setImportedTemplateId(null);
      router.refresh();
    } catch { /* ignore */ }
  }

  function handleKeepSaved() {
    setImportSuccess(false);
    setImportMessage(null);
    setImportedTemplateId(null);
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
              {importing ? "Importing..." : "Drop a PPTX, JSON, or CSS file here"}
            </span>
            <span className="dropzone-copy">Accepted: .pptx, .json, .css, .pdf</span>
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

      {importMessage && !importSuccess ? (
        <p className="muted" style={{ fontSize: "0.88rem" }}>{importMessage}</p>
      ) : null}
    </article>
  );
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
