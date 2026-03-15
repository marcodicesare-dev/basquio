import {
  BASQUIO_PIPELINE_STAGES,
  BASQUIO_PIPELINE_STAGE_WEIGHTS,
} from "@basquio/core";
import {
  generationRunSummarySchema,
  type GenerationJobStatus,
  type GenerationRequest,
  type GenerationRunSummary,
} from "@basquio/types";

import { loadPersistedGenerationRequest } from "@/lib/generation-requests";
import { getDurableArtifactAvailability, getGenerationRun } from "@/lib/job-runs";
import { fetchRestRows } from "@/lib/supabase/admin";

type JobRow = {
  id: string;
  job_key: string;
  status: GenerationJobStatus;
  created_at?: string;
  updated_at?: string;
  execution_heartbeat_at?: string;
  failure_message?: string | null;
  summary?: unknown;
};

type StepRow = {
  stage: string;
  status: GenerationJobStatus;
  detail?: string;
  started_at?: string | null;
  completed_at?: string | null;
  payload?: Record<string, unknown>;
};

export type GenerationStepSnapshot = {
  stage: string;
  baseStage: string;
  attempt: number;
  status: GenerationJobStatus;
  detail: string;
  startedAt?: string;
  completedAt?: string;
};

export type GenerationStatusSnapshot = {
  jobId: string;
  status: GenerationJobStatus | "queued";
  artifactsReady: boolean;
  createdAt: string;
  updatedAt?: string;
  currentStage: string;
  currentDetail: string;
  progressPercent: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number | null;
  steps: GenerationStepSnapshot[];
  summary: GenerationRunSummary | null;
  failureMessage?: string;
};

