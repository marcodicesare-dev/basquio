-- Source catalog scrape cache with 24-hour TTL for dedup and cost control.
--
-- Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §3.2.
-- This cache is purely for scrape-cost dedup (do not re-hit Firecrawl or
-- Fiber on the same URL within the TTL). The persistent workspace knowledge
-- derived from a scrape lives in knowledge_documents and stays forever
-- until explicitly archived. See §5.3 "Important distinction between
-- expires_at and durability."
--
-- Dedupe strategy:
--   - url_hash catches the exact URL
--   - content_hash catches the same article republished under a different URL
--
-- The fetcher looks up fresh cache entries (expires_at > now()) before
-- firing any external-intelligence call.

BEGIN;

CREATE TABLE IF NOT EXISTS public.source_catalog_scrapes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.source_catalog(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT,
  published_at TIMESTAMPTZ,
  content_markdown TEXT NOT NULL,
  content_tokens INT,
  language TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  -- fetcher_endpoint unifies Firecrawl endpoints and the Fiber AI LinkedIn
  -- path. Values 'scrape','crawl','batch-scrape','map','search' correspond
  -- to the Firecrawl v2 endpoints in spec §4; 'fiber' covers every
  -- linkedin_fiber source_type scrape per spec §5.7.
  fetcher_endpoint TEXT NOT NULL CHECK (fetcher_endpoint IN (
    'scrape','crawl','batch-scrape','map','search','fiber'
  )),
  fetcher_credits_used NUMERIC(10,4),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (url_hash)
);

CREATE INDEX IF NOT EXISTS source_catalog_scrapes_source_idx
  ON public.source_catalog_scrapes (source_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS source_catalog_scrapes_workspace_idx
  ON public.source_catalog_scrapes (workspace_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS source_catalog_scrapes_content_hash_idx
  ON public.source_catalog_scrapes (content_hash);

-- Composite index supports the fetcher's "fresh cache hit?" query:
--   SELECT ... WHERE workspace_id = $1 AND url_hash = $2 AND expires_at > now()
-- A partial predicate on now() is rejected (now is STABLE, not IMMUTABLE),
-- so the index is the full composite and Postgres filters at query time.
CREATE INDEX IF NOT EXISTS source_catalog_scrapes_workspace_expires_idx
  ON public.source_catalog_scrapes (workspace_id, expires_at DESC);

ALTER TABLE public.source_catalog_scrapes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages source_catalog_scrapes"
  ON public.source_catalog_scrapes FOR ALL TO service_role USING (true);

COMMIT;
