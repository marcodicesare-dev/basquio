-- Francesco's source additions + mark-up.it trust-score bump (2026-04-23).
--
-- The Day 1 seed migration (20260423180000_source_catalog_seed.sql) was
-- already applied to remote on 2026-04-23 before Francesco's Discord
-- feedback arrived. This follow-up migration ships as a separate file
-- rather than appending to the Day 1 seed so the applied-migration
-- history stays honest.
--
-- Three changes:
--
--   1. retailwatch.it  (new, paused, pending verification)
--   2. repubblica.it osserva-italia section  (new, paused, Zephr paywall)
--   3. mark-up.it trust_score bumped 85 -> 90 (both Rossella and Francesco
--      independently named it)
--
-- Catalog totals after this migration: 18 active + 15 paused = 33 rows
-- scoped to BASQUIO_TEAM_WORKSPACE_ID.

BEGIN;

-- ── 1. retailwatch.it (Tier 1 Italian GDO, news-heavy) ──

INSERT INTO public.source_catalog (
  workspace_id, url, host, tier, language, source_type,
  domain_tags, crawl_patterns, trust_score, status, metadata
) VALUES (
  '15cc947e-70cb-455a-b0df-d8c34b760d71',
  'https://www.retailwatch.it',
  'retailwatch.it',
  1,
  'it',
  'trade_press',
  ARRAY['gdo','retail','news'],
  '{"crawl_allow":["/news/.*","/articoli/.*"],"requires_enhanced_proxy":false,"max_pages_per_crawl":200}'::jsonb,
  80,
  'paused',
  jsonb_build_object(
    'seeded_by', '20260423190000',
    'paused_reason', 'pending_verification_2026-04-23',
    'source', 'francesco_feedback',
    'note', 'news-heavy but widely read; reach greater than depth'
  )
)
ON CONFLICT (workspace_id, url) DO NOTHING;

-- ── 2. repubblica.it Osserva Italia (Tier 2 data-journalism, Zephr paywall) ──

INSERT INTO public.source_catalog (
  workspace_id, url, host, tier, language, source_type,
  domain_tags, crawl_patterns, trust_score, status, metadata
) VALUES (
  '15cc947e-70cb-455a-b0df-d8c34b760d71',
  'https://www.repubblica.it/economia/rapporti/osserva-italia/',
  'repubblica.it',
  2,
  'it',
  'news',
  ARRAY['economics','business','osserva_italia','data_journalism'],
  '{"crawl_allow":["/economia/rapporti/osserva-italia/.*"],"requires_enhanced_proxy":true,"max_pages_per_crawl":200}'::jsonb,
  75,
  'paused',
  jsonb_build_object(
    'seeded_by', '20260423190000',
    'paused_reason', 'zephr_paywall_needs_stealth_proxy',
    'source', 'francesco_feedback',
    'note', 'Zephr paywall plus AWS ALB session cookies; same blocker class as confcommercio.it'
  )
)
ON CONFLICT (workspace_id, url) DO NOTHING;

-- ── 3. mark-up.it trust-score bump ──
-- Idempotent UPDATE so re-applying the migration stays safe. The
-- metadata merge appends bump provenance without clobbering the
-- existing seeded_by key.

UPDATE public.source_catalog
SET
  trust_score = 90,
  metadata = metadata || jsonb_build_object(
    'trust_bumped_by', 'rossella+francesco',
    'trust_bumped_at', '2026-04-23',
    'previous_trust_score', 85
  )
WHERE workspace_id = '15cc947e-70cb-455a-b0df-d8c34b760d71'
  AND host = 'mark-up.it';

COMMIT;
