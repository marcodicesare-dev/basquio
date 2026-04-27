---
title: Memory v1 Brief 7 substrate audit
date: 2026-04-27
parent: Brief 7 visible-state polish
status: pre-implementation; 4 P0 root causes traced, 6 P1s scoped, fix paths confirmed within Brief 7 commit budget
---

# Brief 7 substrate audit

## Production state at session start

- HEAD `88c6761` (Brief 6 PUSH 5). Status clean (untracked scratch files only).
- Four feature flags ON in production (`vercel env ls`): CHAT_EXTRACTOR_ENABLED, MEMORY_INSPECTOR_V2, ANTICIPATION_ENABLED, BRAND_EXTRACTION_ENABLED.
- basquio.com 200, /workspace 307, /admin 200 (renders sign-in for unauth, shell for super-admin Marco).
- The two admin 500s in the audit (B1 + B2) only fire when an authenticated super-admin reaches the page; unauth probe hits the deny shell which is 200. Code inspection took the place of log-mining.

## P0 root causes traced

### B1 + B2: `chat_tool_telemetry` column mismatch (same class as Brief 6 PUSH 5)

`apps/web/src/lib/admin/loaders.ts` selects three columns that do not exist on `chat_tool_telemetry`:

- `workspace_id`: the table has `user_id` and `conversation_id`, never `workspace_id`. Workspace context lives via `workspace_conversations.workspace_id` (the conversations table).
- `finished_at`: the table column is `completed_at` (per migration `20260424183000`).
- `latency_ms`: the table column is `duration_ms`.

Brief 6 PUSH 5 caught the `memory_audit.created_at` vs `occurred_at` instance and added the per-table-column-aware `safeCountByTime` helper, but missed three other column-name slips in the sibling admin loaders. Same root pattern, different table.

Fix path:
- `listAdminChatTurns`, `getAdminChatTurn`: drop `workspace_id` from the select + type, rename `finished_at` to `completed_at`. Revealed workspace context can be linked separately via the conversation; not needed for the run row.
- `listToolCallsForTurn`: rename `finished_at` to `completed_at`, `latency_ms` to `duration_ms`.
- `aggregateChatCostByWorkspace` (B2): the original implementation selected non-existent `workspace_id` directly. Switch to a two-step query: pull telemetry rows with `conversation_id`, then resolve workspace via `workspace_conversations.id` and bucket. No migration. Falls back to `(unknown)` bucket for orphan rows.

### B3: timestamp leaks into suggestion chip via `formatMemoryLabel`

`apps/web/src/lib/workspace/suggestions.ts:151-163` iterates `memories` and produces a chip with `Use ${label} in the next piece of work.` where `label = formatMemoryLabel(memory.path || memory.memory_type)`. `formatMemoryLabel` strips `_-` to spaces and removes a trailing dotted extension. For a memory whose `path` is a timestamp-shaped string (e.g. `something/2026-04-25T14:53:59.705Z`), the function strips `.705Z` as if it were a file extension and turns the rest into space-separated tokens. Production showed the result: "Use 2026 04 25T14 53 59 705Z in the next piece of work."

Fix path: detect ISO-8601 + UUID + mostly-digit shapes inside `formatMemoryLabel`. When the cleaned label would be unreadable, return null. The caller skips the memory (one fewer suggestion is fine; three slots get filled by the fallback or the next memory).

### B4: hint banner returns null on zero hints

`apps/web/src/components/workspace-hints-banner.tsx` line 24: `if (items.length === 0) return null;`. The component is mounted on the workspace home (`apps/web/src/app/(workspace)/workspace/page.tsx:175 <WorkspaceHintsBanner hints={hints} />`) but renders nothing on first sign-in because no hints have been generated yet (no operator has triggered `generateMondayMorningHints`).

Fix path: render an empty-state when `items.length === 0` instead of null. Quiet copy that explains the surface ("Hints will land here when something is worth your attention this week.") and a small link to /workspace/memory. The banner mounts on every home load whether or not hints exist, which is what the original spec §9 required.

## P1 scoping notes

- B5 (Facts tab): `apps/web/src/components/workspace-memory-inspector.tsx` has `formatObjectValue` which already handles JSON shape but does not recognise the `{file, unit, value}` shape used by the deck pipeline's deterministic workbook evidence. New file `apps/web/src/lib/workspace/predicate-formatter.ts` will hold the predicate map and the object renderer; `tab-facts` consumes both.
- B6 (Knowledge → Memory): grep found 3 user-facing strings to flip (`/workspace/memory/page.tsx` legacy header and breadcrumb when MEMORY_INSPECTOR_V2 is off, plus the page metadata title). The sidebar already says "Knowledge" in the legacy MemoryBrowser header but that copy is owned by the workspace-shell breadcrumb. Sweep is small.
- B7 (per-file gating): `apps/web/src/components/workspace-upload-zone.tsx` currently has the session-level `isBrandBook` checkbox. Rewrite to per-file rows with default-OFF toggles. Brief 3 server-side gating (kind=brand_book triggers extraction inngest) is unchanged; the only change is how `kind` reaches the upload route.
- B8 (home memory card): reuse `listInspectorEntities` / `listInspectorFacts` / `listAllRules` / `listPendingCandidates` (all exist). New `getWorkspaceMemoryCounts(workspaceId)` server helper returns one shape: { entities, facts, activeRules, pendingCandidates }.
- B9 (empty-state copy sweep): 4 admin pages with internal vocabulary ("Brief 5 PART C", "cooldown_key", "via query string"). Sweep is mechanical.
- B10 (visible 3-dot menu): the inspector currently has Pin/Edit/Forget buttons inline. The brief asks for a unified "⋯" trigger that opens a menu. Use a small headless component (no new dep; lucide-react is already in the codebase).

## Anti-bundling discipline

PUSH 1 batches B1-B4 because they are all small and admin-shell + home-only. PUSH 2-7 each handle one P1 concern. No P1 should bundle with P0; no P2 should bundle with P1. Per the disaster-arc rule.
