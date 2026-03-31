import { NextResponse } from "next/server";
import { BASQUIO_PHASES } from "@basquio/core";
import {
  buildNoTemplateDiagnostics,
  buildTemplateDiagnosticsFromProfile,
  isTemplateDiagnostics,
  type TemplateDiagnostics,
} from "@basquio/template-engine";

import { getViewerState } from "@/lib/supabase/auth";
import { fetchRestRows } from "@/lib/supabase/admin";
import { buildPhaseProgressModel, estimateRemainingSecondsForPhase } from "@/lib/run-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const V2_PHASES = BASQUIO_PHASES;

type DeckRunRow = {
  id: string;
  status: string;
  author_model: string | null;
  current_phase: string | null;
  phase_started_at: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  template_profile_id: string | null;
  source_file_ids: string[];
  template_diagnostics: Record<string, unknown> | null;
  active_attempt_id: string | null;
  latest_attempt_id: string | null;
  latest_attempt_number: number;
};

type DeckRunEventRow = {
  id: string;
  attempt_id: string | null;
  attempt_number: number | null;
  phase: string | null;
  event_type: string;
  tool_name: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type DeckRunAttemptRow = {
  id: string;
  updated_at: string | null;
  last_meaningful_event_at: string | null;
};

type DeckRunRequestUsageRow = {
  started_at: string;
  completed_at: string | null;
};

type TemplateProfileRow = {
  source_file_id: string | null;
  template_profile: Parameters<typeof buildTemplateDiagnosticsFromProfile>[0]["profile"];
};

type PhaseEstimate = {
  expectedSeconds: number;
  label: string;
  activeDetail: string;
};

const PHASE_ESTIMATES: Record<string, PhaseEstimate> = {
  normalize: {
    expectedSeconds: 20,
    label: "Reading your files",
    activeDetail: "Indexing files and finding the usable evidence.",
  },
  understand: {
    expectedSeconds: 330,
    label: "Finding the story",
    activeDetail: "Inspecting the data and working out the commercial angle.",
  },
  author: {
    expectedSeconds: 900,
    label: "Designing the deck",
    activeDetail: "Writing the first full draft and building the charts.",
  },
  render: {
    expectedSeconds: 20,
    label: "Reviewing and exporting",
    activeDetail: "Collecting the generated deck artifacts.",
  },
  critique: {
    expectedSeconds: 45,
    label: "Reviewing and exporting",
    activeDetail: "Draft complete. Running visual review.",
  },
  revise: {
    expectedSeconds: 480,
    label: "Reviewing and exporting",
    activeDetail: "Repairing weak slides, chart fit, and formatting problems.",
  },
  export: {
    expectedSeconds: 30,
    label: "Reviewing and exporting",
    activeDetail: "Deck repaired. Final export checks in progress.",
  },
};
const WORKER_STALE_RUN_SECONDS = Number.parseInt(process.env.BASQUIO_WORKER_STALE_MINUTES ?? "5", 10) * 60;
const STALE_RUN_UI_SECONDS = Number.parseInt(
  process.env.BASQUIO_RUN_STALE_UI_SECONDS ?? String(Math.min(180, WORKER_STALE_RUN_SECONDS)),
  10,
);

// Event-sourced progress endpoint.
// Returns persisted run events from deck_run_events. Tool-call detail is only present when the worker emits it.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { runId } = await params;

  if (!UUID_RE.test(runId)) {
    return NextResponse.json({ error: "Invalid run ID." }, { status: 400 });
  }

  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  // Validate `after` timestamp if provided — prevent operator injection
  if (after && !ISO_TIMESTAMP_RE.test(after)) {
    return NextResponse.json({ error: "Invalid 'after' timestamp." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase configuration." }, { status: 500 });
  }

  const runs = await fetchRestRows<DeckRunRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_runs",
    query: {
      select: "id,status,author_model,current_phase,phase_started_at,failure_message,created_at,updated_at,completed_at,template_profile_id,source_file_ids,template_diagnostics,active_attempt_id,latest_attempt_id,latest_attempt_number",
      id: `eq.${runId}`,
      requested_by: `eq.${viewer.user.id}`,
      limit: "1",
    },
  }).catch(() => []);

  if (runs.length === 0) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  const run = runs[0];
  const attemptId = run.active_attempt_id ?? run.latest_attempt_id;

  const [attempts, activeRequests] = await Promise.all([
    attemptId
      ? fetchRestRows<DeckRunAttemptRow>({
          supabaseUrl,
          serviceKey,
          table: "deck_run_attempts",
          query: {
            select: "id,updated_at,last_meaningful_event_at",
            id: `eq.${attemptId}`,
            limit: "1",
          },
        }).catch(() => [])
      : Promise.resolve([]),
    attemptId && run.current_phase
      ? fetchRestRows<DeckRunRequestUsageRow>({
          supabaseUrl,
          serviceKey,
          table: "deck_run_request_usage",
          query: {
            select: "started_at,completed_at",
            attempt_id: `eq.${attemptId}`,
            phase: `eq.${run.current_phase}`,
            request_kind: "eq.phase_generation",
            completed_at: "is.null",
            order: "started_at.desc",
            limit: "1",
          },
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const events = await fetchRestRows<DeckRunEventRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_run_events",
    query: {
      select: "id,attempt_id,attempt_number,phase,event_type,tool_name,payload,created_at",
      run_id: `eq.${runId}`,
      ...(attemptId ? { attempt_id: `eq.${attemptId}` } : {}),
      ...(after ? { created_at: `gt.${after}` } : {}),
      order: "created_at.asc",
      limit: String(limit),
    },
  }).catch(() => null);

  if (!events) {
    return NextResponse.json({ error: "Failed to fetch run." }, { status: 500 });
  }

  const summaryEvents = await fetchRestRows<DeckRunEventRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_run_events",
    query: {
      select: "id,attempt_id,attempt_number,phase,event_type,tool_name,payload,created_at",
      run_id: `eq.${runId}`,
      ...(attemptId ? { attempt_id: `eq.${attemptId}` } : {}),
      order: "created_at.asc",
      limit: "500",
    },
  }).catch(() => events);

  const phases = [...V2_PHASES];
  const completedPhases = summaryEvents
    .filter((e) => e.event_type === "phase_completed")
    .map((e) => e.phase)
    .filter((phase): phase is string => Boolean(phase));

  const completedPhaseSet = new Set(completedPhases);
  const currentPhase = run.current_phase ?? (completedPhaseSet.size > 0 ? undefined : V2_PHASES[0]);
  const toolCalls = summaryEvents.filter((e) => e.event_type === "tool_call");
  const lastToolCall = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;
  const now = Date.now();
  const createdAtMs = new Date(run.created_at).getTime();
  const attempt = attempts[0];
  const updatedAtMs = run.updated_at ? new Date(run.updated_at).getTime() : createdAtMs;
  const attemptUpdatedAtMs = attempt?.updated_at ? new Date(attempt.updated_at).getTime() : updatedAtMs;
  const activeRequest = activeRequests[0];
  const hasActiveRequest = run.status === "running" && Boolean(activeRequest);
  const completedAtMs = run.completed_at ? new Date(run.completed_at).getTime() : null;
  const elapsedToMs = run.status === "completed" && completedAtMs ? completedAtMs : now;
  const elapsedSeconds = Math.max(1, Math.round((elapsedToMs - createdAtMs) / 1000));
  const heartbeatLate = run.status === "running" && now - attemptUpdatedAtMs > STALE_RUN_UI_SECONDS * 1000;
  const recoveryEligibleStale = run.status === "running" && !hasActiveRequest && now - attemptUpdatedAtMs > WORKER_STALE_RUN_SECONDS * 1000;
  const progressClockMs = heartbeatLate ? attemptUpdatedAtMs : now;
  const progressModel = buildPhaseProgressModel({
    phases: V2_PHASES,
    currentPhase,
    completedPhases: completedPhaseSet,
    phaseStartedAt: run.phase_started_at,
    nowMs: progressClockMs,
  });
  const estimatedRemaining = estimateRemainingSecondsForPhase({
    phases: V2_PHASES,
    currentPhase,
    completedPhases: completedPhaseSet,
    elapsedInPhaseSeconds: progressModel.elapsedInPhaseSeconds,
  });
  const templateDiagnostics = await resolveTemplateDiagnostics(supabaseUrl, serviceKey, run);
  const phaseMeta = PHASE_ESTIMATES[currentPhase ?? V2_PHASES[0]] ?? PHASE_ESTIMATES.normalize;

  const progressPct = run.status === "completed"
    ? 100
    : run.status === "failed"
      ? Math.max(2, Math.round((completedPhaseSet.size / phases.length) * 100))
      : Math.max(2, Math.min(96, Math.round(progressModel.progressPercent)));

  const currentDetail = lastToolCall?.tool_name
    ? `${phaseMeta.activeDetail} Tool in use: ${lastToolCall.tool_name}.`
    : recoveryEligibleStale
      ? "This run stopped heartbeating and looks stalled. Basquio is trying to recover it automatically."
    : heartbeatLate
      ? `This run has not heartbeated recently. Automatic recovery starts after ${Math.round(WORKER_STALE_RUN_SECONDS / 60)} minutes without progress.`
    : run.status === "failed"
      ? run.failure_message ?? "Run failed."
      : run.status === "completed"
        ? "Generation finished."
        : phaseMeta.activeDetail;

  return NextResponse.json({
    runId: run.id,
    attemptNumber: run.latest_attempt_number ?? 1,
    activeAttemptId: attemptId,
    status: run.status,
    currentPhase: currentPhase ?? null,
    runHealth: recoveryEligibleStale ? "stale" : heartbeatLate ? "late_heartbeat" : "healthy",
    currentStageLabel: phaseMeta.label,
    currentDetail,
    progressPct,
    progressPercent: progressPct,
    elapsedSeconds,
    estimatedRemainingSeconds: run.status === "completed" || run.status === "failed"
      ? 0
      : estimatedRemaining.midpointSeconds,
    estimatedRemainingLowSeconds: run.status === "completed" || run.status === "failed"
      ? 0
      : estimatedRemaining.lowSeconds,
    estimatedRemainingHighSeconds: run.status === "completed" || run.status === "failed"
      ? 0
      : estimatedRemaining.highSeconds,
    estimatedRemainingConfidence: run.status === "completed" || run.status === "failed"
      ? "high"
      : estimatedRemaining.confidence,
    completedPhases,
    templateDiagnostics,
    lastToolCall: lastToolCall
      ? {
          phase: lastToolCall.phase,
          tools: lastToolCall.payload?.tools ?? [],
          stepNumber: lastToolCall.payload?.stepNumber,
          at: lastToolCall.created_at,
        }
      : null,
    events: events.map((e: Record<string, unknown>) => ({
      id: e.id,
      phase: e.phase,
      eventType: e.event_type,
      toolName: e.tool_name,
      payload: e.payload,
      createdAt: e.created_at,
    })),
    hasMore: events.length === limit,
  });
}

async function resolveTemplateDiagnostics(
  supabaseUrl: string,
  serviceKey: string,
  run: DeckRunRow,
): Promise<TemplateDiagnostics> {
  if (isTemplateDiagnostics(run.template_diagnostics)) {
    return run.template_diagnostics;
  }

  if (!run.template_profile_id) {
    return buildNoTemplateDiagnostics();
  }

  const profiles = await fetchRestRows<TemplateProfileRow>({
    supabaseUrl,
    serviceKey,
    table: "template_profiles",
    query: {
      select: "source_file_id,template_profile",
      id: `eq.${run.template_profile_id}`,
      limit: "1",
    },
  }).catch(() => []);

  const profile = profiles[0];
  if (!profile?.template_profile) {
    return {
      ...buildNoTemplateDiagnostics(),
      status: "fallback_default",
      source: "saved_profile",
      reason: "missing_template_profile",
      templateProfileId: run.template_profile_id,
      templateName: null,
    };
  }

  return buildTemplateDiagnosticsFromProfile({
    profile: profile.template_profile,
    source: profile.source_file_id && run.source_file_ids.includes(profile.source_file_id)
      ? "uploaded_file"
      : "saved_profile",
    templateProfileId: run.template_profile_id,
  });
}
