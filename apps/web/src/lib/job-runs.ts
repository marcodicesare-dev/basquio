import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { generationRunSummarySchema, type ArtifactRecord, type GenerationRunSummary } from "@basquio/types";

import {
  downloadFromStorage,
  fetchRestRows,
  getStorageObjectInfo,
  listStorageObjects,
} from "@/lib/supabase/admin";

type ArtifactKind = ArtifactRecord["kind"];

type DurableArtifactAvailability = {
  ready: boolean;
  artifacts: ArtifactRecord[];
  expectedKinds: ArtifactKind[];
  missingKinds: ArtifactKind[];
};

type DurableArtifactRow = {
  kind: ArtifactKind;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  file_bytes: number;
  metadata?: Record<string, unknown>;
};

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

export async function getGenerationArtifactRecord(
  jobId: string,
  kind: ArtifactRecord["kind"],
  viewerId: string,
): Promise<ArtifactRecord | null> {
  const credentials = getSupabaseCredentials();

  if (credentials) {
    const durableArtifacts = await listDurableArtifactRecords(jobId, viewerId);
    const durableArtifact = durableArtifacts.find((artifact) => artifact.kind === kind);

    if (durableArtifact) {
      return durableArtifact;
    }
  }

  const run = await getGenerationRun(jobId, viewerId);
  return run?.artifacts.find((candidate) => candidate.kind === kind) ?? null;
}

