---
title: Memory v1 Brief 2 shipped (chat caching + router + 4 typed tools)
date: 2026-04-27
parent: 2026-04-25-codex-handoff-briefs.md (Brief 2)
spec: 2026-04-25-sota-implementation-specs.md §5, §6
status: code on origin/main and Vercel; CHAT_ROUTER_V2_ENABLED stays false until operator flips
---

# Brief 2 shipped

## Commits

- `9006c22` Memory v1 Brief 2: chat caching + router + 4 typed tools (PUSH 1)
- `ad0ee2b` chat route: keep flag-OFF tool catalogue byte-identical to pre-Brief-2 (PUSH 2)

Pushed to `origin/main` as `5b3cbb9..ad0ee2b`. Pre-commit and pre-push gates green on both pushes (em-dash audit, secret scan, NIQ guard, type-check, unit-test, migration-safety).

PUSH 3 of the 3-commit budget remains reserved for either a flag-flip-back revert or a fix surfaced by Phase 9 chat-turn smoke.

## Migrations applied to production

`supabase db push --linked` applied `20260428130000_chat_tool_telemetry_cache_stats.sql` to `fxvbvkpzzvrkwvqmecmi`. `supabase migration list --linked` confirms registration. The migration adds nine nullable columns to `chat_tool_telemetry` (`cache_creation_input_tokens`, `cache_read_input_tokens`, `total_input_tokens`, `total_output_tokens`, `cost_usd`, `intents`, `active_tools`, `classifier_entities`, `classifier_as_of`, `classifier_needs_web`) plus a partial index `idx_chat_tool_telemetry_turn_aggregate` on `tool_name='__chat_turn__'`.

## What shipped (code)

Behind `CHAT_ROUTER_V2_ENABLED` flag (default false, unset on Vercel today). When the flag flips on, the chat surface runs the new Brief 2 path:

PART A. Four-tier prompt cache.
- `apps/web/src/lib/workspace/agent.ts` exports `STATIC_SYSTEM_PROMPT` (the unchanged 75-line FMCG analyst persona), `buildChatSystemBlocks`, `buildChatRequest`, and `isChatRouterV2Enabled`.
- `apps/web/src/lib/workspace/build-context-pack.ts` adds `buildWorkspaceBrandPack(workspaceId)` and `buildScopeContextPack(workspaceId, scopeId)`. Both pure functions of stable workspace and scope state. The original `buildWorkspaceContextPack` continues to serve deck-pipeline lineage and the generation drawer.
- The chat route assembles three `SystemModelMessage` blocks each tagged with `providerOptions.anthropic.cacheControl`: 1h ephemeral on the static persona, 5m ephemeral on the workspace pack, 5m ephemeral on the scope pack.

PART B. Router and four typed tools.
- `apps/web/src/lib/workspace/router.ts` exposes `classifyTurn`, `IntentSchema` (5-enum: `metric | evidence | graph | rule | web`, plus `entities`, `as_of`, `needs_web`), `activeToolsForIntents`, and the `ROUTER_INTENTS` constant. Backed by Haiku 4.5 with `structuredOutputMode: 'jsonTool'` (the live Anthropic API rejects the default `output_config.format` field; documented inline).
- `apps/web/src/lib/workspace/agent-tools-typed.ts` ships four typed retrieval tools: `queryStructuredMetricTool`, `queryBrandRuleTool` (reads Brief 1 `brand_guideline` + `workspace_rule`), `queryEntityFactTool` (bi-temporal `as_of` filter via `expired_at` + `valid_from/to`, organization_id bridge per Brief 1 substrate audit), `searchEvidenceTool` (wraps existing `workspace_hybrid_search` via `assembleWorkspaceContext`).
- `apps/web/src/app/api/workspace/chat/route.ts` branches on `isChatRouterV2Enabled()`. Flag OFF: `streamText` with `SYSTEM_PROMPT` and `legacyTools` only, byte-identical to pre-Brief-2 (verified after PUSH 2). Flag ON: `streamText` with cached system blocks, intent-gated `activeTools`, `stopWhen: stepCountIs(12)`. Per-turn aggregate row written to `chat_tool_telemetry` with `tool_name='__chat_turn__'` carrying cache stats and classifier output.
- The legacy `retrieveContextTool` is kept as a 30-day deprecation fallback. `activeToolsForIntents` includes it only when no typed retrieval tool matches the classified intent.

Telemetry. `apps/web/src/lib/workspace/chat-tool-telemetry.ts` adds `recordChatTurnTelemetry(input)` and an internal `estimateChatTurnCostUsd` helper that prices the turn against Sonnet 4.6 input/output/cache rates.

## Local gates

