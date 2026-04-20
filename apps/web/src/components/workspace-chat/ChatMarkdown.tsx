"use client";

import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

import { CitationChip } from "@/components/workspace-chat/CitationChip";
import type { CitationInline } from "@/components/workspace-chat/CitationChip";

const CITATION_RE = /\[s(\d+)\]/g;

function splitCitations(text: string, onCitation: (label: string) => ReactNode): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(onCitation(`s${match[1]}`));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderChildren(children: ReactNode, citations: CitationInline[]): ReactNode {
  if (typeof children === "string") {
    return splitCitations(children, (label) => (
      <CitationChip key={`${label}-${Math.random()}`} label={label} citations={citations} />
    ));
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return (
          <span key={i}>
            {splitCitations(child, (label) => (
              <CitationChip key={`${label}-${i}`} label={label} citations={citations} />
            ))}
          </span>
        );
      }
      return child;
    });
  }
  return children;
}

export const ChatMarkdown = memo(function ChatMarkdown({
  source,
  citations,
}: {
  source: string;
  citations?: CitationInline[];
}) {
  const cites = citations ?? [];
  const components: Components = {
    p({ children }) {
      return <p className="wbeta-ai-p">{renderChildren(children, cites)}</p>;
    },
    li({ children }) {
      return <li className="wbeta-ai-li">{renderChildren(children, cites)}</li>;
    },
    strong({ children }) {
      return <strong>{renderChildren(children, cites)}</strong>;
    },
    em({ children }) {
      return <em>{renderChildren(children, cites)}</em>;
    },
    h1({ children }) {
      return <h1 className="wbeta-ai-h1">{renderChildren(children, cites)}</h1>;
    },
    h2({ children }) {
      return <h2 className="wbeta-ai-h2">{renderChildren(children, cites)}</h2>;
    },
    h3({ children }) {
      return <h3 className="wbeta-ai-h3">{renderChildren(children, cites)}</h3>;
    },
    h4({ children }) {
      return <h4 className="wbeta-ai-h4">{renderChildren(children, cites)}</h4>;
    },
    table({ children }) {
      return (
        <div className="wbeta-ai-table-wrap">
          <table className="wbeta-ai-table">{children}</table>
        </div>
      );
    },
    thead({ children }) {
      return <thead>{children}</thead>;
    },
    tbody({ children }) {
      return <tbody>{children}</tbody>;
    },
    tr({ children }) {
      return <tr>{children}</tr>;
    },
    th({ children }) {
      return <th>{renderChildren(children, cites)}</th>;
    },
    td({ children }) {
      return <td>{renderChildren(children, cites)}</td>;
    },
    code({ className, children, ...props }) {
      const raw = String(children ?? "");
      const isBlock = /language-/.test(className ?? "") || raw.includes("\n");
      if (!isBlock) {
        return <code className="wbeta-ai-code-inline">{raw}</code>;
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <pre className="wbeta-ai-pre">{children}</pre>;
    },
    blockquote({ children }) {
      return <blockquote className="wbeta-ai-quote">{renderChildren(children, cites)}</blockquote>;
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="wbeta-ai-link">
          {renderChildren(children, cites)}
        </a>
      );
    },
    hr() {
      return <hr className="wbeta-ai-hr" />;
    },
  };

  return (
    <div className="wbeta-ai-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
