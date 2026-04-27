# Changelog

Material production events for the Basquio stack. Newest first. Links use git SHAs from `origin/main`.

For full forensic detail on the April 2026 disaster arc and the operational rules it produced, read `memory/april-2026-disaster-arc-forensic.md`.

## 2026-04-27, Memory v1 Brief 4 PUSH 1 (chat-turn fact extractor + candidates queue)

Behind `CHAT_EXTRACTOR_ENABLED` flag (default false, DRY MODE). Code shipped + two migrations + chat route hook + candidates API + UI placeholder + tests + 40-turn live eval. Phase 8 (24-48h dry-mode observation on real production traffic) is the load-bearing gate before PUSH 3 flips the flag.

PART A. Migrations.

- `20260505100000_memory_candidates.sql` adds the `public.memory_candidates` table: kind CHECK (fact, rule, preference, alias, entity), confidence NUMERIC(4,3), status CHECK (pending, approved, dismissed, expired), expires_at default NOW() + 14 days, three indices including `idx_memory_candidates_workspace_pending` partial on status='pending'. Member-scoped RLS reads via `is_workspace_member`.
- `20260505110000_memory_candidates_rpcs.sql` adds 5 SECURITY DEFINER RPCs following the persist_brand_guideline pattern from Brief 3: `insert_memory_candidate`, `approve_memory_candidate`, `dismiss_memory_candidate`, `expire_pending_candidates`, `auto_promote_high_confidence`, plus the internal helper `write_durable_memory_from_candidate` shared by approve and auto-promote. Each function sets `app.actor` and `app.workflow_run_id` inside its body so the audit_memory_change trigger from Brief 1 attributes the caller in the same transaction. The migration also schedules a pg_cron job at 04:00 UTC for `expire_pending_candidates`, guarded by `IF EXISTS pg_extension`; if pg_cron is not enabled on the project the schedule is skipped with a NOTICE and the RPC works manually.

PART B. Chat-extraction module. `packages/workflows/src/workspace/chat-extraction.ts` exports `extractCandidatesFromTurn(supabase, input)` (the full pipeline with DB writes + telemetry) and `extractCandidatesLLM(input)` (pure LLM call for the eval script). Confidence gates per spec §7: `< 0.6` dropped silently, `0.6 <= confidence <= 0.8` inserted as pending, `> 0.8` auto-promoted via `auto_promote_high_confidence` RPC ONLY when CHAT_EXTRACTOR_ENABLED=true (DRY MODE keeps everything pending). Auto-promote dispatches by kind: facts (kind='fact'), workspace_rule (kind='rule'), memory_entries (kind='preference'). Kinds 'alias' and 'entity' stage in memory_entries with `metadata.deferred_kind` until Brief 5 ships entity-resolution. Telemetry per run on `memory_workflow_runs` with prompt_version='v1.0', skill_version='1.0.0', metadata.flag_state.

PART C. Chat-route post-turn hook. `apps/web/src/app/api/workspace/chat/route.ts` v2 onFinish callback calls `after(extractCandidatesFromTurn(...))` from "next/server". Vercel keeps the function alive past the streaming response while extraction completes; chat-turn latency is unchanged. The brief originally specified an Inngest function path; Inngest is retired on basquio (`/api/inngest/route.ts` returns 410), so Next.js `after()` is the canonical post-response hook (already used by `/api/workspace/uploads/confirm`). The v1 chat path (CHAT_ROUTER_V2_ENABLED=false) is byte-identical to today.

PART D. Candidates API + UI placeholder. New `apps/web/src/lib/workspace/candidates.ts` (server actions: listPendingCandidates, approveCandidate, dismissCandidate, expirePendingCandidates), `apps/web/src/app/api/workspace/candidates/route.ts` GET, `apps/web/src/app/api/workspace/candidates/[id]/approve/route.ts` POST, `apps/web/src/app/api/workspace/candidates/[id]/dismiss/route.ts` POST. `apps/web/src/components/workspace-candidate-queue.tsx` placeholder client component wired into `/workspace/memory` above the MemoryBrowser. Brief 5 promotes this into the full Memory Inspector v2.

