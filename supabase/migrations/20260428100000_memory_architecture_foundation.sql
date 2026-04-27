-- =====================================================
-- MEMORY ARCHITECTURE FOUNDATION
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §1
-- Brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 1)
-- Substrate audit: docs/research/2026-04-27-brief-1-substrate-audit.md
--
-- Adds Graphiti four-timestamp model to facts, plus four foundation tables
-- (workspace_rule, brand_guideline, anticipation_hints, memory_workflows +
-- memory_workflow_runs). Storage only behind MEMORY_V2_ENABLED. RLS policies
-- are added in 20260428110000_member_scoped_rls.sql; audit triggers are added
-- in 20260428120000_memory_audit_log.sql.
-- =====================================================

BEGIN;

-- 1. Add expired_at to facts (Graphiti 4-timestamp model)
-- valid_from/valid_to = event time. ingested_at/expired_at = transaction time.
ALTER TABLE public.facts
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fact_embedding VECTOR(1536);

CREATE INDEX IF NOT EXISTS idx_facts_active_v2
  ON public.facts (organization_id, subject_entity)
  WHERE superseded_by IS NULL AND expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_facts_embedding_hnsw
  ON public.facts
  USING hnsw (fact_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE fact_embedding IS NOT NULL;

-- 2. workspace_rule (typed procedural memory)
-- Rules currently live in memory_entries.content as TEXT. This table promotes
-- them to a typed surface with rule_type, applies_to, priority, and bi-temporal
-- validity. No app code reads from this in Brief 1.
CREATE TABLE IF NOT EXISTS public.workspace_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scope_id UUID REFERENCES public.workspace_scopes(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'always', 'never', 'precedence', 'format', 'tone', 'source', 'approval', 'style'
  )),
  rule_text TEXT NOT NULL,
  applies_to TEXT[] NOT NULL DEFAULT '{}',
  forbidden TEXT[] NOT NULL DEFAULT '{}',
  origin TEXT NOT NULL CHECK (origin IN ('user', 'inferred', 'template')),
  origin_evidence JSONB NOT NULL DEFAULT '[]',
  priority INT NOT NULL DEFAULT 50,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  confidence REAL NOT NULL DEFAULT 0.95 CHECK (confidence BETWEEN 0 AND 1),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  last_applied_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_rule_active
  ON public.workspace_rule (workspace_id, scope_id, active, priority DESC)
  WHERE active = TRUE AND expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_rule_applies_to
  ON public.workspace_rule USING GIN (applies_to)
  WHERE active = TRUE;

ALTER TABLE public.workspace_rule ENABLE ROW LEVEL SECURITY;

-- 3. brand_guideline (typed brand-rule extraction target)
-- Populated by the brand-extraction pipeline in Brief 3. Storage only here.
CREATE TABLE IF NOT EXISTS public.brand_guideline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  brand_entity_id UUID REFERENCES public.entities(id) ON DELETE SET NULL,
  brand TEXT NOT NULL,
  version TEXT NOT NULL,
  source_document_id UUID,
  typography JSONB NOT NULL DEFAULT '[]',
  colour JSONB NOT NULL DEFAULT '{}',
  tone JSONB NOT NULL DEFAULT '[]',
  imagery JSONB NOT NULL DEFAULT '[]',
  forbidden TEXT[] NOT NULL DEFAULT '{}',
  language_preferences JSONB NOT NULL DEFAULT '{}',
  layout JSONB NOT NULL DEFAULT '[]',
  logo JSONB NOT NULL DEFAULT '[]',
  extraction_method TEXT NOT NULL CHECK (extraction_method IN ('instructor', 'baml', 'outlines', 'manual')),
  extraction_confidence REAL NOT NULL DEFAULT 0.85 CHECK (extraction_confidence BETWEEN 0 AND 1),
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  superseded_by UUID REFERENCES public.brand_guideline(id),
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE (workspace_id, brand, version)
);

CREATE INDEX IF NOT EXISTS idx_brand_guideline_workspace
  ON public.brand_guideline (workspace_id, brand)
  WHERE superseded_by IS NULL;

ALTER TABLE public.brand_guideline ENABLE ROW LEVEL SECURITY;

