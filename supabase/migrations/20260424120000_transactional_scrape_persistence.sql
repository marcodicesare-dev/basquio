-- Transactional dual-write for scrape persistence (B4a).
--
-- Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §5.3
-- and the adversarial review on commit d9c5112: the fetcher's 3-step
-- persist path (knowledge_documents insert, source_catalog_scrapes
-- upsert, file_ingest_runs enqueue) was sequential. If the middle
-- insert failed, the earlier insert stayed, producing orphaned rows
-- and a stale extraction queue.
--
-- This migration adds `ensure_scrape_persisted` which wraps all three
-- writes in a single transaction. On any error the entire set rolls
-- back. The function is owned by the service role and invoked via
-- PostgREST RPC from packages/research/src/cache.ts.
--
-- Idempotency: UPSERT on url_hash (source_catalog_scrapes), on id
-- (knowledge_documents), and on document_id (file_ingest_runs) so
-- calling this twice with the same inputs is safe. The second call
-- resolves via merge-duplicates, not unique-violation.

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_scrape_persisted(
  p_knowledge_document_id UUID,
  p_workspace_id UUID,
  p_organization_id UUID,
  p_filename TEXT,
  p_file_type TEXT,
  p_file_size_bytes INT,
  p_storage_path TEXT,
  p_content_hash TEXT,
  p_kind TEXT,
  p_source_catalog_id UUID,
  p_source_url TEXT,
  p_source_published_at TIMESTAMPTZ,
  p_source_trust_score INT,
  p_scrape_url TEXT,
  p_scrape_url_hash TEXT,
  p_scrape_title TEXT,
  p_scrape_content_markdown TEXT,
  p_scrape_content_tokens INT,
  p_scrape_language TEXT,
  p_fetcher_endpoint TEXT,
  p_fetcher_credits_used NUMERIC,
  p_document_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  knowledge_document_id UUID,
  cache_row_id UUID,
  file_ingest_run_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cache_row_id UUID;
  v_file_ingest_run_id UUID;
BEGIN
  -- 1. knowledge_documents (upsert on id).
  INSERT INTO public.knowledge_documents (
    id,
    workspace_id,
    organization_id,
    is_team_beta,
    filename,
    file_type,
    file_size_bytes,
    storage_path,
    uploaded_by,
    uploaded_by_discord_id,
    content_hash,
    status,
    metadata,
    kind,
    source_catalog_id,
    source_url,
    source_published_at,
    source_trust_score
  ) VALUES (
    p_knowledge_document_id,
    p_workspace_id,
    p_organization_id,
    TRUE,
    p_filename,
    p_file_type,
    p_file_size_bytes,
    p_storage_path,
    'basquio-research',
    'basquio-research',
    p_content_hash,
    'processing',
    p_document_metadata,
    p_kind,
    p_source_catalog_id,
    p_source_url,
    p_source_published_at,
    p_source_trust_score
  )
  ON CONFLICT (id) DO UPDATE SET
    filename = EXCLUDED.filename,
    file_type = EXCLUDED.file_type,
    file_size_bytes = EXCLUDED.file_size_bytes,
    storage_path = EXCLUDED.storage_path,
    content_hash = EXCLUDED.content_hash,
    metadata = EXCLUDED.metadata,
    source_catalog_id = EXCLUDED.source_catalog_id,
    source_url = EXCLUDED.source_url,
    source_published_at = EXCLUDED.source_published_at,
    source_trust_score = EXCLUDED.source_trust_score,
    updated_at = now();

  -- 2. source_catalog_scrapes (upsert on url_hash). metadata.knowledge_document_id
  -- links back to the knowledge_documents row so cache-hit lookups can
  -- resolve the stored markdown without a second fetch.
  INSERT INTO public.source_catalog_scrapes (
    source_id,
    workspace_id,
    url,
    url_hash,
    content_hash,
    title,
    published_at,
    content_markdown,
    content_tokens,
    language,
    metadata,
    fetcher_endpoint,
    fetcher_credits_used
  ) VALUES (
    p_source_catalog_id,
    p_workspace_id,
    p_scrape_url,
    p_scrape_url_hash,
    p_content_hash,
    p_scrape_title,
    p_source_published_at,
    p_scrape_content_markdown,
    p_scrape_content_tokens,
    p_scrape_language,
    jsonb_build_object('knowledge_document_id', p_knowledge_document_id::text),
    p_fetcher_endpoint,
    p_fetcher_credits_used
  )
  ON CONFLICT (url_hash) DO UPDATE SET
    content_hash = EXCLUDED.content_hash,
    title = EXCLUDED.title,
    content_markdown = EXCLUDED.content_markdown,
    content_tokens = EXCLUDED.content_tokens,
    language = EXCLUDED.language,
    metadata =
      public.source_catalog_scrapes.metadata
      || jsonb_build_object('knowledge_document_id', p_knowledge_document_id::text),
    fetcher_endpoint = EXCLUDED.fetcher_endpoint,
    fetcher_credits_used = EXCLUDED.fetcher_credits_used,
    fetched_at = now(),
    expires_at = now() + interval '24 hours'
  RETURNING id INTO v_cache_row_id;

  -- 3. file_ingest_runs (upsert on document_id). Queued so the consumer
  -- picks it up on the next poll.
  INSERT INTO public.file_ingest_runs (
    document_id,
    workspace_id,
    status,
    claimed_by,
    claimed_at,
    error_message,
    metadata
  ) VALUES (
    p_knowledge_document_id,
    p_workspace_id,
    'queued',
    NULL,
    NULL,
    NULL,
    jsonb_build_object('enqueued_by', 'ensure_scrape_persisted')
  )
  ON CONFLICT (document_id) DO UPDATE SET
    status = CASE
      WHEN public.file_ingest_runs.status IN ('indexed', 'indexing')
        THEN public.file_ingest_runs.status
      ELSE 'queued'
    END,
    error_message = NULL,
    updated_at = now()
  RETURNING id INTO v_file_ingest_run_id;

  RETURN QUERY SELECT p_knowledge_document_id, v_cache_row_id, v_file_ingest_run_id;
END;
$$;

COMMENT ON FUNCTION public.ensure_scrape_persisted IS
  'Transactional dual-write for research-layer scrape persistence. '
  'Wraps knowledge_documents + source_catalog_scrapes + file_ingest_runs '
  'in a single transaction so a mid-sequence failure cannot leave orphan '
  'rows. Invoked by packages/research/src/cache.ts#persistScrapeAtomic.';

-- Service role only; no anon / authenticated access.
REVOKE ALL ON FUNCTION public.ensure_scrape_persisted FROM public;
GRANT EXECUTE ON FUNCTION public.ensure_scrape_persisted TO service_role;

COMMIT;
