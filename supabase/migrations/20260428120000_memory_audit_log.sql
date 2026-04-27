-- =====================================================
-- MEMORY MUTATION AUDIT LOG
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §3
-- Brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 1)
--
-- Append-only audit log covering ADD/UPDATE/DELETE/SUPERSEDE on the memory
-- tables. Trigger function reads app.actor and app.workflow_run_id from
-- session-local config (set by withActor in apps/web/src/lib/workspace/audit.ts).
-- Includes a public.set_config wrapper so PostgREST RPC calls from the app
-- can invoke pg_catalog.set_config without referencing the catalog schema.
-- =====================================================

BEGIN;

-- 1. public.set_config wrapper (PostgREST RPC dispatch resolves to public).
-- Thin pass-through to pg_catalog.set_config so app code can call
-- supabase.rpc('set_config', { setting_name, new_value, is_local }).
CREATE OR REPLACE FUNCTION public.set_config(
  setting_name TEXT,
  new_value TEXT,
  is_local BOOLEAN
)
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.set_config(setting_name, new_value, is_local);
$$;

-- 2. memory_audit table
CREATE TABLE IF NOT EXISTS public.memory_audit (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  workspace_id UUID,
  scope_id UUID,
  table_name TEXT NOT NULL,
  row_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'insert', 'update', 'delete', 'supersede', 'invalidate', 'pin', 'archive'
  )),
  actor TEXT NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id),
  workflow_run_id UUID REFERENCES public.memory_workflow_runs(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  source_refs JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_memory_audit_workspace_recent
  ON public.memory_audit (workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_audit_table_row
  ON public.memory_audit (table_name, row_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_audit_actor
  ON public.memory_audit (actor, occurred_at DESC);

ALTER TABLE public.memory_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service writes" ON public.memory_audit;
CREATE POLICY "service writes" ON public.memory_audit
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "members read" ON public.memory_audit;
CREATE POLICY "members read" ON public.memory_audit
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND public.is_workspace_member(workspace_id)
  );

-- 3. audit_memory_change trigger function
-- Reads app.actor (TEXT) and app.workflow_run_id (UUID) from session-local
-- config, derives action from TG_OP, derives row_id from row_to_json::id,
-- writes one memory_audit row per insert/update/delete.
CREATE OR REPLACE FUNCTION public.audit_memory_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _action TEXT;
  _row_id UUID;
  _workspace_id UUID;
  _scope_id UUID;
  _organization_id UUID;
  _actor TEXT;
  _workflow_run_id UUID;
  _workflow_run_setting TEXT;
  _row_jsonb JSONB;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    _action := 'insert';
    _row_jsonb := row_to_json(NEW)::jsonb;
  ELSIF (TG_OP = 'UPDATE') THEN
    _action := 'update';
    _row_jsonb := row_to_json(NEW)::jsonb;
  ELSIF (TG_OP = 'DELETE') THEN
    _action := 'delete';
    _row_jsonb := row_to_json(OLD)::jsonb;
  END IF;

  _row_id := (_row_jsonb ->> 'id')::uuid;
  _workspace_id := NULLIF(_row_jsonb ->> 'workspace_id', '')::uuid;
  _scope_id := NULLIF(_row_jsonb ->> 'scope_id', '')::uuid;
  _organization_id := COALESCE(
    NULLIF(_row_jsonb ->> 'organization_id', '')::uuid,
    _workspace_id
  );

  _actor := COALESCE(NULLIF(current_setting('app.actor', TRUE), ''), 'system:unknown');
  _workflow_run_setting := NULLIF(current_setting('app.workflow_run_id', TRUE), '');
  IF _workflow_run_setting IS NOT NULL THEN
    BEGIN
      _workflow_run_id := _workflow_run_setting::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      _workflow_run_id := NULL;
    END;
  END IF;

  INSERT INTO public.memory_audit (
    organization_id,
    workspace_id,
    scope_id,
    table_name,
    row_id,
    action,
    actor,
    workflow_run_id,
    before_state,
    after_state
  ) VALUES (
    _organization_id,
    _workspace_id,
    _scope_id,
    TG_TABLE_NAME,
    _row_id,
    _action,
    _actor,
    _workflow_run_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD)::jsonb ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW)::jsonb ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 4. Attach the trigger to every memory table that holds product memory.
-- Safe to re-run: drop-then-create.
DROP TRIGGER IF EXISTS trg_audit_workspace_rule ON public.workspace_rule;
CREATE TRIGGER trg_audit_workspace_rule
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_rule
  FOR EACH ROW EXECUTE FUNCTION public.audit_memory_change();

DROP TRIGGER IF EXISTS trg_audit_brand_guideline ON public.brand_guideline;
CREATE TRIGGER trg_audit_brand_guideline
  AFTER INSERT OR UPDATE OR DELETE ON public.brand_guideline
  FOR EACH ROW EXECUTE FUNCTION public.audit_memory_change();

DROP TRIGGER IF EXISTS trg_audit_anticipation_hints ON public.anticipation_hints;
CREATE TRIGGER trg_audit_anticipation_hints
  AFTER INSERT OR UPDATE OR DELETE ON public.anticipation_hints
  FOR EACH ROW EXECUTE FUNCTION public.audit_memory_change();

DROP TRIGGER IF EXISTS trg_audit_facts ON public.facts;
CREATE TRIGGER trg_audit_facts
  AFTER INSERT OR UPDATE OR DELETE ON public.facts
  FOR EACH ROW EXECUTE FUNCTION public.audit_memory_change();

DROP TRIGGER IF EXISTS trg_audit_memory_entries ON public.memory_entries;
CREATE TRIGGER trg_audit_memory_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.memory_entries
  FOR EACH ROW EXECUTE FUNCTION public.audit_memory_change();

COMMIT;

-- =====================================================
-- DOWN (manual reversal, not a separate migration file)
-- =====================================================
-- DROP TRIGGER IF EXISTS trg_audit_memory_entries ON public.memory_entries;
-- DROP TRIGGER IF EXISTS trg_audit_facts ON public.facts;
-- DROP TRIGGER IF EXISTS trg_audit_anticipation_hints ON public.anticipation_hints;
-- DROP TRIGGER IF EXISTS trg_audit_brand_guideline ON public.brand_guideline;
-- DROP TRIGGER IF EXISTS trg_audit_workspace_rule ON public.workspace_rule;
-- DROP FUNCTION IF EXISTS public.audit_memory_change();
-- DROP TABLE IF EXISTS public.memory_audit;
-- DROP FUNCTION IF EXISTS public.set_config(TEXT, TEXT, BOOLEAN);
