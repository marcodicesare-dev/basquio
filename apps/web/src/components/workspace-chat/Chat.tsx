"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import TextareaAutosize from "react-textarea-autosize";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { ArrowUp, Paperclip, Stop, X, CheckCircle, WarningCircle, Info } from "@phosphor-icons/react";

import { ChatMessage } from "@/components/workspace-chat/ChatMessage";
import type { CitationInline } from "@/components/workspace-chat/CitationChip";
import type { BriefDraftCardOutput } from "@/components/workspace-chat/ToolChips";
import {
  WorkspaceGenerationDrawer,
  type WorkspaceGenerationDraftBrief,
} from "@/components/workspace-generation-drawer";
import {
  WorkspaceGenerationStatus,
  type ActiveGeneration,
} from "@/components/workspace-generation-status";
import { getWorkspaceCopy, type WorkspaceLocale } from "@/i18n";
import type { WorkspaceSuggestion } from "@/lib/workspace/suggestions";
import { compactSuggestionPrompt } from "@/lib/workspace/suggestion-display";
import { CHAT_STREAM_UI_THROTTLE_MS } from "@/lib/workspace/chat-streaming";
import { uploadWorkspaceFile } from "@/lib/workspace/upload-client";

type AttachmentChip = {
  localId: string;
  filename: string;
  sizeBytes: number;
  fileType?: string | null;
  status: "uploading" | "indexing" | "indexed" | "indexing-failed" | "upload-failed";
  documentId?: string;
  message?: string;
};

