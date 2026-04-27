import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { pinRule } from "@/lib/workspace/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }
  try {
    await pinRule(id, viewer.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to pin rule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
