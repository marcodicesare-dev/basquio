import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_ORG_ID } from "@/lib/workspace/constants";
import { embedQuery } from "@/lib/workspace/embeddings";
import { listConversationAttachments } from "@/lib/workspace/conversation-attachments";
import { isRerankerEnabled, rerankChunks } from "@/lib/workspace/reranker";

export type ContextChunk = {
  chunkId: string;
  sourceType: "document" | "transcript";
  sourceId: string;
  filename: string | null;
  content: string;
  score: number;
  /**
   * Origin of this chunk in the priority stack. `conversation-attachment` means
   * the chunk came from a file attached to THIS chat; `workspace` means it
   * came from the broader workspace hybrid retrieval. UI + prompt renderers
   * can use this to label which lane surfaced the chunk.
   */
  rankSource: "conversation-attachment" | "workspace" | "inline-excerpt";
};

export type ContextEntity = {
  id: string;
  type: string;
  canonical_name: string;
  aliases: string[];
};

export type ContextFact = {
  id: string;
  predicate: string;
  object_value: unknown;
  valid_from: string | null;
  valid_to: string | null;
  source_id: string | null;
  evidence: string | null;
  subject_canonical_name: string;
  subject_type: string;
};

export type WorkspaceContext = {
  prompt: string;
  scope: string;
  chunks: ContextChunk[];
  entities: ContextEntity[];
  facts: ContextFact[];
  documents: Array<{ id: string; filename: string }>;
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export async function assembleWorkspaceContext({
  prompt,
  scope,
  conversationId,
  workspaceScopeId,
  chunkLimit = 10,
  entityLimit = 30,
  factLimit = 30,
}: {
  prompt: string;
  scope?: string;
  conversationId?: string | null;
  workspaceScopeId?: string | null;
  chunkLimit?: number;
  entityLimit?: number;
  factLimit?: number;
}): Promise<WorkspaceContext> {
  const db = getDb();
  const usedScope = scope ?? "workspace";

  const queryEmbedding = await embedQuery(prompt);

  // Prefer the new dual-lane RPC when we have a conversation id. Falls back to the
  // legacy workspace_hybrid_search when we don't (e.g. cron jobs, admin surfaces),
  // so existing callers keep their current behavior.
  //
  // When the reranker is enabled we overfetch to 2.5x so Haiku has a bigger pool
  // to work with, then trim back to chunkLimit after reranking.
  const useChatRetrieval = Boolean(conversationId);
  const overfetch = isRerankerEnabled() ? Math.max(chunkLimit, chunkLimit * 2 + 8) : chunkLimit;
  // workspaceScopeId is accepted by the caller API for forward-compatibility
  // but is not used to narrow Rank 2 today — see the RPC header comment. Kept
  // in the assembleWorkspaceContext input so once scope-on-chunks lands in a
  // follow-up migration, every caller threading through this function works
  // without further changes.
  void workspaceScopeId;
  const { data: chunkRows } = useChatRetrieval
    ? await db.rpc("workspace_chat_retrieval", {
        workspace_org_id: BASQUIO_TEAM_ORG_ID,
        conversation_id_param: conversationId,
        query_text: prompt,
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: overfetch,
      })
    : await db.rpc("workspace_hybrid_search", {
        workspace_org_id: BASQUIO_TEAM_ORG_ID,
        query_text: prompt,
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: overfetch,
      });

  const chunks: ContextChunk[] = [];
  const documentIds = new Set<string>();
  for (const row of (chunkRows ?? []) as Array<{
    chunk_id: string;
    source_type: "document" | "transcript";
    source_id: string;
    content: string;
    score: number;
    rank_source?: string;
  }>) {
    if (row.source_type === "document") {
      documentIds.add(row.source_id);
    }
    const rawRank = (row.rank_source ?? "workspace").toString();
    const rankSource: ContextChunk["rankSource"] =
      rawRank === "conversation-attachment" ? "conversation-attachment" : "workspace";
    chunks.push({
      chunkId: row.chunk_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      filename: null,
      content: row.content,
      score: Number(row.score),
      rankSource,
    });
  }

  // Rank-1 supplement: if the conversation has attached documents that haven't
  // finished indexing yet, surface their inline_excerpt so the first turn can
  // read the file the user just dropped. This is the crux of the dual-lane
  // UX contract — no "indexing, please wait" gap.
  if (useChatRetrieval && conversationId) {
    const attachments = await listConversationAttachments(conversationId).catch(() => []);
    const indexedAttachmentIds = new Set(
      attachments.filter((a) => a.status === "indexed").map((a) => a.document_id),
    );
    // Only surface inline excerpts for attachments whose chunks aren't already
    // in the result set (i.e. not indexed yet, or indexed but didn't match).
    for (const a of attachments) {
      const alreadyCovered = chunks.some(
        (c) => c.sourceType === "document" && c.sourceId === a.document_id,
      );
      if (alreadyCovered) continue;
      if (!a.inline_excerpt || a.inline_excerpt.length === 0) continue;
      // Push at the front so rendering keeps these first. Score = 1.0 + small
      // decay by attach order so stable ordering is deterministic.
      chunks.unshift({
        chunkId: `inline:${a.document_id}`,
        sourceType: "document",
        sourceId: a.document_id,
        filename: a.filename,
        content: a.inline_excerpt,
        score: indexedAttachmentIds.has(a.document_id) ? 0.95 : 1.0,
        rankSource: "inline-excerpt",
      });
      documentIds.add(a.document_id);
    }
  }

  let documents: Array<{ id: string; filename: string }> = [];
  if (documentIds.size > 0) {
    const { data } = await db
      .from("knowledge_documents")
      .select("id, filename")
      .in("id", Array.from(documentIds));
    documents = (data ?? []) as Array<{ id: string; filename: string }>;
    const filenameById = new Map(documents.map((d) => [d.id, d.filename]));
    for (const chunk of chunks) {
      if (chunk.sourceType === "document" && !chunk.filename) {
        chunk.filename = filenameById.get(chunk.sourceId) ?? null;
      }
    }
  }

  // Optional Haiku reranker (feature-flag BASQUIO_WORKSPACE_RERANKER=haiku).
  // Rank-1 lane chunks stay pinned; only the workspace tail is reordered.
  const rerankable = chunks.map((c) => ({
    key: c.chunkId,
    text: c.filename ? `[${c.filename}] ${c.content}` : c.content,
    payload: c,
    pinned:
      c.rankSource === "conversation-attachment" || c.rankSource === "inline-excerpt",
  }));
  const reranked = await rerankChunks({
    query: prompt,
    chunks: rerankable,
    topN: chunkLimit,
  });
  const finalChunks = reranked.map((r) => r.payload);

  const candidatePool = Math.max(entityLimit * 5, 100);
  const { data: candidateRows } = await db
    .from("entities")
    .select("id, type, canonical_name, aliases")
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("is_team_beta", true)
    .order("created_at", { ascending: false })
    .limit(candidatePool);

  const candidates = (candidateRows ?? []) as ContextEntity[];
  let entities: ContextEntity[] = candidates.slice(0, entityLimit);

  if (candidates.length > 0) {
    const { data: mentionRows } = await db
      .from("entity_mentions")
      .select("entity_id")
      .eq("organization_id", BASQUIO_TEAM_ORG_ID)
      .in("entity_id", candidates.map((e) => e.id));
    const mentionCounts = new Map<string, number>();
    for (const row of (mentionRows ?? []) as Array<{ entity_id: string }>) {
      mentionCounts.set(row.entity_id, (mentionCounts.get(row.entity_id) ?? 0) + 1);
    }
    entities = [...candidates]
      .sort((a, b) => (mentionCounts.get(b.id) ?? 0) - (mentionCounts.get(a.id) ?? 0))
      .slice(0, entityLimit);
  }
  const entityById = new Map(entities.map((e) => [e.id, e]));

  const { data: factRows } = await db
    .from("facts")
    .select(
      "id, predicate, object_value, valid_from, valid_to, source_id, metadata, subject_entity",
    )
    .eq("organization_id", BASQUIO_TEAM_ORG_ID)
    .eq("is_team_beta", true)
    .is("superseded_by", null)
    .order("ingested_at", { ascending: false })
    .limit(factLimit);

  const facts: ContextFact[] = [];
  for (const row of (factRows ?? []) as Array<{
    id: string;
    predicate: string;
    object_value: unknown;
    valid_from: string | null;
    valid_to: string | null;
    source_id: string | null;
    metadata: Record<string, unknown> | null;
    subject_entity: string;
  }>) {
    const subject = entityById.get(row.subject_entity);
    if (!subject) continue;
    facts.push({
      id: row.id,
      predicate: row.predicate,
      object_value: row.object_value,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      source_id: row.source_id,
      evidence: typeof row.metadata?.evidence === "string" ? row.metadata.evidence : null,
      subject_canonical_name: subject.canonical_name,
      subject_type: subject.type,
    });
  }

  return {
    prompt,
    scope: usedScope,
    chunks: finalChunks,
    entities,
    facts,
    documents,
  };
}

export function renderContextForPrompt(ctx: WorkspaceContext): string {
  const lines: string[] = [];

  if (ctx.entities.length > 0) {
    lines.push("## Entities the workspace knows about");
    const grouped = new Map<string, ContextEntity[]>();
    for (const e of ctx.entities) {
      if (!grouped.has(e.type)) grouped.set(e.type, []);
      grouped.get(e.type)!.push(e);
    }
    for (const [type, list] of grouped) {
      lines.push(`- ${type}: ${list.map((e) => e.canonical_name).join(", ")}`);
    }
    lines.push("");
  }

  if (ctx.facts.length > 0) {
    lines.push("## Facts grounded in prior uploads");
    for (const f of ctx.facts) {
      const value = formatFactValue(f.object_value);
      const period = f.valid_from
        ? ` (${f.valid_from.slice(0, 10)}${f.valid_to ? ` to ${f.valid_to.slice(0, 10)}` : ""})`
        : "";
      lines.push(`- ${f.subject_canonical_name} | ${f.predicate}: ${value}${period}`);
      if (f.evidence) lines.push(`  evidence: "${f.evidence}"`);
    }
    lines.push("");
  }

  if (ctx.chunks.length > 0) {
    lines.push("## Source excerpts (use for citations, label as [s1], [s2]…)");
    ctx.chunks.forEach((chunk, idx) => {
      const label = `[s${idx + 1}]`;
      const source = chunk.filename ?? `${chunk.sourceType}:${chunk.sourceId.slice(0, 8)}`;
      lines.push(`${label} from ${source}`);
      lines.push(chunk.content);
      lines.push("");
    });
  }

  if (lines.length === 0) {
    lines.push("(The workspace is empty so far. Be honest if there is nothing to cite.)");
  }

  return lines.join("\n").trim();
}

function formatFactValue(value: unknown): string {
  if (value == null) return "unknown";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("value" in value) {
      const obj = value as { value: unknown; unit?: string; period?: string };
      return [String(obj.value ?? ""), obj.unit, obj.period].filter(Boolean).join(" ").trim();
    }
    return JSON.stringify(value);
  }
  return String(value);
}
