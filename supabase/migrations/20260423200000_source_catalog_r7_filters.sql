-- R7 content-quality fix: every catalog row gets defensive crawl_deny
-- patterns (sitemaps, feeds, tag/category indexes, author pages,
-- archive pages) and Tier 4/5 cross_reference sources get richer
-- domain_tags so the fetcher's topic-overlap gate correctly filters
-- sources on non-FMCG briefs.
--
-- Day 4 smoke exposed two content-quality gaps:
--   1. freshplaza.it/sitemap/news/2025 etc. were scraped as "articles"
--      because the path contains "/news/" which matches crawl_allow.
--      Sitemap index pages aren't articles; they're URL lists.
--   2. Hotel-AI brief scraped 15 food-CPG articles because Tier 4/5
--      sources had only ['cross_reference'] or ['market_research',
--      'cross_reference'] as domain_tags, giving the overlap gate
--      nothing to match against.
--
-- Both fixes are additive. Existing code reading crawl_allow /
-- domain_tags continues to work; new code in fetcher.ts consumes
-- the enriched fields.
--
-- Idempotent: crawl_deny is set only when absent; domain_tags are
-- merged via array union so re-applying the migration is safe.

BEGIN;

-- ── 1. Defensive crawl_deny patterns for every seed row ──
--
-- Only sets crawl_deny when absent. If a future migration already
-- customized it per-source, the custom list wins. This migration is
-- a floor, not a ceiling.

UPDATE public.source_catalog
SET crawl_patterns = crawl_patterns || jsonb_build_object(
  'crawl_deny',
  '["/sitemap/.*", "/sitemap\\.xml$", "/feed/.*", "/rss/.*", "/tag/.*", "/category/.*", "/categoria/.*", "/tags/.*", "/categorie/.*", "/author/.*", "/autore/.*", "/archive/.*", "/archivio/.*", "/page/.*", "/pagina/.*"]'::jsonb
)
WHERE workspace_id = '15cc947e-70cb-455a-b0df-d8c34b760d71'
  AND NOT (crawl_patterns ? 'crawl_deny');

-- ── 2. Enrich Tier 4/5 domain_tags so topic-overlap gate filters
--     non-FMCG briefs away from food-focused cross_reference sources ──
--
-- Array concatenation with anti-duplication via a SELECT array_agg.
-- Idempotent: running twice does not grow the array.

WITH enriched AS (
  SELECT id,
         (SELECT array_agg(DISTINCT x) FROM unnest(
           domain_tags || ARRAY['food', 'consumer', 'retail', 'fmcg', 'cpg']
         ) x) AS new_tags
  FROM public.source_catalog
  WHERE workspace_id = '15cc947e-70cb-455a-b0df-d8c34b760d71'
    AND host IN (
      'just-food.com',
      'nielsen.com',
      'euromonitor.com',
      'thegrocer.co.uk',
      'retail-week.com',
      'fooddive.com',
      'foodnavigator.com'
    )
)
UPDATE public.source_catalog sc
SET domain_tags = enriched.new_tags
FROM enriched
WHERE sc.id = enriched.id;

-- ── 3. Enrich Italian tier-1/2 sources with broader fmcg/cpg tags so
--     the overlap gate sees the implicit food-industry frame even on
--     briefs that don't explicitly say "food" or "gdo" ──

WITH italian_enriched AS (
  SELECT id,
         (SELECT array_agg(DISTINCT x) FROM unnest(
           domain_tags || ARRAY['fmcg', 'cpg', 'italia']
         ) x) AS new_tags
  FROM public.source_catalog
  WHERE workspace_id = '15cc947e-70cb-455a-b0df-d8c34b760d71'
    AND language = 'it'
    AND tier IN (1, 2)
)
UPDATE public.source_catalog sc
SET domain_tags = italian_enriched.new_tags
FROM italian_enriched
WHERE sc.id = italian_enriched.id;

COMMIT;
