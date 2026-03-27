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

  const headers = {
    "Content-Type": "application/json",
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  // Verify ownership and get source_file_id for cleanup
  const templates = await fetchRestRows<{ id: string; source_file_id: string | null }>({
    supabaseUrl,
    serviceKey,
    table: "template_profiles",
    query: {
      select: "id,source_file_id",
      id: `eq.${id}`,
      organization_id: `eq.${orgId}`,
      limit: "1",
    },
  });
  if (!templates[0]) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const sourceFileId = templates[0].source_file_id;

  // If this template is the current default, clear the default first
  const settings = await fetchRestRows<{ default_template_profile_id: string | null }>({
    supabaseUrl,
    serviceKey,
    table: "organization_template_settings",
    query: {
      select: "default_template_profile_id",
      organization_id: `eq.${orgId}`,
      limit: "1",
    },
  }).catch(() => []);

  if (settings[0]?.default_template_profile_id === id) {
    await fetch(`${supabaseUrl}/rest/v1/organization_template_settings`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        organization_id: orgId,
        default_template_profile_id: null,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  // Delete import job rows for this template (best-effort)
  await fetch(`${supabaseUrl}/rest/v1/template_import_jobs?template_profile_id=eq.${id}`, {
    method: "DELETE",
    headers,
  }).catch(() => {});

  // Delete the template profile
  await fetch(`${supabaseUrl}/rest/v1/template_profiles?id=eq.${id}`, {
    method: "DELETE",
    headers,
  });

  // Clean up source file and storage object (best-effort)
  if (sourceFileId) {
    const sourceFiles = await fetchRestRows<{ storage_bucket: string; storage_path: string }>({
      supabaseUrl,
      serviceKey,
      table: "source_files",
      query: {
        select: "storage_bucket,storage_path",
        id: `eq.${sourceFileId}`,
        limit: "1",
      },
    }).catch(() => []);

    const sf = sourceFiles[0];
    if (sf) {
      // Delete storage object
      await fetch(`${supabaseUrl}/storage/v1/object/${sf.storage_bucket}/${sf.storage_path}`, {
        method: "DELETE",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }).catch(() => {});
    }

    // Delete source file row
    await fetch(`${supabaseUrl}/rest/v1/source_files?id=eq.${sourceFileId}`, {
      method: "DELETE",
      headers,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
