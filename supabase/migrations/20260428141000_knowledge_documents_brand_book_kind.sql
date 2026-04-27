-- =====================================================
-- knowledge_documents.kind: add 'brand_book' (Memory v1 Brief 3)
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §4
-- Brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 3)
--
-- Brief 3 brand-guideline extraction runs ONLY when document.kind ===
-- 'brand_book'. Every other PDF goes through the regular passage-memory
-- path (chunking + embedding into knowledge_chunks for hybrid search).
-- This migration widens the existing kind CHECK constraint to include
-- the new 'brand_book' value alongside the four set in
-- 20260423170000_knowledge_documents_source_provenance.sql:
--   uploaded_file, scraped_article, chat_paste, chat_url
-- =====================================================

BEGIN;

ALTER TABLE public.knowledge_documents
  DROP CONSTRAINT IF EXISTS knowledge_documents_kind_check;

ALTER TABLE public.knowledge_documents
  ADD CONSTRAINT knowledge_documents_kind_check
  CHECK (kind IN (
    'uploaded_file',
    'scraped_article',
    'chat_paste',
    'chat_url',
    'brand_book'
  ));

COMMIT;

-- =====================================================
-- DOWN (manual reversal, not a separate migration file)
-- =====================================================
-- ALTER TABLE public.knowledge_documents
--   DROP CONSTRAINT IF EXISTS knowledge_documents_kind_check;
-- ALTER TABLE public.knowledge_documents
--   ADD CONSTRAINT knowledge_documents_kind_check
--   CHECK (kind IN ('uploaded_file','scraped_article','chat_paste','chat_url'));
