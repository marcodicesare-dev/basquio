-- Seed the source catalog with 31 Italian and UK FMCG/CPG sources scoped to
-- the team-beta workspace singleton (BASQUIO_TEAM_WORKSPACE_ID).
--
-- Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §3.5.
-- Three seed groups:
--
--   1. 18 verified-active (Agent-scrapable on 2026-04-22), status='active'.
--   2.  7 pending-verification (Rossella-named 2026-04-23), status='paused'
--      with metadata.paused_reason='pending_verification_2026-04-23'. The
--      Day 2 fetcher work flips each to 'active' only after a successful
--      /v2/map + /v2/batch-scrape smoke run.
--   3.  6 permanently paused (proxy, chunking, or ownership blockers),
--      status='paused' with metadata.paused_reason describing the real
--      obstacle.
--
-- Trust scores: Tier 1-2 → 85, Tier 3 → 90 (official stats), Tier 4 → 75,
-- Tier 5 → 65. Overrides explicitly noted in the metadata where they
-- depart from the tier default.
--
-- ON CONFLICT DO NOTHING on the composite unique (workspace_id, url) keeps
-- the seed idempotent across re-applies.

BEGIN;

-- ── 1. 18 verified-active sources ──

INSERT INTO public.source_catalog (
  workspace_id, url, host, tier, language, source_type,
  domain_tags, crawl_patterns, trust_score, status, last_verified_at, metadata
) VALUES
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://mark-up.it', 'mark-up.it', 1, 'it', 'trade_press',
    ARRAY['gdo','retail','private_label'],
    '{"crawl_allow":["/articoli/.*","/news/.*"],"crawl_deny":["/login/.*","/account/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://foodweb.it', 'foodweb.it', 1, 'it', 'trade_press',
    ARRAY['food','innovation','horeca'],
    '{"crawl_allow":["/news/.*","/notizie/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://foodaffairs.it', 'foodaffairs.it', 1, 'it', 'trade_press',
    ARRAY['food','innovation'],
    '{"crawl_allow":["/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://retailfood.it', 'retailfood.it', 1, 'it', 'trade_press',
    ARRAY['retail','gdo'],
    '{"crawl_allow":["/news/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://agrifoodtoday.it', 'agrifoodtoday.it', 1, 'it', 'trade_press',
    ARRAY['agri','food','regulatory'],
    '{"crawl_allow":["/news/.*","/attualita/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://freshplaza.it', 'freshplaza.it', 1, 'it', 'trade_press',
    ARRAY['fresh','ingredients'],
    '{"crawl_allow":["/news/.*","/article/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://federalimentare.it', 'federalimentare.it', 2, 'it', 'association',
    ARRAY['association','food','regulatory'],
    '{"crawl_allow":["/comunicati/.*","/news/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://federdistribuzione.it', 'federdistribuzione.it', 2, 'it', 'association',
    ARRAY['association','gdo','retail'],
    '{"crawl_allow":["/news/.*","/pubblicazioni/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://centromarca.it', 'centromarca.it', 2, 'it', 'association',
    ARRAY['association','brand','ibf'],
    '{"crawl_allow":["/news/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://bevitalia.it', 'bevitalia.it', 2, 'it', 'association',
    ARRAY['beverage','association'],
    '{"crawl_allow":["/news/.*","/comunicati/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://ismea.it', 'ismea.it', 3, 'it', 'stats',
    ARRAY['stats','official','agri'],
    '{"crawl_allow":["/flex/cm/pages/ServeBLOB.php/.*","/news/.*","/.*\\.pdf"],"max_pages_per_crawl":200}'::jsonb,
    90, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://istat.it', 'istat.it', 3, 'it', 'stats',
    ARRAY['stats','official'],
    '{"crawl_allow":["/it/archivio/.*","/comunicato-stampa/.*"],"max_pages_per_crawl":200}'::jsonb,
    90, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://mise.gov.it', 'mise.gov.it', 3, 'it', 'stats',
    ARRAY['stats','official','regulatory'],
    '{"crawl_allow":["/it/stampa/.*","/it/notizie-stampa/.*"],"max_pages_per_crawl":200}'::jsonb,
    90, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://nielsen.com', 'nielsen.com', 4, 'en', 'market_research',
    ARRAY['market_research','cross_reference'],
    '{"crawl_allow":["/insights/.*","/news-center/.*"],"max_pages_per_crawl":200}'::jsonb,
    75, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://euromonitor.com', 'euromonitor.com', 4, 'en', 'market_research',
    ARRAY['market_research','cross_reference'],
    '{"crawl_allow":["/article/.*","/press-releases/.*"],"max_pages_per_crawl":200}'::jsonb,
    75, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://just-food.com', 'just-food.com', 5, 'en', 'cross_reference',
    ARRAY['cross_reference'],
    '{"crawl_allow":["/news/.*","/analysis/.*"],"max_pages_per_crawl":200}'::jsonb,
    65, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://fooddive.com', 'fooddive.com', 5, 'en', 'cross_reference',
    ARRAY['cross_reference'],
    '{"crawl_allow":["/news/.*"],"max_pages_per_crawl":200}'::jsonb,
    65, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://foodnavigator.com', 'foodnavigator.com', 5, 'en', 'cross_reference',
    ARRAY['cross_reference'],
    '{"crawl_allow":["/Article/.*"],"max_pages_per_crawl":200}'::jsonb,
    65, 'active', '2026-04-22T00:00:00Z', '{"seeded_by":"20260423180000"}'::jsonb)
