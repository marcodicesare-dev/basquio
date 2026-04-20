import { GenerationForm } from "@/components/generation-form";
import { normalizePlanId } from "@/lib/billing-config";
import { getActiveSubscription, normalizeAuthorModelId, OPUS_AUTHOR_MODEL } from "@/lib/credits";
import { getViewerState } from "@/lib/supabase/auth";
import { fetchRestRows } from "@/lib/supabase/admin";
import { getTemplateFeeDraft } from "@/lib/template-fee-drafts";
import { hasUnlimitedAccess } from "@/lib/unlimited-access";
import { resolveViewerOrgId } from "@/lib/viewer-workspace";

export const dynamic = "force-dynamic";

type SavedTemplateOption = {
  id: string;
  name: string;
  sourceType: string;
  colors: string[];
};

type RecipePrefill = {
  id: string;
  name: string;
  /** Only set when this prefill comes from a saved recipe, not a prior run */
  recipeId: string | null;
  brief: {
    businessContext?: string;
    client?: string;
    audience?: string;
    objective?: string;
    thesis?: string;
    stakes?: string;
  };
  templateProfileId: string | null;
  targetSlideCount: number;
  authorModel?: "claude-sonnet-4-6" | "claude-opus-4-7" | "claude-haiku-4-5";
  sourceFiles?: Array<{
    id: string;
    kind: string;
    fileName: string;
    storageBucket: string;
    storagePath: string;
    fileBytes: number;
  }>;
};

type TemplateFeeReturn = {
  draftId: string;
  status: "success" | "cancelled";
  sessionId: string | null;
};

type DefaultSettingsRow = {
  default_template_profile_id: string | null;
};

async function getSavedTemplates(organizationId: string): Promise<SavedTemplateOption[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  try {
    const rows = await fetchRestRows<{
      id: string;
      name: string | null;
      source_type: string;
      status: string;
      template_profile: { templateName?: string; colors?: string[] };
    }>({
      supabaseUrl,
      serviceKey,
      table: "template_profiles",
      query: {
        select: "id,name,source_type,status,template_profile",
        organization_id: `eq.${organizationId}`,
        status: "eq.ready",
        order: "created_at.desc",
        limit: "10",
      },
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name || r.template_profile?.templateName || `Custom ${r.source_type}`,
      sourceType: r.source_type,
      colors: r.template_profile?.colors?.slice(0, 4) ?? [],
    }));
  } catch {
    return [];
  }
}

async function getDefaultTemplateId(organizationId: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const rows = await fetchRestRows<DefaultSettingsRow>({
      supabaseUrl,
      serviceKey,
      table: "organization_template_settings",
      query: {
        select: "default_template_profile_id",
        organization_id: `eq.${organizationId}`,
        limit: "1",
      },
    });
    const candidateId = rows[0]?.default_template_profile_id;
    if (!candidateId) return null;

    // Verify the default template is actually ready
    const readyCheck = await fetchRestRows<{ id: string }>({
      supabaseUrl,
      serviceKey,
      table: "template_profiles",
      query: {
        select: "id",
        id: `eq.${candidateId}`,
        status: "eq.ready",
        limit: "1",
      },
    });
    return readyCheck[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function getRecipePrefill(recipeId: string, userId: string): Promise<RecipePrefill | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const rows = await fetchRestRows<{
      id: string;
      name: string;
      brief: Record<string, string>;
      template_profile_id: string | null;
      target_slide_count: number;
      author_model: "claude-sonnet-4-6" | "claude-opus-4-7" | "claude-opus-4-6" | "claude-haiku-4-5" | null;
      user_id: string;
    }>({
      supabaseUrl,
      serviceKey,
      table: "recipes",
      query: {
        select: "id,name,brief,template_profile_id,target_slide_count,author_model,user_id",
        id: `eq.${recipeId}`,
        limit: "1",
      },
    });

    const recipe = rows[0];
    if (!recipe || recipe.user_id !== userId) return null;

    return {
      id: recipe.id,
      recipeId: recipe.id,
      name: recipe.name,
      brief: recipe.brief,
      templateProfileId: recipe.template_profile_id,
      targetSlideCount: recipe.target_slide_count,
      authorModel:
        normalizeAuthorModelId(recipe.author_model) === OPUS_AUTHOR_MODEL
          ? OPUS_AUTHOR_MODEL
          : recipe.author_model === "claude-haiku-4-5"
          ? "claude-haiku-4-5"
          : "claude-sonnet-4-6",
    };
  } catch {
    return null;
  }
}

