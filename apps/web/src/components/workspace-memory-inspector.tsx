"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { MemoryCandidateRow } from "@/lib/workspace/candidates";
import type { InspectorEntity, InspectorFact } from "@/lib/workspace/inspector";
import {
  formatFactObject,
  formatPredicate,
  isDocumentLikeSubject,
} from "@/lib/workspace/predicate-formatter";
import type { WorkspaceRule } from "@/lib/workspace/types";

import { WorkspaceCandidateQueue } from "@/components/workspace-candidate-queue";

type Tab = "entities" | "facts" | "rules" | "pending";

type Props = {
  entities: InspectorEntity[];
  facts: InspectorFact[];
  rules: WorkspaceRule[];
  candidates: MemoryCandidateRow[];
  factCountByEntity: Record<string, number>;
};

type RuleActionState =
  | { kind: "idle" }
  | { kind: "pending"; ruleId: string; action: "pin" | "edit" | "forget" }
  | { kind: "error"; ruleId: string; message: string };

export function WorkspaceMemoryInspectorV2({
  entities,
  facts,
  rules,
  candidates,
  factCountByEntity,
}: Props) {
  const [tab, setTab] = useState<Tab>("entities");

  return (
    <section className="wbeta-mi2">
      <nav className="wbeta-mi2-tabs" role="tablist">
        <TabButton active={tab === "entities"} count={entities.length} onClick={() => setTab("entities")}>
          Entities
        </TabButton>
        <TabButton active={tab === "facts"} count={facts.length} onClick={() => setTab("facts")}>
          Facts
        </TabButton>
        <TabButton active={tab === "rules"} count={rules.length} onClick={() => setTab("rules")}>
          Rules
        </TabButton>
        <TabButton active={tab === "pending"} count={candidates.length} onClick={() => setTab("pending")}>
          Pending
        </TabButton>
      </nav>

      {tab === "entities" ? (
        <EntitiesTab entities={entities} factCountByEntity={factCountByEntity} />
      ) : null}
      {tab === "facts" ? <FactsTab facts={facts} entitiesById={entitiesById(entities)} /> : null}
      {tab === "rules" ? <RulesTab rules={rules} /> : null}
      {tab === "pending" ? <WorkspaceCandidateQueue initialCandidates={candidates} /> : null}
    </section>
  );
}

function entitiesById(entities: InspectorEntity[]): Map<string, InspectorEntity> {
  const m = new Map<string, InspectorEntity>();
  for (const e of entities) m.set(e.id, e);
  return m;
}

function TabButton({
  active,
  count,
  children,
  onClick,
}: {
  active: boolean;
  count: number;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`wbeta-mi2-tab ${active ? "wbeta-mi2-tab-active" : ""}`}
      onClick={onClick}
    >
      <span>{children}</span>
      <span className="wbeta-mi2-tab-count">{count}</span>
    </button>
  );
}

function EntitiesTab({
  entities,
  factCountByEntity,
}: {
  entities: InspectorEntity[];
  factCountByEntity: Record<string, number>;
}) {
  if (entities.length === 0) {
    return (
      <div className="wbeta-mi2-empty">
        <p>No entities yet. Upload a brand book or paste meeting notes; entity extraction lands them here.</p>
      </div>
    );
  }
  return (
    <div className="wbeta-mi2-grid">
      <div className="wbeta-mi2-grid-head">
        <span>Name</span>
        <span>Type</span>
        <span>Aliases</span>
        <span>Facts</span>
        <span>Updated</span>
      </div>
      {entities.map((e) => (
        <div key={e.id} className="wbeta-mi2-grid-row">
          <span className="wbeta-mi2-name">{e.canonical_name}</span>
          <span className="wbeta-mi2-meta">{e.type}</span>
          <span className="wbeta-mi2-meta">
            {e.aliases.length > 0 ? e.aliases.join(", ") : <em className="wbeta-mi2-empty-cell">none</em>}
          </span>
          <span className="wbeta-mi2-meta">{factCountByEntity[e.id] ?? 0}</span>
          <span className="wbeta-mi2-meta">{formatDate(e.updated_at)}</span>
        </div>
      ))}
    </div>
  );
}