ON CONFLICT (workspace_id, url) DO NOTHING;

-- ── 2. 7 pending-verification sources (Rossella-named, 2026-04-23) ──
-- Seeded paused; flipped to active by the Day 2 fetcher smoke run.

INSERT INTO public.source_catalog (
  workspace_id, url, host, tier, language, source_type,
  domain_tags, crawl_patterns, trust_score, status, metadata
) VALUES
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://cibuslink.it', 'cibuslink.it', 1, 'it', 'trade_press',
    ARRAY['food','horeca'],
    '{"crawl_allow":["/news/.*","/articoli/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"pending_verification_2026-04-23","source":"rossella_feedback"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://ilsole24ore.com', 'ilsole24ore.com', 2, 'it', 'news',
    ARRAY['business','news'],
    '{"crawl_allow":["/art/.*","/notizie/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"pending_verification_2026-04-23","source":"rossella_feedback"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://distribuzionemoderna.info', 'distribuzionemoderna.info', 1, 'it', 'trade_press',
    ARRAY['gdo','retail'],
    '{"crawl_allow":["/news/.*","/articoli/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"pending_verification_2026-04-23","source":"rossella_feedback"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://gdonews.it', 'gdonews.it', 1, 'it', 'trade_press',
    ARRAY['gdo','retail'],
    '{"crawl_allow":["/news/.*","/notizie/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"pending_verification_2026-04-23","source":"rossella_feedback"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://largoconsumo.info', 'largoconsumo.info', 1, 'it', 'trade_press',
    ARRAY['consumer','fmcg'],
    '{"crawl_allow":["/news/.*","/articoli/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"pending_verification_2026-04-23","source":"rossella_feedback"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://thegrocer.co.uk', 'thegrocer.co.uk', 5, 'en', 'cross_reference',
    ARRAY['cross_reference','uk'],
    '{"crawl_allow":["/news/.*","/article/.*"],"max_pages_per_crawl":200}'::jsonb,
    65, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"pending_verification_2026-04-23","source":"rossella_feedback"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://retail-week.com', 'retail-week.com', 5, 'en', 'cross_reference',
    ARRAY['cross_reference','uk','retail'],
    '{"crawl_allow":["/news/.*","/article/.*"],"max_pages_per_crawl":200}'::jsonb,
    65, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"pending_verification_2026-04-23","source":"rossella_feedback"}'::jsonb)
ON CONFLICT (workspace_id, url) DO NOTHING;

-- ── 3. 6 permanently paused (need proxy, chunking, or ownership fix) ──

INSERT INTO public.source_catalog (
  workspace_id, url, host, tier, language, source_type,
  domain_tags, crawl_patterns, trust_score, status, metadata
) VALUES
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://gdoweek.it', 'gdoweek.it', 1, 'it', 'trade_press',
    ARRAY['gdo','retail'],
    '{"crawl_allow":["/news/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"token_overflow_gt_50k_chars_per_page","fix":"chunked_fetch_via_onlyMainContent_and_maxAge_tuning"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://ansa.it', 'ansa.it', 5, 'it', 'news',
    ARRAY['news'],
    '{"crawl_allow":["/news/.*"],"max_pages_per_crawl":100}'::jsonb,
    65, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"token_overflow_gt_126k_chars_per_page","fix":"chunked_fetch_plus_chunk_level_extraction"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://confcommercio.it', 'confcommercio.it', 2, 'it', 'association',
    ARRAY['association','retail'],
    '{"crawl_allow":["/news/.*"],"max_pages_per_crawl":200,"requires_enhanced_proxy":true}'::jsonb,
    85, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"http_403_to_default_user_agent","fix":"enhanced_proxy_tier_plus_4_to_5_credits_per_page"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://linea-verde.it', 'linea-verde.it', 1, 'it', 'trade_press',
    ARRAY['food'],
    '{"crawl_allow":["/news/.*"],"max_pages_per_crawl":200}'::jsonb,
    85, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"site_maintenance_redirect","fix":"reverify_monthly_unpause_when_live"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://bva-doxa.it', 'bva-doxa.it', 4, 'it', 'market_research',
    ARRAY['market_research'],
    '{"crawl_allow":["/.*"],"max_pages_per_crawl":100}'::jsonb,
    75, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"domain_expired","fix":"remove_or_replace_with_successor"}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'https://confindustria.it', 'confindustria.it', 2, 'it', 'association',
    ARRAY['association','industry'],
    '{"crawl_allow":["/news/.*"],"max_pages_per_crawl":200,"requires_enhanced_proxy":true}'::jsonb,
    85, 'paused',
    '{"seeded_by":"20260423180000","paused_reason":"request_timeout","fix":"enhanced_proxy_plus_longer_waitFor"}'::jsonb)
ON CONFLICT (workspace_id, url) DO NOTHING;

COMMIT;
