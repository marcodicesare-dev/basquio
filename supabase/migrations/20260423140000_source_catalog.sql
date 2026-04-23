-- Source catalog: curated per-workspace list of trusted research sources.
--
-- Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §3.1.
-- Feeds the research-layer planner (§5.2) and fetcher (§5.3). Rows are
-- seeded in a separate migration (20260423180000_source_catalog_seed.sql)
-- so the schema and the data churn independently.
--
-- source_type 'linkedin_fiber' covers LinkedIn intelligence routed through
-- Fiber AI rather than Firecrawl; the fetcher selects the client based on
-- this value. See §2.9 and §5.7 for the ToS-safety rationale.

BEGIN;

CREATE TABLE IF NOT EXISTS public.source_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  tier INT NOT NULL CHECK (tier BETWEEN 1 AND 5),
  language TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'trade_press','retailer','association','stats','market_research','brand','news','cross_reference','linkedin_fiber'
  )),
  domain_tags TEXT[] NOT NULL DEFAULT '{}',
  crawl_patterns JSONB NOT NULL DEFAULT '{}',
  trust_score INT NOT NULL CHECK (trust_score BETWEEN 0 AND 100) DEFAULT 70,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','broken','removed')),
  last_verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, url)
);

CREATE INDEX IF NOT EXISTS source_catalog_workspace_tier_idx
  ON public.source_catalog (workspace_id, tier, status);

CREATE INDEX IF NOT EXISTS source_catalog_host_idx
  ON public.source_catalog (host);

CREATE INDEX IF NOT EXISTS source_catalog_domain_tags_idx
  ON public.source_catalog USING GIN (domain_tags);

ALTER TABLE public.source_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages source_catalog"
  ON public.source_catalog FOR ALL TO service_role USING (true);

DROP TRIGGER IF EXISTS trg_source_catalog_touch ON public.source_catalog;
CREATE TRIGGER trg_source_catalog_touch
  BEFORE UPDATE ON public.source_catalog
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
