-- =====================================================
-- WORKSPACE_RULE SECURITY DEFINER RPCs (Memory v1 Brief 5, PART A)
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §8
--
-- Brief 5 promotes workspace_rule from Brief 1 storage-only into a
-- live mutation surface. Memory Inspector v2 [Pin] [Edit] [Forget]
-- actions and the teachRule chat tool both write through these RPCs.
-- Each function follows the persist_brand_guideline pattern from
-- Brief 3 (canonical reference): SECURITY DEFINER, SET search_path = '',
-- sets app.actor inside the body so the audit_memory_change trigger
-- from Brief 1 attributes the caller in the same transaction.
-- =====================================================

BEGIN;

-- ─── 1. upsert_workspace_rule ────────────────────────────────────────
-- Creates a new rule or updates an existing one. UNIQUE constraint on
-- (workspace_id, scope_id, rule_type, rule_text) keeps duplicate text
-- from spawning two rules. The chat surface teachRule tool and the
-- Memory Inspector "Add a rule" form both call this.
CREATE OR REPLACE FUNCTION public.upsert_workspace_rule(
  p_workspace_id UUID,
  p_scope_id UUID,
  p_rule_type TEXT,
  p_rule_text TEXT,
  p_applies_to TEXT[],
  p_forbidden TEXT[],
  p_origin TEXT,
  p_origin_evidence JSONB,
  p_priority INT,
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
    RAISE EXCEPTION 'upsert_workspace_rule: actor is required';
  END IF;
  IF p_rule_type NOT IN ('always','never','precedence','format','tone','source','approval','style') THEN
    RAISE EXCEPTION 'upsert_workspace_rule: invalid rule_type %', p_rule_type;
  END IF;
  IF p_origin NOT IN ('user','inferred','template') THEN
    RAISE EXCEPTION 'upsert_workspace_rule: invalid origin %', p_origin;
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  -- Try to find an existing rule with the same workspace + scope + type
  -- + text. If present, update; else insert.
  SELECT id INTO _id
  FROM public.workspace_rule
  WHERE workspace_id = p_workspace_id
    AND scope_id IS NOT DISTINCT FROM p_scope_id
    AND rule_type = p_rule_type
    AND rule_text = p_rule_text
  LIMIT 1;

  IF _id IS NULL THEN
    INSERT INTO public.workspace_rule (
      workspace_id, scope_id, rule_type, rule_text,
      applies_to, forbidden,
      origin, origin_evidence,
      priority, active,
      confidence
    ) VALUES (
      p_workspace_id, p_scope_id, p_rule_type, p_rule_text,
      COALESCE(p_applies_to, '{}'::text[]),
      COALESCE(p_forbidden, '{}'::text[]),
      p_origin,
      COALESCE(p_origin_evidence, '[]'::jsonb),
      COALESCE(p_priority, 50),
      TRUE,
      0.95
    )
    RETURNING id INTO _id;
  ELSE
    UPDATE public.workspace_rule
    SET applies_to = COALESCE(p_applies_to, applies_to),
        forbidden = COALESCE(p_forbidden, forbidden),
        origin_evidence = COALESCE(p_origin_evidence, origin_evidence),
        priority = COALESCE(p_priority, priority),
        active = TRUE,
        expired_at = NULL,
        updated_at = NOW()
    WHERE id = _id;
  END IF;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_workspace_rule(
  UUID, UUID, TEXT, TEXT, TEXT[], TEXT[], TEXT, JSONB, INT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_workspace_rule(
  UUID, UUID, TEXT, TEXT, TEXT[], TEXT[], TEXT, JSONB, INT, TEXT
) TO service_role;

-- ─── 2. pin_workspace_rule ───────────────────────────────────────────
-- Bumps priority to a high value (90) and marks the rule as
-- approved_by the user. Used by the [Pin] action in Memory Inspector.
CREATE OR REPLACE FUNCTION public.pin_workspace_rule(
  p_rule_id UUID,
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
    RAISE EXCEPTION 'pin_workspace_rule: actor is required';
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  UPDATE public.workspace_rule
  SET priority = GREATEST(priority, 90),
      approved_by = p_user_id,
      approved_at = NOW(),
      active = TRUE,
      expired_at = NULL,
      updated_at = NOW()
  WHERE id = p_rule_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pin_workspace_rule: rule % not found', p_rule_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pin_workspace_rule(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pin_workspace_rule(UUID, UUID, TEXT) TO service_role;

-- ─── 3. edit_workspace_rule ──────────────────────────────────────────
-- Applies a JSON-merge edit to the rule. Allowed fields: rule_text,
-- applies_to, forbidden, priority, rule_type. Audited via the trigger.
CREATE OR REPLACE FUNCTION public.edit_workspace_rule(
  p_rule_id UUID,
  p_user_id UUID,
  p_edits JSONB,
  p_actor TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _new_type TEXT;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'edit_workspace_rule: actor is required';
  END IF;
  IF p_edits IS NULL OR jsonb_typeof(p_edits) <> 'object' THEN
    RAISE EXCEPTION 'edit_workspace_rule: edits must be a JSON object';
  END IF;

  _new_type := p_edits ->> 'rule_type';
  IF _new_type IS NOT NULL AND _new_type NOT IN ('always','never','precedence','format','tone','source','approval','style') THEN
    RAISE EXCEPTION 'edit_workspace_rule: invalid rule_type %', _new_type;
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  UPDATE public.workspace_rule
  SET rule_text = COALESCE(p_edits ->> 'rule_text', rule_text),
      rule_type = COALESCE(_new_type, rule_type),
      applies_to = COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(p_edits -> 'applies_to')),
        applies_to
      ),
      forbidden = COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(p_edits -> 'forbidden')),
        forbidden
      ),
      priority = COALESCE((p_edits ->> 'priority')::int, priority),
      approved_by = p_user_id,
      approved_at = NOW(),
      updated_at = NOW()
  WHERE id = p_rule_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'edit_workspace_rule: rule % not found', p_rule_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_workspace_rule(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_workspace_rule(UUID, UUID, JSONB, TEXT) TO service_role;

-- ─── 4. forget_workspace_rule ────────────────────────────────────────
-- The "soft delete" path. Sets active=false + expired_at=NOW(). The
-- audit log row preserves the prior content so the rule can be
-- recovered if needed. Pin / Edit on an expired rule reactivates it.
CREATE OR REPLACE FUNCTION public.forget_workspace_rule(
  p_rule_id UUID,
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
    RAISE EXCEPTION 'forget_workspace_rule: actor is required';
  END IF;

  PERFORM pg_catalog.set_config('app.actor', p_actor, true);

  UPDATE public.workspace_rule
  SET active = FALSE,
      expired_at = NOW(),
      valid_to = NOW(),
      approved_by = p_user_id,
      approved_at = NOW(),
      updated_at = NOW()
  WHERE id = p_rule_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forget_workspace_rule: rule % not found', p_rule_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.forget_workspace_rule(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.forget_workspace_rule(UUID, UUID, TEXT) TO service_role;

COMMIT;

-- =====================================================
-- DOWN (manual reversal, not a separate migration file)
-- =====================================================
-- DROP FUNCTION IF EXISTS public.forget_workspace_rule(UUID, UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.edit_workspace_rule(UUID, UUID, JSONB, TEXT);
-- DROP FUNCTION IF EXISTS public.pin_workspace_rule(UUID, UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.upsert_workspace_rule(UUID, UUID, TEXT, TEXT, TEXT[], TEXT[], TEXT, JSONB, INT, TEXT);
