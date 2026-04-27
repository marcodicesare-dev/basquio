-- =====================================================
-- ANTICIPATION HINTS RPCs (Memory v1 Brief 5, PART C)
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §9
--
-- Brief 1 created the anticipation_hints table. Brief 5 PART C wires
-- the live mutation surface: insert hints from generators, dismiss /
-- snooze / accept from the workspace-home UI, plus a pg_cron schedule
-- (guarded by IF EXISTS pg_extension) that nightly expires hints whose
-- expires_at is past.
--
-- Pattern matches Brief 3 persist_brand_guideline + Brief 4
-- memory_candidates RPCs: SECURITY DEFINER, SET search_path = '',
-- sets app.actor inside the body so the audit trigger (when attached
-- in a future migration) attributes the caller. anticipation_hints
-- is not currently audited via the trigger; the audit log is
-- preserved via the workflow_run_id link on each hint row.
-- =====================================================

BEGIN;

-- ─── 1. insert_anticipation_hint ────────────────────────────────────
-- Called by the generators (Monday-morning + on-event). Honours the
-- 14-day cooldown_key suppression: if a dismissed hint with the same
-- (workspace_id, cooldown_key) exists within the cooldown window,
-- return NULL without inserting.
CREATE OR REPLACE FUNCTION public.insert_anticipation_hint(
  p_workspace_id UUID,
  p_scope_id UUID,
  p_user_id UUID,
  p_kind TEXT,
  p_title TEXT,
  p_reason TEXT,
  p_source_refs JSONB,
  p_target_action JSONB,
  p_confidence NUMERIC,
  p_urgency INT,
  p_cooldown_key TEXT,
  p_expires_at TIMESTAMPTZ,
  p_workflow_run_id UUID,
  p_status TEXT,
  p_actor TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _id UUID;
  _suppressed BOOLEAN;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'insert_anticipation_hint: actor is required';
  END IF;
  IF p_kind NOT IN ('reactive', 'proactive', 'optimisation') THEN
    RAISE EXCEPTION 'insert_anticipation_hint: invalid kind %', p_kind;
  END IF;
  IF p_status NOT IN ('candidate', 'suppressed') THEN
    RAISE EXCEPTION 'insert_anticipation_hint: status must be candidate or suppressed at insert time';
  END IF;
  IF p_source_refs IS NULL OR jsonb_typeof(p_source_refs) NOT IN ('array', 'object') THEN
    RAISE EXCEPTION 'insert_anticipation_hint: source_refs must be a non-null JSON array or object';
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);
  IF p_workflow_run_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('app.workflow_run_id', p_workflow_run_id::text, true);
  END IF;

  -- 14-day cooldown: if a dismissed hint with the same cooldown_key
  -- exists in the last 14 days, suppress this one.
  SELECT EXISTS (
    SELECT 1 FROM public.anticipation_hints
    WHERE workspace_id = p_workspace_id
      AND cooldown_key = p_cooldown_key
      AND status = 'dismissed'
      AND created_at > NOW() - INTERVAL '14 days'
  ) INTO _suppressed;

  INSERT INTO public.anticipation_hints (
    workspace_id, scope_id, user_id,
    kind, status,
    title, reason,
    source_refs, target_action,
    confidence, urgency, cooldown_key,
    expires_at, workflow_run_id
  ) VALUES (
    p_workspace_id, p_scope_id, p_user_id,
    p_kind::public.hint_kind,
    CASE WHEN _suppressed THEN 'suppressed'::public.hint_status ELSE p_status::public.hint_status END,
    p_title, p_reason,
    p_source_refs, COALESCE(p_target_action, '{}'::jsonb),
    p_confidence, COALESCE(p_urgency, 2), p_cooldown_key,
    p_expires_at, p_workflow_run_id
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_anticipation_hint(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC, INT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_anticipation_hint(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC, INT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT
) TO service_role;

-- ─── 2. dismiss_anticipation_hint ───────────────────────────────────
-- The user dismissed the hint from the workspace home. Suppresses any
-- future hint with the same cooldown_key for 14 days (per spec §9 #3).
CREATE OR REPLACE FUNCTION public.dismiss_anticipation_hint(
  p_hint_id UUID,
  p_user_id UUID,
  p_actor TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'dismiss_anticipation_hint: actor is required';
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  UPDATE public.anticipation_hints
  SET status = 'dismissed',
      acted_at = NOW(),
      acted_by = p_user_id
  WHERE id = p_hint_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dismiss_anticipation_hint: hint % not found', p_hint_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_anticipation_hint(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dismiss_anticipation_hint(UUID, UUID, TEXT) TO service_role;

-- ─── 3. snooze_anticipation_hint ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.snooze_anticipation_hint(
  p_hint_id UUID,
  p_user_id UUID,
  p_snooze_days INT,
  p_actor TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'snooze_anticipation_hint: actor is required';
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  UPDATE public.anticipation_hints
  SET status = 'snoozed',
      acted_at = NOW(),
      acted_by = p_user_id,
      expires_at = NOW() + (COALESCE(p_snooze_days, 7) || ' days')::interval
  WHERE id = p_hint_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'snooze_anticipation_hint: hint % not found', p_hint_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.snooze_anticipation_hint(UUID, UUID, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snooze_anticipation_hint(UUID, UUID, INT, TEXT) TO service_role;

-- ─── 4. accept_anticipation_hint ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_anticipation_hint(
  p_hint_id UUID,
  p_user_id UUID,
  p_actor TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'accept_anticipation_hint: actor is required';
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  UPDATE public.anticipation_hints
  SET status = 'accepted',
      acted_at = NOW(),
      acted_by = p_user_id
  WHERE id = p_hint_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'accept_anticipation_hint: hint % not found', p_hint_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_anticipation_hint(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_anticipation_hint(UUID, UUID, TEXT) TO service_role;

-- ─── 5. expire_stale_hints ──────────────────────────────────────────
-- Nightly job: any candidate / shown hint past expires_at moves to
-- 'expired'. The pg_cron schedule below calls this if pg_cron is
-- enabled; the RPC works manually either way.
CREATE OR REPLACE FUNCTION public.expire_stale_hints(p_actor TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _count INT;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'expire_stale_hints: actor is required';
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  WITH expired AS (
    UPDATE public.anticipation_hints
    SET status = 'expired'
    WHERE status IN ('candidate', 'shown')
      AND expires_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO _count FROM expired;

  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_hints(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_hints(TEXT) TO service_role;

-- ─── 6. pg_cron schedule for nightly hint expiry ────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'anticipation-hints-expire') THEN
      PERFORM cron.unschedule('anticipation-hints-expire');
    END IF;
    PERFORM cron.schedule(
      'anticipation-hints-expire',
      '15 4 * * *',
      $cmd$SELECT public.expire_stale_hints('system:workflow:expire-hints')$cmd$
    );
    RAISE NOTICE 'pg_cron anticipation-hints-expire schedule registered (daily at 04:15 UTC)';
  ELSE
    RAISE NOTICE 'pg_cron extension not enabled; anticipation-hints-expire schedule skipped. Enable via Dashboard -> Database -> Extensions and run cron.schedule manually.';
  END IF;
END $$;

COMMIT;

-- =====================================================
-- DOWN (manual reversal)
-- =====================================================
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--     PERFORM cron.unschedule('anticipation-hints-expire');
--   END IF;
-- END $$;
-- DROP FUNCTION IF EXISTS public.expire_stale_hints(TEXT);
-- DROP FUNCTION IF EXISTS public.accept_anticipation_hint(UUID, UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.snooze_anticipation_hint(UUID, UUID, INT, TEXT);
-- DROP FUNCTION IF EXISTS public.dismiss_anticipation_hint(UUID, UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.insert_anticipation_hint(
--   UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC, INT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT
-- );
