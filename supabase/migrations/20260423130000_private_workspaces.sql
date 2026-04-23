-- Per-user private workspaces (R6 prerequisite for the chat + research spec).
--
-- Context: the v2 workspace schema (20260420120000) seeded ONE team workspace
-- at BASQUIO_TEAM_WORKSPACE_ID and the application hardcodes that singleton in
-- getCurrentWorkspace(). Marco needs a parallel private surface so personal
-- corpora (Lumina, Loamly) can be ingested without polluting the shared team
-- workspace. The chat+research spec R6 named this a ~90-line prerequisite.
--
-- This migration is additive only: no existing row is mutated, no column is
-- dropped or renamed. It adds the uniqueness guard plus an idempotent
-- creation function. The application layer decides when to call it.
--
-- Identity rule for a personal workspace:
--   visibility = 'private'
--   AND kind    = 'customer'
--   AND created_by IS NOT NULL
--   AND metadata->>'is_personal' = 'true'
--
-- We reuse the existing kind = 'customer' value rather than extending the
-- kind CHECK constraint, because altering that constraint requires rewriting
-- every row on a large table for no offsetting benefit. The metadata
-- is_personal flag carries the semantic distinction.

BEGIN;

-- ── 1. Uniqueness guard: one personal workspace per user ──

CREATE UNIQUE INDEX IF NOT EXISTS uniq_workspaces_personal_per_user
  ON public.workspaces (created_by)
  WHERE visibility = 'private'
    AND kind = 'customer'
    AND created_by IS NOT NULL
    AND metadata->>'is_personal' = 'true';

-- ── 2. Idempotent creation function ──
--
-- Returns the workspace id of the user's personal workspace, creating it on
-- first call. The same caller (user id) always resolves to the same id.
--
-- SECURITY DEFINER lets the function run as the migration owner so service
-- role is not required at the call site. RLS on workspaces is service-role-
-- only anyway, but this keeps the helper usable from edge functions or any
-- future authenticated route without widening surface area.
--
-- search_path is pinned per the Supabase advisor rule (see migration
-- 20260421220000_lock_search_path_on_workspace_functions.sql for the pattern).
--
-- Concurrency: an advisory transaction lock keyed on the user id serializes
-- concurrent callers so the select-then-insert pattern is race-safe without
-- juggling ON CONFLICT semantics against the partial unique index.

CREATE OR REPLACE FUNCTION public.ensure_private_workspace(
  p_user_id UUID,
  p_user_email TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_workspace_id UUID;
  v_display_name TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ensure_private_workspace requires p_user_id'
      USING ERRCODE = '22004';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ensure_private_workspace:' || p_user_id::text, 0)
  );

  SELECT id INTO v_workspace_id
  FROM public.workspaces
  WHERE created_by = p_user_id
    AND visibility = 'private'
    AND kind = 'customer'
    AND metadata->>'is_personal' = 'true'
  LIMIT 1;

  IF v_workspace_id IS NOT NULL THEN
    RETURN v_workspace_id;
  END IF;

  -- organization_id equals the new workspace id so the V1 backfill contract
  -- (workspace_id = organization_id on scoped rows) stays intact for
  -- downstream inserts into entities, memory_entries, and friends. This also
  -- keeps the UNIQUE (organization_id, slug) constraint safe: every personal
  -- workspace uses slug 'my-workspace' but its organization_id is unique, so
  -- (organization_id, slug) never collides across users.
  v_workspace_id := gen_random_uuid();

  v_display_name := left(
    COALESCE(
      NULLIF(split_part(COALESCE(p_user_email, ''), '@', 1), ''),
      'personal'
    ) || '''s workspace',
    120
  );

  INSERT INTO public.workspaces (
    id,
    organization_id,
    name,
    slug,
    kind,
    visibility,
    metadata,
    created_by
  ) VALUES (
    v_workspace_id,
    v_workspace_id,
    v_display_name,
    'my-workspace',
    'customer',
    'private',
    jsonb_build_object(
      'is_personal', true,
      'created_via', 'ensure_private_workspace',
      'owner_email', p_user_email
    ),
    p_user_id
  );

  -- Seed the same two system scopes the team workspace gets (see migration
  -- 20260420120000 step 6). Application code relies on these two scopes
  -- existing for every workspace.
  INSERT INTO public.workspace_scopes (workspace_id, kind, name, slug, metadata)
  VALUES
    (v_workspace_id, 'system', 'Workspace', 'workspace',
     jsonb_build_object('seeded', true, 'builtin', true)),
    (v_workspace_id, 'system', 'Analyst', 'analyst',
     jsonb_build_object('seeded', true, 'builtin', true));

  RETURN v_workspace_id;
END;
$$;

COMMENT ON FUNCTION public.ensure_private_workspace(UUID, TEXT) IS
  'Returns the user''s personal workspace id, creating it on first call. Idempotent. See migration 20260423130000 and chat+research spec R6.';

REVOKE ALL ON FUNCTION public.ensure_private_workspace(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_private_workspace(UUID, TEXT) TO service_role;

-- DO NOT grant EXECUTE to the `authenticated` role without first adding an
-- email allowlist check inside the function body. SECURITY DEFINER bypasses
-- RLS, so widening the grant without a DB-level gate would let any
-- authenticated user create a workspace for any uuid they pass. The app
-- layer's isTeamBetaEmail gate does not cover a direct authenticated RPC
-- call.

COMMIT;
