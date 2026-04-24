"use client";

import { useEffect, useRef, useState } from "react";

import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import type { EntityWithCount } from "@/lib/workspace/db";

const TYPE_ORDER: ReadonlyArray<{ type: string; label: string }> = [
  { type: "person", label: "People" },
  { type: "organization", label: "Organizations" },
  { type: "brand", label: "Brands" },
  { type: "category", label: "Categories" },
  { type: "sub_category", label: "Sub-categories" },
  { type: "sku", label: "SKUs" },
  { type: "retailer", label: "Retailers" },
  { type: "metric", label: "Metrics" },
  { type: "deliverable", label: "Deliverables" },
  { type: "question", label: "Questions" },
  { type: "meeting", label: "Meetings" },
  { type: "email", label: "Emails" },
  { type: "document", label: "Documents" },
];

type EntityDetail = {
  id: string;
  type: string;
  canonical_name: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  mentions: Array<{
    id: string;
    source_type: string;
    source_id: string;
    excerpt: string | null;
    created_at: string;
    document_filename: string | null;
  }>;
  facts: Array<{
    id: string;
    predicate: string;
    object_value: unknown;
    valid_from: string | null;
    valid_to: string | null;
    confidence: number;
    metadata: Record<string, unknown>;
    source_id: string | null;
    source_type: string | null;
    document_filename: string | null;
  }>;
};

