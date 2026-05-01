import { after, NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";
import { getScope } from "@/lib/workspace/scopes";
import {
  createQuickSlideRun,
  isQuickSlideRateLimited,
  type QuickSlideBrief,
} from "@/lib/workspace/quick-slide";
import { runQuickSlidePipeline } from "@/lib/workspace/quick-slide-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300s gives the after() hook room for the 90s pipeline plus storage upload.
export const maxDuration = 300;

const PostBody = z.object({
  topic: z.string().min(8).max(400),
  audience: z.string().max(200).optional(),
  data_focus: z.string().max(400).optional(),
  language: z.enum(["it", "en"]).default("it"),
  extra_instructions: z.string().max(1000).optional(),
  scope_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  evidence_doc_ids: z.array(z.string().uuid()).max(4).default([]),
});

/**
 * User-triggered quick-slide creation. The agent tool path uses
 * /dispatch instead so it can hand off to a separate function lifecycle.
 * This endpoint is what a future "quick slide from URL bar" UI would call.
 */
export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request shape.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const workspace = await getCurrentWorkspace(viewer);

  const rateLimited = await isQuickSlideRateLimited(viewer.user.id);
  if (rateLimited) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message:
          "You have used your hourly quick-slide budget (12 per hour). Try again in a bit.",
      },
      { status: 429 },
    );
  }

  const scope = parsed.data.scope_id
    ? await getScope(parsed.data.scope_id).catch(() => null)
    : null;
  if (parsed.data.scope_id && (!scope || scope.workspace_id !== workspace.id)) {
    return NextResponse.json({ error: "Scope not found in this workspace." }, { status: 404 });
  }

  const brief: QuickSlideBrief = {
    topic: parsed.data.topic,
    audience: parsed.data.audience,
    data_focus: parsed.data.data_focus,
    language: parsed.data.language,
    extra_instructions: parsed.data.extra_instructions,
  };

  const row = await createQuickSlideRun({
    workspaceId: workspace.id,
    workspaceScopeId: scope?.id ?? null,
    conversationId: parsed.data.conversation_id ?? null,
    createdBy: viewer.user.id,
    brief,
    evidenceDocIds: parsed.data.evidence_doc_ids,
  });

  after(async () => {
    await runQuickSlidePipeline({
      runId: row.id,
      workspaceId: workspace.id,
      scopeId: scope?.id ?? null,
      brief,
      evidenceDocIds: parsed.data.evidence_doc_ids,
    });
  });

  return NextResponse.json(
    { id: row.id, status: row.status, brief: row.brief },
    { status: 202 },
  );
}
