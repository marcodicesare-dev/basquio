import { anthropic } from "@ai-sdk/anthropic";
import { NextResponse } from "next/server";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { BASQUIO_MODEL_ID, SYSTEM_PROMPT } from "@/lib/workspace/agent";
import { getAllTools } from "@/lib/workspace/agent-tools";
import { getScope } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";
import { saveConversation } from "@/lib/workspace/conversations";
import { consume } from "@/lib/workspace/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

const RATE_LIMIT = { limit: 12, windowMs: 60_000 };

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

  let body: { id?: string; messages?: UIMessage[]; scope_id?: string | null; title?: string };
  try {
    body = (await request.json()) as typeof body;
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
    userEmail: viewer.user.email ?? "unknown",
    userId: viewer.user.id,
  };

  const tools = getAllTools(ctx);
  const firstUserPrompt = extractFirstUserText(uiMessages);
  const title = body.title ?? (firstUserPrompt ? firstUserPrompt.slice(0, 120) : null);

  const result = streamText({
    model: anthropic(BASQUIO_MODEL_ID),
    system: SYSTEM_PROMPT,
    tools,
    messages: await convertToModelMessages(uiMessages),
    stopWhen: stepCountIs(10),
    providerOptions: {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: 4000 },
      },
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: uiMessages,
    async onFinish({ messages: finalMessages }) {
      try {
        await saveConversation({
          id: conversationId,
          workspaceId: workspace.id,
          scopeId: scope?.id ?? null,
          createdBy: viewer.user!.id,
          title,
          messages: finalMessages,
          metadata: {
            user_email: viewer.user!.email ?? null,
            scope_name: scope?.name ?? null,
            scope_kind: scope?.kind ?? null,
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
