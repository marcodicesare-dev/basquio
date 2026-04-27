import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { approveCandidate } from "@/lib/workspace/candidates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    edits: z.record(z.string(), z.unknown()).optional(),
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

  let edits: Record<string, unknown> = {};
  if (request.body) {
    try {
      const raw = await request.json();
      const parsed = bodySchema.parse(raw ?? {});
      edits = parsed.edits ?? {};
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: error.issues[0]?.message ?? "Invalid approval body." },
          { status: 400 },
        );
      }
      // Empty body is fine; means approve with no edits.
    }
  }

  try {
    const result = await approveCandidate(id, viewer.user.id, edits);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to approve candidate.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