PART E. Skill + flag. `packages/workflows/src/workspace/prompts/chat-fact-extraction.md` is the canonical Mem0 V3 ADD-only prompt (mirrored as a TypeScript const for portability across the Next.js bundle and Node worker). `CHAT_EXTRACTOR_ENABLED=false` added to `.env.example` with the dry-mode rationale documented inline.

Local gates green: `pnpm tsc --noEmit`, `pnpm vitest run` 295/295 across 53 files (14 new: 7 chat-extraction + 7 candidates), `pnpm qa:basquio`, `scripts/test-anthropic-skills-contract.ts` smoke ok. 40-turn live eval against the labeled fixture returned auto-promote precision 96.2% (PASS, target >= 95%), false-positive rate 0.59 per 10 turns (1 borderline FP on a possessive-brand turn; documented), 100% kind coverage, $0.093 total cost.

The 40-turn fixture is a sanity-check, not the gate. The canonical gate is 24-48h of dry-mode observation on real team-beta traffic, where statistical confidence emerges naturally and label disagreements dissolve into "is the candidate useful when surfaced for review" rather than "does it match an a-priori label". Phase 8 dry-mode observation is non-negotiable and Marco runs it.

Forward: Brief 5 (Memory Inspector v2 + procedural rule injection + anticipation hints) is the next unblocked work after Brief 4 dry-mode observation closes; ships on a fresh agent session. Spec: `docs/research/2026-04-25-sota-implementation-specs.md` §7. Shipped report: `docs/research/2026-04-27-brief-4-shipped.md`.

## 2026-04-27, Memory v1 Brief 3 PUSH 1 (brand-guideline extraction)

Behind `BRAND_EXTRACTION_ENABLED` flag (default false on Vercel). Code shipped + two migrations + BAML setup + tests. Phase 9 (flag flip + production verification) deferred until a text-rich brand book is available; the Spotify fixture is image-heavy and constrained for the rule-count gates from spec §4.

PART A. BAML 0.221.0 added at workspace root (`pnpm add -w @boundaryml/baml`). Sources at `packages/workflows/baml_src/clients.baml` (Sonnet 4.6 + Haiku 4.5 Anthropic clients) and `packages/workflows/baml_src/brand_guideline.baml` (typed schema + ExtractBrandGuideline + ValidateBrandGuideline functions). Generated TypeScript client at `packages/workflows/baml_client/` (gitignored). Postinstall and `qa:basquio` both run `pnpm baml:gen` so cloners always have a generated client before `tsc`.

PART B. Three-phase pipeline at `packages/workflows/src/workspace/brand-extraction.ts`: Sonnet 4.6 extract → Haiku 4.5 validate (reject below 0.7) → SECURITY DEFINER persist. Wraps the run in `beginWorkflowRun` / `finishWorkflowRun` (new helper at `packages/workflows/src/workspace/memory-workflow-runs.ts`, reused by Briefs 4-6) for memory_workflow_runs telemetry. Cost model: Sonnet 4.6 $3/$15/$0.30 in/out/cached, Haiku 4.5 $1/$5/$0.10.

PART C. Migrations.

- `20260428140000_brand_extraction_rpc.sql` adds `public.persist_brand_guideline(workspace_id, brand, version, ..., actor_text, workflow_run_id)` SECURITY DEFINER, `SET search_path = ''`. Sets `app.actor` and `app.workflow_run_id` inside the function body so the audit_memory_change trigger from Brief 1 reads the caller in the same transaction. PostgREST connection pooling cannot carry session-local config across separate `.rpc()` calls; this RPC is the canonical pattern that Brief 4 and beyond reuse.
- `20260428141000_knowledge_documents_brand_book_kind.sql` widens the `knowledge_documents.kind` CHECK constraint to include `brand_book`.

PART D. Worker post-ingest hook (Option C wiring). Inngest is retired on basquio (`apps/web/src/app/api/inngest/route.ts` returns 410). The brief originally specified an Inngest function; the substrate audit found the active background pattern is the Railway worker polling Supabase. `processWorkspaceDocument` now SELECTs `kind` and runs `runBrandGuidelineExtraction` post-chunking when `kind === 'brand_book'` and the flag is on. Failure does not roll back ingest (chunks already persist for hybrid search).

