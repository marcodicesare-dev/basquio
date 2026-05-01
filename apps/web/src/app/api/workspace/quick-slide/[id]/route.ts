import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";
import { getQuickSlideRun } from "@/lib/workspace/quick-slide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/workspace/quick-slide/[id] returns the run state.
 * Polled by the chat chip every 1.5-5s. Tenancy-checked.
 */
export async function GET(
  _request: Request,
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

  return NextResponse.json(
    {
      id: row.id,
      status: row.status,
      brief: row.brief,
      last_event_phase: row.last_event_phase,
      last_event_message: row.last_event_message,
      cost_usd: row.cost_usd,
      duration_ms: row.duration_ms,
      error_message: row.error_message,
      ready: row.status === "ready",
      download_url: row.status === "ready" ? `/api/workspace/quick-slide/${row.id}/download` : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    {
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