const CHAT_UPLOAD_ACCEPT =
  ".pdf,.docx,.pptx,.xlsx,.xls,.csv,.md,.txt,.json,.yaml,.yml,.gsp,.png,.jpg,.jpeg,.webp,.gif,.mp3,.mp4,.wav,.m4a";

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
  const [activeTurnStartedAt, setActiveTurnStartedAt] = useState<number | null>(null);
  const [pendingElapsed, setPendingElapsed] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [upload, setUpload] = useState<UploadStatus>({ kind: "idle" });
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentChip | null>(null);
  const [memoryPulse, setMemoryPulse] = useState<{
    documentCount: number;
    entities: Array<{ id: string; type: string; canonical_name: string }>;
    factCount: number;
  } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scheduledSendRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const stickToLatestRef = useRef(true);
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
    async (files: FileList | File[], origin?: "chat-drop" | "chat-paste") => {
      const list = Array.from(files).filter((f) => f && f.size > 0);
      if (list.length === 0) return;
      for (const file of list) {
        const localId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const fileType = getFileExtension(file.name) || getExtensionFromMimeType(file.type);
        setAttachments((prev) => [
          ...prev,
          {
            localId,
            filename: file.name,
            sizeBytes: file.size,
            fileType,
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
            ...(origin ? { origin } : {}),
          });
          const nextStatus = mapAttachmentStatus(result.status);
          const attachmentFailed = result.attachedToConversation === false;
          updateAttachment(localId, {
            status: attachmentFailed ? "upload-failed" : nextStatus,
            documentId: result.id,
            message: attachmentFailed
              ? "saved, not attached to this chat"
              : nextStatus === "indexing-failed"
                ? "attached, readable here"
                : undefined,
          });
        } catch (uploadError) {
          const message =
            uploadError instanceof Error ? uploadError.message : "Upload failed.";
          updateAttachment(localId, { status: "upload-failed", message });
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
        void uploadFiles(event.dataTransfer.files, "chat-drop");
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
      if (files && files.length > 0) void uploadFiles(files, "chat-drop");
      event.target.value = "";
    },
    [uploadFiles],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = getClipboardFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void uploadFiles(files, "chat-paste");
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
    experimental_throttle: CHAT_STREAM_UI_THROTTLE_MS,
    onError: (err) => {
      setError(err?.message ?? "Something went wrong.");
      setPendingTurn(null);
      setActiveTurnStartedAt(null);
      stop();
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const isBusy = isStreaming || Boolean(pendingTurn);
  const hasUploadingAttachments = attachments.some((chip) => chip.status === "uploading");
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastAssistantStreaming =
    isStreaming && lastMessage?.role === "assistant";
  const lastAssistantTextLength = lastAssistantStreaming && lastMessage ? messageText(lastMessage).length : 0;
  const pendingUserAlreadyRendered = pendingTurn
    ? messages
        .slice(-3)
        .some((message) => message.role === "user" && messageText(message).trim() === pendingTurn.text)
    : false;
  const showPendingUser = Boolean(pendingTurn) && !pendingUserAlreadyRendered;
  const lastAssistantHasText =
    lastMessage?.role === "assistant" && messageText(lastMessage).trim().length > 0;
  const lastAssistantHasNonTextParts =
    lastMessage?.role === "assistant" &&
    (lastMessage.parts ?? []).some((part) => part.type && part.type !== "text");
  const showAssistantActivity = isBusy && !(isStreaming && lastAssistantHasText);
  const activityOwnsLastAssistantSlot =
    showAssistantActivity &&
    lastMessage?.role === "assistant" &&
    !lastAssistantHasText &&
    !lastAssistantHasNonTextParts;
  const activityCopy = getActivityCopy({
    hasPendingTurn: Boolean(pendingTurn),
    lastMessage,
  });
  const hasConversation = messages.length > 0 || showPendingUser || showAssistantActivity;

  const dispatchCurrentMessage = useCallback(
    (text: string) => {
      if (scheduledSendRef.current !== null) {
        window.clearTimeout(scheduledSendRef.current);
      }
      scheduledSendRef.current = window.setTimeout(() => {
        scheduledSendRef.current = null;
        try {
          sendCurrentMessage(sendMessage, text);
        } catch (sendError) {
          setPendingTurn(null);
          setActiveTurnStartedAt(null);
          setError(sendError instanceof Error ? sendError.message : "Something went wrong.");
        }
      }, 0);
    },
    [sendMessage],
  );

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
      const delta = time - last;
      if (delta >= 0) frames.push(delta);
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
    const startedAt = activeTurnStartedAt ?? pendingTurn?.startedAt ?? null;
    if (!startedAt || (!isStreaming && !pendingTurn)) {
      setPendingElapsed(0);
      return;
    }
    const update = () => {
      setPendingElapsed((performance.now() - startedAt) / 1000);
    };
    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [activeTurnStartedAt, isStreaming, pendingTurn]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream || !hasConversation || !stickToLatestRef.current) return;

    if (scrollRafRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }

    const scrollToLatest = () => {
      scrollRafRef.current = null;
      const behavior: ScrollBehavior = isStreaming ? "auto" : "smooth";
      if (typeof stream.scrollTo === "function") {
        stream.scrollTo({ top: stream.scrollHeight, behavior });
        return;
      }
      endRef.current?.scrollIntoView?.({ block: "end", behavior });
    };

    if (typeof requestAnimationFrame === "function") {
      scrollRafRef.current = requestAnimationFrame(scrollToLatest);
      return;
    }

    scrollToLatest();
  }, [
    hasConversation,
    isStreaming,
    lastAssistantStreaming,
    lastAssistantTextLength,
    messages.length,
    showAssistantActivity,
    showPendingUser,
  ]);

  useEffect(() => {
    return () => {
      if (scheduledSendRef.current !== null) window.clearTimeout(scheduledSendRef.current);
      if (scrollRafRef.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (pendingUserAlreadyRendered) {
      setPendingTurn(null);
    }
  }, [pendingUserAlreadyRendered]);

  useEffect(() => {
    if (status === "ready" || status === "error") {
      setActiveTurnStartedAt(null);
    }
  }, [status]);

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
            fileType: string | null;
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
              fileType: a.fileType ?? getFileExtension(a.filename ?? ""),
              status:
                mapAttachmentStatus(a.status),
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
            if (serverStatus === "failed") {
              return {
                ...chip,
                status: "indexing-failed",
                message: "attached, readable here",
              };
            }
            return chip;
          }),
        );
      } catch {
        // Ignore. The next tick tries again.
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
      if (!trimmed || isBusy || hasUploadingAttachments) return;
      setError(null);
      const startedAt = performance.now();
      stickToLatestRef.current = true;
      setActiveTurnStartedAt(startedAt);
      setPendingTurn({ text: trimmed, startedAt });
      setDraft("");
      dispatchCurrentMessage(trimmed);
    },
    [dispatchCurrentMessage, draft, hasUploadingAttachments, isBusy],
  );

  const handleSendFollowUp = useCallback(
    (text: string) => {
      if (isBusy || hasUploadingAttachments) return;
      const startedAt = performance.now();
      stickToLatestRef.current = true;
      setActiveTurnStartedAt(startedAt);
      setPendingTurn({ text, startedAt });
      dispatchCurrentMessage(text);
    },
    [dispatchCurrentMessage, hasUploadingAttachments, isBusy],
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

  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter") return;
      const nativeEvent = event.nativeEvent;
      if (
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229 ||
        nativeEvent.which === 229
      ) {
        return;
      }
      if (event.shiftKey && !event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      handleSubmit();
    },
    [handleSubmit],
  );

  const handleStop = useCallback(() => {
    if (scheduledSendRef.current !== null) {
      window.clearTimeout(scheduledSendRef.current);
      scheduledSendRef.current = null;
    }
    setPendingTurn(null);
    setActiveTurnStartedAt(null);
    stop();
  }, [stop]);

  const handleRegenerate = useCallback(() => {
    setError(null);
    stickToLatestRef.current = true;
    regenerate();
  }, [regenerate]);

  const handleStreamScroll = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const distanceFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    stickToLatestRef.current = distanceFromBottom < 96;
  }, []);

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
  const [drawerDraftBrief, setDrawerDraftBrief] = useState<WorkspaceGenerationDraftBrief | null>(null);
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
      setDrawerDraftBrief(null);
      setDrawerOpen(true);
      return "drawer-opened";
    },
    [],
  );

  const openDraftBriefDrawer = useCallback(
    async ({
      messageId,
      draftBrief,
      sourceText,
    }: {
      messageId: string;
      draftBrief: BriefDraftCardOutput;
      sourceText: string;
    }): Promise<string | null> => {
      setDrawerMessageId(messageId || null);
      setDrawerDraftBrief({
        brief: draftBrief.brief,
        include_research: draftBrief.include_research,
        sourceText,
      });
      setDrawerOpen(true);
      return "drawer-opened";
    },
    [],
  );

  const closeGenerationDrawer = useCallback(() => {
    setDrawerOpen(false);
    setDrawerMessageId(null);
    setDrawerDraftBrief(null);
  }, []);

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
                  ? `Ask about ${scopeName}. I will use this scope's saved context.`
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
                    ? `Uses saved context, uploads, and prior answers for ${scopeName}. Every claim cites its source.`
                    : copy.workspaceEmptyBody)}
              </p>
            </>
          )}
        </div>
      ) : (
        <div
          ref={streamRef}
          className="wbeta-ai-chat-stream"
          role="log"
          aria-live="polite"
          aria-busy={isBusy}
          onScroll={handleStreamScroll}
        >
          {messages.map((message, i) => {
            const isLast = i === messages.length - 1;
            if (activityOwnsLastAssistantSlot && isLast) {
              return (
                <AssistantActivity
                  key={message.id ?? i}
                  activityCopy={activityCopy}
                  pendingElapsed={pendingElapsed}
                />
              );
            }
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
                onOpenGenerateDrawer={
                  message.role === "assistant" && !isStreaming ? openDraftBriefDrawer : undefined
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
          {showAssistantActivity && !activityOwnsLastAssistantSlot ? (
            <AssistantActivity
              activityCopy={activityCopy}
              pendingElapsed={pendingElapsed}
            />
          ) : null}
          <div ref={endRef} />
        </div>
      )}

      {error ? (
        <p className="wbeta-ai-chat-error">
          {error}.{" "}
          <button
            type="button"
            className="wbeta-ai-chat-error-retry"
            onClick={() => setError(null)}
            data-help="Hide this message. It does not delete the conversation."
          >
            Hide message
          </button>
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
        accept={CHAT_UPLOAD_ACCEPT}
        aria-hidden
      />

      {attachments.length > 0 ? (
        <ul className="wbeta-ai-chat-attachments" role="list" aria-label="Files attached to this conversation">
          {attachments.map((chip) => (
            <li key={chip.localId} className={`wbeta-ai-chat-chip wbeta-ai-chat-chip-${chip.status}`}>
              {chip.documentId && isImageAttachment(chip) ? (
                <button
                  type="button"
                  className="wbeta-ai-chat-chip-preview"
                  onClick={() => setPreviewAttachment(chip)}
                  aria-label={`Preview ${chip.filename}`}
                  data-help="Open a quick preview without leaving the chat."
                >
                  <img
                    src={getDocumentDownloadUrl(chip.documentId, conversationIdRef.current)}
                    alt=""
                    loading="lazy"
                  />
                </button>
              ) : null}
              <span className="wbeta-ai-chat-chip-icon" aria-hidden>
                {chip.status === "uploading" || chip.status === "indexing" ? (
                  <Paperclip size={14} weight="thin" className="wbeta-ai-chat-chip-icon-pulse" />
                ) : chip.status === "upload-failed" ? (
                  <WarningCircle size={14} weight="fill" />
                ) : (
                  <CheckCircle size={14} weight="fill" />
                )}
              </span>
              <span className="wbeta-ai-chat-chip-body">
                {chip.documentId ? (
                  <button
                    type="button"
                    className="wbeta-ai-chat-chip-name wbeta-ai-chat-chip-name-button"
                    title={chip.filename}
                    onClick={() => setPreviewAttachment(chip)}
                    aria-label={`Open preview details for ${chip.filename}`}
                    data-help="Open preview and download options."
                  >
                    {chip.filename}
                  </button>
                ) : (
                  <span className="wbeta-ai-chat-chip-name" title={chip.filename}>
                    {chip.filename}
                  </span>
                )}
                <span className="wbeta-ai-chat-chip-meta">
                  {formatBytes(chip.sizeBytes)}
                  {" · "}
                  {attachmentStatusLabel(chip)}
                </span>
              </span>
              <AttachmentChipInfo
                label={`Status details for ${chip.filename}`}
                text={attachmentStatusHelp(chip)}
              />
              <button
                type="button"
                className="wbeta-ai-chat-chip-remove"
                onClick={() => removeAttachment(chip.localId)}
                aria-label={`Remove ${chip.filename} from this chat`}
                data-help="Remove this file from the current chat."
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
              disabled={isBusy || hasUploadingAttachments}
              title={suggestion.prompt}
              data-help="Runs this suggested prompt in the current workspace."
            >
              {compactSuggestionPrompt(suggestion.prompt)}
            </button>
          ))}
        </div>
      ) : null}

      <form ref={composerRef} className="wbeta-ai-chat-form" onSubmit={handleSubmit}>
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
          onKeyDown={handleComposerKeyDown}
          onPaste={handlePaste}
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
            data-help="Attach files to this chat. Basquio stores them first, then reads them from the conversation."
          >
            <Paperclip size={14} weight="regular" />
          </button>
          <p className="wbeta-ai-chat-hint" aria-live="polite">
            {hasUploadingAttachments ? (
              "Uploading file..."
            ) : isBusy ? (
              copy.generating
            ) : (
              <kbd className="wbeta-kbd">↵</kbd>
            )}
          </p>
          {isBusy ? (
            <button
              type="button"
              className="wbeta-ai-chat-stop"
              onClick={handleStop}
              aria-label={copy.stopGeneration}
              data-help="Stop the current answer. The conversation and attached files stay here."
            >
              <Stop size={13} weight="fill" />
              <span className="wbeta-ai-chat-stop-label">{copy.stop}</span>
            </button>
          ) : (
            <button
              type="submit"
              className="wbeta-ai-chat-send"
              disabled={!draft.trim() || hasUploadingAttachments}
              aria-label={copy.sendMessage}
              data-help={hasUploadingAttachments ? "Wait for the upload to finish before sending." : "Send this message. Attached files stay in storage and are read from this chat."}
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
        onClose={closeGenerationDrawer}
        conversationId={conversationIdRef.current}
        messageId={drawerMessageId}
        scopeId={scopeId ?? null}
        draftBrief={drawerDraftBrief}
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

      {previewAttachment?.documentId ? (
        <AttachmentPreviewDrawer
          attachment={previewAttachment}
          conversationId={conversationIdRef.current}
          onClose={() => setPreviewAttachment(null)}
        />
      ) : null}
    </section>
  );
}

function getActivityCopy({
  hasPendingTurn,
  lastMessage,
}: {
  hasPendingTurn: boolean;
  lastMessage?: UIMessage;
}): string {
  const activeTool = activeToolName(lastMessage);
  if (activeTool) return `Using ${activeTool}`;
  if (!hasPendingTurn && lastMessage?.role === "assistant" && messageText(lastMessage).trim().length > 0) {
    return "Writing answer";
  }
  return "Thinking...";
}

function AssistantActivity({
  activityCopy,
  pendingElapsed,
}: {
  activityCopy: string;
  pendingElapsed: number;
}) {
  return (
    <div className="wbeta-ai-msg wbeta-ai-msg-asst wbeta-ai-msg-pending-asst" role="status" aria-live="polite">
      <div className="wbeta-ai-thinking">
        <span className="wbeta-ai-thinking-pulse" aria-hidden>
          <span>•</span>
          <span>•</span>
          <span>•</span>
        </span>
        <span className="wbeta-ai-thinking-copy">{activityCopy}</span>
        <span className="wbeta-ai-thinking-time" aria-hidden>
          {pendingElapsed.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}

function AttachmentChipInfo({ label, text }: { label: string; text: string }) {
  const tooltipId = useId();
  return (
    <span className="wbeta-ai-chat-chip-info">
      <button
        type="button"
        className="wbeta-ai-chat-chip-info-trigger"
        aria-label={label}
        aria-describedby={tooltipId}
      >
        <Info size={12} weight="bold" />
      </button>
      <span id={tooltipId} className="wbeta-ai-chat-chip-info-tip" role="tooltip">
        {text}
      </span>
    </span>
  );
}

function attachmentStatusLabel(chip: AttachmentChip): string {
  if (chip.message) return chip.message;
  switch (chip.status) {
    case "uploading":
      return "uploading";
    case "indexing":
      return "attached, preparing search";
    case "indexed":
      return "attached, searchable";
    case "indexing-failed":
      return "attached, readable here";
    case "upload-failed":
      return "upload failed";
    default:
      return "attached";
  }
}

function attachmentStatusHelp(chip: AttachmentChip): string {
  switch (chip.status) {
    case "uploading":
      return "Uploading to your private workspace. You can send once the upload finishes.";
    case "indexing":
      return "The file is attached to this chat. Basquio is preparing it for broader workspace search.";
    case "indexed":
      return "Basquio can read this file in chat and find it later in workspace search.";
    case "indexing-failed":
      return "Basquio can still read the original file in this chat. It is not yet available for broader workspace search.";
    case "upload-failed":
      return chip.documentId
        ? "The file reached your workspace, but it was not attached to this chat. Add it again if you need this answer to use it."
        : "The file did not finish uploading. Check the file size or try again.";
    default:
      return "This file is attached to the conversation.";
  }
}

function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n\n");
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function mapAttachmentStatus(status: string | null | undefined): AttachmentChip["status"] {
  if (status === "indexed") return "indexed";
  if (status === "failed") return "indexing-failed";
  return "indexing";
}

function getClipboardFiles(data: DataTransfer): File[] {
  const fromItems = Array.from(data.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item, index) => normalizeClipboardFile(item.getAsFile(), index))
    .filter((file): file is File => file !== null);

  if (fromItems.length > 0) return fromItems;
  return Array.from(data.files ?? []).map((file, index) => normalizeClipboardFile(file, index) ?? file);
}

function normalizeClipboardFile(file: File | null, index: number): File | null {
  if (!file) return null;
  const extension = getFileExtension(file.name) || getExtensionFromMimeType(file.type);
  const shouldRenameImage =
    file.type.startsWith("image/") &&
    (!file.name || /^image\.(png|jpe?g|webp|gif)$/i.test(file.name));
  if (!shouldRenameImage) return file;
  const name = `screenshot-${formatTimestampForFilename(new Date())}${index > 0 ? `-${index + 1}` : ""}.${extension || "png"}`;
  return new File([file], name, {
    type: file.type || getMimeTypeFromExtension(extension),
    lastModified: file.lastModified || Date.now(),
  });
}

function formatTimestampForFilename(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
}

function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function getExtensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/plain") return "txt";
  if (mimeType === "text/markdown") return "md";
  if (mimeType === "text/csv") return "csv";
  return "";
}

function getMimeTypeFromExtension(extension: string): string {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "application/octet-stream";
}

function isImageAttachment(chip: AttachmentChip): boolean {
  const extension = chip.fileType || getFileExtension(chip.filename);
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(extension.toLowerCase());
}

function getDocumentDownloadUrl(documentId: string, conversationId: string): string {
  return `/api/workspace/documents/${documentId}/download?conversationId=${encodeURIComponent(conversationId)}`;
}

function getDocumentPreviewUrl(documentId: string, conversationId: string): string {
  return `/api/workspace/documents/${documentId}/preview?conversationId=${encodeURIComponent(conversationId)}`;
}

function activeToolName(message?: UIMessage): string | null {
  if (!message || message.role !== "assistant") return null;
  const toolPart = [...(message.parts ?? [])]
    .reverse()
    .find((part) => part.type?.startsWith("tool-")) as
    | { type?: string; state?: string; output?: unknown }
    | undefined;
  if (!toolPart?.type) return null;
  const done = toolPart.state === "output-available" || toolPart.output !== undefined;
  if (done) return null;
  return toolPart.type.slice(5);
}

function sendCurrentMessage(
  sendMessage: (message: { text: string }) => unknown,
  text: string,
) {
  sendMessage({ text });
}

type AttachmentPreviewData =
  | { kind: "text"; text: string }
  | { kind: "spreadsheet"; sheets: Array<{ name: string; rows: string[][] }> }
  | { kind: "unsupported"; message: string };

function AttachmentPreviewDrawer({
  attachment,
  conversationId,
  onClose,
}: {
  attachment: AttachmentChip;
  conversationId: string;
  onClose: () => void;
}) {
  const documentId = attachment.documentId as string;
  const downloadUrl = getDocumentDownloadUrl(documentId, conversationId);
  const previewUrl = getDocumentPreviewUrl(documentId, conversationId);
  const kind = getAttachmentPreviewKind(attachment);
  const [preview, setPreview] = useState<AttachmentPreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (kind !== "text" && kind !== "spreadsheet" && kind !== "document") {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    fetch(previewUrl)
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as AttachmentPreviewData & {
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "Preview not available.");
        return data;
      })
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setPreviewError(error instanceof Error ? error.message : "Preview not available.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, previewUrl]);

  return (
    <div className="wbeta-ai-chat-preview-layer" role="presentation">
      <button
        type="button"
        className="wbeta-ai-chat-preview-scrim"
        onClick={onClose}
        aria-label={`Close preview for ${attachment.filename}`}
      />
      <aside
        className="wbeta-ai-chat-preview-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={attachment.filename}
      >
        <div className="wbeta-ai-chat-preview-bar">
          <div>
            <p>{attachment.filename}</p>
            <span>{formatBytes(attachment.sizeBytes)}</span>
          </div>
          <div className="wbeta-ai-chat-preview-actions">
            <a
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Download ${attachment.filename}`}
              data-help="Download or open the original file."
            >
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close preview for ${attachment.filename}`}
              data-help="Close preview and return to chat."
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        </div>
        <div className="wbeta-ai-chat-preview-body">
          {kind === "image" ? (
            <img src={downloadUrl} alt={attachment.filename} />
          ) : kind === "pdf" ? (
            <iframe src={downloadUrl} title={attachment.filename} />
          ) : kind === "text" || kind === "document" ? (
            <TextPreview preview={preview} error={previewError} />
          ) : kind === "spreadsheet" ? (
            <SpreadsheetPreview preview={preview} error={previewError} />
          ) : (
            <div className="wbeta-ai-chat-preview-empty">
              <p>Preview is not available for this file type. Download the original to inspect it.</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function TextPreview({
  preview,
  error,
}: {
  preview: AttachmentPreviewData | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="wbeta-ai-chat-preview-empty">
        <p>{error}</p>
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="wbeta-ai-chat-preview-empty">
        <p>Loading preview...</p>
      </div>
    );
  }
  if (preview.kind !== "text") {
    return (
      <div className="wbeta-ai-chat-preview-empty">
        <p>Preview is not available for this file type. Download the original to inspect it.</p>
      </div>
    );
  }
  return <pre className="wbeta-ai-chat-preview-text">{preview.text}</pre>;
}

function SpreadsheetPreview({
  preview,
  error,
}: {
  preview: AttachmentPreviewData | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="wbeta-ai-chat-preview-empty">
        <p>{error}</p>
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="wbeta-ai-chat-preview-empty">
        <p>Loading preview...</p>
      </div>
    );
  }
  if (preview.kind !== "spreadsheet" || preview.sheets.length === 0) {
    return (
      <div className="wbeta-ai-chat-preview-empty">
        <p>Preview is not available for this file type. Download the original to inspect it.</p>
      </div>
    );
  }
  const sheet = preview.sheets[0];
  return (
    <div className="wbeta-ai-chat-preview-sheet">
      <p>{sheet.name}</p>
      <div className="wbeta-ai-chat-preview-table-wrap">
        <table>
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getAttachmentPreviewKind(
  attachment: AttachmentChip,
): "image" | "pdf" | "text" | "spreadsheet" | "document" | "unsupported" {
  const extension = (attachment.fileType || getFileExtension(attachment.filename)).toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (["txt", "md", "gsp", "json", "yaml", "yml", "csv"].includes(extension)) return "text";
  if (["xlsx", "xls"].includes(extension)) return "spreadsheet";
  if (extension === "docx") return "document";
  return "unsupported";
}
