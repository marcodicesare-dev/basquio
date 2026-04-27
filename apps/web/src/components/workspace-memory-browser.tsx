"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  CheckCircle,
  Info,
  PencilSimple,
  Plus,
  PushPinSimple,
  TrashSimple,
  X,
} from "@phosphor-icons/react";

import type { MemoryRow, MemoryType, WorkspaceScope } from "@/lib/workspace/types";
import { MEMORY_TYPE_DESCRIPTIONS, MEMORY_TYPE_LABELS } from "@/lib/workspace/types";

const TYPE_ORDER: MemoryType[] = ["semantic", "procedural", "episodic"];

const KIND_HELP: Record<MemoryType, string> = {
  semantic:
    "Use Context for stable client, category, market, glossary, and business context Basquio should remember.",
  procedural:
    "Use Instructions for how Basquio should behave: tone, writing style, citation rules, charts, and analysis preferences.",
  episodic:
    "Use Examples for good past outputs or decisions Basquio should treat as a pattern to repeat.",
};

const SCOPE_HELP =
  "Choose where this applies. Workspace is global; a client or category keeps the note tied to that context.";

type Filters = {
  scopeId: string | "all";
  type: MemoryType | "all";
  search: string;
};

export function MemoryBrowser({
  initialEntries,
  scopes,
}: {
  initialEntries: MemoryRow[];
  scopes: WorkspaceScope[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [filters, setFilters] = useState<Filters>({ scopeId: "all", type: "all", search: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [, startTransition] = useTransition();

  const scopeById = useMemo(() => {
    const map = new Map<string, WorkspaceScope>();
    for (const s of scopes) map.set(s.id, s);
    return map;
  }, [scopes]);

  const filtered = useMemo(() => {
    const s = filters.search.trim().toLowerCase();
    return entries.filter((e) => {
      if (filters.scopeId !== "all" && e.workspace_scope_id !== filters.scopeId) return false;
      if (filters.type !== "all" && e.memory_type !== filters.type) return false;
      if (e.metadata?.archived_at) return false;
      if (s && !e.content.toLowerCase().includes(s) && !e.path.toLowerCase().includes(s))
        return false;
      return true;
    });
  }, [entries, filters]);

  const grouped = useMemo(() => {
    const result: Record<MemoryType, MemoryRow[]> = { procedural: [], semantic: [], episodic: [] };
    for (const entry of filtered) {
      result[entry.memory_type].push(entry);
    }
    for (const t of TYPE_ORDER) {
      result[t].sort((a, b) => {
        const aPinned = Boolean(a.metadata?.pinned_at);
        const bPinned = Boolean(b.metadata?.pinned_at);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
    }
    return result;
  }, [filtered]);

  async function handleSave(id: string, nextContent: string, nextType: MemoryType) {
    const response = await fetch(`/api/workspace/memory/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: nextContent, memory_type: nextType }),
    });
    if (response.ok) {
      const data = (await response.json()) as { entry: MemoryRow };
      setEntries((prev) => prev.map((e) => (e.id === id ? data.entry : e)));
      setEditingId(null);
      startTransition(() => router.refresh());
    } else {
      const err = (await response.json().catch(() => ({}))) as { error?: string };
      alert(err.error ?? "Could not save this knowledge item.");
    }
  }

  async function handleTogglePin(entry: MemoryRow) {
    const pinned = !entry.metadata?.pinned_at;
    const response = await fetch(`/api/workspace/memory/${entry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    if (response.ok) {
      const data = (await response.json()) as { entry: MemoryRow };
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
    }
  }

  async function handleArchive(entry: MemoryRow) {
    if (!confirm("Archive this saved knowledge? It will not be used in answers.")) return;
    const response = await fetch(`/api/workspace/memory/${entry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    if (response.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      startTransition(() => router.refresh());
    }
  }

  async function handleDelete(entry: MemoryRow) {
    if (!confirm("Delete this saved knowledge item? This cannot be undone.")) return;
    const response = await fetch(`/api/workspace/memory/${entry.id}`, { method: "DELETE" });
    if (response.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      startTransition(() => router.refresh());
    }
  }

  async function handleCreate(input: {
    scopeId: string;
    type: MemoryType;
    content: string;
  }) {
    const response = await fetch("/api/workspace/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspace_scope_id: input.scopeId,
        memory_type: input.type,
        content: input.content,
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as { entry: MemoryRow };
      setEntries((prev) => [data.entry, ...prev]);
      setIsCreating(false);
      startTransition(() => router.refresh());
    } else {
      const err = (await response.json().catch(() => ({}))) as { error?: string };
      alert(err.error ?? "Could not save this knowledge item.");
    }
  }

  return (
    <div className="wbeta-memory-browser">
      <div className="wbeta-memory-toolbar">
        <div className="wbeta-memory-filters">
          <label className="wbeta-memory-filter">
            <span className="wbeta-memory-label-row">
              Applies to
              <InfoHint text={SCOPE_HELP} />
            </span>
            <select
              value={filters.scopeId}
              onChange={(e) => setFilters((f) => ({ ...f, scopeId: e.target.value as Filters["scopeId"] }))}
            >
              <option value="all">Every context</option>
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.kind === "system" ? s.name : `${s.kind}: ${s.name}`}
                </option>
              ))}
            </select>
          </label>
          <label className="wbeta-memory-filter">
            <span className="wbeta-memory-label-row">
              Kind
              <InfoHint text="Basquio can store context, instructions, and examples. Pick Context if you are unsure." />
            </span>
            <select
              value={filters.type}
              onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as Filters["type"] }))}
            >
              <option value="all">All kinds</option>
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {MEMORY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="wbeta-memory-filter wbeta-memory-filter-grow">
            <span>Search</span>
            <input
              type="search"
              placeholder="Search saved knowledge"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </label>
        </div>
        <button
          type="button"
          className="wbeta-memory-new-btn"
          onClick={() => setIsCreating(true)}
          disabled={isCreating || scopes.length === 0}
        >
          <span className="wbeta-memory-new-icon" aria-hidden>
            <Plus size={13} weight="bold" />
          </span>
          Add knowledge
        </button>
      </div>

      {isCreating ? (
        <NewMemoryForm
          scopes={scopes}
          onCancel={() => setIsCreating(false)}
          onCreate={handleCreate}
        />
      ) : null}

      {filtered.length === 0 && !isCreating ? (
        <div className="wbeta-memory-empty">
          <h3 className="wbeta-memory-empty-title">Nothing here yet.</h3>
          <p className="wbeta-memory-empty-body">
            Add a note, instruction, or example Basquio should reuse. Upload files in Sources when
            answers need evidence from documents.
          </p>
          <button type="button" className="wbeta-memory-empty-cta" onClick={() => setIsCreating(true)}>
            Add knowledge
          </button>
        </div>
      ) : null}

      {TYPE_ORDER.map((type) => {
        const items = grouped[type];
        if (items.length === 0) return null;
        return (
          <section key={type} className="wbeta-memory-group">
            <header className="wbeta-memory-group-head">
              <h2 className="wbeta-memory-group-title">
                {MEMORY_TYPE_LABELS[type]}
                <InfoHint text={KIND_HELP[type]} />
              </h2>
              <p className="wbeta-memory-group-meta">{MEMORY_TYPE_DESCRIPTIONS[type]}</p>
            </header>
            <ul className="wbeta-memory-list">
              {items.map((entry) => (
                <li key={entry.id}>
                  <MemoryCard
                    entry={entry}
                    scope={scopeById.get(entry.workspace_scope_id ?? "") ?? null}
                    isEditing={editingId === entry.id}
                    onEditStart={() => setEditingId(entry.id)}
                    onEditCancel={() => setEditingId(null)}
                    onSave={handleSave}
                    onTogglePin={handleTogglePin}
                    onArchive={handleArchive}
                    onDelete={handleDelete}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function MemoryCard({
  entry,
  scope,
  isEditing,
  onEditStart,
  onEditCancel,
  onSave,
  onTogglePin,
  onArchive,
  onDelete,
}: {
  entry: MemoryRow;
  scope: WorkspaceScope | null;
  isEditing: boolean;
  onEditStart: () => void;
  onEditCancel: () => void;
  onSave: (id: string, content: string, type: MemoryType) => Promise<void>;
  onTogglePin: (entry: MemoryRow) => Promise<void>;
  onArchive: (entry: MemoryRow) => Promise<void>;
  onDelete: (entry: MemoryRow) => Promise<void>;
}) {
  const [draftContent, setDraftContent] = useState(entry.content);
  const [draftType, setDraftType] = useState<MemoryType>(entry.memory_type);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<"pin" | "archive" | "delete" | null>(null);
  const pinned = Boolean(entry.metadata?.pinned_at);

  async function save() {
    setBusy(true);
    try {
      await onSave(entry.id, draftContent, draftType);
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: "pin" | "archive" | "delete", callback: () => Promise<void>) {
    if (actionBusy || busy) return;
    setActionBusy(action);
    try {
      await callback();
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <article
      className={pinned ? "wbeta-memory-card wbeta-memory-card-pinned" : "wbeta-memory-card"}
      aria-busy={busy || actionBusy !== null}
    >
      <header className="wbeta-memory-card-head">
        <div className="wbeta-memory-card-meta">
          {scope ? (
            <span className="wbeta-memory-card-scope">
              {scope.kind === "system" ? scope.name : `${scope.kind}: ${scope.name}`}
            </span>
          ) : (
            <span className="wbeta-memory-card-scope wbeta-memory-card-scope-missing">
              Unscoped
            </span>
          )}
          <span className="wbeta-memory-card-path">{memoryOriginLabel(entry)}</span>
        </div>
        <div className="wbeta-memory-card-actions">
          <button
            type="button"
            className={
              pinned
                ? "wbeta-memory-icon-btn wbeta-memory-icon-btn-active"
                : "wbeta-memory-icon-btn"
            }
            onClick={() => runAction("pin", () => onTogglePin(entry))}
            aria-label={pinned ? "Unpin" : "Pin"}
            aria-pressed={pinned}
            aria-busy={actionBusy === "pin"}
            data-loading={actionBusy === "pin" ? "true" : undefined}
            disabled={busy || actionBusy !== null}
          >
            <PushPinSimple size={14} weight={pinned ? "fill" : "regular"} />
          </button>
          {!isEditing ? (
            <button
              type="button"
              className="wbeta-memory-icon-btn"
              onClick={onEditStart}
              aria-label="Edit"
              disabled={busy || actionBusy !== null}
            >
              <PencilSimple size={14} weight="regular" />
            </button>
          ) : null}
          <button
            type="button"
            className="wbeta-memory-icon-btn"
            onClick={() => runAction("archive", () => onArchive(entry))}
            aria-label="Archive"
            aria-busy={actionBusy === "archive"}
            data-loading={actionBusy === "archive" ? "true" : undefined}
            disabled={busy || actionBusy !== null}
          >
            <Archive size={14} weight="regular" />
          </button>
          <button
            type="button"
            className="wbeta-memory-icon-btn wbeta-memory-icon-btn-danger"
            onClick={() => runAction("delete", () => onDelete(entry))}
            aria-label="Delete"
            aria-busy={actionBusy === "delete"}
            data-loading={actionBusy === "delete" ? "true" : undefined}
            disabled={busy || actionBusy !== null}
          >
            <TrashSimple size={14} weight="regular" />
          </button>
        </div>
      </header>
      {isEditing ? (
        <div className="wbeta-memory-card-editor">
          <textarea
            className="wbeta-memory-card-textarea"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={Math.max(4, draftContent.split("\n").length)}
            disabled={busy}
            autoFocus
          />
          <div className="wbeta-memory-card-editor-row">
            <label className="wbeta-memory-card-type-label">
              Kind
              <InfoHint text="This controls how Basquio reuses the saved item. Pick Context for normal client or category material." />
              <select
                value={draftType}
                onChange={(e) => setDraftType(e.target.value as MemoryType)}
                disabled={busy}
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {MEMORY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <div className="wbeta-memory-card-editor-actions">
              <button
                type="button"
                className="wbeta-memory-card-cancel"
                onClick={() => {
                  setDraftContent(entry.content);
                  setDraftType(entry.memory_type);
                  onEditCancel();
                }}
                disabled={busy}
              >
                <X size={12} weight="bold" /> Cancel
              </button>
              <button
                type="button"
                className="wbeta-memory-card-save"
                onClick={save}
                aria-busy={busy}
                data-loading={busy ? "true" : undefined}
                disabled={busy || (draftContent === entry.content && draftType === entry.memory_type)}
              >
                <CheckCircle size={12} weight="fill" /> Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <pre className="wbeta-memory-card-body">{entry.content}</pre>
      )}
      <footer className="wbeta-memory-card-foot">
        <span>Updated {formatRelative(entry.updated_at)}</span>
        {entry.metadata?.taught_by ? (
          <span>by {String(entry.metadata.taught_by)}</span>
        ) : null}
      </footer>
    </article>
  );
}

function NewMemoryForm({
  scopes,
  onCancel,
  onCreate,
}: {
  scopes: WorkspaceScope[];
  onCancel: () => void;
  onCreate: (input: { scopeId: string; type: MemoryType; content: string }) => Promise<void>;
}) {
  const defaultScopeId =
    scopes.find((s) => s.kind === "system" && s.slug === "workspace")?.id ?? scopes[0]?.id ?? "";
  const [scopeId, setScopeId] = useState(defaultScopeId);
  const [type, setType] = useState<MemoryType>("semantic");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!scopeId || !content.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate({ scopeId, type, content: content.trim() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="wbeta-memory-card wbeta-memory-card-creating" aria-busy={busy}>
      <header className="wbeta-memory-card-head">
        <div className="wbeta-memory-card-meta">
          <span className="wbeta-memory-card-scope wbeta-memory-card-scope-new">New</span>
          <span className="wbeta-memory-card-path">Add reusable context</span>
        </div>
      </header>
      <div className="wbeta-memory-card-editor">
        <textarea
          className="wbeta-memory-card-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What should Basquio remember? Example: for Despar, Marca del Distributore means private label."
          rows={5}
          disabled={busy}
          autoFocus
        />
        <div className="wbeta-memory-card-editor-row">
          <label className="wbeta-memory-card-type-label">
            Applies to
            <InfoHint text={SCOPE_HELP} />
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} disabled={busy}>
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.kind === "system" ? s.name : `${s.kind}: ${s.name}`}
                </option>
              ))}
            </select>
          </label>
          <label className="wbeta-memory-card-type-label">
            Kind
            <InfoHint text="Context is the default. Use Instructions for behavior and Examples for patterns worth repeating." />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MemoryType)}
              disabled={busy}
            >
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {MEMORY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <div className="wbeta-memory-card-editor-actions">
            <button type="button" className="wbeta-memory-card-cancel" onClick={onCancel} disabled={busy}>
              <X size={12} weight="bold" /> Cancel
            </button>
            <button
              type="button"
              className="wbeta-memory-card-save"
              onClick={submit}
              aria-busy={busy}
              data-loading={busy ? "true" : undefined}
              disabled={busy || !scopeId || !content.trim()}
            >
              <CheckCircle size={12} weight="fill" /> Save knowledge
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function formatRelative(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function memoryOriginLabel(entry: MemoryRow): string {
  const via = typeof entry.metadata?.via === "string" ? entry.metadata.via : null;
  if (via === "chat") return "From chat";
  if (via === "onboarding") return "From setup";
  if (via) return `From ${via}`;
  return `Saved ${MEMORY_TYPE_LABELS[entry.memory_type].toLowerCase()}`;
}

function InfoHint({ text }: { text: string }) {
  return (
    <span className="wbeta-info-hint" tabIndex={0} aria-label={text}>
      <Info size={11} weight="bold" />
      <span className="wbeta-info-hint-tip" role="tooltip">
        {text}
      </span>
    </span>
  );
}
