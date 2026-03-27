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

export function TemplateImportBox() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function handleImport(file: File) {
    setImporting(true);
    setImportMessage(null);

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

      setImportMessage("Template import started. It will appear below when ready. You can then set it as your workspace default.");

      // Poll the templates API until the import completes or fails (max 60s)
      const templateId = payload.templateProfileId as string | undefined;
      if (templateId) {
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
                  setImportMessage("Template imported successfully. Set it as your workspace default below.");
                } else {
                  setImportMessage("Template import failed. Check the template card below for details.");
                }
                router.refresh();
                return;
              }
            }
          } catch { /* continue polling */ }

          if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            setImportMessage("Import is still processing. We'll email you when it's ready.");
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

  return (
    <article className="panel stack">
      <div className="stack-xs">
        <p className="artifact-kind">Import new template</p>
        <h3>Import once. Reuse on every future report.</h3>
        <p className="muted">
          We map colors, fonts, and layout cues into your workspace template so runs do not need to re-read the PPTX every time.
        </p>
      </div>

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

      {importMessage ? (
        <p className="muted" style={{ fontSize: "0.88rem" }}>{importMessage}</p>
      ) : null}
    </article>
  );
}

export function TemplateCard({ template }: { template: TemplateItem }) {
  const router = useRouter();
  const [acting, setActing] = useState(false);

  async function setAsDefault() {
    setActing(true);
    try {
      await fetch(`/api/templates/${template.id}/default`, { method: "POST" });
      router.refresh();
    } finally {
      setActing(false);
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
            <h3>{template.name}</h3>
          </div>
          <span className={statusClass}>{statusBadge}</span>
        </div>

        {template.status === "failed" && template.failureMessage ? (
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            We couldn&apos;t map this template. {template.failureMessage}
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

      {template.status === "ready" && !template.isDefault ? (
        <div style={{ marginTop: "0.5rem" }}>
          <button
            className="button small secondary"
            type="button"
            disabled={acting}
            onClick={setAsDefault}
          >
            {acting ? "Setting..." : "Set as default"}
          </button>
        </div>
      ) : null}
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
