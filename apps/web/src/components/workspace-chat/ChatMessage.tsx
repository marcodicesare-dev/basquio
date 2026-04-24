"use client";

import { memo, useMemo, useState } from "react";
import {
  CaretDown,
  CaretRight,
  CheckCircle,
  ClipboardText,
  FileArrowDown,
  Presentation,
  ThumbsDown,
  ThumbsUp,
} from "@phosphor-icons/react";
import type { UIMessage } from "ai";

import { ChatMarkdown } from "@/components/workspace-chat/ChatMarkdown";
import { WorkspaceInlineSuggestions } from "@/components/workspace-suggestions";
import {
  BriefDraftCard,
  ExplainBasquioCard,
  ExtractionApprovalCard,
  MemoryReadChip,
  MetricCard,
  RetrieveContextChip,
  RuleEditApprovalCard,
  ServiceSuggestionCard,
  StakeholderCard,
  StakeholderCreateApprovalCard,
  StakeholderEditApprovalCard,
  TeachRuleCard,
} from "@/components/workspace-chat/ToolChips";
import type { CitationInline } from "@/components/workspace-chat/CitationChip";
import type { WorkspaceSuggestion } from "@/lib/workspace/suggestions";

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

type ChatMessageProps = {
  message: UIMessage;
  isStreaming: boolean;
  onCopy?: (text: string) => void;
  onRegenerate?: () => void;
  onFeedback?: (value: "up" | "down") => void;
  onSaveAsMemo?: (args: { text: string; citations: CitationInline[]; messageId: string }) => Promise<string | null>;
  onGenerateDeck?: (args: { text: string; citations: CitationInline[]; messageId: string }) => Promise<string | null> | void;
  showInlineSuggestions?: boolean;
  /**
   * Approval-card follow-up: cards fire a new user chat turn when the
   * user clicks [Save all] / [Update] / [Create] / [Open in drawer] /
   * [Draft brief for this service]. The parent chat wires this to
   * useChat().sendMessage so the model sees the follow-up turn and
   * re-invokes the tool with dry_run: false plus the cached id.
   */
  onSendFollowUp?: (text: string) => void;
};

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  onCopy,
  onRegenerate,
  onFeedback,
  onSaveAsMemo,
  onGenerateDeck,
  showInlineSuggestions = false,
  onSendFollowUp,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const citations = gatherCitations(message);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [saving, setSaving] = useState<"memo" | "deck" | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

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

  async function handleSave() {
    if (!onSaveAsMemo || saving) return;
    setSaving("memo");
    setSaveMsg(null);
    try {
      const url = await onSaveAsMemo({
        text: messageToMarkdown(message),
        citations,
        messageId: message.id ?? "",
      });
      setSaveMsg(url ? "Saved as memo" : "Could not save");
    } finally {
      setSaving(null);
      window.setTimeout(() => setSaveMsg(null), 2400);
    }
  }

  async function handleDeck() {
    if (!onGenerateDeck || saving) return;
    setSaving("deck");
    setSaveMsg(null);
    try {
      const result = await onGenerateDeck({
        text: messageToMarkdown(message),
        citations,
        messageId: message.id ?? "",
      });
      // Backwards compat: if the parent returned a URL string (old behaviour),
      // navigate. The new drawer pattern returns "drawer-opened" or void.
      if (typeof result === "string" && result.startsWith("/")) {
        window.location.href = result;
        return;
      }
    } finally {
      setSaving(null);
    }
  }

  const parts = useMemo(() => (message.parts ?? []) as unknown as Part[], [message]);
  const lastPartIndex = parts.length - 1;
  const inlineSuggestions = useMemo(
    () => deriveInlineSuggestions(message, citations, Boolean(scopeSignal(message))),
    [message, citations],
  );

  return (
    <article className={isUser ? "wbeta-ai-msg wbeta-ai-msg-user" : "wbeta-ai-msg wbeta-ai-msg-asst"}>
      {parts.map((part, i) => {
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
          const shouldRenderStreamingText = isStreaming && i === lastPartIndex;
          return (
            <div key={i} className="wbeta-ai-asst-block">
              {shouldRenderStreamingText ? (
                <div className="wbeta-ai-streaming-text">
                  {text}
                  <span className="wbeta-ai-cursor" aria-hidden />
                </div>
              ) : (
                <ChatMarkdown source={text} citations={citations} />
              )}
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
            case "saveFromPaste":
            case "scrapeUrl":
              return (
                <ExtractionApprovalCard
                  key={i}
                  state={state}
                  toolName={toolName}
                  input={toolPart.input as Parameters<typeof ExtractionApprovalCard>[0]["input"]}
                  output={toolPart.output as Parameters<typeof ExtractionApprovalCard>[0]["output"]}
                  errorText={toolPart.errorText}
                  onSendFollowUp={onSendFollowUp}
                />
              );
            case "editStakeholder":
              return (
                <StakeholderEditApprovalCard
                  key={i}
                  state={state}
                  output={toolPart.output as Parameters<typeof StakeholderEditApprovalCard>[0]["output"]}
                  errorText={toolPart.errorText}
                  onSendFollowUp={onSendFollowUp}
                />
              );
            case "createStakeholder":
              return (
                <StakeholderCreateApprovalCard
                  key={i}
                  state={state}
                  output={toolPart.output as Parameters<typeof StakeholderCreateApprovalCard>[0]["output"]}
                  errorText={toolPart.errorText}
                  onSendFollowUp={onSendFollowUp}
                />
              );
            case "editRule":
              return (
                <RuleEditApprovalCard
                  key={i}
                  state={state}
                  input={toolPart.input as Parameters<typeof RuleEditApprovalCard>[0]["input"]}
                  output={toolPart.output as Parameters<typeof RuleEditApprovalCard>[0]["output"]}
                  errorText={toolPart.errorText}
                />
              );
            case "draftBrief":
              return (
                <BriefDraftCard
                  key={i}
                  state={state}
                  output={toolPart.output as Parameters<typeof BriefDraftCard>[0]["output"]}
                  onSendFollowUp={onSendFollowUp}
                />
              );
            case "explainBasquio":
              return (
                <ExplainBasquioCard
                  key={i}
                  state={state}
                  output={toolPart.output as Parameters<typeof ExplainBasquioCard>[0]["output"]}
                />
              );
            case "suggestServices":
              return (
                <ServiceSuggestionCard
                  key={i}
                  state={state}
                  output={toolPart.output as Parameters<typeof ServiceSuggestionCard>[0]["output"]}
                  onSendFollowUp={onSendFollowUp}
                />
              );
            default:
              return null;
          }
        }
        return null;
      })}

      {!isUser && showInlineSuggestions ? (
        <WorkspaceInlineSuggestions
          suggestions={inlineSuggestions}
          onSend={onSendFollowUp}
        />
      ) : null}

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
          {onSaveAsMemo ? (
            <button
              type="button"
              className="wbeta-ai-action-btn"
              onClick={handleSave}
              disabled={saving !== null}
              aria-label="Save as memo"
            >
              <FileArrowDown size={12} weight="regular" />
              {saving === "memo" ? "Saving…" : "Save as memo"}
            </button>
          ) : null}
          {onGenerateDeck ? (
            <button
              type="button"
              className="wbeta-ai-action-btn wbeta-ai-action-btn-primary"
              onClick={handleDeck}
              disabled={saving !== null}
              aria-label="Generate a deck from this answer"
            >
              <Presentation size={12} weight="regular" />
              {saving === "deck" ? "Preparing…" : "Generate deck"}
            </button>
          ) : null}
          {saveMsg ? <span className="wbeta-ai-action-status">{saveMsg}</span> : null}
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
}, areChatMessagePropsEqual);

