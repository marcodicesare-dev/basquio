import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { listWorkspacePeople } from "@/lib/workspace/people";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";

export async function GET() {
  const viewer = await getViewerState();
  if (!viewer.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!isTeamBetaEmail(viewer.user.email))
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });

  const workspace = await getCurrentWorkspace(viewer);
  const people = await listWorkspacePeople(workspace.id);
  return NextResponse.json({ workspace_id: workspace.id, people });
}
