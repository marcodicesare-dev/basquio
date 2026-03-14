import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { Inngest } from "inngest";

import { parseEvidencePackage } from "@basquio/data-ingest";
import {
  generateInsights,
  planSlides,
  planReportOutline,
  planStory,
  profileDataset,
  runDeterministicAnalytics,
} from "@basquio/intelligence";
import { renderPdfArtifact } from "@basquio/render-pdf";
import { renderPptxArtifact } from "@basquio/render-pptx";
import { interpretTemplateSource } from "@basquio/template-engine";
import {
  artifactRecordSchema,
  type ArtifactRecord,
  type BinaryArtifact,
  generationJobResultSchema,
  generationRunSummarySchema,
  generationRequestSchema,
  type GenerationRequest,
  type GenerationRunSummary,
} from "@basquio/types";

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

export async function runGenerationRequest(
  requestInput: GenerationRequest,
  options?: {
    stepRunner?: GenerationStepRunner;
  },
): Promise<GenerationRunSummary> {
  const request = generationRequestSchema.parse(requestInput);
  const brief = resolveReportBrief(request);
  const sourceFiles = resolveSourceFiles(request);
  const runStep = async <T>(stage: string, fn: () => Promise<T> | T) => {
    if (options?.stepRunner) {
      return options.stepRunner(stage, fn);
    }

    return await fn();
  };

  const parsed = await runStep("parse input", async () =>
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
  );

  const analyzed = await runStep("analyze", async () => ({
    datasetProfile: profileDataset(parsed.datasetProfile),
    deterministicAnalysis: runDeterministicAnalytics(parsed.normalizedWorkbook),
  }));

  const insights = await runStep("generate insights", async () =>
    generateInsights({
      datasetProfile: analyzed.datasetProfile,
      analysis: analyzed.deterministicAnalysis,
      brief,
    }),
  );

  const story = await runStep("plan story", async () =>
    planStory({
      datasetProfile: analyzed.datasetProfile,
      analysis: analyzed.deterministicAnalysis,
      insights,
      brief,
    }),
  );

  const reportOutline = await runStep("plan outline", async () =>
    planReportOutline({
      datasetProfile: analyzed.datasetProfile,
      analysis: analyzed.deterministicAnalysis,
      insights,
      story,
      brief,
    }),
  );

  const slidePlan = await runStep("plan slides", async () => {
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
  });

  const deckTitle = story.title || story.keyMessages[0] || brief.objective || "Basquio output";

  const pptxArtifact = await runStep("render pptx", async () =>
    renderPptxArtifact({
      deckTitle,
      slidePlan: slidePlan.slides,
      charts: slidePlan.charts,
      templateProfile: slidePlan.templateProfile,
    }),
  );

  const pdfArtifact = await runStep("render pdf", async () =>
    renderPdfArtifact({
      deckTitle,
      slidePlan: slidePlan.slides,
      charts: slidePlan.charts,
      templateProfile: slidePlan.templateProfile,
    }),
  );

  const artifacts = await runStep("store artifacts", async () =>
    Promise.all([
      persistArtifact(request.jobId, "pptx", pptxArtifact),
      persistArtifact(request.jobId, "pdf", pdfArtifact),
    ]),
  );

  const summary = generationRunSummarySchema.parse({
    jobId: request.jobId,
    createdAt: new Date().toISOString(),
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
    artifacts,
  });

  await writeRunSummary(summary);

  return summary;
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

async function persistArtifact(jobId: string, kind: "pptx" | "pdf", artifact: BinaryArtifact): Promise<ArtifactRecord> {
  const storagePath = `jobs/${jobId}/${artifact.fileName}`;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const buffer = toBuffer(artifact.buffer);
  const allowLocalFallback =
    process.env.BASQUIO_ALLOW_LOCAL_ARTIFACT_FALLBACK === "true" || process.env.NODE_ENV !== "production";

  if (supabaseUrl && serviceRoleKey) {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.storage.from("artifacts").upload(storagePath, buffer, {
      contentType: artifact.mimeType,
      upsert: true,
    });

    if (!error) {
      return artifactRecordSchema.parse({
        id: `${jobId}-${kind}`,
        jobId,
        kind,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        storagePath,
        byteSize: buffer.byteLength,
        provider: "supabase",
      });
    }

    if (!allowLocalFallback) {
      throw new Error(`Supabase artifact upload failed for ${storagePath}: ${error.message}`);
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

  return artifactRecordSchema.parse({
    id: `${jobId}-${kind}`,
    jobId,
    kind,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    storagePath: path.relative(workspaceRoot, path.join(outputDir, artifact.fileName)),
    byteSize: buffer.byteLength,
    provider: "local",
  });
}

async function writeRunSummary(summary: GenerationRunSummary) {
  const outputDir = path.join(await resolveOutputRoot(), summary.jobId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "job-summary.json"), JSON.stringify(summary, null, 2));
}

function toBuffer(buffer: BinaryArtifact["buffer"]) {
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.data);
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