PART E. Upload + UI. The `/api/workspace/uploads/confirm` route accepts an optional `kind: 'uploaded_file' | 'brand_book'`. `WorkspaceUploadZone` renders a checkbox: "This is a brand book. We extract typography, colour, tone, and imagery as typed rules. Other PDFs chunk for search only." Threading via `apps/web/src/lib/workspace/upload-client.ts` and `createWorkspaceDocument`.

PART F. Read API + placeholder UI. New `apps/web/src/lib/workspace/brand-guidelines.ts` exports `getActiveBrandGuideline(workspaceId, brand)` and `searchBrandRules(workspaceId, query)`. `queryBrandRuleTool` from Brief 2 refactored to call `getActiveBrandGuideline`; external behaviour preserved. `apps/web/src/components/workspace-brand-rules.tsx` server component renders extracted rules grouped by surface; Brief 5 wires it into the Memory Inspector.

PART G. Skill + flag. `skills/basquio-brand-extraction/SKILL.md` documents the BAML schema, the 0.7 confidence floor, the SECURITY DEFINER persist contract, and the spec §4 acceptance gates. `BRAND_EXTRACTION_ENABLED=false` added to `.env.example`.

Local gates green: `pnpm tsc --noEmit`, `pnpm vitest run` 281/281 across 51 files (10 new: 4 brand-extraction + 6 brand-guidelines), `pnpm qa:basquio`, `scripts/test-anthropic-skills-contract.ts` smoke ok. Live extraction smoke against `fixtures/brand-books/spotify.pdf` (21 pages, 11k chars text-extracted) returned 0 typography / 5 colour / 3 tone / 3 imagery rules with 100% source_page coverage on every extracted rule, validation confidence 0.68 (correctly below the 0.7 persist floor, sparse extraction rejected), negative test confidence 0.15 catching all 12 hard-fail violations, total cost $0.04. Spotify is image-heavy (visual typography mockups that pdf-parse cannot OCR); the validator did its job. Phase 9 verification of the rule-count gates needs a text-rich CPG-style brand book.

Forward: Brief 4 (chat-turn fact extractor + memory_candidates queue) lights up the compounding engine; reuses the persist_brand_guideline RPC pattern from this brief. Spec: `docs/research/2026-04-25-sota-implementation-specs.md` §4. Shipped report: `docs/research/2026-04-27-brief-3-shipped.md`. Substrate audit: `docs/research/2026-04-27-brief-3-substrate-audit.md`.

## 2026-04-27, Memory v1 Brief 2 on `ad0ee2b` (chat caching + router + 4 typed tools)

Behind `CHAT_ROUTER_V2_ENABLED` flag (default false on Vercel). Code shipped, schema migration applied, flag flip pending operator action.

- `9006c22` Memory v1 Brief 2: chat caching + router + 4 typed tools (PUSH 1)
- `ad0ee2b` chat route: keep flag-OFF tool catalogue byte-identical to pre-Brief-2 (PUSH 2)

PART A. Three cached system blocks via `@ai-sdk/anthropic` `providerOptions.anthropic.cacheControl`: `STATIC_SYSTEM_PROMPT` at 1h ephemeral, workspace brand pack at 5m, scope context pack at 5m. `apps/web/src/lib/workspace/build-context-pack.ts` split into `buildWorkspaceBrandPack` and `buildScopeContextPack`, both pure functions of stable workspace and scope state.

PART B. Haiku 4.5 intent classifier in `apps/web/src/lib/workspace/router.ts` (5-enum: metric / evidence / graph / rule / web; entities; as_of; needs_web; uses `structuredOutputMode: 'jsonTool'` because the live Anthropic Messages API rejects the default `output_config.format`). Four typed retrieval tools in `apps/web/src/lib/workspace/agent-tools-typed.ts`: `queryStructuredMetricTool`, `queryBrandRuleTool` (reads Brief 1 `brand_guideline` and `workspace_rule`), `queryEntityFactTool` (bi-temporal `as_of` filter), `searchEvidenceTool` (wraps existing `workspace_hybrid_search`). Chat route gates active tools by intent on the new path; the legacy `retrieveContextTool` stays as a 30-day deprecation fallback.

