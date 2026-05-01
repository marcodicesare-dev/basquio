import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import {
  archiveConversation,
  deleteConversation,
  getConversation,
  renameConversation,
  unarchiveConversation,
} from "@/lib/workspace/conversations";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Conversation CRUD: rename, archive, unarchive, delete.
 * The sidebar kebab menu calls these.
 *
 * Tenancy: the conversation must belong to the viewer's current workspace.
 * Missing rows return 404; out-of-tenant rows also return 404 so we never
 * leak existence across workspaces.
 */
async function authorizeConversation(id: string) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return { error: NextResponse.json({ error: "Sign in required." }, { status: 401 }) } as const;
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return {
      error: NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 }),
    } as const;
  }
  if (!UUID_RE.test(id)) {
    return {
      error: NextResponse.json({ error: "Invalid conversation id." }, { status: 400 }),
    } as const;
  }
  const workspace = await getCurrentWorkspace(viewer);
  const conversation = await getConversation(id).catch(() => null);
  if (!conversation || conversation.workspace_id !== workspace.id) {
    return {
      error: NextResponse.json({ error: "Conversation not found." }, { status: 404 }),
    } as const;
  }
  return { viewer, workspace, conversation } as const;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await authorizeConversation(id);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const input = body as {
    title?: string | null;
    archived?: boolean;
  };

  // Apply title change first so a single PATCH can both rename and archive.
  if (input.title !== undefined) {
    const next = typeof input.title === "string" ? input.title : null;
    try {
      await renameConversation(id, next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rename failed.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (input.archived !== undefined) {
    try {
      if (input.archived) {
        await archiveConversation(id);
      } else {
        await unarchiveConversation(id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Archive flip failed.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, id });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await authorizeConversation(id);
  if ("error" in auth) return auth.error;

  try {
    await deleteConversation(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id });
}
