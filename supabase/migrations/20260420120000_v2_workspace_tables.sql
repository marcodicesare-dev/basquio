-- V2 Workspace schema extension. Per docs/spec-v1-workspace-v2-research-and-rebuild.md §4a, §4b and
-- 2026-04-20 Marco approval of 7a (workspace_conversations), 7b (workspace_id canonicalization).
--
-- This migration ONLY adds new tables and new columns on existing scoped tables.
-- It does NOT drop, rename, or redesign any existing column (per hard rule from the approval turn).

BEGIN;

-- ── 1. Workspaces: promote the BASQUIO_TEAM_ORG_ID constant to a real row ──

CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('team_beta', 'demo_template', 'customer')),
  template_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team', 'shareable_with_token')),
  share_token TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_org_kind
  ON public.workspaces (organization_id, kind);

CREATE INDEX IF NOT EXISTS idx_workspaces_template
  ON public.workspaces (template_id)
  WHERE template_id IS NOT NULL;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages workspaces"
  ON public.workspaces FOR ALL TO service_role USING (true);

-- ── 2. Workspace scopes registry ──

CREATE TABLE IF NOT EXISTS public.workspace_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('client', 'category', 'function', 'system')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  parent_scope_id UUID REFERENCES public.workspace_scopes(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, slug)
);

CREATE INDEX IF NOT EXISTS idx_workspace_scopes_workspace_kind
  ON public.workspace_scopes (workspace_id, kind);

ALTER TABLE public.workspace_scopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages workspace_scopes"
  ON public.workspace_scopes FOR ALL TO service_role USING (true);

-- ── 3. Workspace conversations (multi-turn chat threads, spec 7a) ──

