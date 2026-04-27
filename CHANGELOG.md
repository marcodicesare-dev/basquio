# Changelog

Material production events for the Basquio stack. Newest first. Links use git SHAs from `origin/main`.

For full forensic detail on the April 2026 disaster arc and the operational rules it produced, read `memory/april-2026-disaster-arc-forensic.md`.

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
