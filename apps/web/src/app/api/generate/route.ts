import { randomUUID } from "node:crypto";

import { NextResponse, after } from "next/server";

import { inferSourceFileKind } from "@basquio/core";
import { interpretTemplateSource } from "@basquio/template-engine";
import type { GenerationRequest } from "@basquio/types";

import { dispatchPersistedGenerationExecution } from "@/lib/generation-requests";
import { normalizePersistedSourceFileKind } from "@/lib/source-file-kinds";
import { uploadToStorage } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { resolveOwnedTemplateProfileId } from "@/lib/template-profiles";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

type QueuedGenerationRequest = GenerationRequest & {
  templateProfileId?: string | null;
};

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
      ...(await queueGeneration(generationRequest, viewer.user, workspace, request)),
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function queueGeneration(
  generationRequest: QueuedGenerationRequest,
  viewer: NonNullable<Awaited<ReturnType<typeof getViewerState>>["user"]>,
  workspace: NonNullable<Awaited<ReturnType<typeof ensureViewerWorkspace>>>,
  request: Request,
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase credentials are required.");
  }

  const runId = randomUUID();
  const sourceFileIds: string[] = [];
  let styleSourceFileId: string | null = null;
  const queuedInputs = [
    ...generationRequest.sourceFiles.map((file) => ({ file, isStyle: false })),
    ...(generationRequest.styleFile ? [{ file: generationRequest.styleFile, isStyle: true }] : []),
  ];

  if (queuedInputs.length === 0) {
    throw new Error("At least one input file is required.");
  }

  const sourceFileRows = [];
  for (const { file, isStyle } of queuedInputs) {
    const fileId = randomUUID();
    const storageBucket = file.storageBucket ?? "source-files";
    const storagePath = file.storagePath ?? `${workspace.organizationId}/${workspace.projectId}/${fileId}/${file.fileName}`;
    const kind = normalizePersistedSourceFileKind(file.kind ?? null, file.fileName);

    if (file.base64) {
      await uploadToStorage({
        supabaseUrl,
        serviceKey,
        bucket: storageBucket,
        storagePath,
        body: Buffer.from(file.base64, "base64"),
        contentType: file.mediaType ?? "application/octet-stream",
      });
    } else if (!file.storagePath || !file.storageBucket) {
      throw new Error(`Input file ${file.fileName} is missing both inline content and storage metadata.`);
    }

    sourceFileIds.push(fileId);
    if (isStyle) {
      styleSourceFileId = fileId;
    }
    sourceFileRows.push({
      id: fileId,
      organization_id: workspace.organizationRowId,
      project_id: workspace.projectRowId,
      uploaded_by: viewer.id,
      kind,
      file_name: file.fileName,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      file_bytes: file.fileBytes ?? 0,
    });
  }

  const insertResponse = await fetch(`${supabaseUrl}/rest/v1/source_files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(sourceFileRows),
  });

  if (!insertResponse.ok) {
    const errorText = await insertResponse.text().catch(() => "Unknown error");
    throw new Error(`Failed to create source_files records: ${errorText}`);
  }

  // Use saved template if provided, otherwise interpret uploaded style file
  let templateProfileId = await resolveOwnedTemplateProfileId({
    supabaseUrl,
    serviceKey,
    organizationId: workspace.organizationRowId,
    templateProfileId: ((generationRequest as Record<string, unknown>).templateProfileId as string | undefined) ?? null,
  });
  if (!templateProfileId && generationRequest.styleFile) {
    try {
      const sf = generationRequest.styleFile;
      const tpId = randomUUID();

      // Get file content: either from base64 or download from Storage
      let base64 = sf.base64;
      if (!base64 && sf.storagePath && sf.storageBucket) {
        const dlResponse = await fetch(
          `${supabaseUrl}/storage/v1/object/${sf.storageBucket}/${sf.storagePath}`,
          { headers: { Authorization: `Bearer ${serviceKey}` } },
        );
        if (dlResponse.ok) {
          const buf = Buffer.from(await dlResponse.arrayBuffer());
          base64 = buf.toString("base64");
        }
      }

      if (base64) {
        const profile = await interpretTemplateSource({
          id: tpId,
          sourceFile: {
            fileName: sf.fileName,
            base64,
            mediaType: sf.mediaType ?? "application/octet-stream",
          },
          fileName: sf.fileName,
        });

        await fetch(`${supabaseUrl}/rest/v1/template_profiles`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            id: tpId,
            organization_id: workspace.organizationRowId,
            source_file_id: styleSourceFileId,
            source_type: profile.sourceType ?? "pptx",
            template_profile: profile,
          }),
        });

        templateProfileId = tpId;
      }
    } catch {
      // Template interpretation is best-effort — proceed without it
    }
  }

  const deckRunResponse = await fetch(`${supabaseUrl}/rest/v1/deck_runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      id: runId,
      organization_id: workspace.organizationRowId,
      project_id: workspace.projectRowId,
      requested_by: viewer.id,
      brief: {
        businessContext: generationRequest.brief.businessContext,
        client: generationRequest.brief.client,
        audience: generationRequest.brief.audience,
        objective: generationRequest.brief.objective,
        thesis: generationRequest.brief.thesis,
        stakes: generationRequest.brief.stakes,
      },
      business_context: generationRequest.brief.businessContext,
      client: generationRequest.brief.client,
      audience: generationRequest.brief.audience,
      objective: generationRequest.brief.objective,
      thesis: generationRequest.brief.thesis,
      stakes: generationRequest.brief.stakes,
      source_file_ids: sourceFileIds,
      template_profile_id: templateProfileId ?? null,
      status: "queued",
    }),
  });

  if (!deckRunResponse.ok) {
    const errorText = await deckRunResponse.text().catch(() => "Unknown error");
    throw new Error(`Failed to create deck_runs record: ${errorText}`);
  }

  after(async () => {
    const dispatched = await dispatchPersistedGenerationExecution(runId, request);

    if (!dispatched) {
      await fetch(`${supabaseUrl}/rest/v1/deck_runs?id=eq.${runId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          status: "failed",
          failure_phase: "normalize",
          failure_message: "Failed to dispatch deck generation worker.",
          updated_at: new Date().toISOString(),
        }),
      }).catch(() => {});
    }
  });

  return {
    jobId: runId,
    status: "queued",
    statusUrl: `/api/jobs/${runId}`,
    progressUrl: `/jobs/${runId}`,
    message: "Basquio accepted the run and started generation.",
  };
}

async function parseGenerationRequest(
  request: Request,
  workspace: NonNullable<Awaited<ReturnType<typeof ensureViewerWorkspace>>>,
): Promise<QueuedGenerationRequest> {
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
      templateProfileId: ((payload as Record<string, unknown>).templateProfileId as string | undefined) ?? null,
    };
  }

  const formData = await request.formData();
  const evidenceFiles = formData.getAll("evidenceFiles").filter((value): value is File => value instanceof File && value.size > 0);
  const brandFile = formData.get("brandFile");
  const templateProfileId = String(formData.get("templateProfileId") ?? "") || null;
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
    templateProfileId,
  };
}

function validateGenerationFiles(
  sourceFiles: Array<NonNullable<GenerationRequest["sourceFiles"]>[number]>,
  styleFile?: GenerationRequest["styleFile"],
) {
  if (sourceFiles.length === 0) {
    return "Upload at least one data file (CSV, XLSX, PPTX, PDF, image, or document) to start a generation run.";
  }

  const unsupportedEvidenceFile = sourceFiles.find((file) => inferSourceFileKind(file.fileName) === "unknown");

  if (unsupportedEvidenceFile) {
    return `Unsupported file type for ${unsupportedEvidenceFile.fileName}. Basquio accepts CSV/XLSX/XLS plus text, doc, PDF, PPTX, JSON, or CSS support files.`;
  }

  // Any evidence file type is valid — CSV, XLSX, PPTX, PDF, images, etc.
  // No requirement for tabular data specifically.

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
