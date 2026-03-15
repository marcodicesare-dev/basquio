import { NextResponse } from "next/server";

import { GenerationExecutionLeaseError, runGenerationRequest } from "@basquio/workflows";

import { getInternalDispatchToken, loadPersistedGenerationRequest } from "@/lib/generation-requests";
import { getGenerationStatus } from "@/lib/run-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const activeExecutions = new Set<string>();
const STALE_RUNNING_NO_CHECKPOINT_RECOVERY_MS = 45_000;
const STALE_RUNNING_STEP_RECOVERY_MS = 180_000;

export async function POST(
  requestForAuth: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const dispatchToken = getInternalDispatchToken();

  if (!dispatchToken || requestForAuth.headers.get("x-basquio-internal-token") !== dispatchToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { jobId } = await params;
  const request = await loadPersistedGenerationRequest(jobId);

  if (!request) {
    return NextResponse.json({ error: "Persisted generation request not found." }, { status: 404 });
  }

  const status = await getGenerationStatus(jobId);
  if (status?.status === "completed" && status.artifactsReady) {
    return NextResponse.json({ status: "completed" });
  }

  const lastStatusUpdate = status?.updatedAt ?? status?.createdAt;
  const runningStepStartedAt =
    [...(status?.steps ?? [])]
      .reverse()
      .find((step) => step.status === "running")?.startedAt ??
    null;
  const staleRunningThresholdMs = runningStepStartedAt
    ? STALE_RUNNING_STEP_RECOVERY_MS
    : STALE_RUNNING_NO_CHECKPOINT_RECOVERY_MS;
  const isStaleRunningExecution =
    status?.status === "running" &&
    Boolean(lastStatusUpdate) &&
    Date.now() - new Date((runningStepStartedAt ?? lastStatusUpdate) || "").getTime() >= staleRunningThresholdMs;

  if (status && !isStaleRunningExecution && (status.steps.length > 0 || status.status === "running")) {
    return NextResponse.json({ status: "running" }, { status: 202 });
  }

  if (activeExecutions.has(jobId)) {
    return NextResponse.json({ status: "running" }, { status: 202 });
  }

  activeExecutions.add(jobId);

  try {
    const summary = await runGenerationRequest(request);

    return NextResponse.json({
      status: summary.status,
      slideCount: summary.slidePlan.slides.length,
      artifactCount: summary.artifacts.length,
    });
  } catch (error) {
    if (error instanceof GenerationExecutionLeaseError) {
      return NextResponse.json({ status: "running" }, { status: 202 });
    }

    const message = error instanceof Error ? error.message : "Generation failed.";

    console.error(`Basquio execute route failed for ${jobId}`, error);

    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    activeExecutions.delete(jobId);
  }
}
