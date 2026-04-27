---
title: Brief 1 substrate audit · pre-implementation findings
date: 2026-04-27
parent: 2026-04-25-sota-implementation-specs.md (§1, §2, §3)
spec source: 2026-04-25-codex-handoff-briefs.md Brief 1
purpose: capture how the live substrate diverges from the spec snapshot,
         so the migrations land cleanly without inventing scope.
---

# Brief 1 substrate audit

Read against `origin/main` HEAD `8032666 Restore Anthropic contract smoke guard`.

## Target tables that already exist

- `public.workspaces` (`20260420120000_v2_workspace_tables.sql:11`) with `id`, `organization_id`, `slug`, `kind`, `visibility`. Backfilled team-beta row at `15cc947e-70cb-455a-b0df-d8c34b760d71`.
- `public.workspace_scopes` (`:41`).
- `public.workspace_conversations` (`:63`).
- `public.entities` (`20260419120000_v1_workspace_schema.sql:38`) scopes by `organization_id`. Also has a `workspace_id` column added in v2 (`:106`), nullable, backfilled to equal `organization_id` for the team-beta singleton.
- `public.entity_mentions` (`:64`) same shape as entities.
- `public.facts` (`:86`) bi-temporal: `valid_from`, `valid_to`, `ingested_at`, `superseded_by`, `confidence`. Has both `organization_id` and `workspace_id`. No `expired_at`. No `fact_embedding` column.
- `public.memory_entries` (`:116`) with `embedding vector(1536)` and HNSW index already (`:138`).
- `public.workspace_deliverables` (`:146`) kind in (answer, memo, deck, workbook, chart). Has `organization_id` and `workspace_id`.

## Target tables that do NOT exist

- `public.workspace_members`: absent. No table by this name in any migration. Migration 2 creates it.
- `public.workspace_rule`: absent.
- `public.brand_guideline`: absent.
- `public.anticipation_hints`: absent.
- `public.memory_workflows`: absent.
- `public.memory_workflow_runs`: absent.
- `public.memory_audit`: absent.

## Current RLS posture on the legacy memory tables

Per `20260419120000_v1_workspace_schema.sql:177-186`, every memory table has a single `Service role manages X` policy: `FOR ALL TO service_role USING (true)`. No authenticated read policies. Tenancy is enforced at the application layer via service-role queries with `organization_id` filters.

Migration 2 drops those service-only policies and replaces them with a service-role write policy plus a member-scoped authenticated read policy (`is_workspace_member(workspace_id)` for tables that scope by `workspace_id`, organization-bridge JOIN for legacy tables that the spec models as scoping by `organization_id`).

## set_config wrapper status

Postgres ships `pg_catalog.set_config(text, text, boolean)` and `pg_catalog.current_setting(text, boolean)` natively, but Supabase PostgREST RPC dispatch resolves names against `public` (and explicitly-exposed schemas). No `public.set_config` exists in any migration. Migration 3 adds a thin `public.set_config` wrapper so the `withActor` helper can call it via `client.rpc('set_config', ...)`.

## pgvector extension status

`vector` extension already enabled in `20260317000000_knowledge_base.sql`. Migration 1 does not need a `CREATE EXTENSION` statement; the `VECTOR(1536)` column type and the HNSW index syntax both compile against the existing extension.

## TypeScript type conventions

`apps/web/src/lib/workspace/types.ts` (84 lines) holds plain TypeScript types (not Zod schemas) for `WorkspaceScope`, `WorkspaceRow`, `MemoryRow`, `MemoryType`, etc. Pattern is `export type X = { snake_case_field: T }` matching SQL column shapes. The new memory v1 types extend this file directly: `WorkspaceRule`, `BrandGuideline`, `AnticipationHint`, `MemoryWorkflow`, `MemoryWorkflowRun`, `MemoryAudit`, plus `HintKind` and `HintStatus` literal unions.

`packages/types/src/index.ts` is workflow-side (ZodSchemas for `GenerationRequest`, `AnalyticsResult`, etc.). It does not currently export workspace types. Brief 1 keeps the new memory types in `apps/web/src/lib/workspace/types.ts`; cross-package use comes in later briefs that need them in `packages/workflows/`.

## Env var convention

No central env validator file. The pattern is direct `process.env.X` reads with `if (!url) throw` guards inline (see `apps/web/src/lib/workspace/db.ts:60`). `MEMORY_V2_ENABLED` lands in `.env.example` only; no validator file to update. Default false; nothing reads it in Brief 1.

## Test fixture pattern for RLS

