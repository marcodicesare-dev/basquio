"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export function SourceMarkdown({ source }: { source: string }) {
  const components: Components = {
    h1({ children }) {
      return <h1 className="wbeta-docmd-h1">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="wbeta-docmd-h2">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="wbeta-docmd-h3">{children}</h3>;
    },
    p({ children }) {
      return <p className="wbeta-docmd-p">{children}</p>;
    },
    ul({ children }) {
      return <ul className="wbeta-docmd-list">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="wbeta-docmd-list">{children}</ol>;
    },
    li({ children }) {
      return <li className="wbeta-docmd-li">{children}</li>;
    },
    blockquote({ children }) {
      return <blockquote className="wbeta-docmd-quote">{children}</blockquote>;
    },
    table({ children }) {
      return (
        <div className="wbeta-docmd-tablewrap">
          <table className="wbeta-docmd-table">{children}</table>
        </div>
      );
    },
    code({ children, className }) {
      const raw = String(children ?? "");
      if (className || raw.includes("\n")) {
        return <code className={className}>{children}</code>;
      }
      return <code className="wbeta-docmd-inlinecode">{children}</code>;
    },
    pre({ children }) {
      return <pre className="wbeta-docmd-pre">{children}</pre>;
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noreferrer" className="wbeta-docmd-link">
          {children}
        </a>
      );
    },
    hr() {
      return <hr className="wbeta-docmd-hr" />;
    },
  };

  return (
    <article className="wbeta-docpreview-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </article>
  );
}
