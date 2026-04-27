---
title: Memory v1 Brief 5 shipped (procedural rule injection + Memory Inspector v2 + anticipation hints)
date: 2026-04-27
parent: 2026-04-25-codex-handoff-briefs.md (Brief 5)
spec: 2026-04-25-sota-implementation-specs.md §8 + §9
status: code on origin/main, all three concerns behind flags (MEMORY_INSPECTOR_V2 + ANTICIPATION_ENABLED), default false. Marco flips the flags after sampling production data.
---

# Brief 5 shipped (PUSH 1-3, doc + buffer reserved for PUSH 4-7)

## Commits

- `3517b11` Brief 5 PUSH 1: procedural rule injection (PART A)
- `ebf8561` Brief 5 PUSH 2: Memory Inspector v2 (PART B, behind MEMORY_INSPECTOR_V2)
- `01a1886` Brief 5 PUSH 3: anticipation hints (PART C, behind ANTICIPATION_ENABLED)

PUSH 4-7 reserved for one production-ops fix surfaced by flag flip
(Memory Inspector v2 perf, hint generator drift, etc.) plus the
post-flip canonical-memory promotion. Brief 5 budget remaining: 4-5
pushes.

## What shipped (code)

### PART A: procedural rule injection (PUSH 1)

Workspace_rule promoted from Brief 1 storage-only into a live
mutation surface. Active rules now ship into every chat turn via
buildScopeContextPack so the agent obeys workspace-level procedural
rules without the user re-stating them.

- `supabase/migrations/20260512100000_workspace_rule_rpcs.sql`: 4
  SECURITY DEFINER RPCs (upsert / pin / edit / forget). Each follows
  the persist_brand_guideline pattern from Brief 3 (canonical
  reference): SET search_path = '', sets app.actor inside the body
  so the audit trigger from Brief 1 attributes the caller in the
  same transaction.
- `apps/web/src/lib/workspace/rules.ts` exports listActiveRules,
  listAllRules, upsertRule, pinRule, editRule, forgetRule, plus
  formatActiveRulesForScope for context-pack injection.
- `apps/web/src/lib/workspace/build-context-pack.ts`
  `buildScopeContextPack` now appends an "## Active workspace rules"
  section to the scope pack, ordered by rule_type and priority desc
  within each group, capped at 24 rules per pack to keep token
  budget predictable.

### PART B: Memory Inspector v2 (PUSH 2, behind MEMORY_INSPECTOR_V2)

When the flag is on, /workspace/memory renders the new 4-tab
inspector instead of the legacy MemoryBrowser:

- Entities tab: read-only list with name / type / aliases /
  fact-count / updated-at.
- Facts tab: bi-temporal table with subject / predicate / object /
  valid_from / source / status. Toggle to include superseded /
  expired rows.
- Rules tab: grouped by rule_type, ordered by priority desc within
  each group. Pin / Edit / Forget actions wire to three new REST
  endpoints calling the SECURITY DEFINER RPCs.
- Pending tab: reuses the WorkspaceCandidateQueue from Brief 4.

The legacy memory page (flag-OFF) is byte-identical to today.

### PART C: anticipation hints (PUSH 3, behind ANTICIPATION_ENABLED)

`supabase/migrations/20260512110000_anticipation_hints_rpcs.sql` adds
5 SECURITY DEFINER RPCs (insert / dismiss / snooze / accept /
expire). 14-day cooldown_key suppression is enforced INSIDE
insert_anticipation_hint: a dismissed hint with the same cooldown_key
within 14 days forces status='suppressed' on any new hint of the same
key. pg_cron schedule for nightly hint expiry at 04:15 UTC, guarded
by IF EXISTS pg_extension.

`apps/web/src/lib/workspace/anticipation.ts` exports
generateMondayMorningHints with three concurrent generators:

- Reactive: pending memory_candidates older than 3 days
- Proactive: brand_guideline rows extracted in the last 7 days
- Optimisation: workspace_rule rows updated 3+ times in 14 days

