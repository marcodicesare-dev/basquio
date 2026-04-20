"use client";

import { useState } from "react";
import {
  Brain,
  CaretDown,
  CaretRight,
  CheckCircle,
  MagnifyingGlass,
  PushPinSimple,
  WarningCircle,
} from "@phosphor-icons/react";

type ToolState = "input-streaming" | "input-available" | "output-available" | "output-error" | string;

/**
 * MemoryReadChip: subtle system chip rendered when the agent calls the `memory` tool.
 * Per Marco 7c: "subtle system chips". No emojis; Phosphor Brain icon.
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
            ? "Memory read failed"
            : isDone
              ? `Read ${count} ${count === 1 ? "memory entry" : "memory entries"} from ${scopeName}`
              : `Reading memory from ${scopeName}`}
        </span>
        <span className="wbeta-ai-tool-caret" aria-hidden>
          {open ? <CaretDown size={10} weight="bold" /> : <CaretRight size={10} weight="bold" />}
        </span>
      </button>
      {open && isDone && output?.entries && output.entries.length > 0 ? (
        <ul className="wbeta-ai-tool-chip-entries">
          {output.entries.slice(0, 8).map((entry) => (
            <li key={entry.id} className="wbeta-ai-tool-chip-entry">
              <span className="wbeta-ai-tool-chip-entry-kind">{entry.memory_type}</span>
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
  input,
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
  };
  errorText?: string;
}) {
  const [open, setOpen] = useState(false);
  const isDone = state === "output-available";
  const isError = state === "output-error";
  const chunks = output?.chunk_count ?? 0;
  const facts = output?.fact_count ?? 0;

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
            ? "Context search failed"
            : isDone
              ? `Found ${chunks} source excerpt${chunks === 1 ? "" : "s"} and ${facts} fact${facts === 1 ? "" : "s"}`
              : "Searching workspace"}
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
      {open && isError && errorText ? (
        <p className="wbeta-ai-tool-chip-error-text">{errorText}</p>
      ) : null}
    </div>
  );
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

  if (isError) {
    return (
      <div className="wbeta-ai-teach-card wbeta-ai-teach-card-error">
        <div className="wbeta-ai-teach-head">
          <span className="wbeta-ai-teach-icon" aria-hidden>
            <WarningCircle size={18} weight="fill" />
          </span>
          <div className="wbeta-ai-teach-copy">
            <p className="wbeta-ai-teach-title">Could not save that rule.</p>
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
            {isDone ? "Rule saved" : "Saving rule"} to {title}
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
