import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { normalizePlanId } from "@/lib/billing-config";
import { DEFAULT_AUTHOR_MODEL, assertValidSlideCount, calculateRunCredits, ensureFreeTierCredit, getDetailedCreditBalance } from "@/lib/credits";
import { getActiveSubscription } from "@/lib/credits";
import { normalizePersistedSourceFileKind } from "@/lib/source-file-kinds";
import { callRpc, deleteRestRows, removeStorageObjects, uploadToStorage } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { hasUnlimitedAccess } from "@/lib/unlimited-access";
import { resolveOwnedTemplateProfileId } from "@/lib/template-profiles";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

class InvalidGenerationRequestError extends Error {}

const AUTHOR_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
]);

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Supabase credentials are required." }, { status: 500 });
    }

    const viewer = await getViewerState();
    if (!viewer.user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const workspace = await ensureViewerWorkspace(viewer.user);
    if (!workspace) {
      return NextResponse.json({ error: "Unable to resolve workspace." }, { status: 500 });
    }

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const brief = formData.get("brief") as string ?? "";
    const client = formData.get("client") as string ?? "";
    const audience = formData.get("audience") as string ?? "Executive stakeholder";
    const objective = formData.get("objective") as string ?? "";
    const thesis = formData.get("thesis") as string ?? "";
    const stakes = formData.get("stakes") as string ?? "";
    const targetSlideCount = requireValidTargetSlideCount(Number.parseInt(String(formData.get("targetSlideCount") ?? "10"), 10) || 10);
    const authorModel = requireValidAuthorModel(String(formData.get("authorModel") ?? DEFAULT_AUTHOR_MODEL));
    const templateProfileId = await resolveOwnedTemplateProfileId({
      supabaseUrl,
      serviceKey,
      organizationId: workspace.organizationRowId,
      templateProfileId: formData.get("templateProfileId") as string | null,
    });

    if (files.length === 0) {
      return NextResponse.json({ error: "At least one source file is required." }, { status: 400 });
    }

    // ─── CREDIT CHECK (same logic as v1 /api/generate) ───────
    const billingEnabled = !!process.env.STRIPE_SECRET_KEY;
    const hasUnlimitedUsage = hasUnlimitedAccess(viewer.user.email);
    const creditsNeeded = calculateRunCredits(targetSlideCount, authorModel);
    const subscription =
      billingEnabled && !hasUnlimitedUsage
        ? await getActiveSubscription({ supabaseUrl, serviceKey, userId: viewer.user.id })
        : null;
    const currentPlan = normalizePlanId(subscription?.plan ?? "free");

    if (billingEnabled && supabaseUrl && serviceKey && !hasUnlimitedUsage) {
      await ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: viewer.user.id });
    }

    if (currentPlan === "free" && templateProfileId) {
      return NextResponse.json({
        error: "Free-plan custom-template runs must start from /jobs/new so Basquio can stage the template-fee checkout and resume safely.",
        code: "TEMPLATE_FEE_REQUIRED",
      }, { status: 402 });
    }

    const chargeCredits = billingEnabled && !hasUnlimitedUsage;

    const runId = randomUUID();

    // Upload source files to storage and create source_file records
    // Detect PPTX template files (user uploads their corporate template alongside data files)
    const sourceFileIds: string[] = [];
    const uploadedSourceFiles: Array<{ id: string; bucket: string; storagePath: string }> = [];
    for (const file of files) {
      const fileId = randomUUID();
      const kind = normalizePersistedSourceFileKind(null, file.name);
      const storagePath = `${workspace.organizationId}/${workspace.projectId}/${fileId}/${file.name}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      await uploadToStorage({
        supabaseUrl,
        serviceKey,
        bucket: "source-files",
        storagePath,
        body: buffer,
        contentType: file.type || "application/octet-stream",
      });

      // Create source_file record
      const sfResponse = await fetch(
        `${supabaseUrl}/rest/v1/source_files`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            id: fileId,
            organization_id: workspace.organizationRowId,
            project_id: workspace.projectRowId,
            uploaded_by: viewer.user.id,
            kind,
            file_name: file.name,
            storage_bucket: "source-files",
            storage_path: storagePath,
            file_bytes: buffer.length,
          }),
        },
      );

      if (!sfResponse.ok) {
        await removeStorageObjects({
          supabaseUrl,
          serviceKey,
          bucket: "source-files",
          paths: [storagePath],
        }).catch(() => {});
        return NextResponse.json({ error: `Failed to register source file: ${file.name}` }, { status: 500 });
      }

      sourceFileIds.push(fileId);
      uploadedSourceFiles.push({
        id: fileId,
        bucket: "source-files",
        storagePath,
      });
    }

    // Resolve account-level notification preference (default: true)
    let notifyOnComplete = true;
    try {
      const prefResponse = await fetch(`${supabaseUrl}/rest/v1/user_preferences?user_id=eq.${viewer.user.id}&select=notify_on_run_complete&limit=1`, {
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
          p_requested_by: viewer.user.id,
          p_brief: { businessContext: brief, client, audience, objective, thesis, stakes },
          p_business_context: brief,
          p_client: client,
          p_audience: audience,
          p_objective: objective,
          p_thesis: thesis,
          p_stakes: stakes,
          p_source_file_ids: sourceFileIds,
          p_target_slide_count: targetSlideCount,
          p_author_model: authorModel,
          p_template_profile_id: templateProfileId,
          p_notify_on_complete: notifyOnComplete,
          p_charge_credits: chargeCredits,
          p_credit_amount: chargeCredits ? creditsNeeded : null,
        },
      });
      const enqueueResult = enqueueRows[0];
      if (enqueueResult?.insufficient_credits) {
        const balance = await getDetailedCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id });
        await cleanupQueuedV2RunSetup({ supabaseUrl, serviceKey, runId, sourceFiles: uploadedSourceFiles });
        return NextResponse.json({
          error: `Not enough credits. This ${targetSlideCount}-slide run needs ${creditsNeeded} credits.`,
          code: "NO_CREDITS",
          pricingUrl: "/pricing",
          creditsNeeded,
          creditsAvailable: balance.balance,
        }, { status: 402 });
      }
      if (!enqueueResult?.run_id || !enqueueResult?.attempt_id) {
        throw new Error("Failed to create durable run lineage.");
      }
    } catch (error) {
      await cleanupQueuedV2RunSetup({
        supabaseUrl,
        serviceKey,
        runId,
        sourceFiles: uploadedSourceFiles,
      });
      const message = error instanceof Error ? error.message : "Failed to attach attempt lineage.";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json(
      {
        runId,
        status: "queued",
        statusUrl: `/api/v2/runs/${runId}`,
        progressUrl: `/jobs/${runId}`,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof InvalidGenerationRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
  if (!AUTHOR_MODELS.has(authorModel)) {
    throw new InvalidGenerationRequestError("authorModel must be claude-sonnet-4-6, claude-opus-4-6, or claude-haiku-4-5.");
  }

  return authorModel;
}

async function cleanupQueuedV2RunSetup(input: {
  supabaseUrl: string;
  serviceKey: string;
  runId: string;
  sourceFiles: Array<{ id: string; bucket: string; storagePath: string }>;
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
