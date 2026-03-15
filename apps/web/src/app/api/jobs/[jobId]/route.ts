import { NextResponse } from "next/server";

import {
  dispatchPersistedGenerationExecution,
  dispatchPersistedGenerationJob,
} from "@/lib/generation-requests";
import { getViewerState } from "@/lib/supabase/auth";
import { getGenerationStatus } from "@/lib/run-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stalledKickoffs = new Map<string, number>();
const stalledExecutions = new Map<string, number>();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const viewer = await getViewerState();

  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const status = await getGenerationStatus(jobId, viewer.user.id);

  if (!status) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  if (shouldRecoverStalledExecution(status)) {
    await dispatchPersistedGenerationExecution(jobId, _request);
  } else if ((!process.env.INNGEST_EVENT_KEY && status.status === "queued") || shouldKickoffStalledRun(status)) {
    await dispatchPersistedGenerationJob(jobId, _request);
  }

  return NextResponse.json(status, {
    status: status.status === "completed" ? 200 : 202,
  });
}

function shouldKickoffStalledRun(status: Awaited<ReturnType<typeof getGenerationStatus>>) {
  if (!status) {
    return false;
  }

  if (status.status !== "queued" || status.steps.length > 0 || status.summary) {
    return false;
  }

  if (status.elapsedSeconds < 30) {
    return false;
  }

  const lastKickoff = stalledKickoffs.get(status.jobId) ?? 0;
  const now = Date.now();

  if (now - lastKickoff < 60_000) {
    return false;
  }

  stalledKickoffs.set(status.jobId, now);
  return true;
}

function shouldRecoverStalledExecution(status: Awaited<ReturnType<typeof getGenerationStatus>>) {
  if (!status) {
    return false;
  }

  if (status.status !== "running" || status.steps.length > 0 || status.summary) {
    return false;
  }

  if (status.elapsedSeconds < 45) {
    return false;
  }

  const lastRecovery = stalledExecutions.get(status.jobId) ?? 0;
  const now = Date.now();

  if (now - lastRecovery < 60_000) {
    return false;
  }

  stalledExecutions.set(status.jobId, now);
  return true;
}
