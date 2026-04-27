import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { dismissCandidate } from "@/lib/workspace/candidates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z.string().min(1).max(400),
});

export async function POST(
  request: Request,
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

  let reason: string;
  try {
    const raw = await request.json();
    const parsed = bodySchema.parse(raw);
    reason = parsed.reason;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "A dismissal reason is required." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "A dismissal reason is required." }, { status: 400 });
  }

  try {
    await dismissCandidate(id, viewer.user.id, reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to dismiss candidate.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
