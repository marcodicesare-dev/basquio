-- Switch hybrid_search FTS from 'english' to 'simple' config.
-- 'simple' does no language-specific stemming, making it work for
-- Italian, English, and mixed-language content.

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
fts_docs AS (
  SELECT
    id AS chunk_id,
    'document'::TEXT AS source_type,
    document_id AS source_id,
    content,
    metadata,
    ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector('simple', content), websearch_to_tsquery('simple', query_text)) DESC) AS rank_ix
  FROM public.knowledge_chunks
  WHERE to_tsvector('simple', content) @@ websearch_to_tsquery('simple', query_text)
  LIMIT match_count * 5
),
fts_transcripts AS (
  SELECT
    id AS chunk_id,
    'transcript'::TEXT AS source_type,
    transcript_id AS source_id,
    content,
    metadata,
    ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector('simple', content), websearch_to_tsquery('simple', query_text)) DESC) AS rank_ix
  FROM public.transcript_chunks
  WHERE to_tsvector('simple', content) @@ websearch_to_tsquery('simple', query_text)
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
