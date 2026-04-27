"use client";

import { useState } from "react";
import { CaretDown, CaretRight, ClipboardText, MagnifyingGlass } from "@phosphor-icons/react";

type Citation = {
  label: string;
  source_type: string;
  source_id: string;
  filename: string | null;
  excerpt: string;
};

export type ProvenanceStats = {
  chunk_count?: number;
  fact_count?: number;
  entity_count?: number;
  memory_count?: number;
};

const SOURCE_KIND_LABELS: Record<string, string> = {
  document: "Document",
  transcript: "Transcript",
  chunk: "Excerpt",
  memory: "Saved knowledge",
  fact: "Grounded fact",
  entity: "Entity",
};

export function WorkspaceProvenance({
  citations,
  stats,
}: {
  citations: Citation[];
  stats: ProvenanceStats;
}) {
  const [open, setOpen] = useState(false);

  const chunkCount = stats.chunk_count ?? citations.length;
  const factCount = stats.fact_count ?? 0;
  const memoryCount = stats.memory_count ?? 0;
  const entityCount = stats.entity_count ?? 0;

  const nothing =
    citations.length === 0 && chunkCount === 0 && factCount === 0 && memoryCount === 0;
  if (nothing) return null;

  const bits: string[] = [];
  if (chunkCount > 0) {
    bits.push(`${chunkCount} source excerpt${chunkCount === 1 ? "" : "s"}`);
  }
  if (factCount > 0) {
    bits.push(`${factCount} grounded fact${factCount === 1 ? "" : "s"}`);
  }
  if (memoryCount > 0) {
    bits.push(`${memoryCount} saved item${memoryCount === 1 ? "" : "s"}`);
  }
  if (entityCount > 0 && bits.length < 3) {
    bits.push(`${entityCount} entit${entityCount === 1 ? "y" : "ies"}`);
  }
  const summary = bits.length > 0 ? bits.join(" · ") : `${citations.length} citations`;

  return (
    <section className="wbeta-prov">
      <button
        type="button"
        className="wbeta-prov-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="wbeta-prov-toggle-icon" aria-hidden>
          {open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
        </span>
        <span className="wbeta-prov-toggle-label">
          Based on {summary}
        </span>
        <span className="wbeta-prov-toggle-hint">
          {open ? "Hide sources" : "Show sources"}
        </span>
      </button>

      {open ? (
        <div className="wbeta-prov-panel">
          <header className="wbeta-prov-panel-head">
            <h3 className="wbeta-prov-panel-title">Where this answer came from</h3>
            <p className="wbeta-prov-panel-hint">
              Every claim traces back to a source Basquio could see. Facts, saved knowledge, and source
              excerpts are listed here. Click a citation in the answer to scroll to it.
            </p>
          </header>

          {citations.length > 0 ? (
            <div className="wbeta-prov-group">
              <div className="wbeta-prov-group-head">
                <ClipboardText size={13} weight="regular" />
                <h4 className="wbeta-prov-group-title">Source excerpts</h4>
                <span className="wbeta-prov-group-count">{citations.length}</span>
              </div>
              <ul className="wbeta-prov-citation-list">
                {citations.map((c) => {
                  const kindLabel = SOURCE_KIND_LABELS[c.source_type] ?? c.source_type;
                  const source =
                    c.filename ?? `${c.source_type}:${c.source_id.slice(0, 8)}`;
                  return (
                    <li key={`${c.label}-${c.source_id}`} id={`prov-${c.label}`} className="wbeta-prov-citation">
                      <div className="wbeta-prov-citation-head">
                        <span className="wbeta-prov-citation-label">[{c.label}]</span>
                        <span className="wbeta-prov-citation-kind">{kindLabel}</span>
                        <span className="wbeta-prov-citation-source">{source}</span>
                      </div>
                      <p className="wbeta-prov-citation-excerpt">{c.excerpt}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {factCount > 0 ? (
            <div className="wbeta-prov-group">
              <div className="wbeta-prov-group-head">
                <MagnifyingGlass size={13} weight="regular" />
                <h4 className="wbeta-prov-group-title">Grounded facts</h4>
                <span className="wbeta-prov-group-count">{factCount}</span>
              </div>
              <p className="wbeta-prov-group-hint">
                Facts pulled from the workspace knowledge graph. Each one has a valid_from date and
                the source that taught it to Basquio. Open a stakeholder or scope page to inspect
                individual facts.
              </p>
            </div>
          ) : null}

          {memoryCount > 0 ? (
            <div className="wbeta-prov-group">
              <div className="wbeta-prov-group-head">
                <ClipboardText size={13} weight="regular" />
                <h4 className="wbeta-prov-group-title">Memory applied</h4>
                <span className="wbeta-prov-group-count">{memoryCount}</span>
              </div>
              <p className="wbeta-prov-group-hint">
                Instructions and notes Basquio followed while writing this answer. Browse Memory
                to see what exists at workspace, client, category, and analyst level.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