Existing tests under `apps/web/src/lib/workspace/*.test.ts` use `vi.mock('@/lib/supabase/admin', ...)` to mock the service-role client. There is no auth-token fixture, no Supabase test container harness, no `seedAuthUser` / `createUserClient` helper. Building one for Brief 1 would significantly expand scope.

Decision: the RLS isolation vitest is implemented as a static-schema test that parses the three migration SQL files and asserts the expected RLS policy creations, the `ENABLE ROW LEVEL SECURITY` statements, the `SECURITY DEFINER` + `SET search_path = ''` shape on the helper functions, and the trigger attachments. The full RLS isolation behavior is verified manually in Phase 7b against a live Supabase instance per the brief. This honors "the test must live and pass" without inventing an auth fixture surface that belongs to a later brief.

## Naming conventions

- Migrations use `BEGIN; ... COMMIT;` wrappers (per spec). Existing migrations are mixed; the latest (`20260424183000`) does not wrap. The new migrations follow the spec verbatim and wrap.
- Lowercase `create table if not exists` is the recent house style; spec uses uppercase `CREATE TABLE IF NOT EXISTS`. Following spec verbatim.
- Test files are colocated next to source (e.g. `agent.test.ts`), not in `__tests__/` subfolders. The new RLS test ships at `apps/web/src/lib/workspace/rls.test.ts` to match this convention; the brief mentioned `__tests__/rls.test.ts` as one option but the existing pattern wins.

## Hooks to respect

`lefthook.yml` runs `em-dash-audit`, `secret-scan`, `niq-hardening-guard`, `npx tsc --noEmit`, `pnpm vitest run` on every commit. Pre-push runs `qa:catalog` only when `supabase/migrations/**` is touched, plus a secret scan against the outgoing diff. The new migrations and TypeScript code do not contain em-dashes; tests live and pass. NIQ guard does not gate this brief because no NIQ-protected files are touched.

## What this means for the migrations

- Migration 1 schemas: copy verbatim from spec §1.
- Migration 2: keep the org-bridge SELECT policies for `entities`, `entity_mentions`, `facts`, `memory_entries`, `workspace_deliverables` per the spec, even though those tables now have a `workspace_id` column from v2. The bridge pattern is what the spec encodes and what the user prompt specified. A future brief can tighten to `is_workspace_member(workspace_id)` once all rows are guaranteed backfilled and code paths are migrated.
- Migration 3: add `public.set_config` wrapper before the trigger function references the session var via `current_setting`. Trigger reads `app.actor` and `app.workflow_run_id` from session; both default to `system:unknown` and NULL when unset.

## Real bug found in dry-run

`supabase db reset` cannot run end-to-end against the existing migration chain because `20260421220000_lock_search_path_on_workspace_functions.sql` ALTERs `public.workspace_chat_retrieval(...)`, but that function is created in `20260422120000_conversation_attachments_and_inline_excerpt.sql` (a later timestamp). The pair was likely rebased into the wrong order. NOT a Brief 1 fix; called out for a future hygiene pass.

For Brief 1, the production-copy verification path used `supabase db dump --linked` to grab the current production schema, applied it to a fresh `pgvector/pgvector:pg17` container, then layered the three Brief 1 migrations on top. That dry-run surfaced one real bug: the spec wrote `idx_anticipation_hints_active` with `WHERE status IN ('candidate', 'shown') AND expires_at > NOW()`. Postgres rejects this with `ERROR: functions in index predicate must be marked IMMUTABLE` because `NOW()` is `STABLE`, not `IMMUTABLE`. Fixed by dropping the `expires_at > NOW()` clause from the partial index predicate; queries still benefit from index column ordering on `(workspace_id, scope_id, status, urgency, expires_at)`. Inline comment in the migration explains the divergence from spec.

After the fix, all three migrations apply cleanly, audit trigger fires correctly (insert on `workspace_rule` writes a `memory_audit` row with the actor from session config), cross-workspace RLS isolation holds (Alice sees workspace A row, gets zero rows from workspace B), `hnsw.iterative_scan = strict_order`, `set_config` wrapper roundtrips when called within a single transaction.

## Follow-ups (not Brief 1 scope)

- Enable RLS on `workspace_members` with a self-read policy. The spec creates the table without `ALTER ... ENABLE ROW LEVEL SECURITY`; the helper function is `SECURITY DEFINER` which masks the gap, but a future hardening brief should close it.
- Tighten the legacy-table SELECT policies from organization-bridge to `is_workspace_member(workspace_id)` once code paths drop the `organization_id`-only fallback.
- Build a real authenticated-client RLS test fixture so the cross-workspace isolation case can run in CI rather than only in manual SQL.
