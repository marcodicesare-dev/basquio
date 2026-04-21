import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import type { WorkspaceContextPack } from "@basquio/types";

import {
  DEFAULT_AUTHOR_MODEL,
  MAX_TARGET_SLIDES,
  calculateRunCredits,
  ensureFreeTierCredit,
  getActiveSubscription,
  getDetailedCreditBalance,
  normalizeAuthorModelId,
  STANDARD_PLAN_MAX_TARGET_SLIDES,
  assertValidSlideCount,
} from "@/lib/credits";
import { callRpc } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { isTeamBetaEmail } from "@/lib/team-beta";
import { normalizePlanId } from "@/lib/billing-config";
import { hasUnlimitedAccess } from "@/lib/unlimited-access";
import { resolveOwnedTemplateProfileId } from "@/lib/template-profiles";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";
import {
  hashWorkspaceContextPack,
  loadPersistedRunWorkspaceContextPack,
  loadSourceFilesForWorkspaceContext,
  parseWorkspaceContextPack,
  resolveAuthoritativeWorkspaceContextPack,
} from "@/lib/workspace-context-pack";

export const runtime = "nodejs";
export const maxDuration = 60;

const briefSchema = z.object({
  title: z.string().min(1).max(240),
  objective: z.string().min(1).max(1200),
  narrative: z.string().min(1).max(10000),
  audience: z.string().min(1).max(240),
  thesis: z.string().max(1200).default(""),
  stakes: z.string().max(1200).default(""),
  slideCount: z.number().int().min(5).max(60),
});

const bodySchema = z.object({
  // Posted pack is validated with the canonical schema server-side via
  // parseWorkspaceContextPack and then canonicalized against real
  // attached source_files before anything is persisted. Clients cannot
  // spoof source_files, memory rules, or lineage — only the brief text
  // and slide count they chose in the drawer survive verbatim.
  pack: z.unknown(),
  brief: briefSchema,
  authorModel: z.string().optional(),
  templateProfileId: z.string().uuid().nullable().optional(),
  /**
   * If set, this run is a rerun from a prior workspace-origin run. The
   * persisted pack on that run wins over the client-posted one. Port-louis
   * owns the rerun trust rule; the workspace producer just forwards it.
   */
  sourceRunId: z.string().uuid().nullable().optional(),
});