export async function getGenerationStatus(jobId: string, viewerId?: string): Promise<GenerationStatusSnapshot | null> {
  const credentials = getSupabaseCredentials();

  if (!credentials) {
    const fallbackContext = await loadFallbackContext(jobId);
    return buildFallbackSnapshot(jobId, fallbackContext);
  }

  const jobs = await fetchRestRows<JobRow>({
    ...credentials,
    table: "generation_jobs",
    query: {
      select: "id,job_key,status,created_at,updated_at,execution_heartbeat_at,failure_message,summary",
      job_key: `eq.${jobId}`,
      ...(viewerId ? { requested_by: `eq.${viewerId}` } : {}),
      limit: "1",
    },
  }).catch(() => []);

  const job = jobs[0];
  if (!job) {
    const fallbackContext = await loadFallbackContext(jobId);
    return buildFallbackSnapshot(jobId, fallbackContext);
  }

  const stepRows = await fetchRestRows<StepRow>({
    ...credentials,
    table: "generation_job_steps",
    query: {
      select: "stage,status,detail,started_at,completed_at,payload",
      job_id: `eq.${job.id}`,
      limit: "100",
    },
  }).catch(() => []);

  const steps = stepRows
    .map((step) => {
      const { baseStage, attempt } = normalizeStage(step.stage);
      return {
        stage: step.stage,
        baseStage,
        attempt,
        status: step.status,
        detail: step.detail ?? "",
        startedAt: step.started_at ?? undefined,
        completedAt: step.completed_at ?? undefined,
      } satisfies GenerationStepSnapshot;
    })
    .sort((left, right) => {
      const stageDiff = pipelineIndex(left.baseStage) - pipelineIndex(right.baseStage);
      if (stageDiff !== 0) {
        return stageDiff;
      }
      return left.attempt - right.attempt;
    });

  const summary = parseSummary(job.summary);
  const hasCompletedArtifactDeliveryStep = steps.some(
    (step) => step.baseStage === "artifact qa and delivery" && step.status === "completed",
  );
  const completionWasClaimed =
    job.status === "completed" ||
    summary?.status === "completed" ||
    hasCompletedArtifactDeliveryStep;
  const artifactAvailability = completionWasClaimed
    ? await getDurableArtifactAvailability(jobId, viewerId)
    : {
        ready: false,
        artifacts: [],
        expectedKinds: ["pptx", "pdf"] as const,
        missingKinds: ["pptx", "pdf"] as const,
      };
  const derivedStatus = deriveJobStatus(job.status, steps, summary, artifactAvailability.ready);
  const isArtifactFinalizing = completionWasClaimed && !artifactAvailability.ready;
  const currentStep =
    [...steps].reverse().find((step) => step.status === "running") ??
    [...steps].reverse().find((step) => step.status === "needs_input" || step.status === "failed") ??
    [...steps].reverse().find((step) => step.status === "completed") ??
    null;
  const createdAt = job.created_at ?? summary?.createdAt ?? new Date().toISOString();
  const updatedAt = latestObservedAt(steps, job);
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));
  const progressPercent = computeProgressPercent(steps, summary, derivedStatus);
  const hasNoCheckpoints = steps.length === 0 && !summary;
  const isStaleQueuedKickoff = derivedStatus === "queued" && hasNoCheckpoints && elapsedSeconds >= 45;
  const isStaleRunningExecution = derivedStatus === "running" && hasNoCheckpoints && elapsedSeconds >= 45;
  const estimatedRemainingSeconds =
    derivedStatus === "completed" || progressPercent >= 99
      ? 0
      : progressPercent > 8
        ? Math.max(5, Math.round((elapsedSeconds / progressPercent) * (100 - progressPercent)))
        : null;

  return {
    jobId,
    status: derivedStatus,
    artifactsReady: artifactAvailability.ready,
    createdAt,
    updatedAt,
    currentStage: isArtifactFinalizing
      ? "artifact qa and delivery"
      : currentStep?.baseStage ??
        (summary?.status === "completed" && artifactAvailability.ready ? "completed" : BASQUIO_PIPELINE_STAGES[0]),
    currentDetail:
      (isArtifactFinalizing
        ? buildArtifactFinalizingDetail(artifactAvailability.missingKinds)
        : currentStep?.detail) ||
      job.failure_message ||
      (summary?.status === "completed" && artifactAvailability.ready
        ? "Artifacts are ready."
        : isStaleRunningExecution
          ? "The run was marked in flight, but no durable stage checkpoints appeared. Basquio is attempting to reattach execution for this job."
          : isStaleQueuedKickoff
            ? "The run is still queued and no durable workflow checkpoints have appeared yet. Basquio is attempting a recovery dispatch."
            : "Basquio is preparing the evidence package and orchestration state."),
    progressPercent: isArtifactFinalizing ? Math.min(progressPercent, 99) : progressPercent,
    elapsedSeconds,
    estimatedRemainingSeconds: isArtifactFinalizing ? null : estimatedRemainingSeconds,
    steps,
    summary,
    failureMessage: job.failure_message ?? (summary?.failureMessage || undefined),
  };
}

function deriveJobStatus(
  jobStatus: GenerationJobStatus,
  steps: GenerationStepSnapshot[],
  summary: GenerationRunSummary | null,
  artifactsReady: boolean,
): GenerationJobStatus {
  if (summary?.status === "completed") {
    return artifactsReady ? "completed" : "running";
  }

  if (summary?.status) {
    return summary.status;
  }

  const latestRunning = [...steps].reverse().find((step) => step.status === "running");
  if (latestRunning) {
    return "running";
  }

  const latestNeedsInput = [...steps].reverse().find((step) => step.status === "needs_input");
  if (latestNeedsInput) {
    return "needs_input";
  }

  const latestFailed = [...steps].reverse().find((step) => step.status === "failed");
  if (latestFailed) {
    return "failed";
  }

  if (jobStatus === "completed") {
    return artifactsReady ? "completed" : "running";
  }

  return jobStatus ?? "queued";
}

