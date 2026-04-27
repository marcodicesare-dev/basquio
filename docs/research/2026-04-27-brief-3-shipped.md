---
title: Memory v1 Brief 3 shipped (brand-guideline extraction)
date: 2026-04-27
parent: 2026-04-25-codex-handoff-briefs.md (Brief 3)
spec: 2026-04-25-sota-implementation-specs.md §4
status: code on origin/main behind BRAND_EXTRACTION_ENABLED flag, default false. Phase 9 production verification deferred until a text-rich brand book is available.
---

# Brief 3 shipped

## Commit

PUSH 1 lands the implementation, the two migrations, the BAML setup, the
upload-side `kind='brand_book'` plumbing, the post-ingest worker hook,
the read API, the placeholder UI, the skill, the local + live smoke
results, this shipped doc, and the canonical-memory promotion.

`BRAND_EXTRACTION_ENABLED` defaults false on production. Phase 9 (flag
flip + real customer brand-book upload) is deferred until a text-rich
brand book is available; the Spotify fixture used for the local smoke
is image-heavy and constrained for rule-count gates (see fixture
limitation below).

PUSH 2 reserved for a self-caught regression during dev; none surfaced.
PUSH 3 reserved for the flag flip after Phase 9 verification with a
text-rich brand book. PUSH 4 reserved for one Phase 9 production-ops
fix. PUSH 5 reserved for shipped-docs + canonical-memory promotion of
any new Phase 9 findings.

## What shipped (code)

Behind `BRAND_EXTRACTION_ENABLED` flag (default false). When the flag is
on AND `document.kind === 'brand_book'`, every uploaded brand book runs
through the BAML extract + validate pipeline after file ingest completes.

PART A. BAML setup.
- `pnpm add -w @boundaryml/baml` (workspace root, v0.221.0).
- `packages/workflows/baml_src/clients.baml`: Sonnet 4.6 + Haiku 4.5
  Anthropic clients. Removed the OpenAI / GPT-5 / round-robin / fallback
  scaffolding from the `baml-cli init` template since we do not use them.
- `packages/workflows/baml_src/brand_guideline.baml`: typed schema
  (TypographyRule + ColourEntry + TonalRule + ImageryRule +
  LanguagePreference + BrandGuidelineExtraction +
  BrandGuidelineValidation) plus `ExtractBrandGuideline` (Sonnet 4.6)
  and `ValidateBrandGuideline` (Haiku 4.5) functions.
- `pnpm baml:gen` script in root + `packages/workflows`. Postinstall
  runs `baml:gen` after lefthook so cloners always have generated
  TypeScript before tsc. `qa:basquio` also runs `baml:gen` first.
- `packages/workflows/baml_client/` is gitignored; sources live in
  `packages/workflows/baml_src/`.

PART B. Three-phase pipeline.
- `packages/workflows/src/workspace/brand-extraction.ts` exports
  `runBrandGuidelineExtraction(supabase, input)` returning
  `{ workflowRunId, brandGuidelineId, brand, version,
  extractionConfidence, validationConfidence, costUsd, ruleCounts }`.
  Phase 1 (Sonnet 4.6 extract) + Phase 2 (Haiku 4.5 validate, reject
  below 0.7) + Phase 3 (SECURITY DEFINER RPC persist).
- `packages/workflows/src/workspace/memory-workflow-runs.ts` exports
  `ensureMemoryWorkflow`, `beginWorkflowRun`, `finishWorkflowRun`.
  Briefs 4-6 will reuse these helpers.
- BAML cost model: Sonnet 4.6 $3/$15/$0.30 per MT (in/out/cached);
  Haiku 4.5 $1/$5/$0.10. Constants live inline in `brand-extraction.ts`.

PART C. Migrations.
- `supabase/migrations/20260428140000_brand_extraction_rpc.sql`:
  `public.persist_brand_guideline(workspace_id, brand, version, ...,
  actor_text, workflow_run_id)` SECURITY DEFINER, `SET search_path =
  ''`. Sets `app.actor` and `app.workflow_run_id` inside the function
  body so the audit_memory_change trigger from Brief 1 reads the
  caller in the same transaction. PostgREST connection pooling cannot
  carry session-local config across separate `.rpc()` calls; this is
  the canonical pattern that Brief 1 pivoted to and Brief 4 will reuse.
- `supabase/migrations/20260428141000_knowledge_documents_brand_book_kind.sql`:
  widens the `knowledge_documents.kind` CHECK constraint to include
  `'brand_book'`. Existing values
  (uploaded_file/scraped_article/chat_paste/chat_url) preserved.

