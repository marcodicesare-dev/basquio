---
title: Memory v1 Brief 7 shipped (visible-state polish + production fixes)
date: 2026-04-27
parent: Brief 7 visible-state polish + 2 admin 500s
status: shipped on origin/main, all P0s + all P1s + one P2 polish; the moat is now visible from every workspace surface
---

# Brief 7 shipped (PUSH 1-7)

## Push history

- `dab190f` PUSH 1: P0 fixes (B1 + B2 + B3 + B4)
- `04750d6` PUSH 2: Memory Inspector Facts tab humanization (B5)
- `5c9a7ad` PUSH 3: Knowledge -> Memory vocab sweep (B6)
- `b4e3003` PUSH 4: per-file brand-book gating (B7)
- `897fa84` PUSH 5: home memory card + admin/inspector copy sweep (B8 + B9)
- `ecb5c4e` PUSH 6: visible 3-dot row menus on Memory Inspector (B10)
- (this PUSH 7) admin sidebar polish (B12) + closeout doc

7 of 7 budget consumed.

## Defect status

| ID | Severity | Status | Surface |
|---|---|---|---|
| B1 | P0 | fixed (PUSH 1) | /admin/runs schema mismatch (chat_tool_telemetry workspace_id / finished_at / latency_ms) |
| B2 | P0 | fixed (PUSH 1) | /admin/cost workspace bucketing through workspace_conversations |
| B3 | P0 | fixed (PUSH 1) | timestamp leak in workspace-home suggestion chip |
| B4 | P0 | fixed (PUSH 1) | hint banner empty-state mounting |
| B5 | P1 | fixed (PUSH 2) | Facts tab predicate / object renderer + click-to-filter subject |
| B6 | P1 | fixed (PUSH 3) | Knowledge -> Memory across user-facing strings; semantic memory_type renamed to Context |
| B7 | P1 | fixed (PUSH 4) | per-file brand-book gating with default-OFF + cost copy |
| B8 | P1 | fixed (PUSH 5) | "Your workspace remembers" card on workspace home |
| B9 | P1 | fixed (PUSH 5) | admin + inspector empty-state copy sweep |
| B10 | P1 | fixed (PUSH 6) | visible 3-dot row menus on Entities + Rules |
| B11 | P2 | deferred | "COULD NOT READ" sources collapse; out of Brief 7 scope per the brief |
| B12 | P2 | fixed (PUSH 7) | admin sidebar logo + per-route Phosphor icons + user pill |
| B13 | P2 | deferred | date-format consistency sweep; broad surface, more risk than this brief allows |
| B14 | P2 | covered by B5 | subject click-through on Facts tab |

## Smoke results

Local gates green at every push:

- `pnpm tsc --noEmit` clean
- `pnpm vitest run` 304/304 across 54 files (one self-caught regression on PUSH 6: orphan `return (` from a partial Edit; tsc caught it pre-push)
- `pnpm --filter @basquio/web build` clean (BAML externalize lesson held)

Production smoke after each Vercel redeploy:

- /admin/runs and /admin/cost return 200 for the super-admin session and render the new column-mismatch-free shell.
- Workspace home shows the new memory card above the suggestion chips. The broken "Use 2026 04 25T14 53 59 705Z..." chip is gone (the timestamp filter in formatMemoryLabel rejects ISO-8601 paths up front).
- /workspace/memory page header reads "Memory" everywhere; the legacy `Knowledge` kicker / breadcrumb is gone. Browser tab title is "Memory · Basquio".
- /workspace/sources drops the session-level checkbox; PDFs land in a per-file review queue with default-OFF brand-book toggle. The submit button shows the cost-relevant breakdown.
- Memory Inspector Facts tab renders predicates as human phrases ("rows in extract", "stakeholder of") and object payloads as one-line sentences. Subject column is click-through with a filter chip. Document-shaped subjects render with a small ▤ marker.
- Memory Inspector Entities + Rules each have a visible 3-dot menu trigger; the Pin / Edit / Forget actions on Rules and the "Show facts" action on Entities are reachable on first sign-in.
- Admin sidebar now shows the basquio icon + per-route Phosphor icons + a user-email pill at the bottom. Matches the workspace-shell visual density.

## Architectural notes

- No new feature flags. No new tables. No new RPCs. No new architecture. Brief 7 was pure UX polish + 2 production-bug fixes against the existing surface area, per the constraint.
- No deck-pipeline changes. The hard-stop list around `anthropic-execution-contract.ts / system-prompt.ts / cost-guard.ts / generate-deck.ts` held.
- The column-mismatch class (Brief 6 PUSH 5 caught one instance of it; Brief 7 PUSH 1 caught three more) is now documented as a sweep responsibility on every cross-table dashboard.
- `MEMORY_TYPE_LABELS.semantic` renamed from "Knowledge" to "Context" so the three memory-type labels (Instructions / Context / Examples) stay distinct from the page-name "Memory". The DB column `memory_entries.memory_type = 'semantic'` is unchanged.

## Promotions to canonical-memory

The Brief 7 substrate audit + PUSH 1 commit message added one new pattern note:

- "memory_audit and memory_workflow_runs use occurred_at and started_at; chat_tool_telemetry has NO workspace_id (resolve via workspace_conversations.id), uses completed_at (not finished_at) and duration_ms (not latency_ms). Future cross-table aggregations must consult the right column per table; the safeCountByTime helper from Brief 6 PUSH 5 is the canonical pattern."

This sits next to the Brief 6 PUSH 5 column-mismatch finding. Two siblings now in canonical-memory; the next agent who touches admin loaders has both reference points.

## Open issues

P0: none.

P1: none.

P2 (deferred from Brief 7):
- B11: 7 of 21 sources show "COULD NOT READ". Out of Brief 7 scope per the brief; the PDF parser failure is an existing-feature concern, not a Memory v1 surface. Future polish brief can collapse "could not read" rows behind an expandable section.
- B13: date format inconsistency across surfaces. Mechanical sweep but multi-file; risk-managed by deferral. Future polish brief can pick one convention (relative for less than 24h, "Apr 24" for older) and apply uniformly via a date-utils helper.

## Pointer to first Italian mid-market CPG demo

Memory v1 ships visible. The four flags are on. The four moat surfaces are demo-ready:

- Workspace home tells the analyst what the workspace remembers in one card.
- Memory Inspector reads as a consultant artifact: human predicate phrases, source-cited rules, click-through entity facts, visible row actions.
- /admin renders without 500s; the operator can drill from chat turns to audit log to drift to cost in three clicks.
- Brand-book upload is one-PDF-at-a-time with default-OFF and a cost-aware confirmation; no $30 misclick.

Next strategic effort is sales motion: outreach to Amadori, illycaffè, GranTerre, Alce Nero, and the narrow Mondelez slice. Engineering work is paused after Brief 7 ships.
