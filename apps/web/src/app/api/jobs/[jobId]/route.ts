import { NextResponse } from "next/server";

import { dispatchPersistedGenerationJob } from "@/lib/generation-requests";
import { getGenerationStatus } from "@/lib/run-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const status = await getGenerationStatus(jobId);

  if (!status) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  if (!process.env.INNGEST_EVENT_KEY && status.status === "queued") {
    await dispatchPersistedGenerationJob(jobId, _request);
  }

  return NextResponse.json(status, {
    status: status.status === "completed" ? 200 : 202,
  });
}
