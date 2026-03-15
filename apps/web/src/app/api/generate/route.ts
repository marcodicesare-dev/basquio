import { randomUUID } from "node:crypto";

import { after, NextResponse } from "next/server";

import { inferSourceFileKind } from "@basquio/core";
import { GenerationValidationError, inngest } from "@basquio/workflows";
import type { GenerationRequest } from "@basquio/types";

import {
  dispatchPersistedGenerationExecution,
  dispatchPersistedGenerationJob,
  persistGenerationRequest,
} from "@/lib/generation-requests";
import { getViewerState } from "@/lib/supabase/auth";
import { upsertRestRows } from "@/lib/supabase/admin";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

const INNGEST_RECOVERY_GRACE_MS = 15_000;

export async function POST(request: Request) {
  try {
    const viewer = await getViewerState();

    if (!viewer.user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const workspace = await ensureViewerWorkspace(viewer.user);

    if (!workspace) {
      return NextResponse.json({ error: "Unable to resolve a personal Basquio workspace for this user." }, { status: 500 });
    }

    const generationRequest = await parseGenerationRequest(request, workspace);
    const validationError = validateGenerationFiles(generationRequest.sourceFiles, generationRequest.styleFile);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    return NextResponse.json({
      ...(await queueGeneration(generationRequest, request, viewer.user)),
    }, { status: 202 });
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

async function queueGeneration(
  generationRequest: GenerationRequest,
  request: Request,
  viewer: NonNullable<Awaited<ReturnType<typeof getViewerState>>["user"]>,
) {
  await persistQueuedJob(generationRequest, viewer);
  await persistGenerationRequest(generationRequest);

  if (process.env.INNGEST_EVENT_KEY) {
    await inngest.send({
      name: "basquio/generation.requested",
      data: generationRequest,
    });

    after(() => {
      void wait(INNGEST_RECOVERY_GRACE_MS)
        .then(() => dispatchPersistedGenerationExecution(generationRequest.jobId, request))
        .catch((error) => {
          console.error(`Basquio initial execute fallback failed for ${generationRequest.jobId}`, error);
        });
    });
  } else {
    await dispatchPersistedGenerationJob(generationRequest.jobId, request);
  }

  return {
    jobId: generationRequest.jobId,
    status: "queued",
    statusUrl: `/api/jobs/${generationRequest.jobId}`,
    progressUrl: `/jobs/${generationRequest.jobId}`,
    message: "Basquio accepted the run and started the generation workflow.",
  };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function parseGenerationRequest(
  request: Request,
  workspace: NonNullable<Awaited<ReturnType<typeof ensureViewerWorkspace>>>,
): Promise<GenerationRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as Partial<GenerationRequest>;
    const brief = buildBrief(payload);

    return {
      jobId: payload.jobId || createJobId(),
      organizationId: workspace.organizationId,
      projectId: workspace.projectId,
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
    organizationId: workspace.organizationId,
    projectId: workspace.projectId,
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

async function persistQueuedJob(
  generationRequest: GenerationRequest,
  viewer: NonNullable<Awaited<ReturnType<typeof getViewerState>>["user"]>,
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return;
  }

  const { organizationRowId, projectRowId } = await resolveQueuedRunContext({
    supabaseUrl,
    serviceKey,
    organizationId: generationRequest.organizationId,
    projectId: generationRequest.projectId,
    objective: generationRequest.brief.objective,
    audience: generationRequest.brief.audience,
    requestedBy: viewer.id,
  });

  await upsertRestRows({
    supabaseUrl,
    serviceKey,
    table: "generation_jobs",
    onConflict: "job_key",
    rows: [
      {
        job_key: generationRequest.jobId,
        organization_id: organizationRowId,
        project_id: projectRowId,
        requested_by: viewer.id,
        status: "queued",
        business_context: generationRequest.brief.businessContext,
        audience: generationRequest.brief.audience,
        objective: generationRequest.brief.objective,
        brief: generationRequest.brief,
        failure_message: null,
      },
    ],
  });
}

async function resolveQueuedRunContext(input: {
  supabaseUrl: string;
  serviceKey: string;
  organizationId: string;
  projectId: string;
  objective: string;
  audience: string;
  requestedBy: string;
}) {
  const organizationSlug = sanitizeQueueSlug(input.organizationId || "local-org");
  const projectSlug = sanitizeQueueSlug(input.projectId || "local-project");

  const organizations = await upsertRestRows<{ id: string }>({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    table: "organizations",
    onConflict: "slug",
    select: "id",
    rows: [
      {
        slug: organizationSlug,
        name: humanizeQueueLabel(input.organizationId || "Local org"),
      },
    ],
  });

  if (!organizations[0]?.id) {
    throw new Error(`Unable to resolve organization row for ${input.organizationId}.`);
  }

  const projects = await upsertRestRows<{ id: string }>({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    table: "projects",
    onConflict: "organization_id,slug",
    select: "id",
    rows: [
      {
        organization_id: organizations[0].id,
        slug: projectSlug,
        name: humanizeQueueLabel(input.projectId || "Local project"),
        objective: input.objective,
        audience: input.audience,
      },
    ],
  });

  if (!projects[0]?.id) {
    throw new Error(`Unable to resolve project row for ${input.projectId}.`);
  }

  await upsertRestRows({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    table: "organization_memberships",
    onConflict: "organization_id,user_id",
    rows: [
      {
        organization_id: organizations[0].id,
        user_id: input.requestedBy,
        role: "owner",
      },
    ],
  });

  return {
    organizationRowId: organizations[0].id,
    projectRowId: projects[0].id,
  };
}

function sanitizeQueueSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function humanizeQueueLabel(value: string) {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
