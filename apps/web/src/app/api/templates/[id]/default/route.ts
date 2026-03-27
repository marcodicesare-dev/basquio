import { NextResponse } from "next/server";

import { fetchRestRows } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { resolveViewerOrgId } from "@/lib/viewer-workspace";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid template ID." }, { status: 400 });
  }

  const orgId = await resolveViewerOrgId(viewer.user.id);
  if (!orgId) {
    return NextResponse.json({ error: "No organization found." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  // Verify template belongs to org and is ready
  const templates = await fetchRestRows<{ id: string; status: string }>({
    supabaseUrl,
    serviceKey,
    table: "template_profiles",
    query: {
      select: "id,status",
      id: `eq.${id}`,
      organization_id: `eq.${orgId}`,
      limit: "1",
    },
  });

  if (!templates[0]) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  if (templates[0].status !== "ready") {
    return NextResponse.json({ error: "Only ready templates can be set as default." }, { status: 400 });
  }

  // Upsert organization_template_settings
  const response = await fetch(`${supabaseUrl}/rest/v1/organization_template_settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      organization_id: orgId,
      default_template_profile_id: id,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Failed to set default template." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, defaultTemplateId: id });
}
