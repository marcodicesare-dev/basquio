import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { inferSourceFileKind } from "@basquio/core";
import type { GenerationRequest } from "@basquio/types";

import { normalizePlanId } from "@/lib/billing-config";
import { normalizePersistedSourceFileKind } from "@/lib/source-file-kinds";
import { DEFAULT_AUTHOR_MODEL, assertValidSlideCount, calculateRunCredits, ensureFreeTierCredit, getActiveSubscription } from "@/lib/credits";
import { callRpc, deleteRestRows, fetchRestRows, removeStorageObjects, uploadToStorage } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { getTemplateFeeDraft, updateTemplateFeeDraft } from "@/lib/template-fee-drafts";
import { resolveOwnedTemplateProfileId } from "@/lib/template-profiles";
import { hasUnlimitedAccess } from "@/lib/unlimited-access";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

class TemplateNotImportedError extends Error {
  constructor() {
    super("Import your template from the Templates page first, then select it here. Use Basquio Standard for this run in the meantime.");
  }
}

class InsufficientCreditsError extends Error {
  constructor(readonly creditsNeeded: number, readonly targetSlideCount: number) {
    super(`Not enough credits. This ${targetSlideCount}-slide deck needs ${creditsNeeded} credits.`);
  }
}

class BillingUnavailableError extends Error {
  constructor() {
    super("Billing system unavailable. Please try again.");
  }
}

class InvalidGenerationRequestError extends Error {}
class TemplateFeeRequiredError extends Error {
  constructor() {
    super("Free-plan custom-template runs require the one-time template fee. Resume through /jobs/new after checkout.");
  }
}

const AUTHOR_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Map UI tier names to internal model names. */
const TIER_TO_MODEL: Record<string, string> = {
  memo: "claude-haiku-4-5",
  deck: "claude-sonnet-4-6",
  "deep-dive": "claude-opus-4-6",
};

