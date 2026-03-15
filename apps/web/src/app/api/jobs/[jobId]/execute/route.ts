import { NextResponse } from "next/server";

import { runGenerationRequest } from "@basquio/workflows";

import { loadPersistedGenerationRequest } from "@/lib/generation-requests";
import { getGenerationStatus } from "@/lib/run-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const activeExecutions = new Set<string>();
const STALE_RUNNING_RECOVERY_MS = 45_000;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const request = await loadPersistedGenerationRequest(jobId);

  if (!request) {
    return NextResponse.json({ error: "Persisted generation request not found." }, { status: 404 });
  }

  const status = await getGenerationStatus(jobId);
  if (status?.summary || status?.status === "completed") {
    return NextResponse.json({ status: "completed" });
  }

  const lastStatusUpdate = status?.updatedAt ?? status?.createdAt;
  const isStaleRunningExecution =
    status?.status === "running" &&
    status.steps.length === 0 &&
    Boolean(lastStatusUpdate) &&
    Date.now() - new Date(lastStatusUpdate ?? "").getTime() >= STALE_RUNNING_RECOVERY_MS;

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
    const message = error instanceof Error ? error.message : "Generation failed.";

    console.error(`Basquio execute route failed for ${jobId}`, error);

    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    activeExecutions.delete(jobId);
  }
}