CREATE TABLE IF NOT EXISTS public.workspace_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  workspace_scope_id UUID REFERENCES public.workspace_scopes(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT,
  summary TEXT,
  messages JSONB NOT NULL DEFAULT '[]',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace_scope_updated
  ON public.workspace_conversations (workspace_id, workspace_scope_id, last_message_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_creator
  ON public.workspace_conversations (created_by, last_message_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE public.workspace_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages conversations"
  ON public.workspace_conversations FOR ALL TO service_role USING (true);

-- ── 4. Add workspace_id foreign keys to existing scoped tables ──
-- All columns added as nullable, then backfilled in step 6, then can be enforced
-- NOT NULL in a follow-up migration once the codebase stops relying on the old
-- organization_id path. This staging keeps the V1 code path operational during
-- the transition.

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.transcript_chunks
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.entity_mentions
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.facts
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS workspace_scope_id UUID REFERENCES public.workspace_scopes(id) ON DELETE SET NULL;

ALTER TABLE public.memory_entries
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS workspace_scope_id UUID REFERENCES public.workspace_scopes(id) ON DELETE SET NULL;

ALTER TABLE public.workspace_deliverables
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS workspace_scope_id UUID REFERENCES public.workspace_scopes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.workspace_conversations(id) ON DELETE SET NULL;

-- ── 5. Indexes for the new workspace_id paths ──

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_workspace
  ON public.knowledge_documents (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_workspace
  ON public.knowledge_chunks (workspace_id);

CREATE INDEX IF NOT EXISTS idx_transcript_chunks_workspace
  ON public.transcript_chunks (workspace_id);

CREATE INDEX IF NOT EXISTS idx_entities_workspace_type
  ON public.entities (workspace_id, type);

CREATE INDEX IF NOT EXISTS idx_entity_mentions_workspace
  ON public.entity_mentions (workspace_id);

CREATE INDEX IF NOT EXISTS idx_facts_workspace_scope
  ON public.facts (workspace_id, workspace_scope_id, subject_entity);

CREATE INDEX IF NOT EXISTS idx_memory_entries_workspace_scope
  ON public.memory_entries (workspace_id, workspace_scope_id, memory_type);

CREATE INDEX IF NOT EXISTS idx_deliverables_workspace_scope_created
  ON public.workspace_deliverables (workspace_id, workspace_scope_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deliverables_conversation
  ON public.workspace_deliverables (conversation_id)
  WHERE conversation_id IS NOT NULL;

-- ── 6. Seed the team-beta workspace row + baseline scopes + backfill existing data ──
-- Use BASQUIO_TEAM_ORG_ID (15cc947e-70cb-455a-b0df-d8c34b760d71) as the workspace id
-- so existing organization_id column values equal the new workspace_id values.

INSERT INTO public.workspaces (id, organization_id, name, slug, kind, visibility, metadata)
VALUES (
  '15cc947e-70cb-455a-b0df-d8c34b760d71',
  '15cc947e-70cb-455a-b0df-d8c34b760d71',
  'Basquio team beta',
  'basquio-team-beta',
  'team_beta',
  'team',
  '{"seeded_by": "20260420120000_v2_workspace_tables", "note": "V1 singleton workspace promoted to real row"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- System scopes (every workspace gets workspace + analyst by default)
INSERT INTO public.workspace_scopes (workspace_id, kind, name, slug, metadata)
VALUES
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'system', 'Workspace', 'workspace', '{"seeded": true, "builtin": true}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'system', 'Analyst', 'analyst', '{"seeded": true, "builtin": true}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'client', 'Mulino Bianco', 'mulino-bianco', '{"seeded": true}'::jsonb),
  ('15cc947e-70cb-455a-b0df-d8c34b760d71', 'category', 'Snack Salati', 'snack-salati', '{"seeded": true}'::jsonb)
ON CONFLICT (workspace_id, kind, slug) DO NOTHING;

-- Backfill workspace_id on every existing row that has organization_id.
UPDATE public.knowledge_documents
  SET workspace_id = organization_id
  WHERE workspace_id IS NULL AND organization_id IS NOT NULL;

UPDATE public.knowledge_chunks
  SET workspace_id = organization_id
  WHERE workspace_id IS NULL AND organization_id IS NOT NULL;

UPDATE public.transcript_chunks
  SET workspace_id = organization_id
  WHERE workspace_id IS NULL AND organization_id IS NOT NULL;

UPDATE public.entities
  SET workspace_id = organization_id
  WHERE workspace_id IS NULL AND organization_id IS NOT NULL;

UPDATE public.entity_mentions
  SET workspace_id = organization_id
  WHERE workspace_id IS NULL AND organization_id IS NOT NULL;

UPDATE public.facts
  SET workspace_id = organization_id
  WHERE workspace_id IS NULL AND organization_id IS NOT NULL;

UPDATE public.memory_entries
  SET workspace_id = organization_id
  WHERE workspace_id IS NULL AND organization_id IS NOT NULL;

UPDATE public.workspace_deliverables
  SET workspace_id = organization_id
  WHERE workspace_id IS NULL AND organization_id IS NOT NULL;

-- Backfill workspace_scope_id on memory_entries / facts / workspace_deliverables
-- from the existing free-text scope column. Keeps the scope TEXT column intact;
-- both live side by side during transition (V2 reads scope_id, V1 reads scope).

UPDATE public.memory_entries m
SET workspace_scope_id = s.id
FROM public.workspace_scopes s
WHERE m.workspace_scope_id IS NULL
  AND m.workspace_id = s.workspace_id
  AND (
    (m.scope = 'workspace' AND s.kind = 'system' AND s.slug = 'workspace')
    OR (m.scope = 'analyst' AND s.kind = 'system' AND s.slug = 'analyst')
    OR (m.scope = 'client:Mulino Bianco' AND s.kind = 'client' AND s.slug = 'mulino-bianco')
    OR (m.scope = 'category:Snack Salati' AND s.kind = 'category' AND s.slug = 'snack-salati')
  );

UPDATE public.workspace_deliverables d
SET workspace_scope_id = s.id
FROM public.workspace_scopes s
WHERE d.workspace_scope_id IS NULL
  AND d.workspace_id = s.workspace_id
  AND (
    (d.scope = 'workspace' AND s.kind = 'system' AND s.slug = 'workspace')
    OR (d.scope = 'analyst' AND s.kind = 'system' AND s.slug = 'analyst')
    OR (d.scope = 'client:Mulino Bianco' AND s.kind = 'client' AND s.slug = 'mulino-bianco')
    OR (d.scope = 'category:Snack Salati' AND s.kind = 'category' AND s.slug = 'snack-salati')
  );

-- ── 7. Touch trigger for updated_at on workspaces and conversations ──

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workspaces_touch ON public.workspaces;
CREATE TRIGGER trg_workspaces_touch
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_conversations_touch ON public.workspace_conversations;
CREATE TRIGGER trg_conversations_touch
  BEFORE UPDATE ON public.workspace_conversations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