export async function getDurableArtifactAvailability(
  jobId: string,
  viewerId?: string,
  expectedKinds: ArtifactKind[] = ["pptx", "pdf"],
): Promise<DurableArtifactAvailability> {
  const durableArtifacts = await listDurableArtifactRecords(jobId, viewerId);
  const durableKinds = new Set(durableArtifacts.map((artifact) => artifact.kind));
  const missingKinds = expectedKinds.filter((kind) => !durableKinds.has(kind));

  return {
    ready: missingKinds.length === 0,
    artifacts: durableArtifacts,
    expectedKinds,
    missingKinds,
  };
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

async function listDurableArtifactRecords(jobId: string, viewerId?: string) {
  const credentials = getSupabaseCredentials();

  if (credentials) {
    // Try v2 artifact_manifests_v2 first (canonical for new pipeline)
    try {
      const v2Manifests = await fetchRestRows<{
        artifacts: Array<{ kind: string; fileName: string; mimeType: string; storagePath: string; storageBucket: string; fileBytes: number; checksumSha256?: string }>;
        slide_count: number;
        page_count: number;
      }>({
        ...credentials,
        table: "artifact_manifests_v2",
        query: {
          select: "artifacts,slide_count,page_count",
          run_id: `eq.${jobId}`,
          limit: "1",
        },
      });

      if (v2Manifests.length > 0 && v2Manifests[0].artifacts?.length > 0) {
        return v2Manifests[0].artifacts.map((a) => ({
          id: `${jobId}-${a.kind}`,
          jobId,
          kind: a.kind as ArtifactKind,
          fileName: a.fileName,
          mimeType: a.mimeType,
          storagePath: a.storagePath,
          byteSize: a.fileBytes,
          provider: "supabase" as const,
          checksumSha256: a.checksumSha256 ?? "",
          exists: true,
          slideCount: v2Manifests[0].slide_count,
          pageCount: v2Manifests[0].page_count,
        }));
      }
    } catch {
      // v2 table may not exist; fall through to legacy
    }

    // Fall back to legacy artifacts table
    try {
      const jobIdRow = await loadGenerationJobRowId(jobId, viewerId);

      if (!jobIdRow) {
        return [];
      }

      const artifactRows = await fetchRestRows<DurableArtifactRow>({
        ...credentials,
        table: "artifacts",
        query: {
          select: "kind,storage_bucket,storage_path,mime_type,file_bytes,metadata",
          job_id: `eq.${jobIdRow}`,
          limit: "10",
        },
      });

      const artifacts = await Promise.all(
        artifactRows.map(async (artifactRow) => {
          const artifact = buildArtifactRecord(jobId, artifactRow);
          return (await isArtifactDurablyAvailable(artifact, credentials)) ? artifact : null;
        }),
      );

      return artifacts.filter((artifact): artifact is ArtifactRecord => Boolean(artifact));
    } catch {
      return [];
    }
  }

  const run = await getGenerationRun(jobId, viewerId);
  const artifacts = await Promise.all(
    (run?.artifacts ?? []).map(async (artifact) => ((await isLocalArtifactReadable(artifact)) ? artifact : null)),
  );

  return artifacts.filter((artifact): artifact is ArtifactRecord => Boolean(artifact));
}

async function listGenerationRunsFromSupabase(limit: number, viewerId?: string) {
  const credentials = getSupabaseCredentials();

  if (!credentials || !viewerId) {
    return [];
  }

  // Try v2 deck_runs first (the canonical pipeline)
  const v2Runs = await listV2DeckRuns(credentials, limit, viewerId);

  // Also try legacy generation_jobs for older runs
  let legacyRuns: GenerationRunSummary[] = [];
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

    legacyRuns = (data ?? [])
      .flatMap((row) => {
        try {
          return row.summary ? [generationRunSummarySchema.parse(row.summary)] : [];
        } catch {
          return [];
        }
      });
  } catch {
    // Legacy table may not exist or be empty
  }

  // Merge, deduplicate by jobId, sort by createdAt desc
  const allRuns = [...v2Runs, ...legacyRuns];
  const seen = new Set<string>();
  return allRuns
    .filter((run) => {
      if (seen.has(run.jobId)) return false;
      seen.add(run.jobId);
      return true;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

type V2DeckRunRow = {
  id: string;
  status: string;
  current_phase: string;
  delivery_status: string;
  brief: Record<string, unknown> | null;
  business_context: string | null;
  client: string | null;
  audience: string | null;
  objective: string | null;
  created_at: string;
  completed_at: string | null;
  failure_message: string | null;
  source_file_ids: string[] | null;
};

type V2ArtifactManifestRow = {
  run_id: string;
  slide_count: number;
  page_count: number;
  qa_passed: boolean;
  artifacts: Array<{ kind: string; fileName: string; mimeType: string; storagePath: string; storageBucket: string; fileBytes: number; checksumSha256?: string }>;
};

async function listV2DeckRuns(
  credentials: { supabaseUrl: string; serviceKey: string },
  limit: number,
  viewerId: string,
): Promise<GenerationRunSummary[]> {
  try {
    const runs = await fetchRestRows<V2DeckRunRow>({
      ...credentials,
      table: "deck_runs",
      query: {
        select: "id,status,current_phase,delivery_status,brief,business_context,client,audience,objective,created_at,completed_at,failure_message,source_file_ids",
        requested_by: `eq.${viewerId}`,
        order: "created_at.desc",
        limit: String(limit),
      },
    });

    // Fetch artifact manifests for completed runs
    const completedIds = runs.filter((r) => r.status === "completed" || r.completed_at).map((r) => r.id);
    let manifests: V2ArtifactManifestRow[] = [];
    if (completedIds.length > 0) {
      try {
        manifests = await fetchRestRows<V2ArtifactManifestRow>({
          ...credentials,
          table: "artifact_manifests_v2",
          query: {
            select: "run_id,slide_count,page_count,qa_passed,artifacts",
            run_id: `in.(${completedIds.join(",")})`,
          },
        });
      } catch {
        // Table may not exist yet
      }
    }

    const manifestMap = new Map(manifests.map((m) => [m.run_id, m]));

    // Fetch cover slide titles for completed runs (the real headline)
    const completedRunIds = runs.filter((r) => r.status === "completed" || r.completed_at).map((r) => r.id);
    let coverTitles = new Map<string, string>();
    if (completedRunIds.length > 0) {
      try {
        const slides = await fetchRestRows<{ run_id: string; title: string }>({
          ...credentials,
          table: "deck_spec_v2_slides",
          query: {
            select: "run_id,title",
            run_id: `in.(${completedRunIds.join(",")})`,
            position: "eq.1",
          },
        });
        coverTitles = new Map(slides.map((s) => [s.run_id, s.title]));
      } catch {
        // Table may not exist
      }
    }

    // Fetch real file names from evidence_workspace_sheets
    let fileNames = new Map<string, string>();
    const allRunIds = runs.map((r) => r.id);
    if (allRunIds.length > 0) {
      try {
        const sheets = await fetchRestRows<{ workspace_id: string; file_name: string }>({
          ...credentials,
          table: "evidence_workspace_sheets",
          query: {
            select: "workspace_id,file_name",
            workspace_id: `in.(${allRunIds.join(",")})`,
            order: "created_at.asc",
            limit: String(allRunIds.length * 5),
          },
        });
        // Group by workspace_id, take the first file name
        for (const s of sheets) {
          if (!fileNames.has(s.workspace_id)) {
            fileNames.set(s.workspace_id, s.file_name);
          }
        }
      } catch {
        // Table may not exist
      }
    }

    return runs.map((run) => {
      const manifest = manifestMap.get(run.id);
      const brief = (run.brief ?? {}) as Record<string, string>;
      const coverTitle = coverTitles.get(run.id);
      const fileName = fileNames.get(run.id);
      const clientName = run.client ?? brief.client ?? "";
      const objectiveText = run.objective ?? brief.objective ?? "";
      const headline = coverTitle || (clientName ? `${clientName} — ${objectiveText}` : objectiveText) || "Report";

      const artifacts = (manifest?.artifacts ?? []).map((a) => ({
        id: `${run.id}-${a.kind}`,
        jobId: run.id,
        kind: a.kind as "pptx" | "pdf",
        fileName: a.fileName,
        mimeType: a.mimeType,
        storagePath: a.storagePath,
        byteSize: a.fileBytes,
        provider: "supabase" as const,
        checksumSha256: a.checksumSha256 ?? "",
        exists: true,
        slideCount: manifest?.slide_count,
        pageCount: manifest?.page_count,
      }));

      return generationRunSummarySchema.parse({
        jobId: run.id,
        createdAt: run.created_at,
        status: run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : "running",
        failureMessage: run.failure_message ?? "",
        sourceFileName: fileName || "Uploaded files",
        brief: {
          businessContext: brief.businessContext ?? run.business_context ?? "",
          client: clientName,
          audience: brief.audience ?? run.audience ?? "",
          objective: objectiveText,
        },
        businessContext: run.business_context ?? brief.businessContext ?? "",
        client: clientName,
        audience: run.audience ?? brief.audience ?? "Executive stakeholder",
        objective: objectiveText,
        thesis: brief.thesis ?? "",
        stakes: brief.stakes ?? "",
        datasetProfile: {
          totalRows: 0,
          totalColumns: 0,
          sheets: [],
          manifest: { files: fileName ? [{ fileName }] : [] },
        },
        packageSemantics: { entityType: "unknown", timeGranularity: "unknown", metrics: [], dimensions: [] },
        metricPlan: [],
        analyticsResult: { findings: [], executiveSummary: "" },
        insights: [],
        story: {
          client: clientName,
          audience: run.audience ?? "Executive stakeholder",
          objective: objectiveText,
          title: headline,
          executiveSummary: "",
          narrativeArc: [headline],
          keyMessages: [headline],
        },
        slidePlan: {
          slides: manifest ? Array.from({ length: manifest.slide_count }, (_, i) => ({ id: `slide-${i}` })) : [],
          charts: [],
        },
        artifacts,
      });
    });
  } catch {
    return [];
  }
}

async function getGenerationRunFromSupabase(jobId: string, viewerId?: string) {
  const credentials = getSupabaseCredentials();

  if (!credentials) {
    return null;
  }

  try {
    const data = await fetchRestRows<{ summary: unknown }>({
      ...credentials,
      table: "generation_jobs",
      query: {
        select: "summary",
        job_key: `eq.${jobId}`,
        ...(viewerId ? { requested_by: `eq.${viewerId}` } : {}),
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

async function loadGenerationJobRowId(jobId: string, viewerId?: string) {
  const credentials = getSupabaseCredentials();

  if (!credentials) {
    return null;
  }

  const jobs = await fetchRestRows<{ id: string }>({
    ...credentials,
    table: "generation_jobs",
    query: {
      select: "id",
      job_key: `eq.${jobId}`,
      ...(viewerId ? { requested_by: `eq.${viewerId}` } : {}),
      limit: "1",
    },
  });

  return jobs[0]?.id ?? null;
}

function buildArtifactRecord(jobId: string, artifact: DurableArtifactRow): ArtifactRecord {
  const metadata = artifact.metadata ?? {};
  const metadataProvider =
    metadata.provider === "supabase" || metadata.provider === "database" || metadata.provider === "local"
      ? metadata.provider
      : null;
  const provider =
    metadataProvider ??
    (artifact.storage_bucket === "artifacts"
      ? "supabase"
      : artifact.storage_bucket === "database"
        ? "database"
        : "local");

  return {
    id: `${jobId}-${artifact.kind}`,
    jobId,
    kind: artifact.kind,
    fileName: typeof metadata.fileName === "string" ? metadata.fileName : `${jobId}.${artifact.kind}`,
    mimeType: artifact.mime_type,
    storagePath: artifact.storage_path,
    byteSize: artifact.file_bytes,
    provider,
    checksumSha256: typeof metadata.checksumSha256 === "string" ? metadata.checksumSha256 : "",
    exists: typeof metadata.exists === "boolean" ? metadata.exists : true,
    slideCount: typeof metadata.slideCount === "number" ? metadata.slideCount : undefined,
    sectionCount: typeof metadata.sectionCount === "number" ? metadata.sectionCount : undefined,
    pageCount: typeof metadata.pageCount === "number" ? metadata.pageCount : undefined,
  };
}

async function isArtifactDurablyAvailable(
  artifact: ArtifactRecord,
  credentials: { supabaseUrl: string; serviceKey: string },
) {
  if (!artifact.exists) {
    return false;
  }

  if (artifact.provider === "supabase") {
    try {
      await getStorageObjectInfo({
        ...credentials,
        bucket: "artifacts",
        storagePath: artifact.storagePath,
      });
      return true;
    } catch {
      return false;
    }
  }

  if (artifact.provider === "database") {
    const jobIdRow = await loadGenerationJobRowId(artifact.jobId);

    if (!jobIdRow) {
      return false;
    }

    const artifacts = await fetchRestRows<{ metadata?: Record<string, unknown> }>({
      ...credentials,
      table: "artifacts",
      query: {
        select: "metadata",
        job_id: `eq.${jobIdRow}`,
        kind: `eq.${artifact.kind}`,
        limit: "1",
      },
    }).catch(() => []);

    return typeof artifacts[0]?.metadata?.inlineBase64 === "string";
  }

  return isLocalArtifactReadable(artifact);
}

async function isLocalArtifactReadable(artifact: ArtifactRecord) {
  try {
    const workspaceRoot = await tryResolveWorkspaceRoot();

    if (!workspaceRoot) {
      return false;
    }

    const absolutePath = path.isAbsolute(artifact.storagePath)
      ? artifact.storagePath
      : path.join(workspaceRoot, artifact.storagePath);

    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
