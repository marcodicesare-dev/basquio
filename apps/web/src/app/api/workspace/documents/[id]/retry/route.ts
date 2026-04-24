import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID, BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";
import {
  cleanOrphansForDocument,
  markDocumentForRetry,
  markDocumentIndexingFailed,
} from "@/lib/workspace/retry";
import { enqueueFileIngestRun } from "@/lib/workspace/ingest-queue";

export const runtime = "nodejs";
// Retry only resets the memory-indexing lane. The Railway file-ingest worker
// owns chunking, embeddings, and entity extraction.
export const maxDuration = 60;

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export async function POST(
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
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid document id." }, { status: 400 });
  }

  const db = getDb();
  const { data: doc, error: loadError } = await db
    .from("knowledge_documents")
    .select("id, status")
    .eq("id", id)
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("is_team_beta", true)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  if (doc.status === "processing") {
    return NextResponse.json({ error: "Already processing." }, { status: 409 });
  }

  await cleanOrphansForDocument(id);
  await markDocumentForRetry(id);

  // Queue memory indexing. The attached file remains usable in chat while this
  // runs, because Lane A reads from Supabase Storage / Anthropic Files.
  try {
    await enqueueFileIngestRun({
      documentId: id,
      workspaceId: BASQUIO_TEAM_WORKSPACE_ID,
      metadata: { source: "retry_endpoint", requested_at: new Date().toISOString() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "memory indexing queue failed";
    console.error(`[workspace/retry] enqueueFileIngestRun failed for ${id}`, error);
    await markDocumentIndexingFailed(id, `Memory indexing queue failed: ${message}`).catch(
      (markError) => {
        console.error(`[workspace/retry] markDocumentIndexingFailed failed for ${id}`, markError);
      },
    );
    return NextResponse.json(
      { error: "Memory indexing could not be queued. Try again." },
      { status: 503 },
    );
  }

  return NextResponse.json({ id, status: "processing" });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