async function getRunPrefill(runId: string, userId: string): Promise<RecipePrefill | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const rows = await fetchRestRows<{
      id: string;
      brief: Record<string, string>;
      template_profile_id: string | null;
      requested_by: string;
      target_slide_count: number | null;
      author_model: "claude-sonnet-4-6" | "claude-opus-4-7" | "claude-opus-4-6" | "claude-haiku-4-5" | null;
      source_file_ids: string[];
    }>({
      supabaseUrl,
      serviceKey,
      table: "deck_runs",
      query: {
        select: "id,brief,template_profile_id,requested_by,target_slide_count,author_model,source_file_ids",
        id: `eq.${runId}`,
        limit: "1",
      },
    });

    const run = rows[0];
    if (!run || run.requested_by !== userId) return null;

    // Prefer the requested count stored on the run; fall back to the delivered manifest for older runs.
    let slideCount = run.target_slide_count ?? 10;
    try {
      const manifests = await fetchRestRows<{ slide_count: number }>({
        supabaseUrl,
        serviceKey,
        table: "artifact_manifests_v2",
        query: { select: "slide_count", run_id: `eq.${runId}`, limit: "1" },
      });
      if (!run.target_slide_count && manifests[0]?.slide_count) slideCount = manifests[0].slide_count;
    } catch { /* ok */ }

    // Get source files from previous run for reuse
    let sourceFiles: RecipePrefill["sourceFiles"] = [];
    try {
      const sfRows = await fetchRestRows<{
        id: string;
        kind: string;
        file_name: string;
        storage_bucket: string;
        storage_path: string;
        file_bytes: number;
      }>({
        supabaseUrl,
        serviceKey,
        table: "source_files",
        query: {
          select: "id,kind,file_name,storage_bucket,storage_path,file_bytes",
          id: `in.(${(run.source_file_ids ?? []).join(",")})`,
          limit: "20",
        },
      });
      sourceFiles = sfRows.map((sf) => ({
        id: sf.id,
        kind: sf.kind,
        fileName: sf.file_name,
        storageBucket: sf.storage_bucket,
        storagePath: sf.storage_path,
        fileBytes: sf.file_bytes ?? 0,
      }));
    } catch { /* ok */ }

    return {
      id: runId,
      recipeId: null,
      name: "Previous run",
      brief: run.brief,
      templateProfileId: run.template_profile_id,
      targetSlideCount: slideCount,
      authorModel:
        normalizeAuthorModelId(run.author_model) === OPUS_AUTHOR_MODEL
          ? OPUS_AUTHOR_MODEL
          : run.author_model === "claude-haiku-4-5"
          ? "claude-haiku-4-5"
          : "claude-sonnet-4-6",
      sourceFiles,
    };
  } catch {
    return null;
  }
}

async function getTemplateFeeDraftPrefill(draftId: string, userId: string): Promise<RecipePrefill | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  const draft = await getTemplateFeeDraft({ supabaseUrl, serviceKey, draftId, userId });
  if (!draft) {
    return null;
  }

  let sourceFiles: RecipePrefill["sourceFiles"] = [];
  try {
    const sfRows = await fetchRestRows<{
      id: string;
      kind: string;
      file_name: string;
      storage_bucket: string;
      storage_path: string;
      file_bytes: number;
    }>({
      supabaseUrl,
      serviceKey,
      table: "source_files",
      query: {
        select: "id,kind,file_name,storage_bucket,storage_path,file_bytes",
        id: `in.(${(draft.source_file_ids ?? []).join(",")})`,
        limit: "20",
      },
    });
    sourceFiles = sfRows.map((sf) => ({
      id: sf.id,
      kind: sf.kind,
      fileName: sf.file_name,
      storageBucket: sf.storage_bucket,
      storagePath: sf.storage_path,
      fileBytes: sf.file_bytes ?? 0,
    }));
  } catch { /* ok */ }

  return {
    id: draft.id,
    recipeId: draft.recipe_id,
    name: "Pending custom-template run",
    brief: draft.brief,
    templateProfileId: draft.template_profile_id,
    targetSlideCount: draft.target_slide_count,
    authorModel:
      normalizeAuthorModelId(draft.author_model) === OPUS_AUTHOR_MODEL
        ? OPUS_AUTHOR_MODEL
        : draft.author_model === "claude-haiku-4-5"
        ? "claude-haiku-4-5"
        : "claude-sonnet-4-6",
    sourceFiles,
  };
}

