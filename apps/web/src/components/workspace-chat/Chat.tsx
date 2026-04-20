"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, Stop } from "@phosphor-icons/react";

import { ChatMessage } from "@/components/workspace-chat/ChatMessage";

export function WorkspaceChat({
  scopeId,
  scopeName,
  scopeKind,
  conversationId: initialConversationId,
  initialMessages,
}: {
  scopeId?: string | null;
  scopeName?: string | null;
  scopeKind?: string | null;
  conversationId?: string;
  initialMessages?: UIMessage[];
}) {
  const conversationIdRef = useRef(
    initialConversationId ??
      (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID?.()
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, stop, regenerate } = useChat({
    id: conversationIdRef.current,
    transport: new DefaultChatTransport({
      api: "/api/workspace/chat",
      prepareSendMessagesRequest: ({ id, messages: outgoing, body, headers, credentials, api }) => {
        const prepared: {
          body: Record<string, unknown>;
          headers?: HeadersInit;
          credentials?: RequestCredentials;
          api?: string;
        } = {
          body: {
            ...(body ?? {}),
            id,
            messages: outgoing,
            scope_id: scopeId ?? null,
          },
        };
        if (headers !== undefined) prepared.headers = headers;
        if (credentials !== undefined) prepared.credentials = credentials;
        if (api !== undefined) prepared.api = api;
        return prepared;
      },
    }),
    ...(initialMessages && initialMessages.length > 0 ? { messages: initialMessages } : {}),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (err) => {
      setError(err?.message ?? "Something went wrong.");
      stop();
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastAssistantStreaming =
    isStreaming && lastMessage?.role === "assistant";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, lastAssistantStreaming]);

  const handleSubmit = useCallback(
    (event?: React.FormEvent<HTMLFormElement>) => {
      if (event) event.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed || isStreaming) return;
      setError(null);
      sendMessage({ text: trimmed });
      setDraft("");
    },
    [draft, isStreaming, sendMessage],
  );

  const handleRegenerate = useCallback(() => {
    setError(null);
    regenerate();
  }, [regenerate]);

  const placeholder = scopeName
    ? `Ask about ${scopeName}.`
    : "Ask a question or describe a deliverable.";

  return (
    <section className="wbeta-ai-chat">
      {messages.length === 0 ? (
        <div className="wbeta-ai-chat-empty">
          <p className="wbeta-ai-chat-empty-kicker">
            {scopeName
              ? `Working inside ${scopeKind === "client" ? "Client" : scopeKind === "category" ? "Category" : scopeKind === "function" ? "Function" : "Workspace"}: ${scopeName}`
              : "Workspace level"}
          </p>
          <h2 className="wbeta-ai-chat-empty-title">
            {scopeName ? `Ask about ${scopeName}.` : "Ask anything about your work."}
          </h2>
          <p className="wbeta-ai-chat-empty-body">
            Basquio pulls from your memory, your uploads, and your team&apos;s past answers. Every
            claim cites where it came from.
          </p>
        </div>
      ) : (
        <div className="wbeta-ai-chat-stream" role="log" aria-live="polite" aria-busy={isStreaming}>
          {messages.map((message, i) => {
            const isLast = i === messages.length - 1;
            return (
              <ChatMessage
                key={message.id ?? i}
                message={message}
                isStreaming={isStreaming && isLast && message.role === "assistant"}
                onRegenerate={isLast && message.role === "assistant" ? handleRegenerate : undefined}
              />
            );
          })}
          <div ref={endRef} />
        </div>
      )}

      {error ? (
        <p className="wbeta-ai-chat-error">
          {error}. <button type="button" className="wbeta-ai-chat-error-retry" onClick={() => setError(null)}>Dismiss</button>
        </p>
      ) : null}

      <form className="wbeta-ai-chat-form" onSubmit={handleSubmit}>
        <label className="wbeta-ai-chat-label" htmlFor="wbeta-ai-input">
          Message
        </label>
        <textarea
          id="wbeta-ai-input"
          className="wbeta-ai-chat-textarea"
          placeholder={placeholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
          rows={3}
          disabled={isStreaming}
        />
        <div className="wbeta-ai-chat-row">
          <p className="wbeta-ai-chat-hint" aria-live="polite">
            {isStreaming
              ? "Generating. Cmd+Stop or click the stop button to abort."
              : "Cmd+Enter to send. Cmd+/ for shortcuts. Answers cite sources from your workspace."}
          </p>
          {isStreaming ? (
            <button
              type="button"
              className="wbeta-ai-chat-stop"
              onClick={() => stop()}
              aria-label="Stop generation"
            >
              <Stop size={13} weight="fill" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="wbeta-ai-chat-send"
              disabled={!draft.trim()}
              aria-label="Send message"
            >
              <ArrowUp size={14} weight="bold" />
              Send
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
