import { NextResponse } from "next/server";

import { fetchRestRows, patchRestRows } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { resolveViewerOrgId } from "@/lib/viewer-workspace";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
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

  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length > 100) {
    return NextResponse.json({ error: "Name is required (max 100 characters)." }, { status: 400 });
  }

  // Verify ownership
  const templates = await fetchRestRows<{ id: string }>({
    supabaseUrl,
    serviceKey,
    table: "template_profiles",
    query: {
      select: "id",
      id: `eq.${id}`,
      organization_id: `eq.${orgId}`,
      limit: "1",
    },
  });
  if (!templates[0]) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  await patchRestRows({
    supabaseUrl,
    serviceKey,
    table: "template_profiles",
    query: { id: `eq.${id}` },
    payload: { name, updated_at: new Date().toISOString() },
  });

  return NextResponse.json({ ok: true, name });
}
