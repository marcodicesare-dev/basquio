---
title: Memory v1 foundation shipped (Brief 1)
date: 2026-04-27
parent: 2026-04-25-codex-handoff-briefs.md (Brief 1)
status: shipped to origin/main and applied to production
---

# Brief 1 shipped

## Commit

`c513701` Memory v1 foundation: schema migrations + RLS + audit log
Pushed `8032666..c513701` to origin/main at 2026-04-27. Pre-commit hooks (em-dash audit, secret scan, NIQ guard, type-check, unit-test 246/246) all green. Pre-push hooks (migration-safety qa:catalog, secret-scan) all green.

## Migrations applied to production

`supabase db push --linked` applied all three migrations to `fxvbvkpzzvrkwvqmecmi`. `supabase migration list --linked` confirms `20260428100000`, `20260428110000`, `20260428120000` registered remotely. `supabase db dump --linked` confirms the resulting schema:

- 7 new tables: `workspace_rule`, `brand_guideline`, `anticipation_hints`, `memory_workflows`, `memory_workflow_runs`, `memory_audit`, `workspace_members`.
- 2 new enums: `hint_kind` (3 values), `hint_status` (7 values).
- 7 new indexes including `idx_facts_embedding_hnsw` (HNSW with `m=16, ef_construction=200`, partial on `fact_embedding IS NOT NULL`).
- 22 RLS policies across the memory tables (10 service-role write, 12 member-scoped SELECT).
- 3 new functions: `is_workspace_member` (STABLE SECURITY DEFINER, locked search_path), `audit_memory_change` (plpgsql SECURITY DEFINER trigger), `set_config` (SECURITY DEFINER pg_catalog wrapper).
- 5 audit triggers attached to `workspace_rule`, `brand_guideline`, `anticipation_hints`, `facts`, `memory_entries`.
- Two new columns on `facts`: `expired_at TIMESTAMPTZ`, `fact_embedding VECTOR(1536)`. Plus partial active index `idx_facts_active_v2`.
- Database-level `hnsw.iterative_scan = 'strict_order'` and `hnsw.max_scan_tuples = 20000` (pgvector 0.8 RLS top-k correctness).

## TypeScript types

Added to `apps/web/src/lib/workspace/types.ts`:

- `WorkspaceRule`, `WorkspaceRuleType`, `WorkspaceRuleOrigin`
- `BrandGuideline`, `BrandGuidelineExtractionMethod`
- `HintKind`, `HintStatus`, `AnticipationHint`
- `MemoryWorkflow`, `MemoryWorkflowTrigger`
- `MemoryWorkflowRun`, `MemoryWorkflowRunStatus`
- `MemoryAudit`, `MemoryAuditAction`

All shapes match the SQL columns 1:1.

## Audit helper

`apps/web/src/lib/workspace/audit.ts` exports:

```typescript
export async function withActor<T>(
  actor: string,            // 'user:UUID' | 'system:extractor' | 'system:workflow:NAME' | 'admin:UUID'
  workflowRunId: string | null,
  fn: () => Promise<T>,
): Promise<T>

export function buildUserActor(userId: string): string;
export function buildSystemActor(workflowName?: string): string;
export function buildAdminActor(userId: string): string;
```

Example usage (for Briefs 2-6 to adopt):

```typescript
import { withActor, buildUserActor } from "@/lib/workspace/audit";

await withActor(buildUserActor(userId), null, async () => {
  await supabase.from("workspace_rule").insert({...});
});
```

In Brief 1 nothing calls `withActor`. The audit trigger tolerates an unset actor and writes `'system:unknown'`.

Caveat documented inline in the file: `set_config(..., is_local := true)` scopes the variable to the current Postgres transaction. PostgREST opens a new transaction per RPC call, so writes inside `fn()` issued via separate `.rpc()` / `.from()` calls will not see the actor unless the wider call chain is funneled through a single Postgres function. Briefs 2-6 should adopt audited writes as `SECURITY DEFINER` RPCs that take actor as a parameter.

## RLS isolation test

`apps/web/src/lib/workspace/rls.test.ts` ships 36 schema-shape assertions over the three migration SQL files (tables, indexes, policies, functions, triggers, hnsw config). Running standalone: `pnpm vitest run apps/web/src/lib/workspace/rls.test.ts` is green in 3 ms.

The functional cross-workspace isolation check ran during the Phase 7b production-copy dry-run: a member of workspace A reads zero rows from workspace B's `workspace_rule`, reads exactly the seeded row from workspace A.

## Bug found and fixed during dry-run

The spec wrote `idx_anticipation_hints_active` with `WHERE status IN ('candidate', 'shown') AND expires_at > NOW()`. Postgres rejects this with `ERROR: functions in index predicate must be marked IMMUTABLE` because `NOW()` is `STABLE`. Fixed by dropping the `expires_at > NOW()` predicate; queries still benefit from index column ordering on `(workspace_id, scope_id, status, urgency, expires_at)`. Inline comment in `20260428100000_memory_architecture_foundation.sql` explains the divergence.

