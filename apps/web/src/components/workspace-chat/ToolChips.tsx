"use client";

import { useState } from "react";
import {
  Brain,
  CaretDown,
  CaretRight,
  CheckCircle,
  FileArrowDown,
  Globe,
  Info,
  Lightbulb,
  MagnifyingGlass,
  PencilSimpleLine,
  PushPinSimple,
  Sparkle,
  UserPlus,
  WarningCircle,
} from "@phosphor-icons/react";

import { MEMORY_TYPE_LABELS, type MemoryType } from "@/lib/workspace/types";

type ToolState = "input-streaming" | "input-available" | "output-available" | "output-error" | string;

/**
 * MemoryReadChip: subtle system chip rendered when the agent calls the `memory` tool.
 * User-facing copy calls this saved knowledge; the backend still uses memory.
 */
export function MemoryReadChip({
  state,
  input,
  output,
  errorText,
}: {
  state: ToolState;
  input?: { scope?: string; memory_type?: string; query?: string; limit?: number };
  output?: {
    resolved_scope?: { name: string; kind: string } | null;
    count?: number;
    entries?: Array<{ id: string; memory_type: string; content: string; pinned?: boolean }>;
  };
  errorText?: string;
}) {
  const [open, setOpen] = useState(false);
  const scopeName = output?.resolved_scope?.name ?? input?.scope ?? "workspace";
  const isDone = state === "output-available";
  const isError = state === "output-error";
  const count = output?.count ?? 0;

  return (
    <div className={`wbeta-ai-tool-chip ${isError ? "wbeta-ai-tool-chip-error" : ""}`}>
      <button
        type="button"
        className="wbeta-ai-tool-chip-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wbeta-ai-tool-icon" aria-hidden>
          <Brain size={14} weight={isDone ? "fill" : "regular"} />
        </span>
        <span className="wbeta-ai-tool-chip-label">
          {isError
            ? "I could not check what I remember"
            : isDone
              ? count === 0
                ? `I checked what I remember about ${scopeName}`
                : `Used ${count} ${count === 1 ? "thing" : "things"} you taught me about ${scopeName}`
              : `Checking what I remember about ${scopeName}`}
        </span>
        <span className="wbeta-ai-tool-caret" aria-hidden>
          {open ? <CaretDown size={10} weight="bold" /> : <CaretRight size={10} weight="bold" />}
        </span>
      </button>
      {open && isDone && output?.entries && output.entries.length > 0 ? (
        <ul className="wbeta-ai-tool-chip-entries">
          {output.entries.slice(0, 8).map((entry) => (
            <li key={entry.id} className="wbeta-ai-tool-chip-entry">
              <span className="wbeta-ai-tool-chip-entry-kind">
                {memoryTypeLabel(entry.memory_type)}
              </span>
              {entry.pinned ? (
                <span className="wbeta-ai-tool-chip-entry-pin" aria-label="Pinned">
                  <PushPinSimple size={10} weight="fill" />
                </span>
              ) : null}
              <span className="wbeta-ai-tool-chip-entry-body">{entry.content}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {open && isError && errorText ? (
        <p className="wbeta-ai-tool-chip-error-text">{errorText}</p>
      ) : null}
    </div>
  );
}

/**
 * RetrieveContextChip: subtle system chip when agent calls retrieveContext.
 */
export function RetrieveContextChip({
  state,
  output,
  errorText,
}: {
  state: ToolState;
  input?: { query?: string; scope?: string };
  output?: {
    scope?: { name: string; kind: string } | null;
    chunk_count?: number;
    entity_count?: number;
    fact_count?: number;
    auto_attached_count?: number;
    auto_attached_document_ids?: string[];
    chunks?: Array<{
      label: string;
      source_type?: string;
      filename?: string | null;
      content?: string;
      auto_attached?: boolean;
    }>;
  };
  errorText?: string;
}) {
  const [open, setOpen] = useState(false);
  const isDone = state === "output-available";
  const isError = state === "output-error";
  const chunks = output?.chunk_count ?? 0;
  const facts = output?.fact_count ?? 0;
  const autoAttached = output?.auto_attached_count ?? 0;

  return (
    <div className={`wbeta-ai-tool-chip ${isError ? "wbeta-ai-tool-chip-error" : ""}`}>
      <button
        type="button"
        className="wbeta-ai-tool-chip-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wbeta-ai-tool-icon" aria-hidden>
          <MagnifyingGlass size={14} weight={isDone ? "bold" : "regular"} />
        </span>
        <span className="wbeta-ai-tool-chip-label">
          {isError
            ? "I could not search your files"
            : isDone
              ? chunks === 0 && facts === 0
                ? "I checked your files. Nothing relevant yet."
                : autoAttached > 0
                  ? `Read ${chunks} ${chunks === 1 ? "excerpt" : "excerpts"} and pulled ${autoAttached} ${autoAttached === 1 ? "file" : "files"} into this chat`
                  : `Read ${chunks} ${chunks === 1 ? "excerpt" : "excerpts"} from your files${facts > 0 ? ` and ${facts} ${facts === 1 ? "fact" : "facts"}` : ""}`
              : "Reading your files"}
        </span>
        <span className="wbeta-ai-tool-caret" aria-hidden>
          {open ? <CaretDown size={10} weight="bold" /> : <CaretRight size={10} weight="bold" />}
        </span>
      </button>
      {open && isDone && output ? (
        <dl className="wbeta-ai-tool-chip-stats">
          <div>
            <dt>Chunks</dt>
            <dd>{output.chunk_count ?? 0}</dd>
          </div>
          <div>
            <dt>Entities</dt>
            <dd>{output.entity_count ?? 0}</dd>
          </div>
          <div>
            <dt>Facts</dt>
            <dd>{output.fact_count ?? 0}</dd>
          </div>
          {output.scope ? (
            <div>
              <dt>Scope</dt>
              <dd>{output.scope.name}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {open && isDone && output?.chunks && output.chunks.length > 0 ? (
        <ul className="wbeta-ai-tool-chip-entries">
          {output.chunks.slice(0, 6).map((chunk) => (
            <li key={chunk.label} className="wbeta-ai-tool-chip-entry">
              <span className="wbeta-ai-tool-chip-entry-kind">{chunk.label}</span>
              <span className="wbeta-ai-tool-chip-entry-body">
                {sourceDisplayName(chunk)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {open && isError && errorText ? (
        <p className="wbeta-ai-tool-chip-error-text">{errorText}</p>
      ) : null}
    </div>
  );
}

function sourceDisplayName(chunk: {
  source_type?: string;
  filename?: string | null;
  content?: string;
}): string {
  const filename = chunk.filename?.trim();
  if (filename) return filename;
  if (chunk.source_type) return chunk.source_type.replaceAll("_", " ");
  return chunk.content?.slice(0, 80) ?? "Workspace source";
}

function memoryTypeLabel(value?: string): string {
  if (value === "procedural" || value === "semantic" || value === "episodic") {
    return MEMORY_TYPE_LABELS[value as MemoryType];
  }
  return "Memory";
}

/**
 * TeachRuleCard: bold affirmative card rendered when agent calls teachRule.
 * Per Marco 7c: user-facing explicit save moment should feel like a confirmation.
 */
export function TeachRuleCard({
  state,
  input,
  output,
  errorText,
}: {
  state: ToolState;
  input?: { scope: string; memory_type: string; content: string };
  output?: {
    ok?: boolean;
    error?: string;
    scope?: { name: string; kind: string };
    memory_type?: string;
    content?: string;
    entry_id?: string;
  };
  errorText?: string;
}) {
  const isDone = state === "output-available";
  const isError = state === "output-error" || output?.ok === false;
  const title = output?.scope?.name ?? input?.scope ?? "workspace";
  const kind = memoryTypeLabel(output?.memory_type ?? input?.memory_type);

  if (isError) {
    return (
      <div className="wbeta-ai-teach-card wbeta-ai-teach-card-error">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <WarningCircle size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">Could not save that knowledge.</p>
            <p className="wbeta-ai-teach-body">{output?.error ?? errorText ?? "Try rephrasing."}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wbeta-ai-teach-card">
      <div className="wbeta-ai-teach-head">
        <span className="wbeta-ai-teach-icon" aria-hidden>
          <CheckCircle size={18} weight="fill" />
        </span>
        <div className="wbeta-ai-teach-copy">
          <p className="wbeta-ai-teach-title">
            {isDone ? `${kind} saved` : `Saving ${kind.toLowerCase()}`} to {title}
          </p>
          <p className="wbeta-ai-teach-body">
            {output?.content ?? input?.content ?? ""}
          </p>
        </div>
      </div>
      {output?.entry_id ? (
        <div className="wbeta-ai-teach-foot">
          <a className="wbeta-ai-teach-link" href={`/workspace/memory?entry=${output.entry_id}`}>
            Open in Memory
          </a>
        </div>
      ) : null}
    </div>
  );
}

/**
 * MetricCard: generative UI card rendering a single KPI number.
 * Emitted by the showMetricCard tool. Designed; no emojis.
 */
export function MetricCard({
  input,
}: {
  state: ToolState;
  input?: {
    subject: string;
    metric: string;
    value: string | number;
    unit?: string;
    period?: string;
    delta?: string;
    retailer?: string;
    source_label?: string;
  };
  output?: unknown;
}) {
  if (!input) return null;
  return (
    <div className="wbeta-ai-metric-card">
      <p className="wbeta-ai-metric-eyebrow">
        {input.metric}
        {input.retailer ? ` · ${input.retailer}` : ""}
      </p>
      <p className="wbeta-ai-metric-value">
        {input.value}
        {input.unit ? <span className="wbeta-ai-metric-unit">{input.unit}</span> : null}
      </p>
      <p className="wbeta-ai-metric-meta">
        {input.subject}
        {input.period ? <span aria-hidden> · </span> : null}
        {input.period ?? ""}
      </p>
      {input.delta ? <p className="wbeta-ai-metric-delta">{input.delta}</p> : null}
      {input.source_label ? (
        <p className="wbeta-ai-metric-source">Source [{input.source_label}]</p>
      ) : null}
    </div>
  );
}

/**
 * StakeholderCard: generative UI card for a person entity.
 */
export function StakeholderCard({
  input,
  output,
}: {
  state: ToolState;
  input?: { name: string; role?: string; company?: string; preferences?: string[] };
  output?: { card?: { person_id?: string | null } };
}) {
  if (!input) return null;
  const personId = output?.card?.person_id ?? null;
  return (
    <div className="wbeta-ai-stakeholder-card">
      <div className="wbeta-ai-stakeholder-head">
        <p className="wbeta-ai-stakeholder-name">{input.name}</p>
        {input.role ? <p className="wbeta-ai-stakeholder-role">{input.role}</p> : null}
        {input.company ? <p className="wbeta-ai-stakeholder-company">{input.company}</p> : null}
      </div>
      {input.preferences && input.preferences.length > 0 ? (
        <ul className="wbeta-ai-stakeholder-prefs">
          {input.preferences.slice(0, 5).map((pref, i) => (
            <li key={i}>{pref}</li>
          ))}
        </ul>
      ) : null}
      {personId ? (
        <a className="wbeta-ai-stakeholder-link" href={`/workspace/people/${personId}`}>
          Open profile
        </a>
      ) : null}
    </div>
  );
}

// ── Approval card primitives (spec §7.1) ────────────────────────────
//
// Each card reuses the `wbeta-ai-teach-card` chrome so the visual
// language stays consistent with the existing TeachRuleCard. Action
// buttons dispatch follow-up chat turns via onSendFollowUp so the
// assistant re-invokes the tool with dry_run: false and the cached
// extraction_id (saveFromPaste, scrapeUrl) or the confirmed patch
// (editStakeholder, createStakeholder, editRule).

export type ApprovalFollowUp = (text: string) => void;

export type BriefDraftCardOutput = {
  ok?: boolean;
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
  scope?: { id: string; name: string; kind: string } | null;
  context_preview?: {
    scoped_stakeholder_count?: number;
    workspace_memory_count?: number;
    workspace_file_count?: number;
  };
  include_research?: boolean;
};

type IngestPreviewEntity = {
  type: string;
  canonical_name: string;
  role?: string | null;
  description?: string | null;
};
type IngestPreviewFact = {
  subject: string;
  predicate: string;
  object_value: unknown;
  valid_from?: string | null;
  confidence: number;
};

type ExtractionPreview = {
  entity_count: number;
  fact_count: number;
  source_hint?: string;
  source_label?: string;
  entities?: IngestPreviewEntity[];
  facts?: IngestPreviewFact[];
};

/**
 * ExtractionApprovalCard: rendered by saveFromPaste and scrapeUrl
 * when dry_run returns. Shows counts + top entities/facts. On
 * approval fires the persist turn.
 */
export function ExtractionApprovalCard({
  state,
  input,
  output,
  errorText,
  onSendFollowUp,
  toolName,
}: {
  state: ToolState;
  input?: { text?: string; url?: string; source_hint?: string; source_label?: string };
  output?: {
    ok?: boolean;
    stage?: "dry_run" | "persist";
    error?: string;
    extraction_id?: string;
    document_id?: string;
    source_url?: string;
    title?: string;
    entity_count?: number;
    fact_count?: number;
    attached_to_conversation?: boolean;
    preview?: ExtractionPreview;
  };
  errorText?: string;
  onSendFollowUp?: ApprovalFollowUp;
  toolName: "saveFromPaste" | "scrapeUrl";
}) {
  const [open, setOpen] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const isDone = state === "output-available";
  const isError = state === "output-error" || output?.ok === false;
  const stage = output?.stage ?? "dry_run";

  if (isError) {
    return (
      <div className="wbeta-ai-teach-card wbeta-ai-teach-card-error">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <WarningCircle size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">
              {toolName === "scrapeUrl" ? "URL scrape failed" : "Paste extract failed"}
            </p>
            <p className="wbeta-ai-teach-body">
              {output?.error ?? errorText ?? "Try again with different input."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "persist" && isDone) {
    return (
      <div className="wbeta-ai-teach-card">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <CheckCircle size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">
              {toolName === "scrapeUrl" ? "URL saved" : "Paste saved"}
            </p>
            <p className="wbeta-ai-teach-body">
              {output?.entity_count ?? 0} entities and {output?.fact_count ?? 0} facts extracted.
              {output?.attached_to_conversation ? " Attached to this conversation." : ""}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const preview = output?.preview;
  const title =
    toolName === "scrapeUrl"
      ? output?.title ?? new URL(input?.url ?? "https://example.com").hostname
      : input?.source_label ?? input?.source_hint ?? "chat paste";
  const extractionId = output?.extraction_id;

  function approve() {
    if (!onSendFollowUp || !extractionId) return;
    setConfirmed(true);
    const cmd =
      toolName === "scrapeUrl"
        ? `Approve URL scrape ${extractionId}`
        : `Approve paste extraction ${extractionId}`;
    onSendFollowUp(cmd);
  }
  function discard() {
    if (!onSendFollowUp) return;
    setConfirmed(true);
    onSendFollowUp(`Discard extraction ${extractionId ?? "pending"}`);
  }

  return (
    <div className="wbeta-ai-teach-card wbeta-ai-approval-card">
      <button
        type="button"
        className="wbeta-ai-teach-head wbeta-ai-approval-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wbeta-ai-teach-icon" aria-hidden>
          {toolName === "scrapeUrl" ? (
            <Globe size={18} weight={isDone ? "fill" : "regular"} />
          ) : (
            <FileArrowDown size={18} weight={isDone ? "fill" : "regular"} />
          )}
        </span>
        <div className="wbeta-ai-teach-copy">
          <p className="wbeta-ai-teach-title">
            {toolName === "scrapeUrl" ? "Review scraped article" : "Review paste before saving"}
          </p>
          <p className="wbeta-ai-teach-body">
            {title} · {preview?.entity_count ?? 0} entities · {preview?.fact_count ?? 0} facts
          </p>
        </div>
        <span className="wbeta-ai-tool-caret" aria-hidden>
          {open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
        </span>
      </button>
      {open && preview ? (
        <div className="wbeta-ai-approval-body">
          {preview.entities && preview.entities.length > 0 ? (
            <ul className="wbeta-ai-approval-list">
              {preview.entities.slice(0, 8).map((e, i) => (
                <li key={`e-${i}`}>
                  <span className="wbeta-ai-approval-kind">{e.type}</span>
                  <span>{e.canonical_name}</span>
                  {e.role ? <span className="wbeta-ai-approval-muted"> · {e.role}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.facts && preview.facts.length > 0 ? (
            <ul className="wbeta-ai-approval-list">
              {preview.facts.slice(0, 6).map((f, i) => (
                <li key={`f-${i}`}>
                  <span className="wbeta-ai-approval-kind">{f.predicate}</span>
                  <span>
                    {f.subject} → {formatObjectValue(f.object_value)}
                  </span>
                  <span className="wbeta-ai-approval-muted">
                    {" "}
                    · {Math.round(f.confidence * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {isDone && extractionId ? (
        <div className="wbeta-ai-approval-actions">
          <button
            type="button"
            className="wbeta-ai-action-btn wbeta-ai-approval-btn-primary"
            onClick={approve}
            disabled={confirmed || !onSendFollowUp}
          >
            <CheckCircle size={12} weight="fill" /> Save all
          </button>
          <button
            type="button"
            className="wbeta-ai-action-btn"
            onClick={discard}
            disabled={confirmed || !onSendFollowUp}
          >
            Discard
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatObjectValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 120);
  return String(v).slice(0, 160);
}

/**
 * StakeholderEditApprovalCard: shown by editStakeholder in dry-run
 * (status === "preview"). Renders the before/after diff so the user
 * can approve the patch before metadata is written.
 */
export function StakeholderEditApprovalCard({
  state,
  output,
  errorText,
  onSendFollowUp,
}: {
  state: ToolState;
  input?: unknown;
  output?: {
    ok?: boolean;
    status?: "preview" | "updated" | "not_found" | "error";
    person_id?: string;
    canonical_name?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    suggestions?: Array<{ person_id: string; name: string; role: string | null }>;
    error?: string;
    message?: string;
  };
  errorText?: string;
  onSendFollowUp?: ApprovalFollowUp;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const isDone = state === "output-available";
  const status = output?.status;

  if (status === "not_found") {
    return (
      <div className="wbeta-ai-teach-card wbeta-ai-approval-card">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <Info size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">No matching stakeholder</p>
            <p className="wbeta-ai-teach-body">
              {output?.message ?? "Clarify the name or create a new profile."}
            </p>
          </div>
        </div>
        {output?.suggestions && output.suggestions.length > 0 ? (
          <ul className="wbeta-ai-approval-list">
            {output.suggestions.map((s) => (
              <li key={s.person_id}>
                <span>{s.name}</span>
                {s.role ? <span className="wbeta-ai-approval-muted"> · {s.role}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (state === "output-error" || status === "error") {
    return (
      <div className="wbeta-ai-teach-card wbeta-ai-teach-card-error">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <WarningCircle size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">Update failed</p>
            <p className="wbeta-ai-teach-body">
              {output?.error ?? errorText ?? "Try again."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "updated") {
    return (
      <div className="wbeta-ai-teach-card">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <CheckCircle size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">
              {output?.canonical_name ?? "Stakeholder"} updated
            </p>
          </div>
        </div>
        {output?.person_id ? (
          <div className="wbeta-ai-teach-foot">
            <a className="wbeta-ai-teach-link" href={`/workspace/people/${output.person_id}`}>
              Open profile
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  // Preview: render diff with action buttons.
  const before = output?.before ?? {};
  const after = output?.after ?? {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
    (k) => renderableDiffValue(before[k]) !== renderableDiffValue(after[k]),
  );

  function approve() {
    if (!onSendFollowUp || !output?.person_id) return;
    setConfirmed(true);
    onSendFollowUp(`Approve stakeholder update ${output.person_id}`);
  }
  function cancel() {
    if (!onSendFollowUp) return;
    setConfirmed(true);
    onSendFollowUp("Cancel stakeholder update");
  }

  return (
    <div className="wbeta-ai-teach-card wbeta-ai-approval-card">
      <div className="wbeta-ai-teach-head">
        <span className="wbeta-ai-teach-icon" aria-hidden>
          <PencilSimpleLine size={18} weight="regular" />
        </span>
        <div className="wbeta-ai-teach-copy">
          <p className="wbeta-ai-teach-title">
            Review changes to {output?.canonical_name ?? "stakeholder"}
          </p>
        </div>
      </div>
      {keys.length > 0 ? (
        <dl className="wbeta-ai-approval-diff">
          {keys.map((k) => (
            <div key={k} className="wbeta-ai-approval-diff-row">
              <dt>{k}</dt>
              <dd>
                <del>{renderableDiffValue(before[k]) || "(none)"}</del>
                <span aria-hidden> → </span>
                <strong>{renderableDiffValue(after[k]) || "(none)"}</strong>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="wbeta-ai-approval-body">No effective changes in this patch.</p>
      )}
      {isDone ? (
        <div className="wbeta-ai-approval-actions">
          <button
            type="button"
            className="wbeta-ai-action-btn wbeta-ai-approval-btn-primary"
            onClick={approve}
            disabled={confirmed || !onSendFollowUp || keys.length === 0}
          >
            <CheckCircle size={12} weight="fill" /> Update
          </button>
          <button
            type="button"
            className="wbeta-ai-action-btn"
            onClick={cancel}
            disabled={confirmed || !onSendFollowUp}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

function renderableDiffValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 160);
  return String(v);
}

/**
 * StakeholderCreateApprovalCard: dry-run preview for createStakeholder.
 */
export function StakeholderCreateApprovalCard({
  state,
  output,
  errorText,
  onSendFollowUp,
}: {
  state: ToolState;
  input?: unknown;
  output?: {
    ok?: boolean;
    status?: "preview" | "created" | "error";
    person_id?: string;
    canonical_name?: string;
    role?: string | null;
    company?: string | null;
    description?: string | null;
    aliases?: string[];
    error?: string;
  };
  errorText?: string;
  onSendFollowUp?: ApprovalFollowUp;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const isDone = state === "output-available";
  const status = output?.status;

  if (state === "output-error" || status === "error") {
    return (
      <div className="wbeta-ai-teach-card wbeta-ai-teach-card-error">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <WarningCircle size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">Could not create stakeholder</p>
            <p className="wbeta-ai-teach-body">{output?.error ?? errorText ?? ""}</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "created") {
    return (
      <div className="wbeta-ai-teach-card">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <UserPlus size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">
              {output?.canonical_name ?? "Stakeholder"} created
            </p>
          </div>
        </div>
        {output?.person_id ? (
          <div className="wbeta-ai-teach-foot">
            <a className="wbeta-ai-teach-link" href={`/workspace/people/${output.person_id}`}>
              Open profile
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  function approve() {
    if (!onSendFollowUp) return;
    setConfirmed(true);
    onSendFollowUp(`Approve stakeholder creation for ${output?.canonical_name ?? ""}`);
  }
  function cancel() {
    if (!onSendFollowUp) return;
    setConfirmed(true);
    onSendFollowUp("Cancel stakeholder creation");
  }

  return (
    <div className="wbeta-ai-teach-card wbeta-ai-approval-card">
      <div className="wbeta-ai-teach-head">
        <span className="wbeta-ai-teach-icon" aria-hidden>
          <UserPlus size={18} weight="regular" />
        </span>
        <div className="wbeta-ai-teach-copy">
          <p className="wbeta-ai-teach-title">
            Create new stakeholder: {output?.canonical_name ?? ""}
          </p>
          <p className="wbeta-ai-teach-body">
            {output?.role ?? "role unknown"}
            {output?.company ? ` at ${output.company}` : ""}
          </p>
        </div>
      </div>
      {output?.description ? (
        <p className="wbeta-ai-approval-body">{output.description}</p>
      ) : null}
      {output?.aliases && output.aliases.length > 0 ? (
        <p className="wbeta-ai-approval-muted">Aliases: {output.aliases.join(", ")}</p>
      ) : null}
      {isDone ? (
        <div className="wbeta-ai-approval-actions">
          <button
            type="button"
            className="wbeta-ai-action-btn wbeta-ai-approval-btn-primary"
            onClick={approve}
            disabled={confirmed || !onSendFollowUp}
          >
            <CheckCircle size={12} weight="fill" /> Create
          </button>
          <button
            type="button"
            className="wbeta-ai-action-btn"
            onClick={cancel}
            disabled={confirmed || !onSendFollowUp}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * RuleEditApprovalCard: renders editRule outputs. For destructive
 * actions (archive, delete) the confirmation UI is primary; for
 * non-destructive actions (create, update, pin) the rendering is a
 * confirmation of a completed action (mirrors TeachRuleCard).
 */
export function RuleEditApprovalCard({
  state,
  input,
  output,
  errorText,
}: {
  state: ToolState;
  input?: { action?: string; reason?: string; content?: string };
  output?: {
    ok?: boolean;
    action?: string;
    entry_id?: string;
    content?: string;
    memory_type?: string;
    scope?: { name: string; kind: string };
    error?: string;
  };
  errorText?: string;
}) {
  const isError = state === "output-error" || output?.ok === false;
  if (isError) {
    return (
      <div className="wbeta-ai-teach-card wbeta-ai-teach-card-error">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <WarningCircle size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">Memory edit failed</p>
            <p className="wbeta-ai-teach-body">
              {output?.error ?? errorText ?? "Try again."}
            </p>
          </div>
        </div>
      </div>
    );
  }
  const action = output?.action ?? input?.action ?? "update";
  const scopeName = output?.scope?.name ?? "workspace";
  const kind = memoryTypeLabel(output?.memory_type);
  const title =
    action === "create"
      ? `${kind} saved to ${scopeName}`
      : action === "update"
        ? "Saved knowledge updated"
        : action === "archive"
          ? "Saved knowledge archived"
          : action === "unarchive"
            ? "Saved knowledge restored"
            : action === "pin"
              ? "Saved knowledge pinned"
              : action === "unpin"
                ? "Saved knowledge unpinned"
                : action === "delete"
                  ? "Saved knowledge deleted"
                  : "Memory edit applied";
  return (
    <div className="wbeta-ai-teach-card">
      <div className="wbeta-ai-teach-head">
        <span className="wbeta-ai-teach-icon" aria-hidden>
          <CheckCircle size={18} weight="fill" />
        </span>
        <div className="wbeta-ai-teach-copy">
          <p className="wbeta-ai-teach-title">{title}</p>
          <p className="wbeta-ai-teach-body">{output?.content ?? input?.content ?? ""}</p>
        </div>
      </div>
      {output?.entry_id && action !== "delete" ? (
        <div className="wbeta-ai-teach-foot">
          <a className="wbeta-ai-teach-link" href={`/workspace/memory?entry=${output.entry_id}`}>
            Open in Memory
          </a>
        </div>
      ) : null}
    </div>
  );
}

/**
 * BriefDraftCard: rendered by draftBrief. Shows the pre-filled brief
 * plus a short context preview (stakeholder count, memory, files).
 * Primary CTA opens the generation drawer pre-populated with this
 * brief; secondary refines in chat.
 */
export function BriefDraftCard({
  state,
  output,
  onSendFollowUp,
  onOpenGenerateDrawer,
}: {
  state: ToolState;
  input?: unknown;
  output?: BriefDraftCardOutput;
  onSendFollowUp?: ApprovalFollowUp;
  onOpenGenerateDrawer?: (output: BriefDraftCardOutput) => void | Promise<void>;
}) {
  const [refineSent, setRefineSent] = useState(false);
  const isDone = state === "output-available";
  if (!output || output.ok === false) return null;
  const draftOutput = output;
  const brief = output.brief ?? {};
  const preview = output.context_preview ?? {};

  function openDrawer() {
    if (!onOpenGenerateDrawer) return;
    void onOpenGenerateDrawer(draftOutput);
  }
  function refine() {
    if (!onSendFollowUp) return;
    setRefineSent(true);
    onSendFollowUp(
      `Refine the brief further. Ask me clarifying questions about thesis and stakes.`,
    );
  }

  return (
    <div className="wbeta-ai-teach-card wbeta-ai-approval-card">
      <div className="wbeta-ai-teach-head">
        <span className="wbeta-ai-teach-icon" aria-hidden>
          <Sparkle size={18} weight="fill" />
        </span>
        <div className="wbeta-ai-teach-copy">
          <p className="wbeta-ai-teach-title">Brief draft: {brief.title ?? "Workspace deck"}</p>
          <p className="wbeta-ai-teach-body">
            Audience: {brief.audience ?? "Executive stakeholder"}
            {brief.language ? ` · ${brief.language}` : ""}
            {brief.deck_length ? ` · ${brief.deck_length}` : ""}
          </p>
        </div>
      </div>
      <p className="wbeta-ai-approval-body">{brief.objective ?? ""}</p>
      <ul className="wbeta-ai-approval-list">
        <li>
          <span>{preview.scoped_stakeholder_count ?? 0} stakeholder preferences loaded</span>
        </li>
        <li>
          <span>{preview.workspace_memory_count ?? 0} workspace knowledge items apply</span>
        </li>
        <li>
          <span>{preview.workspace_file_count ?? 0} workspace files available</span>
        </li>
        {output.include_research ? (
          <li>
            <span>Research plan will run when the deck launches</span>
          </li>
        ) : null}
      </ul>
      {isDone ? (
        <div className="wbeta-ai-approval-actions">
          <button
            type="button"
            className="wbeta-ai-action-btn wbeta-ai-approval-btn-primary"
            onClick={openDrawer}
            disabled={!onOpenGenerateDrawer}
            aria-label="Generate deck from this brief"
          >
            Generate deck
            <CardInlineHelp text="Opens the deck setup with this brief already filled in. You can review it before starting." />
          </button>
          <button
            type="button"
            className="wbeta-ai-action-btn"
            onClick={refine}
            disabled={refineSent || !onSendFollowUp}
          >
            Refine in chat
            <CardInlineHelp text="Keeps working in chat and asks for sharper thesis, audience, and stakes." />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * ExplainBasquioCard: structured introspection response. Renders the
 * headline + body plus any actions the handler emitted.
 */
export function ExplainBasquioCard({
  output,
}: {
  state: ToolState;
  input?: unknown;
  output?: {
    topic?: string;
    headline?: string;
    body?: string;
    actions?: Array<{ label: string; href: string }>;
  };
}) {
  if (!output) return null;
  return (
    <div className="wbeta-ai-teach-card">
      <div className="wbeta-ai-teach-head">
        <span className="wbeta-ai-teach-icon" aria-hidden>
          <Info size={18} weight="regular" />
        </span>
        <div className="wbeta-ai-teach-copy">
          <p className="wbeta-ai-teach-title">{output.headline ?? "About Basquio"}</p>
          <p className="wbeta-ai-teach-body">{output.body ?? ""}</p>
        </div>
      </div>
      {output.actions && output.actions.length > 0 ? (
        <div className="wbeta-ai-teach-foot">
          {output.actions.map((a, i) => (
            <a key={i} className="wbeta-ai-teach-link" href={a.href}>
              {a.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * ServiceSuggestionCard: rendered by suggestServices. Each
 * recommendation is a row with service, rationale, priority pill,
 * and a [Draft brief] button that fires draftBrief via onSendFollowUp.
 */
export function ServiceSuggestionCard({
  output,
  onSendFollowUp,
}: {
  state: ToolState;
  input?: unknown;
  output?: {
    ok?: boolean;
    recommendations?: Array<{
      service_name: string;
      rationale: string;
      evidence_hooks: string[];
      typical_deliverable: string;
      priority: "high" | "medium" | "low";
    }>;
    catalog_review_pending?: boolean;
    scope?: { id: string; name: string; kind: string } | null;
    message?: string;
    error?: string;
  };
  onSendFollowUp?: ApprovalFollowUp;
}) {
  if (!output) return null;
  if (output.ok === false) {
    return (
      <div className="wbeta-ai-teach-card wbeta-ai-teach-card-error">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <WarningCircle size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">Service suggestions unavailable</p>
            <p className="wbeta-ai-teach-body">{output.error ?? ""}</p>
          </div>
        </div>
      </div>
    );
  }
  const recs = output.recommendations ?? [];
  if (recs.length === 0) {
    return (
      <div className="wbeta-ai-teach-card wbeta-ai-approval-card">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <Lightbulb size={18} weight="regular" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">No recommendations yet</p>
            <p className="wbeta-ai-teach-body">
              {output.message ?? "Share a short data summary or add a stakeholder first."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  function draftFor(serviceName: string, rationale: string) {
    if (!onSendFollowUp) return;
    onSendFollowUp(
      `Draft a brief for the service "${serviceName}". Rationale the assistant provided: ${rationale.slice(0, 400)}`,
    );
  }

  return (
    <div className="wbeta-ai-teach-card wbeta-ai-approval-card">
      <div className="wbeta-ai-teach-head">
        <span className="wbeta-ai-teach-icon" aria-hidden>
          <Lightbulb size={18} weight="fill" />
        </span>
        <div className="wbeta-ai-teach-copy">
          <p className="wbeta-ai-teach-title">
            Service ideas
            {output.scope ? ` for ${output.scope.name}` : ""}
          </p>
        </div>
      </div>
      <ul className="wbeta-ai-approval-list wbeta-ai-service-list">
        {recs.map((r, i) => (
          <li key={i} className="wbeta-ai-service-row">
            <div className="wbeta-ai-service-head">
              <span className="wbeta-ai-service-name">{r.service_name}</span>
              <span
                className={`wbeta-ai-service-priority wbeta-ai-service-priority-${r.priority}`}
              >
                {r.priority}
              </span>
            </div>
            <p className="wbeta-ai-service-rationale">{r.rationale}</p>
            {r.evidence_hooks.length > 0 ? (
              <ul className="wbeta-ai-service-evidence">
                {r.evidence_hooks.slice(0, 4).map((h, j) => (
                  <li key={j}>{h}</li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              className="wbeta-ai-action-btn"
              onClick={() => draftFor(r.service_name, r.rationale)}
              disabled={!onSendFollowUp}
            >
              Draft brief for this service
              <CardInlineHelp text="Turns this service idea into an editable deck brief in the conversation." />
            </button>
          </li>
        ))}
      </ul>
      {output.catalog_review_pending ? (
        <p className="wbeta-ai-approval-muted">Catalog pending NIQ-side review.</p>
      ) : null}
    </div>
  );
}

function CardInlineHelp({ text }: { text: string }) {
  return (
    <span className="wbeta-inline-help" aria-hidden>
      <Info size={11} weight="bold" />
      <span className="wbeta-inline-help-tip" role="tooltip">
        {text}
      </span>
    </span>
  );
}
