import { NextResponse } from "next/server";

import { getViewerState } from "@/lib/supabase/auth";
import { resolveViewerOrgId } from "@/lib/viewer-workspace";

export const runtime = "nodejs";

export async function POST() {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
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

  // Clear the default by setting it to null
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
      default_template_profile_id: null,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Failed to clear default template." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, defaultTemplateId: null });
}
