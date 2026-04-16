import { NextResponse } from "next/server";
import { BASQUIO_PHASES } from "@basquio/core";
import { classifyFailureMessage as classifyFailureMessageShared } from "@basquio/workflows/failure-classifier";
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
  active_attempt_id: string | null;
  latest_attempt_id: string | null;
  latest_attempt_number: number;
  cost_telemetry: Record<string, unknown> | null;
  notify_on_complete: boolean;
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

type DeckRunAttemptHealthRow = {
  id: string;
  status: string;
  updated_at: string | null;
  last_meaningful_event_at: string | null;
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
  preview_assets?: Array<{
    position: number;
    fileName: string;
    mimeType: string;
    storagePath: string;
    fileBytes?: number;
    checksumSha256?: string;
  }>;
};

type SourceFileSummaryRow = {
  id: string;
  kind: string;
  file_name: string;
};

type AttemptCostSummaryRow = {
  id: string;
  attempt_number: number;
  status: string;
  failure_phase: string | null;
  recovery_reason: string | null;
  cost_telemetry: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
};

function collectQualityWarnings(costTelemetry: Record<string, unknown> | null) {
  const phases = costTelemetry && typeof costTelemetry.phases === "object" && costTelemetry.phases
    ? costTelemetry.phases as Record<string, unknown>
    : null;
  const finalLint = phases && typeof phases.finalLint === "object" && phases.finalLint
    ? phases.finalLint as Record<string, unknown>
    : null;
  const publishDecision = phases && typeof phases.publishDecision === "object" && phases.publishDecision
    ? phases.publishDecision as Record<string, unknown>
    : null;

  const lintIssues = Array.isArray(finalLint?.actionableIssues)
    ? finalLint.actionableIssues.filter((issue): issue is string => typeof issue === "string")
    : [];
  const advisoryIssues = Array.isArray(publishDecision?.advisories)
    ? publishDecision.advisories.filter((issue): issue is string => typeof issue === "string")
    : [];

  return [...new Set([...lintIssues, ...advisoryIssues])];
}

