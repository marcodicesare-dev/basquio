---
name: basquio-brand-extraction
description: >
  Use when adding or tuning the brand-guideline extraction pipeline that
  populates public.brand_guideline. Covers the BAML schema, the
  Sonnet 4.6 extract + Haiku 4.5 validate prompts, the 0.7 confidence
  floor, and the SECURITY DEFINER persist contract from Brief 1.
---

# Basquio brand-guideline extraction

## Goal

Take a brand-book PDF (kind=brand_book) and produce a typed, source-cited
brand_guideline row that queryBrandRuleTool reads to keep the chat agent
on-brand.

## Pipeline

Three discrete phases. They are separate by design; do not collapse.

1. **Extract** with `b.ExtractBrandGuideline(pdf_text, page_count)`
   on Sonnet 4.6. Produces `BrandGuidelineExtraction` with typed
   typography / colour / tone / imagery / forbidden / language_preferences /
   layout / logo facets and a self-reported `extraction_confidence`.
2. **Validate** with `b.ValidateBrandGuideline(extraction)` on Haiku 4.5.
   Produces `{ confidence, reason, issues }`. If `confidence < 0.7`, the
   pipeline rejects (memory_workflow_runs status='failure'). Hard-fail
   checks: every rule has source_page >= 1, every tone rule has do +
   dont, hex is 6-char uppercase, weight is 100..900, brand and version
   non-empty.
3. **Persist** via SECURITY DEFINER RPC `public.persist_brand_guideline`.
   The RPC sets `app.actor` inside its body so the audit_memory_change
   trigger writes a memory_audit row with the right actor in the same
   transaction. NEVER use withActor for this phase (Brief 1 pivot:
   PostgREST connection pooling does not carry session-local config
   across separate .rpc() calls).

## Acceptance gates (carried from spec §4)

A clean extraction on a real brand book (Kempinski / Spotify / Lavazza
class) hits ALL of these:

1. >= 5 tone rules, >= 8 typography rules, >= 12 colour entries.
2. Zero rules with `source_page = null` or `source_page = 0`.
3. No PII in the BAML output (no free-text user names; only structured
   `voice_attribute`, `do_examples`, etc.).
4. Cost < $5 for a 300-page PDF on Sonnet 4.6.
5. A deliberately corrupted PDF produces `status='failure'` with
   `validation.confidence < 0.7` and zero brand_guideline rows.

## Required reads

1. `packages/workflows/baml_src/brand_guideline.baml`: the typed schema +
   prompts. Bump `BRAND_EXTRACTION_PROMPT_VERSION` in
   `packages/workflows/src/workspace/brand-extraction.ts` when the prompt
   changes.
2. `packages/workflows/src/workspace/brand-extraction.ts`: the
   three-phase pipeline + cost model.
3. `supabase/migrations/20260428140000_brand_extraction_rpc.sql`: the
   canonical SECURITY DEFINER persist pattern.
4. `supabase/migrations/20260428120000_memory_audit_log.sql`: the audit
   trigger contract.
5. `docs/research/2026-04-25-sota-implementation-specs.md` §4.

## Hard rules

- Brand-guideline extraction runs ONLY when `document.kind === 'brand_book'`.
  Other PDFs use the regular passage-memory path (chunk + embed only).
- Behind `BRAND_EXTRACTION_ENABLED` flag. Default false.
- Confidence floor is 0.7. Do not lower without forensic evidence and an
  updated SKILL.md that explains the new bar.
- Source page on every typed rule. Non-negotiable per spec §4.
- Validation phase uses Haiku 4.5, not Sonnet (cost). The validator
  catches the kind of mistakes Sonnet 4.6 makes; using the same model
  twice gets you a more confident wrong answer.

## Cost / latency budget

- 100-300 page PDF: ~$3-5 in Sonnet + Haiku tokens, ~60-120 seconds
  inside the file-ingest Railway worker (no Vercel timeout pressure).
- Above $5 on a single PDF means the prompt or input size is wrong;
  investigate before raising the budget.

## Workflow

1. New brand book uploaded with kind=brand_book.
2. File-ingest runs first (chunks + embeds for hybrid search).
3. After ingest succeeds, processWorkspaceDocument calls
   runBrandGuidelineExtraction. Failure does not roll back ingest.
4. queryBrandRuleTool returns the typed rules on the next chat turn
   that classifies as `intent='rule'`.
