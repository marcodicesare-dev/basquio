import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { inferSourceFileKind } from "@basquio/core";
import { runGenerationRequest } from "@basquio/workflows";

import { buildArtifactDownloadUrl } from "@/lib/job-runs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const evidenceFiles = formData.getAll("evidenceFiles").filter((value): value is File => value instanceof File && value.size > 0);
    const brandFile = formData.get("brandFile");

    if (evidenceFiles.length === 0) {
      return NextResponse.json(
        { error: "Upload at least one CSV, XLSX, or support file to start a generation run." },
        { status: 400 },
      );
    }

    const unsupportedEvidenceFile = evidenceFiles.find((file) => inferSourceFileKind(file.name) === "unknown");

    if (unsupportedEvidenceFile) {
      return NextResponse.json(
        {
          error: `Unsupported file type for ${unsupportedEvidenceFile.name}. Basquio accepts CSV/XLSX/XLS plus text, doc, PDF, PPTX, JSON, or CSS support files.`,
        },
        { status: 400 },
      );
    }

    if (!evidenceFiles.some((file) => inferSourceFileKind(file.name) === "workbook")) {
      return NextResponse.json(
        { error: "At least one CSV, XLSX, or XLS file is required so Basquio has a tabular source for deterministic analytics." },
        { status: 400 },
      );
    }

    if (brandFile instanceof File && brandFile.size > 0 && inferSourceFileKind(brandFile.name) === "unknown") {
      return NextResponse.json(
        { error: "Brand input must be a JSON/CSS token file, a PPTX template, or a PDF style reference." },
        { status: 400 },
      );
    }

    const jobId = `job-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const brief = {
      businessContext: String(formData.get("businessContext") ?? "").trim(),
      client: String(formData.get("client") ?? "").trim(),
      audience: String(formData.get("audience") ?? "Executive stakeholder").trim() || "Executive stakeholder",
      objective:
        String(formData.get("objective") ?? "Explain the business performance signal").trim() ||
        "Explain the business performance signal",
      thesis: String(formData.get("thesis") ?? "").trim(),
      stakes: String(formData.get("stakes") ?? "").trim(),
    };

    const summary = await runGenerationRequest({
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
        })),
      ),
      styleFile:
        brandFile instanceof File && brandFile.size > 0
          ? {
              fileName: brandFile.name,
              mediaType: brandFile.type || "application/octet-stream",
              kind: inferSourceFileKind(brandFile.name),
              base64: Buffer.from(await brandFile.arrayBuffer()).toString("base64"),
            }
          : undefined,
      brief,
      businessContext: brief.businessContext,
      client: brief.client,
      audience: brief.audience,
      objective: brief.objective,
      thesis: brief.thesis,
      stakes: brief.stakes,
    });

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
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
