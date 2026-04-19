import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { getWorkspaceEntityDetail } from "@/lib/workspace/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ entityId: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  const { entityId } = await context.params;
  if (!isUuid(entityId)) {
    return NextResponse.json({ error: "Invalid entity id." }, { status: 400 });
  }

  const detail = await getWorkspaceEntityDetail(entityId);
  if (!detail) {
    return NextResponse.json({ error: "Entity not found." }, { status: 404 });
  }
  return NextResponse.json(detail);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