type QueuedGenerationRequest = GenerationRequest & {
  templateProfileId?: string | null;
  draftId?: string | null;
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
    const draftId = generationRequest.draftId ?? null;
    const existingSourceFileIds = (generationRequest as Record<string, unknown>).existingSourceFileIds as string[] | undefined;
    const hasExistingFiles = (existingSourceFileIds?.length ?? 0) > 0;
    const validationError = draftId
      ? null
      : validateGenerationFiles(generationRequest.sourceFiles, generationRequest.styleFile, hasExistingFiles);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // ─── CREDIT CHECK ──────────────────────────────────────────
    // Only enforce credits when STRIPE_SECRET_KEY is configured.
    // This allows the app to work without billing during development
    // and prevents blocking users if the credit migration hasn't been applied.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const billingEnabled = !!process.env.STRIPE_SECRET_KEY;
    const runId = UUID_RE.test(generationRequest.jobId ?? "") ? generationRequest.jobId : randomUUID();

    const hasUnlimitedUsage = hasUnlimitedAccess(viewer.user.email);
    const subscription =
      billingEnabled && supabaseUrl && serviceKey && !hasUnlimitedUsage
        ? await getActiveSubscription({ supabaseUrl, serviceKey, userId: viewer.user.id })
        : null;
    const currentPlan = normalizePlanId(subscription?.plan ?? "free");
    const targetSlideCount = requireValidTargetSlideCount(
      generationRequest.targetSlideCount ?? 10,
    );
    const authorModel = requireValidAuthorModel(generationRequest.authorModel ?? DEFAULT_AUTHOR_MODEL);
    const creditsNeeded = calculateRunCredits(targetSlideCount, authorModel);

    if (billingEnabled && supabaseUrl && serviceKey && !hasUnlimitedUsage) {
      await ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: viewer.user.id });
    }

    return NextResponse.json({
      ...(await queueGeneration(generationRequest, viewer.user, workspace, runId, {
        chargeCredits: billingEnabled && !hasUnlimitedUsage,
        creditAmount: creditsNeeded,
        requireTemplateFee: currentPlan === "free" && !hasUnlimitedUsage,
      })),
    }, { status: 202 });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({
        error: error.message,
        code: "NO_CREDITS",
        pricingUrl: "/pricing",
      }, { status: 402 });
    }
    if (error instanceof BillingUnavailableError) {
      return NextResponse.json({
        error: error.message,
        code: "BILLING_ERROR",
        pricingUrl: "/pricing",
      }, { status: 503 });
    }
    if (error instanceof InvalidGenerationRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof TemplateNotImportedError) {
      return NextResponse.json({ error: error.message, code: "TEMPLATE_NOT_IMPORTED" }, { status: 400 });
    }
    if (error instanceof TemplateFeeRequiredError) {
      return NextResponse.json({ error: error.message, code: "TEMPLATE_FEE_REQUIRED" }, { status: 402 });
    }
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function queueGeneration(
  generationRequest: QueuedGenerationRequest,
  viewer: NonNullable<Awaited<ReturnType<typeof getViewerState>>["user"]>,
  workspace: NonNullable<Awaited<ReturnType<typeof ensureViewerWorkspace>>>,
  runId: string,
  billing: {
    chargeCredits: boolean;
    creditAmount: number;
    requireTemplateFee: boolean;
  },
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase credentials are required.");
  }
  let targetSlideCount = requireValidTargetSlideCount(
    generationRequest.targetSlideCount ?? 10,
  );
  let authorModel = requireValidAuthorModel(generationRequest.authorModel ?? DEFAULT_AUTHOR_MODEL);
  let recipeId = generationRequest.recipeId ?? null;
  const pendingDraft = generationRequest.draftId
    ? await getTemplateFeeDraft({
        supabaseUrl,
        serviceKey,
        draftId: generationRequest.draftId,
        userId: viewer.id,
      })
    : null;

  if (generationRequest.draftId && !pendingDraft) {
    throw new InvalidGenerationRequestError("Template-fee draft not found.");
  }

  if (pendingDraft) {
    if (pendingDraft.status === "consumed") {
      throw new InvalidGenerationRequestError("This template-fee draft was already used.");
    }
    if (new Date(pendingDraft.expires_at).getTime() <= Date.now()) {
      await updateTemplateFeeDraft({
        supabaseUrl,
        serviceKey,
        draftId: pendingDraft.id,
        userId: viewer.id,
        patch: { status: "expired" },
      }).catch(() => {});
      throw new InvalidGenerationRequestError("This template-fee draft expired. Start a new run from /jobs/new.");
    }
    if (pendingDraft.status !== "paid") {
      throw new InvalidGenerationRequestError("This template-fee draft is not paid yet.");
    }
    targetSlideCount = requireValidTargetSlideCount(pendingDraft.target_slide_count);
    authorModel = requireValidAuthorModel(pendingDraft.author_model);
    recipeId = pendingDraft.recipe_id;
  }

  const sourceFileIds = await resolveValidatedExistingSourceFileIds({
    supabaseUrl,
    serviceKey,
    organizationId: workspace.organizationRowId,
    projectId: workspace.projectRowId,
    existingSourceFileIds: pendingDraft
      ? pendingDraft.source_file_ids
      : (((generationRequest as Record<string, unknown>).existingSourceFileIds as string[] | undefined) ?? []),
  });

  const queuedInputs = pendingDraft ? [] : [
    ...generationRequest.sourceFiles.map((file) => ({ file, isStyle: false })),
    ...(generationRequest.styleFile ? [{ file: generationRequest.styleFile, isStyle: true }] : []),
  ];

  if (queuedInputs.length === 0 && sourceFileIds.length === 0) {
    throw new Error("At least one input file is required.");
  }

  const sourceFileRows = [];
  for (const { file } of queuedInputs) {
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

  if (sourceFileRows.length > 0) {
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
  }

  // Resolve template: saved profile ID or Basquio Standard
  let templateProfileId = pendingDraft
    ? pendingDraft.template_profile_id
    : await resolveOwnedTemplateProfileId({
        supabaseUrl,
        serviceKey,
        organizationId: workspace.organizationRowId,
        templateProfileId: ((generationRequest as Record<string, unknown>).templateProfileId as string | undefined) ?? null,
      });
  const createdTemplateProfileId: string | null = null;

  // Verify the resolved template is actually ready (not processing or failed)
  if (templateProfileId) {
    try {
      const tpCheck = await fetch(
        `${supabaseUrl}/rest/v1/template_profiles?id=eq.${templateProfileId}&select=status&limit=1`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      );
      if (tpCheck.ok) {
        const rows = await tpCheck.json();
        const status = rows[0]?.status;
        if (status && status !== "ready") {
          // Template is not ready — fall through to Basquio Standard
          templateProfileId = null;
        }
      }
    } catch {
      // Check failed — proceed with the template anyway
    }
  }

  // Reject inline style file interpretation — templates must be imported first
  if (!templateProfileId && generationRequest.styleFile) {
    throw new TemplateNotImportedError();
  }

  if (billing.requireTemplateFee && templateProfileId && !pendingDraft) {
    throw new TemplateFeeRequiredError();
  }

  // Template fidelity: when a saved workspace template is selected, include the
  // original imported PPTX source_file on the run. The worker can then upload
  // the real template binary into the authoring container instead of relying
  // only on the reduced TemplateProfile tokens.
  if (templateProfileId) {
    try {
      const templateResponse = await fetch(
        `${supabaseUrl}/rest/v1/template_profiles?id=eq.${templateProfileId}&select=source_file_id,status&limit=1`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        },
      );
      if (templateResponse.ok) {
        const templateRows = await templateResponse.json();
        const templateSourceFileId = templateRows[0]?.source_file_id as string | undefined;
        if (templateSourceFileId && !sourceFileIds.includes(templateSourceFileId)) {
          sourceFileIds.push(templateSourceFileId);
        }
      }
    } catch {
      // Best-effort only. Runs can still proceed with the parsed template profile.
    }
  }

  // Resolve account-level notification preference (default: true)
  let notifyOnComplete = true;
  const effectiveBrief = pendingDraft
    ? {
        businessContext: pendingDraft.brief.businessContext ?? "",
        client: pendingDraft.brief.client ?? "",
        audience: pendingDraft.brief.audience ?? "Executive stakeholder",
        objective: pendingDraft.brief.objective ?? "Explain the business performance signal",
        thesis: pendingDraft.brief.thesis ?? "",
        stakes: pendingDraft.brief.stakes ?? "",
      }
    : generationRequest.brief;
  try {
    const prefResponse = await fetch(`${supabaseUrl}/rest/v1/user_preferences?user_id=eq.${viewer.id}&select=notify_on_run_complete&limit=1`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });
    if (prefResponse.ok) {
      const prefs = await prefResponse.json();
      if (prefs.length > 0 && typeof prefs[0].notify_on_run_complete === "boolean") {
        notifyOnComplete = prefs[0].notify_on_run_complete;
      }
    }
  } catch {
    // Default to true if preference lookup fails
  }

  try {
    const attemptId = randomUUID();
    try {
      const enqueueRows = await callRpc<Array<{
        run_id: string | null;
        attempt_id: string | null;
        insufficient_credits: boolean;
      }>>({
        supabaseUrl,
        serviceKey,
        functionName: "enqueue_deck_run",
        params: {
          p_run_id: runId,
          p_attempt_id: attemptId,
          p_organization_id: workspace.organizationRowId,
          p_project_id: workspace.projectRowId,
          p_requested_by: viewer.id,
          p_brief: {
            businessContext: effectiveBrief.businessContext,
            client: effectiveBrief.client,
            audience: effectiveBrief.audience,
            objective: effectiveBrief.objective,
            thesis: effectiveBrief.thesis,
            stakes: effectiveBrief.stakes,
          },
          p_business_context: effectiveBrief.businessContext,
          p_client: effectiveBrief.client,
          p_audience: effectiveBrief.audience,
          p_objective: effectiveBrief.objective,
          p_thesis: effectiveBrief.thesis,
          p_stakes: effectiveBrief.stakes,
          p_source_file_ids: sourceFileIds,
          p_target_slide_count: targetSlideCount,
          p_author_model: authorModel,
          p_template_profile_id: templateProfileId ?? null,
          p_recipe_id: recipeId ?? null,
          p_notify_on_complete: notifyOnComplete,
          p_charge_credits: billing.chargeCredits,
          p_credit_amount: billing.chargeCredits ? billing.creditAmount : null,
        },
      });
      const enqueueResult = enqueueRows[0];
      if (!enqueueResult) {
        throw billing.chargeCredits ? new BillingUnavailableError() : new Error("Run enqueue RPC returned no result.");
      }
      if (enqueueResult.insufficient_credits) {
        throw new InsufficientCreditsError(billing.creditAmount, targetSlideCount);
      }
      if (!enqueueResult.run_id || !enqueueResult.attempt_id) {
        throw new Error("Run enqueue did not return durable run lineage.");
      }
      if (pendingDraft) {
        await updateTemplateFeeDraft({
          supabaseUrl,
          serviceKey,
          draftId: pendingDraft.id,
          userId: viewer.id,
          patch: {
            status: "consumed",
            consumed_at: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      if (billing.chargeCredits && !(error instanceof InsufficientCreditsError)) {
        throw new BillingUnavailableError();
      }
      throw error;
    }
  } catch (error) {
    await cleanupQueuedGenerationSetup({
      supabaseUrl,
      serviceKey,
      runId,
      sourceFiles: sourceFileRows.map((row) => ({
        id: row.id,
        bucket: row.storage_bucket,
        storagePath: row.storage_path,
      })),
      templateProfileId: createdTemplateProfileId,
    });
    throw error;
  }

  return {
    jobId: runId,
    status: "queued",
    statusUrl: `/api/jobs/${runId}`,
    progressUrl: `/jobs/${runId}`,
    message: "Basquio accepted the run and started generation.",
  };
}

async function cleanupQueuedGenerationSetup(input: {
  supabaseUrl: string;
  serviceKey: string;
  runId: string;
  sourceFiles: Array<{ id: string; bucket: string; storagePath: string }>;
  templateProfileId: string | null;
}) {
  const storageByBucket = new Map<string, string[]>();
  for (const file of input.sourceFiles) {
    const existing = storageByBucket.get(file.bucket) ?? [];
    existing.push(file.storagePath);
    storageByBucket.set(file.bucket, existing);
  }

  await Promise.all([
    deleteRunAttemptRows(input.supabaseUrl, input.serviceKey, input.runId).catch(() => {}),
    deleteRestRows({
      supabaseUrl: input.supabaseUrl,
      serviceKey: input.serviceKey,
      table: "deck_runs",
      query: { id: `eq.${input.runId}` },
    }).catch(() => {}),
    ...(input.templateProfileId ? [
      deleteRestRows({
        supabaseUrl: input.supabaseUrl,
        serviceKey: input.serviceKey,
        table: "template_profiles",
        query: { id: `eq.${input.templateProfileId}` },
      }).catch(() => {}),
    ] : []),
    ...(input.sourceFiles.length > 0 ? [
      deleteRestRows({
        supabaseUrl: input.supabaseUrl,
        serviceKey: input.serviceKey,
        table: "source_files",
        query: { id: `in.(${input.sourceFiles.map((file) => file.id).join(",")})` },
      }).catch(() => {}),
    ] : []),
    ...[...storageByBucket.entries()].map(([bucket, paths]) => (
      removeStorageObjects({
        supabaseUrl: input.supabaseUrl,
        serviceKey: input.serviceKey,
        bucket,
        paths,
      }).catch(() => {})
    )),
  ]);
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
      draftId: ((payload as Record<string, unknown>).draftId as string | undefined) ?? null,
      targetSlideCount: payload.targetSlideCount ?? 10,
      authorModel: payload.authorModel ?? DEFAULT_AUTHOR_MODEL,
      recipeId: payload.recipeId ?? null,
      existingSourceFileIds: payload.existingSourceFileIds ?? undefined,
    } as QueuedGenerationRequest;
  }

  const formData = await request.formData();
  const evidenceFiles = formData.getAll("evidenceFiles").filter((value): value is File => value instanceof File && value.size > 0);
  const brandFile = formData.get("brandFile");
  const templateProfileId = String(formData.get("templateProfileId") ?? "") || null;
  const targetSlideCount = Number.parseInt(String(formData.get("targetSlideCount") ?? "10"), 10) || 10;
  const authorModel = String(formData.get("authorModel") ?? DEFAULT_AUTHOR_MODEL);
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
    targetSlideCount,
    authorModel,
    recipeId: String(formData.get("recipeId") ?? "") || null,
  } as QueuedGenerationRequest;
}

