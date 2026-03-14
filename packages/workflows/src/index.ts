import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { Inngest } from "inngest";

import { createJobStepId } from "@basquio/core";
import { parseWorkbookBuffer } from "@basquio/data-ingest";
import {
  generateInsights,
  planSlides,
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
  generationRequestSchema,
  generationJobStepSchema,
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
    const stepTrail = [];

    const parsed = await step.run("parse input", async () => {
      stepTrail.push(createStep(request.jobId, "parse input", "running", "Parsing workbook upload."));
      return parseWorkbookBuffer({
        datasetId: request.jobId,
        fileName: request.sourceFileName,
        buffer: Buffer.from(request.workbookBase64, "base64"),
      });
    });

    const analyzed = await step.run("analyze", async () => {
      stepTrail.push(
        createStep(
          request.jobId,
          "analyze",
          "running",
          "Profiling the workbook and running deterministic analytics before any LLM reasoning.",
        ),
      );

      return {
        datasetProfile: profileDataset(parsed.datasetProfile),
        deterministicAnalysis: runDeterministicAnalytics(parsed.normalizedWorkbook),
      };
    });

    const insightSpecs = await step.run("generate insights", async () => {
      stepTrail.push(createStep(request.jobId, "generate insights", "running", "Generating evidence-backed insights."));
      return generateInsights({
        datasetProfile: analyzed.datasetProfile,
        analysis: analyzed.deterministicAnalysis,
      });
    });

    const story = await step.run("plan story", async () => {
      stepTrail.push(createStep(request.jobId, "plan story", "running", "Planning the executive story arc."));
      return planStory({
        datasetProfile: analyzed.datasetProfile,
        insights: insightSpecs,
        audience: request.audience,
        objective: request.objective,
      });
    });

    const slidePlan = await step.run("plan slides", async () => {
      const templateProfile = interpretTemplateSource({
        id: `${request.jobId}-template`,
        fileName: request.templateFileName,
      });

      return {
        templateProfile,
        ...planSlides({
          story,
          insights: insightSpecs,
          templateProfile,
        }),
      };
    });

    const pptxArtifact = await step.run("render pptx", async () => {
      stepTrail.push(createStep(request.jobId, "render pptx", "running", "Rendering editable PowerPoint artifact."));
      return renderPptxArtifact({
        deckTitle: story.keyMessages[0] ?? "Basquio output",
        slidePlan: slidePlan.slides,
        charts: slidePlan.charts,
        templateProfile: slidePlan.templateProfile,
      });
    });

    const pdfArtifact = await step.run("render pdf", async () => {
      stepTrail.push(createStep(request.jobId, "render pdf", "running", "Rendering PDF artifact."));
      return renderPdfArtifact({
        deckTitle: story.keyMessages[0] ?? "Basquio output",
        slidePlan: slidePlan.slides,
        templateProfile: slidePlan.templateProfile,
      });
    });

    const artifacts = await step.run("store artifacts", async () => {
      stepTrail.push(createStep(request.jobId, "store artifacts", "running", "Persisting artifacts."));
      return Promise.all([
        persistArtifact(request.jobId, "pptx", pptxArtifact),
        persistArtifact(request.jobId, "pdf", pdfArtifact),
      ]);
    });

    return generationJobResultSchema.parse({
      datasetId: analyzed.datasetProfile.datasetId,
      storyTitle: story.keyMessages[0] ?? "Basquio output",
      artifacts,
    });
  },
);

export const functions = [basquioGenerationRequested];

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

  const outputDir = path.resolve(process.cwd(), "output", jobId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, artifact.fileName), buffer);

  return artifactRecordSchema.parse({
    id: `${jobId}-${kind}`,
    jobId,
    kind,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    storagePath: path.relative(process.cwd(), path.join(outputDir, artifact.fileName)),
    byteSize: buffer.byteLength,
    provider: "local",
  });
}

function createStep(
  jobId: string,
  stage: string,
  status: "queued" | "running" | "completed" | "failed" | "needs_input",
  detail: string,
) {
  return generationJobStepSchema.parse({
    id: createJobStepId(jobId, stage),
    jobId,
    stage,
    status,
    detail,
  });
}

function toBuffer(buffer: BinaryArtifact["buffer"]) {
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.data);
}
