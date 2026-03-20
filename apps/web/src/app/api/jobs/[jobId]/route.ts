import { NextResponse } from "next/server";

import { getViewerState } from "@/lib/supabase/auth";
import { fetchRestRows } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const V2_PHASES = ["normalize", "understand", "author", "critique", "revise", "export"] as const;

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

  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
  }

  const snapshot = await getRunSnapshot(jobId, viewer.user.id);

  if (!snapshot) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  return NextResponse.json(snapshot, {
    status: snapshot.status === "completed" ? 200 : 202,
  });
}

async function getRunSnapshot(jobId: string, viewerId: string) {
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
      requested_by: `eq.${viewerId}`,
      limit: "1",
    },
  }).catch(() => []);

  if (runs.length === 0) {
    return null;
  }

  const run = runs[0];

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

  const toolCalls = events.filter((e) => e.event_type === "tool_call");
  const currentPhaseTools = toolCalls.filter((e) => e.phase === currentPhase);

  const PHASE_ESTIMATE_SECONDS: Record<string, number> = {
    normalize: 15,
    understand: 90,
    author: 180,
    critique: 60,
    revise: 60,
    export: 30,
  };

  let progressPercent: number;
  if (run.status === "completed") {
    progressPercent = 100;
  } else if (run.status === "failed") {
    progressPercent = Math.max(2, Math.round((completedPhases.size / V2_PHASES.length) * 100));
  } else {
    // Simple monotonic progress: based purely on elapsed time + phase position
    // Never goes backward because elapsed time only increases
    const totalExpectedSeconds = Object.values(PHASE_ESTIMATE_SECONDS).reduce((a, b) => a + b, 0); // ~435s
    const elapsedSoFar = Math.max(1, (Date.now() - new Date(run.created_at).getTime()) / 1000);

    // Time-based progress (smooth, never drops)
    const timeProgress = Math.min(95, (elapsedSoFar / totalExpectedSeconds) * 100);

    // Phase-based progress (jumps at phase boundaries but never backward)
    const phaseProgress = currentPhaseIndex >= 0
      ? ((currentPhaseIndex + 0.5) / V2_PHASES.length) * 100
      : 2;

    // Use the HIGHER of time-based and phase-based (guarantees monotonic)
    progressPercent = Math.max(2, Math.min(99, Math.round(Math.max(timeProgress, phaseProgress))));
  }

  const createdAt = run.created_at;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));

  const estimatedRemainingSeconds =
    run.status === "completed" || run.status === "failed"
      ? 0
      : (() => {
          // Sum estimated seconds for remaining phases
          const remaining = V2_PHASES.filter((p) => !completedPhases.has(p) && p !== currentPhase);
          const remainingEstimate = remaining.reduce((sum, p) => sum + (PHASE_ESTIMATE_SECONDS[p] ?? 30), 0);
          // Current phase: estimate fraction remaining
          const currentEstimate = PHASE_ESTIMATE_SECONDS[currentPhase ?? ""] ?? 30;
          const currentFraction = currentPhaseTools.length > 0
            ? Math.min(0.9, currentPhaseTools.length / 15)
            : 0;
          return Math.max(5, Math.round(remainingEstimate + currentEstimate * (1 - currentFraction)));
        })();
  const lastToolCall = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;

  const steps = V2_PHASES.map((phase, index) => {
    let status: "queued" | "running" | "completed" | "failed";
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

  // Fetch artifact manifest if completed
  let summary: Record<string, unknown> | null = null;
  if (run.status === "completed" || run.completed_at) {
    try {
      const manifests = await fetchRestRows<{
        slide_count: number;
        page_count: number;
        qa_passed: boolean;
        artifacts: Array<{ kind: string; fileName: string; fileBytes: number; storagePath: string }>;
      }>({
        supabaseUrl: supabaseUrl!,
        serviceKey: serviceKey!,
        table: "artifact_manifests_v2",
        query: {
          select: "slide_count,page_count,qa_passed,artifacts",
          run_id: `eq.${jobId}`,
          limit: "1",
        },
      });
      if (manifests.length > 0) {
        const m = manifests[0];
        summary = {
          slideCount: m.slide_count,
          pageCount: m.page_count,
          qaPassed: m.qa_passed,
          artifacts: m.artifacts.map((a) => ({
            kind: a.kind,
            fileName: a.fileName,
            fileBytes: a.fileBytes,
            downloadUrl: `/api/artifacts/${jobId}/${a.kind}`,
          })),
        };
      }
    } catch {
      // Manifest not available yet
    }
  }

  return {
    jobId,
    pipelineVersion: "v2" as const,
    status: run.status as "queued" | "running" | "completed" | "failed",
    artifactsReady: Boolean(run.completed_at) || run.status === "completed",
    createdAt,
    updatedAt: run.updated_at ?? undefined,
    currentStage: currentPhase ?? V2_PHASES[0],
    currentDetail,
    progressPercent,
    elapsedSeconds,
    estimatedRemainingSeconds,
    steps,
    summary,
    failureMessage: run.failure_message ?? undefined,
    toolCallCount: toolCalls.length,
  };
}