function latestObservedAt(steps: GenerationStepSnapshot[], job: Pick<JobRow, "updated_at" | "execution_heartbeat_at" | "created_at">) {
  return [job.execution_heartbeat_at, job.updated_at, job.created_at]
    .concat(steps.flatMap((step) => [step.startedAt, step.completedAt]))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

async function loadFallbackContext(jobId: string) {
  const [request, summary] = await Promise.all([
    loadPersistedGenerationRequest(jobId),
    getGenerationRun(jobId),
  ]);

  return { request, summary };
}

function buildFallbackSnapshot(
  jobId: string,
  fallback:
    | {
    request: GenerationRequest | null;
    summary: GenerationRunSummary | null;
      }
    | null,
): GenerationStatusSnapshot | null {
  if (!fallback) {
    return null;
  }

  if (fallback.summary) {
    return buildSummarySnapshot(jobId, fallback.summary);
  }

  if (fallback.request) {
    return buildQueuedSnapshot(jobId);
  }

  return null;
}

function buildSummarySnapshot(jobId: string, summary: GenerationRunSummary): GenerationStatusSnapshot {
  const artifactsReady = summary.status === "completed" ? summary.artifacts.every((artifact) => artifact.exists) : false;
  const status = deriveSummaryStatus(summary, artifactsReady);
  const createdAt = summary.createdAt || deriveCreatedAt(jobId);
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));
  const steps = buildSyntheticStepsFromSummary(summary, createdAt);

  return {
    jobId,
    status,
    artifactsReady,
    createdAt,
    updatedAt: createdAt,
    currentStage:
      summary.status === "completed" && !artifactsReady ? "artifact qa and delivery" : summary.status === "completed" ? "completed" : lastStageFromSummary(summary),
    currentDetail:
      summary.status === "completed" && artifactsReady
        ? "Artifacts are ready."
        : summary.status === "completed"
          ? buildArtifactFinalizingDetail(["pptx", "pdf"])
        : summary.failureMessage || "Basquio recorded the run summary and is recovering the live state.",
    progressPercent: summary.status === "completed" && artifactsReady ? 100 : 96,
    elapsedSeconds,
    estimatedRemainingSeconds: summary.status === "completed" && artifactsReady ? 0 : null,
    steps,
    summary,
    failureMessage: summary.failureMessage || undefined,
  };
}

function buildQueuedSnapshot(jobId: string): GenerationStatusSnapshot {
  const createdAt = deriveCreatedAt(jobId);
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));
  const isStalled = elapsedSeconds >= 45;

  return {
    jobId,
    status: "queued",
    artifactsReady: false,
    createdAt,
    updatedAt: createdAt,
    currentStage: BASQUIO_PIPELINE_STAGES[0],
    currentDetail:
      isStalled
        ? "The run is still queued and no durable workflow checkpoints have appeared yet. This usually means the background kickoff path has not attached successfully, so Basquio is attempting a recovery dispatch."
        : "Basquio accepted the run and is waiting for the first durable workflow checkpoint.",
    progressPercent: 2,
    elapsedSeconds,
    estimatedRemainingSeconds: null,
    steps: [],
    summary: null,
    failureMessage: undefined,
  };
}

function computeProgressPercent(
  steps: GenerationStepSnapshot[],
  summary: GenerationRunSummary | null,
  status: GenerationJobStatus,
) {
  if (summary?.status === "completed" || status === "completed") {
    return 100;
  }

  const totalWeight = BASQUIO_PIPELINE_STAGES.reduce(
    (total, stage) => total + (BASQUIO_PIPELINE_STAGE_WEIGHTS[stage] ?? 1),
    0,
  );
  const bestPerStage = new Map<string, GenerationStepSnapshot>();

  for (const step of steps) {
    const current = bestPerStage.get(step.baseStage);
    if (!current || step.attempt >= current.attempt) {
      bestPerStage.set(step.baseStage, step);
    }
  }

  let completeWeight = 0;

  for (const stage of BASQUIO_PIPELINE_STAGES) {
    const step = bestPerStage.get(stage);
    const weight = BASQUIO_PIPELINE_STAGE_WEIGHTS[stage] ?? 1;
    if (!step) {
      continue;
    }
    if (step.status === "completed") {
      completeWeight += weight;
    } else if (step.status === "running") {
      completeWeight += weight * 0.55;
    } else if (step.status === "needs_input" || step.status === "failed") {
      completeWeight += weight * 0.9;
    }
  }

  return Math.max(2, Math.min(99, Math.round((completeWeight / totalWeight) * 100)));
}