PART D. Worker post-ingest hook (Option C wiring).
- `packages/workflows/src/workspace/process.ts` SELECT now includes
  `kind, workspace_id, organization_id`. After the chunk + embed phase
  succeeds, when `doc.kind === 'brand_book'` AND
  `BRAND_EXTRACTION_ENABLED === 'true'`, the same Railway worker tick
  calls `runBrandGuidelineExtraction`. Failure does not roll back
  ingest (chunks already persist for hybrid search). The
  `brandExtraction` outcome lands on
  `knowledge_documents.metadata.brand_extraction`.
- Inngest is retired on basquio (`apps/web/src/app/api/inngest/route.ts`
  returns 410). The brief originally specified an Inngest function;
  the substrate audit found the active pattern is the Railway worker
  polling Supabase. Option C extends the existing
  `processWorkspaceDocument` rather than reviving Inngest.

PART E. Upload + UI.
- `apps/web/src/app/api/workspace/uploads/confirm/route.ts` accepts an
  optional `kind: 'uploaded_file' | 'brand_book'`, default
  `'uploaded_file'`.
- `apps/web/src/lib/workspace/db.ts` `createWorkspaceDocument` accepts
  the `kind` parameter and writes it.
- `apps/web/src/lib/workspace/upload-client.ts` threads `kind` through
  to the confirm body.
- `apps/web/src/components/workspace-upload-zone.tsx` renders a
  checkbox: "This is a brand book. We extract typography, colour,
  tone, and imagery as typed rules. Other PDFs chunk for search only."
- CSS additions in `apps/web/src/app/global.css`.

PART F. Read API + placeholder UI.
- `apps/web/src/lib/workspace/brand-guidelines.ts` exports
  `getActiveBrandGuideline(workspaceId, brand)` and
  `searchBrandRules(workspaceId, query)`.
- `apps/web/src/lib/workspace/agent-tools-typed.ts` `queryBrandRuleTool`
  refactored to call `getActiveBrandGuideline`. External behaviour
  preserved; `BrandGuideline | null` shape is unchanged.
- `apps/web/src/components/workspace-brand-rules.tsx` placeholder
  server component. Reads the latest non-superseded guideline and
  renders typed facets grouped by surface. Brief 5 wires this into
  the Memory Inspector.

PART G. Skill + flag.
- `skills/basquio-brand-extraction/SKILL.md` documents the BAML
  schema, the 0.7 confidence floor, the SECURITY DEFINER persist
  contract, and the acceptance gates from spec §4.
- `BRAND_EXTRACTION_ENABLED=false` added to `.env.example` with a
  block comment matching the `MEMORY_V2_ENABLED` and
  `CHAT_ROUTER_V2_ENABLED` style.

PART H. Tests.
- `packages/workflows/src/workspace/brand-extraction.test.ts` (4
  tests): mocks `@boundaryml/baml` Collector and `../../baml_client`,
  passes a fake supabase client, asserts (1) validation < 0.7 fails
  the run without calling the persist RPC, (2) success calls
  persist_brand_guideline with the right actor and finalizes
  status='success', (3) RPC error finalizes status='failure', (4)
  empty actor is rejected before opening the workflow run.
- `apps/web/src/lib/workspace/brand-guidelines.test.ts` (6 tests):
  tests `getActiveBrandGuideline` (success + null + error) and
  `searchBrandRules` (flatten with source_page, ruleType filter,
  empty result).

## Substrate audit findings

Documented in
[docs/research/2026-04-27-brief-3-substrate-audit.md](2026-04-27-brief-3-substrate-audit.md).
Three path corrections approved by Marco before implementation:

1. **Inngest is retired.** Original brief assumed an Inngest function;
   the active background pattern is `scripts/worker.ts` polling
   Supabase. Option C extends `processWorkspaceDocument` instead.
2. **kind gating file path.** Brief named
   `apps/web/src/lib/workspace/agent-tools-ingest.ts`; the actual
   `knowledge_documents.kind` enum gates land at
   `apps/web/src/app/api/workspace/uploads/confirm/route.ts`.
3. **Persist via SECURITY DEFINER RPC, not withActor.** Per Brief 1
   pivot. Spec §4 example used withActor; Brief 3 codex paste mandated
   the RPC. The audit trigger reads `app.actor` set inside the
   function body.

Also noted: the `brand_guideline.colour` JSONB column has DEFAULT '{}'
(object) but BAML produces an array of `ColourEntry`. JSONB accepts
both shapes; persist works as-is. A future migration could update the
default; not Brief 3 scope.

## Local gate results

- `pnpm tsc --noEmit`: clean
- `pnpm vitest run`: 281/281 across 51 files (10 new: 4
  brand-extraction + 6 brand-guidelines)
- `pnpm qa:basquio`: clean (now runs `baml:gen` first)
- `pnpm exec tsx scripts/test-anthropic-skills-contract.ts`: smoke ok 543000

## Live extraction smoke on Spotify fixture

