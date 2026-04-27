-- =====================================================
-- pg_cron SCHEDULES (post-enable, idempotent)
-- Memory v1: Brief 4 + Brief 5 PART C operational followup.
--
-- The 20260505110000 (memory_candidates) and 20260512110000
-- (anticipation_hints) migrations both wrote pg_cron schedule blocks
-- guarded by `IF EXISTS pg_extension WHERE extname='pg_cron'`. At
-- migration apply time pg_cron was not enabled on the basquio
-- Supabase project, so both NOTICE'd as skipped.
--
-- Marco enabled pg_cron via Dashboard -> Database -> Extensions on
-- 2026-04-27. This migration idempotently re-runs the schedule
-- blocks. Safe to re-apply: each block unschedules an existing job
-- of the same name first.
-- =====================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Brief 4: nightly candidate expire at 04:00 UTC.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'memory-candidates-expire') THEN
      PERFORM cron.unschedule('memory-candidates-expire');
    END IF;
    PERFORM cron.schedule(
      'memory-candidates-expire',
      '0 4 * * *',
      $cmd$SELECT public.expire_pending_candidates(NULL::int, 'system:workflow:expire-candidates')$cmd$
    );
    RAISE NOTICE 'pg_cron memory-candidates-expire schedule registered';

    -- Brief 5 PART C: nightly hint expire at 04:15 UTC.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'anticipation-hints-expire') THEN
      PERFORM cron.unschedule('anticipation-hints-expire');
    END IF;
    PERFORM cron.schedule(
      'anticipation-hints-expire',
      '15 4 * * *',
      $cmd$SELECT public.expire_stale_hints('system:workflow:expire-hints')$cmd$
    );
    RAISE NOTICE 'pg_cron anticipation-hints-expire schedule registered';
  ELSE
    RAISE EXCEPTION 'pg_cron not enabled. Enable via Dashboard -> Database -> Extensions then re-apply this migration.';
  END IF;
END $$;

COMMIT;