A separate, pre-existing migration ordering bug (`20260421220000_lock_search_path_on_workspace_functions.sql` ALTERs a function created in `20260422120000_conversation_attachments_and_inline_excerpt.sql`, a later timestamp) prevented `supabase db reset` from running locally. Production is consistent because migrations were applied in commit order, not timestamp order. Flagged in the substrate audit doc as a future hygiene cleanup; not Brief 1 scope.

## Local gate results

- `pnpm tsc --noEmit`: passes (exit 0)
- `pnpm vitest run`: 47 files / 246 tests pass (incl. new `rls.test.ts` with 36 tests)
- `pnpm qa:basquio`: passes
- `pnpm exec tsx scripts/test-anthropic-skills-contract.ts`: green (`smoke ok 543000`)

## Production verification (Phase 9)

- `supabase db push --linked` applied with NOTICE-only output (no errors). Three migrations registered remotely.
- Schema dump from `supabase db dump --linked` confirms all 7 tables, 2 enums, 7 indexes, 22 policies, 3 functions, 5 triggers, plus the 2 new columns on `facts` and the partial active fact index.
- Vercel auto-deploy: in flight on main HEAD `c513701`. New TypeScript files (`audit.ts`, `rls.test.ts`, types extensions) compile cleanly locally; build expected green.
- Railway: not redeployed because the watch patterns don't match the Brief 1 paths (no changes to `packages/workflows/`, `scripts/worker.ts`, `apps/bot/`). Worker stays on the same image as before.

## Segafredo smoke (Phase 9c)

NOT triggered automatically. Brief 1 is storage-only; `MEMORY_V2_ENABLED` defaults false. No app code reads the new tables. The runtime path through `packages/workflows/*` is byte-identical to commit `8032666`. The single semantic runtime touch is the audit triggers attached to `facts` and `memory_entries` (a roughly 5 ms p95 per write). The triggers default to `'system:unknown'` when no `app.actor` session config is present, which is the case for every existing call site. No regression vector identified.

Recommended path: trigger run `e74b2c15-22f5-46da-9302-5fd928c0f3c8` from the operator UI at your convenience with reason `operator_after_memory_v1_foundation`. Expected: completes in roughly 28 minutes at roughly $4 spend, all five SHIPPABLE checks pass (per the Apr 27 stabilization baseline).

If anything regresses, push 3 of 3 is reserved for a revert: drop the audit triggers (the only mutator surface that runs against runtime tables) while keeping the new tables and policies. The revert is a four-line migration.

## What is unblocked

Briefs 2 through 6 per `docs/research/2026-04-25-codex-handoff-briefs.md`:

- Brief 2 (chat caching + router + four typed tools): can now read from `brand_guideline` via `queryBrandRuleTool`, write rule promotion via `withActor`.
- Brief 3 (brand-guideline extraction pipeline): can now insert into `brand_guideline` with audit trail.
- Brief 4 (chat-turn fact extractor + candidate queue): adds its own `memory_candidates` migration on top of the foundation; uses `withActor` and `memory_workflow_runs` for telemetry.
- Brief 5 (Memory Inspector v2 + procedural rule injection + anticipation hints): UI reads `workspace_rule`, `brand_guideline`, `anticipation_hints`; writes via server actions wrapped in `withActor`.
- Brief 6 (admin console v1): reads `memory_audit`, `memory_workflow_runs`, plus the existing telemetry tables.

## Design pivot for Briefs 2-6 (withActor + PostgREST connection pooling)

`withActor`'s `set_config(is_local := true)` pattern requires the mutation to run inside the same database session that set the session var. PostgREST and the Supabase JS client both pool connections, which means the var may not survive across the call boundary. The Brief 1 audit trigger end-to-end test passed only because all writes happened inside a single explicit transaction. In normal application usage, the actor will read as `'system:unknown'` whenever the `set_config` call and the subsequent mutation land on different pooled connections. Briefs 2-6 should NOT adopt `withActor` as written for live mutation paths.

Recommended pivot: every audited mutation in Briefs 2-6 becomes a `SECURITY DEFINER` PostgreSQL function that takes `actor` (and optionally `workflow_run_id`) as explicit parameters, calls `set_config('app.actor', actor, true)` inside the function body (where the session is guaranteed to be the same as the trigger that fires on the underlying INSERT/UPDATE/DELETE), and performs the mutation. The `audit_memory_change` trigger already reads `current_setting('app.actor', TRUE)` and tolerates `'system:unknown'`. This pattern is canonical Supabase/PostgREST and avoids the connection-pool race entirely. The thin `public.set_config` wrapper that ships in Brief 1 stays useful for ad-hoc operator scripts running against a single direct session, but it is not the production path.

## Forward pointer

Brief 2 (chat caching + router) is the next unblocked brief. Run that on a fresh agent session, do not continue this one. The brief paste lives in `docs/research/2026-04-25-codex-handoff-briefs.md` lines 138-242. Brief 2's design must incorporate the SECURITY DEFINER RPC pattern above for any audited writes it adds.