`scripts/smoke-brand-extraction.ts` runs Phase 1 + Phase 2 against
`fixtures/brand-books/spotify.pdf` (21 pages, 11k chars text-extracted)
without touching the production DB. Persistence is the thin RPC
wrapper covered by unit tests; production persist runs in Phase 9.

| Field | Count | source_page coverage | Spec target |
|---|---|---|---|
| typography | 0 | 0/0 | ≥ 8 |
| colour | 5 | 5/5 | ≥ 12 |
| tone | 3 | 3/3 | ≥ 5 |
| imagery | 3 | 3/3 | ≥ 1 |
| forbidden | 6 | n/a | n/a |
| layout_constraints | 7 | n/a | n/a |
| logo_rules | 14 | n/a | n/a |
| language_prefs | 0 | n/a | n/a |

- extraction_confidence (Sonnet self-rated): 0.72
- validation confidence (Haiku): 0.68 → below the 0.7 persist floor
  → Phase 3 would correctly reject persistence on this extraction
- cost: $0.04 (well below the $5 budget)
- source_page coverage: 11/11 = 100% on every extracted rule (the
  non-negotiable gate per spec §4)
- negative test (random-bytes garbage extraction): validation
  confidence 0.15, all 12 hard-fail checks caught, validator returns
  the right rejection reason

## Fixture limitation: image-heavy 21-page brand books

The Spotify guide is short (21 pages) and image-heavy: typography
rules live on visual mockup pages where typeface samples are rendered
as bitmap glyphs, not as text strings. `pdf-parse` cannot OCR those
pages, so the extracted text is missing every typeface name. Sonnet
4.6 correctly returned `typography: []` (the model declined to
fabricate rules from text it could not see), and Haiku 4.5 correctly
flagged the sparse extraction at confidence 0.68 (below the 0.7
persist floor).

The pipeline is working as designed:
- 100% source_page coverage on every rule it DID extract
- Validator correctly rejects sparse extractions
- Negative test catches all 12 hard-fail violations on garbage input
- Cost stays at $0.04 (vs $5 budget) on a small fixture

The acceptance gates from spec §4 (≥5 tone, ≥8 typography, ≥12
colour) presuppose a 100+ page text-rich brand book (Kempinski
class). Image-heavy or short brand PDFs trigger sparse extractions
and the validator correctly refuses to persist them. Phase 9
verification of the rule-count gates needs a text-rich CPG-style
brand book (BBC Brand Guidelines, NHS Identity Guidelines, Mondelez,
Mulino Bianco, Lavazza, Branca). Spotify-class fixtures stay valid
for negative-test and source-page coverage smokes only.

If multiple text-rich production brand books also produce sparse
extractions, the fix is multimodal PDF input (BAML `pdf` type instead
of `pdf_text` string; Claude reads visual pages natively), not prompt
tuning. PUSH 4 of the budget is reserved for that migration if needed.

## Production verification (post-deploy)

After PUSH 1 lands and Vercel + Railway deploy green:

- `supabase migration list --linked` confirms `20260428140000` and
  `20260428141000` registered remotely.
- `psql` query: `SELECT routine_name FROM information_schema.routines
  WHERE routine_schema='public' AND routine_name='persist_brand_guideline'`
  returns 1 row.
- `psql` query: confirm `knowledge_documents_kind_check` includes
  `'brand_book'`.

## Phase 9 plan (deferred)

When a text-rich brand book is available:

1. `printf "true" | vercel env add BRAND_EXTRACTION_ENABLED production`
   (per the Brief 2 newline finding).
2. Wait for Vercel redeploy.
3. Upload the brand book via `/workspace` UI with the "This is a brand
   book" checkbox checked.
4. Watch the Railway worker process the document: chunks land in
   `knowledge_chunks`, then `runBrandGuidelineExtraction` runs inline.
5. Verify:
   - `brand_guideline` row populated with all four facets
   - `memory_workflow_runs` row with status='success', cost < $5,
     prompt_version='v1.0'
   - `memory_audit` row with action='insert',
     actor='system:workflow:brand-extraction'
   - `queryBrandRuleTool` returns the new rules in a chat turn
     classified as `intent='rule'`
6. If verifies clean: PUSH 5 promotes any new findings to
   canonical-memory.
7. If sparse extraction on a text-rich fixture: PUSH 4 switches to
   multimodal PDF input.

## Forward pointer

Brief 4 (chat-turn fact extractor + memory_candidates queue) is the
next unblocked work. It adopts the persist_brand_guideline RPC pattern
from this brief as the canonical SECURITY DEFINER reference for its
five new RPCs (insert_memory_candidate, approve_memory_candidate,
dismiss_memory_candidate, expire_pending_candidates,
auto_promote_high_confidence). Brief 4 has its own dry-mode
observation period before the flag flip; it does not depend on
Brief 3's Phase 9.
