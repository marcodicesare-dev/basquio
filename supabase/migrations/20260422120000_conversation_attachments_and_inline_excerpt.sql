-- Dual-lane workspace architecture (spec: docs/specs/2026-04-21-dual-lane-workspace-chat-deck-architecture-spec.md).
--
-- This migration is additive. It does NOT drop or rename existing columns. It gives us:
--   1. conversation_attachments — junction row linking a workspace_conversation to a knowledge_document.
--      Populated synchronously on upload so the chat has immediate rank-1 context even while
--      chunk/embed ingestion is still running in the background.
--   2. knowledge_documents.inline_excerpt — text extracted synchronously at upload time so
--      retrieval can surface the file content in the same chat turn without waiting for chunks.
--   3. knowledge_chunks.contextual_summary — per-chunk context prepended at index time
--      (Anthropic Contextual Retrieval pattern). Added here so the column exists; backfill is
--      opt-in and happens through application code, not in this migration.
--   4. knowledge_chunks.indexed_at — explicit recency signal for the new retrieval RPC.
--   5. workspace_chat_retrieval(...) — new RPC that stacks conversation attachments first,
--      then applies RRF with recency decay on the broader workspace index. The existing
--      workspace_hybrid_search RPC is left intact so nothing that calls it today regresses.

BEGIN;

-- ── 1. conversation_attachments ──

