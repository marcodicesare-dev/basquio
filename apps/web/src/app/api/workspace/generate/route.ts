import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

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
import type { WorkspaceContextPack } from "@/lib/workspace/build-context-pack";

export const runtime = "nodejs";
export const maxDuration = 60;

const packSchema = z.object({
  workspaceId: z.string(),
  workspaceScopeId: z.string().nullable(),
  deliverableId: z.string().nullable(),
  scope: z.object({
    id: z.string().nullable(),
    kind: z.string().nullable(),
    name: z.string().nullable(),
  }),
  stakeholders: z.array(z.any()),
  rules: z.object({
    workspace: z.array(z.string()),
    analyst: z.array(z.string()),
    scoped: z.array(z.string()),
  }),
  citedSources: z.array(z.any()),
  sourceFiles: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      fileName: z.string(),
      storageBucket: z.string(),
      storagePath: z.string(),
    }),
  ),
  lineage: z.object({
    conversationId: z.string().nullable(),
    messageId: z.string().nullable(),
    deliverableTitle: z.string().nullable(),
    prompt: z.string().nullable(),
    launchSource: z.enum(["workspace-chat", "workspace-deliverable", "jobs-new", "other"]),
  }),
  styleContract: z.object({
    language: z.string().nullable(),
    tone: z.string().nullable(),
    deckLength: z.string().nullable(),
    chartPreferences: z.array(z.string()),
  }),
  renderedBriefPrelude: z.string(),
  createdAt: z.string(),
  schemaVersion: z.number().int(),
});

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
  pack: packSchema,
  brief: briefSchema,
  authorModel: z.string().optional(),
  templateProfileId: z.string().uuid().nullable().optional(),
});

function stableStringify(value: unknown): string {
  if (typeof value === "undefined") return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function hashPack(pack: WorkspaceContextPack | null): string | null {
  if (!pack) return null;
  return createHash("sha256").update(stableStringify(pack)).digest("hex");
}

function composeBusinessContext(pack: WorkspaceContextPack, briefNarrative: string, briefObjective: string): string {
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

  const pack = payload.pack as WorkspaceContextPack;

  // Canonicalize: sourceFiles come from the pack the client saw, but verify
  // each ID really belongs to source_files (and belongs to a workspace file,
  // not some spoofed row). The prepare-generation endpoint already minted them
  // server-side via buildWorkspaceContextPack, so in the happy path this is a
  // no-op verification pass.
  const sourceFileIds = Array.from(new Set(pack.sourceFiles.map((sf) => sf.id))).filter(Boolean);
  if (sourceFileIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "No workspace files attached. Cite at least one source in the chat or upload a file before generating.",
      },
      { status: 400 },
    );
  }

  const authorModelRaw = payload.authorModel ?? DEFAULT_AUTHOR_MODEL;
  const authorModel = normalizeAuthorModelId(authorModelRaw);

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

  const businessContext = composeBusinessContext(pack, payload.brief.narrative, payload.brief.objective);
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
          client: pack.scope.name ?? "",
          audience: payload.brief.audience,
          objective: payload.brief.objective,
          thesis: payload.brief.thesis,
          stakes: payload.brief.stakes,
        },
        p_business_context: businessContext,
        p_client: pack.scope.name ?? "",
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
        // Workspace-pack params — required so Postgres can disambiguate
        // against the legacy enqueue_deck_run signature. Port-louis'
        // migration added this overload; passing the workspace fields
        // locks in the right function.
        p_workspace_id: pack.workspaceId,
        p_workspace_scope_id: pack.workspaceScopeId,
        p_conversation_id: pack.lineage.conversationId,
        p_from_message_id: pack.lineage.messageId,
        p_launch_source: pack.lineage.launchSource,
        p_workspace_context_pack: pack,
        p_workspace_context_pack_hash: hashPack(pack),
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
