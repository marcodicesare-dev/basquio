import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";
import { getQuickSlideRun } from "@/lib/workspace/quick-slide";
import { QUICK_SLIDE_BUCKET } from "@basquio/workflows/quick-slide/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/workspace/quick-slide/[id]/download.
 *
 * Two modes via query param:
 *   ?redirect=true  302 to a signed URL on the storage edge. Click pattern.
 *   default         JSON { signed_url } so the chat client can offer
 *                   the URL in a download button without leaving the page.
 *
 * Signed URL expires in 5 minutes per the spec. Tenancy is checked before
 * we sign, so the link is single-use even if it leaks: re-requesting requires
 * an authenticated workspace member.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
  }

  const workspace = await getCurrentWorkspace(viewer);
  const row = await getQuickSlideRun(id).catch(() => null);
  if (!row || row.workspace_id !== workspace.id) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  if (row.status !== "ready" || !row.pptx_storage_path) {
    return NextResponse.json(
      { error: "Slide is not ready yet.", status: row.status },
      { status: 409 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Storage not configured." }, { status: 500 });
  }

  const db = createServiceSupabaseClient(supabaseUrl, serviceKey);
  const { data, error } = await db.storage
    .from(QUICK_SLIDE_BUCKET)
    .createSignedUrl(row.pptx_storage_path, 300, {
      download: `quick-slide-${id.slice(0, 8)}.pptx`,
    });
  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: "Could not sign download URL.", details: error?.message },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  if (url.searchParams.get("redirect") === "true") {
    return NextResponse.redirect(data.signedUrl, 302);
  }
  return NextResponse.json({ signed_url: data.signedUrl });
}
