import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { generationRunSummarySchema, type ArtifactRecord, type GenerationRunSummary } from "@basquio/types";

import { downloadFromStorage, fetchRestRows, listStorageObjects } from "@/lib/supabase/admin";

export async function listGenerationRuns(limit = 12, viewerId?: string): Promise<GenerationRunSummary[]> {
  const supabaseRuns = await listGenerationRunsFromSupabase(limit, viewerId);

  if (supabaseRuns.length > 0) {
    return supabaseRuns;
  }

  if (viewerId) {
    return [];
  }

  const storageRuns = await listGenerationRunsFromStorage(limit);

  if (storageRuns.length > 0) {
    return storageRuns;
  }

  const outputRoot = await resolveOutputRoot();

  if (!outputRoot) {
    return [];
  }

  const entries = await safeReadDir(outputRoot);
  const runs: GenerationRunSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const run = await getGenerationRun(entry.name);

    if (run) {
      runs.push(run);
    }
  }

  return runs
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export async function getGenerationRun(jobId: string, viewerId?: string): Promise<GenerationRunSummary | null> {
  const supabaseRun = await getGenerationRunFromSupabase(jobId, viewerId);

  if (supabaseRun) {
    return supabaseRun;
  }

  if (viewerId) {
    return null;
  }

  const storageRun = await getGenerationRunFromStorage(jobId);

  if (storageRun) {
    return storageRun;
  }

  const outputRoot = await resolveOutputRoot();

  if (!outputRoot) {
    return null;
  }

  const jobDir = path.join(outputRoot, jobId);
  const summaryPath = path.join(jobDir, "job-summary.json");
  const demoSummaryPath = path.join(jobDir, "demo-summary.json");

  try {
    const contents = await readFile(summaryPath, "utf8");
    return generationRunSummarySchema.parse(JSON.parse(contents));
  } catch {
    try {
      const contents = await readFile(demoSummaryPath, "utf8");
      return generationRunSummarySchema.parse(JSON.parse(contents));
    } catch {
      return null;
    }
  }
}

export function buildArtifactDownloadUrl(jobId: string, kind: ArtifactRecord["kind"]) {
  return `/api/artifacts/${jobId}/${kind}`;
}

export function summarizeRunSources(run: GenerationRunSummary) {
  const files = run.datasetProfile.manifest?.files ?? run.datasetProfile.sourceFiles ?? [];

  if (files.length === 0) {
    return run.sourceFileName;
  }

  if (files.length === 1) {
    return files[0]?.fileName ?? run.sourceFileName;
  }

  return `${files.length} files · ${files[0]?.fileName ?? run.sourceFileName}`;
}

export function summarizeRunBrief(run: GenerationRunSummary) {
  const client = run.brief?.client || run.client;
  const objective = run.brief?.objective || run.objective;
  const audience = run.brief?.audience || run.audience;

  return [client, audience ? `Audience: ${audience}` : undefined, objective].filter(Boolean).join(" · ");
}

export async function readLocalArtifactBuffer(artifact: ArtifactRecord) {
  const workspaceRoot = await tryResolveWorkspaceRoot();

  if (!workspaceRoot) {
    throw new Error("Local artifact fallback is not available in this runtime.");
  }

  return readFile(path.join(workspaceRoot, artifact.storagePath));
}

async function listGenerationRunsFromSupabase(limit: number, viewerId?: string) {
  const credentials = getSupabaseCredentials();

  if (!credentials || !viewerId) {
    return [];
  }

  try {
    const data = await fetchRestRows<{ summary: unknown }>({
      ...credentials,
      table: "generation_jobs",
      query: {
        select: "summary",
        requested_by: `eq.${viewerId}`,
        summary: "not.is.null",
        order: "created_at.desc",
        limit: String(limit),
      },
    });

    return (data ?? [])
      .flatMap((row) => {
        try {
          return row.summary ? [generationRunSummarySchema.parse(row.summary)] : [];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch {
    return [];
  }
}

async function getGenerationRunFromSupabase(jobId: string, viewerId?: string) {
  const credentials = getSupabaseCredentials();

  if (!credentials || !viewerId) {
    return null;
  }

  try {
    const data = await fetchRestRows<{ summary: unknown }>({
      ...credentials,
      table: "generation_jobs",
      query: {
        select: "summary",
        job_key: `eq.${jobId}`,
        requested_by: `eq.${viewerId}`,
        limit: "1",
      },
    });

    if (!data[0]?.summary) {
      return null;
    }

    return generationRunSummarySchema.parse(data[0].summary);
  } catch {
    return null;
  }
}

async function listGenerationRunsFromStorage(limit: number) {
  const credentials = getSupabaseCredentials();

  if (!credentials) {
    return [];
  }

  try {
    const entries = await listStorageObjects({
      ...credentials,
      bucket: "artifacts",
      prefix: "run-summaries",
      limit: Math.max(limit, 24),
    });

    const summaryFiles = entries
      .filter((entry) => entry.name.endsWith(".json"))
      .sort((left, right) => right.name.localeCompare(left.name))
      .slice(0, limit);

    const runs = await Promise.all(
      summaryFiles.map(async (entry) => {
        try {
          const buffer = await downloadFromStorage({
            ...credentials,
            bucket: "artifacts",
            storagePath: `run-summaries/${entry.name}`,
          });
          return generationRunSummarySchema.parse(JSON.parse(buffer.toString("utf8")));
        } catch {
          return null;
        }
      }),
    );

    return runs.filter((run): run is GenerationRunSummary => Boolean(run));
  } catch {
    return [];
  }
}

async function getGenerationRunFromStorage(jobId: string) {
  const credentials = getSupabaseCredentials();

  if (!credentials) {
    return null;
  }

  try {
    const buffer = await downloadFromStorage({
      ...credentials,
      bucket: "artifacts",
      storagePath: buildStoredSummaryPath(jobId),
    });

    return generationRunSummarySchema.parse(JSON.parse(buffer.toString("utf8")));
  } catch {
    return null;
  }
}

async function resolveOutputRoot() {
  const workspaceRoot = await tryResolveWorkspaceRoot();
  return workspaceRoot ? path.join(workspaceRoot, "output") : null;
}

async function tryResolveWorkspaceRoot() {
  let current = process.cwd();

  for (;;) {
    try {
      await access(path.join(current, "docs", "vision.md"));
      await access(path.join(current, "package.json"));
      return current;
    } catch {
      const parent = path.dirname(current);

      if (parent === current) {
        return null;
      }

      current = parent;
    }
  }
}

async function safeReadDir(targetPath: string) {
  try {
    return await readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
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

function buildStoredSummaryPath(jobId: string) {
  return `run-summaries/${jobId}.json`;
}
