import { NextResponse } from "next/server";

import { generateDeckRun } from "@basquio/workflows/generate-deck";

import { getInternalDispatchToken } from "@/lib/generation-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const token = getInternalDispatchToken();
  const providedToken = request.headers.get("x-basquio-internal-token") ?? "";

  if (!token || providedToken !== token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { jobId } = await params;

  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid run ID." }, { status: 400 });
  }

  try {
    await generateDeckRun(jobId);
    return NextResponse.json({ runId: jobId, status: "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ runId: jobId, status: "failed", error: message }, { status: 500 });
  }
}
