-- Follow-up to 20260423200000: add `/topic/.*` and `/topics/.*` to
-- every seed row's crawl_deny array. Day 4 R7 smoke on Brief B
-- surfaced a Nielsen archive page at
-- `/insights/topic/marketing-performance` that slipped through the
-- previous deny list. The runtime GLOBAL_CRAWL_DENY_PATTERNS in
-- packages/research/src/fetcher.ts also catches it regardless, but
-- keeping the DB column in sync with runtime keeps telemetry honest
-- and makes future audits possible via pure SQL.
--
-- Idempotent: uses DISTINCT array reconstruction so re-applying the
-- migration does not grow the array.

BEGIN;

WITH updated AS (
  SELECT id,
         (
           SELECT jsonb_agg(DISTINCT x)
           FROM jsonb_array_elements(
             COALESCE(crawl_patterns->'crawl_deny', '[]'::jsonb) ||
             '["/topic/.*", "/topics/.*"]'::jsonb
           ) x
         ) AS new_deny
  FROM public.source_catalog
  WHERE workspace_id = '15cc947e-70cb-455a-b0df-d8c34b760d71'
)
UPDATE public.source_catalog sc
SET crawl_patterns = sc.crawl_patterns || jsonb_build_object('crawl_deny', updated.new_deny)
FROM updated
WHERE sc.id = updated.id;

COMMIT;