Schema: `20260428130000_chat_tool_telemetry_cache_stats.sql` adds nine nullable columns to `chat_tool_telemetry` for per-turn cache and classifier telemetry plus a partial index for `__chat_turn__` aggregate rows.

Local gates green: `pnpm tsc --noEmit`, `pnpm vitest run` 271/271, `pnpm qa:basquio`. Live cache smoke (`scripts/test-chat-router-v2-cache.ts`) verified cold cache_creation > 0 and warm cache_read 18846 tokens. Production deploy on `ad0ee2b` Ready on Vercel; flag-OFF chat path byte-identical to pre-Brief-2.

Forward: Brief 3 (brand-guideline extraction) lights up `queryBrandRuleTool` with real brand-book extraction. Spec: `docs/research/2026-04-25-sota-implementation-specs.md` §5, §6. Shipped report: `docs/research/2026-04-27-brief-2-shipped.md`. Substrate audit: `docs/research/2026-04-27-brief-2-substrate-audit.md`.

## 2026-04-27, Memory v1 foundation on `c513701` (Brief 1)

Storage-only foundation for the memory architecture. Three Supabase migrations apply cleanly to production:

- `20260428100000_memory_architecture_foundation.sql` adds the four foundation tables (`workspace_rule`, `brand_guideline`, `anticipation_hints`, `memory_workflows`, `memory_workflow_runs`), the `hint_kind` and `hint_status` enums, the bi-temporal `expired_at` column on `facts`, and `fact_embedding VECTOR(1536)` plus its HNSW partial index. Graphiti four-timestamp model now in place.
- `20260428110000_member_scoped_rls.sql` creates `workspace_members` and the `is_workspace_member` SECURITY DEFINER helper, replaces the legacy `FOR ALL TO service_role USING (true)` policies on `entities`, `entity_mentions`, `facts`, `memory_entries`, `workspace_deliverables` with service-role write + member-scoped authenticated SELECT, and sets `hnsw.iterative_scan = strict_order` plus `hnsw.max_scan_tuples = 20000` (pgvector 0.8 RLS top-k correctness).
- `20260428120000_memory_audit_log.sql` adds the append-only `memory_audit` log, the `audit_memory_change` trigger function, triggers on `workspace_rule`, `brand_guideline`, `anticipation_hints`, `facts`, `memory_entries`, and a `public.set_config` PostgREST wrapper.

App-side: `apps/web/src/lib/workspace/audit.ts` exports `withActor(actor, workflowRunId, fn)` for Briefs 2-6 to wrap audited writes; nothing in Brief 1 calls it. TypeScript types for the new tables landed in `apps/web/src/lib/workspace/types.ts`. `MEMORY_V2_ENABLED` env var documented in `.env.example`, default false. RLS schema test at `apps/web/src/lib/workspace/rls.test.ts` (36 assertions over the migration SQL).

Production verification: `supabase db push --linked` applied all three. Schema dump confirms 7 tables, 2 enums, 7 indexes, 22 policies, 3 functions, 5 triggers. Pre-merge dry-run on a production-schema copy found one real bug in the spec: `idx_anticipation_hints_active` had `WHERE ... AND expires_at > NOW()` which Postgres rejects (non-IMMUTABLE function in index predicate). Fixed by dropping the time predicate from the partial index; queries use index column ordering instead.

Unblocks Briefs 2 through 6 per `docs/research/2026-04-25-codex-handoff-briefs.md`. Forensic detail: `docs/research/2026-04-27-brief-1-substrate-audit.md` and `docs/research/2026-04-27-brief-1-foundation-shipped.md`.

## 2026-04-27, Stabilization on `aca8be5`

After three consecutive disasters in 7 days the deck pipeline is back at the SHIPPABLE bar.

- `aca8be5` canonical-memory.md addendum confirming pipeline generalization after the diverse smoke
- `a8c26b7` canonical-memory.md Apr 26-27 incident paragraph
- `fab2aa2` squashed revert of the night spiral on `packages/workflows/`. Six "harden"/quality-passport/publish-status commits reverted (`cf79685`, `2e417c4`, `fef8766`, `cb2f205`, `ca0af46`, `7c63d5a`). Four wins kept (`4f1b8ff` brief-data reconciliation gate, `c12f6a1` recovery_reason preservation, `3c6e62b` deck-spec idempotence, `4cc8b88` workbook evidence packets). Two surgical slivers applied. NIQ guard override used once with explicit per-change Marco green-light.