function areChatMessagePropsEqual(prev: ChatMessageProps, next: ChatMessageProps) {
  if (prev.isStreaming !== next.isStreaming) return false;
  if (next.isStreaming) {
    return streamingMessageSignature(prev.message) === streamingMessageSignature(next.message);
  }
  return (
    messagesDeepEqual(prev.message, next.message) &&
    prev.onCopy === next.onCopy &&
    prev.onRegenerate === next.onRegenerate &&
    prev.onFeedback === next.onFeedback &&
    prev.onSaveAsMemo === next.onSaveAsMemo &&
    prev.onGenerateDeck === next.onGenerateDeck &&
    prev.showInlineSuggestions === next.showInlineSuggestions &&
    prev.onSendFollowUp === next.onSendFollowUp
  );
}

function streamingMessageSignature(message: UIMessage) {
  const parts = (message.parts ?? []) as unknown as Part[];
  const last = parts.at(-1);
  return [
    message.id ?? "",
    message.role,
    parts.length,
    last?.type ?? "",
    last?.state ?? "",
    last?.text?.length ?? 0,
  ].join(":");
}

function messagesDeepEqual(prev: UIMessage, next: UIMessage) {
  if (prev === next) return true;
  return stableStringify(prev) === stableStringify(next);
}

function stableStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function deriveInlineSuggestions(
  message: UIMessage,
  citations: CitationInline[],
  hasScopeSignal: boolean,
): WorkspaceSuggestion[] {
  const id = message.id ?? "assistant";
  const cited = citations.length > 0;
  return [
    {
      id: `inline-memo-${id}`,
      kind: "summarize",
      prompt: cited
        ? "Turn the last answer into a concise cited memo."
        : "Turn the last answer into a concise memo.",
      reason: "Moves the useful answer into a reusable workspace artifact.",
    },
    {
      id: `inline-compare-${id}`,
      kind: "investigate",
      prompt: hasScopeSignal
        ? "Compare this answer with the saved scope memory."
        : "Compare this answer with my saved workspace memory.",
      reason: "Checks the answer against what Basquio already knows.",
    },
    {
      id: `inline-deck-${id}`,
      kind: "narrate",
      prompt: "Draft the next presentation outline from this answer.",
      reason: "Turns the analysis into the next executive deliverable.",
    },
  ];
}

function scopeSignal(message: UIMessage): string | null {
  const text = messageToMarkdown(message).toLowerCase();
  if (text.includes("scope") || text.includes("client") || text.includes("category")) return "scope";
  return null;
}

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
