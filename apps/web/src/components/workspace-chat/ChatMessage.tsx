"use client";

import { memo, useState } from "react";
import {
  CaretDown,
  CaretRight,
  CheckCircle,
  ClipboardText,
  ThumbsDown,
  ThumbsUp,
} from "@phosphor-icons/react";
import type { UIMessage } from "ai";

import { ChatMarkdown } from "@/components/workspace-chat/ChatMarkdown";
import {
  MemoryReadChip,
  MetricCard,
  RetrieveContextChip,
  StakeholderCard,
  TeachRuleCard,
} from "@/components/workspace-chat/ToolChips";
import type { CitationInline } from "@/components/workspace-chat/CitationChip";

type ToolPart = {
  type: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type Part = {
  type: string;
  text?: string;
  state?: "streaming" | "done";
  [k: string]: unknown;
};

const CITATION_RE = /\[s(\d+)\]/g;

function extractCitationsFromOutput(output: unknown): CitationInline[] {
  if (!output || typeof output !== "object") return [];
  const chunks = (output as { chunks?: Array<{ label: string; source_type?: string; source_id?: string; filename?: string | null; content?: string }> }).chunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.map((c) => ({
    label: c.label,
    source_type: c.source_type,
    source_id: c.source_id,
    filename: c.filename ?? undefined,
    excerpt: c.content?.slice(0, 280),
  }));
}

function gatherCitations(message: UIMessage): CitationInline[] {
  const out: CitationInline[] = [];
  for (const part of message.parts ?? []) {
    if ((part as Part).type?.startsWith("tool-")) {
      const toolName = (part as Part).type.slice(5);
      if (toolName === "retrieveContext") {
        const outputCitations = extractCitationsFromOutput((part as ToolPart).output);
        for (const c of outputCitations) out.push(c);
      }
    }
  }
  return out;
}

function messageToMarkdown(message: UIMessage): string {
  const parts = (message.parts ?? []) as unknown as Part[];
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n\n");
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  onCopy,
  onRegenerate,
  onFeedback,
}: {
  message: UIMessage;
  isStreaming: boolean;
  onCopy?: (text: string) => void;
  onRegenerate?: () => void;
  onFeedback?: (value: "up" | "down") => void;
}) {
  const isUser = message.role === "user";
  const citations = gatherCitations(message);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  async function handleCopy() {
    const md = messageToMarkdown(message);
    await navigator.clipboard.writeText(md).catch(() => {});
    setCopiedAt(Date.now());
    onCopy?.(md);
    window.setTimeout(() => setCopiedAt(null), 1500);
  }

  function handleFeedback(value: "up" | "down") {
    setFeedback(value);
    onFeedback?.(value);
  }

  return (
    <article className={isUser ? "wbeta-ai-msg wbeta-ai-msg-user" : "wbeta-ai-msg wbeta-ai-msg-asst"}>
      {(message.parts ?? []).map((rawPart, i) => {
        const part = rawPart as Part;
        if (part.type === "text") {
          const text = part.text ?? "";
          if (!text) return null;
          if (isUser) {
            return (
              <p key={i} className="wbeta-ai-user-bubble">
                {text}
              </p>
            );
          }
          return (
            <div key={i} className="wbeta-ai-asst-block">
              <ChatMarkdown source={text} citations={citations} />
              {isStreaming ? <span className="wbeta-ai-cursor" aria-hidden /> : null}
            </div>
          );
        }
        if (part.type === "reasoning") {
          const text = (part as { text?: string }).text ?? "";
          if (!text) return null;
          return <ReasoningBlock key={i} text={text} isStreaming={isStreaming} />;
        }
        if (part.type?.startsWith("tool-")) {
          const toolPart = part as unknown as ToolPart;
          const toolName = part.type.slice(5);
          const state = (toolPart.state as string) || "input-available";
          switch (toolName) {
            case "memory":
              return (
                <MemoryReadChip
                  key={i}
                  state={state}
                  input={toolPart.input as Parameters<typeof MemoryReadChip>[0]["input"]}
                  output={toolPart.output as Parameters<typeof MemoryReadChip>[0]["output"]}
                  errorText={toolPart.errorText}
                />
              );
            case "retrieveContext":
              return (
                <RetrieveContextChip
                  key={i}
                  state={state}
                  input={toolPart.input as Parameters<typeof RetrieveContextChip>[0]["input"]}
                  output={toolPart.output as Parameters<typeof RetrieveContextChip>[0]["output"]}
                  errorText={toolPart.errorText}
                />
              );
            case "teachRule":
              return (
                <TeachRuleCard
                  key={i}
                  state={state}
                  input={toolPart.input as Parameters<typeof TeachRuleCard>[0]["input"]}
                  output={toolPart.output as Parameters<typeof TeachRuleCard>[0]["output"]}
                  errorText={toolPart.errorText}
                />
              );
            case "showMetricCard":
              return (
                <MetricCard
                  key={i}
                  state={state}
                  input={toolPart.input as Parameters<typeof MetricCard>[0]["input"]}
                />
              );
            case "showStakeholderCard":
              return (
                <StakeholderCard
                  key={i}
                  state={state}
                  input={toolPart.input as Parameters<typeof StakeholderCard>[0]["input"]}
                  output={toolPart.output as Parameters<typeof StakeholderCard>[0]["output"]}
                />
              );
            default:
              return null;
          }
        }
        return null;
      })}

      {!isUser && !isStreaming ? (
        <div className="wbeta-ai-actions">
          <button
            type="button"
            className="wbeta-ai-action-btn"
            onClick={handleCopy}
            aria-label="Copy answer"
          >
            {copiedAt ? (
              <>
                <CheckCircle size={12} weight="fill" /> Copied
              </>
            ) : (
              <>
                <ClipboardText size={12} weight="regular" /> Copy
              </>
            )}
          </button>
          {onRegenerate ? (
            <button
              type="button"
              className="wbeta-ai-action-btn"
              onClick={onRegenerate}
              aria-label="Regenerate answer"
            >
              <CaretRight size={12} weight="regular" /> Regenerate
            </button>
          ) : null}
          <button
            type="button"
            className={
              feedback === "up"
                ? "wbeta-ai-action-btn wbeta-ai-action-btn-active"
                : "wbeta-ai-action-btn"
            }
            onClick={() => handleFeedback("up")}
            aria-label="Good answer"
            aria-pressed={feedback === "up"}
          >
            <ThumbsUp size={12} weight={feedback === "up" ? "fill" : "regular"} />
          </button>
          <button
            type="button"
            className={
              feedback === "down"
                ? "wbeta-ai-action-btn wbeta-ai-action-btn-active"
                : "wbeta-ai-action-btn"
            }
            onClick={() => handleFeedback("down")}
            aria-label="Bad answer"
            aria-pressed={feedback === "down"}
          >
            <ThumbsDown size={12} weight={feedback === "down" ? "fill" : "regular"} />
          </button>
        </div>
      ) : null}
    </article>
  );
});

function ReasoningBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="wbeta-ai-reasoning"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="wbeta-ai-reasoning-head">
        <span className="wbeta-ai-reasoning-caret" aria-hidden>
          {open ? <CaretDown size={10} weight="bold" /> : <CaretRight size={10} weight="bold" />}
        </span>
        <span>{isStreaming ? "Thinking" : "Thought for a moment"}</span>
      </summary>
      <pre className="wbeta-ai-reasoning-body">{text}</pre>
    </details>
  );
}
