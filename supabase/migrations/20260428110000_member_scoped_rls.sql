-- =====================================================
-- MEMBER-SCOPED RLS
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §2
-- Brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 1)
--
-- Replaces the legacy "service_role USING (true)" only policies on
-- entities, entity_mentions, facts, memory_entries, workspace_deliverables
-- with a service-role write policy plus a member-scoped authenticated
-- SELECT policy. Adds the same shape to the new memory tables created
-- in 20260428100000_memory_architecture_foundation.sql. Sets pgvector 0.8
-- iterative-scan params so HNSW + RLS top-k is correct.
-- =====================================================

BEGIN;

-- 1. workspace_members (table may already exist in some deployments)
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON public.workspace_members (user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON public.workspace_members (workspace_id);

-- 2. is_workspace_member helper (canonical Supabase RLS pattern)
-- SECURITY DEFINER so the policy body can read workspace_members regardless
-- of whether RLS is later enabled on that table. SET search_path = '' is
-- the canonical hardening against search-path hijack on SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = _workspace_id
      AND wm.user_id = auth.uid()
  );
$$;

-- 3. Drop the legacy service-role-only policies on the existing memory tables.
DROP POLICY IF EXISTS "Service role manages entities" ON public.entities;
DROP POLICY IF EXISTS "Service role manages entity_mentions" ON public.entity_mentions;
DROP POLICY IF EXISTS "Service role manages facts" ON public.facts;
DROP POLICY IF EXISTS "Service role manages memory_entries" ON public.memory_entries;
DROP POLICY IF EXISTS "Service role manages workspace_deliverables" ON public.workspace_deliverables;

-- 4. Service-role full access (background jobs, ingestion, deck pipeline worker
-- all rely on this; the bare ALTER TABLE ENABLE RLS without a policy would block
-- them). Drop-then-create to make the migration safe to re-run.
DROP POLICY IF EXISTS "service writes" ON public.entities;
CREATE POLICY "service writes" ON public.entities
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "service writes" ON public.entity_mentions;
CREATE POLICY "service writes" ON public.entity_mentions
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "service writes" ON public.facts;
CREATE POLICY "service writes" ON public.facts
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "service writes" ON public.memory_entries;
CREATE POLICY "service writes" ON public.memory_entries
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "service writes" ON public.workspace_deliverables;
CREATE POLICY "service writes" ON public.workspace_deliverables
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "service writes" ON public.workspace_rule;
CREATE POLICY "service writes" ON public.workspace_rule
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "service writes" ON public.brand_guideline;
CREATE POLICY "service writes" ON public.brand_guideline
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "service writes" ON public.anticipation_hints;
CREATE POLICY "service writes" ON public.anticipation_hints
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "service writes" ON public.memory_workflows;
CREATE POLICY "service writes" ON public.memory_workflows
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "service writes" ON public.memory_workflow_runs;
CREATE POLICY "service writes" ON public.memory_workflow_runs
  FOR ALL TO service_role USING (TRUE);

-- 5. Authenticated read policies on the new memory tables that scope by
-- workspace_id directly.
DROP POLICY IF EXISTS "members read" ON public.workspace_rule;
CREATE POLICY "members read" ON public.workspace_rule
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members read" ON public.brand_guideline;
CREATE POLICY "members read" ON public.brand_guideline
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- Per-user privacy on hints: a user-targeted hint is only visible to that user.
-- Workspace-scoped hints (user_id IS NULL) are visible to every member.
DROP POLICY IF EXISTS "members read own hints" ON public.anticipation_hints;
CREATE POLICY "members read own hints" ON public.anticipation_hints
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- 6. Authenticated read policies on the legacy memory tables that scope by
-- organization_id. Bridge through workspaces.organization_id JOIN
-- workspace_members. Any member of any workspace under the org sees rows for
-- that org. A future brief tightens this to per-workspace scoping once the
-- workspace_id backfill is enforced and code paths drop org-only fallbacks.
DROP POLICY IF EXISTS "members read entities" ON public.entities;
CREATE POLICY "members read entities" ON public.entities
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      JOIN public.workspace_members wm ON wm.workspace_id = w.id
      WHERE w.organization_id = entities.organization_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members read entity_mentions" ON public.entity_mentions;
