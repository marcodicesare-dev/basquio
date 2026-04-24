"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { WorkspaceAnswerCard, type AnswerView, type CitationView } from "@/components/workspace-answer-card";

type StreamEvent =
  | { type: "meta"; deliverableId: string; scope: string }
  | { type: "status"; message: string }
  | { type: "text-delta"; text: string }
  | { type: "done"; deliverableId: string; bodyMarkdown: string; citations: CitationView[]; scope: string }
  | { type: "error"; deliverableId: string | null; message: string };

/**
 * Scope-as-navigation rule: the prompt never carries a scope chip.
 * The surrounding page decides what scope the prompt submits against, and passes
 * `scopeId` + `scopeName` + `scopeKind` here. For the workspace home, scope is
 * undefined and submits as the legacy "workspace" scope.
 */
export function WorkspacePrompt({
  scopeId,
  scopeName,
  scopeKind,
}: {
  scopeId?: string;
  scopeName?: string;
  scopeKind?: string;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [answer, setAnswer] = useState<AnswerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const legacyScopeValue = scopeToLegacyValue(scopeKind, scopeName);
  const placeholder = scopeName
    ? `Ask about ${scopeName}, or describe a deliverable.`
    : "Ask a question or describe a deliverable. Example: what changed in Q4 vs Q3 and why.";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || isStreaming) return;
    setError(null);
    setIsStreaming(true);
    setStatusMessage("Sending.");
    setStreamingText("");
    setAnswer(null);

    const submittedPrompt = prompt.trim();

    let activeDeliverableId: string | null = null;
    let activeScope = legacyScopeValue;
    let accumulatedText = "";

    try {
      const response = await fetch("/api/workspace/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: submittedPrompt,
          scope: legacyScopeValue,
          workspace_scope_id: scopeId ?? null,
        }),
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Generation failed (${response.status}).`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalCitations: CitationView[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const block of lines) {
          const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          let parsed: StreamEvent;
          try {
            parsed = JSON.parse(dataLine.slice(6)) as StreamEvent;
          } catch {
            continue;
          }
          if (parsed.type === "meta") {
            activeDeliverableId = parsed.deliverableId;
            activeScope = parsed.scope;
            setStatusMessage(
              scopeName ? `Working inside ${scopeName}.` : "Reading your workspace.",
            );
          } else if (parsed.type === "status") {
            setStatusMessage(parsed.message);
          } else if (parsed.type === "text-delta") {
            accumulatedText += parsed.text;
            setStreamingText(accumulatedText);
            setStatusMessage(null);
          } else if (parsed.type === "done") {
            finalCitations = parsed.citations;
            accumulatedText = parsed.bodyMarkdown;
            activeDeliverableId = parsed.deliverableId;
            activeScope = parsed.scope;
          } else if (parsed.type === "error") {
            setError(parsed.message);
          }
        }
      }

      if (accumulatedText) {
        setAnswer({
          deliverableId: activeDeliverableId ?? "",
          bodyMarkdown: accumulatedText,
          citations: finalCitations,
          scope: activeScope,
          prompt: submittedPrompt,
        });
        setStreamingText("");
        setPrompt("");
        startTransition(() => router.refresh());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setIsStreaming(false);
      setStatusMessage(null);
    }
  }

  const liveAnswer: AnswerView | null = isStreaming && streamingText
    ? {
        deliverableId: "",
        bodyMarkdown: streamingText,
        citations: [],
        scope: legacyScopeValue,
        prompt: prompt.trim() || "Generating.",
      }
    : null;

  return (
    <div className="wbeta-prompt-shell">
      <form className="wbeta-prompt-form" onSubmit={handleSubmit}>
        <label className="wbeta-prompt-label" htmlFor="wbeta-prompt-input">
          Ask anything
        </label>
        <textarea
          id="wbeta-prompt-input"
          className="wbeta-prompt-input wbeta-prompt-textarea"
          placeholder={placeholder}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={3}
          disabled={isStreaming}
        />
        <div className="wbeta-prompt-row">
          <p className="wbeta-prompt-hint" aria-live="polite">
            {isStreaming
              ? statusMessage ?? "Streaming the answer."
              : "Cmd+Enter to send. Cmd+/ for shortcuts. Every claim cites a source from your uploads."}
          </p>
          <button
            type="submit"
            className="wbeta-prompt-submit"
            aria-busy={isStreaming}
            data-loading={isStreaming ? "true" : undefined}
            disabled={isStreaming || prompt.trim().length === 0}
          >
            {isStreaming ? "Generating" : "Send"}
          </button>
        </div>
      </form>

      {error ? <p className="wbeta-prompt-error">{error}</p> : null}

      {liveAnswer ? <WorkspaceAnswerCard answer={liveAnswer} /> : null}
      {!liveAnswer && answer ? <WorkspaceAnswerCard answer={answer} /> : null}
    </div>
  );
}

/**
 * Map a workspace_scope row onto the legacy scope string format the /ask
 * endpoint uses today. Task 7 (AI SDK 6 migration) moves /ask to accept
 * workspace_scope_id directly; until then this preserves behavior.
 */
function scopeToLegacyValue(kind?: string, name?: string): string {
  if (!kind || !name) return "workspace";
  if (kind === "system") return name.toLowerCase();
  return `${kind}:${name}`;
}