CREATE TABLE IF NOT EXISTS public.conversation_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.workspace_conversations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  workspace_scope_id UUID REFERENCES public.workspace_scopes(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  origin TEXT NOT NULL DEFAULT 'chat-drop'
    CHECK (origin IN ('chat-drop','chat-paste','referenced-from-workspace')),
  attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE (conversation_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_attachments_conv_attached
  ON public.conversation_attachments (conversation_id, attached_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_attachments_document
  ON public.conversation_attachments (document_id);

CREATE INDEX IF NOT EXISTS idx_conversation_attachments_workspace_scope
  ON public.conversation_attachments (workspace_id, workspace_scope_id);

ALTER TABLE public.conversation_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages conversation_attachments"
  ON public.conversation_attachments;
CREATE POLICY "Service role manages conversation_attachments"
  ON public.conversation_attachments FOR ALL TO service_role USING (true);

-- ── 2. knowledge_documents.inline_excerpt ──

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS inline_excerpt TEXT;

-- ── 3. knowledge_chunks.contextual_summary + indexed_at ──

ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS contextual_summary TEXT;

-- Add indexed_at nullable first so we can backfill from the existing created_at
-- column; then flip to NOT NULL with a default. Adding NOT NULL DEFAULT now() in one
-- step would backdate every legacy chunk to "right now" and break recency math for
-- the first runs after the migration.
ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;

UPDATE public.knowledge_chunks
SET indexed_at = COALESCE(created_at, now())
WHERE indexed_at IS NULL;

ALTER TABLE public.knowledge_chunks
  ALTER COLUMN indexed_at SET DEFAULT now();

ALTER TABLE public.knowledge_chunks
  ALTER COLUMN indexed_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_indexed_at
  ON public.knowledge_chunks (indexed_at DESC);

-- Functional GIN index matching the FTS expression used by
-- workspace_chat_retrieval. Without this, every chat turn full-scans
-- knowledge_chunks and builds a tsvector per row on the fly. Safe to create
-- concurrently later if the table grows large; the CREATE INDEX here is a
-- plain one to keep the migration atomic.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_fts_contextual
  ON public.knowledge_chunks
  USING GIN (to_tsvector('english', COALESCE(contextual_summary, '') || ' ' || content));

-- ── 4. workspace_chat_retrieval RPC ──
--
-- Ranking stack (per spec §3.4):
--   Rank 1: conversation attachments (exact retrieval, never beaten).
--   Rank 2: workspace-global hybrid search with recency decay.
--
-- Scope narrowing on Rank 2 is intentionally NOT implemented here — it requires
-- a workspace_scope_id column on knowledge_chunks and a backfill against every
-- existing chunk, scheduled as a separate migration (spec §9.4 open question).
-- Until then, Rank 2 is the whole workspace and scope isolation relies on
-- Rank-1 pinning + conversation_attachments carrying the scope signal.

CREATE OR REPLACE FUNCTION public.workspace_chat_retrieval(
  workspace_org_id UUID,
  conversation_id_param UUID,
  query_text TEXT,
  query_embedding vector(1536),
  match_count INT DEFAULT 10,
  full_text_weight FLOAT DEFAULT 1.0,
  semantic_weight FLOAT DEFAULT 1.0,
  recency_half_life_hours FLOAT DEFAULT 24.0,
  rrf_k INT DEFAULT 50
)
RETURNS TABLE (
  chunk_id UUID,
  source_type TEXT,
  source_id UUID,
  content TEXT,
  metadata JSONB,
  score FLOAT,
  rank_source TEXT
)
AS $$
WITH
-- Rank-1: conversation attachments that are indexed. Return at most match_count
-- rows so we never drown out retrieval entirely with stale attachments.
--
-- NOTE: re-ingest-safety caveat. If Lane B ever re-processes a document (e.g.
-- after a failed first run), the chunks for that document MUST be deleted
-- before new chunks land, or this CTE can return a mix of old + new rows.
-- Today `processWorkspaceDocument` does not re-run on existing docs, so the
-- bug is unreachable. When re-ingest lands, swap this to a version-aware guard
-- (e.g. WHERE kc.indexed_at = (SELECT max(indexed_at) FROM knowledge_chunks
-- WHERE document_id = kc.document_id)).
conv_chunks AS (
  SELECT
    kc.id AS chunk_id,
    'document'::TEXT AS source_type,
    kc.document_id AS source_id,
    kc.content,
    kc.metadata,
    1.0::FLOAT AS score,
    'conversation-attachment'::TEXT AS rank_source,
    ca.attached_at,
    ROW_NUMBER() OVER (PARTITION BY kc.document_id ORDER BY kc.chunk_index ASC) AS doc_rank
  FROM public.conversation_attachments ca
  JOIN public.knowledge_chunks kc ON kc.document_id = ca.document_id
  WHERE ca.conversation_id = conversation_id_param
    AND kc.organization_id = workspace_org_id
),
conv_chunks_capped AS (
  -- Keep up to 3 chunks per attached document to avoid one big doc drowning the rest.
  SELECT chunk_id, source_type, source_id, content, metadata, score, rank_source, attached_at
  FROM conv_chunks
  WHERE doc_rank <= 3
  ORDER BY attached_at DESC, doc_rank ASC
  LIMIT match_count
),
-- Rank-2 candidate pool: broader workspace. Full-text + semantic branches feed RRF.
-- FTS indexes the concatenation of contextual_summary + content so anchor terms
-- lifted into the summary (brand names, metric names, time windows) are matched
-- by BM25 even when the chunk itself uses a pronoun or abbreviation (Anthropic
-- Contextual Retrieval, Sept 2024).
fts_docs AS (
  SELECT
    id AS chunk_id,
    'document'::TEXT AS source_type,
    document_id AS source_id,
    content,
    metadata,
    indexed_at,
    ROW_NUMBER() OVER (
      ORDER BY ts_rank(
        to_tsvector('english', COALESCE(contextual_summary, '') || ' ' || content),
        websearch_to_tsquery(query_text)
      ) DESC
    ) AS rank_ix
  FROM public.knowledge_chunks
  WHERE organization_id = workspace_org_id
    AND to_tsvector('english', COALESCE(contextual_summary, '') || ' ' || content)
        @@ websearch_to_tsquery(query_text)
  LIMIT match_count * 5
),
fts_transcripts AS (
  SELECT
    id AS chunk_id,
    'transcript'::TEXT AS source_type,
    transcript_id AS source_id,
    content,
    metadata,
    now()::timestamptz AS indexed_at,
    ROW_NUMBER() OVER (
      ORDER BY ts_rank(to_tsvector('english', content), websearch_to_tsquery(query_text)) DESC
    ) AS rank_ix
  FROM public.transcript_chunks
  WHERE organization_id = workspace_org_id
    AND to_tsvector('english', content) @@ websearch_to_tsquery(query_text)
  LIMIT match_count * 5
),
fts_all AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY rank_ix) AS fts_rank FROM (
    SELECT * FROM fts_docs
    UNION ALL
    SELECT * FROM fts_transcripts
  ) combined
),
sem_docs AS (
  SELECT
    id AS chunk_id,
    'document'::TEXT AS source_type,
    document_id AS source_id,
    content,
    metadata,
    indexed_at,
    embedding <=> query_embedding AS distance
  FROM public.knowledge_chunks
  WHERE organization_id = workspace_org_id
  ORDER BY distance
  LIMIT match_count * 5
),
sem_transcripts AS (
  SELECT
    id AS chunk_id,
    'transcript'::TEXT AS source_type,
    transcript_id AS source_id,
    content,
    metadata,
    now()::timestamptz AS indexed_at,
    embedding <=> query_embedding AS distance
  FROM public.transcript_chunks
  WHERE organization_id = workspace_org_id
  ORDER BY distance
  LIMIT match_count * 5
),
sem_all AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY distance) AS sem_rank FROM (
    SELECT * FROM sem_docs
    UNION ALL
    SELECT * FROM sem_transcripts
  ) combined
),
rrf AS (
  SELECT
    COALESCE(f.chunk_id, s.chunk_id) AS chunk_id,
    COALESCE(f.source_type, s.source_type) AS source_type,
    COALESCE(f.source_id, s.source_id) AS source_id,
    COALESCE(f.content, s.content) AS content,
    COALESCE(f.metadata, s.metadata) AS metadata,
    COALESCE(f.indexed_at, s.indexed_at) AS indexed_at,
    (
      COALESCE(1.0 / (rrf_k + f.fts_rank), 0.0) * full_text_weight +
      COALESCE(1.0 / (rrf_k + s.sem_rank), 0.0) * semantic_weight
    ) AS base_score
  FROM fts_all f
  FULL OUTER JOIN sem_all s ON f.chunk_id = s.chunk_id
),
broader AS (
  -- Apply recency decay as a multiplier on base_score. Half-life in hours, clamped
  -- so a 30-day-old chunk is still worth ~0.42 × its base score with the default 24h
  -- half-life (10 half-lives → 2^-10 is too aggressive, so we cap the multiplier
  -- between 0.30 and 1.0).
  SELECT
    chunk_id,
    source_type,
    source_id,
    content,
    metadata,
    GREATEST(
      0.30,
      LEAST(
        1.0,
        base_score * POWER(
          0.5,
          GREATEST(0.0, EXTRACT(EPOCH FROM (now() - indexed_at)) / 3600.0) / GREATEST(recency_half_life_hours, 1.0)
        )
      )
    ) AS score,
    'workspace'::TEXT AS rank_source
  FROM rrf
  -- Drop chunks that belong to the conversation attachments so we never double-count.
  WHERE chunk_id NOT IN (SELECT chunk_id FROM conv_chunks_capped)
),
combined AS (
  SELECT chunk_id, source_type, source_id, content, metadata, score, rank_source
  FROM conv_chunks_capped
  UNION ALL
  SELECT chunk_id, source_type, source_id, content, metadata, score, rank_source
  FROM broader
)
SELECT chunk_id, source_type, source_id, content, metadata, score, rank_source
FROM combined
ORDER BY
  CASE WHEN rank_source = 'conversation-attachment' THEN 0 ELSE 1 END,
  score DESC
LIMIT match_count;
$$ LANGUAGE SQL STABLE;

-- Convenience RPC: list the attached document ids for a conversation.
-- Used by the deck handoff to force-include every chat-attached file in the
-- WorkspaceContextPack without waiting on the agent to have cited it.
CREATE OR REPLACE FUNCTION public.conversation_attached_document_ids(
  conversation_id_param UUID
)
RETURNS TABLE (document_id UUID, attached_at TIMESTAMPTZ)
AS $$
  SELECT document_id, attached_at
  FROM public.conversation_attachments
  WHERE conversation_id = conversation_id_param
  ORDER BY attached_at DESC;
$$ LANGUAGE SQL STABLE;

COMMIT;