function composeBusinessContext(
  pack: WorkspaceContextPack,
  briefNarrative: string,
  briefObjective: string,
): string {
  const prelude = pack.renderedBriefPrelude ?? "";
  const head = briefObjective.trim();
  const body = briefNarrative.trim();
  const briefBlock = head && body && head !== body ? `**${head}**\n\n${body}` : head || body;
  return `${prelude}# Brief\n\n${briefBlock}`.trim();
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase credentials are required." }, { status: 500 });
  }

  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid body." },
      { status: 400 },
    );
  }

  const workspace = await ensureViewerWorkspace(viewer.user);
  if (!workspace) {
    return NextResponse.json({ error: "Unable to resolve workspace." }, { status: 500 });
  }

  // Parse the client pack via the canonical schema. Anything the client
  // shoves in beyond the schema shape is silently dropped here.
  const clientPack = parseWorkspaceContextPack(payload.pack);
  if (!clientPack && !payload.sourceRunId) {
    return NextResponse.json(
      { error: "Invalid workspace context pack. Reopen the drawer and try again." },
      { status: 400 },
    );
  }

  // Source file IDs come from the client pack but are trusted only after
  // loadSourceFilesForWorkspaceContext reads the real rows from source_files.
  // Anything not actually attached to this workspace is dropped.
  const requestedSourceFileIds = Array.from(
    new Set((clientPack?.sourceFiles ?? []).map((sf) => sf.id).filter(Boolean)),
  );

  const authoritativeSourceFiles = await loadSourceFilesForWorkspaceContext({
    supabaseUrl,
    serviceKey,
    sourceFileIds: requestedSourceFileIds,
    uploadedSourceFiles: [],
  });

  // Rerun continuity: if sourceRunId is set, the persisted pack wins.
  const persistedPack = await loadPersistedRunWorkspaceContextPack({
    supabaseUrl,
    serviceKey,
    runId: payload.sourceRunId ?? null,
    viewerId: viewer.user.id,
  });

  const trustedPack = resolveAuthoritativeWorkspaceContextPack({
    persistedPack,
    clientPack,
    attachedSourceFiles: authoritativeSourceFiles,
  });

  if (!trustedPack) {
    return NextResponse.json(
      { error: "Could not assemble a trusted workspace context pack." },
      { status: 400 },
    );
  }

  if (trustedPack.sourceFiles.length === 0) {
    return NextResponse.json(
      {
        error:
          "No workspace files attached. Cite at least one source in the chat or upload a file before generating.",
      },
      { status: 400 },
    );
  }

  const sourceFileIds = trustedPack.sourceFiles.map((sf) => sf.id);
  const authorModel = normalizeAuthorModelId(payload.authorModel ?? DEFAULT_AUTHOR_MODEL);

  const billingEnabled = !!process.env.STRIPE_SECRET_KEY;
  const hasUnlimitedUsage = hasUnlimitedAccess(viewer.user.email);
  const subscription =
    billingEnabled && !hasUnlimitedUsage
      ? await getActiveSubscription({ supabaseUrl, serviceKey, userId: viewer.user.id })
      : null;
  const currentPlan = normalizePlanId(subscription?.plan ?? "free");
  const maxSlideCount = hasUnlimitedUsage
    ? MAX_TARGET_SLIDES
    : STANDARD_PLAN_MAX_TARGET_SLIDES;
  const targetSlideCount = (() => {
    try {
      const value = assertValidSlideCount(payload.brief.slideCount);
      return Math.min(value, maxSlideCount);
    } catch {
      return Math.min(10, maxSlideCount);
    }
  })();
  const creditsNeeded = calculateRunCredits(targetSlideCount, authorModel);

  if (billingEnabled && !hasUnlimitedUsage) {
    await ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: viewer.user.id });
    const balance = await getDetailedCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id });
    if (balance.balance < creditsNeeded) {
      return NextResponse.json(
        {
          error: `Not enough credits. This ${targetSlideCount}-slide run needs ${creditsNeeded} credits.`,
          code: "NO_CREDITS",
          creditsNeeded,
          creditsAvailable: balance.balance,
        },
        { status: 402 },
      );
    }
  }

  const templateProfileId = await resolveOwnedTemplateProfileId({
    supabaseUrl,
    serviceKey,
    organizationId: workspace.organizationRowId,
    templateProfileId: payload.templateProfileId ?? null,
  });

  if (currentPlan === "free" && templateProfileId) {
    return NextResponse.json(
      {
        error: "Free-plan custom-template runs must start from /jobs/new for template fee handling.",
        code: "TEMPLATE_FEE_REQUIRED",
      },
      { status: 402 },
    );
  }

  const runId = randomUUID();
  const attemptId = randomUUID();

  const businessContext = composeBusinessContext(
    trustedPack,
    payload.brief.narrative,
    payload.brief.objective,
  );
  const chargeCredits = billingEnabled && !hasUnlimitedUsage;

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
        p_requested_by: viewer.user.id,
        p_brief: {
          businessContext,
          client: trustedPack.scope.name ?? "",
          audience: payload.brief.audience,
          objective: payload.brief.objective,
          thesis: payload.brief.thesis,
          stakes: payload.brief.stakes,
        },
        p_business_context: businessContext,
        p_client: trustedPack.scope.name ?? "",
        p_audience: payload.brief.audience,
        p_objective: payload.brief.objective,
        p_thesis: payload.brief.thesis,
        p_stakes: payload.brief.stakes,
        p_source_file_ids: sourceFileIds,
        p_target_slide_count: targetSlideCount,
        p_author_model: authorModel,
        p_template_profile_id: templateProfileId,
        p_notify_on_complete: true,
        p_charge_credits: chargeCredits,
        p_credit_amount: chargeCredits ? creditsNeeded : null,
        p_workspace_id: trustedPack.workspaceId,
        p_workspace_scope_id: trustedPack.workspaceScopeId,
        p_conversation_id: trustedPack.lineage.conversationId,
        p_from_message_id: trustedPack.lineage.messageId,
        p_launch_source: trustedPack.lineage.launchSource,
        p_workspace_context_pack: trustedPack,
        p_workspace_context_pack_hash: hashWorkspaceContextPack(trustedPack),
      },
    });

    const enqueueResult = enqueueRows[0];
    if (enqueueResult?.insufficient_credits) {
      return NextResponse.json(
        {
          error: `Not enough credits. This ${targetSlideCount}-slide run needs ${creditsNeeded} credits.`,
          code: "NO_CREDITS",
        },
        { status: 402 },
      );
    }
    if (!enqueueResult?.run_id || !enqueueResult?.attempt_id) {
      return NextResponse.json({ error: "Failed to enqueue deck run." }, { status: 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enqueue failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(
    {
      runId,
      statusUrl: `/api/v2/runs/${runId}`,
      progressUrl: `/jobs/${runId}`,
    },
    { status: 202 },
  );
}
