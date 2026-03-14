import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { Inngest } from "inngest";

import { parseEvidencePackage } from "@basquio/data-ingest";
import {
  generateInsights,
  planSlides,
  planReportOutline,
  planStory,
  profileDataset,
  runDeterministicAnalytics,
  validateExecutionPlan,
} from "@basquio/intelligence";
import { renderPdfArtifact } from "@basquio/render-pdf";
import { renderPptxArtifact } from "@basquio/render-pptx";
import { interpretTemplateSource } from "@basquio/template-engine";
import {
  artifactManifestSchema,
  artifactRecordSchema,
  type ArtifactRecord,
  type BinaryArtifact,
  type GenerationJobStatus,
  type QualityCheck,
  qualityReportSchema,
  generationJobResultSchema,
  generationRunSummarySchema,
  generationRequestSchema,
  type GenerationRequest,
  type GenerationRunSummary,
  type ValidationReport,
} from "@basquio/types";

import { createRunPersistence } from "./persistence";
import { createServiceSupabaseClient, downloadFromStorage, uploadToStorage } from "./supabase";

export const inngest = new Inngest({
  id: "basquio",
  name: "Basquio",
});

export const basquioGenerationRequested = inngest.createFunction(
  { id: "basquio-generation-requested" },
  { event: "basquio/generation.requested" },
  async ({ event, step }) => {
    const request = generationRequestSchema.parse(event.data);
    const summary = await runGenerationRequest(request, {
      stepRunner: async <T>(stage: string, fn: () => Promise<T> | T) =>
        (await step.run(stage, async () => await fn())) as T,
    });

    return generationJobResultSchema.parse({
      datasetId: summary.datasetProfile.datasetId,
      storyTitle: summary.story.title || summary.story.keyMessages[0] || "Basquio output",
      artifacts: summary.artifacts,
    });
  },
);

export const functions = [basquioGenerationRequested];

type GenerationStepRunner = <T>(stage: string, fn: () => Promise<T> | T) => Promise<T>;

export class GenerationValidationError extends Error {
  constructor(
    message: string,
    readonly validationReport: ValidationReport,
    readonly partialSummary?: GenerationRunSummary,
  ) {
    super(message);
    this.name = "GenerationValidationError";
  }
}

