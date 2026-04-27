---
title: Memory v1 Brief 3 substrate audit
date: 2026-04-27
parent: 2026-04-25-codex-handoff-briefs.md (Brief 3)
spec: 2026-04-25-sota-implementation-specs.md §4
status: pre-implementation, blockers resolved with Marco
---

# Brief 3 substrate audit

## State at session start

- HEAD: `9da378a` (Brief 2 Phase 9 verified). Status clean (untracked .DS_Store + new docs only).
- Production: basquio.com responds 200. Brief 1 + 2 migrations applied to `fxvbvkpzzvrkwvqmecmi` (`20260428100000` through `20260428130000`). `brand_guideline` table exists, currently zero rows.
- `queryBrandRuleTool` at apps/web/src/lib/workspace/agent-tools-typed.ts:149 already reads `brand_guideline` and returns empty gracefully today.
- Skills contract test `scripts/test-anthropic-skills-contract.ts` present and runnable.
- Fixture: `fixtures/brand-books/spotify.pdf` (5 MB, 21 pages) copied from Marco's Downloads. Gitignored via `fixtures/brand-books/*.pdf`. Smoke acceptance gates target rule counts and source-page coverage, not page count.

## Three path corrections (approved by Marco)

1. **Inngest function path → worker post-ingest extension (Option C).** `apps/web/src/app/api/inngest/route.ts` returns HTTP 410 (retired). Brand extraction wires into `processWorkspaceDocument` after the chunk + embed phase finishes: when `document.kind === 'brand_book'` and `BRAND_EXTRACTION_ENABLED=true`, the same Railway worker tick calls `runBrandGuidelineExtraction`. Both `searchEvidence` (chunks) and `queryBrandRule` (typed rules) light up.
2. **Kind gating file → `apps/web/src/app/api/workspace/uploads/confirm/route.ts`.** The `agent-tools-ingest.ts` `kind` parameter is a storage-path prefix (`chat_paste | chat_url`), not the `knowledge_documents.kind` enum. The actual enum (CHECK constraint set in `20260423170000_knowledge_documents_source_provenance.sql`) currently lists `uploaded_file | scraped_article | chat_paste | chat_url`; I'm extending it to include `brand_book`.
3. **Persist via SECURITY DEFINER RPC, not `withActor`.** Per Brief 1 pivot. Spec §4's example uses `withActor`; the brief's explicit instruction overrides the spec. The RPC sets `app.actor` inside the function body so the `audit_memory_change` trigger sees the caller in the same transaction.

## Schema notes

- `brand_guideline.colour` column is `JSONB DEFAULT '{}'` (object), but the BAML `BrandGuidelineExtraction.colour` is `ColourEntry[]` (array). JSONB accepts arrays, so persist works as-is. Future migration could update the DEFAULT to `'[]'`; not Brief 3 scope.
- `extraction_method` CHECK accepts `'baml'`, matching our pipeline.
- `UNIQUE (workspace_id, brand, version)` enforced. The pipeline assumes the caller passes a unique version (timestamp or hash); first-version logic lives in the worker call site.

## Migration shape (Marco picked B, two files)

- `20260428140000_brand_extraction_rpc.sql`: `persist_brand_guideline(workspace_id, brand, version, source_document_id, brand_entity_id, extracted_facets jsonb, extraction_confidence, actor_text)` SECURITY DEFINER, `SET search_path = ''`. Sets `app.actor` then INSERT INTO brand_guideline RETURNING id.
- `20260428141000_knowledge_documents_brand_book_kind.sql`: ALTER TABLE knowledge_documents DROP CHECK + ADD CHECK with `'brand_book'` appended.

## Push budget (Marco update)

5 commits max:
1. Implementation behind `BRAND_EXTRACTION_ENABLED=false`
2. Reserved for self-caught regression
3. Flag flip after Phase 9 production verification
4. Reserved for one Phase 9 production-ops fix
5. Shipped docs + canonical-memory promotion

Pre-push diff self-review mandatory at every push.

## Fixture caveat

Spotify guide is 21 pages, not the 100+ the spec targets. Per Marco: rule counts and source-page coverage are the binding gates, not page count. If Spotify produces fewer than 5 tone / 8 typography / 12 colour rules, the BAML prompt needs work, not the fixture.

## Hard stops carried forward (from brief)

- Commits > 5
- BRAND_EXTRACTION_ENABLED true before Phase 7b smoke verifies
- Extraction triggered on non-brand_book document
- Any extracted rule with null source_page
- Persist using `withActor` instead of SECURITY DEFINER RPC
- Any change to deck pipeline files (anthropic-execution-contract.ts, system-prompt.ts, cost-guard.ts, generate-deck.ts)
- BASQUIO_NIQ_GUARD_OVERRIDE used
- `--no-verify` used
- Live extraction smoke cost > $7
- Validation phase confidence < 0.7 on Spotify (prompt has a bug)
