-- =====================================================
-- SUPER ADMINS (Memory v1 Brief 6, admin console v1)
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §10
--
-- /admin/* routes require a super_admin role on the user. Implemented
-- as a tiny membership table joined with auth.users(id). Initial
-- member: Marco only (two emails seeded: marcodicesare1992@gmail.com
-- and marco@basquio.com). Future admins added via INSERT by an
-- existing super_admin.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  added_by UUID REFERENCES auth.users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service writes" ON public.super_admins;
CREATE POLICY "service writes" ON public.super_admins
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "self read" ON public.super_admins;
CREATE POLICY "self read" ON public.super_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─── is_super_admin helper (canonical guard pattern) ────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins WHERE user_id = _user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated, service_role;

-- ─── Seed Marco ─────────────────────────────────────────────────────
-- Marco has two basquio-relevant emails on this Supabase project:
--   marcodicesare1992@gmail.com (52aa79f4-de45-4be6-9487-051bb5dffbf7)
--   marco@basquio.com           (a2dd82d3-a9be-458e-89b5-bbcde9846235)
-- Both are seeded so the admin console reaches him no matter which
-- session he is signed into.
INSERT INTO public.super_admins (user_id, email, notes)
VALUES
  ('52aa79f4-de45-4be6-9487-051bb5dffbf7', 'marcodicesare1992@gmail.com', 'Marco, initial founder admin (Brief 6 seed)'),
  ('a2dd82d3-a9be-458e-89b5-bbcde9846235', 'marco@basquio.com', 'Marco, basquio.com admin (Brief 6 seed)')
ON CONFLICT (user_id) DO NOTHING;

COMMIT;

-- =====================================================
-- DOWN (manual reversal)
-- =====================================================
-- DROP FUNCTION IF EXISTS public.is_super_admin(UUID);
-- DROP POLICY IF EXISTS "self read" ON public.super_admins;
-- DROP POLICY IF EXISTS "service writes" ON public.super_admins;
-- DROP TABLE IF EXISTS public.super_admins;
