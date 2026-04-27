import { anthropic } from "@ai-sdk/anthropic";
import { NextResponse } from "next/server";
import {
  convertToModelMessages,
  smoothStream,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import {
  buildChatSystemBlocks,
  isChatRouterV2Enabled,
  resolveChatModel,
  STATIC_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  type ChatModelMode,
} from "@/lib/workspace/agent";
import { getAllTools } from "@/lib/workspace/agent-tools";
import { getTypedRetrievalTools } from "@/lib/workspace/agent-tools-typed";
import {
  buildScopeContextPack,
  buildWorkspaceBrandPack,
} from "@/lib/workspace/build-context-pack";
import {
  activeToolsForIntents,
  classifyTurn,
  type TurnIntent,
} from "@/lib/workspace/router";
import { getScope } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";
import { saveConversation } from "@/lib/workspace/conversations";
import { consume } from "@/lib/workspace/rate-limit";
import { stripFollowUpSuggestionsFromMessages } from "@/lib/workspace/chat-followup-suggestions";
import {
  CHAT_STREAM_CHARACTER_DELAY_MS,
  firstVisibleCharacter,
} from "@/lib/workspace/chat-streaming";
import {
  estimateChatTurnCostUsd,
  recordChatTurnTelemetry,
} from "@/lib/workspace/chat-tool-telemetry";

export const runtime = "nodejs";
export const maxDuration = 300;

const RATE_LIMIT = { limit: 12, windowMs: 60_000 };

type ChatRequestBody = {
  id?: string;
  messages?: UIMessage[];
  mode?: ChatModelMode | null;
  scope_id?: string | null;
  title?: string;
};

export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  const decision = consume({
    key: `chat:${viewer.user.id}`,
    limit: RATE_LIMIT.limit,
    windowMs: RATE_LIMIT.windowMs,
  });
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: `Slow down. ${RATE_LIMIT.limit} prompts per minute. Try again in ${decision.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const uiMessages: UIMessage[] = body.messages ?? [];
  const conversationId =
    body.id ??
    (globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  if (!Array.isArray(uiMessages) || uiMessages.length === 0) {
    return NextResponse.json({ error: "Send at least one message." }, { status: 400 });
  }

  const workspace = await getCurrentWorkspace();
  const scope = body.scope_id ? await getScope(body.scope_id) : null;
  if (body.scope_id && (!scope || scope.workspace_id !== workspace.id)) {
    return NextResponse.json({ error: "Scope not found in this workspace." }, { status: 404 });
  }

  const ctx = {
    workspaceId: workspace.id,
    currentScopeId: scope?.id ?? null,
    conversationId: conversationId ?? null,
    userEmail: viewer.user.email ?? "unknown",
    userId: viewer.user.id,
  };

  const firstUserPrompt = extractFirstUserText(uiMessages);
  const title = body.title ?? (firstUserPrompt ? firstUserPrompt.slice(0, 120) : null);
  const chatMode: ChatModelMode = body.mode === "deep" ? "deep" : "standard";
  const modelId = resolveChatModel(chatMode);
  const routerEnabled = isChatRouterV2Enabled();

  const allTools = {
    ...getAllTools(ctx),
    ...getTypedRetrievalTools(ctx),
  };

  const modelMessages = await convertToModelMessages(uiMessages);
  const turnStartedAt = new Date();

  // ──────────────────────────────────────────────────────────
  // Pre-Brief-2 path (CHAT_ROUTER_V2_ENABLED=false, default in production).
  // ──────────────────────────────────────────────────────────
  if (!routerEnabled) {
    const result = streamText({
      model: anthropic(modelId),
      system: SYSTEM_PROMPT,
      tools: allTools,
      messages: modelMessages,
      stopWhen: stepCountIs(10),
      experimental_transform: smoothStream({
        delayInMs: CHAT_STREAM_CHARACTER_DELAY_MS,
        chunking: firstVisibleCharacter,
      }),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: uiMessages,
      sendReasoning: true,
      sendSources: true,
      messageMetadata: ({ part }) => {
        if (part.type === "finish") {
          return {
            finishReason: part.finishReason,
            totalUsage: part.totalUsage,
            completedAt: new Date().toISOString(),
          };
        }
        if (part.type === "start-step") {
          return { startedAt: new Date().toISOString() };
        }
        return undefined;
      },
      async onFinish({ messages: finalMessages }) {
        try {
          const parsed = stripFollowUpSuggestionsFromMessages(finalMessages);
          await saveConversation({
            id: conversationId,
            workspaceId: workspace.id,
            scopeId: scope?.id ?? null,
            createdBy: viewer.user!.id,
            title,
            messages: parsed.messages,
            metadata: {
              user_email: viewer.user!.email ?? null,
              scope_name: scope?.name ?? null,
              scope_kind: scope?.kind ?? null,
              chat_mode_last: chatMode,
              last_suggestions: parsed.suggestions,
            },
          });
        } catch (error) {
          console.error("[workspace/chat] failed to persist conversation", error);
        }
      },
    });
  }

  // ──────────────────────────────────────────────────────────
  // Brief 2 path (CHAT_ROUTER_V2_ENABLED=true). Three-tier prompt cache,
  // Haiku intent classifier on step 0, intent-gated typed tools, per-turn
  // aggregate telemetry. Spec §5, §6.
  // ──────────────────────────────────────────────────────────
  const [workspaceBrandPack, scopeContextPack] = await Promise.all([
    buildWorkspaceBrandPack(workspace.id).catch((err) => {
      console.error("[workspace/chat] workspace brand pack build failed", err);
      return "# Workspace brand pack\n\n(unavailable for this turn)";
    }),
    buildScopeContextPack(workspace.id, scope?.id ?? null).catch((err) => {
      console.error("[workspace/chat] scope context pack build failed", err);
      return "# Scope context\n\n(unavailable for this turn)";
    }),
  ]);

  const systemBlocks = buildChatSystemBlocks({
    staticSystemPrompt: STATIC_SYSTEM_PROMPT,
    workspaceBrandPack,
    scopeContextPack,
  });

  const lastUserText = extractLastUserText(uiMessages);
  const recentTurns = summariseRecentTurns(uiMessages);

  // Run the classifier eagerly (before the first prepareStep call) so we have
  // its output to log even if the LLM stream finishes without ever invoking
  // step 0's prepareStep callback.
  let intent: TurnIntent | null = null;
  try {
    if (lastUserText.trim().length > 0) {
      intent = await classifyTurn({
        userMessage: lastUserText,
        recentTurns,
        workspaceContext: scope?.name ? `Scope: ${scope.name} (${scope.kind})` : "",
      });
    }
  } catch (err) {
    console.error("[workspace/chat] classifier failed; falling back to all tools", err);
  }

  const activeToolNames = intent
    ? activeToolsForIntents(intent, { includeFallback: true })
    : Object.keys(allTools);

  const result = streamText({
    model: anthropic(modelId),
    system: systemBlocks,
    tools: allTools,
    messages: modelMessages,
    stopWhen: stepCountIs(12),
    activeTools: activeToolNames as Array<keyof typeof allTools>,
    experimental_transform: smoothStream({
      delayInMs: CHAT_STREAM_CHARACTER_DELAY_MS,
      chunking: firstVisibleCharacter,
    }),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: uiMessages,
    sendReasoning: true,
    sendSources: true,
    messageMetadata: ({ part }) => {
      if (part.type === "finish") {
        return {
          finishReason: part.finishReason,
          totalUsage: part.totalUsage,
          completedAt: new Date().toISOString(),
        };
      }
      if (part.type === "start-step") {
        return { startedAt: new Date().toISOString() };
      }
      return undefined;
    },
    async onFinish({ messages: finalMessages }) {
      try {
        const parsed = stripFollowUpSuggestionsFromMessages(finalMessages);
        await saveConversation({
          id: conversationId,
          workspaceId: workspace.id,
          scopeId: scope?.id ?? null,
          createdBy: viewer.user!.id,
          title,
          messages: parsed.messages,
          metadata: {
            user_email: viewer.user!.email ?? null,
            scope_name: scope?.name ?? null,
            scope_kind: scope?.kind ?? null,
            chat_mode_last: chatMode,
            last_suggestions: parsed.suggestions,
            chat_router_v2: true,
          },
        });
      } catch (error) {
        console.error("[workspace/chat] failed to persist conversation", error);
      }

      try {
        const usage = await Promise.resolve(result.usage).catch(() => null);
        const cacheCreation = readNumericUsage(
          usage,
          "cacheCreationInputTokens",
          "cache_creation_input_tokens",
        );
        const cacheRead = readNumericUsage(
          usage,
          "cacheReadInputTokens",
          "cache_read_input_tokens",
        );
        const inputTokens = readNumericUsage(usage, "inputTokens", "input_tokens");
        const outputTokens = readNumericUsage(usage, "outputTokens", "output_tokens");
        const costUsd =
          inputTokens != null || outputTokens != null
            ? estimateChatTurnCostUsd({
                cacheCreationInputTokens: cacheCreation ?? 0,
                cacheReadInputTokens: cacheRead ?? 0,
                inputTokens: inputTokens ?? 0,
                outputTokens: outputTokens ?? 0,
                staticBlockTokens: 10_000,
              })
            : null;
        await recordChatTurnTelemetry({
          conversationId,
          userId: viewer.user!.id,
          startedAt: turnStartedAt,
          cacheCreationInputTokens: cacheCreation,
          cacheReadInputTokens: cacheRead,
          totalInputTokens: inputTokens,
          totalOutputTokens: outputTokens,
          costUsd,
          intents: intent?.intents ?? null,
          activeTools: activeToolNames,
          classifierEntities: intent?.entities ?? null,
          classifierAsOf: intent?.as_of ?? null,
          classifierNeedsWeb: intent?.needs_web ?? null,
          errorMessage: null,
        });
      } catch (error) {
        console.error("[workspace/chat] failed to record turn telemetry", error);
      }
    },
  });
}

function extractFirstUserText(messages: UIMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "";
  const parts = firstUser.parts ?? [];
  const texts = parts
    .filter(
      (p): p is Extract<(typeof parts)[number], { type: "text" }> =>
        (p as { type?: string }).type === "text",
    )
    .map((p) => (p as { text?: string }).text ?? "");
  return texts.join("\n").trim();
}

function extractLastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      const parts = messages[i].parts ?? [];
      const texts = parts
        .filter(
          (p): p is Extract<(typeof parts)[number], { type: "text" }> =>
            (p as { type?: string }).type === "text",
        )
        .map((p) => (p as { text?: string }).text ?? "");
      return texts.join("\n").trim();
    }
  }
  return "";
}

function summariseRecentTurns(messages: UIMessage[]): string {
  const tail = messages.slice(-5, -1);
  if (tail.length === 0) return "";
  return tail
    .map((m) => {
      const parts = m.parts ?? [];
      const text = parts
        .filter(
          (p): p is Extract<(typeof parts)[number], { type: "text" }> =>
            (p as { type?: string }).type === "text",
        )
        .map((p) => (p as { text?: string }).text ?? "")
        .join(" ")
        .slice(0, 240);
      return `${m.role}: ${text}`;
    })
    .join("\n");
}

function readNumericUsage(
  usage: unknown,
  ...keys: string[]
): number | null {
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}
