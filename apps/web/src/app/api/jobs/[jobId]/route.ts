import { NextResponse } from "next/server";

import {
  dispatchPersistedGenerationExecution,
  dispatchPersistedGenerationJob,
} from "@/lib/generation-requests";
import { getViewerState } from "@/lib/supabase/auth";
import { getGenerationStatus } from "@/lib/run-status";
import { fetchRestRows } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const V2_PHASES = ["normalize", "understand", "author", "critique", "revise", "export"] as const;

const stalledKickoffs = new Map<string, number>();
const stalledExecutions = new Map<string, number>();

type DeckRunRow = {
  id: string;
  status: string;
  current_phase: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
};

type DeckRunEventRow = {
  id: string;
  phase: string | null;
  event_type: string;
  tool_name: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const viewer = await getViewerState();

  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Try v2 deck_runs first
  const v2Snapshot = await getV2RunSnapshot(jobId);
  if (v2Snapshot) {
    return NextResponse.json(v2Snapshot, {
      status: v2Snapshot.status === "completed" ? 200 : 202,
    });
  }

  // Fall back to v1 generation_jobs
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

async function getV2RunSnapshot(jobId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  const runs = await fetchRestRows<DeckRunRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_runs",
    query: {
      select: "id,status,current_phase,failure_message,created_at,updated_at,completed_at",
      id: `eq.${jobId}`,
      limit: "1",
    },
  }).catch(() => []);

  if (runs.length === 0) {
    return null;
  }

  const run = runs[0];

  // Fetch events for progress details
  const events = await fetchRestRows<DeckRunEventRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_run_events",
    query: {
      select: "id,phase,event_type,tool_name,payload,created_at",
      run_id: `eq.${jobId}`,
      order: "created_at.asc",
      limit: "200",
    },
  }).catch(() => []);

  const completedPhases = new Set(
    events
      .filter((e) => e.event_type === "phase_completed")
      .map((e) => e.phase)
      .filter((p): p is string => p !== null),
  );

  const currentPhase = run.current_phase ?? (completedPhases.size > 0 ? undefined : V2_PHASES[0]);
  const currentPhaseIndex = currentPhase ? V2_PHASES.indexOf(currentPhase as typeof V2_PHASES[number]) : -1;

  const progressPercent =
    run.status === "completed"
      ? 100
      : run.status === "failed"
        ? 0
        : Math.max(2, Math.min(99, Math.round(
            ((completedPhases.size + (currentPhaseIndex >= 0 ? 0.5 : 0)) / V2_PHASES.length) * 100,
          )));

  const createdAt = run.created_at;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));
  const estimatedRemainingSeconds =
    run.status === "completed" || progressPercent >= 99
      ? 0
      : progressPercent > 8
        ? Math.max(5, Math.round((elapsedSeconds / progressPercent) * (100 - progressPercent)))
        : null;

  // Build v1-compatible steps from v2 phases
  const toolCalls = events.filter((e) => e.event_type === "tool_call");
  const lastToolCall = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;

  const steps = V2_PHASES.map((phase, index) => {
    let status: "queued" | "running" | "completed" | "failed" | "needs_input";
    if (completedPhases.has(phase)) {
      status = "completed";
    } else if (run.current_phase === phase) {
      status = run.status === "failed" ? "failed" : "running";
    } else if (index < (currentPhaseIndex >= 0 ? currentPhaseIndex : V2_PHASES.length)) {
      status = "completed";
    } else {
      status = "queued";
    }

    const phaseToolCalls = toolCalls.filter((e) => e.phase === phase);
    const lastPhaseToolCall = phaseToolCalls.length > 0 ? phaseToolCalls[phaseToolCalls.length - 1] : null;

    return {
      stage: phase,
      baseStage: phase,
      attempt: 1,
      status,
      detail: lastPhaseToolCall?.tool_name
        ? `Tool: ${lastPhaseToolCall.tool_name}`
        : status === "running"
          ? `Running ${phase} phase...`
          : status === "completed"
            ? `${phase} phase complete.`
            : "",
    };
  });

  const currentDetail = lastToolCall?.tool_name
    ? `Tool: ${lastToolCall.tool_name} (${currentPhase ?? ""})`
    : run.status === "completed"
      ? "Artifacts are ready."
      : run.status === "failed"
        ? run.failure_message ?? "Run failed."
        : `Running ${currentPhase ?? "pipeline"}...`;

  return {
    jobId,
    pipelineVersion: "v2" as const,
    status: run.status as "queued" | "running" | "completed" | "failed" | "needs_input",
    artifactsReady: run.status === "completed",
    createdAt,
    updatedAt: run.updated_at ?? undefined,
    currentStage: currentPhase ?? V2_PHASES[0],
    currentDetail,
    progressPercent,
    elapsedSeconds,
    estimatedRemainingSeconds,
    steps,
    summary: null,
    failureMessage: run.failure_message ?? undefined,
  };
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

  if (status.status !== "running") {
    return false;
  }

  const artifactCompletionIsPending = status.summary?.status === "completed" && !status.artifactsReady;
  const canRecoverLiveExecution = !status.summary || artifactCompletionIsPending;

  if (!canRecoverLiveExecution) {
    return false;
  }

  const hasRunningStep = Boolean(
    [...status.steps].reverse().find((step) => step.status === "running"),
  );
  const lastObservedAt = status.updatedAt ?? status.createdAt;
  const staleThresholdMs = hasRunningStep ? 180_000 : 45_000;

  if (!lastObservedAt || Date.now() - new Date(lastObservedAt).getTime() < staleThresholdMs) {
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
