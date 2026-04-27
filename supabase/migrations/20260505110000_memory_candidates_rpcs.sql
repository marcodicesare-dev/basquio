-- =====================================================
-- MEMORY CANDIDATES SECURITY DEFINER RPCs (Memory v1 Brief 4)
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §7
-- Brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 4)
--
-- Five RPCs that follow the persist_brand_guideline pattern from Brief 3
-- (canonical SECURITY DEFINER reference). Each function:
--   - SET search_path = '' (defence in depth)
--   - sets app.actor inside the function body via pg_catalog.set_config
--     so the audit_memory_change trigger from Brief 1 reads the right
--     actor in the SAME transaction that performs the mutation
--   - performs the mutation
--   - returns the requested shape
--
-- Why not withActor: PostgREST connection pooling cannot carry session-
-- local config across separate .rpc() calls. Brief 1 pivot, see
-- docs/research/2026-04-27-brief-1-foundation-shipped.md.
-- =====================================================

BEGIN;

-- ─── 1. insert_memory_candidate ─────────────────────────────────────
-- Used for mid-confidence (0.6 <= confidence <= 0.8) extractions and
-- for ALL extractions in dry mode (CHAT_EXTRACTOR_ENABLED=false).
CREATE OR REPLACE FUNCTION public.insert_memory_candidate(
  p_workspace_id UUID,
  p_scope_id UUID,
  p_kind TEXT,
  p_content JSONB,
  p_evidence_excerpt TEXT,
  p_source_conversation_id UUID,
  p_source_message_id UUID,
  p_confidence NUMERIC,
  p_workflow_run_id UUID,
  p_actor TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _id UUID;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'insert_memory_candidate: actor is required';
  END IF;
  IF p_kind NOT IN ('fact', 'rule', 'preference', 'alias', 'entity') THEN
    RAISE EXCEPTION 'insert_memory_candidate: kind must be one of fact|rule|preference|alias|entity, got %', p_kind;
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);
  IF p_workflow_run_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('app.workflow_run_id', p_workflow_run_id::text, true);
  END IF;

  INSERT INTO public.memory_candidates (
    workspace_id, scope_id, kind, content, evidence_excerpt,
    source_conversation_id, source_message_id, confidence,
    workflow_run_id
  ) VALUES (
    p_workspace_id, p_scope_id, p_kind, p_content, p_evidence_excerpt,
    p_source_conversation_id, p_source_message_id, p_confidence,
    p_workflow_run_id
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_memory_candidate(
  UUID, UUID, TEXT, JSONB, TEXT, UUID, UUID, NUMERIC, UUID, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_memory_candidate(
  UUID, UUID, TEXT, JSONB, TEXT, UUID, UUID, NUMERIC, UUID, TEXT
) TO service_role;

-- ─── 2. approve_memory_candidate ────────────────────────────────────
-- Called from the candidate-queue UI (apps/web/src/lib/workspace/candidates.ts).
-- Marks the candidate as approved, persists the approval audit, and
-- writes the durable memory row in one transaction. The durable INSERT
-- triggers audit_memory_change automatically.
CREATE OR REPLACE FUNCTION public.approve_memory_candidate(
  p_candidate_id UUID,
  p_user_id UUID,
  p_edits JSONB,
  p_actor TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _candidate public.memory_candidates%ROWTYPE;
  _content JSONB;
  _result JSONB;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'approve_memory_candidate: actor is required';
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  SELECT * INTO _candidate
  FROM public.memory_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_memory_candidate: candidate % not found', p_candidate_id;
  END IF;

  IF _candidate.status <> 'pending' THEN
    RAISE EXCEPTION 'approve_memory_candidate: candidate % is %, only pending candidates can be approved', p_candidate_id, _candidate.status;
  END IF;

  _content := COALESCE(_candidate.content, '{}'::jsonb) || COALESCE(p_edits, '{}'::jsonb);

  IF _candidate.workflow_run_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('app.workflow_run_id', _candidate.workflow_run_id::text, true);
  END IF;

  _result := public.write_durable_memory_from_candidate(
    _candidate.workspace_id,
    _candidate.scope_id,
    _candidate.kind,
    _content,
    _candidate.evidence_excerpt,
    _candidate.source_conversation_id,
    _candidate.confidence,
    _candidate.workflow_run_id
  );

  UPDATE public.memory_candidates
  SET status = 'approved',
      approved_by = p_user_id,
      approved_at = NOW(),
      content = _content,
      updated_at = NOW()
  WHERE id = p_candidate_id;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_memory_candidate(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_memory_candidate(UUID, UUID, JSONB, TEXT) TO service_role;

-- ─── 3. dismiss_memory_candidate ────────────────────────────────────
-- The user-side rejection path. memory_candidates is not audited (only
-- the five durable tables are), so no app.actor write side-effect.
-- Approved_by is overloaded as the dismisser's id for forensic trace.
CREATE OR REPLACE FUNCTION public.dismiss_memory_candidate(
  p_candidate_id UUID,
  p_user_id UUID,
  p_reason TEXT,
  p_actor TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _status TEXT;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'dismiss_memory_candidate: actor is required';
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  SELECT status INTO _status
  FROM public.memory_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dismiss_memory_candidate: candidate % not found', p_candidate_id;
  END IF;

  IF _status <> 'pending' THEN
    RAISE EXCEPTION 'dismiss_memory_candidate: candidate % is %, only pending candidates can be dismissed', p_candidate_id, _status;
  END IF;

  UPDATE public.memory_candidates
  SET status = 'dismissed',
      dismissed_reason = p_reason,
      dismissed_at = NOW(),
      approved_by = p_user_id,
      updated_at = NOW()
  WHERE id = p_candidate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_memory_candidate(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dismiss_memory_candidate(UUID, UUID, TEXT, TEXT) TO service_role;

-- ─── 4. expire_pending_candidates ───────────────────────────────────
-- Nightly cron job (pg_cron schedule below). Marks pending candidates
-- whose row-level expires_at is past. The older_than_days override
-- lets ops force-expire candidates pending longer than N days,
-- regardless of their stored expires_at.
CREATE OR REPLACE FUNCTION public.expire_pending_candidates(
  p_older_than_days INT,
  p_actor TEXT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _count INT;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'expire_pending_candidates: actor is required';
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  WITH expired AS (
    UPDATE public.memory_candidates
    SET status = 'expired',
        updated_at = NOW()
    WHERE status = 'pending'
      AND (
        expires_at < NOW()
        OR (p_older_than_days IS NOT NULL AND created_at < NOW() - (p_older_than_days || ' days')::interval)
      )
    RETURNING id
  )
  SELECT COUNT(*) INTO _count FROM expired;

  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_pending_candidates(INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_pending_candidates(INT, TEXT) TO service_role;

-- ─── 5. write_durable_memory_from_candidate (internal helper) ───────
-- Shared by approve_memory_candidate and auto_promote_high_confidence.
-- Dispatches on kind into facts / workspace_rule / memory_entries /
-- entities. The five durable tables that are audited (workspace_rule,
-- brand_guideline, anticipation_hints, facts, memory_entries) all fire
-- audit_memory_change on the INSERT in the same transaction; the
-- caller has already set app.actor so the audit row is attributable.
--
-- For Brief 4 v1, kinds 'alias' and 'entity' persist into memory_entries
-- with metadata.deferred_kind set to the original kind. Brief 5's
-- Memory Inspector will refactor those into entities/entity_mentions
-- writes once the entity-resolution surface exists. The audit row is
-- still produced; the typed read path that consumes them in Brief 5
-- can join through metadata.deferred_kind until the refactor lands.
CREATE OR REPLACE FUNCTION public.write_durable_memory_from_candidate(
  p_workspace_id UUID,
  p_scope_id UUID,
  p_kind TEXT,
  p_content JSONB,
  p_evidence_excerpt TEXT,
  p_source_conversation_id UUID,
  p_confidence NUMERIC,
  p_workflow_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _id UUID;
  _organization_id UUID;
BEGIN
  -- workspace_id IS the team org id today (Brief 1 + 2 + 3 substrate);
  -- read it directly to populate the legacy organization_id columns on
  -- entities/facts/memory_entries.
  _organization_id := p_workspace_id;

  IF p_kind = 'fact' THEN
    INSERT INTO public.facts (
      organization_id, is_team_beta,
      subject_entity, predicate, object_value, object_entity,
      valid_from, valid_to,
      source_id, source_type,
      confidence,
      metadata
    ) VALUES (
      _organization_id, TRUE,
      (p_content ->> 'subject_entity_id')::uuid,
      p_content ->> 'predicate',
      COALESCE(p_content -> 'object_value', '{}'::jsonb),
      NULLIF(p_content ->> 'object_entity_id', '')::uuid,
      NULLIF(p_content ->> 'valid_from', '')::timestamptz,
      NULLIF(p_content ->> 'valid_to', '')::timestamptz,
      p_source_conversation_id,
      'manual',
      p_confidence::real,
      jsonb_build_object(
        'evidence_excerpt', p_evidence_excerpt,
        'workflow_run_id', p_workflow_run_id,
        'origin', 'chat-extraction'
      )
    )
    RETURNING id INTO _id;
    RETURN jsonb_build_object('kind', 'fact', 'durable_id', _id);
  END IF;

  IF p_kind = 'rule' THEN
    INSERT INTO public.workspace_rule (
      workspace_id, scope_id,
      rule_type, rule_text,
      applies_to, forbidden,
      origin, origin_evidence,
      priority, active,
      confidence,
      metadata
    ) VALUES (
      p_workspace_id, p_scope_id,
      COALESCE(p_content ->> 'rule_type', 'style'),
      p_content ->> 'rule_text',
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(p_content -> 'applies_to')),
        '{}'::text[]
      ),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(p_content -> 'forbidden')),
        '{}'::text[]
      ),
      'inferred',
      jsonb_build_array(jsonb_build_object(
        'kind', 'chat_turn',
        'conversation_id', p_source_conversation_id,
        'excerpt', p_evidence_excerpt
      )),
      COALESCE((p_content ->> 'priority')::int, 50),
      TRUE,
      p_confidence::real,
      jsonb_build_object(
        'workflow_run_id', p_workflow_run_id,
        'origin', 'chat-extraction'
      )
    )
    RETURNING id INTO _id;
    RETURN jsonb_build_object('kind', 'rule', 'durable_id', _id);
  END IF;

  IF p_kind = 'preference' THEN
    INSERT INTO public.memory_entries (
      organization_id, is_team_beta,
      scope, memory_type, path,
      content, metadata
    ) VALUES (
      _organization_id, TRUE,
      'workspace',
      'procedural',
      'chat-extracted/preference/' || gen_random_uuid()::text,
      COALESCE(p_content ->> 'text', p_content::text),
      jsonb_build_object(
        'evidence_excerpt', p_evidence_excerpt,
        'conversation_id', p_source_conversation_id,
        'confidence', p_confidence,
        'workflow_run_id', p_workflow_run_id,
        'origin', 'chat-extraction'
      )
    )
    RETURNING id INTO _id;
    RETURN jsonb_build_object('kind', 'preference', 'durable_id', _id);
  END IF;

  -- alias and entity: Brief 4 v1 stages them in memory_entries with
  -- the original kind tagged in metadata. Brief 5 refactors these
  -- into entities/entity_mentions writes once the entity-resolution
  -- surface lives in the Memory Inspector.
  IF p_kind IN ('alias', 'entity') THEN
    INSERT INTO public.memory_entries (
      organization_id, is_team_beta,
      scope, memory_type, path,
      content, metadata
    ) VALUES (
      _organization_id, TRUE,
      'workspace',
      'semantic',
      'chat-extracted/' || p_kind || '/' || gen_random_uuid()::text,
      COALESCE(p_content::text, ''),
      jsonb_build_object(
        'deferred_kind', p_kind,
        'evidence_excerpt', p_evidence_excerpt,
        'conversation_id', p_source_conversation_id,
        'confidence', p_confidence,
        'workflow_run_id', p_workflow_run_id,
        'origin', 'chat-extraction'
      )
    )
    RETURNING id INTO _id;
    RETURN jsonb_build_object('kind', p_kind, 'durable_id', _id, 'deferred', TRUE);
  END IF;

  RAISE EXCEPTION 'write_durable_memory_from_candidate: unsupported kind %', p_kind;
END;
$$;

REVOKE ALL ON FUNCTION public.write_durable_memory_from_candidate(
  UUID, UUID, TEXT, JSONB, TEXT, UUID, NUMERIC, UUID
) FROM PUBLIC;
-- Helper is service_role only; the public RPCs (approve, auto_promote)
-- call it internally.
GRANT EXECUTE ON FUNCTION public.write_durable_memory_from_candidate(
  UUID, UUID, TEXT, JSONB, TEXT, UUID, NUMERIC, UUID
) TO service_role;

-- ─── 6. auto_promote_high_confidence ────────────────────────────────
-- Called by chat-extraction.ts when extractor returns confidence > 0.8
-- AND CHAT_EXTRACTOR_ENABLED=true. Inserts the candidate row first
-- (so the audit + memory_candidates trail is consistent) then writes
-- the durable memory and marks the candidate as approved. Single
-- transaction.
CREATE OR REPLACE FUNCTION public.auto_promote_high_confidence(
  p_workspace_id UUID,
  p_scope_id UUID,
  p_kind TEXT,
  p_content JSONB,
  p_evidence_excerpt TEXT,
  p_source_conversation_id UUID,
  p_source_message_id UUID,
  p_confidence NUMERIC,
  p_workflow_run_id UUID,
  p_actor TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _candidate_id UUID;
  _result JSONB;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'auto_promote_high_confidence: actor is required';
  END IF;
  IF p_kind NOT IN ('fact', 'rule', 'preference', 'alias', 'entity') THEN
    RAISE EXCEPTION 'auto_promote_high_confidence: kind must be one of fact|rule|preference|alias|entity, got %', p_kind;
  END IF;
  IF p_confidence IS NULL OR p_confidence < 0.8 THEN
    RAISE EXCEPTION 'auto_promote_high_confidence: confidence must be >= 0.8 (got %)', p_confidence;
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);
  IF p_workflow_run_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('app.workflow_run_id', p_workflow_run_id::text, true);
  END IF;

  INSERT INTO public.memory_candidates (
    workspace_id, scope_id, kind, content, evidence_excerpt,
    source_conversation_id, source_message_id, confidence,
    workflow_run_id,
    status, approved_at
  ) VALUES (
    p_workspace_id, p_scope_id, p_kind, p_content, p_evidence_excerpt,
    p_source_conversation_id, p_source_message_id, p_confidence,
    p_workflow_run_id,
    'approved', NOW()
  )
  RETURNING id INTO _candidate_id;

  _result := public.write_durable_memory_from_candidate(
    p_workspace_id, p_scope_id, p_kind, p_content, p_evidence_excerpt,
    p_source_conversation_id, p_confidence, p_workflow_run_id
  );

  RETURN _result || jsonb_build_object('candidate_id', _candidate_id, 'auto_promoted', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.auto_promote_high_confidence(
  UUID, UUID, TEXT, JSONB, TEXT, UUID, UUID, NUMERIC, UUID, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_promote_high_confidence(
  UUID, UUID, TEXT, JSONB, TEXT, UUID, UUID, NUMERIC, UUID, TEXT
) TO service_role;

-- ─── 7. pg_cron schedule for nightly expire ─────────────────────────
-- pg_cron is opt-in on Supabase. If the extension is not enabled
-- on this project, the schedule is skipped with a NOTICE; the RPC
-- itself still works for manual ops calls. To enable pg_cron via
-- the Supabase Dashboard: Database -> Extensions -> pg_cron.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'memory-candidates-expire') THEN
      PERFORM cron.unschedule('memory-candidates-expire');
    END IF;
    PERFORM cron.schedule(
      'memory-candidates-expire',
      '0 4 * * *',
      $cmd$SELECT public.expire_pending_candidates(NULL::int, 'system:workflow:expire-candidates')$cmd$
    );
    RAISE NOTICE 'pg_cron memory-candidates-expire schedule registered (daily at 04:00 UTC)';
  ELSE
    RAISE NOTICE 'pg_cron extension not enabled; memory-candidates-expire schedule skipped. Enable via Dashboard -> Database -> Extensions, then run the cron.schedule call manually.';
  END IF;
END $$;

COMMIT;

-- =====================================================
-- DOWN (manual reversal, not a separate migration file)
-- =====================================================
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--     PERFORM cron.unschedule('memory-candidates-expire');
--   END IF;
-- END $$;
-- DROP FUNCTION IF EXISTS public.auto_promote_high_confidence(UUID, UUID, TEXT, JSONB, TEXT, UUID, UUID, NUMERIC, UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.write_durable_memory_from_candidate(UUID, UUID, TEXT, JSONB, TEXT, UUID, NUMERIC, UUID);
-- DROP FUNCTION IF EXISTS public.expire_pending_candidates(INT, TEXT);
-- DROP FUNCTION IF EXISTS public.dismiss_memory_candidate(UUID, UUID, TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.approve_memory_candidate(UUID, UUID, JSONB, TEXT);
-- DROP FUNCTION IF EXISTS public.insert_memory_candidate(UUID, UUID, TEXT, JSONB, TEXT, UUID, UUID, NUMERIC, UUID, TEXT);