function validateGenerationFiles(
  sourceFiles: Array<NonNullable<GenerationRequest["sourceFiles"]>[number]>,
  styleFile?: GenerationRequest["styleFile"],
  hasExistingFiles = false,
) {
  if (sourceFiles.length === 0 && !hasExistingFiles) {
    return "Upload at least one supported evidence file to start a generation run.";
  }

  const unsupportedEvidenceFile = sourceFiles.find((file) => inferSourceFileKind(file.fileName) === "unknown");

  if (unsupportedEvidenceFile) {
    return `Unsupported file type for ${unsupportedEvidenceFile.fileName}. Basquio accepts CSV/XLSX/XLS plus text, doc, PDF, PPTX, JSON, or CSS support files.`;
  }

  if (styleFile && !["brand-tokens", "pptx", "pdf"].includes(inferSourceFileKind(styleFile.fileName))) {
    return "Brand input must be a JSON/CSS token file, a PPTX template, or a PDF style reference.";
  }

  return null;
}

async function resolveValidatedExistingSourceFileIds(input: {
  supabaseUrl: string;
  serviceKey: string;
  organizationId: string;
  projectId: string;
  existingSourceFileIds: string[];
}) {
  const uniqueIds = [...new Set(input.existingSourceFileIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const rows = await fetchRestRows<{ id: string }>({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    table: "source_files",
    query: {
      select: "id",
      organization_id: `eq.${input.organizationId}`,
      project_id: `eq.${input.projectId}`,
      id: `in.(${uniqueIds.join(",")})`,
    },
  });
  const ownedIds = new Set(rows.map((row) => row.id));

  if (ownedIds.size !== uniqueIds.length) {
    throw new InvalidGenerationRequestError("One or more reused source files do not belong to this workspace.");
  }

  return uniqueIds;
}

function requireValidTargetSlideCount(targetSlideCount: number) {
  try {
    return assertValidSlideCount(targetSlideCount);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid targetSlideCount.";
    throw new InvalidGenerationRequestError(message);
  }
}

function requireValidAuthorModel(authorModel: string) {
  // Accept tier names (memo/deck/deep-dive) and resolve to model names
  const resolved = TIER_TO_MODEL[authorModel] ?? authorModel;

  if (!AUTHOR_MODELS.has(resolved)) {
    throw new InvalidGenerationRequestError("authorModel must be claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5, or a tier name (memo, deck, deep-dive).");
  }

  return resolved;
}

async function deleteRunAttemptRows(supabaseUrl: string, serviceKey: string, runId: string) {
  const url = new URL("/rest/v1/deck_run_attempts", supabaseUrl);
  url.searchParams.set("run_id", `eq.${runId}`);

  await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
    cache: "no-store",
  });
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
