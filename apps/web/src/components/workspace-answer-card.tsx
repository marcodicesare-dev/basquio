"use client";

import { useMemo, useState } from "react";

export type CitationView = {
  label: string;
  source_type: string;
  source_id: string;
  filename: string | null;
  excerpt: string;
};

export type AnswerView = {
  deliverableId: string;
  bodyMarkdown: string;
  citations: CitationView[];
  scope: string;
  prompt: string;
};

export function WorkspaceAnswerCard({ answer }: { answer: AnswerView }) {
  const [openCitation, setOpenCitation] = useState<string | null>(null);
  const citationByLabel = useMemo(() => {
    const map = new Map<string, CitationView>();
    for (const c of answer.citations) map.set(c.label, c);
    return map;
  }, [answer.citations]);

  return (
    <article className="wbeta-answer">
      <header className="wbeta-answer-head">
        <p className="wbeta-answer-kicker">Answer · scope {answer.scope}</p>
        <h3 className="wbeta-answer-prompt">{answer.prompt}</h3>
      </header>

      <div className="wbeta-answer-body">
        {renderMarkdownWithCitations(answer.bodyMarkdown, (label) => {
          const citation = citationByLabel.get(label);
          if (!citation) return null;
          return (
            <button
              type="button"
              className="wbeta-citation-tag"
              onClick={() => setOpenCitation(label === openCitation ? null : label)}
              aria-expanded={openCitation === label}
            >
              {label}
            </button>
          );
        })}
      </div>

      {openCitation && citationByLabel.has(openCitation) ? (
        <CitationPanel citation={citationByLabel.get(openCitation)!} onClose={() => setOpenCitation(null)} />
      ) : null}

      {answer.citations.length > 0 ? (
        <footer className="wbeta-answer-footer">
          <p className="wbeta-answer-footer-title">Sources</p>
          <ul className="wbeta-answer-citation-list">
            {answer.citations.map((citation) => (
              <li key={citation.label}>
                <button
                  type="button"
                  className="wbeta-citation-link"
                  onClick={() => setOpenCitation(citation.label === openCitation ? null : citation.label)}
                >
                  <span className="wbeta-citation-label">[{citation.label}]</span>
                  <span className="wbeta-citation-source">
                    {citation.filename ?? `${citation.source_type}:${citation.source_id.slice(0, 8)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </footer>
      ) : null}
    </article>
  );
}

function CitationPanel({ citation, onClose }: { citation: CitationView; onClose: () => void }) {
  return (
    <aside className="wbeta-answer-citation-panel" role="region" aria-label={`Source ${citation.label}`}>
      <div className="wbeta-answer-citation-panel-head">
        <p className="wbeta-answer-citation-panel-label">[{citation.label}]</p>
        <p className="wbeta-answer-citation-panel-source">
          {citation.filename ?? `${citation.source_type}:${citation.source_id.slice(0, 8)}`}
        </p>
        <button type="button" className="wbeta-answer-citation-panel-close" onClick={onClose} aria-label="Hide source">
          ×
        </button>
      </div>
      <p className="wbeta-answer-citation-panel-excerpt">{citation.excerpt}</p>
    </aside>
  );
}

type RenderedNode = string | { type: "citation"; label: string };

function tokenizeWithCitations(text: string): RenderedNode[] {
  const re = /\[s(\d+)\]/g;
  const out: RenderedNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    out.push({ type: "citation", label: `s${match[1]}` });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

function renderInline(
  text: string,
  citationRenderer: (label: string) => React.ReactNode,
  keyPrefix: string,
): React.ReactNode {
  const tokens = tokenizeWithCitations(text);
  return tokens.map((token, idx) => {
    if (typeof token === "string") {
      const segments = applyEmphasis(token);
      return <span key={`${keyPrefix}-${idx}`}>{segments}</span>;
    }
    return (
      <span key={`${keyPrefix}-${idx}-cit`}>{citationRenderer(token.label)}</span>
    );
  });
}

function applyEmphasis(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    if (match[2]) out.push(<strong key={`em-${i++}`}>{match[2]}</strong>);
    else if (match[3]) out.push(<em key={`em-${i++}`}>{match[3]}</em>);
    else if (match[4]) out.push(<code key={`em-${i++}`}>{match[4]}</code>);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

function renderMarkdownWithCitations(
  markdown: string,
  citationRenderer: (label: string) => React.ReactNode,
): React.ReactNode {
  if (!markdown.trim()) return <p className="wbeta-answer-empty">No content yet.</p>;

  const blocks: React.ReactNode[] = [];
  const lines = markdown.split(/\n/);
  let listBuffer: string[] = [];
  let listOrdered = false;
  let blockKey = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    const items = listBuffer.map((item, idx) => (
      <li key={`li-${blockKey}-${idx}`}>{renderInline(item, citationRenderer, `li-${blockKey}-${idx}`)}</li>
    ));
    blocks.push(
      listOrdered ? (
        <ol key={`ol-${blockKey++}`}>{items}</ol>
      ) : (
        <ul key={`ul-${blockKey++}`}>{items}</ul>
      ),
    );
    listBuffer = [];
  }

  let paragraphBuffer: string[] = [];
  function flushParagraph() {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(" ");
    blocks.push(
      <p key={`p-${blockKey++}`}>{renderInline(text, citationRenderer, `p-${blockKey}`)}</p>,
    );
    paragraphBuffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(headingMatch[1].length + 1, 6);
      const text = headingMatch[2];
      const headingKey = `h-${blockKey++}`;
      const inline = renderInline(text, citationRenderer, headingKey);
      const headingNode =
        level === 2 ? <h2 key={headingKey}>{inline}</h2> :
        level === 3 ? <h3 key={headingKey}>{inline}</h3> :
        level === 4 ? <h4 key={headingKey}>{inline}</h4> :
        level === 5 ? <h5 key={headingKey}>{inline}</h5> :
        <h6 key={headingKey}>{inline}</h6>;
      blocks.push(headingNode);
      continue;
    }
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (ulMatch || olMatch) {
      const isOrdered = Boolean(olMatch);
      if (listBuffer.length > 0 && listOrdered !== isOrdered) flushList();
      listOrdered = isOrdered;
      listBuffer.push((ulMatch ? ulMatch[1] : olMatch![1]).trim());
      continue;
    }
    flushList();
    paragraphBuffer.push(line);
  }
  flushParagraph();
  flushList();

  return blocks;
}
