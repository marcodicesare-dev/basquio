import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { DEFAULT_AUTHOR_MODEL, assertValidSlideCount, getActiveSubscription } from "@/lib/credits";
import { persistPreparedSourceFiles } from "@/lib/source-file-staging";
import { getViewerState } from "@/lib/supabase/auth";
import { fetchRestRows } from "@/lib/supabase/admin";
import { resolveOwnedTemplateProfileId } from "@/lib/template-profiles";
import { normalizePlanId } from "@/lib/billing-config";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";

export const runtime = "nodejs";

const templateFeeDraftSchema = z.object({
  templateProfileId: z.string().uuid(),
  sourceFiles: z.array(z.object({
    fileName: z.string().min(1),
    mediaType: z.string().optional().nullable(),
    kind: z.string().optional().nullable(),
    storageBucket: z.string().optional().nullable(),
    storagePath: z.string().optional().nullable(),
    fileBytes: z.number().int().nonnegative().optional().nullable(),
  })).optional(),
  existingSourceFileIds: z.array(z.string().uuid()).optional(),
  brief: z.object({
    businessContext: z.string().optional(),
    client: z.string().optional(),
    audience: z.string().optional(),
    objective: z.string().optional(),
    thesis: z.string().optional(),
    stakes: z.string().optional(),
  }).default({}),
  targetSlideCount: z.number().int().catch(10),
  authorModel: z.enum(["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]).catch(DEFAULT_AUTHOR_MODEL),
  recipeId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const viewer = await getViewerState();

    if (!viewer.user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }

    const workspace = await ensureViewerWorkspace(viewer.user);
    if (!workspace) {
      return NextResponse.json({ error: "Unable to resolve a personal Basquio workspace for this user." }, { status: 500 });
    }

    const parsed = templateFeeDraftSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid template-fee draft payload." }, { status: 400 });
    }
    const body = parsed.data;

    let templateProfileId: string;
    try {
      const resolvedTemplateProfileId = await resolveOwnedTemplateProfileId({
        supabaseUrl,
        serviceKey,
        organizationId: workspace.organizationRowId,
        templateProfileId: body.templateProfileId,
      });
      if (!resolvedTemplateProfileId) {
        return NextResponse.json({ error: "A custom template must be selected before checkout." }, { status: 400 });
      }
      templateProfileId = resolvedTemplateProfileId;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid template profile." }, { status: 400 });
    }

    const subscription = await getActiveSubscription({ supabaseUrl, serviceKey, userId: viewer.user.id });
    const currentPlan = normalizePlanId(subscription?.plan ?? "free");
    if (currentPlan !== "free") {
      return NextResponse.json({ error: "Template-fee drafts are only required on the free plan." }, { status: 400 });
    }
    const targetSlideCount = assertValidSlideCount(body.targetSlideCount);

    const existingSourceFileIds = await resolveValidatedExistingSourceFileIds({
      supabaseUrl,
      serviceKey,
      organizationId: workspace.organizationRowId,
      projectId: workspace.projectRowId,
      existingSourceFileIds: body.existingSourceFileIds ?? [],
    });
    let sourceFileIds = [...existingSourceFileIds];

    if ((body.sourceFiles?.length ?? 0) > 0) {
      const staged = await persistPreparedSourceFiles({
        supabaseUrl,
        serviceKey,
        organizationId: workspace.organizationRowId,
        projectId: workspace.projectRowId,
        uploadedBy: viewer.user.id,
        files: body.sourceFiles ?? [],
      });
      sourceFileIds = sourceFileIds.concat(staged.map((file) => file.id));
    }

    if (sourceFileIds.length === 0) {
      return NextResponse.json({ error: "At least one uploaded or reused source file is required." }, { status: 400 });
    }

    const draftId = randomUUID();
    const response = await fetch(`${supabaseUrl}/rest/v1/template_fee_checkout_drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id: draftId,
        user_id: viewer.user.id,
        organization_id: workspace.organizationRowId,
        project_id: workspace.projectRowId,
        template_profile_id: templateProfileId,
        source_file_ids: sourceFileIds,
        brief: {
          businessContext: body.brief.businessContext ?? "",
          client: body.brief.client ?? "",
          audience: body.brief.audience ?? "Executive stakeholder",
          objective: body.brief.objective ?? "Explain the business performance signal",
          thesis: body.brief.thesis ?? "",
          stakes: body.brief.stakes ?? "",
        },
        target_slide_count: targetSlideCount,
        author_model: body.authorModel,
        recipe_id: body.recipeId ?? null,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return NextResponse.json({ error: `Failed to persist template-fee draft: ${errorText}` }, { status: 500 });
    }

    return NextResponse.json({ draftId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the template-fee draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
    throw new Error("One or more reused source files do not belong to this workspace.");
  }

  return uniqueIds;
}
