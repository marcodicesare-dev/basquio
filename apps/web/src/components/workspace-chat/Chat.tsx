"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, Paperclip, Stop } from "@phosphor-icons/react";

import { ChatMessage } from "@/components/workspace-chat/ChatMessage";
import type { CitationInline } from "@/components/workspace-chat/CitationChip";
import { WorkspaceGenerationDrawer } from "@/components/workspace-generation-drawer";
import {
  WorkspaceGenerationStatus,
  type ActiveGeneration,
} from "@/components/workspace-generation-status";

type UploadStatus =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "success"; filename: string }
  | { kind: "error"; message: string };

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
  const [isDragOver, setIsDragOver] = useState(false);
  const [upload, setUpload] = useState<UploadStatus>({ kind: "idle" });
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const router = useRouter();

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f && f.size > 0);
      if (list.length === 0) return;
      for (const file of list) {
        setUpload({ kind: "uploading", filename: file.name });
        const formData = new FormData();
        formData.append("file", file);
        try {
          const response = await fetch("/api/workspace/uploads", {
            method: "POST",
            body: formData,
          });
          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!response.ok) {
            setUpload({ kind: "error", message: data.error ?? "Upload failed." });
            return;
          }
          setUpload({ kind: "success", filename: file.name });
        } catch (uploadError) {
          const message =
            uploadError instanceof Error ? uploadError.message : "Upload failed.";
          setUpload({ kind: "error", message });
          return;
        }
      }
      router.refresh();
      setTimeout(() => setUpload({ kind: "idle" }), 4000);
    },
    [router],
  );

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragOver(false);
      if (event.dataTransfer?.files?.length) {
        void uploadFiles(event.dataTransfer.files);
      }
    },
    [uploadFiles],
  );

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) void uploadFiles(files);
      event.target.value = "";
    },
    [uploadFiles],
  );

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

  const deriveTitle = useCallback(
    (text: string): string => {
      const firstLine = text
        .split("\n")
        .map((s) => s.replace(/^#+\s*/, "").trim())
        .find((s) => s.length > 0);
      if (firstLine && firstLine.length > 0) return firstLine.slice(0, 200);
      if (scopeName) return `Memo · ${scopeName}`;
      return "Untitled memo";
    },
    [scopeName],
  );

  const derivePrompt = useCallback((): string => {
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser) return "Saved from chat";
    const parts = (firstUser.parts ?? []) as Array<{ type?: string; text?: string }>;
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join(" ");
    return text.slice(0, 1200) || "Saved from chat";
  }, [messages]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMessageId, setDrawerMessageId] = useState<string | null>(null);
  const [activeGen, setActiveGen] = useState<ActiveGeneration | null>(null);

  const saveAsMemo = useCallback(
    async ({
      text,
      citations,
      messageId,
    }: {
      text: string;
      citations: CitationInline[];
      messageId: string;
    }): Promise<string | null> => {
      try {
        const response = await fetch("/api/workspace/deliverables", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: deriveTitle(text),
            prompt: derivePrompt(),
            body_markdown: text,
            citations: citations.map((c) => ({
              label: c.label,
              source_type: c.source_type ?? "chunk",
              source_id: c.source_id ?? "",
              filename: c.filename ?? null,
              excerpt: c.excerpt ?? "",
            })),
            scope: scopeName ?? null,
            workspace_scope_id: scopeId ?? null,
            conversation_id: conversationIdRef.current,
            from_message_id: messageId,
            kind: "memo",
          }),
        });
        const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!response.ok || !data.url) return null;
        return data.url;
      } catch {
        return null;
      }
    },
    [deriveTitle, derivePrompt, scopeName, scopeId],
  );

  const openGenerationDrawer = useCallback(
    async ({ messageId }: { messageId: string }): Promise<string | null> => {
      setDrawerMessageId(messageId || null);
      setDrawerOpen(true);
      return "drawer-opened";
    },
    [],
  );

  const placeholder = scopeName ? `Ask about ${scopeName}` : "Message Basquio";

  return (
    <section
      className={isDragOver ? "wbeta-ai-chat wbeta-ai-chat-drop" : "wbeta-ai-chat"}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {messages.length === 0 ? (
        <div className="wbeta-ai-chat-empty">
          {scopeName ? (
            <p className="wbeta-ai-chat-empty-kicker">
              {scopeKind === "client"
                ? "Client"
                : scopeKind === "category"
                  ? "Category"
                  : scopeKind === "function"
                    ? "Function"
                    : "Scope"}
              {" · "}
              {scopeName}
            </p>
          ) : null}
          <h2 className="wbeta-ai-chat-empty-title">
            {scopeName ? `Ask about ${scopeName}` : "Your analyst memory, always there."}
          </h2>
          <p className="wbeta-ai-chat-empty-body">
            {scopeName
              ? `Pulls from ${scopeName} memory, uploads, and prior answers. Every claim cited.`
              : "Basquio knows your clients, stakeholders, and style. Every answer cites where it came from."}
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
                onSaveAsMemo={message.role === "assistant" && !isStreaming ? saveAsMemo : undefined}
                onGenerateDeck={
                  message.role === "assistant" && !isStreaming ? openGenerationDrawer : undefined
                }
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

      {isDragOver ? (
        <div className="wbeta-ai-chat-drop-overlay" aria-hidden>
          <div className="wbeta-ai-chat-drop-card">
            <Paperclip size={18} weight="bold" />
            <p>Drop to add to your workspace</p>
          </div>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={handleFileChange}
        aria-hidden
      />

      {upload.kind !== "idle" ? (
        <p
          className={
            upload.kind === "error"
              ? "wbeta-ai-chat-upload wbeta-ai-chat-upload-error"
              : "wbeta-ai-chat-upload"
          }
          role="status"
          aria-live="polite"
        >
          {upload.kind === "uploading"
            ? `Uploading ${upload.filename}…`
            : upload.kind === "success"
              ? `Added ${upload.filename}. Basquio is indexing it in the background.`
              : upload.message}
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
          <button
            type="button"
            className="wbeta-ai-chat-attach"
            onClick={handleAttachClick}
            disabled={isStreaming || upload.kind === "uploading"}
            aria-label="Attach a file"
          >
            <Paperclip size={14} weight="regular" />
          </button>
          <p className="wbeta-ai-chat-hint" aria-live="polite">
            {isStreaming ? "Generating" : <kbd className="wbeta-kbd">⌘ ↵</kbd>}
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

      {activeGen ? (
        <WorkspaceGenerationStatus
          active={activeGen}
          onDismiss={(runId) => {
            if (activeGen?.runId === runId) setActiveGen(null);
          }}
        />
      ) : null}

      <WorkspaceGenerationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        conversationId={conversationIdRef.current}
        messageId={drawerMessageId}
        scopeId={scopeId ?? null}
        onLaunched={({ runId, progressUrl }) => {
          setActiveGen({
            runId,
            progressUrl,
            title: drawerMessageId
              ? `Deck from ${scopeName ?? "workspace"}`
              : `Workspace deck`,
            startedAt: Date.now(),
          });
        }}
      />
    </section>
  );
}
