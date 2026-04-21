import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { listConversationAttachments } from "@/lib/workspace/conversation-attachments";
import { getConversation } from "@/lib/workspace/conversations";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
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

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ attachments: [] }, { status: 200 });
  }

  // Ownership check: the conversation must belong to the viewer's workspace.
  // Without this, any team-beta user could enumerate any conversation's
  // attachments by UUID. Missing-row is treated the same as "not yours" so we
  // don't leak existence.
  const workspace = await getCurrentWorkspace();
  const conversation = await getConversation(id).catch(() => null);
  if (!conversation || conversation.workspace_id !== workspace.id) {
    return NextResponse.json({ attachments: [] }, { status: 200 });
  }

  const rows = await listConversationAttachments(id).catch(() => []);
  return NextResponse.json({
    attachments: rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      filename: row.filename,
      fileType: row.file_type,
      fileSizeBytes: row.file_size_bytes,
      status: row.status,
      origin: row.origin,
      attachedAt: row.attached_at,
    })),
  });
}
