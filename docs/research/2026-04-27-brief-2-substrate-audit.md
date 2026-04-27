---
title: Memory v1 Brief 2 substrate audit (chat caching + router + 4 typed tools)
date: 2026-04-27
spec: docs/research/2026-04-25-sota-implementation-specs.md §5, §6
brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 2)
parent: 2026-04-27-brief-1-foundation-shipped.md
status: pre-flight before code
---

# Brief 2 substrate audit

Brief 1 substrate is on origin/main at `b39bfb5` (foundation docs) plus `5b3cbb9` (gate downgrade). Brief 2 reads from those tables and changes runtime behaviour on the chat surface behind a feature flag. This file records what existed before this brief, what design decisions are locked in, and where Brief 2 adds new files vs. extending existing ones.

## Chat agent today

`apps/web/src/lib/workspace/agent.ts` is 87 lines: a single `SYSTEM_PROMPT` string (75-line FMCG analyst persona), `CHAT_MODEL_IDS`, `resolveChatModel`. No `cache_control`, no router, no intent classifier. Verified by grep. Every other `cache_control` in the repo lives in the deck pipeline (`packages/workflows/src/system-prompt.ts:1275, :1533`) or in `packages/workflows/src/workspace/contextual-retrieval.ts:69`.

`apps/web/src/lib/workspace/agent-tools.ts` (410 lines) exports the existing tool roster wired through `getAllTools(ctx)`: `readMemoryTool`, `teachRuleTool`, `editRuleTool`, `retrieveContextTool`, `analyzeAttachedFileTool`, `analystCommentaryTool`, `listConversationFilesTool`, `showMetricCardTool`, `showStakeholderCardTool`, `editStakeholderTool`, `createStakeholderTool`, `saveFromPasteTool`, `scrapeUrlTool`, `webSearchTool`, `draftBriefTool`, `explainBasquioTool`, `suggestServicesTool`. Every tool is wrapped by `wrapChatTool(name, ctx, def)` which inserts a `chat_tool_telemetry` row per call.

`apps/web/src/app/api/workspace/chat/route.ts` (157 lines) calls `streamText({ model: anthropic(resolveChatModel(mode)), system: SYSTEM_PROMPT, tools, messages, stopWhen: stepCountIs(10) })` then `toUIMessageStreamResponse({ ..., onFinish: saveConversation })`. No prepareStep, no router gate.

## Build-context-pack split lines

`apps/web/src/lib/workspace/build-context-pack.ts` `buildWorkspaceContextPack` does seven things in one pass: scope lookup, scoped+workspace+analyst memory listing, stakeholder filter by scope name, citation→document resolution, source_files upsert, style contract aggregation, brief prelude rendering. The output `WorkspaceContextPack` includes lineage and source files that change every turn, which would break cache.

The Brief 2 split: a workspace-stable subset (workspace+analyst rules, master template tone, organization-wide style contract derived from default stakeholder preferences) and a scope-stable subset (scope name, scope-scoped stakeholders, scope-specific rules). Lineage, conversation attachments, citations, source_files, and the per-turn brief prelude stay in the existing wrapper. New helpers `buildWorkspaceBrandPack(workspaceId)` and `buildScopeContextPack(workspaceId, scopeId)` return strings; the existing `buildWorkspaceContextPack` continues to work for non-chat callers (deck pipeline lineage, generation drawer).

## Telemetry table shape

`supabase/migrations/20260424183000_add_chat_tool_telemetry_and_web_search_calls.sql` creates `chat_tool_telemetry(id, conversation_id, user_id, tool_name, input_hash, started_at, completed_at, duration_ms, status, error_message, result_size_bytes, created_at)` with three b-tree indexes. Brief 2 adds nine nullable columns: `cache_creation_input_tokens INT`, `cache_read_input_tokens INT`, `total_input_tokens INT`, `total_output_tokens INT`, `cost_usd NUMERIC(10,4)`, `intents TEXT[]`, `active_tools TEXT[]`, `classifier_entities TEXT[]`, `classifier_as_of TIMESTAMPTZ`, `classifier_needs_web BOOLEAN`. Existing per-tool-call rows leave them NULL. A new `recordChatTurnTelemetry()` helper writes one row per turn with `tool_name='__chat_turn__'` carrying the aggregate. Migration `20260428130000_chat_tool_telemetry_cache_stats.sql` is idempotent (`ADD COLUMN IF NOT EXISTS`).

