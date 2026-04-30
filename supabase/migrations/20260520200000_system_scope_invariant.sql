-- =====================================================
-- SYSTEM SCOPE INVARIANT
--
-- Francesco found this on Apr 30 2026: signed into Segafredo, asked Basquio
-- to save a rule firm-wide ("aggiungerla anche nel workspace generale"), got
-- "Scope 'workspace' does not exist yet. Ask the user if they want to create
-- it, or pick an existing scope."
--
-- Root cause: migration 20260420120000 step 6 seeded system:workspace +
-- system:analyst only for the BASQUIO_TEAM_WORKSPACE_ID singleton, and
-- migration 20260423130000 added the seeding inside ensure_private_workspace
-- but team-customer-demo workspaces (created directly via the workspaces
-- table or via cloneWorkspace) bypass that path. Segafredo Italia was
-- created via service-role POST and never got system scopes.
--
-- SOTA pattern (Harvey, Legora, Glean): firm-wide / workspace-wide scope is
-- an invariant. It must be auto-created at workspace provisioning,
-- non-deletable, defaulting all unscoped facts to it. The user must never
-- see "scope does not exist".
--
-- This migration:
--   1. Backfills system:workspace + system:analyst for every workspace
--      that lacks them. Idempotent via ON CONFLICT.
--   2. Adds an INSERT trigger on public.workspaces so newly-minted
--      workspaces (any code path) automatically get the two system scopes.
--   3. Trigger is SECURITY DEFINER + search_path='' so it cannot be
--      hijacked by a malicious schema on the same connection.
--
-- Safety: the trigger runs AFTER INSERT and uses ON CONFLICT (workspace_id,
-- kind, slug) DO NOTHING so concurrent inserts and re-runs are harmless.
-- =====================================================

BEGIN;

-- 1. Backfill missing system scopes for every existing workspace.
INSERT INTO public.workspace_scopes (workspace_id, kind, name, slug, metadata)
SELECT
  w.id,
  'system'::text,
  scope_def.name,
  scope_def.slug,
  jsonb_build_object('seeded', true, 'builtin', true, 'backfilled_at', now())
FROM public.workspaces w
CROSS JOIN (VALUES
  ('Workspace', 'workspace'),
  ('Analyst', 'analyst')
) AS scope_def(name, slug)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.workspace_scopes s
  WHERE s.workspace_id = w.id
    AND s.kind = 'system'
    AND s.slug = scope_def.slug
);

-- 2. Trigger function. SECURITY DEFINER so it can write to workspace_scopes
-- regardless of the caller's RLS context. SET search_path = '' is the
-- canonical hardening against search-path hijack on SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.seed_system_scopes_for_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.workspace_scopes (workspace_id, kind, name, slug, metadata)
  VALUES
    (NEW.id, 'system', 'Workspace', 'workspace',
     jsonb_build_object('seeded', true, 'builtin', true, 'via', 'workspaces_insert_trigger')),
    (NEW.id, 'system', 'Analyst', 'analyst',
     jsonb_build_object('seeded', true, 'builtin', true, 'via', 'workspaces_insert_trigger'))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.seed_system_scopes_for_workspace() IS
  'Auto-seeds the two invariant system scopes (workspace, analyst) on every new workspace. Idempotent via ON CONFLICT. See migration 20260520200000.';

-- 3. Drop-and-recreate the trigger so the migration is safe to re-run.
DROP TRIGGER IF EXISTS workspaces_seed_system_scopes ON public.workspaces;

CREATE TRIGGER workspaces_seed_system_scopes
  AFTER INSERT ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_system_scopes_for_workspace();

COMMENT ON TRIGGER workspaces_seed_system_scopes ON public.workspaces IS
  'Maintains the invariant that every workspace has system:workspace and system:analyst scopes from creation. See migration 20260520200000.';

-- 4. Defensive partial unique index so concurrent backfill races + future
-- code paths cannot duplicate system scopes. The base table already has
-- (workspace_id, kind, slug) unique, but documenting intent here.
-- (Skipped: already enforced by existing constraint on workspace_scopes.)

COMMIT;
