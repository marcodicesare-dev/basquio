import { NextResponse } from "next/server";

import { getViewerState } from "@/lib/supabase/auth";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_FACING_ARTIFACT_KINDS = new Set(["pptx", "md", "xlsx"]);
const REQUIRED_USER_FACING_ARTIFACT_KINDS = ["pptx", "md", "xlsx"] as const;

function isUserFacingArtifact(artifact: { kind?: unknown }) {
  return typeof artifact.kind === "string" && USER_FACING_ARTIFACT_KINDS.has(artifact.kind);
}

function hasRequiredUserFacingArtifacts(artifacts: Array<{ kind?: unknown }>) {
  const kinds = new Set(artifacts.filter(isUserFacingArtifact).map((artifact) => artifact.kind));
  return REQUIRED_USER_FACING_ARTIFACT_KINDS.every((kind) => kinds.has(kind));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { runId } = await params;

  if (!UUID_RE.test(runId)) {
    return NextResponse.json({ error: "Invalid run ID." }, { status: 400 });
  }

  const runResponse = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_runs?id=eq.${runId}&requested_by=eq.${viewer.user.id}&select=*`,
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

  let artifacts = null;
  const manifestResponse = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/artifact_manifests_v2?run_id=eq.${runId}&limit=1`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );

  if (manifestResponse.ok) {
    const manifests = await manifestResponse.json();
    if (manifests.length > 0) {
      const manifest = manifests[0];
      artifacts = {
        ...manifest,
        artifacts: Array.isArray(manifest.artifacts)
          ? manifest.artifacts.filter(isUserFacingArtifact)
          : [],
      };
    }
  }
  const effectiveStatus =
    run.status === "failed" && artifacts?.artifacts && hasRequiredUserFacingArtifacts(artifacts.artifacts)
      ? "completed"
      : run.status;

  return NextResponse.json({
    runId: run.id,
    status: effectiveStatus,
    currentPhase: run.current_phase,
    failureMessage: effectiveStatus === "completed" ? null : run.failure_message,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    completedAt: run.completed_at,
    costTelemetry: run.cost_telemetry ?? null,
    artifacts,
  });
}
