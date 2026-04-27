---
title: Memory v1 Brief 6 shipped (admin console v1)
date: 2026-04-27
parent: 2026-04-25-codex-handoff-briefs.md (Brief 6)
spec: 2026-04-25-sota-implementation-specs.md §10
status: code on origin/main, all 9 routes live behind super_admin gate. Marco is the only super_admin.
---

# Brief 6 shipped (PUSH 1-4 of 5)

## Commits

- `1ba639a` Brief 6 PUSH 1: super_admins migration + admin layout shell + auth helper + Overview
- `242e32a` Brief 6 PUSH 2: 4 admin pages (Runs, Audit, Candidates, Hints)
- `5469948` Brief 6 PUSH 3: 4 admin pages (Drift, Cost, Prompts, Skills)
- (this) PUSH 4: shipped doc + canonical-memory promotion

PUSH 5 reserved for one production-ops fix surfaced by first real
admin sign-in (auth-redirect or RLS edge case).

## What shipped (code)

### Migration `20260519100000_super_admins.sql`

- `public.super_admins` table (`user_id` PK referencing `auth.users(id)`,
  `email`, `added_by`, `added_at`, `notes`).
- `public.is_super_admin(_user_id)` SECURITY DEFINER helper (STABLE),
  returns boolean. Reused by future RPCs that need a privileged
  caller check.
- Two seed rows for Marco: `marcodicesare1992@gmail.com`
  (52aa79f4-...) and `marco@basquio.com` (a2dd82d3-...). Either
  session reaches the admin console.

### Admin layout + auth (`apps/web/src/app/admin/layout.tsx`,
`apps/web/src/lib/admin/auth.ts`)

- `getAdminViewerState()` returns one of three states:
  unauthenticated, forbidden, ok. The layout renders different
  shells per state.
- 9 sidebar items per spec §10 routes table. Layout is a 220px
  fixed sidebar + scrollable main pane. `metadata.robots` set to
  no-index/no-follow.

### 9 read-only routes

| Route | Reads | Purpose |
|---|---|---|
| `/admin` | last-7d aggregates from chat_tool_telemetry, memory_candidates, memory_audit, anticipation_hints, memory_workflow_runs | Overview |
| `/admin/runs` | last 100 `__chat_turn__` rows from chat_tool_telemetry | Single-turn replay launcher |
| `/admin/runs/[id]` | one chat_tool_telemetry row + recent tool calls in same conversation | Single-turn debug surface |
| `/admin/audit` | memory_audit filtered by ?table=, ?actor=, ?workspace= | Append-only mutation log |
| `/admin/candidates` | memory_candidates + status counters | All workspaces' Brief 4 candidates |
| `/admin/hints` | anticipation_hints + status counters | Brief 5 hint ledger |
| `/admin/drift` | repeated cooldown_key dismissals (3+ in 30d) + stale pending candidates (>14d) | System-drift signals |
| `/admin/cost` | chat_tool_telemetry aggregated by workspace, last 30d | Per-workspace chat cost |
| `/admin/prompts` | hard-coded registry of 5 prompts shipped on origin/main | Read-only prompt inventory |
| `/admin/skills` | filesystem listing of `skills/` directories with SKILL.md present | Read-only skill inventory |

`apps/web/src/lib/admin/loaders.ts` owns the cross-workspace reads
(service role; the layout already gated the request through
is_super_admin).

### Single-turn replay (`/admin/runs/[id]`)

The most valuable surface per spec §10. Shows:

- Input / output / cache-read tokens
- Total cost
- Classifier intents + active tools
- Workspace / conversation / user IDs
- Tool calls in the same conversation (last 50, with latency_ms,
  status, error_message)

For Brief 6 v1 this is the chat-turn-level replay. Deeper drill
(message thread, raw context pack tokens, BAML extraction trail)
lives in the existing `chat_tool_telemetry` payload columns and can
be surfaced in a future PUSH if Marco needs it during the dry-mode
observation window (Brief 4).

## Architectural notes

- The admin layout is server-side only. No client-side auth token
  re-checks; every request runs through the layout and re-validates
  via is_super_admin.
- `force-dynamic` on every page so Next.js does not try to
  prerender admin content (which would require a service-role
  reader on the build host).
