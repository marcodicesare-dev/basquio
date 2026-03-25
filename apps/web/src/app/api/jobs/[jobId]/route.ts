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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const V2_PHASES = BASQUIO_PHASES;

type DeckRunRow = {
  id: string;
  status: string;
  current_phase: string | null;
  phase_started_at: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  brief: Record<string, unknown> | null;
  business_context: string;
  client: string;
  audience: string;
  objective: string;
  thesis: string;
  stakes: string;
  template_profile_id: string | null;
  source_file_ids: string[];
  template_diagnostics: Record<string, unknown> | null;
};

type DeckRunEventRow = {
  id: string;
  phase: string | null;
  event_type: string;
  tool_name: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type TemplateProfileRow = {
  source_file_id: string | null;
  template_profile: Parameters<typeof buildTemplateDiagnosticsFromProfile>[0]["profile"];
};

type ArtifactManifestRow = {
  slide_count: number;
  page_count: number;
  qa_passed: boolean;
  artifacts: Array<{ kind: string; fileName: string; fileBytes: number; storagePath: string }>;
};

type SourceFileSummaryRow = {
  id: string;
  kind: string;
  file_name: string;
};

type PhaseEstimate = {
  expectedSeconds: number;
  stepIndex: number;
  label: string;
  activeDetail: string;
  completedDetail: string;
};

const PHASE_ESTIMATES: Record<string, PhaseEstimate> = {
  normalize: {
    expectedSeconds: 20,
    stepIndex: 0,
    label: "Reading your files",
    activeDetail: "Indexing files and finding the usable evidence.",
    completedDetail: "Files indexed.",
  },
  understand: {
    expectedSeconds: 330,
    stepIndex: 1,
    label: "Finding the story",
    activeDetail: "Inspecting the data and working out the commercial angle.",
    completedDetail: "Storyline approved.",
  },
  author: {
    expectedSeconds: 900,
    stepIndex: 2,
    label: "Designing the deck",
    activeDetail: "Writing the first full draft and building the charts.",
    completedDetail: "First draft generated.",
  },
  render: {
    expectedSeconds: 20,
    stepIndex: 3,
    label: "Reviewing and exporting",
    activeDetail: "Collecting the generated deck artifacts.",
    completedDetail: "Artifacts collected.",
  },
  critique: {
    expectedSeconds: 45,
    stepIndex: 3,
    label: "Reviewing and exporting",
    activeDetail: "Reviewing the rendered pages for layout and chart issues.",
    completedDetail: "Rendered pages reviewed.",
  },
  revise: {
    expectedSeconds: 480,
    stepIndex: 3,
    label: "Reviewing and exporting",
    activeDetail: "Repairing weak slides, chart fit, and formatting problems.",
    completedDetail: "Deck repaired.",
  },
  export: {
    expectedSeconds: 30,
    stepIndex: 3,
    label: "Reviewing and exporting",
    activeDetail: "Publishing the PPTX and PDF downloads.",
    completedDetail: "Downloads published.",
  },
};
const STALE_RUN_UI_SECONDS = Number.parseInt(process.env.BASQUIO_RUN_STALE_UI_SECONDS ?? "180", 10);

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
    status: snapshot.status === "running" || snapshot.status === "queued" ? 202 : 200,
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
      select: "id,status,current_phase,phase_started_at,failure_message,created_at,updated_at,completed_at,brief,business_context,client,audience,objective,thesis,stakes,template_profile_id,source_file_ids,template_diagnostics",
      id: `eq.${jobId}`,
      requested_by: `eq.${viewerId}`,
      limit: "1",
    },
  }).catch(() => []);

  if (runs.length === 0) {
    return null;
  }

  const run = runs[0];
  const needsInputSummary = run.status === "failed" || run.status === "completed" || Boolean(run.completed_at);
  const sourceFiles = needsInputSummary
    ? await loadSourceFileSummaries(supabaseUrl, serviceKey, run.source_file_ids)
    : [];

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

  const summaryEvents = await fetchRestRows<DeckRunEventRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_run_events",
    query: {
      select: "id,phase,event_type,tool_name,payload,created_at",
      run_id: `eq.${jobId}`,
      order: "created_at.asc",
      limit: "500",
    },
  }).catch(() => events);

  const completedPhases = new Set(
    summaryEvents
      .filter((e) => e.event_type === "phase_completed")
      .map((e) => e.phase)
      .filter((p): p is string => p !== null),
  );

  const currentPhase = run.current_phase ?? (completedPhases.size > 0 ? undefined : V2_PHASES[0]);
  const currentPhaseIndex = currentPhase ? V2_PHASES.indexOf(currentPhase as typeof V2_PHASES[number]) : -1;
  const toolCalls = summaryEvents.filter((e) => e.event_type === "tool_call");
  const now = Date.now();
  const createdAtMs = new Date(run.created_at).getTime();
  const updatedAtMs = run.updated_at ? new Date(run.updated_at).getTime() : createdAtMs;
  const completedAtMs = run.completed_at ? new Date(run.completed_at).getTime() : null;
  const elapsedToMs = run.status === "completed" && completedAtMs ? completedAtMs : now;
  const elapsedSeconds = Math.max(1, Math.round((elapsedToMs - createdAtMs) / 1000));
  const templateDiagnostics = await resolveTemplateDiagnostics(supabaseUrl, serviceKey, run);
  const isStale = run.status === "running" && now - updatedAtMs > STALE_RUN_UI_SECONDS * 1000;
  const progressClockMs = isStale ? updatedAtMs : now;
  const progressModel = buildProgressModel(run, currentPhase, completedPhases, progressClockMs);
  const estimatedRemaining = estimateRemainingSeconds(currentPhase, completedPhases, progressModel.elapsedInPhaseSeconds);

  let progressPercent: number;
  if (run.status === "completed") {
    progressPercent = 100;
  } else if (run.status === "failed") {
    progressPercent = Math.max(2, Math.round((completedPhases.size / V2_PHASES.length) * 100));
  } else {
    progressPercent = Math.max(2, Math.min(99, Math.round(progressModel.progressPercent)));
  }
  const lastToolCall = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;
  const phaseMeta = PHASE_ESTIMATES[currentPhase ?? V2_PHASES[0]] ?? PHASE_ESTIMATES.normalize;

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
          ? PHASE_ESTIMATES[phase]?.activeDetail ?? `Running ${phase} phase...`
          : status === "completed"
            ? PHASE_ESTIMATES[phase]?.completedDetail ?? `${phase} phase complete.`
            : "",
    };
  });

  const currentDetail = lastToolCall?.tool_name
    ? `${phaseMeta.activeDetail} Tool in use: ${lastToolCall.tool_name}.`
    : isStale
      ? "This run stopped heartbeating and looks stalled. Basquio is trying to recover it automatically."
    : run.status === "failed"
        ? run.failure_message ?? "Run failed."
        : run.status === "completed"
          ? "Generation finished. Checking artifact availability."
        : phaseMeta.activeDetail;

  const runBrief = {
    businessContext: typeof run.brief?.businessContext === "string" ? run.brief.businessContext : run.business_context,
    client: typeof run.brief?.client === "string" ? run.brief.client : run.client,
    audience: typeof run.brief?.audience === "string" ? run.brief.audience : run.audience,
    objective: typeof run.brief?.objective === "string" ? run.brief.objective : run.objective,
    thesis: typeof run.brief?.thesis === "string" ? run.brief.thesis : run.thesis,
    stakes: typeof run.brief?.stakes === "string" ? run.brief.stakes : run.stakes,
  };
  const failureGuidance = buildFailureGuidance(run, sourceFiles, isStale);

  // Fetch artifact manifest if completed
  let summary: Record<string, unknown> | null = needsInputSummary
    ? {
        brief: runBrief,
        inputs: sourceFiles.map((file) => ({
          id: file.id,
          kind: file.kind,
          fileName: file.file_name,
        })),
        templateDiagnostics,
        failureGuidance,
      }
    : null;
  if (run.status === "completed" || run.completed_at) {
    try {
      const manifests = await fetchRestRows<ArtifactManifestRow>({
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
          ...summary,
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

    // Fallback: if no manifest but slides exist, derive count from slide rows
    if (!summary || typeof summary.slideCount !== "number") {
      try {
        const slideRows = await fetchRestRows<{ id: string }>({
          supabaseUrl: supabaseUrl!,
          serviceKey: serviceKey!,
          table: "deck_spec_v2_slides",
          query: {
            select: "id",
            run_id: `eq.${jobId}`,
            limit: "50",
          },
        });
        if (slideRows.length > 0) {
          summary = {
            ...(summary ?? {}),
            slideCount: slideRows.length,
            pageCount: 0,
            qaPassed: typeof summary?.qaPassed === "boolean" ? summary.qaPassed : false,
            artifacts: Array.isArray(summary?.artifacts) ? summary.artifacts : [],
          };
        }
      } catch {
        // Slides not available
      }
    }
  }

  return {
    jobId,
    pipelineVersion: "v2" as const,
    status: run.status as "queued" | "running" | "completed" | "failed",
    artifactsReady: Boolean(summary && Array.isArray(summary.artifacts) && (summary.artifacts as unknown[]).length > 0),
    createdAt: run.created_at,
    updatedAt: run.updated_at ?? undefined,
    currentStage: currentPhase ?? V2_PHASES[0],
    currentStageLabel: phaseMeta.label,
    currentDetail,
    progressPercent,
    elapsedSeconds,
    estimatedRemainingSeconds: run.status === "completed" || run.status === "failed" ? 0 : estimatedRemaining.midpointSeconds,
    estimatedRemainingLowSeconds: run.status === "completed" || run.status === "failed" ? 0 : estimatedRemaining.lowSeconds,
    estimatedRemainingHighSeconds: run.status === "completed" || run.status === "failed" ? 0 : estimatedRemaining.highSeconds,
    estimatedRemainingConfidence: run.status === "completed" || run.status === "failed" ? "high" : estimatedRemaining.confidence,
    steps,
    summary,
    templateDiagnostics,
    failureMessage: run.failure_message ?? undefined,
    toolCallCount: toolCalls.length,
    runHealth: isStale ? "stale" : "healthy",
  };
}

async function loadSourceFileSummaries(
  supabaseUrl: string,
  serviceKey: string,
  sourceFileIds: string[],
) {
  const rows = await Promise.all(
    sourceFileIds.map(async (id) => {
      const files = await fetchRestRows<SourceFileSummaryRow>({
        supabaseUrl,
        serviceKey,
        table: "source_files",
        query: {
          select: "id,kind,file_name",
          id: `eq.${id}`,
          limit: "1",
        },
      }).catch(() => []);

      return files[0] ?? null;
    }),
  );

  return rows.filter((row): row is SourceFileSummaryRow => Boolean(row));
}

function buildFailureGuidance(
  run: DeckRunRow,
  sourceFiles: SourceFileSummaryRow[],
  isStale: boolean,
) {
  const guidance: string[] = [];
  const hasWorkbookEvidence = sourceFiles.some((file) => file.kind === "workbook");

  if (isStale) {
    guidance.push("This run stopped heartbeating and looks stalled. Basquio should requeue stale runs automatically within a few minutes.");
    guidance.push("Changing tabs did not cause this. If it does not recover, restart the run.");
    return guidance;
  }

  if (!hasWorkbookEvidence) {
    guidance.push("Basquio currently needs at least one CSV, XLSX, or XLS file as primary evidence.");
    guidance.push("Keep PPTX, PDF, images, and documents as support material or template input.");
  }

  if ((run.failure_message ?? "").includes("deck.pptx")) {
    guidance.push("The run got through planning but failed while producing the final deck artifacts.");
  }

  if (guidance.length === 0 && run.status === "failed") {
    guidance.push("Retry with the same workbook and template if this looks transient. If it repeats, remove optional support files and keep only the core workbook plus template.");
  }

  return guidance;
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

function buildProgressModel(
  run: DeckRunRow,
  currentPhase: string | undefined,
  completedPhases: Set<string>,
  now: number,
) {
  const totalExpectedSeconds = V2_PHASES.reduce((sum, phase) => sum + (PHASE_ESTIMATES[phase]?.expectedSeconds ?? 0), 0);
  const completedSeconds = V2_PHASES
    .filter((phase) => completedPhases.has(phase))
    .reduce((sum, phase) => sum + (PHASE_ESTIMATES[phase]?.expectedSeconds ?? 0), 0);
  const currentExpectedSeconds = PHASE_ESTIMATES[currentPhase ?? ""]?.expectedSeconds ?? 0;
  const phaseStartedAt = run.phase_started_at ? new Date(run.phase_started_at).getTime() : null;
  const elapsedInPhaseSeconds = phaseStartedAt
    ? Math.max(1, Math.round((now - phaseStartedAt) / 1000))
    : 0;
  const phaseFraction = currentExpectedSeconds > 0
    ? estimatePhaseFraction(elapsedInPhaseSeconds, currentExpectedSeconds)
    : 0;

  return {
    elapsedInPhaseSeconds,
    progressPercent: ((completedSeconds + currentExpectedSeconds * phaseFraction) / Math.max(totalExpectedSeconds, 1)) * 100,
  };
}

function estimatePhaseFraction(elapsedSeconds: number, expectedSeconds: number) {
  if (expectedSeconds <= 0) {
    return 0;
  }

  const ratio = elapsedSeconds / expectedSeconds;
  if (ratio <= 0.75) {
    return ratio * 0.8;
  }
  if (ratio <= 1) {
    return 0.6 + ((ratio - 0.75) / 0.25) * 0.22;
  }

  const overtime = (elapsedSeconds - expectedSeconds) / Math.max(expectedSeconds * 0.75, 60);
  return 0.82 + Math.min(0.14, 0.14 * (1 - Math.exp(-overtime)));
}

function estimateRemainingSeconds(
  currentPhase: string | undefined,
  completedPhases: Set<string>,
  elapsedInPhaseSeconds: number,
) {
  const remainingAfterCurrent = V2_PHASES
    .filter((phase) => phase !== currentPhase && !completedPhases.has(phase))
    .reduce((sum, phase) => sum + (PHASE_ESTIMATES[phase]?.expectedSeconds ?? 0), 0);
  const currentExpected = PHASE_ESTIMATES[currentPhase ?? ""]?.expectedSeconds ?? 0;

  if (!currentPhase || currentExpected <= 0) {
    return {
      midpointSeconds: remainingAfterCurrent,
      lowSeconds: Math.round(remainingAfterCurrent * 0.8),
      highSeconds: Math.round(remainingAfterCurrent * 1.25),
      confidence: "low" as const,
    };
  }

  if (elapsedInPhaseSeconds <= currentExpected * 1.1) {
    const currentRemaining = Math.max(30, Math.round(currentExpected - Math.min(elapsedInPhaseSeconds, currentExpected)));
    const midpointSeconds = currentRemaining + remainingAfterCurrent;
    return {
      midpointSeconds,
      lowSeconds: Math.max(30, Math.round(midpointSeconds * 0.7)),
      highSeconds: Math.round(midpointSeconds * 1.35),
      confidence: elapsedInPhaseSeconds < currentExpected * 0.4 ? "medium" as const : "high" as const,
    };
  }

  const midpointSeconds = Math.max(90, Math.round(currentExpected * 0.45)) + remainingAfterCurrent;
  return {
    midpointSeconds,
    lowSeconds: Math.max(60, Math.round(midpointSeconds * 0.8)),
    highSeconds: Math.round(midpointSeconds * 1.8),
    confidence: "low" as const,
  };
}