Each generator returns at most one hint. Combined with the 3-hint
workspace home cap, the spec §9 "three things" pattern is enforced.

`apps/web/src/components/workspace-hints-banner.tsx` renders on the
workspace home above WorkspaceHomeDashboard with Done / Snooze 7d /
Dismiss buttons calling three new REST endpoints. Renders nothing
when listActiveHints returns zero rows, so the workspace home is
byte-identical when the flag is off or no hints have been generated.

## Architectural notes

- **Inngest stays retired.** The brief originally specified
  `apps/web/src/inngest/memory-workflows.ts` for hint workflows; same
  finding as Brief 3 + 4 (Inngest route returns 410). PART C uses
  pg_cron (with IF EXISTS guard) for the nightly expiry, and a
  pull-based generateMondayMorningHints function callable from
  scripts/admin console (Brief 6) for the Monday-morning pass. A
  future brief can wire pg_cron to invoke a Supabase RPC that calls
  the generator if the operator desires fully automated weekly
  generation; for v1 the operator-triggered path is sufficient.
- **For-of-cooldown logic lives in the RPC**, not the application
  code. The application can call insert_anticipation_hint from any
  caller surface (operator script, admin console, future Inngest);
  the 14-day suppression rule is enforced once, at the database.
- **Memory Inspector v2 facts-by-entity count** uses an in-memory
  aggregation over a 5000-row LIMIT pull. Production-grade scale
  (Brief 6 admin console) might add a dedicated count RPC if a
  workspace ever exceeds 5000 active facts.

## Local gates (across PUSHes 1-3)

- `pnpm tsc --noEmit`: clean on every push
- `pnpm vitest run`: 304/304 across 54 files (9 new in rules.test.ts
  for PUSH 1; PUSH 2-3 add no new tests, the surface is mostly UI +
  thin RPC wrappers covered by existing tests)
- `pnpm qa:basquio`: clean
- `pnpm --filter @basquio/web build`: green on all 3 pushes
  (BAML lesson held; one ESLint react/no-unescaped-entities error
  caught + fixed before PUSH 2 landed; pre-commit em-dash audit
  caught two formatDate fallback dash characters in
  workspace-memory-inspector.tsx and rejected the first PUSH 2
  attempt; fixed inline)

## Production verification (post-PUSH 3)

- `supabase migration list --linked` confirms 20260512100000 +
  20260512110000 registered remotely.
- All RPCs verified registered (full-arg call returns P0001 with
  the in-function "actor is required" guard).
- pg_cron extension is NOT enabled on this project; both Brief 4 +
  Brief 5 NOTICE the schedule as skipped on apply. The
  expire_pending_candidates and expire_stale_hints RPCs work
  manually either way; the operator can enable pg_cron via
  Dashboard -> Database -> Extensions and re-run the schedule
  blocks at any time.

## Phase 9 plan (Marco runs)

### Memory Inspector v2

```bash
printf "true" | vercel env add MEMORY_INSPECTOR_V2 production
```

Wait for Vercel redeploy. Visit /workspace/memory. Verify all 4 tabs
render. Pin a rule, edit a rule, forget a rule. Each action should
land an audit row (visible later in Brief 6 admin console).

### Anticipation hints

```bash
printf "true" | vercel env add ANTICIPATION_ENABLED production
```

Then trigger a Monday-morning generation manually (a one-off operator
script or a future admin console action that calls
`generateMondayMorningHints({ workspaceId, userId })`). Verify hints
appear on the workspace home with the 3-hint cap and the dismiss /
snooze / accept buttons work. After dismissing one hint, regenerate;
the dismissed hint with the same cooldown_key should write status =
'suppressed' (visible only to admin) for 14 days.

## Forward pointer

Brief 6 (admin console v1) is the next unblocked work. Reads
memory_audit, memory_workflow_runs, anticipation_hints,
memory_candidates, plus the existing telemetry tables. 5 commits max,
9 read-only routes per spec §10.
