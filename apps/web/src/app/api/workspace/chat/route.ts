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
import { resolveChatModel, SYSTEM_PROMPT, type ChatModelMode } from "@/lib/workspace/agent";
import { getAllTools } from "@/lib/workspace/agent-tools";
import { getScope } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";
import { saveConversation } from "@/lib/workspace/conversations";
import { consume } from "@/lib/workspace/rate-limit";
import { stripFollowUpSuggestionsFromMessages } from "@/lib/workspace/chat-followup-suggestions";
import { CHAT_STREAM_CHARACTER_DELAY_MS, firstVisibleCharacter } from "@/lib/workspace/chat-streaming";

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

  const tools = getAllTools(ctx);
  const firstUserPrompt = extractFirstUserText(uiMessages);
  const title = body.title ?? (firstUserPrompt ? firstUserPrompt.slice(0, 120) : null);
  const chatMode: ChatModelMode = body.mode === "deep" ? "deep" : "standard";

  const result = streamText({
    model: anthropic(resolveChatModel(chatMode)),
    system: SYSTEM_PROMPT,
    tools,
    messages: await convertToModelMessages(uiMessages),
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
