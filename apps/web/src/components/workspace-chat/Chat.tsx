"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, Paperclip, Stop, X, CheckCircle, WarningCircle, CircleNotch } from "@phosphor-icons/react";

import { ChatMessage } from "@/components/workspace-chat/ChatMessage";
import type { CitationInline } from "@/components/workspace-chat/CitationChip";
import { WorkspaceGenerationDrawer } from "@/components/workspace-generation-drawer";
import {
  WorkspaceGenerationStatus,
  type ActiveGeneration,
} from "@/components/workspace-generation-status";
import { uploadWorkspaceFile } from "@/lib/workspace/upload-client";

type AttachmentChip = {
  localId: string;
  filename: string;
  sizeBytes: number;
  status: "uploading" | "indexing" | "indexed" | "failed";
  documentId?: string;
  message?: string;
};

type UploadStatus =
  | { kind: "idle" }
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
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [memoryPulse, setMemoryPulse] = useState<{
    documentCount: number;
    entities: Array<{ id: string; type: string; canonical_name: string }>;
    factCount: number;
  } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const router = useRouter();

  const updateAttachment = useCallback((localId: string, patch: Partial<AttachmentChip>) => {
    setAttachments((prev) =>
      prev.map((chip) => (chip.localId === localId ? { ...chip, ...patch } : chip)),
    );
  }, []);

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => prev.filter((chip) => chip.localId !== localId));
  }, []);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f && f.size > 0);
      if (list.length === 0) return;
      for (const file of list) {
        const localId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setAttachments((prev) => [
          ...prev,
          {
            localId,
            filename: file.name,
            sizeBytes: file.size,
            status: "uploading",
          },
        ]);
        try {
          // Direct-to-storage upload flow owned by port-louis (prepare → PUT →
          // confirm). We layer the dual-lane attachment on top: the confirm
          // response carries the document id + status, and the confirm route
          // (server-side) records the conversation_attachment when the
          // conversation_id lives in this viewer's workspace.
          const result = await uploadWorkspaceFile(file, {
            conversationId: conversationIdRef.current,
            scopeId: scopeId ?? null,
          });
          const nextStatus: AttachmentChip["status"] =
            result.status === "indexed"
              ? "indexed"
              : result.status === "failed"
                ? "failed"
                : "indexing";
          updateAttachment(localId, {
            status: nextStatus,
            documentId: result.id,
            message: nextStatus === "failed" ? "indexing failed earlier" : undefined,
          });
        } catch (uploadError) {
          const message =
            uploadError instanceof Error ? uploadError.message : "Upload failed.";
          updateAttachment(localId, { status: "failed", message });
          setUpload({ kind: "error", message });
          continue;
        }
      }
      router.refresh();
      setTimeout(() => setUpload({ kind: "idle" }), 4000);
    },
    [router, scopeId, updateAttachment],
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

  // Load existing attachments on mount so a returning user sees their files.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/workspace/conversations/${conversationIdRef.current}/attachments`,
        );
        if (!response.ok) return;
        const data = (await response.json().catch(() => ({}))) as {
          attachments?: Array<{
            id: string;
            documentId: string;
            filename: string | null;
            fileSizeBytes: number | null;
            status: string | null;
          }>;
        };
        if (cancelled) return;
        setAttachments((prev) => {
          // Keep any local-only chips that haven't round-tripped yet.
          const existingDocIds = new Set(
            prev.filter((c) => c.documentId).map((c) => c.documentId as string),
          );
          const mapped: AttachmentChip[] = (data.attachments ?? [])
            .filter((a) => !existingDocIds.has(a.documentId))
            .map((a) => ({
              localId: `server-${a.documentId}`,
              filename: a.filename ?? "attached file",
              sizeBytes: a.fileSizeBytes ?? 0,
              status:
                a.status === "indexed"
                  ? "indexed"
                  : a.status === "failed"
                    ? "failed"
                    : "indexing",
              documentId: a.documentId,
            }));
          return [...prev, ...mapped];
        });
      } catch {
        // No-op: empty list is fine.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll the attachments endpoint every 4s while any chip is still indexing, so
  // the user sees "indexed" ticks when the background worker finishes. Stops as
  // soon as everything is terminal.
  useEffect(() => {
    const pending = attachments.filter((c) => c.status === "indexing" && c.documentId);
    if (pending.length === 0) return;
    const pendingIds = new Set(pending.map((c) => c.documentId as string));
    const interval = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/workspace/conversations/${conversationIdRef.current}/attachments`,
        );
        if (!response.ok) return;
        const data = (await response.json().catch(() => ({}))) as {
          attachments?: Array<{ documentId: string; status: string | null }>;
        };
        const statusById = new Map(
          (data.attachments ?? []).map((a) => [a.documentId, a.status ?? null]),
        );
        setAttachments((prev) =>
          prev.map((chip) => {
            if (!chip.documentId || !pendingIds.has(chip.documentId)) return chip;
            const serverStatus = statusById.get(chip.documentId);
            if (serverStatus === "indexed") return { ...chip, status: "indexed" };
            if (serverStatus === "failed") return { ...chip, status: "failed" };
            return chip;
          }),
        );
      } catch {
        // Ignore — next tick tries again.
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [attachments]);

  // Lane C visibility: fetch the entities/facts extracted from documents attached
  // to this conversation. Refreshes when a chip transitions to "indexed" so the
  // user sees what just entered memory without jumping to /workspace/memory.
  const indexedAttachmentCount = attachments.filter((c) => c.status === "indexed").length;
  useEffect(() => {
    if (indexedAttachmentCount === 0) {
      setMemoryPulse(null);
      return;
    }
    let cancelled = false;
    const fetchMemory = async () => {
      try {
        const response = await fetch(
          `/api/workspace/conversations/${conversationIdRef.current}/memory`,
        );
        if (!response.ok) return;
        const data = (await response.json().catch(() => ({}))) as {
          documentCount?: number;
          entities?: Array<{ id: string; type: string; canonical_name: string }>;
          facts?: Array<unknown>;
        };
        if (cancelled) return;
        if ((data.entities?.length ?? 0) === 0 && (data.facts?.length ?? 0) === 0) {
          setMemoryPulse(null);
          return;
        }
        setMemoryPulse({
          documentCount: data.documentCount ?? 0,
          entities: data.entities ?? [],
          factCount: data.facts?.length ?? 0,
        });
      } catch {
        // Ignore.
      }
    };
    void fetchMemory();
    return () => {
      cancelled = true;
    };
  }, [indexedAttachmentCount]);

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

      {attachments.length > 0 ? (
        <ul className="wbeta-ai-chat-attachments" role="list" aria-label="Files attached to this conversation">
          {attachments.map((chip) => (
            <li key={chip.localId} className={`wbeta-ai-chat-chip wbeta-ai-chat-chip-${chip.status}`}>
              <span className="wbeta-ai-chat-chip-icon" aria-hidden>
                {chip.status === "uploading" || chip.status === "indexing" ? (
                  <CircleNotch size={14} weight="bold" className="wbeta-spin" />
                ) : chip.status === "indexed" ? (
                  <CheckCircle size={14} weight="fill" />
                ) : (
                  <WarningCircle size={14} weight="fill" />
                )}
              </span>
              <span className="wbeta-ai-chat-chip-body">
                <span className="wbeta-ai-chat-chip-name" title={chip.filename}>
                  {chip.filename}
                </span>
                <span className="wbeta-ai-chat-chip-meta">
                  {formatBytes(chip.sizeBytes)}
                  {chip.status === "uploading" ? " · uploading" : null}
                  {chip.status === "indexing" ? " · attached, indexing for memory" : null}
                  {chip.status === "indexed" ? " · attached" : null}
                  {chip.status === "failed" ? ` · ${chip.message ?? "upload failed"}` : null}
                </span>
              </span>
              <button
                type="button"
                className="wbeta-ai-chat-chip-remove"
                onClick={() => removeAttachment(chip.localId)}
                aria-label={`Remove ${chip.filename} from this chat`}
              >
                <X size={12} weight="bold" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {memoryPulse && memoryPulse.entities.length > 0 ? (
        <p className="wbeta-ai-chat-memory-pulse" role="status" aria-live="polite">
          <span className="wbeta-ai-chat-memory-pulse-kicker">In workspace memory from this chat</span>
          <span className="wbeta-ai-chat-memory-pulse-body">
            {memoryPulse.entities
              .slice(0, 4)
              .map((e) => e.canonical_name)
              .join(" · ")}
            {memoryPulse.entities.length > 4 ? ` · +${memoryPulse.entities.length - 4} more` : ""}
            {memoryPulse.factCount > 0 ? ` · ${memoryPulse.factCount} facts` : ""}
          </span>
        </p>
      ) : null}

      {upload.kind === "error" ? (
        <p className="wbeta-ai-chat-upload wbeta-ai-chat-upload-error" role="status" aria-live="polite">
          {upload.message}
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
            disabled={isStreaming}
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

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
