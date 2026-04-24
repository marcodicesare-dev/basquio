"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Buildings,
  CheckCircle,
  Paperclip,
  Presentation,
  Sparkle,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

import { WorkspaceSkeleton } from "@/components/workspace-skeleton";

type PackSourceFile = {
  id: string;
  kind: string;
  fileName: string;
};

type Pack = {
  workspaceId: string;
  workspaceScopeId: string | null;
  scope: { id: string | null; kind: string | null; name: string | null };
  stakeholders: Array<{
    id: string;
    name: string;
    role: string | null;
    preferences: Record<string, unknown>;
  }>;
  rules: { workspace: string[]; analyst: string[]; scoped: string[] };
  sourceFiles: PackSourceFile[];
  citedSources: Array<{ documentId: string; fileName: string; sourceFileId: string | null }>;
  lineage: {
    conversationId: string | null;
    messageId: string | null;
    deliverableTitle: string | null;
    prompt: string | null;
    launchSource: string;
  };
  styleContract: {
    language: string | null;
    tone: string | null;
    deckLength: string | null;
    chartPreferences: string[];
  };
  renderedBriefPrelude: string;
  createdAt: string;
  schemaVersion: number;
  deliverableId: string | null;
};

type Brief = {
  title: string;
  objective: string;
  narrative: string;
  audience: string;
  thesis: string;
  stakes: string;
  slideCount: number;
};

export type WorkspaceGenerationDraftBrief = {
  brief?: {
    title?: string;
    objective?: string;
    audience?: string;
    language?: string | null;
    deck_length?: string | null;
    thesis?: string | null;
    stakes?: string | null;
    extra_instructions?: string | null;
  };
  include_research?: boolean;
  sourceText?: string | null;
};

type PrepareResponse = {
  pack: Pack;
  brief: Brief;
};

type GenerateResponse = {
  runId: string;
  statusUrl: string;
  progressUrl: string;
};

export type WorkspaceGenerationDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Exactly one of these must be set. */
  conversationId?: string | null;
  deliverableId?: string | null;
  messageId?: string | null;
  scopeId?: string | null;
  draftBrief?: WorkspaceGenerationDraftBrief | null;
  onLaunched?: (args: { runId: string; progressUrl: string }) => void;
};