async function getWorkspaceDeliverablePrefill(
  deliverableId: string,
  userId: string,
): Promise<RecipePrefill | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const rows = await fetchRestRows<{
      id: string;
      title: string;
      body_markdown: string | null;
      prompt: string;
      scope: string | null;
      status: string;
    }>({
      supabaseUrl,
      serviceKey,
      table: "workspace_deliverables",
      query: {
        select: "id,title,body_markdown,prompt,scope,status",
        id: `eq.${deliverableId}`,
        limit: "1",
      },
    });
    const deliverable = rows[0];
    if (!deliverable || !deliverable.body_markdown) return null;
    if (deliverable.status !== "ready") return null;

    // Sentinel to keep us from duplicating intent accidentally later.
    void userId;

    return {
      id: `deliverable-${deliverable.id}`,
      recipeId: null,
      name: `From workspace: ${deliverable.title}`,
      brief: {
        businessContext: deliverable.body_markdown,
        client: deliverable.scope ?? "",
        audience: "Executive stakeholder",
        objective: deliverable.prompt.slice(0, 400),
        thesis: "",
        stakes: "",
      },
      templateProfileId: null,
      targetSlideCount: 10,
      authorModel: "claude-sonnet-4-6",
      sourceFiles: [],
    };
  } catch {
    return null;
  }
}

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getViewerState();
  const params = await searchParams;
  const orgId = viewer.user ? await resolveViewerOrgId(viewer.user.id) : null;
  const [savedTemplates, defaultTemplateId] = orgId
    ? await Promise.all([getSavedTemplates(orgId), getDefaultTemplateId(orgId)])
    : [[], null];
  const currentPlan = hasUnlimitedAccess(viewer.user?.email)
    ? "unlimited"
    : viewer.user?.id && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? normalizePlanId((await getActiveSubscription({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          userId: viewer.user.id,
        }))?.plan ?? "free")
      : "free";

  // Load recipe prefill if ?recipe= is present
  const recipeId = typeof params.recipe === "string" ? params.recipe : undefined;
  const recipePrefill = recipeId && viewer.user?.id
    ? await getRecipePrefill(recipeId, viewer.user.id)
    : null;

  // Load run prefill if ?from= is present (rerun with changes)
  const fromRunId = typeof params.from === "string" ? params.from : undefined;
  let fromRunPrefill: RecipePrefill | null = null;
  if (fromRunId && !recipePrefill && viewer.user?.id) {
    fromRunPrefill = await getRunPrefill(fromRunId, viewer.user.id);
  }

  const templateFeeDraftId = typeof params.draft === "string" ? params.draft : undefined;
  const templateFeeStatusParam = typeof params.templateFee === "string" ? params.templateFee : undefined;
  const templateFeeReturn: TemplateFeeReturn | undefined =
    templateFeeDraftId && (templateFeeStatusParam === "success" || templateFeeStatusParam === "cancelled")
      ? {
          draftId: templateFeeDraftId,
          status: templateFeeStatusParam,
          sessionId: typeof params.session_id === "string" ? params.session_id : null,
        }
      : undefined;
  const templateFeeDraftPrefill = templateFeeDraftId && viewer.user?.id
    ? await getTemplateFeeDraftPrefill(templateFeeDraftId, viewer.user.id)
    : null;

  // Load workspace deliverable prefill if ?deliverable= is present
  const deliverableId = typeof params.deliverable === "string" ? params.deliverable : undefined;
  const deliverablePrefill =
    deliverableId && viewer.user?.id && !recipePrefill && !fromRunPrefill && !templateFeeDraftPrefill
      ? await getWorkspaceDeliverablePrefill(deliverableId, viewer.user.id)
      : null;

  const activePrefill =
    recipePrefill ?? fromRunPrefill ?? templateFeeDraftPrefill ?? deliverablePrefill ?? undefined;
  const pageTitle = recipePrefill
    ? `Rerun: ${recipePrefill.name}`
    : fromRunPrefill
      ? "Rerun with changes"
      : templateFeeDraftPrefill
        ? "Resume custom-template run"
      : "New analysis";
  const startTour = typeof params.tour === "string" && params.tour === "1";
  const startWithSampleData = typeof params.sample === "string" && params.sample === "1";

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>{pageTitle}</h1>
        <p className="muted">Upload the evidence behind one real review, then guide the story with a sharp brief.</p>
      </section>

      <GenerationForm
        currentPlan={currentPlan}
        savedTemplates={savedTemplates}
        defaultTemplateId={defaultTemplateId}
        recipePrefill={activePrefill}
        startTour={startTour}
        startWithSampleData={startWithSampleData}
        templateFeeReturn={templateFeeReturn}
      />
    </div>
  );
}