function normalizeStage(stage: string) {
  const attemptMatch = stage.match(/\(attempt (\d+)\)$/);
  return {
    baseStage: stage.replace(/\s*\(attempt \d+\)$/, ""),
    attempt: attemptMatch ? Number.parseInt(attemptMatch[1] ?? "1", 10) : 1,
  };
}

function pipelineIndex(stage: string) {
  const index = BASQUIO_PIPELINE_STAGES.indexOf(stage as (typeof BASQUIO_PIPELINE_STAGES)[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function parseSummary(summary: unknown) {
  try {
    return summary ? generationRunSummarySchema.parse(summary) : null;
  } catch {
    return null;
  }
}

function lastStageFromSummary(summary: GenerationRunSummary) {
  if (summary.status === "needs_input") {
    return "targeted revision loop";
  }

  if (summary.qualityReport) {
    return "artifact qa and delivery";
  }

  if (summary.validationReport) {
    return summary.validationReport.status === "passed" ? "render pdf" : "targeted revision loop";
  }

  return BASQUIO_PIPELINE_STAGES[BASQUIO_PIPELINE_STAGES.length - 1];
}

function buildSyntheticStepsFromSummary(summary: GenerationRunSummary, createdAt: string): GenerationStepSnapshot[] {
  const terminalStage = lastStageFromSummary(summary);
  const terminalIndex = pipelineIndex(terminalStage);

  return BASQUIO_PIPELINE_STAGES.map((stage, index) => {
    const status =
      index < terminalIndex
        ? ("completed" as const)
        : index === terminalIndex
          ? (summary.status === "completed" ? "completed" : summary.status)
          : ("queued" as const);

    return {
      stage,
      baseStage: stage,
      attempt: 1,
      status,
      detail: summarizeSyntheticStageDetail(stage, status, summary),
      completedAt: status === "completed" ? createdAt : undefined,
    } satisfies GenerationStepSnapshot;
  });
}

function summarizeSyntheticStageDetail(
  stage: string,
  status: GenerationStepSnapshot["status"],
  summary: GenerationRunSummary,
) {
  if (status === "queued") {
    return "Recovered from the stored run summary.";
  }

  if (stage === "artifact qa and delivery" && summary.qualityReport) {
    return `Artifact QA finished with status ${summary.qualityReport.status}.`;
  }

  if (stage === "targeted revision loop" && summary.validationReport) {
    return summary.validationReport.status === "passed"
      ? "Validation and critique passed before rendering."
      : `Validation stopped the run at ${summary.validationReport.targetStage ?? "slides"}.`;
  }

  return "Recovered from the stored run summary.";
}

function deriveSummaryStatus(summary: GenerationRunSummary, artifactsReady: boolean): GenerationJobStatus {
  if (summary.status === "completed") {
    return artifactsReady ? "completed" : "running";
  }

  return summary.status;
}

function buildArtifactFinalizingDetail(missingKinds: readonly string[]) {
  if (missingKinds.length === 0) {
    return "Basquio is verifying the final artifact pair in durable storage.";
  }

  return `Basquio is finalizing durable artifact delivery. Waiting on ${missingKinds.join(" and ")} availability before marking the run complete.`;
}

function deriveCreatedAt(jobId: string) {
  const match = jobId.match(/^job-([0-9T-]+Z)-/);
  if (!match?.[1]) {
    return new Date().toISOString();
  }

  const normalized = match[1]
    .replace(/^(\d{4})-(\d{2})-(\d{2})T/, "$1-$2-$3T")
    .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function getSupabaseCredentials() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return {
    supabaseUrl,
    serviceKey: serviceRoleKey,
  };
}