export async function runGenerationRequest(
  requestInput: GenerationRequest,
  options?: {
    stepRunner?: GenerationStepRunner;
  },
): Promise<GenerationRunSummary> {
  const request = generationRequestSchema.parse(requestInput);
  const brief = resolveReportBrief(request);
  const sourceFiles = resolveSourceFiles(request);
  const createdAt = new Date().toISOString();
  const persistence = await createRunPersistence({
    request,
    brief,
  });

  await persistence.initialize();
  await persistence.persistSourceInputs();

  const runStep = async <T>(stage: string, fn: () => Promise<T> | T) => {
    if (options?.stepRunner) {
      return options.stepRunner(stage, fn);
    }

    return await fn();
  };

  const runStage = async <T>(
    stage: string,
    fn: () => Promise<T> | T,
    options?: {
      detail?: (result: T) => string;
      payload?: (result: T) => Record<string, unknown>;
    },
  ) => {
    await persistence.updateJobStage(stage, "running", `Running ${stage}.`);

    try {
      const result = await runStep(stage, fn);
      await persistence.updateJobStage(
        stage,
        "completed",
        options?.detail ? options.detail(result) : `${stage} completed.`,
        options?.payload ? options.payload(result) : {},
      );
      return result;
    } catch (error) {
      const status: Extract<GenerationJobStatus, "failed" | "needs_input"> =
        error instanceof GenerationValidationError ? "needs_input" : "failed";
      const message = error instanceof Error ? error.message : "Stage execution failed.";
      await persistence.updateJobStage(stage, status, message, { error: message });
      throw error;
    }
  };

  try {
    const parsed = await runStage(
      "parse input",
      async () =>
        parseEvidencePackage({
          datasetId: request.jobId,
          files: sourceFiles.map((file, index) => ({
            id: file.id ?? `${request.jobId}-file-${index + 1}`,
            fileName: file.fileName,
            mediaType: file.mediaType,
            kind: file.kind,
            buffer: Buffer.from(file.base64, "base64"),
          })),
        }),
      {
        detail: (result) =>
          `Parsed ${result.datasetProfile.manifest?.files.length ?? sourceFiles.length} source files into ${result.datasetProfile.sheets.length} sheet views.`,
        payload: (result) => ({
          fileCount: result.datasetProfile.manifest?.files.length ?? sourceFiles.length,
          sheetCount: result.datasetProfile.sheets.length,
        }),
      },
    );

    const analyzed = await runStage(
      "analyze",
      async () => ({
        datasetProfile: profileDataset(parsed.datasetProfile),
        deterministicAnalysis: runDeterministicAnalytics(parsed.normalizedWorkbook),
      }),
      {
        detail: (result) =>
          `Computed deterministic analytics across ${result.deterministicAnalysis.metricSummaries.length} metric summaries.`,
        payload: (result) => ({
          metricSummaryCount: result.deterministicAnalysis.metricSummaries.length,
          highlightCount: result.deterministicAnalysis.highlights.length,
        }),
      },
    );

    await persistence.updateDataset({
      datasetId: request.jobId,
      datasetProfile: analyzed.datasetProfile,
      deterministicAnalysis: analyzed.deterministicAnalysis,
    });

    const insights = await runStage(
      "generate insights",
      async () =>
        generateInsights({
          datasetProfile: analyzed.datasetProfile,
          analysis: analyzed.deterministicAnalysis,
          brief,
        }),
      {
        detail: (result) => `Ranked ${result.length} evidence-backed insights.`,
        payload: (result) => ({ insightCount: result.length }),
      },
    );

    const story = await runStage(
      "plan story",
      async () =>
        planStory({
          datasetProfile: analyzed.datasetProfile,
          analysis: analyzed.deterministicAnalysis,
          insights,
          brief,
        }),
      {
        detail: (result) => `Planned story "${result.title || "Basquio evidence package report"}".`,
        payload: (result) => ({
          narrativeArcCount: result.narrativeArc.length,
          keyMessageCount: result.keyMessages.length,
        }),
      },
    );

    const reportOutline = await runStage(
      "plan outline",
      async () =>
        planReportOutline({
          datasetProfile: analyzed.datasetProfile,
          analysis: analyzed.deterministicAnalysis,
          insights,
          story,
          brief,
        }),
      {
        detail: (result) => `Locked a ${result.sections.length}-section report outline before slide planning.`,
        payload: (result) => ({ sectionCount: result.sections.length }),
      },
    );

    const slidePlan = await runStage(
      "plan slides",
      async () => {
        const templateProfile = interpretTemplateSource({
          id: `${request.jobId}-template`,
          fileName: request.styleFile?.fileName ?? request.templateFileName,
          sourceFile: request.styleFile,
        });
        const planned = planSlides({
          datasetProfile: analyzed.datasetProfile,
          analysis: analyzed.deterministicAnalysis,
          story,
          outline: reportOutline,
          insights,
          templateProfile,
          brief,
        });

        return {
          slides: planned.slides,
          charts: planned.charts,
          templateProfile,
        };
      },
      {
        detail: (result) => `Planned ${result.slides.length} slides and ${result.charts.length} charts.`,
        payload: (result) => ({
          slideCount: result.slides.length,
          chartCount: result.charts.length,
        }),
      },
    );

    await persistence.updateTemplateProfile(slidePlan.templateProfile);

    const validationReport = await runStage(
      "validate plan",
      async () =>
        validateExecutionPlan({
          jobId: request.jobId,
          analysis: analyzed.deterministicAnalysis,
          insights,
          slides: slidePlan.slides,
          charts: slidePlan.charts,
        }),
      {
        detail: (result) => `Validation completed with ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}.`,
        payload: (result) => ({
          status: result.status,
          issueCount: result.issues.length,
        }),
      },
    );

    await persistence.updateValidationReport(validationReport);

    if (validationReport.status !== "passed") {
      await persistence.updateJobStage(
        "validate plan",
        "needs_input",
        `Validation blocked rendering with ${validationReport.issues.length} issue${validationReport.issues.length === 1 ? "" : "s"}.`,
        {
          status: validationReport.status,
          issueCount: validationReport.issues.length,
        },
      );

      const partialSummary = generationRunSummarySchema.parse({
        jobId: request.jobId,
        createdAt,
        status: "needs_input",
        failureMessage: "Pre-render validation failed.",
        sourceFileName: analyzed.datasetProfile.sourceFileName,
        brief,
        businessContext: brief.businessContext,
        client: brief.client,
        audience: brief.audience,
        objective: brief.objective,
        thesis: brief.thesis,
        stakes: brief.stakes,
        datasetProfile: analyzed.datasetProfile,
        deterministicAnalysis: analyzed.deterministicAnalysis,
        insights,
        story,
        reportOutline,
        slidePlan: {
          slides: slidePlan.slides,
          charts: slidePlan.charts,
        },
        validationReport,
        artifacts: [],
      });

      throw new GenerationValidationError("Pre-render validation failed.", validationReport, partialSummary);
    }

    const deckTitle = story.title || story.keyMessages[0] || brief.objective || "Basquio output";

    const pptxArtifact = await runStage(
      "render pptx",
      async () =>
        renderPptxArtifact({
          deckTitle,
          slidePlan: slidePlan.slides,
          charts: slidePlan.charts,
          templateProfile: slidePlan.templateProfile,
        }),
      {
        detail: (result) => `Rendered PPTX artifact ${result.fileName}.`,
        payload: (result) => ({ fileName: result.fileName, byteSize: toBuffer(result.buffer).byteLength }),
      },
    );

    const pdfArtifact = await runStage(
      "render pdf",
      async () =>
        renderPdfArtifact({
          deckTitle,
          slidePlan: slidePlan.slides,
          charts: slidePlan.charts,
          templateProfile: slidePlan.templateProfile,
        }),
      {
        detail: (result) => `Rendered PDF artifact ${result.fileName}.`,
        payload: (result) => ({ fileName: result.fileName, byteSize: toBuffer(result.buffer).byteLength }),
      },
    );

    const artifacts = await runStage(
      "store artifacts",
      async () =>
        Promise.all([
          persistArtifact(request.jobId, "pptx", pptxArtifact),
          persistArtifact(request.jobId, "pdf", pdfArtifact),
        ]),
      {
        detail: (result) => `Stored ${result.length} output artifacts.`,
        payload: (result) => ({ artifactCount: result.length }),
      },
    );

    const postRenderQa = await runStage(
      "post-render qa",
      async () =>
        runPostRenderQa({
          jobId: request.jobId,
          artifacts,
          slideCount: slidePlan.slides.length,
          sectionCount: reportOutline.sections.length,
        }),
      {
        detail: (result) => `Post-render QA finished with status ${result.qualityReport.status}.`,
        payload: (result) => ({
          status: result.qualityReport.status,
          checkCount: result.qualityReport.checks.length,
        }),
      },
    );

    await persistence.updateQualityReport(postRenderQa.qualityReport);

    const summary = generationRunSummarySchema.parse({
      jobId: request.jobId,
      createdAt,
      status: "completed",
      failureMessage: "",
      sourceFileName: analyzed.datasetProfile.sourceFileName,
      brief,
      businessContext: brief.businessContext,
      client: brief.client,
      audience: brief.audience,
      objective: brief.objective,
      thesis: brief.thesis,
      stakes: brief.stakes,
      datasetProfile: analyzed.datasetProfile,
      deterministicAnalysis: analyzed.deterministicAnalysis,
      insights,
      story,
      reportOutline,
      slidePlan: {
        slides: slidePlan.slides,
        charts: slidePlan.charts,
      },
      validationReport,
      artifactManifest: postRenderQa.artifactManifest,
      qualityReport: postRenderQa.qualityReport,
      artifacts: postRenderQa.artifactManifest.artifacts,
    });

    await persistence.finalize(summary);
    await writeRunSummary(summary);

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";

    if (error instanceof GenerationValidationError) {
      if (error.partialSummary) {
        await persistence.finalizeFailure("needs_input", message, error.partialSummary);
        await writeRunSummary(error.partialSummary);
      } else {
        await persistence.finalizeFailure("needs_input", message);
      }
    } else {
      await persistence.finalizeFailure("failed", message);
    }

    throw error;
  }
}

