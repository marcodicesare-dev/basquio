-- V1 Workspace schema. Per docs/spec-v1-workspace.md and docs/motion2-workspace-architecture.md §2.
-- Adds organization_id scoping to existing knowledge tables, creates entities + facts + memory tables,
-- and gates everything with is_team_beta for team dogfood isolation per docs/spec-v1-team-access-mode.md.

-- ── Allow web (non-Discord) uploads on existing knowledge_documents ──────

ALTER TABLE public.knowledge_documents
  ALTER COLUMN uploaded_by_discord_id DROP NOT NULL;

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── Workspace organization scope on existing tables ──────────────────────

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS is_team_beta BOOLEAN DEFAULT FALSE;

ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS is_team_beta BOOLEAN DEFAULT FALSE;

ALTER TABLE public.transcript_chunks
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS is_team_beta BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_organization
  ON public.knowledge_documents (organization_id, is_team_beta, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_organization
  ON public.knowledge_chunks (organization_id, is_team_beta);

CREATE INDEX IF NOT EXISTS idx_transcript_chunks_organization
  ON public.transcript_chunks (organization_id, is_team_beta);

-- ── Entities (Person, Brand, Category, Retailer, Metric, Deliverable, Question) ──

CREATE TABLE IF NOT EXISTS public.entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  is_team_beta BOOLEAN NOT NULL DEFAULT FALSE,
  type TEXT NOT NULL CHECK (type IN (
    'person', 'organization', 'brand', 'category', 'sub_category',
    'sku', 'retailer', 'metric', 'deliverable', 'question', 'meeting',
    'email', 'document'
  )),
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, type, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_entities_org_type
  ON public.entities (organization_id, type);

CREATE INDEX IF NOT EXISTS idx_entities_aliases
  ON public.entities USING GIN (aliases);

-- ── Entity mentions (every appearance of an entity in a source) ──

CREATE TABLE IF NOT EXISTS public.entity_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  is_team_beta BOOLEAN NOT NULL DEFAULT FALSE,
  entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('document', 'transcript', 'chunk')),
  source_id UUID NOT NULL,
  excerpt TEXT,
  mentioned_at TIMESTAMPTZ,
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_mentions_org_entity
  ON public.entity_mentions (organization_id, entity_id);

CREATE INDEX IF NOT EXISTS idx_entity_mentions_source
  ON public.entity_mentions (source_type, source_id);

-- ── Facts (bi-temporal: event time + ingestion time, supersession chain) ──

CREATE TABLE IF NOT EXISTS public.facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  is_team_beta BOOLEAN NOT NULL DEFAULT FALSE,
  subject_entity UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  predicate TEXT NOT NULL,
  object_value JSONB NOT NULL DEFAULT '{}',
  object_entity UUID REFERENCES public.entities(id) ON DELETE SET NULL,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_id UUID,
  source_type TEXT CHECK (source_type IN ('document', 'transcript', 'chunk', 'manual')),
  superseded_by UUID REFERENCES public.facts(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_facts_org_subject_predicate
  ON public.facts (organization_id, subject_entity, predicate);

CREATE INDEX IF NOT EXISTS idx_facts_valid_window
  ON public.facts (organization_id, subject_entity, valid_from, valid_to);

CREATE INDEX IF NOT EXISTS idx_facts_active
  ON public.facts (organization_id, subject_entity)
  WHERE superseded_by IS NULL;

-- ── Memory entries (Anthropic Memory Tool backing store) ──

CREATE TABLE IF NOT EXISTS public.memory_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  is_team_beta BOOLEAN NOT NULL DEFAULT FALSE,
  scope TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('semantic', 'episodic', 'procedural')),
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, scope, path)
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_org_scope
  ON public.memory_entries (organization_id, scope, memory_type);

CREATE INDEX IF NOT EXISTS idx_memory_entries_path
  ON public.memory_entries (organization_id, scope, path);

-- HNSW vector index requires non-null embedding; keep it partial.
CREATE INDEX IF NOT EXISTS idx_memory_entries_embedding
  ON public.memory_entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE embedding IS NOT NULL;

-- ── Workspace deliverables (output artifacts produced from workspace context) ──

CREATE TABLE IF NOT EXISTS public.workspace_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  is_team_beta BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('answer', 'memo', 'deck', 'workbook', 'chart')),
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN (
    'generating', 'ready', 'failed', 'archived'
  )),
  body_markdown TEXT,
  citations JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_deliverables_org_created
  ON public.workspace_deliverables (organization_id, is_team_beta, created_at DESC);

-- ── RLS: keep existing service-role-only writes; add authenticated read scoped to org_id ──

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_deliverables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages entities"
  ON public.entities FOR ALL TO service_role USING (true);
CREATE POLICY "Service role manages entity_mentions"
  ON public.entity_mentions FOR ALL TO service_role USING (true);
CREATE POLICY "Service role manages facts"
  ON public.facts FOR ALL TO service_role USING (true);
CREATE POLICY "Service role manages memory_entries"
  ON public.memory_entries FOR ALL TO service_role USING (true);
CREATE POLICY "Service role manages workspace_deliverables"
  ON public.workspace_deliverables FOR ALL TO service_role USING (true);

-- Authenticated reads: scoped via API endpoints (service role queries with org_id filter).
-- Policies remain restrictive at table level. Keep parity with knowledge_* tables.

-- ── Workspace-scoped hybrid search (parallel to existing hybrid_search) ──

CREATE OR REPLACE FUNCTION public.workspace_hybrid_search(
  workspace_org_id UUID,
  query_text TEXT,
  query_embedding vector(1536),
  match_count INT DEFAULT 10,
  full_text_weight FLOAT DEFAULT 1.0,
  semantic_weight FLOAT DEFAULT 1.0,
  rrf_k INT DEFAULT 50
)
RETURNS TABLE (
  chunk_id UUID,
  source_type TEXT,
  source_id UUID,
  content TEXT,
  metadata JSONB,
  score FLOAT
)
AS $$
WITH
fts_docs AS (
  SELECT
    id AS chunk_id,
    'document'::TEXT AS source_type,
    document_id AS source_id,
    content,
    metadata,
    ROW_NUMBER() OVER (
      ORDER BY ts_rank(to_tsvector('english', content), websearch_to_tsquery(query_text)) DESC
    ) AS rank_ix
  FROM public.knowledge_chunks
  WHERE organization_id = workspace_org_id
    AND to_tsvector('english', content) @@ websearch_to_tsquery(query_text)
  LIMIT match_count * 5
),
fts_transcripts AS (
  SELECT
    id AS chunk_id,
    'transcript'::TEXT AS source_type,
    transcript_id AS source_id,
    content,
    metadata,
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
    (
      COALESCE(1.0 / (rrf_k + f.fts_rank), 0.0) * full_text_weight +
      COALESCE(1.0 / (rrf_k + s.sem_rank), 0.0) * semantic_weight
    ) AS score
  FROM fts_all f
  FULL OUTER JOIN sem_all s ON f.chunk_id = s.chunk_id
)
SELECT chunk_id, source_type, source_id, content, metadata, score
FROM rrf
ORDER BY score DESC
LIMIT match_count;
$$ LANGUAGE SQL STABLE;