export function WorkspaceTimeline({
  entitiesByType,
  totalEntityCount,
}: {
  entitiesByType: Record<string, EntityWithCount[]>;
  totalEntityCount: number;
}) {
  const [openEntityId, setOpenEntityId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function close() {
    setOpenEntityId(null);
    requestAnimationFrame(() => {
      triggerRef.current?.focus();
      triggerRef.current = null;
    });
  }

  useEffect(() => {
    if (!openEntityId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/workspace/entities/${openEntityId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setError((data as { error?: string }).error ?? "Could not load entity.");
        } else {
          setDetail(data as EntityDetail);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openEntityId]);

  useEffect(() => {
    if (!openEntityId) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // close is stable for this component lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEntityId]);

  if (totalEntityCount === 0) {
    return (
      <div className="wbeta-context-empty">
        <p className="wbeta-context-empty-line">
          People, brands, categories, retailers, metrics, and deliverables land here as soon as
          extraction runs on your uploads.
        </p>
        <p className="wbeta-context-empty-meta">Drop a file to start.</p>
      </div>
    );
  }

  return (
    <>
      <div className="wbeta-timeline">
        <p className="wbeta-timeline-summary">
          Basquio knows {totalEntityCount} {totalEntityCount === 1 ? "entity" : "entities"} across{" "}
          {Object.keys(entitiesByType).length}{" "}
          {Object.keys(entitiesByType).length === 1 ? "type" : "types"}.
        </p>
        <ul className="wbeta-timeline-groups">
          {TYPE_ORDER.filter(({ type }) => entitiesByType[type]?.length).map(({ type, label }) => {
            const entities = entitiesByType[type] ?? [];
            return (
              <li key={type} className="wbeta-timeline-group">
                <div className="wbeta-timeline-group-head">
                  <span className="wbeta-timeline-group-label">{label}</span>
                  <span className="wbeta-timeline-group-count">{entities.length}</span>
                </div>
                <ul className="wbeta-timeline-rows">
                  {entities.slice(0, 8).map((entity) => (
                    <li key={entity.id}>
                      <button
                        type="button"
                        className="wbeta-timeline-row"
                        onClick={(event) => {
                          triggerRef.current = event.currentTarget;
                          setOpenEntityId(entity.id);
                        }}
                        aria-haspopup="dialog"
                        aria-expanded={openEntityId === entity.id}
                      >
                        <span className="wbeta-timeline-row-name">{entity.canonical_name}</span>
                        <span className="wbeta-timeline-row-meta">
                          {entity.mention_count} {entity.mention_count === 1 ? "source" : "sources"}
                          {entity.fact_count > 0 ? ` · ${entity.fact_count} facts` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                  {entities.length > 8 ? (
                    <li className="wbeta-timeline-row-more">
                      and {entities.length - 8} more {label.toLowerCase()}.
                    </li>
                  ) : null}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>

      {openEntityId ? (
        <EntitySideSheet
          entityId={openEntityId}
          loading={loading}
          error={error}
          detail={detail}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function EntitySideSheet({
  entityId,
  loading,
  error,
  detail,
  onClose,
}: {
  entityId: string;
  loading: boolean;
  error: string | null;
  detail: EntityDetail | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div className="wbeta-sheet-backdrop" onClick={onClose} role="presentation">
      <aside
        className="wbeta-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`wbeta-sheet-title-${entityId}`}
      >
        <header className="wbeta-sheet-head">
          <button
            ref={closeRef}
            type="button"
            className="wbeta-sheet-close"
            onClick={onClose}
            aria-label="Close entity panel"
          >
            ×
          </button>
          {detail ? (
            <>
              <p className="wbeta-sheet-kicker">{labelForType(detail.type)}</p>
              <h3 className="wbeta-sheet-title" id={`wbeta-sheet-title-${entityId}`}>
                {detail.canonical_name}
              </h3>
              {detail.metadata.role ? (
                <p className="wbeta-sheet-sub">{String(detail.metadata.role)}</p>
              ) : null}
              {detail.aliases?.length ? (
                <p className="wbeta-sheet-aliases">Also known as: {detail.aliases.join(", ")}</p>
              ) : null}
            </>
          ) : (
            <div className="wbeta-sheet-title-skeleton" id={`wbeta-sheet-title-${entityId}`}>
              <WorkspaceSkeleton density="line" width="64%" label="Loading entity title" />
              <WorkspaceSkeleton density="line" width="38%" label="Loading entity metadata" />
            </div>
          )}
        </header>

        {loading ? (
          <div className="wbeta-sheet-loading" role="status" aria-label="Loading entity details">
            <WorkspaceSkeleton density="card" height={84} label="Loading facts" />
            <WorkspaceSkeleton density="grid" rows={2} cols={2} cellHeight={48} label="Loading citations" />
          </div>
        ) : error ? (
          <p className="wbeta-sheet-state wbeta-sheet-state-err">{error}</p>
        ) : detail ? (
          <div className="wbeta-sheet-body">
            <SheetSection title="Facts" empty="No facts yet.">
              {detail.facts.map((fact) => (
                <article key={fact.id} className="wbeta-sheet-fact">
                  <div className="wbeta-sheet-fact-head">
                    <span className="wbeta-sheet-fact-predicate">{prettyPredicate(fact.predicate)}</span>
                    <span className="wbeta-sheet-fact-confidence">
                      {Math.round(fact.confidence * 100)}%
                    </span>
                  </div>
                  <p className="wbeta-sheet-fact-value">{formatObjectValue(fact.object_value)}</p>
                  <p className="wbeta-sheet-fact-meta">
                    {fact.valid_from ? formatRange(fact.valid_from, fact.valid_to) : null}
                    {fact.document_filename
                      ? ` · ${fact.document_filename}`
                      : fact.source_type
                        ? ` · ${fact.source_type}`
                        : ""}
                  </p>
                  {typeof fact.metadata.evidence === "string" ? (
                    <p className="wbeta-sheet-fact-evidence">“{fact.metadata.evidence}”</p>
                  ) : null}
                </article>
              ))}
            </SheetSection>

            <SheetSection title="Sources" empty="No sources yet.">
              {detail.mentions.map((mention) => (
                <article key={mention.id} className="wbeta-sheet-mention">
                  <p className="wbeta-sheet-mention-source">
                    {mention.document_filename ?? `${mention.source_type} ${mention.source_id.slice(0, 8)}`}
                  </p>
                  {mention.excerpt ? <p className="wbeta-sheet-mention-excerpt">{mention.excerpt}</p> : null}
                  <p className="wbeta-sheet-mention-meta">{formatRelativeDate(mention.created_at)}</p>
                </article>
              ))}
            </SheetSection>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function SheetSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const childArray = Array.isArray(children) ? children : [children];
  const hasContent = childArray.flat().some((c) => Boolean(c));
  return (
    <section className="wbeta-sheet-section">
      <h4 className="wbeta-sheet-section-title">{title}</h4>
      {hasContent ? <div className="wbeta-sheet-section-body">{children}</div> : <p className="wbeta-sheet-section-empty">{empty}</p>}
    </section>
  );
}

function labelForType(type: string): string {
  return type.replace(/_/g, " ");
}

function prettyPredicate(predicate: string): string {
  return predicate.replace(/_/g, " ");
}

function formatObjectValue(value: unknown): string {
  if (value == null) return "unknown";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("value" in value && typeof (value as { value: unknown }).value !== "object") {
      const v = (value as { value: unknown; unit?: string; period?: string }).value;
      const unit = (value as { unit?: string }).unit;
      const period = (value as { period?: string }).period;
      const parts = [String(v ?? ""), unit, period].filter(Boolean);
      return parts.join(" ").trim();
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function formatRange(from: string, to: string | null): string {
  const f = new Date(from);
  const fStr = Number.isNaN(f.getTime()) ? from : f.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  if (!to) return `from ${fStr}`;
  const t = new Date(to);
  const tStr = Number.isNaN(t.getTime()) ? to : t.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return `${fStr} → ${tStr}`;
}

function formatRelativeDate(iso: string): string {
  const created = new Date(iso);
  const diffSec = Math.round((Date.now() - created.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days < 7) return `${days}d ago`;
  return created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
