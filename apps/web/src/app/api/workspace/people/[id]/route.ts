import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import {
  getWorkspacePerson,
  getWorkspacePersonProfile,
  updateWorkspacePerson,
} from "@/lib/workspace/people";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const preferencesSchema = z.object({
  free_text: z.string().max(4000).optional(),
  structured: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const patchSchema = z.object({
  canonical_name: z.string().trim().min(1).max(200).optional(),
  aliases: z.array(z.string().max(200)).max(20).optional(),
  role: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  preferences: preferencesSchema.optional(),
  notes: z.string().max(4000).optional(),
  linked_scope_id: z.string().uuid().nullable().optional(),
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
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const workspace = await getCurrentWorkspace(viewer);
  const profile = await getWorkspacePersonProfile(id);
  if (!profile || profile.workspace_id !== workspace.id) {
    return NextResponse.json({ error: "Person not found." }, { status: 404 });
  }
  return NextResponse.json({ profile });
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
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  let payload: z.infer<typeof patchSchema>;
  try {
    payload = patchSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid body." },
      { status: 400 },
    );
  }

  const workspace = await getCurrentWorkspace(viewer);
  const existing = await getWorkspacePerson(id);
  if (!existing || existing.workspace_id !== workspace.id) {
    return NextResponse.json({ error: "Person not found." }, { status: 404 });
  }

  const updated = await updateWorkspacePerson(id, payload);
  return NextResponse.json({ person: updated });
}
