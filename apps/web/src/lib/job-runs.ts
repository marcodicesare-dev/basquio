import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { generationRunSummarySchema, type ArtifactRecord, type GenerationRunSummary } from "@basquio/types";

export async function listGenerationRuns(limit = 12): Promise<GenerationRunSummary[]> {
  const outputRoot = await resolveOutputRoot();
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

export async function getGenerationRun(jobId: string): Promise<GenerationRunSummary | null> {
  const outputRoot = await resolveOutputRoot();
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
  const workspaceRoot = await resolveWorkspaceRoot();
  return readFile(path.join(workspaceRoot, artifact.storagePath));
}

async function resolveOutputRoot() {
  return path.join(await resolveWorkspaceRoot(), "output");
}

async function resolveWorkspaceRoot() {
  let current = process.cwd();

  for (;;) {
    try {
      await access(path.join(current, "docs", "vision.md"));
      await access(path.join(current, "package.json"));
      return current;
    } catch {
      const parent = path.dirname(current);

      if (parent === current) {
        throw new Error("Unable to resolve the Basquio workspace root.");
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
