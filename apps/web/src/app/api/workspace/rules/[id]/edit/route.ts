import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { editRule } from "@/lib/workspace/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const editsSchema = z
  .object({
    rule_text: z.string().min(1).max(2000).optional(),
    rule_type: z
      .enum(["always", "never", "precedence", "format", "tone", "source", "approval", "style"])
      .optional(),
    applies_to: z.array(z.string().max(120)).max(20).optional(),
    forbidden: z.array(z.string().max(120)).max(50).optional(),
    priority: z.number().int().min(0).max(100).optional(),
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
  let edits: Record<string, unknown>;
  try {
    const raw = await request.json();
    edits = editsSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid edits payload." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid edits payload." }, { status: 400 });
  }
  if (Object.keys(edits).length === 0) {
    return NextResponse.json({ error: "Edits payload must include at least one field." }, { status: 400 });
  }
  try {
    await editRule(id, viewer.user.id, edits);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to edit rule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
