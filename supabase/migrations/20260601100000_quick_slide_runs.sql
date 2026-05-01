-- =====================================================
-- QUICK SLIDE RUNS
--
-- Backing table for the in-chat quick-slide tool. Each row represents one
-- single-PPTX-slide generation kicked off from a chat turn.
--
-- Lifecycle:
--   1. quickSlideTool.execute() inserts a row with status='queued' and
--      kicks off the lightweight Anthropic pipeline (POST /run).
--   2. The pipeline updates status='running', writes events as it
--      progresses, then sets status='ready' with pptx_storage_path on
--      success, or status='error' with error_message on failure.
--   3. The chat chip polls GET /api/workspace/quick-slide/[id] until
--      status is 'ready' or 'error'.
--
-- Tenancy: workspace_id matches the chat conversation's workspace. The
-- API endpoints check membership via getCurrentWorkspace + workspace
-- match before reading or signing the download URL.
--
-- Storage: ready PPTX files live in the existing 'workspace-deliverables'
-- bucket under quick-slides/{workspace_id}/{run_id}/slide.pptx.
--
-- Telemetry: cost_usd and duration_ms are populated when status=='ready'
-- so we can spot quick-slide regressions (median > $0.40 or > 75s) in a
-- separate dashboard query.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.quick_slide_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  workspace_scope_id uuid REFERENCES public.workspace_scopes(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.workspace_conversations(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  brief jsonb NOT NULL,
  evidence_doc_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'error')),
  pptx_storage_path text,
  last_event_phase text,
  last_event_message text,
  cost_usd numeric,
  duration_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quick_slide_runs_workspace_status
  ON public.quick_slide_runs (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quick_slide_runs_conversation
  ON public.quick_slide_runs (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

-- updated_at auto-bump on UPDATE.
CREATE OR REPLACE FUNCTION public.tg_quick_slide_runs_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quick_slide_runs_set_updated_at ON public.quick_slide_runs;
CREATE TRIGGER quick_slide_runs_set_updated_at
  BEFORE UPDATE ON public.quick_slide_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_quick_slide_runs_set_updated_at();

-- RLS: members of the workspace can read their own runs.
ALTER TABLE public.quick_slide_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quick_slide_runs_member_read ON public.quick_slide_runs;
CREATE POLICY quick_slide_runs_member_read
  ON public.quick_slide_runs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = quick_slide_runs.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE go through the service role from server routes;
-- no public policy needed.

COMMIT;
