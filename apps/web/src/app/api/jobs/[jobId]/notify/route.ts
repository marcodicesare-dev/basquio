import { NextResponse } from "next/server";
import { getViewerState } from "@/lib/supabase/auth";
import { patchRestRows } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Configuration error." }, { status: 500 });
  }

  await patchRestRows({
    supabaseUrl,
    serviceKey,
    table: "deck_runs",
    query: { id: `eq.${jobId}`, requested_by: `eq.${viewer.user.id}` },
    payload: { notify_on_complete: true },
  });

  return NextResponse.json({ ok: true });
}