Smoke results:
- Segafredo (`e74b2c15` attempt 23, FMCG coffee, Italian, 11 slides): all 5 SHIPPABLE checks PASS, 28 min, $4.17.
- Watch Retail (`bce46ccb` attempt 2, luxury retail, English, 11 slides): all 5 SHIPPABLE checks PASS, 36 min, $7.48. Reconciliation gate caught a "Bags and Luggage Specialists" outlet type missing from the source dataset and persisted the scope-adjustment note onto slide 4.

Reference baseline: Apr 23 Segafredo deck `ec91f0d0` (status=degraded, user accepted as the working bar). Quality on both Apr 27 smokes ~7/10, in the same band as the 7.4/10 reference.

Memory v1 work is unblocked.

## 2026-04-26, Revert of P0 disaster on `9ea6364`

The April 24 P0 mega-PR (`eb05537`) and 28 hardening-spiral commits reverted. `2f21bc9` deleted 8025 lines. Five subsequent commits restored the four pieces that survived independently (slop-strip UI, contract smoke guard, NIQ knowledge packs, operator rerun budget reset, zero-based manifest position tolerance). Origin/main settled at `9ea6364 Restore deck count publish contract` at 21:32 CET.

`scripts/test-anthropic-skills-contract.ts` was added by `f2ce449` then deleted by `7cd3b2b` "Complete deck generator rollback boundary". The rebuild-strategy doc claimed it was restored; it was not. Stabilization had to recreate an inline contract smoke. Restoring this file is a future P1 hygiene task.

## 2026-04-24, P0 mega-PR disaster (`eb05537`)

Single PR: 24 files, 3,651 insertions, 204 deletions. Bundled `data-primacy-validator.ts` (490 lines), `brief-data-reconciliation.ts`, three other validators, a 622-line edit to `generate-deck.ts`, and a critical change to `anthropic-execution-contract.ts` introducing `webFetchMode: "off" | "enrich"`.

The `"off"` branch returned `[]` from `buildClaudeTools()` for Sonnet/Opus while Skills (`pptx`, `pdf`) remained in the container. Anthropic API rejected with `400 invalid_request_error: container: skills can only be used when a code execution tool is enabled`.

Production deck-worker effectively down at ~16:45 UTC. 28 hours of forward-fix followed before revert. The unit test that asserted the wrong API behavior passed; it was the bug.

## 2026-04-22, Rossella cocktails fabrication (silent quality failure)

Run `1831a13e-12b4-42cf-ba90-c259f062d22c`. Opus 4.7 received a 750-respondent EMEA RTD cocktails consumer-trial-intent survey, read the brief as a market-sizing ask, invented an EMEA RTD cocktail-on-tap dataset to match. The validator passed because Opus's fabricated sheets were the linked sheets. Status shipped as `degraded` on advisory lint, not on the fabrication.

Closed by `4f1b8ff` brief-data reconciliation gate (Apr 26 22:52 CET). Verified to generalize across language and domain on Apr 27.

## 2026-04-20 to 21, Discord bot silent death (24 hours)

Three commits (`7792727`, `d77142e`, `cbb6445`) hardened the deck worker by rewriting the **root** `railway.toml`. The Railway project `basquio-bot` had two services sharing this config. The Discord bot service redeployed with the deck-worker start command, crash-looped on `NEXT_PUBLIC_SUPABASE_URL` undefined, stopped recording at Apr 20 21:14 UTC. The 2-hour Apr 21 strategy session was never captured: no audio, no transcript, no recovery.

Closed by `0b85ff5` (forensic memory entry) and `6a7138e` (dispatcher at Railway entrypoint, service-scoped configs at `apps/bot/railway.toml`).

## Earlier history

For pre-April 2026 events including the March 27-28 forensic, see `memory/march28-48h-forensic-learnings.md`.
