import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { generateAnswer } from "@/lib/workspace/generate";

export const runtime = "nodejs";
export const maxDuration = 300;

const askSchema = z.object({
  prompt: z.string().min(1).max(4000),
  scope: z.string().min(1).max(120).optional(),
});

export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  let payload: z.infer<typeof askSchema>;
  try {
    payload = askSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await generateAnswer({
      prompt: payload.prompt,
      scope: payload.scope,
      userEmail: viewer.user.email ?? "unknown",
      userId: viewer.user.id,
    });

    if (result.status === "failed") {
      return NextResponse.json(
        {
          deliverableId: result.deliverableId,
          error: result.error ?? "Generation failed.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      deliverableId: result.deliverableId,
      bodyMarkdown: result.bodyMarkdown,
      citations: result.citations,
      scope: result.scope,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
