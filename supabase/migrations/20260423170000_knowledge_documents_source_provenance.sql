-- Provenance columns on knowledge_documents: kind enum plus source-catalog
-- foreign keys for scraped articles.
--
-- Per docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md §2.2,
-- §3.4, and §5.3. The spec assumes a `kind` column exists on
-- knowledge_documents; this migration adds it.
--
-- `kind` values:
--   'uploaded_file':   the existing upload flow (backfill default)
--   'scraped_article': research-layer dual-write (§5.3)
--   'chat_paste':      saveFromPaste chat tool (§6.1)
--   'chat_url':        scrapeUrl chat tool (§6.2)
--
-- Delete behavior rationale (§3.4 of the spec): ON DELETE SET NULL on
-- source_catalog_id means deleting a source_catalog entry does NOT delete
-- the historical knowledge derived from it. A source may be sunset for
-- business reasons but the facts, entities, and chunks extracted from its
-- articles remain valid workspace assets. CASCADE would silently destroy
-- compounding workspace value.

BEGIN;

-- ── 1. Add the kind column with a safe backfill default ──

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'uploaded_file'
    CHECK (kind IN ('uploaded_file','scraped_article','chat_paste','chat_url'));

-- ── 2. Add source provenance columns (NULL for non-scraped rows) ──

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS source_catalog_id UUID
    REFERENCES public.source_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_trust_score INT;

-- ── 3. Indexes ──

CREATE INDEX IF NOT EXISTS knowledge_documents_source_catalog_idx
  ON public.knowledge_documents (source_catalog_id)
  WHERE source_catalog_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_documents_kind_idx
  ON public.knowledge_documents (workspace_id, kind);

COMMIT;
