"use client";

import { memo, useEffect, useState } from "react";
import {
  CaretDown,
  CaretRight,
  CheckCircle,
  ClipboardText,
  FileArrowDown,
  Presentation,
  ThumbsDown,
  ThumbsUp,
  WarningCircle,
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
import {
  parseFollowUpSuggestions,
  suggestionsFromMessageMetadata,
} from "@/lib/workspace/chat-followup-suggestions";

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
  return parseFollowUpSuggestions(messageText(message)).text;
}

function messageText(message: UIMessage): string {
  const parts = (message.parts ?? []) as unknown as Part[];
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n\n");
}

function assistantVisibleText(text: string): string {
  return parseFollowUpSuggestions(text).text;
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
  const parts = (message.parts ?? []) as unknown as Part[];
  const hasAssistantText = parts.some(
    (part) =>
      part.type === "text" &&
      assistantVisibleText(part.text ?? "").trim().length > 0,
  );
  const lastPartIndex = parts.length - 1;
  const toolPartOrdinals = new Map<number, number>();
  let toolCount = 0;
  parts.forEach((part, index) => {
    if (part.type?.startsWith("tool-")) {
      toolCount += 1;
      toolPartOrdinals.set(index, toolCount);
    }
  });
  const metadataSuggestions = deriveMetadataInlineSuggestions(message);
  const inlineSuggestions =
    metadataSuggestions.length > 0
      ? metadataSuggestions
      : deriveInlineSuggestions(message, citations, Boolean(scopeSignal(message)));

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
          const visibleText = assistantVisibleText(text);
          if (!visibleText) return null;
          const shouldRenderStreamingText = isStreaming && i === lastPartIndex;
          return (
            <div key={i} className="wbeta-ai-asst-block">
              {shouldRenderStreamingText ? (
                <div className="wbeta-ai-streaming-text">
                  {visibleText}
                  <span className="wbeta-ai-cursor" aria-hidden />
                </div>
              ) : (
                <ChatMarkdown source={visibleText} citations={citations} />
              )}
            </div>
          );
        }
        if (part.type === "reasoning") {
          const text = (part as { text?: string }).text ?? "";
          if (!text) return null;
          return (
            <ReasoningStream
              key={i}
              text={text}
              isStreaming={isStreaming}
              hasAssistantText={hasAssistantText}
            />
          );
        }
        if (part.type?.startsWith("tool-")) {
          const toolPart = part as unknown as ToolPart;
          const toolName = part.type.slice(5);
          const state = (toolPart.state as string) || "input-available";
          const toolOrdinal = toolPartOrdinals.get(i) ?? 0;
          const status = toolStatusFromPart(toolPart);
          const callChip = (
            <ToolCallChip
              toolName={toolName}
              toolStatus={status}
              output={toolPart.output}
              errorText={toolPart.errorText ?? toolOutputError(toolPart.output)}
            />
          );
          const frame = (node: React.ReactNode) => (
            <ToolFrame key={i} compact={toolOrdinal > 3} label={toolFrameLabel(toolName)}>
              {node}
            </ToolFrame>
          );
          switch (toolName) {
            case "memory":
              return frame(
                <>
                  {callChip}
                  <MemoryReadChip
                    state={state}
                    input={toolPart.input as Parameters<typeof MemoryReadChip>[0]["input"]}
                    output={toolPart.output as Parameters<typeof MemoryReadChip>[0]["output"]}
                    errorText={toolPart.errorText}
                  />
                </>,
              );
            case "retrieveContext":
              return frame(
                <>
                  {callChip}
                  <RetrieveContextChip
                    state={state}
                    input={toolPart.input as Parameters<typeof RetrieveContextChip>[0]["input"]}
                    output={toolPart.output as Parameters<typeof RetrieveContextChip>[0]["output"]}
                    errorText={toolPart.errorText}
                  />
                </>,
              );
            case "teachRule":
              return frame(
                <>
                  {callChip}
                  <TeachRuleCard
                    state={state}
                    input={toolPart.input as Parameters<typeof TeachRuleCard>[0]["input"]}
                    output={toolPart.output as Parameters<typeof TeachRuleCard>[0]["output"]}
                    errorText={toolPart.errorText}
                  />
                </>,
              );
            case "showMetricCard":
              return frame(
                <>
                  {callChip}
                  <MetricCard
                    state={state}
                    input={toolPart.input as Parameters<typeof MetricCard>[0]["input"]}
                  />
                </>,
              );
            case "showStakeholderCard":
              return frame(
                <>
                  {callChip}
                  <StakeholderCard
                    state={state}
                    input={toolPart.input as Parameters<typeof StakeholderCard>[0]["input"]}
                    output={toolPart.output as Parameters<typeof StakeholderCard>[0]["output"]}
                  />
                </>,
              );
            case "saveFromPaste":
            case "scrapeUrl":
              return frame(
                <>
                  {callChip}
                  <ExtractionApprovalCard
                    state={state}
                    toolName={toolName}
                    input={toolPart.input as Parameters<typeof ExtractionApprovalCard>[0]["input"]}
                    output={toolPart.output as Parameters<typeof ExtractionApprovalCard>[0]["output"]}
                    errorText={toolPart.errorText}
                    onSendFollowUp={onSendFollowUp}
                  />
                </>,
              );
            case "editStakeholder":
              return frame(
                <>
                  {callChip}
                  <StakeholderEditApprovalCard
                    state={state}
                    output={toolPart.output as Parameters<typeof StakeholderEditApprovalCard>[0]["output"]}
                    errorText={toolPart.errorText}
                    onSendFollowUp={onSendFollowUp}
                  />
                </>,
              );
            case "createStakeholder":
              return frame(
                <>
                  {callChip}
                  <StakeholderCreateApprovalCard
                    state={state}
                    output={toolPart.output as Parameters<typeof StakeholderCreateApprovalCard>[0]["output"]}
                    errorText={toolPart.errorText}
                    onSendFollowUp={onSendFollowUp}
                  />
                </>,
              );
            case "editRule":
              return frame(
                <>
                  {callChip}
                  <RuleEditApprovalCard
                    state={state}
                    input={toolPart.input as Parameters<typeof RuleEditApprovalCard>[0]["input"]}
                    output={toolPart.output as Parameters<typeof RuleEditApprovalCard>[0]["output"]}
                    errorText={toolPart.errorText}
                  />
                </>,
              );
            case "draftBrief":
              return frame(
                <>
                  {callChip}
                  <BriefDraftCard
                    state={state}
                    output={toolPart.output as Parameters<typeof BriefDraftCard>[0]["output"]}
                    onSendFollowUp={onSendFollowUp}
                  />
                </>,
              );
            case "explainBasquio":
              return frame(
                <>
                  {callChip}
                  <ExplainBasquioCard
                    state={state}
                    output={toolPart.output as Parameters<typeof ExplainBasquioCard>[0]["output"]}
                  />
                </>,
              );
            case "suggestServices":
              return frame(
                <>
                  {callChip}
                  <ServiceSuggestionCard
                    state={state}
                    output={toolPart.output as Parameters<typeof ServiceSuggestionCard>[0]["output"]}
                    onSendFollowUp={onSendFollowUp}
                  />
                </>,
              );
            default:
              return frame(callChip);
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
  if (prev.isStreaming || next.isStreaming) return false;
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

function ToolFrame({
  compact,
  label,
  children,
}: {
  compact: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (!compact) {
    return <div className="wbeta-ai-tool-frame">{children}</div>;
  }
  return (
    <details className="wbeta-ai-tool-frame wbeta-ai-tool-frame-compact">
      <summary>
        <span>{label}</span>
        <span>Show all</span>
      </summary>
      <div className="wbeta-ai-tool-frame-expanded">{children}</div>
    </details>
  );
}

function toolFrameLabel(toolName: string) {
  switch (toolName) {
    case "showStakeholderCard":
      return "More stakeholder detail";
    case "showMetricCard":
      return "More metric detail";
    case "retrieveContext":
      return "More cited context";
    case "suggestServices":
      return "More service ideas";
    default:
      return "More workspace detail";
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

function deriveMetadataInlineSuggestions(message: UIMessage): WorkspaceSuggestion[] {
  const metadataSuggestions = suggestionsFromMessageMetadata(message);
  const suggestions = metadataSuggestions.length > 0
    ? metadataSuggestions
    : parseFollowUpSuggestions(messageText(message)).suggestions;

  return suggestions.map((suggestion, index) => ({
    id: `inline-model-${message.id ?? "assistant"}-${index}`,
    kind: "investigate",
    prompt: suggestion.prompt,
    reason: suggestion.label,
  }));
}

function scopeSignal(message: UIMessage): string | null {
  const text = messageToMarkdown(message).toLowerCase();
  if (text.includes("scope") || text.includes("client") || text.includes("category")) return "scope";
  return null;
}

function ReasoningStream({
  text,
  isStreaming,
  hasAssistantText,
}: {
  text: string;
  isStreaming: boolean;
  hasAssistantText: boolean;
}) {
  const [open, setOpen] = useState(isStreaming && !hasAssistantText);

  useEffect(() => {
    if (isStreaming && !hasAssistantText) setOpen(true);
    if (hasAssistantText) setOpen(false);
  }, [hasAssistantText, isStreaming]);

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
        <span>{isStreaming && !hasAssistantText ? "Thinking..." : "Show thinking"}</span>
      </summary>
      <pre className="wbeta-ai-reasoning-body">{text}</pre>
    </details>
  );
}

type ToolCallStatus = "using" | "used" | "error";

function ToolCallChip({
  toolName,
  toolStatus,
  output,
  errorText,
}: {
  toolName: string;
  toolStatus: ToolCallStatus;
  output?: unknown;
  errorText?: string;
}) {
  const [startedAt] = useState(() => Date.now());
  const label =
    toolStatus === "using"
      ? `Using ${toolName}`
      : toolStatus === "used"
        ? `Used ${toolName}${toolOutputSummary(output)}`
        : `${formatToolName(toolName)} failed`;
  return (
    <div className={`wbeta-ai-tool-call-chip wbeta-ai-tool-call-chip-${toolStatus}`}>
      {toolStatus === "using" ? (
        <span className="wbeta-ai-thinking-pulse" aria-hidden>
          <span>•</span>
          <span>•</span>
          <span>•</span>
        </span>
      ) : toolStatus === "used" ? (
        <CheckCircle size={13} weight="fill" />
      ) : (
        <WarningCircle size={13} weight="fill" />
      )}
      <span>{label}</span>
      {toolStatus === "using" ? <ElapsedTimer startedAt={startedAt} /> : null}
      {toolStatus === "error" && errorText ? <small>{errorText}</small> : null}
    </div>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const update = () => setElapsed((Date.now() - startedAt) / 1000);
    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  return <span className="wbeta-ai-tool-call-time">{elapsed.toFixed(1)}s</span>;
}

function toolStatusFromPart(part: ToolPart): ToolCallStatus {
  if (part.errorText || part.state === "output-error" || toolOutputError(part.output)) return "error";
  if (part.output !== undefined || part.state === "output-available") return "used";
  return "using";
}

function toolOutputError(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const error = (output as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error.trim() : undefined;
}

function toolOutputSummary(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const resultCount = (output as { resultCount?: unknown; result_count?: unknown }).resultCount ??
    (output as { result_count?: unknown }).result_count;
  if (typeof resultCount === "number") return `, ${resultCount} results`;
  const results = (output as { results?: unknown }).results;
  if (Array.isArray(results)) return `, ${results.length} results`;
  const chunks = (output as { chunks?: unknown }).chunks;
  if (Array.isArray(chunks)) return `, ${chunks.length} sources`;
  return "";
}

function formatToolName(toolName: string): string {
  if (toolName === "webSearch") return "Web search";
  return toolName.replace(/([a-z])([A-Z])/g, "$1 $2");
}
