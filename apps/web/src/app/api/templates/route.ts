import { NextResponse } from "next/server";

import { fetchRestRows } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TemplateRow = {
  id: string;
  name: string | null;
  source_type: string;
  status: string;
  failure_message: string | null;
  fingerprint: string | null;
  layout_count: number | null;
  preview_payload: Record<string, unknown>;
  source_file_id: string | null;
  created_at: string;
  updated_at: string;
  template_profile: {
    templateName?: string;
    colors?: string[];
    fonts?: string[];
    brandTokens?: {
      typography?: { headingFont?: string; bodyFont?: string };
    };
  };
};

type DefaultSettingsRow = {
  default_template_profile_id: string | null;
};

export async function GET() {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const orgId = (viewer.user as { user_metadata?: { organization_id?: string } }).user_metadata?.organization_id;
  if (!orgId) {
    return NextResponse.json({ templates: [], defaultTemplateId: null });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ templates: [], defaultTemplateId: null });
  }

  const [templates, settings] = await Promise.all([
    fetchRestRows<TemplateRow>({
      supabaseUrl,
      serviceKey,
      table: "template_profiles",
      query: {
        select: "id,name,source_type,status,failure_message,fingerprint,layout_count,preview_payload,source_file_id,created_at,updated_at,template_profile",
        organization_id: `eq.${orgId}`,
        order: "created_at.desc",
        limit: "50",
      },
    }).catch(() => []),
    fetchRestRows<DefaultSettingsRow>({
      supabaseUrl,
      serviceKey,
      table: "organization_template_settings",
      query: {
        select: "default_template_profile_id",
        organization_id: `eq.${orgId}`,
        limit: "1",
      },
    }).catch(() => []),
  ]);

  const defaultTemplateId = settings[0]?.default_template_profile_id ?? null;

  return NextResponse.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name || t.template_profile?.templateName || `Custom ${t.source_type}`,
      sourceType: t.source_type,
      status: t.status,
      failureMessage: t.failure_message,
      layoutCount: t.layout_count ?? null,
      colors: t.preview_payload?.colors ?? t.template_profile?.colors?.slice(0, 6) ?? [],
      fonts: t.preview_payload?.fonts ?? t.template_profile?.fonts?.slice(0, 4) ?? [],
      headingFont: (t.preview_payload as Record<string, unknown>)?.headingFont ?? t.template_profile?.brandTokens?.typography?.headingFont ?? null,
      isDefault: t.id === defaultTemplateId,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    })),
    defaultTemplateId,
  });
}
