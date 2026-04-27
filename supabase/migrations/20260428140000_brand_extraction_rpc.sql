-- =====================================================
-- BRAND-EXTRACTION PERSIST RPC (Memory v1 Brief 3)
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §4
-- Brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 3)
-- Carries Brief 1 architectural pivot (withActor → SECURITY DEFINER):
-- the function sets app.actor inside its body so the
-- audit_memory_change trigger from 20260428120000 reads the right
-- actor in the same transaction. PostgREST connection pooling cannot
-- carry a session-local config across separate .rpc() calls; that is
-- why the actor must be set inside the function that performs the
-- mutation.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.persist_brand_guideline(
  p_workspace_id UUID,
  p_brand TEXT,
  p_version TEXT,
  p_source_document_id UUID,
  p_brand_entity_id UUID,
  p_typography JSONB,
  p_colour JSONB,
  p_tone JSONB,
  p_imagery JSONB,
  p_forbidden TEXT[],
  p_language_preferences JSONB,
  p_layout JSONB,
  p_logo JSONB,
  p_extraction_confidence REAL,
  p_actor TEXT,
  p_workflow_run_id UUID DEFAULT NULL
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
    RAISE EXCEPTION 'persist_brand_guideline: actor is required';
  END IF;

  -- Set audit context for the audit_memory_change trigger. The trigger reads
  -- current_setting('app.actor', TRUE) and tolerates an unset value, but we
  -- always pass a real actor here so the audit row is attributable.
  PERFORM pg_catalog.set_config('app.actor', p_actor, true);
  IF p_workflow_run_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('app.workflow_run_id', p_workflow_run_id::text, true);
  END IF;

  INSERT INTO public.brand_guideline (
    workspace_id,
    brand_entity_id,
    brand,
    version,
    source_document_id,
    typography,
    colour,
    tone,
    imagery,
    forbidden,
    language_preferences,
    layout,
    logo,
    extraction_method,
    extraction_confidence
  ) VALUES (
    p_workspace_id,
    p_brand_entity_id,
    p_brand,
    p_version,
    p_source_document_id,
    COALESCE(p_typography, '[]'::jsonb),
    COALESCE(p_colour, '[]'::jsonb),
    COALESCE(p_tone, '[]'::jsonb),
    COALESCE(p_imagery, '[]'::jsonb),
    COALESCE(p_forbidden, '{}'::text[]),
    COALESCE(p_language_preferences, '[]'::jsonb),
    COALESCE(p_layout, '[]'::jsonb),
    COALESCE(p_logo, '[]'::jsonb),
    'baml',
    p_extraction_confidence
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_brand_guideline(
  UUID, TEXT, TEXT, UUID, UUID,
  JSONB, JSONB, JSONB, JSONB, TEXT[], JSONB, JSONB, JSONB,
  REAL, TEXT, UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.persist_brand_guideline(
  UUID, TEXT, TEXT, UUID, UUID,
  JSONB, JSONB, JSONB, JSONB, TEXT[], JSONB, JSONB, JSONB,
  REAL, TEXT, UUID
) TO service_role;

COMMIT;

-- =====================================================
-- DOWN (manual reversal, not a separate migration file)
-- =====================================================
-- DROP FUNCTION IF EXISTS public.persist_brand_guideline(
--   UUID, TEXT, TEXT, UUID, UUID,
--   JSONB, JSONB, JSONB, JSONB, TEXT[], JSONB, JSONB, JSONB,
--   REAL, TEXT, UUID
-- );