-- 4. Hint enums (CREATE TYPE has no IF NOT EXISTS; wrap with DO block for
-- idempotent reapplication during db reset).
DO $$ BEGIN
  CREATE TYPE hint_kind AS ENUM ('reactive', 'proactive', 'optimisation');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE hint_status AS ENUM (
    'candidate', 'shown', 'accepted', 'dismissed', 'snoozed', 'expired', 'suppressed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. anticipation_hints (governed hint queue, Linear Triage Intelligence pattern)
CREATE TABLE IF NOT EXISTS public.anticipation_hints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scope_id UUID REFERENCES public.workspace_scopes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  kind hint_kind NOT NULL,
  status hint_status NOT NULL DEFAULT 'candidate',
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_refs JSONB NOT NULL,
  target_action JSONB NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  urgency INT NOT NULL DEFAULT 2 CHECK (urgency IN (1, 2, 3)),
  cooldown_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shown_at TIMESTAMPTZ,
  acted_at TIMESTAMPTZ,
  acted_by UUID REFERENCES auth.users(id),
  workflow_run_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'
);

-- Spec §1 wrote `WHERE status IN ('candidate', 'shown') AND expires_at > NOW()`,
-- but Postgres requires IMMUTABLE functions in partial index predicates and NOW()
-- is STABLE. Brief 1 dry-run on a production-schema copy surfaced the rejection
-- (ERROR: functions in index predicate must be marked IMMUTABLE). The expires_at
-- filter moves to query time; the index column ordering keeps the
-- (workspace_id, scope_id, status, urgency, expires_at) lookups cheap.
CREATE INDEX IF NOT EXISTS idx_anticipation_hints_active
  ON public.anticipation_hints (workspace_id, scope_id, status, urgency, expires_at)
  WHERE status IN ('candidate', 'shown');

CREATE INDEX IF NOT EXISTS idx_anticipation_hints_cooldown
  ON public.anticipation_hints (workspace_id, scope_id, cooldown_key, status, created_at DESC);

ALTER TABLE public.anticipation_hints ENABLE ROW LEVEL SECURITY;

-- 6. memory_workflows (named meta-workflow registry)
CREATE TABLE IF NOT EXISTS public.memory_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  version INT NOT NULL,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN (
    'on_upload', 'on_session_end', 'on_deliverable_edit', 'cron', 'on_deadline'
  )),
  schedule_cron TEXT,
  skill_ref TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name, version)
);

ALTER TABLE public.memory_workflows ENABLE ROW LEVEL SECURITY;

-- 7. memory_workflow_runs (audit of workflow executions)
CREATE TABLE IF NOT EXISTS public.memory_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  workflow_id UUID NOT NULL REFERENCES public.memory_workflows(id) ON DELETE CASCADE,
  workspace_id UUID,
  scope_id UUID,
  trigger_payload JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failure', 'cancelled')),
  candidates_created INT NOT NULL DEFAULT 0,
  hints_created INT NOT NULL DEFAULT 0,
  rules_proposed INT NOT NULL DEFAULT 0,
  prompt_version TEXT,
  skill_version TEXT,
  cost_usd NUMERIC(10, 4),
  tokens_input INT,
  tokens_output INT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_memory_workflow_runs_recent
  ON public.memory_workflow_runs (organization_id, workflow_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_workflow_runs_workspace
  ON public.memory_workflow_runs (workspace_id, started_at DESC);

ALTER TABLE public.memory_workflow_runs ENABLE ROW LEVEL SECURITY;

COMMIT;

-- =====================================================
-- DOWN (manual reversal, not a separate migration file)
-- =====================================================
-- DROP TABLE IF EXISTS public.memory_workflow_runs;
-- DROP TABLE IF EXISTS public.memory_workflows;
-- DROP TABLE IF EXISTS public.anticipation_hints;
-- DROP TYPE IF EXISTS hint_status;
-- DROP TYPE IF EXISTS hint_kind;
-- DROP TABLE IF EXISTS public.brand_guideline;
-- DROP TABLE IF EXISTS public.workspace_rule;
-- DROP INDEX IF EXISTS public.idx_facts_embedding_hnsw;
-- DROP INDEX IF EXISTS public.idx_facts_active_v2;
-- ALTER TABLE public.facts DROP COLUMN IF EXISTS fact_embedding;
-- ALTER TABLE public.facts DROP COLUMN IF EXISTS expired_at;
