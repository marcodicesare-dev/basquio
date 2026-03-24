import Link from "next/link";

import { GenerationForm } from "@/components/generation-form";
import { getViewerState } from "@/lib/supabase/auth";
import { fetchRestRows } from "@/lib/supabase/admin";

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
};

async function getSavedTemplates(organizationId: string): Promise<SavedTemplateOption[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  try {
    const rows = await fetchRestRows<{
      id: string;
      source_type: string;
      template_profile: { templateName?: string; colors?: string[] };
    }>({
      supabaseUrl,
      serviceKey,
      table: "template_profiles",
      query: {
        select: "id,source_type,template_profile",
        organization_id: `eq.${organizationId}`,
        order: "created_at.desc",
        limit: "10",
      },
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.template_profile?.templateName || `Custom ${r.source_type}`,
      sourceType: r.source_type,
      colors: r.template_profile?.colors?.slice(0, 4) ?? [],
    }));
  } catch {
    return [];
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
      user_id: string;
    }>({
      supabaseUrl,
      serviceKey,
      table: "recipes",
      query: {
        select: "id,name,brief,template_profile_id,target_slide_count,user_id",
        id: `eq.${recipeId}`,
        limit: "1",
      },
    });

    const recipe = rows[0];
    if (!recipe || recipe.user_id !== userId) return null;

    return {
      id: recipe.id,
      name: recipe.name,
      brief: recipe.brief,
      templateProfileId: recipe.template_profile_id,
      targetSlideCount: recipe.target_slide_count,
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
  const orgId = (viewer.user as { user_metadata?: { organization_id?: string } } | undefined)?.user_metadata?.organization_id;
  const savedTemplates = orgId ? await getSavedTemplates(orgId) : [];

  // Load recipe prefill if ?recipe= is present
  const recipeId = typeof params.recipe === "string" ? params.recipe : undefined;
  const recipePrefill = recipeId && viewer.user?.id
    ? await getRecipePrefill(recipeId, viewer.user.id)
    : null;

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>{recipePrefill ? `Rerun: ${recipePrefill.name}` : "New analysis"}</h1>
        <Link className="button secondary" href="/artifacts">
          View reports
        </Link>
      </section>

      <GenerationForm
        savedTemplates={savedTemplates}
        recipePrefill={recipePrefill ?? undefined}
      />
    </div>
  );
}
