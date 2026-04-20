import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { createScope, listScopes } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const postSchema = z.object({
  kind: z.enum(["client", "category", "function"]),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).optional(),
  parent_scope_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET() {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }
  const workspace = await getCurrentWorkspace();
  const scopes = await listScopes(workspace.id);
  return NextResponse.json({ workspace_id: workspace.id, scopes });
}

export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  let payload: z.infer<typeof postSchema>;
  try {
    payload = postSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const workspace = await getCurrentWorkspace();
  try {
    const scope = await createScope({
      workspaceId: workspace.id,
      kind: payload.kind,
      name: payload.name,
      slug: payload.slug,
      parentScopeId: payload.parent_scope_id ?? null,
      metadata: payload.metadata ?? {},
    });
    return NextResponse.json({ scope }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create scope.";
    const isConflict = message.includes("already exists");
    return NextResponse.json({ error: message }, { status: isConflict ? 409 : 500 });
  }
}
