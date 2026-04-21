import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";
import { listConversationAttachments } from "@/lib/workspace/conversation-attachments";
import { getConversation } from "@/lib/workspace/conversations";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lane C visibility: returns the entities + facts extracted from the documents
 * attached to THIS conversation. Lets the chat surface "new in memory from this
 * chat" chips so the user sees Lane B/C completing in real time without jumping
 * to the /workspace/memory page.
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
    return NextResponse.json({ entities: [], facts: [], documentCount: 0 });
  }

  // Ownership check — see sibling attachments route for rationale.
  const workspace = await getCurrentWorkspace();
  const conversation = await getConversation(id).catch(() => null);
  if (!conversation || conversation.workspace_id !== workspace.id) {
    return NextResponse.json({ entities: [], facts: [], documentCount: 0 });
  }

  const attachments = await listConversationAttachments(id).catch(() => []);
  const documentIds = attachments.map((a) => a.document_id);
  if (documentIds.length === 0) {
    return NextResponse.json({ entities: [], facts: [], documentCount: 0 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }
  const db = createServiceSupabaseClient(url, key);

  const { data: mentionRows } = await db
    .from("entity_mentions")
    .select("entity_id, entities(id, type, canonical_name)")
    .eq("organization_id", BASQUIO_TEAM_WORKSPACE_ID)
    .eq("source_type", "document")
    .in("source_id", documentIds);

  type EntityJoin = { id: string; type: string; canonical_name: string };
  const entityById = new Map<string, EntityJoin>();
  for (const row of (mentionRows ?? []) as Array<{
    entity_id: string;
    entities: EntityJoin | EntityJoin[] | null;
  }>) {
    const e = Array.isArray(row.entities) ? row.entities[0] : row.entities;
    if (!e) continue;
    if (!entityById.has(e.id)) entityById.set(e.id, e);
  }

  const { data: factRows } = await db
    .from("facts")
    .select("id, predicate, object_value, valid_from, subject_entity, source_id, metadata")
    .eq("organization_id", BASQUIO_TEAM_WORKSPACE_ID)
    .eq("source_type", "document")
    .is("superseded_by", null)
    .in("source_id", documentIds)
    .order("ingested_at", { ascending: false })
    .limit(20);

  const subjectIds = new Set<string>();
  for (const f of (factRows ?? []) as Array<{ subject_entity: string }>) {
    if (f.subject_entity) subjectIds.add(f.subject_entity);
  }

  let subjectNameById = new Map<string, string>();
  if (subjectIds.size > 0) {
    const { data: subjectRows } = await db
      .from("entities")
      .select("id, canonical_name")
      .in("id", Array.from(subjectIds));
    subjectNameById = new Map(
      ((subjectRows ?? []) as Array<{ id: string; canonical_name: string }>).map((r) => [
        r.id,
        r.canonical_name,
      ]),
    );
  }

  return NextResponse.json({
    documentCount: documentIds.length,
    entities: Array.from(entityById.values()).slice(0, 12),
    facts: ((factRows ?? []) as Array<{
      id: string;
      predicate: string;
      object_value: unknown;
      valid_from: string | null;
      subject_entity: string;
      metadata: Record<string, unknown> | null;
    }>)
      .slice(0, 12)
      .map((f) => ({
        id: f.id,
        subject: subjectNameById.get(f.subject_entity) ?? "unknown",
        predicate: f.predicate,
        object_value: f.object_value,
        valid_from: f.valid_from,
        evidence:
          typeof f.metadata?.evidence === "string" ? (f.metadata.evidence as string) : null,
      })),
  });
}