## AI SDK v6 wiring

Installed: `ai@6.0.116`, `@ai-sdk/anthropic@3.0.58`. AI SDK v6's `streamText`, `generateText`, and `ToolLoopAgent` all support `prepareStep`, `stopWhen`, and per-call `activeTools`. Multi-breakpoint system caching is wired by passing `system` as `Array<SystemModelMessage>` where each block is `{ role: 'system', content: string, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' | '5m' } } } }`. The `@ai-sdk/anthropic` provider validates `ttl: '1h' | '5m'` directly (`apps/web/node_modules/@ai-sdk/anthropic/dist/index.d.ts:148`); the 1h TTL went GA on Feb 5 2026 so no beta-header juggling required.

Brief 2 keeps `streamText` as the streaming primitive. `ToolLoopAgent` from spec §6 is a class wrapper that internally calls the same loop with the same `prepareStep`/`stopWhen`/`activeTools` plumbing. Using `streamText` directly minimises diff and keeps the existing `toUIMessageStreamResponse` adapter path intact. Functionally identical, lower risk.

## Router fixture location

`apps/web/src/lib/workspace/__tests__/fixtures/router-eval.json` is the canonical location (mirrors the existing `__tests__` convention in `apps/web/src/lib/workspace/`). 100 labeled turns, 20 per intent, synthetic-but-representative analyst questions. Production sampling from `chat_tool_telemetry` is deferred to a follow-up because today's telemetry rows are per-tool-call without preserved user-message text.

## Brief 1 substrate the typed tools query

`workspace_rule` has `(workspace_id, scope_id, rule_type, rule_text, applies_to[], priority, active, expired_at, ...)`. `idx_workspace_rule_active` partial on `WHERE active = TRUE AND expired_at IS NULL` orders by `(workspace_id, scope_id, active, priority DESC)`. `queryBrandRuleTool` reads via that index.

`brand_guideline` has `(workspace_id, brand, version, typography, colour, tone, imagery, forbidden, language_preferences, layout, logo, superseded_by, ...)`. Empty in production today (Brief 3 populates it). `queryBrandRuleTool` returns null gracefully when no row exists for the brand.

`facts` has `(organization_id, subject_entity, predicate, object_value, valid_from, valid_to, ingested_at, expired_at, superseded_by, ...)`. Brief 1 added `expired_at` and a partial active index on `WHERE superseded_by IS NULL AND expired_at IS NULL`. `queryEntityFactTool` filters with `AND (valid_from IS NULL OR valid_from <= as_of) AND (valid_to IS NULL OR valid_to > as_of) AND superseded_by IS NULL AND expired_at IS NULL`. The workspace→organization bridge is `BASQUIO_TEAM_ORG_ID` from `apps/web/src/lib/workspace/constants.ts` (single-tenant in production today).

`workspace_hybrid_search` SQL function at `supabase/migrations/20260419120000_v1_workspace_schema.sql:193-300` is the existing RRF fusion. `searchEvidenceTool` thin-wraps `assembleWorkspaceContext` from `apps/web/src/lib/workspace/context.ts` which already calls the function via the `workspace_chat_retrieval` dual-lane RPC when a conversation id is present.

## Decision: feature flag

`CHAT_ROUTER_V2_ENABLED` env var, default false. Old `streamText({ system: STRING, tools, ... })` path runs in production until verification. The flag gates four runtime changes: multi-block cached system, classifier on step 0, intent-gated `activeTools`, `recordChatTurnTelemetry` aggregate row. No code path other than `apps/web/src/app/api/workspace/chat/route.ts` reads the flag, so flipping it is a single rerun-Vercel-deploy operation.

## Out of scope (per the brief)

No changes to `packages/workflows/`, `packages/intelligence/`, `scripts/worker.ts`, `apps/bot/`, `anthropic-execution-contract.ts`, `system-prompt.ts`, `cost-guard.ts`. No new tables outside the telemetry ALTER. No anticipation logic. No memory candidate queue. No back-office. retrieveContextTool stays callable as a 30-day deprecation fallback.