function buildCustomerPreviewAssets(
  jobId: string,
  previewAssets: ArtifactManifestRow["preview_assets"],
) {
  if (!Array.isArray(previewAssets)) {
    return [];
  }

  const normalized = previewAssets
    .filter((asset): asset is NonNullable<ArtifactManifestRow["preview_assets"]>[number] =>
      typeof asset?.position === "number" &&
      typeof asset?.fileName === "string" &&
      asset.fileName.length > 0,
    )
    .slice(0, 3)
    .map((asset) => ({
      position: asset.position,
      imageUrl: `/api/jobs/${jobId}/previews/${asset.position}`,
      fileName: asset.fileName,
      fileBytes: typeof asset.fileBytes === "number" ? asset.fileBytes : null,
      checksumSha256: typeof asset.checksumSha256 === "string" ? asset.checksumSha256 : null,
    }));

  if (normalized.length === 0) {
    return [];
  }

  const distinctChecksums = new Set(
    normalized
      .map((asset) => asset.checksumSha256)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const largestPreviewBytes = normalized.reduce((max, asset) => Math.max(max, asset.fileBytes ?? 0), 0);
  const placeholderLike = (normalized.length > 1 && distinctChecksums.size <= 1) || largestPreviewBytes < 15_000;

  return placeholderLike ? [] : normalized;
}

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
    stepIndex: 2,
    label: "Designing the deck",
    activeDetail: "Collecting the generated deck artifacts.",
    completedDetail: "Artifacts collected.",
  },
  critique: {
    expectedSeconds: 45,
    stepIndex: 3,
    label: "Reviewing and polishing",
    activeDetail: "Draft complete. Running visual review.",
    completedDetail: "Rendered pages reviewed.",
  },
  revise: {
    expectedSeconds: 480,
    stepIndex: 3,
    label: "Reviewing and polishing",
    activeDetail: "Repairing weak slides, chart fit, and formatting problems.",
    completedDetail: "Deck repaired.",
  },
  export: {
    expectedSeconds: 30,
    stepIndex: 4,
    label: "Exporting",
    activeDetail: "Deck repaired. Final export checks in progress.",
    completedDetail: "Downloads published.",
  },
};
const WORKER_STALE_RUN_SECONDS = Number.parseInt(process.env.BASQUIO_WORKER_STALE_MINUTES ?? "8", 10) * 60;
const STALE_RUN_UI_SECONDS = Number.parseInt(
  process.env.BASQUIO_RUN_STALE_UI_SECONDS ?? String(Math.min(180, WORKER_STALE_RUN_SECONDS)),
  10,
);

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
      select: "id,status,author_model,current_phase,phase_started_at,failure_message,created_at,updated_at,completed_at,brief,business_context,client,audience,objective,thesis,stakes,template_profile_id,source_file_ids,template_diagnostics,active_attempt_id,latest_attempt_id,latest_attempt_number,cost_telemetry,notify_on_complete",
      id: `eq.${jobId}`,
      requested_by: `eq.${viewerId}`,
      limit: "1",
    },
  }).catch(() => []);

  if (runs.length === 0) {
    return null;
  }

  const run = runs[0];
  const rawStatus = (run.completed_at ? "completed" : run.status) as DeckRunRow["status"];
  const attemptId = run.active_attempt_id ?? run.latest_attempt_id;
  const needsInputSummary = rawStatus === "failed" || rawStatus === "completed";
  const [sourceFiles, summaryEvents, templateDiagnostics, attemptProgressRows] = await Promise.all([
    needsInputSummary
      ? loadSourceFileSummaries(supabaseUrl, serviceKey, run.source_file_ids)
      : Promise.resolve([]),
    fetchRestRows<DeckRunEventRow>({
      supabaseUrl,
      serviceKey,
      table: "deck_run_events",
      query: {
        select: "id,attempt_id,attempt_number,phase,event_type,tool_name,payload,created_at",
        run_id: `eq.${jobId}`,
        ...(attemptId ? { attempt_id: `eq.${attemptId}` } : {}),
        order: "created_at.asc",
        limit: "500",
      },
    }).catch(() => []),
    resolveTemplateDiagnostics(supabaseUrl, serviceKey, run),
    attemptId
      ? fetchRestRows<DeckRunAttemptHealthRow>({
          supabaseUrl,
          serviceKey,
          table: "deck_run_attempts",
          query: {
            select: "id,status,updated_at,last_meaningful_event_at",
            id: `eq.${attemptId}`,
            limit: "1",
          },
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

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
  const elapsedToMs = rawStatus === "completed" && completedAtMs ? completedAtMs : now;
  const elapsedSeconds = Math.max(1, Math.round((elapsedToMs - createdAtMs) / 1000));
  const attemptProgressRow = attemptProgressRows[0] ?? null;
  const meaningfulProgressAt = attemptProgressRow?.last_meaningful_event_at ?? attemptProgressRow?.updated_at ?? run.updated_at;
  const meaningfulProgressAtMs = meaningfulProgressAt ? new Date(meaningfulProgressAt).getTime() : updatedAtMs;
  const heartbeatLate = rawStatus === "running" && now - meaningfulProgressAtMs > STALE_RUN_UI_SECONDS * 1000;
  const recoveryEligibleStale = rawStatus === "running" && now - meaningfulProgressAtMs > WORKER_STALE_RUN_SECONDS * 1000;
  const progressClockMs = heartbeatLate ? meaningfulProgressAtMs : now;
  const progressModel = buildPhaseProgressModel({
    phases: V2_PHASES,
    currentPhase,
    completedPhases,
    phaseStartedAt: run.phase_started_at,
    nowMs: progressClockMs,
  });
  const estimatedRemaining = estimateRemainingSecondsForPhase({
    phases: V2_PHASES,
    currentPhase,
    completedPhases,
    elapsedInPhaseSeconds: progressModel.elapsedInPhaseSeconds,
  });

  let progressPercent: number;
  if (rawStatus === "completed") {
    progressPercent = 100;
  } else if (rawStatus === "failed") {
    progressPercent = Math.max(2, Math.round((completedPhases.size / V2_PHASES.length) * 100));
  } else {
    progressPercent = Math.max(2, Math.min(96, Math.round(progressModel.progressPercent)));
  }
  const lastToolCall = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;
  const phaseMeta = PHASE_ESTIMATES[currentPhase ?? V2_PHASES[0]] ?? PHASE_ESTIMATES.normalize;

  const steps = V2_PHASES.map((phase, index) => {
    let status: "queued" | "running" | "completed" | "failed";
    if (completedPhases.has(phase)) {
      status = "completed";
    } else if (run.current_phase === phase) {
      status = rawStatus === "failed" ? "failed" : "running";
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
      attempt: run.latest_attempt_number ?? 1,
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

  const isTransientRecovery = rawStatus === "queued" && run.latest_attempt_number > 1;
  const currentDetail = lastToolCall?.tool_name
    ? `${phaseMeta.activeDetail} Tool in use: ${lastToolCall.tool_name}.`
    : recoveryEligibleStale
      ? "This run stopped heartbeating and looks stalled. Basquio is trying to recover it automatically."
    : heartbeatLate
      ? `This run has not heartbeated recently. Automatic recovery starts after ${Math.round(WORKER_STALE_RUN_SECONDS / 60)} minutes without progress.`
    : isTransientRecovery
      ? `Retrying automatically after a temporary service issue. Attempt ${run.latest_attempt_number}.`
    : rawStatus === "failed"
        ? run.failure_message ?? "Run failed."
        : rawStatus === "completed"
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
  const failureGuidance = buildFailureGuidance(run, sourceFiles, recoveryEligibleStale);
  const failureClassification = rawStatus === "failed" || recoveryEligibleStale
    ? classifyFailure(run, recoveryEligibleStale)
    : undefined;

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
  let attemptSummaries: Array<Record<string, unknown>> = [];
  if (rawStatus === "completed") {
    const [manifests, attemptRows] = await Promise.all([
      fetchRestRows<ArtifactManifestRow>({
        supabaseUrl: supabaseUrl!,
        serviceKey: serviceKey!,
        table: "artifact_manifests_v2",
        query: {
          select: "slide_count,page_count,qa_passed,artifacts,preview_assets",
          run_id: `eq.${jobId}`,
          limit: "1",
        },
      }).catch(() => []),
      fetchRestRows<AttemptCostSummaryRow>({
        supabaseUrl: supabaseUrl!,
        serviceKey: serviceKey!,
        table: "deck_run_attempts",
        query: {
          select: "id,attempt_number,status,failure_phase,recovery_reason,cost_telemetry,started_at,completed_at",
          run_id: `eq.${jobId}`,
          order: "attempt_number.asc",
          limit: "10",
        },
      }).catch(() => []),
    ]);

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
        previews: buildCustomerPreviewAssets(jobId, m.preview_assets),
      };
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

    attemptSummaries = attemptRows.map((row) => ({
      id: row.id,
      attemptNumber: row.attempt_number,
      status: row.status,
      failurePhase: row.failure_phase,
      recoveryReason: row.recovery_reason,
      estimatedCostUsd: typeof row.cost_telemetry?.estimatedCostUsd === "number"
        ? row.cost_telemetry.estimatedCostUsd
        : null,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }));
  }

  if (rawStatus === "failed") {
    const attemptRows = await fetchRestRows<AttemptCostSummaryRow>({
      supabaseUrl: supabaseUrl!,
      serviceKey: serviceKey!,
      table: "deck_run_attempts",
      query: {
        select: "id,attempt_number,status,failure_phase,recovery_reason,cost_telemetry,started_at,completed_at",
        run_id: `eq.${jobId}`,
        order: "attempt_number.asc",
        limit: "10",
      },
    }).catch(() => []);

    attemptSummaries = attemptRows.map((row) => ({
      id: row.id,
      attemptNumber: row.attempt_number,
      status: row.status,
      failurePhase: row.failure_phase,
      recoveryReason: row.recovery_reason,
      estimatedCostUsd: typeof row.cost_telemetry?.estimatedCostUsd === "number"
        ? row.cost_telemetry.estimatedCostUsd
        : null,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }));
  }

  return {
    jobId,
    authorModel: run.author_model ?? "claude-sonnet-4-6",
    attemptNumber: run.latest_attempt_number ?? 1,
    activeAttemptId: attemptId,
    pipelineVersion: "v2" as const,
    status: (isTransientRecovery ? "running" : rawStatus) as "queued" | "running" | "completed" | "failed",
    artifactsReady: Boolean(summary && Array.isArray(summary.artifacts) && (summary.artifacts as unknown[]).length > 0),
    createdAt: run.created_at,
    updatedAt: run.updated_at ?? undefined,
    currentStage: currentPhase ?? V2_PHASES[0],
    currentStageLabel: phaseMeta.label,
    currentDetail,
    progressPercent,
    elapsedSeconds,
    estimatedRemainingSeconds: rawStatus === "completed" || rawStatus === "failed" ? 0 : estimatedRemaining.midpointSeconds,
    estimatedRemainingLowSeconds: rawStatus === "completed" || rawStatus === "failed" ? 0 : estimatedRemaining.lowSeconds,
    estimatedRemainingHighSeconds: rawStatus === "completed" || rawStatus === "failed" ? 0 : estimatedRemaining.highSeconds,
    estimatedRemainingConfidence: rawStatus === "completed" || rawStatus === "failed" ? "high" : estimatedRemaining.confidence,
    steps,
    summary,
    templateDiagnostics,
    costTelemetry: run.cost_telemetry,
    qualityWarnings: collectQualityWarnings(run.cost_telemetry),
    attemptSummaries: attemptSummaries.length > 0 ? attemptSummaries : undefined,
    notifyOnComplete: run.notify_on_complete,
    failureMessage: run.failure_message ?? undefined,
    failureClassification,
    toolCallCount: toolCalls.length,
    runHealth: recoveryEligibleStale ? "stale" : isTransientRecovery ? "recovering" : heartbeatLate ? "late_heartbeat" : "healthy",
    templateMode: (run.cost_telemetry as Record<string, unknown>)?.templateMode ?? null,
  };
}

async function loadSourceFileSummaries(
  supabaseUrl: string,
  serviceKey: string,
  sourceFileIds: string[],
) {
  const uniqueIds = [...new Set(sourceFileIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  return fetchRestRows<SourceFileSummaryRow>({
    supabaseUrl,
    serviceKey,
    table: "source_files",
    query: {
      select: "id,kind,file_name",
      id: `in.(${uniqueIds.join(",")})`,
      limit: String(uniqueIds.length),
    },
  })
    .then((rows) => {
      const byId = new Map(rows.map((row) => [row.id, row]));
      return uniqueIds.map((id) => byId.get(id) ?? null).filter((row): row is SourceFileSummaryRow => row !== null);
    })
    .catch(() => []);
}

// B: Unified failure classification — uses the canonical classifier from the workflow layer
function classifyFailure(run: DeckRunRow, isStale: boolean) {
  // Dynamic import would be cleaner, but this is a Next.js API route —
  // inline the call to the shared classifier
  return classifyFailureMessageShared(run.failure_message ?? "", isStale);
}

function buildFailureGuidance(
  run: DeckRunRow,
  sourceFiles: SourceFileSummaryRow[],
  isStale: boolean,
) {
  const guidance: string[] = [];
  const hasWorkbookEvidence = sourceFiles.some((file) => file.kind === "workbook");

  if (isStale) {
    guidance.push(`This run stopped heartbeating and looks stalled. Basquio should requeue stale runs automatically after about ${Math.round(WORKER_STALE_RUN_SECONDS / 60)} minutes without progress.`);
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
