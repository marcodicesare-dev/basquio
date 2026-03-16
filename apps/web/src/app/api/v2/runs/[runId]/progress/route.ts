import { NextResponse } from "next/server";

import { getViewerState } from "@/lib/supabase/auth";

export const runtime = "nodejs";

// Event-sourced progress endpoint.
// Returns real tool-call events from deck_run_events, not synthetic stage weights.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { runId } = await params;
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  // Fetch run — filter by requested_by to enforce tenancy
  const runResponse = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_runs?id=eq.${runId}&requested_by=eq.${viewer.user.id}&select=id,status,current_phase`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );

  if (!runResponse.ok) {
    return NextResponse.json({ error: "Failed to fetch run." }, { status: 500 });
  }

  const runs = await runResponse.json();
  if (runs.length === 0) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  const run = runs[0];

  // Fetch events (incremental if `after` provided)
  let eventsUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_run_events?run_id=eq.${runId}&order=created_at.asc&limit=${limit}`;
  if (after) {
    eventsUrl += `&created_at=gt.${after}`;
  }

  const eventsResponse = await fetch(eventsUrl, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
    },
  });

  const events = eventsResponse.ok ? await eventsResponse.json() : [];

  const phases = ["normalize", "understand", "author", "critique", "revise", "export"];
  const completedPhases = events
    .filter((e: { event_type: string }) => e.event_type === "phase_completed")
    .map((e: { phase: string }) => e.phase);

  const currentPhaseIndex = run.current_phase
    ? phases.indexOf(run.current_phase)
    : -1;

  const progressPct = run.status === "completed"
    ? 100
    : run.status === "failed"
      ? 0
      : Math.round(((completedPhases.length + (currentPhaseIndex >= 0 ? 0.5 : 0)) / phases.length) * 100);

  const toolCalls = events.filter((e: { event_type: string }) => e.event_type === "tool_call");
  const lastToolCall = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;

  return NextResponse.json({
    runId: run.id,
    status: run.status,
    currentPhase: run.current_phase,
    progressPct,
    completedPhases,
    lastToolCall: lastToolCall
      ? {
          phase: lastToolCall.phase,
          tools: lastToolCall.payload?.tools ?? [],
          stepNumber: lastToolCall.payload?.stepNumber,
          at: lastToolCall.created_at,
        }
      : null,
    events: events.map((e: Record<string, unknown>) => ({
      id: e.id,
      phase: e.phase,
      eventType: e.event_type,
      toolName: e.tool_name,
      payload: e.payload,
      createdAt: e.created_at,
    })),
    hasMore: events.length === limit,
  });
}
