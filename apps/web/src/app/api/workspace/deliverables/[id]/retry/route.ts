import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { generateAnswer } from "@/lib/workspace/generate";
import { consume } from "@/lib/workspace/rate-limit";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";
export const maxDuration = 300;

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  const decision = consume({
    key: `ask:${viewer.user.id}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: `Slow down. 10 prompts per minute. Try again in ${decision.retryAfterSeconds}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(decision.retryAfterSeconds) },
      },
    );
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid deliverable id." }, { status: 400 });
  }

  const workspace = await getCurrentWorkspace(viewer);
  const db = getDb();
  const { data: existing, error: loadError } = await db
    .from("workspace_deliverables")
    .select("id, prompt, scope, status")
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
  }

  await db
    .from("workspace_deliverables")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id);

  const result = await generateAnswer({
    prompt: (existing as { prompt: string }).prompt,
    scope: (existing as { scope: string | null }).scope ?? undefined,
    userEmail: viewer.user.email ?? "unknown",
    userId: viewer.user.id,
    workspaceId: workspace.id,
    organizationId: workspace.organization_id,
  });

  return NextResponse.json({
    deliverableId: result.deliverableId,
    bodyMarkdown: result.bodyMarkdown,
    citations: result.citations,
    scope: result.scope,
    status: result.status,
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
