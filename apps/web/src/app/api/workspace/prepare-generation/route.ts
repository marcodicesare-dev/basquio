import { NextResponse } from "next/server";
import type { UIMessage } from "ai";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import {
  buildWorkspaceContextPack,
  type WorkspaceContextPack,
} from "@/lib/workspace/build-context-pack";
import {
  synthesizeBrief,
  type ConversationTurn,
  type SynthesizedBrief,
} from "@/lib/workspace/synthesize-brief";
import { getConversation } from "@/lib/workspace/conversations";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const bodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  messageId: z.string().nullable().optional(),
  // If the drawer is launched from an existing deliverable (e.g. a saved memo),
  // we can use its body/citations as additional context.
  deliverableId: z.string().uuid().nullable().optional(),
  scopeId: z.string().uuid().nullable().optional(),
});

export type PrepareGenerationResponse = {
  pack: WorkspaceContextPack;
  brief: SynthesizedBrief;
};

function extractTurns(messages: UIMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const parts = (message.parts ?? []) as Array<{ type?: string; text?: string }>;
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n")
      .trim();
    if (!text) continue;
    turns.push({ role: message.role as "user" | "assistant", text });
  }
  return turns;
}

function extractCitations(messages: UIMessage[]) {
  const citations: Array<{
    source_type?: string;
    source_id?: string;
    filename?: string | null;
  }> = [];
  for (const message of messages) {
    for (const rawPart of message.parts ?? []) {
      const part = rawPart as { type?: string; output?: unknown };
      if (!part.type?.startsWith("tool-")) continue;
      const toolName = part.type.slice(5);
      if (toolName !== "retrieveContext") continue;
      const output = part.output as
        | { chunks?: Array<{ source_type?: string; source_id?: string; filename?: string | null }> }
        | undefined;
      for (const c of output?.chunks ?? []) {
        if (c.source_id) {
          citations.push({
            source_type: c.source_type,
            source_id: c.source_id,
            filename: c.filename ?? null,
          });
        }
      }
    }
  }
  return citations;
}

export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid body." },
      { status: 400 },
    );
  }

  const workspace = await getCurrentWorkspace();

  // Load the conversation (if one is provided) to extract turns + citations.
  let turns: ConversationTurn[] = [];
  let citations: Array<{ source_type?: string; source_id?: string; filename?: string | null }> = [];
  let scopeId: string | null = payload.scopeId ?? null;
  let prompt: string | null = null;
  let deliverableTitle: string | null = null;

  if (payload.conversationId) {
    const convo = await getConversation(payload.conversationId);
    if (!convo || convo.workspace_id !== workspace.id) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }
    const messages = Array.isArray(convo.messages) ? (convo.messages as UIMessage[]) : [];
    turns = extractTurns(messages);
    citations = extractCitations(messages);
    if (!scopeId) scopeId = convo.workspace_scope_id ?? null;
    const firstUser = turns.find((t) => t.role === "user");
    if (firstUser) prompt = firstUser.text.slice(0, 1200);
  }

  // If launched from a deliverable, pull its title + body + citations for
  // additional context without the conversation.
  if (payload.deliverableId) {
    const { createServiceSupabaseClient } = await import("@/lib/supabase/admin");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const db = createServiceSupabaseClient(url, key);
      const { data } = await db
        .from("workspace_deliverables")
        .select("title, body_markdown, prompt, workspace_scope_id, citations")
        .eq("id", payload.deliverableId)
        .maybeSingle();
      if (data) {
        deliverableTitle = data.title as string | null;
        if (!scopeId && data.workspace_scope_id) scopeId = data.workspace_scope_id as string;
        if (!prompt && data.prompt) prompt = data.prompt as string;
        if (turns.length === 0 && data.body_markdown) {
          turns.push({ role: "assistant", text: data.body_markdown as string });
        }
        const delivCitations = Array.isArray(data.citations)
          ? (data.citations as Array<{ source_type?: string; source_id?: string; filename?: string | null }>)
          : [];
        for (const c of delivCitations) {
          if (c.source_id) {
            citations.push({
              source_type: c.source_type,
              source_id: c.source_id,
              filename: c.filename ?? null,
            });
          }
        }
      }
    }
  }

  const pack = await buildWorkspaceContextPack({
    viewer,
    workspaceId: workspace.id,
    conversationId: payload.conversationId ?? null,
    deliverableId: payload.deliverableId ?? null,
    messageId: payload.messageId ?? null,
    scopeId,
    citations,
    prompt,
    deliverableTitle,
    launchSource: payload.conversationId ? "workspace-chat" : "workspace-deliverable",
  });

  if (!pack) {
    return NextResponse.json(
      { error: "Workspace setup incomplete. Try refreshing." },
      { status: 500 },
    );
  }

  const brief = await synthesizeBrief({ pack, turns });

  return NextResponse.json({ pack, brief } satisfies PrepareGenerationResponse);
}