function FactsTab({
  facts,
  entitiesById,
}: {
  facts: InspectorFact[];
  entitiesById: Map<string, InspectorEntity>;
}) {
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = facts;
    if (!includeSuperseded) {
      rows = rows.filter((f) => f.superseded_by === null && f.expired_at === null);
    }
    if (subjectFilter) {
      rows = rows.filter((f) => f.subject_entity === subjectFilter);
    }
    return rows;
  }, [facts, includeSuperseded, subjectFilter]);

  if (facts.length === 0) {
    return (
      <div className="wbeta-mi2-empty">
        <p>
          Facts land here as the chat agent extracts them, the deck pipeline records evidence,
          or you teach a fact in chat. The page fills automatically.
        </p>
      </div>
    );
  }

  const filterEntity = subjectFilter ? entitiesById.get(subjectFilter) : null;

  return (
    <div className="wbeta-mi2-facts">
      <div className="wbeta-mi2-facts-controls">
        <label className="wbeta-mi2-toggle">
          <input
            type="checkbox"
            checked={includeSuperseded}
            onChange={(event) => setIncludeSuperseded(event.target.checked)}
          />
          <span>Show superseded and expired</span>
        </label>
        {subjectFilter ? (
          <button
            type="button"
            className="wbeta-mi2-facts-filter"
            onClick={() => setSubjectFilter(null)}
          >
            Filter: {filterEntity?.canonical_name ?? subjectFilter.slice(0, 8)} ✕
          </button>
        ) : null}
      </div>
      <div className="wbeta-mi2-grid">
        <div className="wbeta-mi2-grid-head wbeta-mi2-grid-head-facts">
          <span>Subject</span>
          <span>Predicate</span>
          <span>Object</span>
          <span>Valid from</span>
          <span>Source</span>
          <span>Status</span>
        </div>
        {filtered.length === 0 ? (
          <div className="wbeta-mi2-grid-row wbeta-mi2-grid-row-facts">
            <span className="wbeta-mi2-empty-cell" style={{ gridColumn: "1 / -1" }}>
              Nothing matches this filter.
            </span>
          </div>
        ) : null}
        {filtered.map((f) => {
          const subject = entitiesById.get(f.subject_entity);
          const object = f.object_entity ? entitiesById.get(f.object_entity) : null;
          const objectLabel = object?.canonical_name ?? formatFactObject(f.object_value);
          const status = f.superseded_by
            ? "superseded"
            : f.expired_at
              ? "expired"
              : "active";
          const subjectName = subject?.canonical_name ?? f.subject_entity.slice(0, 8);
          const isDoc = isDocumentLikeSubject(subjectName);
          return (
            <div key={f.id} className="wbeta-mi2-grid-row wbeta-mi2-grid-row-facts">
              <button
                type="button"
                className="wbeta-mi2-subject-link"
                onClick={() => setSubjectFilter(f.subject_entity)}
                title={
                  subject
                    ? `Show all facts about ${subject.canonical_name}`
                    : `Show all facts with this subject`
                }
              >
                {isDoc ? <span className="wbeta-mi2-subject-icon">▤</span> : null}
                <span className="wbeta-mi2-name">{subjectName}</span>
              </button>
              <span className="wbeta-mi2-meta" title={f.predicate}>
                {formatPredicate(f.predicate)}
              </span>
              <span className="wbeta-mi2-meta">{objectLabel || "-"}</span>
              <span className="wbeta-mi2-meta">{f.valid_from ? formatDate(f.valid_from) : "-"}</span>
              <span className="wbeta-mi2-meta">{f.source_type ?? "-"}</span>
              <span className={`wbeta-mi2-status wbeta-mi2-status-${status}`}>{status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RulesTab({ rules }: { rules: WorkspaceRule[] }) {
  const router = useRouter();
  const [state, setState] = useState<RuleActionState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ ruleId: string; ruleText: string } | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, WorkspaceRule[]>();
    for (const r of rules) {
      const list = map.get(r.rule_type) ?? [];
      list.push(r);
      map.set(r.rule_type, list);
    }
    return map;
  }, [rules]);

  async function callAction(ruleId: string, action: "pin" | "forget") {
    setState({ kind: "pending", ruleId, action });
    try {
      const response = await fetch(`/api/workspace/rules/${ruleId}/${action}`, { method: "POST" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `${action} failed`);
      }
      setState({ kind: "idle" });
      startTransition(() => router.refresh());
    } catch (error) {
      const message = error instanceof Error ? error.message : `${action} failed`;
      setState({ kind: "error", ruleId, message });
    }
  }

  async function submitEdit(ruleId: string, ruleText: string) {
    setState({ kind: "pending", ruleId, action: "edit" });
    try {
      const response = await fetch(`/api/workspace/rules/${ruleId}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rule_text: ruleText }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "edit failed");
      }
      setState({ kind: "idle" });
      setEditing(null);
      startTransition(() => router.refresh());
    } catch (error) {
      const message = error instanceof Error ? error.message : "edit failed";
      setState({ kind: "error", ruleId, message });
    }
  }

  if (rules.length === 0) {
    return (
      <div className="wbeta-mi2-empty">
        <p>No rules yet. Tell Basquio in chat (for example: always cite source pages on Lavazza decks) and it will land here.</p>
      </div>
    );
  }

  return (
    <div className="wbeta-mi2-rules">
      {[...grouped.entries()].map(([type, group]) => (
        <section key={type} className="wbeta-mi2-rules-group">
          <header>
            <h4>{type}</h4>
            <span>{group.length}</span>
          </header>
          <ul>
            {[...group]
              .sort((a, b) => b.priority - a.priority)
              .map((r) => {
                const busy = isPending || (state.kind === "pending" && state.ruleId === r.id);
                const error = state.kind === "error" && state.ruleId === r.id ? state.message : null;
                const isEditing = editing?.ruleId === r.id;
                return (
                  <li key={r.id} className="wbeta-mi2-rule-row">
                    <div className="wbeta-mi2-rule-meta">
                      <span className="wbeta-mi2-rule-priority">priority {r.priority}</span>
                      <span className="wbeta-mi2-rule-origin">origin: {r.origin}</span>
                      {!r.active ? <span className="wbeta-mi2-rule-inactive">forgotten</span> : null}
                    </div>
                    {isEditing ? (
                      <div className="wbeta-mi2-rule-edit">
                        <textarea
                          value={editing.ruleText}
                          onChange={(event) =>
                            setEditing((prev) =>
                              prev ? { ...prev, ruleText: event.target.value } : prev,
                            )
                          }
                          rows={3}
                          maxLength={2000}
                        />
                        <div className="wbeta-mi2-rule-actions">
                          <button
                            type="button"
                            disabled={busy || editing.ruleText.trim().length < 1}
                            onClick={() => submitEdit(r.id, editing.ruleText.trim())}
                          >
                            Save
                          </button>
                          <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="wbeta-mi2-rule-text">{r.rule_text}</p>
                    )}
                    {r.applies_to.length > 0 ? (
                      <p className="wbeta-mi2-rule-applies">Applies to: {r.applies_to.join(", ")}</p>
                    ) : null}
                    {r.forbidden.length > 0 ? (
                      <p className="wbeta-mi2-rule-forbidden">Forbidden: {r.forbidden.join(", ")}</p>
                    ) : null}
                    {error ? <p className="wbeta-mi2-rule-error">{error}</p> : null}
                    {!isEditing ? (
                      <div className="wbeta-mi2-rule-actions">
                        <button type="button" disabled={busy} onClick={() => callAction(r.id, "pin")}>
                          Pin
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setEditing({ ruleId: r.id, ruleText: r.rule_text })}
                        >
                          Edit
                        </button>
                        <button type="button" disabled={busy} onClick={() => callAction(r.id, "forget")}>
                          Forget
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toISOString().slice(0, 10);
  } catch {
    return "-";
  }
}

