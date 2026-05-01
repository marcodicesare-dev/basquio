import { after, NextResponse } from "next/server";
import { z } from "zod";

import { getQuickSlideRun } from "@/lib/workspace/quick-slide";
import { runQuickSlidePipeline } from "@/lib/workspace/quick-slide-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300s gives the after() hook room for the 90s pipeline plus storage upload
// plus row update plus a healthy buffer for Vercel cold-start variance.
export const maxDuration = 300;

const Body = z.object({
  run_id: z.string().uuid(),
});

/**
 * Internal endpoint: kicks off the pipeline for an existing quick_slide_runs
 * row. Authed by a shared secret in the x-basquio-internal header so the
 * agent tool can call this without forwarding the user's session cookie.
 *
 * The pipeline runs in after(), so this endpoint returns 202 immediately
 * after registering the work.
 */
export async function POST(request: Request) {
  const expectedToken = process.env.BASQUIO_INTERNAL_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "Internal dispatch is disabled (missing BASQUIO_INTERNAL_TOKEN)." },
      { status: 503 },
    );
  }
  const presented = request.headers.get("x-basquio-internal");
  if (presented !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request shape.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { run_id } = parsed.data;
  const row = await getQuickSlideRun(run_id).catch(() => null);
  if (!row) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  if (row.status !== "queued") {
    // Idempotency: a duplicate dispatch on a non-queued row is a no-op.
    return NextResponse.json(
      { ok: true, id: row.id, status: row.status, already_dispatched: true },
      { status: 200 },
    );
  }

  after(async () => {
    await runQuickSlidePipeline({
      runId: row.id,
      workspaceId: row.workspace_id,
      scopeId: row.workspace_scope_id,
      brief: row.brief,
      evidenceDocIds: row.evidence_doc_ids,
    });
  });

  return NextResponse.json({ ok: true, id: row.id, status: "dispatching" }, { status: 202 });
}