CREATE POLICY "members read entity_mentions" ON public.entity_mentions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      JOIN public.workspace_members wm ON wm.workspace_id = w.id
      WHERE w.organization_id = entity_mentions.organization_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members read facts" ON public.facts;
CREATE POLICY "members read facts" ON public.facts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      JOIN public.workspace_members wm ON wm.workspace_id = w.id
      WHERE w.organization_id = facts.organization_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members read memory_entries" ON public.memory_entries;
CREATE POLICY "members read memory_entries" ON public.memory_entries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      JOIN public.workspace_members wm ON wm.workspace_id = w.id
      WHERE w.organization_id = memory_entries.organization_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members read workspace_deliverables" ON public.workspace_deliverables;
CREATE POLICY "members read workspace_deliverables" ON public.workspace_deliverables
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      JOIN public.workspace_members wm ON wm.workspace_id = w.id
      WHERE w.organization_id = workspace_deliverables.organization_id
        AND wm.user_id = auth.uid()
    )
  );

-- 7. Member read policies on the workflow registry + run audit. Workflows are
-- org-scoped; runs may be workspace-scoped or org-scoped.
DROP POLICY IF EXISTS "members read memory_workflows" ON public.memory_workflows;
CREATE POLICY "members read memory_workflows" ON public.memory_workflows
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      JOIN public.workspace_members wm ON wm.workspace_id = w.id
      WHERE w.organization_id = memory_workflows.organization_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members read memory_workflow_runs" ON public.memory_workflow_runs;
CREATE POLICY "members read memory_workflow_runs" ON public.memory_workflow_runs
  FOR SELECT TO authenticated
  USING (
    (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
    OR EXISTS (
      SELECT 1
      FROM public.workspaces w
      JOIN public.workspace_members wm ON wm.workspace_id = w.id
      WHERE w.organization_id = memory_workflow_runs.organization_id
        AND wm.user_id = auth.uid()
    )
  );

-- 8. pgvector 0.8 iterative-scan config so HNSW + RLS returns correct top-k.
-- Without this, a vector query with a selective workspace filter can return
-- fewer than k rows. Settings take effect for new sessions.
ALTER DATABASE postgres SET hnsw.iterative_scan = 'strict_order';
ALTER DATABASE postgres SET hnsw.max_scan_tuples = 20000;

COMMIT;

-- =====================================================
-- DOWN (manual reversal, not a separate migration file)
-- =====================================================
-- ALTER DATABASE postgres RESET hnsw.max_scan_tuples;
-- ALTER DATABASE postgres RESET hnsw.iterative_scan;
-- DROP POLICY IF EXISTS "members read memory_workflow_runs" ON public.memory_workflow_runs;
-- DROP POLICY IF EXISTS "members read memory_workflows" ON public.memory_workflows;
-- DROP POLICY IF EXISTS "members read workspace_deliverables" ON public.workspace_deliverables;
-- DROP POLICY IF EXISTS "members read memory_entries" ON public.memory_entries;
-- DROP POLICY IF EXISTS "members read facts" ON public.facts;
-- DROP POLICY IF EXISTS "members read entity_mentions" ON public.entity_mentions;
-- DROP POLICY IF EXISTS "members read entities" ON public.entities;
-- DROP POLICY IF EXISTS "members read own hints" ON public.anticipation_hints;
-- DROP POLICY IF EXISTS "members read" ON public.brand_guideline;
-- DROP POLICY IF EXISTS "members read" ON public.workspace_rule;
-- DROP POLICY IF EXISTS "service writes" ON public.memory_workflow_runs;
-- (... and the rest of the service writes policies)
-- CREATE POLICY "Service role manages entities" ON public.entities
--   FOR ALL TO service_role USING (TRUE);
-- (... restore the four other legacy policies)
-- DROP FUNCTION IF EXISTS public.is_workspace_member(UUID);
-- DROP TABLE IF EXISTS public.workspace_members;