export function WorkspaceGenerationDrawer({
  open,
  onClose,
  conversationId,
  deliverableId,
  messageId,
  scopeId,
  draftBrief,
  onLaunched,
}: WorkspaceGenerationDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pack, setPack] = useState<Pack | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [removedFileIds, setRemovedFileIds] = useState<Set<string>>(new Set());
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const firstFocusRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!conversationId && !deliverableId) {
      setLoadError("Nothing to generate: no conversation or memo supplied.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setPack(null);
    setBrief(null);
    setRemovedFileIds(new Set());
    (async () => {
      try {
        const response = await fetch("/api/workspace/prepare-generation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            conversationId: conversationId ?? undefined,
            deliverableId: deliverableId ?? null,
            messageId: messageId ?? null,
            scopeId: scopeId ?? null,
          }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Could not prepare the brief.");
        }
        const data = (await response.json()) as PrepareResponse;
        if (cancelled) return;
        setPack(data.pack);
        setBrief(applyDraftBrief(data.brief, draftBrief));
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Could not prepare the brief.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, deliverableId, messageId, scopeId, draftBrief]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !launching) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, launching, onClose]);

  useEffect(() => {
    if (open && brief && firstFocusRef.current) {
      firstFocusRef.current.focus();
      firstFocusRef.current.setSelectionRange(
        firstFocusRef.current.value.length,
        firstFocusRef.current.value.length,
      );
    }
  }, [open, brief]);

  const activeFiles = pack
    ? pack.sourceFiles.filter((f) => !removedFileIds.has(f.id))
    : [];

  const handleLaunch = useCallback(async () => {
    if (!pack || !brief || launching) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const trimmedPack: Pack = {
        ...pack,
        sourceFiles: pack.sourceFiles.filter((f) => !removedFileIds.has(f.id)),
      };
      const response = await fetch("/api/workspace/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack: trimmedPack, brief }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<GenerateResponse> & {
        error?: string;
      };
      if (!response.ok || !data.runId || !data.progressUrl) {
        throw new Error(data.error ?? "Could not start generation.");
      }
      onLaunched?.({ runId: data.runId, progressUrl: data.progressUrl });
      onClose();
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Could not start generation.");
    } finally {
      setLaunching(false);
    }
  }, [pack, brief, launching, removedFileIds, onLaunched, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="wbeta-gen-backdrop"
        onClick={() => {
          if (!launching) onClose();
        }}
        role="presentation"
      />
      <aside
        className="wbeta-gen-drawer"
        role="dialog"
        aria-label="Generate deck from workspace"
        aria-modal
        aria-busy={loading || launching}
      >
        <header className="wbeta-gen-head">
          <div>
            <p className="wbeta-gen-kicker">
              <Sparkle size={12} weight="fill" /> Generate deck
            </p>
            <h2 className="wbeta-gen-title">
              {brief?.title ?? (loading ? "Preparing brief" : "New deck")}
            </h2>
          </div>
          <button
            type="button"
            className="wbeta-gen-close"
            onClick={onClose}
            disabled={launching}
            aria-label="Close"
          >
            <X size={16} weight="bold" />
          </button>
        </header>

        <div className="wbeta-gen-body">
          {loading ? (
            <div className="wbeta-gen-loading" role="status" aria-label="Preparing generation brief">
              <WorkspaceSkeleton density="card" height={96} label="Preparing generation brief" />
              <div className="wbeta-gen-loading-copy">
                <WorkspaceSkeleton density="line" width="62%" label="Preparing generation title" />
                <WorkspaceSkeleton density="line" width="44%" label="Preparing generation source list" />
                <p>Reading the conversation, workspace memory, and stakeholder preferences.</p>
              </div>
            </div>
          ) : loadError ? (
            <div className="wbeta-gen-error" role="alert">
              <WarningCircle size={14} weight="fill" /> {loadError}
            </div>
          ) : pack && brief ? (
            <>
              <section className="wbeta-gen-section">
                <label className="wbeta-gen-field-label">Brief</label>
                <p className="wbeta-gen-field-hint">
                  Prepared from the selected chat turn and workspace context. Edit anything that does not land.
                </p>
                <textarea
                  ref={firstFocusRef}
                  className="wbeta-gen-brief"
                  value={brief.narrative}
                  onChange={(e) => setBrief({ ...brief, narrative: e.target.value })}
                  rows={6}
                  disabled={launching}
                />
              </section>

              <section className="wbeta-gen-section">
                <div className="wbeta-gen-two-col">
                  <div>
                    <label className="wbeta-gen-field-label">Audience</label>
                    <input
                      type="text"
                      className="wbeta-gen-input"
                      value={brief.audience}
                      onChange={(e) => setBrief({ ...brief, audience: e.target.value })}
                      disabled={launching}
                    />
                  </div>
                  <div>
                    <label className="wbeta-gen-field-label">Slide count</label>
                    <input
                      type="number"
                      className="wbeta-gen-input"
                      value={brief.slideCount}
                      min={5}
                      max={60}
                      onChange={(e) =>
                        setBrief({ ...brief, slideCount: Number.parseInt(e.target.value, 10) || 10 })
                      }
                      disabled={launching}
                    />
                  </div>
                </div>
              </section>

              {pack.scope.name || pack.stakeholders.length > 0 ? (
                <section className="wbeta-gen-section">
                  <label className="wbeta-gen-field-label">Context applied</label>
                  <div className="wbeta-gen-context-chips">
                    {pack.scope.name ? (
                      <span className="wbeta-gen-chip">
                        <Buildings size={11} weight="regular" />
                        {pack.scope.kind === "client"
                          ? "Client"
                          : pack.scope.kind === "category"
                            ? "Category"
                            : pack.scope.kind === "function"
                              ? "Function"
                              : "Scope"}
                        : {pack.scope.name}
                      </span>
                    ) : null}
                    {pack.stakeholders.slice(0, 2).map((s) => (
                      <span key={s.id} className="wbeta-gen-chip">
                        <UsersThree size={11} weight="regular" />
                        {s.name}
                      </span>
                    ))}
                    {pack.stakeholders.length > 2 ? (
                      <span className="wbeta-gen-chip wbeta-gen-chip-muted">
                        +{pack.stakeholders.length - 2} more
                      </span>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="wbeta-gen-section">
                <label className="wbeta-gen-field-label">
                  Evidence ({activeFiles.length}/{pack.sourceFiles.length})
                </label>
                <p className="wbeta-gen-field-hint">
                  {pack.sourceFiles.length === 0
                    ? "No cited or attached workspace files yet. Attach a file before generating; the pipeline needs data to read."
                    : "Pulled from chat attachments and cited workspace files. Remove anything irrelevant."}
                </p>
                {pack.sourceFiles.length > 0 ? (
                  <ul className="wbeta-gen-file-list">
                    {pack.sourceFiles.map((f) => {
                      const removed = removedFileIds.has(f.id);
                      return (
                        <li
                          key={f.id}
                          className={
                            removed
                              ? "wbeta-gen-file wbeta-gen-file-removed"
                              : "wbeta-gen-file"
                          }
                        >
                          <Paperclip size={11} weight="regular" />
                          <span className="wbeta-gen-file-name">{f.fileName}</span>
                          <span className="wbeta-gen-file-kind">{f.kind}</span>
                          <button
                            type="button"
                            className="wbeta-gen-file-toggle"
                            onClick={() => {
                              const next = new Set(removedFileIds);
                              if (removed) next.delete(f.id);
                              else next.add(f.id);
                              setRemovedFileIds(next);
                            }}
                            disabled={launching}
                            aria-label={removed ? `Re-include ${f.fileName}` : `Remove ${f.fileName}`}
                          >
                            <X size={11} weight="bold" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>

              {(pack.rules.workspace.length > 0 ||
                pack.rules.scoped.length > 0 ||
                pack.rules.analyst.length > 0 ||
                pack.styleContract.chartPreferences.length > 0) ? (
                <section className="wbeta-gen-section">
                  <button
                    type="button"
                    className="wbeta-gen-style-toggle"
                    onClick={() => setStylePanelOpen((s) => !s)}
                    aria-expanded={stylePanelOpen}
                  >
                    <span>Style &amp; rules applied</span>
                    <span className="wbeta-gen-style-count">
                      {pack.rules.workspace.length + pack.rules.scoped.length + pack.rules.analyst.length}{" "}
                      rules · {pack.styleContract.chartPreferences.length} preferences
                    </span>
                  </button>
                  {stylePanelOpen ? (
                    <div className="wbeta-gen-style-body">
                      {pack.rules.scoped.map((r, i) => (
                        <p key={`s-${i}`} className="wbeta-gen-rule wbeta-gen-rule-scoped">
                          · {r}
                        </p>
                      ))}
                      {pack.rules.workspace.map((r, i) => (
                        <p key={`w-${i}`} className="wbeta-gen-rule">
                          · {r}
                        </p>
                      ))}
                      {pack.rules.analyst.map((r, i) => (
                        <p key={`a-${i}`} className="wbeta-gen-rule">
                          · {r}
                        </p>
                      ))}
                      {pack.styleContract.chartPreferences.length > 0 ? (
                        <p className="wbeta-gen-rule">
                          · Charts: {pack.styleContract.chartPreferences.join("; ")}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="wbeta-gen-field-hint">
                      Edit in the Memory or People pages.
                    </p>
                  )}
                </section>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="wbeta-gen-foot">
          {launchError ? (
            <p className="wbeta-gen-error" role="alert">
              <WarningCircle size={12} weight="fill" /> {launchError}
            </p>
          ) : null}
          <div className="wbeta-gen-actions">
            <button
              type="button"
              className="wbeta-gen-cancel"
              onClick={onClose}
              disabled={launching}
            >
              Cancel
            </button>
            <button
              type="button"
              className="wbeta-gen-launch"
              onClick={handleLaunch}
              aria-busy={launching}
              data-loading={launching ? "true" : undefined}
              disabled={
                launching ||
                loading ||
                !pack ||
                !brief ||
                pack.sourceFiles.length === 0 ||
                activeFiles.length === 0
              }
            >
              {launching ? (
                <>
                  <Sparkle size={13} weight="fill" /> Starting
                </>
              ) : (
                <>
                  <Presentation size={13} weight="regular" /> Start deck generation
                </>
              )}
            </button>
          </div>
          {pack && brief && !launching ? (
            <p className="wbeta-gen-foot-hint">
              {activeFiles.length} file{activeFiles.length === 1 ? "" : "s"} ·{" "}
              {brief.slideCount} slides ·{" "}
              {pack.stakeholders.length > 0
                ? `styled for ${pack.stakeholders[0].name}`
                : "house style"}
            </p>
          ) : null}
          {pack && pack.sourceFiles.length === 0 ? (
            <p className="wbeta-gen-foot-hint wbeta-gen-foot-hint-warn">
              <CheckCircle size={11} weight="fill" /> Add at least one file to the chat (drag onto the pane or paperclip) and the workspace will wire it automatically.
            </p>
          ) : null}
        </footer>
      </aside>
    </>
  );
}

function applyDraftBrief(base: Brief, draftBrief?: WorkspaceGenerationDraftBrief | null): Brief {
  const draft = draftBrief?.brief;
  const sourceNarrative = extractDraftNarrative(draftBrief?.sourceText);
  if (!draft) {
    return sourceNarrative ? { ...base, narrative: sourceNarrative } : base;
  }
  const slideCount = parseDeckLength(draft.deck_length) ?? base.slideCount;
  return {
    ...base,
    title: cleanDraftField(draft.title) ?? base.title,
    objective: cleanDraftField(draft.objective) ?? base.objective,
    narrative: sourceNarrative ?? base.narrative,
    audience: cleanDraftField(draft.audience) ?? base.audience,
    thesis: cleanDraftField(draft.thesis) ?? base.thesis,
    stakes: cleanDraftField(draft.stakes) ?? base.stakes,
    slideCount,
  };
}

function cleanDraftField(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function parseDeckLength(value: string | null | undefined): number | null {
  const match = value?.match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractDraftNarrative(sourceText: string | null | undefined): string | null {
  const text = sourceText?.trim();
  if (!text) return null;
  const markers = ["Brief:", "Titolo:", "Obiettivo del deck", "Objective"];
  const indexes = markers
    .map((marker) => text.indexOf(marker))
    .filter((index) => index >= 0);
  const start = indexes.length > 0 ? Math.min(...indexes) : 0;
  const narrative = text.slice(start).trim();
  return narrative.length > 0 ? narrative : null;
}
