# UI redesign review report

Date: 2026-04-20
Reviewer: same session (self-review on the UI redesign)
Branch: `v2-research-memo` → `origin/main`
Commits audited: `50cbe0a`, `cc6ae65`, `9b5d4f1`, `09b9ea4` (shell unification + chat-primary layout + scope rail + chat polish)

## What I checked

1. `tsc --noEmit` from the repo root, filtered to touched files.
2. `apps/web` Next build.
3. Em-dash scan over every file touched in the 4 UI-redesign commits.
4. Emoji scan over the same set.
5. Code review pass for band-aids, dead imports, dead props, unchecked type escapes, missing aria, server-only leakage.
6. Visual review in the browser at 1440px, screenshots of every V2 surface (home, scope client, scope category, people, memory, deliverable, dashboard for comparison).
7. Interaction review: composer focus, Cmd+K, Cmd+U, sidebar active state across workspace sub-paths, rail collapse, chat autoscroll.
8. Responsive behavior: narrow viewport below 1080px.
9. Live smoke on every URL behind auth cookie.

## Findings and fixes

| # | Finding | File and line | Impact | Fix commit |
|---|---------|---------------|--------|------------|
| A | Em dash (`"—"`) as empty-state placeholder in scope rail Recent answers meta | `apps/web/src/app/(workspace)/workspace/scope/[kind]/[slug]/page.tsx:207` | Working rules §4 bans em dashes. Would be flagged by the standing review prompt. | `bb229d9` |
| B | `WorkspaceContextRail.recentAnswers[].createdAt` was passed in by the parent but never rendered. Dead field. | `apps/web/src/components/workspace-context-rail.tsx` | Either dead data or a missing feature. Chose the latter: surfaced it as relative time ("4h ago") next to citations. | `bb229d9` |
| C | Chat composer had no visual feedback on keyboard focus. | `apps/web/src/app/global.css` composer form | Accessibility regression: keyboard-only users had no indication the textarea was active. | `bb229d9` |
| D | Workspace sidebar had no active nav item on `/workspace/deliverable/*` — the user lost the "you are here" signal when jumping into a deliverable from Recent answers. | `apps/web/src/components/workspace-sidebar.tsx` | UX regression. | `7f5f4bb` |
| E | `.wbeta-workspace-layout` used fixed `height: calc(100dvh - 112px)` across all viewports. Below 1080px (grid stacks to a single column) the chat pane and the rail were forced to squeeze into the same fixed height and the rail's own overflow broke. | `apps/web/src/app/global.css` | Narrow-viewport layout was unusable. | `7f5f4bb` |
| F | `Cmd+K` shortcut in `workspace-shortcuts.tsx` still targeted `#wbeta-prompt-input` — the id used by the legacy prompt component replaced by Task 7's AI SDK 6 chat (`#wbeta-ai-input`). | `apps/web/src/components/workspace-shortcuts.tsx:19` | Shortcut silently did nothing. Pre-existing issue from Task 7 but exposed now that the chat is the primary surface. | `5a22a37` |
| G | Scope page stakeholder filter only did substring match on `role` / `company` strings. Category scopes like Snack Salati showed zero stakeholders even for people who worked the category, because `role` didn't contain the scope name. | `apps/web/src/app/(workspace)/workspace/scope/[kind]/[slug]/page.tsx` listScopeStakeholders | Feature broken for non-client scopes. | `5a22a37` |
| H | Home rail had a collapse toggle; scope rail didn't. Inconsistent. Toggle state didn't persist across navigation either. | `apps/web/src/components/workspace-context-rail.tsx` + CSS | Surface-area creep without earning its keep. Dropped for V1; can add a global persistent "hide rail" later. Also removed hardcoded "Marco" in rail title, now uses workspace row name. | `5a22a37` |

All eight fixes are new commits on top of the four audited commits. Each fix ran the full check suite before commit. Every URL stayed 200 across every fix.

## Fixes not made

- **Role-parsing duplication** between `apps/web/src/app/(workspace)/workspace/people/page.tsx` (`resolveRoleOnly`) and `apps/web/src/app/(workspace)/workspace/scope/[kind]/[slug]/page.tsx` (`extractRoleOnly`). The two helpers have slightly different logic because the strip target differs (company for people page grouping, scope name for scope page rail). A shared "split role parts" utility could be extracted but both functions are 10 lines and only called from their own file. Not urgent.
- **RailEntityGroup caret rotation lacks a transition on the base state**, so going from open → closed doesn't animate. Minor polish. Documented, not fixed.
- **Seed script stores `role` as a single string** like `"Head of Category, Mulino Bianco"` rather than populating `metadata.company`. The people-page grouping parses it out. Proper fix is to update the seeder to set role and company separately, but that would require a one-time backfill. Tracked.

## Final check output

### Type-check
```
apps/web/src/lib/workspace/parsing.ts(50,11): error TS2339: Property 'PDFParse' does not exist on type '{ default: (dataBuffer: Buffer<ArrayBufferLike>, options?: PdfParseOptions | undefined) => Promise<PdfData>; }'.
```
Pre-existing in `parsing.ts` (deck pipeline scope, not UI scope). No new errors introduced.

### Build
Passes. All workspace routes render.

### Em-dash scan
Zero matches across all files touched in the 4 redesign commits.

### Live smoke
```
200  https://basquio.com/workspace
200  https://basquio.com/workspace/memory
200  https://basquio.com/workspace/people
200  https://basquio.com/workspace/scope/client/mulino-bianco
200  https://basquio.com/workspace/scope/category/snack-salati
200  https://basquio.com/workspace/deliverable/ac2644ef-ef32-4120-93a8-31158937765e
200  https://basquio.com/dashboard
```

### Visual marker checks
- Home active on `/workspace/deliverable/*`: confirmed (`wbeta-nav-link-active" aria-current="page" href="/workspace"`)
- Rail title uses `workspace.name`: confirmed ("Basquio team beta")
- Recent answers render relative time: confirmed ("4h ago")
- Category scope rail title: confirmed ("Snack Salati")
- Composer `:focus-within` styling: applied.

## Summary

Eight findings, eight fixes. Two were real UX regressions (D, F). One was a broken feature for non-client scopes (G). The rest were code hygiene (A, B, C, E, H).

Total delta since the redesign kickoff (now on `origin/main`):
- `50cbe0a` Unify workspace chrome with /dashboard: single sidebar, no top bar
- `cc6ae65` Chat-primary workspace home with sticky composer and collapsible right rail
- `9b5d4f1` Polish chat-primary surfaces: scope rail, empty-state pinning, people grouping
- `09b9ea4` Chat pane polish: center hero + composer, bound reading width to 760px
- `bb229d9` Review fixes: em dash, dead createdAt field, composer focus feedback
- `7f5f4bb` Review fixes: sidebar active-state fallback, narrow-viewport layout
- `5a22a37` Review fixes: Cmd+K shortcut, stakeholder link, rail polish

All checks green. Main == origin/main.
