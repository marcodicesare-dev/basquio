import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { inferSourceFileKind } from "@basquio/core";
import { GenerationValidationError, runGenerationRequest } from "@basquio/workflows";
import type { GenerationRequest } from "@basquio/types";

import { buildArtifactDownloadUrl } from "@/lib/job-runs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const generationRequest = await parseGenerationRequest(request);
    const validationError = validateGenerationFiles(generationRequest.sourceFiles, generationRequest.styleFile);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const summary = await runGenerationRequest(generationRequest);

    return NextResponse.json({
      jobId: summary.jobId,
      storyTitle: summary.story.title || summary.story.keyMessages[0] || "Basquio output",
      fileCount: summary.datasetProfile.manifest?.files.length ?? summary.datasetProfile.sourceFiles.length ?? 1,
      sheetCount: summary.datasetProfile.sheets.length,
      outlineSectionCount: summary.reportOutline?.sections.length ?? 0,
      slideCount: summary.slidePlan.slides.length,
      highlights: summary.deterministicAnalysis.highlights,
      artifacts: summary.artifacts.map((artifact) => ({
        kind: artifact.kind,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        downloadUrl: buildArtifactDownloadUrl(summary.jobId, artifact.kind),
      })),
    });
  } catch (error) {
    if (error instanceof GenerationValidationError) {
      return NextResponse.json(
        {
          error: error.message,
          status: "needs_input",
          issues: error.validationReport.issues,
        },
        { status: 422 },
      );
    }

    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function parseGenerationRequest(request: Request): Promise<GenerationRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as Partial<GenerationRequest>;
    const brief = buildBrief(payload);

    return {
      jobId: payload.jobId || createJobId(),
      organizationId: payload.organizationId || "local-org",
      projectId: payload.projectId || "local-project",
      sourceFiles: payload.sourceFiles ?? [],
      styleFile: payload.styleFile,
      brief,
      businessContext: brief.businessContext,
      client: brief.client,
      audience: brief.audience,
      objective: brief.objective,
      thesis: brief.thesis,
      stakes: brief.stakes,
    };
  }

  const formData = await request.formData();
  const evidenceFiles = formData.getAll("evidenceFiles").filter((value): value is File => value instanceof File && value.size > 0);
  const brandFile = formData.get("brandFile");
  const jobId = createJobId();
  const brief = buildBrief({
    businessContext: String(formData.get("businessContext") ?? ""),
    client: String(formData.get("client") ?? ""),
    audience: String(formData.get("audience") ?? ""),
    objective: String(formData.get("objective") ?? ""),
    thesis: String(formData.get("thesis") ?? ""),
    stakes: String(formData.get("stakes") ?? ""),
  });

  return {
    jobId,
    organizationId: "local-org",
    projectId: "local-project",
    sourceFiles: await Promise.all(
      evidenceFiles.map(async (file, index) => ({
        id: `${jobId}-upload-${index + 1}`,
        fileName: file.name,
        mediaType: file.type || "application/octet-stream",
        kind: inferSourceFileKind(file.name),
        base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
        fileBytes: file.size,
      })),
    ),
    styleFile:
      brandFile instanceof File && brandFile.size > 0
        ? {
            id: `${jobId}-style`,
            fileName: brandFile.name,
            mediaType: brandFile.type || "application/octet-stream",
            kind: inferSourceFileKind(brandFile.name),
            base64: Buffer.from(await brandFile.arrayBuffer()).toString("base64"),
            fileBytes: brandFile.size,
          }
        : undefined,
    brief,
    businessContext: brief.businessContext,
    client: brief.client,
    audience: brief.audience,
    objective: brief.objective,
    thesis: brief.thesis,
    stakes: brief.stakes,
  };
}

function validateGenerationFiles(
  sourceFiles: Array<NonNullable<GenerationRequest["sourceFiles"]>[number]>,
  styleFile?: GenerationRequest["styleFile"],
) {
  if (sourceFiles.length === 0) {
    return "Upload at least one CSV, XLSX, or support file to start a generation run.";
  }

  const unsupportedEvidenceFile = sourceFiles.find((file) => inferSourceFileKind(file.fileName) === "unknown");

  if (unsupportedEvidenceFile) {
    return `Unsupported file type for ${unsupportedEvidenceFile.fileName}. Basquio accepts CSV/XLSX/XLS plus text, doc, PDF, PPTX, JSON, or CSS support files.`;
  }

  if (!sourceFiles.some((file) => inferSourceFileKind(file.fileName) === "workbook")) {
    return "At least one CSV, XLSX, or XLS file is required so Basquio has a tabular source for deterministic analytics.";
  }

  if (styleFile && !["brand-tokens", "pptx", "pdf"].includes(inferSourceFileKind(styleFile.fileName))) {
    return "Brand input must be a JSON/CSS token file, a PPTX template, or a PDF style reference.";
  }

  return null;
}

function buildBrief(input: Partial<Record<"businessContext" | "client" | "audience" | "objective" | "thesis" | "stakes", string>> & {
  brief?: GenerationRequest["brief"];
}) {
  return {
    businessContext: input.brief?.businessContext || input.businessContext?.trim() || "",
    client: input.brief?.client || input.client?.trim() || "",
    audience: input.brief?.audience || input.audience?.trim() || "Executive stakeholder",
    objective: input.brief?.objective || input.objective?.trim() || "Explain the business performance signal",
    thesis: input.brief?.thesis || input.thesis?.trim() || "",
    stakes: input.brief?.stakes || input.stakes?.trim() || "",
  };
}

function createJobId() {
  return `job-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}