function resolveSourceFiles(request: GenerationRequest) {
  if (request.sourceFiles.length > 0) {
    return request.sourceFiles;
  }

  if (request.sourceFileName && request.workbookBase64) {
    return [
      {
        fileName: request.sourceFileName,
        mediaType: "application/octet-stream",
        base64: request.workbookBase64,
      },
    ];
  }

  throw new Error("Generation request did not include any source files.");
}

function resolveReportBrief(request: GenerationRequest) {
  return {
    businessContext: request.brief.businessContext || request.businessContext,
    client: request.brief.client || request.client,
    audience: request.brief.audience || request.audience,
    objective: request.brief.objective || request.objective,
    thesis: request.brief.thesis || request.thesis,
    stakes: request.brief.stakes || request.stakes,
  };
}

async function runPostRenderQa(input: {
  jobId: string;
  artifacts: ArtifactRecord[];
  slideCount: number;
  sectionCount: number;
}) {
  const checks: QualityCheck[] = [];
  const qaArtifacts: ArtifactRecord[] = [];
  let resolvedPdfPageCount: number | undefined;
  let resolvedPptxSlideCount: number | undefined;

  for (const artifact of input.artifacts) {
    try {
      const buffer = await readPersistedArtifactBuffer(artifact);
      const actualByteSize = buffer.byteLength;
      const checksumSha256 = createHash("sha256").update(buffer).digest("hex");

      checks.push({
        id: `${artifact.kind}-exists`,
        label: `${artifact.kind.toUpperCase()} artifact exists`,
        status: actualByteSize > 0 ? "passed" : "failed",
        detail: actualByteSize > 0 ? `${artifact.fileName} is readable after storage.` : `${artifact.fileName} is empty after storage.`,
        artifactKind: artifact.kind,
      });

      checks.push({
        id: `${artifact.kind}-metadata`,
        label: `${artifact.kind.toUpperCase()} metadata matches stored bytes`,
        status: actualByteSize === artifact.byteSize ? "passed" : "failed",
        detail:
          actualByteSize === artifact.byteSize
            ? `${artifact.fileName} reports ${artifact.byteSize} bytes and storage returned the same size.`
            : `${artifact.fileName} reports ${artifact.byteSize} bytes, but storage returned ${actualByteSize}.`,
        artifactKind: artifact.kind,
      });

      let slideCount = input.slideCount;
      let pageCount: number | undefined;

      if (artifact.kind === "pdf") {
        pageCount = await countPdfPages(buffer);
        resolvedPdfPageCount = pageCount;
        checks.push({
          id: "pdf-page-count",
          label: "PDF page count matches the slide plan",
          status: pageCount === input.slideCount ? "passed" : "failed",
          detail: `Expected ${input.slideCount} pages and resolved ${pageCount}.`,
          artifactKind: artifact.kind,
        });
      }

      if (artifact.kind === "pptx") {
        slideCount = await countPptxSlides(buffer);
        resolvedPptxSlideCount = slideCount;
        checks.push({
          id: "pptx-slide-count",
          label: "PPTX slide count matches the slide plan",
          status: slideCount === input.slideCount ? "passed" : "failed",
          detail: `Expected ${input.slideCount} slides and resolved ${slideCount}.`,
          artifactKind: artifact.kind,
        });
      }

      qaArtifacts.push(
        artifactRecordSchema.parse({
          ...artifact,
          byteSize: actualByteSize,
          checksumSha256,
          exists: actualByteSize > 0,
          slideCount,
          sectionCount: input.sectionCount,
          ...(typeof pageCount === "number" ? { pageCount } : {}),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Artifact verification failed.";
      checks.push({
        id: `${artifact.kind}-read`,
        label: `${artifact.kind.toUpperCase()} artifact is readable`,
        status: "failed",
        detail: message,
        artifactKind: artifact.kind,
      });

      qaArtifacts.push(
        artifactRecordSchema.parse({
          ...artifact,
          exists: false,
          sectionCount: input.sectionCount,
        }),
      );
    }
  }

  if (typeof resolvedPdfPageCount === "number" && typeof resolvedPptxSlideCount === "number") {
    checks.push({
      id: "cross-output-slide-consistency",
      label: "PPTX slides and PDF pages stay aligned",
      status: resolvedPdfPageCount === resolvedPptxSlideCount ? "passed" : "failed",
      detail: `PPTX resolved ${resolvedPptxSlideCount} slides and PDF resolved ${resolvedPdfPageCount} pages.`,
    });
  }

  checks.push({
    id: "cross-output-section-consistency",
    label: "Artifacts carry the same section count metadata",
    status: qaArtifacts.every((artifact) => artifact.sectionCount === input.sectionCount) ? "passed" : "failed",
    detail: `Expected section count ${input.sectionCount} across ${qaArtifacts.length} artifacts.`,
  });

  const manifest = artifactManifestSchema.parse({
    jobId: input.jobId,
    generatedAt: new Date().toISOString(),
    expectedSlideCount: input.slideCount,
    expectedSectionCount: input.sectionCount,
    artifacts: qaArtifacts,
  });

  const failedChecks = checks.filter((check) => check.status === "failed").length;
  const warningChecks = checks.filter((check) => check.status === "warning").length;

  const qualityReport = qualityReportSchema.parse({
    jobId: input.jobId,
    generatedAt: new Date().toISOString(),
    status: failedChecks > 0 ? "failed" : warningChecks > 0 ? "warning" : "passed",
    checks,
  });

  return {
    artifactManifest: manifest,
    qualityReport,
  };
}

async function persistArtifact(jobId: string, kind: "pptx" | "pdf", artifact: BinaryArtifact): Promise<ArtifactRecord> {
  const storagePath = `jobs/${jobId}/${artifact.fileName}`;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const buffer = toBuffer(artifact.buffer);
  const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
  const allowLocalFallback =
    process.env.BASQUIO_ALLOW_LOCAL_ARTIFACT_FALLBACK === "true" || process.env.NODE_ENV !== "production";

  if (supabaseUrl && serviceRoleKey) {
    try {
      await uploadToStorage({
        supabaseUrl,
        serviceKey: serviceRoleKey,
        bucket: "artifacts",
        storagePath,
        body: buffer,
        contentType: artifact.mimeType,
        upsert: true,
      });

      const supabase = createServiceSupabaseClient(supabaseUrl, serviceRoleKey);
      const record = artifactRecordSchema.parse({
        id: `${jobId}-${kind}`,
        jobId,
        kind,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        storagePath,
        byteSize: buffer.byteLength,
        provider: "supabase",
        checksumSha256,
        exists: true,
      });

      await persistArtifactMetadata(supabase, record);
      return record;
    } catch (error) {
      const supabase = createServiceSupabaseClient(supabaseUrl, serviceRoleKey);
      const inlineRecord = artifactRecordSchema.parse({
        id: `${jobId}-${kind}`,
        jobId,
        kind,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        storagePath,
        byteSize: buffer.byteLength,
        provider: "database",
        checksumSha256,
        exists: true,
      });

      try {
        await persistArtifactMetadata(supabase, inlineRecord, {
          inlineBase64: buffer.toString("base64"),
        });
        return inlineRecord;
      } catch {}

      if (!allowLocalFallback) {
        const message = error instanceof Error ? error.message : `Unable to upload ${storagePath}.`;
        throw new Error(`Supabase artifact upload failed for ${storagePath}: ${message}`);
      }
    }
  }

  if (!allowLocalFallback) {
    throw new Error(
      "Supabase artifact storage is required in production. Configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const workspaceRoot = await resolveWorkspaceRoot();
  const outputDir = path.join(workspaceRoot, "output", jobId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, artifact.fileName), buffer);

  const record = artifactRecordSchema.parse({
    id: `${jobId}-${kind}`,
    jobId,
    kind,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    storagePath: path.relative(workspaceRoot, path.join(outputDir, artifact.fileName)),
    byteSize: buffer.byteLength,
    provider: "local",
    checksumSha256,
    exists: true,
  });

  if (supabaseUrl && serviceRoleKey) {
    const supabase = createServiceSupabaseClient(supabaseUrl, serviceRoleKey);
    await persistArtifactMetadata(supabase, record);
  }

  return record;
}

async function writeRunSummary(summary: GenerationRunSummary) {
  const outputRoot = await resolveOutputRoot();

  if (!outputRoot) {
    return;
  }

  const outputDir = path.join(outputRoot, summary.jobId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "job-summary.json"), JSON.stringify(summary, null, 2));
}

async function persistArtifactMetadata(
  supabase: any,
  artifact: ArtifactRecord,
  extraMetadata: Record<string, unknown> = {},
) {
  try {
    const { data: job } = await supabase
      .from("generation_jobs")
      .select("id")
      .eq("job_key", artifact.jobId)
      .single();

    if (!job?.id) {
      return;
    }

    await supabase.from("artifacts").upsert(
      {
        job_id: job.id,
        kind: artifact.kind,
        storage_bucket: artifact.provider === "supabase" ? "artifacts" : artifact.provider === "database" ? "database" : "local",
        storage_path: artifact.storagePath,
        mime_type: artifact.mimeType,
        file_bytes: artifact.byteSize,
        metadata: {
          fileName: artifact.fileName,
          provider: artifact.provider,
          checksumSha256: artifact.checksumSha256,
          exists: artifact.exists,
          slideCount: artifact.slideCount,
          pageCount: artifact.pageCount,
          sectionCount: artifact.sectionCount,
          ...extraMetadata,
        },
      },
      { onConflict: "job_id,kind" },
    );
  } catch {
    // Durable metadata is best-effort so the working generation path keeps moving.
  }
}

async function readPersistedArtifactBuffer(artifact: ArtifactRecord) {
  if (artifact.provider === "supabase") {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase storage is configured for this artifact, but service-role credentials are missing.");
    }

    return downloadFromStorage({
      supabaseUrl,
      serviceKey: serviceRoleKey,
      bucket: "artifacts",
      storagePath: artifact.storagePath,
    });
  }

  if (artifact.provider === "database") {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase database access is configured for this artifact, but service-role credentials are missing.");
    }

    return readInlineArtifactBuffer({
      supabase: createServiceSupabaseClient(supabaseUrl, serviceRoleKey),
      jobId: artifact.jobId,
      kind: artifact.kind,
    });
  }

  const workspaceRoot = await resolveWorkspaceRoot();
  const absolutePath = path.isAbsolute(artifact.storagePath)
    ? artifact.storagePath
    : path.join(workspaceRoot, artifact.storagePath);

  return readFile(absolutePath);
}

async function readInlineArtifactBuffer(input: {
  supabase: any;
  jobId: string;
  kind: "pptx" | "pdf";
}) {
  const { data: job } = await input.supabase
    .from("generation_jobs")
    .select("id")
    .eq("job_key", input.jobId)
    .single();

  if (!job?.id) {
    throw new Error(`Unable to locate generation job ${input.jobId}.`);
  }

  const { data: artifact } = await input.supabase
    .from("artifacts")
    .select("metadata")
    .eq("job_id", job.id)
    .eq("kind", input.kind)
    .maybeSingle();

  const inlineBase64 =
    artifact?.metadata && typeof artifact.metadata === "object" && typeof artifact.metadata.inlineBase64 === "string"
      ? artifact.metadata.inlineBase64
      : null;

  if (!inlineBase64) {
    throw new Error(`Inline artifact payload is missing for ${input.jobId}/${input.kind}.`);
  }

  return Buffer.from(inlineBase64, "base64");
}

async function countPdfPages(buffer: Buffer) {
  const pdf = await PDFDocument.load(buffer);
  return pdf.getPageCount();
}

async function countPptxSlides(buffer: Buffer) {
  const archive = await JSZip.loadAsync(buffer);
  return Object.keys(archive.files).filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry)).length;
}

function toBuffer(buffer: BinaryArtifact["buffer"]) {
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.data);
}

async function resolveOutputRoot() {
  const workspaceRoot = await tryResolveWorkspaceRoot();
  return workspaceRoot ? path.join(workspaceRoot, "output") : null;
}

async function resolveWorkspaceRoot() {
  const workspaceRoot = await tryResolveWorkspaceRoot();

  if (!workspaceRoot) {
    throw new Error("Unable to resolve the Basquio workspace root.");
  }

  return workspaceRoot;
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
