import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { deleteScope, getScope, renameScope } from "@/lib/workspace/scopes";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).optional(),
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!isTeamBetaEmail(viewer.user.email))
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid scope id." }, { status: 400 });
  const workspace = await getCurrentWorkspace();
  const scope = await getScope(id);
  if (!scope || scope.workspace_id !== workspace.id) {
    return NextResponse.json({ error: "Scope not found." }, { status: 404 });
  }
  return NextResponse.json({ scope });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!isTeamBetaEmail(viewer.user.email))
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid scope id." }, { status: 400 });

  let payload: z.infer<typeof patchSchema>;
  try {
    payload = patchSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid body." },
      { status: 400 },
    );
  }

  const workspace = await getCurrentWorkspace();
  const existing = await getScope(id);
  if (!existing || existing.workspace_id !== workspace.id) {
    return NextResponse.json({ error: "Scope not found." }, { status: 404 });
  }
  if (existing.kind === "system") {
    return NextResponse.json({ error: "System scopes cannot be renamed." }, { status: 403 });
  }

  try {
    const scope = await renameScope(id, payload.name, payload.slug);
    return NextResponse.json({ scope });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rename failed." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!isTeamBetaEmail(viewer.user.email))
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid scope id." }, { status: 400 });

  const workspace = await getCurrentWorkspace();
  const existing = await getScope(id);
  if (!existing || existing.workspace_id !== workspace.id) {
    return NextResponse.json({ error: "Scope not found." }, { status: 404 });
  }
  if (existing.kind === "system") {
    return NextResponse.json({ error: "System scopes cannot be removed." }, { status: 403 });
  }

  await deleteScope(id);
  return NextResponse.json({ ok: true });
}