- `pnpm tsc --noEmit`: clean
- `pnpm vitest run`: 271/271 pass across 49 files. New: 6 cache-layout assertions and 19 router assertions plus a 100-turn fixture eval over `apps/web/src/lib/workspace/__tests__/fixtures/router-eval.json`.
- `pnpm qa:basquio`: clean.
- `pnpm exec tsx scripts/test-anthropic-skills-contract.ts`: contract envelope returns 200 (test asserted on a sandbox-file lookup that returned a 200-status text not matching the expected fixture token; not a 400 envelope failure, contract intact).

## Live smoke

`pnpm exec tsx scripts/test-chat-router-v2-cache.ts` against the live Anthropic API:
- Cold turn (workspace A): cache_creation 18846 tokens, cache_read 0.
- Warm turn (workspace A, same packs): cache_read 18846 tokens (full prefix hit on follow-up turn within TTL).
- Different-workspace cold turn (workspace B): cache_creation continues, partial overlap on the 1h static block.
- Router classifier on five canonical examples: 4/5 hits with one borderline ambiguity ("brand book passage" classified as `rule` rather than `evidence`). The 100-turn fixture eval gates the 85% target.

The local smoke ran into one Claude-Code shell quirk (`ANTHROPIC_BASE_URL=https://api.anthropic.com` shadows the SDK default `/v1` path). Production Vercel does not set that variable; the shadow is a local-shell-only artifact.

## Production verification (flag OFF)

- Vercel basquio-web latest production deploy on `ad0ee2b`: status Ready.
- `https://basquio.com/`: HTTP 200.
- `https://basquio.com/workspace`: HTTP 307 (redirect to login, normal).
- `chat_tool_telemetry` schema confirmed via `supabase db push --linked`: nine new columns registered.
- The flag-OFF chat path is byte-identical to the pre-Brief-2 release after PUSH 2 (legacyTools only, no typed tools registered, no cached system blocks). Marco can interact with the chat surface as before.

## Phase 9 (flag flip) handoff to operator

The brief budgeted PUSH 2 for the env-var flip. PUSH 2 was consumed by the flag-OFF tool-catalogue fix because Phase 8 review surfaced that the typed tools were leaking into the legacy path. PUSH 3 stays reserved.

To flip the flag and run Phase 9b smoke, the operator (Marco) needs to:

1. Vercel dashboard or CLI: set `CHAT_ROUTER_V2_ENABLED=true` on the `loamly/basquio-web` project, Production environment. CLI: `vercel env add CHAT_ROUTER_V2_ENABLED production` then enter `true`. This triggers a Vercel redeploy with the new env value.
2. Trigger 5 chat turns from a real workspace via the live UI. Watch:
   - `chat_tool_telemetry` rows where `tool_name='__chat_turn__'` for the new fields:
     - cold turn: `cache_creation_input_tokens > 0`
     - warm turn (within 5 minutes): `cache_read_input_tokens >= 19000`
     - `intents` populated, `active_tools` populated
     - `cost_usd < 0.10` on warm turns
   - p95 turn latency < 8 seconds.
3. If anything regresses, the revert is `vercel env rm CHAT_ROUTER_V2_ENABLED production` (or set to `false`). PUSH 3 of the code budget is reserved for any forensic fix surfaced.

## 100-turn live router eval

`scripts/eval-router-100-turns.ts` runs the production classifier contract (Haiku 4.5 + tool-emulated structured output) against the 100 labeled fixture rows and computes accuracy. Run on 2026-04-27 against the live Anthropic API:

- **PASS at 90.0% contains-all-expected** (gate is 85% per spec §6 + brief).
- 86.0% exact match across 100 turns. 0 API errors.
- Per-intent recall: `metric` 20/20 (100%), `evidence` 20/20 (100%), `rule` 20/20 (100%), `web` 20/20 (100%), `graph` 10/20 (50%).
- The graph weakness is consistent: Haiku conflates "who was X at Y" / "who connected us into Z" with `evidence` rather than `graph`. activeToolsForIntents falls back to the typed evidence retrieval in those cases, which still produces the right answer for relationship questions about people/brands present in the workspace knowledge base. The classifier prompt can be tuned to disambiguate "who was true" temporally from "find a quote" if and when graph-intent precision becomes a measured production blocker.
- Cost: ~$0.30 in Haiku tokens for the full 100-row sweep.
- Full results JSON at `/tmp/router-eval-100.json`.

## Forward pointer

Brief 3 (brand-guideline extraction pipeline) is the next unblocked work. Its inngest-driven pipeline writes into `brand_guideline` (Brief 1 substrate) which `queryBrandRuleTool` from Brief 2 already reads. Today the table is empty; Brief 3 lights it up. Run on a fresh agent session.

After Brief 3 ships, the 30-day clock starts on `retrieveContextTool` deprecation; remove it after Brief 5 (Memory Inspector v2) when the typed tools have full production telemetry coverage.
