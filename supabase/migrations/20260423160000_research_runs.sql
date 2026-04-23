-- Research run telemetry: one row per research phase execution.
--
-- Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §3.3.
-- Populated by the research phase inserted between `normalize` and
-- `understand` in the deck pipeline (§5.5). Also populated when the
-- `suggestServices` and `draftBrief` chat tools trigger a planner-only
-- dry run.
--
-- The `plan` JSONB stores the shape from §5.2 (ResearchPlan), including
-- existingGraphRefs, queries, rationale, estimated_credits, and
-- graph_coverage_score. The shape is load-bearing for the UI telemetry
-- row in §7.3 but not type-checked at the DB level; the research package
-- validates via Zod at write time.
--
-- On DELETE SET NULL for deck_run_id and conversation_id preserves the
-- telemetry trail when a deck run or conversation is archived, so cost
-- reports cover historical activity even after the originating job is
-- gone.

BEGIN;

CREATE TABLE IF NOT EXISTS public.research_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  deck_run_id UUID REFERENCES public.deck_runs(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.workspace_conversations(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('deck_run','chat_tool','manual')),
  brief_summary TEXT,
  plan JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','planning','fetching','indexing','completed','failed','cancelled'
  )),
  scrapes_attempted INT NOT NULL DEFAULT 0,
  scrapes_succeeded INT NOT NULL DEFAULT 0,
  firecrawl_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  evidence_ref_count INT NOT NULL DEFAULT 0,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS research_runs_deck_run_idx
  ON public.research_runs (deck_run_id);

CREATE INDEX IF NOT EXISTS research_runs_workspace_created_idx
  ON public.research_runs (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS research_runs_status_idx
  ON public.research_runs (status, created_at DESC);

ALTER TABLE public.research_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages research_runs"
  ON public.research_runs FOR ALL TO service_role USING (true);

COMMIT;
