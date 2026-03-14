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
import { getGenerationRun } from "@/lib/job-runs";
import { fetchRestRows } from "@/lib/supabase/admin";

type JobRow = {
  id: string;
  job_key: string;
  status: GenerationJobStatus;
  created_at?: string;
  updated_at?: string;
  failure_message?: string | null;
  summary?: unknown;
};

type StepRow = {
  stage: string;
  status: GenerationJobStatus;
  detail?: string;
  completed_at?: string | null;
  created_at?: string | null;
  payload?: Record<string, unknown>;
};

export type GenerationStepSnapshot = {
  stage: string;
  baseStage: string;
  attempt: number;
  status: GenerationJobStatus;
  detail: string;
  completedAt?: string;
};

export type GenerationStatusSnapshot = {
  jobId: string;
  status: GenerationJobStatus | "queued";
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

export async function getGenerationStatus(jobId: string): Promise<GenerationStatusSnapshot | null> {
  const credentials = getSupabaseCredentials();
  const fallbackContext = await loadFallbackContext(jobId);

  if (!credentials) {
    return buildFallbackSnapshot(jobId, fallbackContext);
  }

  const jobs = await fetchRestRows<JobRow>({
    ...credentials,
    table: "generation_jobs",
    query: {
      select: "id,job_key,status,created_at,updated_at,failure_message,summary",
      job_key: `eq.${jobId}`,
      limit: "1",
    },
  }).catch(() => []);

  const job = jobs[0];
  if (!job) {
    return buildFallbackSnapshot(jobId, fallbackContext);
  }

  const stepRows = await fetchRestRows<StepRow>({
    ...credentials,
    table: "generation_job_steps",
    query: {
      select: "stage,status,detail,completed_at,created_at,payload",
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
  const currentStep =
    [...steps].reverse().find((step) => step.status === "running") ??
    [...steps].reverse().find((step) => step.status === "needs_input" || step.status === "failed") ??
    [...steps].reverse().find((step) => step.status === "completed") ??
    null;
  const createdAt = job.created_at ?? summary?.createdAt ?? new Date().toISOString();
  const updatedAt = job.updated_at ?? summary?.createdAt;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));
  const progressPercent = computeProgressPercent(steps, summary, job.status);
  const estimatedRemainingSeconds =
    job.status === "completed" || progressPercent >= 99
      ? 0
      : progressPercent > 8
        ? Math.max(5, Math.round((elapsedSeconds / progressPercent) * (100 - progressPercent)))
        : null;

  return {
    jobId,
    status: summary?.status ?? job.status ?? "queued",
    createdAt,
    updatedAt,
    currentStage:
      currentStep?.baseStage ??
      (summary?.status === "completed" ? "completed" : BASQUIO_PIPELINE_STAGES[0]),
    currentDetail:
      currentStep?.detail ||
      job.failure_message ||
      (summary?.status === "completed"
        ? "Artifacts are ready."
        : "Basquio is preparing the evidence package and orchestration state."),
    progressPercent,
    elapsedSeconds,
    estimatedRemainingSeconds,
    steps,
    summary,
    failureMessage: job.failure_message ?? (summary?.failureMessage || undefined),
  };
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
  fallback: {
    request: GenerationRequest | null;
    summary: GenerationRunSummary | null;
  },
): GenerationStatusSnapshot | null {
  if (fallback.summary) {
    return buildSummarySnapshot(jobId, fallback.summary);
  }

  if (fallback.request) {
    return buildQueuedSnapshot(jobId);
  }

  return null;
}

function buildSummarySnapshot(jobId: string, summary: GenerationRunSummary): GenerationStatusSnapshot {
  const createdAt = summary.createdAt || deriveCreatedAt(jobId);
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));

  return {
    jobId,
    status: summary.status,
    createdAt,
    updatedAt: createdAt,
    currentStage: summary.status === "completed" ? "completed" : lastStageFromSummary(summary),
    currentDetail:
      summary.status === "completed"
        ? "Artifacts are ready."
        : summary.failureMessage || "Basquio recorded the run summary and is recovering the live state.",
    progressPercent: summary.status === "completed" ? 100 : 96,
    elapsedSeconds,
    estimatedRemainingSeconds: summary.status === "completed" ? 0 : null,
    steps: [],
    summary,
    failureMessage: summary.failureMessage || undefined,
  };
}

function buildQueuedSnapshot(jobId: string): GenerationStatusSnapshot {
  const createdAt = deriveCreatedAt(jobId);
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));

  return {
    jobId,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    currentStage: BASQUIO_PIPELINE_STAGES[0],
    currentDetail:
      "Basquio accepted the run, persisted the request, and is recovering the live pipeline state before the first durable checkpoint appears.",
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
  return summary.stageTraces.at(-1)?.stage || BASQUIO_PIPELINE_STAGES[BASQUIO_PIPELINE_STAGES.length - 1];
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
