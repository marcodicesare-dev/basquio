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

export default async function NewJobPage() {
  const viewer = await getViewerState();
  const orgId = (viewer.user as { user_metadata?: { organization_id?: string } } | undefined)?.user_metadata?.organization_id;
  const savedTemplates = orgId ? await getSavedTemplates(orgId) : [];

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>New analysis</h1>

        <Link className="button secondary" href="/artifacts">
          View presentations
        </Link>
      </section>

      <GenerationForm savedTemplates={savedTemplates} />
    </div>
  );
}
