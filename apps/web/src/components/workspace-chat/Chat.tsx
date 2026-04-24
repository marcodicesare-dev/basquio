"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import TextareaAutosize from "react-textarea-autosize";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, Paperclip, Stop, X, CheckCircle, WarningCircle } from "@phosphor-icons/react";

import { ChatMessage } from "@/components/workspace-chat/ChatMessage";
import type { CitationInline } from "@/components/workspace-chat/CitationChip";
import { WorkspaceGenerationDrawer } from "@/components/workspace-generation-drawer";
import {
  WorkspaceGenerationStatus,
  type ActiveGeneration,
} from "@/components/workspace-generation-status";
import { getWorkspaceCopy, type WorkspaceLocale } from "@/i18n";
import type { WorkspaceSuggestion } from "@/lib/workspace/suggestions";
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
  locale = "en",
  conversationId: initialConversationId,
  initialMessages,
  contextGreeting,
  promptSuggestions = [],
  compactEmpty = false,
}: {
  scopeId?: string | null;
  scopeName?: string | null;
  scopeKind?: string | null;
  locale?: WorkspaceLocale;
  conversationId?: string;
  initialMessages?: UIMessage[];
  contextGreeting?: string;
  promptSuggestions?: WorkspaceSuggestion[];
  compactEmpty?: boolean;
}) {
  const copy = getWorkspaceCopy(locale).chat;
  const conversationIdRef = useRef(
    initialConversationId ??
      (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID?.()
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingTurn, setPendingTurn] = useState<{ text: string; startedAt: number } | null>(null);
  const [pendingElapsed, setPendingElapsed] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [upload, setUpload] = useState<UploadStatus>({ kind: "idle" });
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [memoryPulse, setMemoryPulse] = useState<{
    documentCount: number;
    entities: Array<{ id: string; type: string; canonical_name: string }>;
    factCount: number;
  } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  const retryAttachment = useCallback(
    async (localId: string) => {
      const chip = attachments.find((c) => c.localId === localId);
      if (!chip || !chip.documentId) return;
      setAttachments((prev) =>
        prev.map((c) => (c.localId === localId ? { ...c, status: "indexing", message: undefined } : c)),
      );
      try {
        const response = await fetch(`/api/workspace/documents/${chip.documentId}/retry`, {
          method: "POST",
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setAttachments((prev) =>
            prev.map((c) =>
              c.localId === localId
                ? { ...c, status: "failed", message: data.error ?? "retry failed" }
                : c,
            ),
          );
        }
      } catch (err) {
        setAttachments((prev) =>
          prev.map((c) =>
            c.localId === localId
              ? {
                  ...c,
                  status: "failed",
                  message: err instanceof Error ? err.message : "retry failed",
                }
              : c,
          ),
        );
      }
    },
    [attachments],
  );

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
      setPendingTurn(null);
      stop();
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const isBusy = isStreaming || Boolean(pendingTurn);
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastAssistantStreaming =
    isStreaming && lastMessage?.role === "assistant";
  const pendingUserAlreadyRendered = pendingTurn
    ? lastMessage?.role === "user" && messageText(lastMessage).trim() === pendingTurn.text
    : false;
  const showPendingUser = Boolean(pendingTurn) && !pendingUserAlreadyRendered;
  const showAssistantPending = Boolean(pendingTurn);
  const hasConversation = messages.length > 0 || showPendingUser || showAssistantPending;

  useEffect(() => {
    if (!isStreaming) return;
    if (
      typeof performance === "undefined" ||
      typeof requestAnimationFrame === "undefined" ||
      typeof cancelAnimationFrame === "undefined"
    ) {
      return;
    }
    let last = performance.now();
    const frames: number[] = [];
    let raf = 0;
    const tick = (time: number) => {
      frames.push(time - last);
      last = time;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (frames.length === 0) return;
      const avg = frames.reduce((sum, frame) => sum + frame, 0) / frames.length;
      const slow = frames.filter((frame) => frame > 16.67).length;
      console.log(
        `[stream-perf] avg ${avg.toFixed(1)}ms, ${slow}/${frames.length} frames >16.67ms`,
      );
    };
  }, [isStreaming]);

  useEffect(() => {
    if (!pendingTurn) {
      setPendingElapsed(0);
      return;
    }
    const update = () => {
      setPendingElapsed((performance.now() - pendingTurn.startedAt) / 1000);
    };
    update();
    const interval = window.setInterval(update, 150);
    return () => window.clearInterval(interval);
  }, [pendingTurn]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [messages.length, lastAssistantStreaming, showAssistantPending]);

  useEffect(() => {
    if (lastMessage?.role === "assistant") {
      setPendingTurn(null);
    }
  }, [lastMessage?.id, lastMessage?.role]);

  useEffect(() => {
    const handleWorkspacePrompt = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt?.trim();
      if (!prompt || isBusy) return;
      setDraft(prompt);
      const focusInput = () => {
        inputRef.current?.focus();
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(focusInput);
      } else {
        focusInput();
      }
    };
    window.addEventListener("basquio:workspace-prompt", handleWorkspacePrompt);
    return () => {
      window.removeEventListener("basquio:workspace-prompt", handleWorkspacePrompt);
    };
  }, [isBusy]);

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
      if (!trimmed || isBusy) return;
      setError(null);
      setPendingTurn({ text: trimmed, startedAt: performance.now() });
      try {
        sendMessage({ text: trimmed });
        setDraft("");
      } catch (sendError) {
        setPendingTurn(null);
        throw sendError;
      }
    },
    [draft, isBusy, sendMessage],
  );

  const handleSendFollowUp = useCallback(
    (text: string) => {
      if (isBusy) return;
      setPendingTurn({ text, startedAt: performance.now() });
      sendMessage({ text });
    },
    [isBusy, sendMessage],
  );

  const handlePromptSuggestion = useCallback(
    (prompt: string) => {
      if (isBusy) return;
      setDraft(prompt);
      const focusInput = () => inputRef.current?.focus();
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(focusInput);
      } else {
        focusInput();
      }
    },
    [isBusy],
  );

  const handleStop = useCallback(() => {
    setPendingTurn(null);
    stop();
  }, [stop]);

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

  const placeholder = scopeName ? `${copy.askAbout} ${scopeName}` : "Message Basquio";

  return (
    <section
      id="workspace-chat"
      className={isDragOver ? "wbeta-ai-chat wbeta-ai-chat-drop" : "wbeta-ai-chat"}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {!hasConversation ? (
        <div
          className={
            compactEmpty
              ? "wbeta-ai-chat-empty wbeta-ai-chat-empty-compact"
              : "wbeta-ai-chat-empty"
          }
        >
          {compactEmpty ? (
            <p className="wbeta-ai-chat-empty-body">
              {contextGreeting ??
                (scopeName
                  ? `Ready with ${scopeName} memory. What is on your mind?`
                  : copy.workspaceEmptyBody)}
            </p>
          ) : (
            <>
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
                {scopeName ? `${copy.askAbout} ${scopeName}` : copy.workspaceEmptyTitle}
              </h2>
              <p className="wbeta-ai-chat-empty-body">
                {contextGreeting ??
                  (scopeName
                    ? `Pulls from ${scopeName} memory, uploads, and prior answers. Every claim cited.`
                    : copy.workspaceEmptyBody)}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="wbeta-ai-chat-stream" role="log" aria-live="polite" aria-busy={isBusy}>
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
                showInlineSuggestions={isLast && message.role === "assistant" && !isStreaming}
                onSendFollowUp={
                  !isStreaming
                    ? handleSendFollowUp
                    : undefined
                }
              />
            );
          })}
          {showPendingUser && pendingTurn ? (
            <article className="wbeta-ai-msg wbeta-ai-msg-user wbeta-ai-msg-pending-user">
              <p className="wbeta-ai-user-bubble">{pendingTurn.text}</p>
            </article>
          ) : null}
          {showAssistantPending ? (
            <div className="wbeta-ai-msg wbeta-ai-msg-asst wbeta-ai-msg-pending-asst" role="status" aria-live="polite">
              <div className="wbeta-ai-thinking">
                <span className="wbeta-ai-thinking-pulse" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                <span className="wbeta-ai-thinking-copy">
                  Reading {scopeName ? `${scopeName} memory` : "workspace memory"}
                </span>
                <span className="wbeta-ai-thinking-time">{pendingElapsed.toFixed(1)}s</span>
              </div>
            </div>
          ) : null}
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
                  <Paperclip size={14} weight="thin" className="wbeta-ai-chat-chip-icon-pulse" />
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
              {chip.status === "failed" && chip.documentId ? (
                <button
                  type="button"
                  className="wbeta-ai-chat-chip-retry"
                  onClick={() => retryAttachment(chip.localId)}
                  aria-label={`Retry indexing ${chip.filename}`}
                >
                  Retry
                </button>
              ) : null}
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

      {messages.length === 0 && promptSuggestions.length > 0 ? (
        <div className="wbeta-ai-chat-prompt-pills" aria-label="Suggested prompts">
          {promptSuggestions.slice(0, 3).map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              className="wbeta-ai-chat-prompt-pill"
              onClick={() => handlePromptSuggestion(suggestion.prompt)}
              disabled={isBusy}
            >
              {compactPrompt(suggestion.prompt)}
            </button>
          ))}
        </div>
      ) : null}

      <form className="wbeta-ai-chat-form" onSubmit={handleSubmit}>
        <label className="wbeta-ai-chat-label" htmlFor="wbeta-ai-input">
          {copy.message}
        </label>
        <TextareaAutosize
          ref={inputRef}
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
          minRows={1}
          maxRows={10}
          disabled={isBusy}
        />
        <div className="wbeta-ai-chat-row">
          <button
            type="button"
            className="wbeta-ai-chat-attach"
            onClick={handleAttachClick}
            disabled={isBusy}
            aria-label={copy.attachFile}
          >
            <Paperclip size={14} weight="regular" />
          </button>
          <p className="wbeta-ai-chat-hint" aria-live="polite">
            {isBusy ? copy.generating : <kbd className="wbeta-kbd">⌘ ↵</kbd>}
          </p>
          {isBusy ? (
            <button
              type="button"
              className="wbeta-ai-chat-stop"
              onClick={handleStop}
              aria-label={copy.stopGeneration}
            >
              <Stop size={13} weight="fill" />
              {copy.stop}
            </button>
          ) : (
            <button
              type="submit"
              className="wbeta-ai-chat-send"
              disabled={!draft.trim()}
              aria-label={copy.sendMessage}
            >
              <ArrowUp size={14} weight="bold" />
              <span className="wbeta-ai-chat-send-label">{copy.send}</span>
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

function compactPrompt(prompt: string): string {
  return prompt.length > 56 ? `${prompt.slice(0, 53).trim()}...` : prompt;
}

function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n\n");
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
