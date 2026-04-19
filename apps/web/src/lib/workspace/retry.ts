import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID } from "@/lib/workspace/constants";

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

/**
 * Clean orphan rows tied to a single document. Used before retrying extraction
 * so a partial earlier attempt does not leave stale chunks/mentions/facts.
 */
export async function cleanOrphansForDocument(documentId: string): Promise<void> {
  const db = getDb();
  await Promise.all([
    db
      .from("knowledge_chunks")
      .delete()
      .eq("document_id", documentId)
      .eq("organization_id", BASQUIO_TEAM_ORG_ID),
    db
      .from("entity_mentions")
      .delete()
      .eq("source_id", documentId)
      .eq("source_type", "document")
      .eq("organization_id", BASQUIO_TEAM_ORG_ID),
    db
      .from("facts")
      .delete()
      .eq("source_id", documentId)
      .eq("source_type", "document")
      .eq("organization_id", BASQUIO_TEAM_ORG_ID),
  ]);
}

export async function markDocumentForRetry(documentId: string): Promise<void> {
  const db = getDb();
  await db
    .from("knowledge_documents")
    .update({
      status: "processing",
      error_message: null,
      chunk_count: 0,
      page_count: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("organization_id", BASQUIO_TEAM_ORG_ID);
}