- Error states: each loader is wrapped in try/catch and returns
  empty arrays so the admin surface degrades gracefully when a
  table is missing or empty (e.g., before pg_cron is enabled, or
  before Brief 4 / 5 flags are flipped).
- `/admin/skills` filesystem fallback: when the Vercel runtime
  cannot read the relative `skills/` path, the loader falls back to
  a static list. Future PUSH could read from a dedicated
  `skills_inventory` table if richer metadata is needed.
- No `super_admins` mutation surface. Adding a new admin requires a
  direct SQL INSERT today. A `/admin/admins` add-route is deferred
  to a later brief; super-admin promotion is rare enough that
  shell access is acceptable.

## Local gates (across PUSHes 1-3)

- `pnpm tsc --noEmit`: clean
- `pnpm vitest run`: 304/304 (no new tests; admin pages are
  read-only Next.js components covered by existing test infra)
- `pnpm qa:basquio`: clean
- `pnpm --filter @basquio/web build`: green on all 3 pushes (BAML
  externalize lesson held; one ESLint react/no-unescaped-entities
  caught and fixed before PUSH 2 landed)

## Production verification (post-PUSH 3)

- `supabase migration list --linked` confirms 20260519100000
  registered remotely.
- `super_admins` table queryable. Marco's two user_ids seeded.
- `is_super_admin` registered (calling it with an auth.uid that is
  in super_admins returns TRUE; calling with any other returns
  FALSE).
- `https://basquio.com/admin` redirects unauthenticated users to
  `/sign-in?next=/admin`. Authenticated team-beta users (non-admin)
  see the Forbidden state. Marco signs in and the sidebar +
  Overview render.

## Memory v1 program: SHIPPED

With Brief 6 PUSH 3 live, all six briefs from
`docs/research/2026-04-25-codex-handoff-briefs.md` are shipped
behind feature flags (default false except for the storage
substrate, which is always on as it has no app-side reader behind a
flag):

| Brief | Code | Production state |
|---|---|---|
| 1 | shipped (`c513701`) | substrate live; no app-side reader |
| 2 | shipped (`9006c22`+`ad0ee2b`+`9132e1c`) | CHAT_ROUTER_V2_ENABLED=true on production |
| 3 | shipped (`f69d4f3` + `db169a9`) | BRAND_EXTRACTION_ENABLED=false (waiting for text-rich brand book) |
| 4 | shipped (`f5b35b1`) | CHAT_EXTRACTOR_ENABLED=false (DRY MODE; awaiting 24-48h observation) |
| 5 | shipped (`3517b11`+`ebf8561`+`01a1886`) | MEMORY_INSPECTOR_V2=false, ANTICIPATION_ENABLED=false |
| 6 | shipped (`1ba639a`+`242e32a`+`5469948`) | super_admin gate live; Marco-only |

The dry-mode observation period for Brief 4 is the load-bearing
gate that unblocks the rest of the customer-facing rollout. After
that window closes, flag flips happen in this order: 4 (chat
extractor live), 5 (memory inspector + anticipation), 3 (brand
extraction on first real customer brand book). Brief 6 is already
live for Marco.

## Forward pointer

Memory v1 ships complete; pending external customer onboarding.

- **Brief 4 closeout**: Marco runs 24-48h dry-mode observation,
  computes real FPR + would-have-promoted precision on >=50
  candidates, flips CHAT_EXTRACTOR_ENABLED if metrics pass.
- **Brief 5 closeout**: Marco flips MEMORY_INSPECTOR_V2 to enable
  the 4-tab inspector, then ANTICIPATION_ENABLED to start writing
  candidate hints (vs suppressed shadow ones).
- **Brief 3 closeout**: Marco uploads a text-rich brand book
  (BBC / NHS / Mondelez / Lavazza class) tagged kind='brand_book'
  and flips BRAND_EXTRACTION_ENABLED to verify the rule-count gates
  on real production data.
- **Brief 6 evolution**: spec leaves room for richer admin surfaces
  (deeper turn replay, prompt-edit UI, super-admin add UI). All
  deferred to future briefs once production observation surfaces
  what the operator actually wants.
