import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { snoozeHint } from "@/lib/workspace/anticipation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    days: z.number().int().min(1).max(60).optional(),
  })
  .strict();

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
  let days = 7;
  try {
    const raw = await request.json();
    days = bodySchema.parse(raw).days ?? 7;
  } catch {
    // Empty body is fine; defaults to 7 days.
  }
  try {
    await snoozeHint(id, viewer.user.id, days);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to snooze hint.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
