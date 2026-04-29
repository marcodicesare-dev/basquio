import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { streamAnswer, type StreamEvent } from "@/lib/workspace/generate";
import { consume } from "@/lib/workspace/rate-limit";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";
export const maxDuration = 300;

const askSchema = z.object({
  prompt: z.string().min(1).max(4000),
  scope: z.string().min(1).max(120).optional(),
});

const RATE_LIMIT = {
  limit: 10,
  windowMs: 60_000,
};

export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  const decision = consume({
    key: `ask:${viewer.user.id}`,
    limit: RATE_LIMIT.limit,
    windowMs: RATE_LIMIT.windowMs,
  });
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: `Slow down. ${RATE_LIMIT.limit} prompts per minute. Try again in ${decision.retryAfterSeconds}s.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(decision.retryAfterSeconds),
          "X-RateLimit-Limit": String(RATE_LIMIT.limit),
          "X-RateLimit-Remaining": String(decision.remaining),
        },
      },
    );
  }

  let payload: z.infer<typeof askSchema>;
  try {
    payload = askSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const userEmail = viewer.user.email ?? "unknown";
  const userId = viewer.user.id;
  const workspace = await getCurrentWorkspace(viewer);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: StreamEvent) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      try {
        for await (const event of streamAnswer({
          prompt: payload.prompt,
          scope: payload.scope,
          userEmail,
          userId,
          workspaceId: workspace.id,
          organizationId: workspace.organization_id,
        })) {
          send(event);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Generation failed.";
        send({ type: "error", deliverableId: null, message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "connection": "keep-alive",
      "X-RateLimit-Limit": String(RATE_LIMIT.limit),
      "X-RateLimit-Remaining": String(decision.remaining),
    },
  });
}
