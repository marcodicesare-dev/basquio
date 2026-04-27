-- =====================================================
-- MEMORY CANDIDATES QUEUE (Memory v1 Brief 4)
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §7
-- Brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 4)
--
-- The post-turn fact extractor (chat-extraction.ts) writes here:
--   confidence < 0.6: dropped silently
--   0.6 <= confidence <= 0.8: insert here with status='pending'
--   confidence > 0.8 (and CHAT_EXTRACTOR_ENABLED=true): auto-promote
--                                                       to facts /
--                                                       workspace_rule /
--                                                       memory_entries /
--                                                       entities, mark
--                                                       candidate as
--                                                       'approved'
-- Audited via the audit_memory_change trigger (attached in Brief 1).
-- The 5 SECURITY DEFINER RPCs that mutate this table live in
-- 20260505110000_memory_candidates_rpcs.sql.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.memory_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scope_id UUID REFERENCES public.workspace_scopes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'rule', 'preference', 'alias', 'entity')),
  content JSONB NOT NULL,
  evidence_excerpt TEXT NOT NULL,
  source_conversation_id UUID,
  source_message_id UUID,
  confidence NUMERIC(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed', 'expired')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  dismissed_reason TEXT,
  dismissed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  workflow_run_id UUID REFERENCES public.memory_workflow_runs(id),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot-path query: list pending candidates for a workspace.
CREATE INDEX IF NOT EXISTS idx_memory_candidates_workspace_pending
  ON public.memory_candidates (workspace_id, status, created_at DESC)
  WHERE status = 'pending';

-- Trace candidates back to the conversation that produced them.
CREATE INDEX IF NOT EXISTS idx_memory_candidates_conversation
  ON public.memory_candidates (source_conversation_id, created_at DESC);

-- Nightly expire job scans this index.
-- Spec wrote `WHERE expires_at < NOW()` which Postgres rejects in a
-- partial index predicate (NOW() is STABLE, not IMMUTABLE; same lesson
-- as Brief 1 idx_anticipation_hints_active). Filter on status='pending'
-- only and let the cron job handle the time predicate at query time.
CREATE INDEX IF NOT EXISTS idx_memory_candidates_expires
  ON public.memory_candidates (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.memory_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service writes" ON public.memory_candidates;
CREATE POLICY "service writes" ON public.memory_candidates
  FOR ALL TO service_role USING (TRUE);

DROP POLICY IF EXISTS "members read" ON public.memory_candidates;
CREATE POLICY "members read" ON public.memory_candidates
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

COMMIT;

-- =====================================================
-- DOWN (manual reversal, not a separate migration file)
-- =====================================================
-- DROP POLICY IF EXISTS "members read" ON public.memory_candidates;
-- DROP POLICY IF EXISTS "service writes" ON public.memory_candidates;
-- DROP INDEX IF EXISTS public.idx_memory_candidates_expires;
-- DROP INDEX IF EXISTS public.idx_memory_candidates_conversation;
-- DROP INDEX IF EXISTS public.idx_memory_candidates_workspace_pending;
-- DROP TABLE IF EXISTS public.memory_candidates;
