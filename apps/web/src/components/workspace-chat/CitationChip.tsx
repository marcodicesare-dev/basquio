"use client";

import { useState } from "react";

export type CitationInline = {
  label: string;
  source_type?: string;
  source_id?: string;
  filename?: string | null;
  excerpt?: string;
  score?: number;
};

export function CitationChip({
  label,
  citations,
}: {
  label: string;
  citations: CitationInline[];
}) {
  const citation = citations.find((c) => c.label === label);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <span
      className="wbeta-ai-citation"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <span className="wbeta-ai-citation-chip">{label}</span>
      {isOpen && citation ? (
        <span className="wbeta-ai-citation-pop" role="tooltip">
          <span className="wbeta-ai-citation-pop-source">
            {citation.filename ?? citation.source_type ?? label}
          </span>
          {citation.excerpt ? (
            <span className="wbeta-ai-citation-pop-excerpt">{citation.excerpt}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
