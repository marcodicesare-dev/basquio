import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { listPendingCandidates } from "@/lib/workspace/candidates";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  const url = new URL(request.url);
  const scopeIdParam = url.searchParams.get("scope_id");
  const scopeId = scopeIdParam === null || scopeIdParam === "" ? undefined : scopeIdParam;

  const workspace = await getCurrentWorkspace(viewer);
  try {
    const candidates = await listPendingCandidates(workspace.id, scopeId);
    return NextResponse.json({ candidates, count: candidates.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list pending candidates.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
