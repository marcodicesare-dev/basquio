-- Knowledge base tables + pgvector for semantic search

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Documents (file-level metadata) ─────────────────────────────

CREATE TABLE public.knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN (
    'pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp',
    'md', 'txt', 'csv', 'screenshot'
  )),
  file_size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_by_discord_id TEXT NOT NULL,
  upload_context TEXT,
  chunk_count INTEGER DEFAULT 0,
  page_count INTEGER,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN (
    'processing', 'indexed', 'failed', 'deleted'
  )),
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Chunks (text + embeddings) ──────────────────────────────────

CREATE TABLE public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  token_count INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Transcript chunks (embed existing transcripts) ──────────────

CREATE TABLE public.transcript_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID NOT NULL REFERENCES public.transcripts(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  speaker TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ─────────────────────────────────────────────────────

-- HNSW vector indexes (fast approximate nearest neighbor)
CREATE INDEX idx_knowledge_chunks_embedding ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_transcript_chunks_embedding ON public.transcript_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- Full-text search indexes (for hybrid search)
CREATE INDEX idx_knowledge_chunks_fts ON public.knowledge_chunks
  USING GIN (to_tsvector('english', content));

CREATE INDEX idx_transcript_chunks_fts ON public.transcript_chunks
  USING GIN (to_tsvector('english', content));

-- Metadata indexes
CREATE INDEX idx_knowledge_documents_status ON public.knowledge_documents (status);
CREATE INDEX idx_knowledge_documents_file_type ON public.knowledge_documents (file_type);
CREATE INDEX idx_knowledge_documents_hash ON public.knowledge_documents (content_hash);
CREATE INDEX idx_knowledge_chunks_document ON public.knowledge_chunks (document_id);
CREATE INDEX idx_transcript_chunks_transcript ON public.transcript_chunks (transcript_id);

-- ── Hybrid Search RPC Function ──────────────────────────────────

CREATE OR REPLACE FUNCTION hybrid_search(
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
-- Full-text search across both tables
fts_docs AS (
  SELECT
    id AS chunk_id,
    'document'::TEXT AS source_type,
    document_id AS source_id,
    content,
    metadata,
    ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector('english', content), websearch_to_tsquery(query_text)) DESC) AS rank_ix
  FROM public.knowledge_chunks
  WHERE to_tsvector('english', content) @@ websearch_to_tsquery(query_text)
  LIMIT match_count * 5
),
fts_transcripts AS (
  SELECT
    id AS chunk_id,
    'transcript'::TEXT AS source_type,
    transcript_id AS source_id,
    content,
    metadata,
    ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector('english', content), websearch_to_tsquery(query_text)) DESC) AS rank_ix
  FROM public.transcript_chunks
  WHERE to_tsvector('english', content) @@ websearch_to_tsquery(query_text)
  LIMIT match_count * 5
),
fts_all AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY rank_ix) AS fts_rank FROM (
    SELECT * FROM fts_docs
    UNION ALL
    SELECT * FROM fts_transcripts
  ) combined
),
-- Semantic search across both tables
sem_docs AS (
  SELECT
    id AS chunk_id,
    'document'::TEXT AS source_type,
    document_id AS source_id,
    content,
    metadata,
    embedding <=> query_embedding AS distance
  FROM public.knowledge_chunks
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
-- RRF fusion
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

-- ── RLS Policies ────────────────────────────────────────────────

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cofounders can read documents"
  ON public.knowledge_documents FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Cofounders can read chunks"
  ON public.knowledge_chunks FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Cofounders can read transcript chunks"
  ON public.transcript_chunks FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Bot can manage documents"
  ON public.knowledge_documents FOR ALL
  TO service_role USING (true);

CREATE POLICY "Bot can manage chunks"
  ON public.knowledge_chunks FOR ALL
  TO service_role USING (true);

CREATE POLICY "Bot can manage transcript chunks"
  ON public.transcript_chunks FOR ALL
  TO service_role USING (true);

-- ── Storage bucket for knowledge base files ─────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-base', 'knowledge-base', false);

CREATE POLICY "Bot can upload to knowledge-base"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'knowledge-base');

CREATE POLICY "Cofounders can download from knowledge-base"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'knowledge-base');
