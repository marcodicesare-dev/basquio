import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID } from "@/lib/workspace/constants";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const citationSchema = z.object({
  label: z.string(),
  source_type: z.string(),
  source_id: z.string(),
  filename: z.string().nullable().optional(),
  excerpt: z.string().max(2000).optional(),
});

const bodySchema = z.object({
  title: z.string().trim().min(1).max(240),
  prompt: z.string().trim().min(1).max(2000),
  body_markdown: z.string().min(1).max(200_000),
  citations: z.array(citationSchema).max(50).default([]),
  scope: z.string().nullable().optional(),
  workspace_scope_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  from_message_id: z.string().nullable().optional(),
  kind: z.enum(["answer", "memo", "brief"]).default("memo"),
});

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
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
  const db = getDb();

  const citations = payload.citations.map((c) => ({
    label: c.label,
    source_type: c.source_type,
    source_id: c.source_id,
    filename: c.filename ?? null,
    excerpt: c.excerpt ?? "",
  }));

  const { data, error } = await db
    .from("workspace_deliverables")
    .insert({
      organization_id: BASQUIO_TEAM_ORG_ID,
      is_team_beta: true,
      workspace_id: workspace.id,
      workspace_scope_id: payload.workspace_scope_id ?? null,
      conversation_id: payload.conversation_id ?? null,
      created_by: viewer.user.id,
      kind: payload.kind,
      title: payload.title.slice(0, 200),
      prompt: payload.prompt.slice(0, 2000),
      scope: payload.scope ?? null,
      status: "ready",
      body_markdown: payload.body_markdown,
      citations,
      metadata: {
        user_email: viewer.user.email ?? null,
        saved_from: "chat",
        from_message_id: payload.from_message_id ?? null,
        chunk_count: citations.length,
        fact_count: 0,
        entity_count: 0,
      },
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Could not save deliverable." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    deliverableId: data.id,
    url: `/workspace/deliverable/${data.id}`,
  });
}
