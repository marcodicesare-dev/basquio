import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import {
  archiveMemoryEntry,
  deleteMemoryEntry,
  getMemoryEntry,
  togglePinMemoryEntry,
  updateMemoryEntry,
} from "@/lib/workspace/memory";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

const patchSchema = z.object({
  content: z.string().trim().min(1).max(20_000).optional(),
  memory_type: z.enum(["procedural", "semantic", "episodic"]).optional(),
  pinned: z.boolean().optional(),
  archived: z.literal(true).optional(),
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
  const entry = await getMemoryEntry(id);
  if (!entry || entry.workspace_id !== workspace.id) {
    return NextResponse.json({ error: "Memory entry not found." }, { status: 404 });
  }
  return NextResponse.json({ entry });
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
  const existing = await getMemoryEntry(id);
  if (!existing || existing.workspace_id !== workspace.id) {
    return NextResponse.json({ error: "Memory entry not found." }, { status: 404 });
  }

  if (payload.archived) {
    const entry = await archiveMemoryEntry(id);
    return NextResponse.json({ entry });
  }

  if (typeof payload.pinned === "boolean" && payload.content === undefined && payload.memory_type === undefined) {
    const entry = await togglePinMemoryEntry(id, payload.pinned);
    return NextResponse.json({ entry });
  }

  const metadata = { ...existing.metadata };
  if (typeof payload.pinned === "boolean") {
    if (payload.pinned) {
      metadata.pinned_at = new Date().toISOString();
    } else {
      delete metadata.pinned_at;
    }
  }
  metadata.edited_by = viewer.user.email ?? viewer.user.id;
  metadata.edited_at = new Date().toISOString();

  const entry = await updateMemoryEntry(id, {
    content: payload.content,
    memoryType: payload.memory_type,
    metadata,
  });
  return NextResponse.json({ entry });
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
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const workspace = await getCurrentWorkspace(viewer);
  const existing = await getMemoryEntry(id);
  if (!existing || existing.workspace_id !== workspace.id) {
    return NextResponse.json({ error: "Memory entry not found." }, { status: 404 });
  }

  await deleteMemoryEntry(id);
  return NextResponse.json({ ok: true });
}
