# Workspace UX Audit

Date: 2026-04-24
Audit surface: production `https://basquio.com/workspace`
Account: `marco@basquio.com`
Branch: `codex/chat-ux-p0`

## Summary

The P0 chat defects were fixed before Week 2 shell work shipped. No migrations were required. NIQ hardening files were untouched.

This audit also re-opened production with the in-app browser and found one additional navigation defect: the sidebar View Transitions wrapper could mark a scope link active while leaving the URL and main content on `/workspace/memory`. That is a real UX bug because it makes the rail lie about where the analyst is. It is fixed in the same audit follow-up by letting Next `Link` keep native navigation while the transition call becomes decorative.

The next production review found a separate visual P0: the scope chat composer was implemented as a sticky footer inside a sticky scope card. It appeared smashed against the bottom of the viewport and grew upward over the page. This does not meet the modern composer bar set by Codex, Claude, Notion, Legora, or Conductor-style work surfaces. The fix is to make the scope chat a static workbench section, then center a padded input dock inside it. Composer growth now expands the workbench instead of colliding with the viewport.

The orchestrator review after `ac53e36` correctly found that the composer was now crafted but the route shell was still wrong. The scope page stacked five briefing sections before the input, which kept chat as a secondary footer action. The Apr 24 requirement now supersedes the Apr 22 scope-landing spec: scope routes are chat-first, with metadata, stakeholders, recent deliverables, suggestions, and memory moved into a right rail. Suggested actions are composer pills, not a card section.

SOTA references used for the override:

- OpenAI Codex web: Codex is a cloud task surface where the user delegates work from the primary task composer, not after reading a dashboard. `https://developers.openai.com/codex/cloud`
- Claude Code interactive mode: prompt suggestions appear directly in the input workflow and disappear when the user starts typing. `https://code.claude.com/docs/en/interactive-mode`
- Notion Agent: actions, sources, uploads, model controls, and chat mode live inside the agent chat panel, including a sidebar mode. `https://www.notion.com/help/notion-agent`
- Legora: positions the product as a workflow-native AI workspace for review, drafting, and research, not a passive context page before the AI surface. `https://legora.com/`

Current screenshots captured during audit:

- `/tmp/basquio-p0-audit/current-memory.png`
- `/tmp/basquio-p0-audit/current-affinity-scope.png`
- `/tmp/basquio-p0-audit/current-affinity-chat-after-send.png`
- `/tmp/basquio-p0-audit/current-chat-composer-before-redesign.png`
- `/tmp/basquio-p0-audit/current-chat-composer-after-redesign-full.png`

Video capture note: macOS screen recording from the agent process was blocked by local permissions, so the 15-second before and after videos could not be captured from this environment. The live browser and programmatic DOM audit did run.

## Golden Rule Compliance Matrix

| Defect | File | Rule violated | Before measurement | After measurement | Live verified |
| --- | --- | --- | --- | --- | --- |
| Math.random in citation key | `apps/web/src/components/workspace-chat/ChatMarkdown.tsx` | Rule 5, frame budget | Key changed every render, forcing CitationChip remounts during stream | Stable citation index keys. Local stream perf logged avg 8.3ms, 0/5425 frames above 16.67ms | Yes, source and prod chat audit |
| Markdown parse per token | `apps/web/src/components/workspace-chat/ChatMessage.tsx`, `ChatMarkdown.tsx` | Rule 2, smooth loading | ReactMarkdown parsed the whole accumulating answer on every token | Active stream renders pre-wrap text, markdown renders once when complete | Yes, prod chat completed and rendered final actions |
| Fixed 3-row textarea | `apps/web/src/components/workspace-chat/Chat.tsx`, `apps/web/src/app/global.css` | Rule 3, crafted composer | Raw textarea with manual vertical resize | `react-textarea-autosize` with minRows 1 and maxRows 10 | Yes, source, tests, prod DOM |
| Theatrical memo wrappers | `ChatMessage.tsx`, `ChatMarkdown.tsx` | Rule 5, unnecessary rerenders | Default shallow memo failed on new AI SDK object refs | Custom comparators based on cheap identity and text length | Yes, render-count tests |
| Workspace surface audit | Workspace routes | Rules 2, 3, 5 | No single live audit artifact existed | This file documents route status, banned loading checks, and deferred gaps | Yes, in-app browser |
| Sidebar transition traps navigation | `apps/web/src/components/workspace-sidebar.tsx` | Rule 5, navigation must feel instant and truthful | From `/workspace/memory`, clicking Affinity left URL on Memory while the sidebar marked Affinity active | Native `Link` routing restored, transition no longer prevents default navigation | Yes, production route click verified after deploy |
| Scope composer smashed into viewport bottom | `apps/web/src/app/global.css`, `apps/web/src/components/workspace-chat/Chat.tsx` | Rule 3, crafted modern composer | Sticky scope chat plus sticky form made the composer look like a 2005 footer textarea and grow upward into content | Static scope workbench, centered padded composer dock, transparent textarea, compact icon send button | Yes, production five-line composer verified after deploy |
| Scope route still briefing-first | `apps/web/src/app/(workspace)/workspace/scope/[kind]/[slug]/page.tsx`, `apps/web/src/components/scope-chat-shell.tsx` | Rules 1, 3, 5 | Analyst had to scroll past stakeholders, knows, deliverables, and suggestion cards before typing | Scope route uses chat-first pane plus 300px context rail, composer pills, and Cmd-K navigation | Pending deploy verification |

## Route Audit

| Surface | Audit result | Violations or notes |
| --- | --- | --- |
| `/workspace` | Dashboard renders greeting, learned count, suggestions, active scopes, recent chats, memory summary, weekly stats, and chat. Suggestions prefill composer. | Active scope cards now show relative updated labels. |
| `/workspace/scope/client/affinity-petcare` | Scope route is now chat-first: main pane is the conversation, right rail carries scope context, memory, stakeholders, deliverables, and suggestions. | Pending deploy verification for the Apr 24 chat-first shell. |
| Scope chat composer | Before redesign, the chat card floated over the bottom of the viewport and the input grew upward. | P0 visual fix: remove sticky scope chat behavior and use a static centered composer dock with real padding. |
| Sidebar navigation | Creation controls open and cancel. Prod audit found the View Transitions wrapper could trap scope navigation from Memory. | P0 follow-up fix in `workspace-sidebar.tsx`: do not prevent default navigation. |
| `/workspace/memory` | Memory index renders counts, filters, entries, and Pin/Edit/Archive/Delete controls. | Mutating controls were not clicked during audit. No banned spinner, shimmer, emoji loader, or sparkle button pattern found. |
| `/workspace/people` | People index renders grouped stakeholders and profile links. | Profile route should get a deeper editing audit before preference write flows expand. |
| `/workspace/people/[id]` | Profile links are present from the People index and scope landing. | Deferred: audit add-note, preference editing, and destructive flows with explicit user permission. |
| `/workspace/deliverable/[id]` | Recent deliverables link to chat or deliverable routes depending on origin. | Deferred: verify every deliverable action state once generation workflows are stable. |
| Workspace generation drawer | Skeleton states use the shared opacity pulse pattern. | Deferred: Motion v12 spring standardization remains listed in the W2 acceptance sweep. |
| Workspace generation status pill | Existing status chips render without banned loading copy in the audited routes. | Deferred: run a real generation from a non-production test workspace for full state coverage. |

## Banned Loading Pattern Check

| Pattern | Current audit status |
| --- | --- |
| Spinning circles outside dedicated Spinner | No new workspace-shell instance found during audited states. |
| High-contrast diagonal skeleton shimmer | Shared `WorkspaceSkeleton` uses opacity pulse, not shimmer. |
| "AI is thinking..." or loose "Loading..." copy | Not seen in audited workspace routes. |
| Bouncy springs on functional UI | Not seen in audited routes. Motion v12 standardization remains a follow-up. |
| Loading bars for non-deterministic ops | Not seen in audited routes. |
| Emoji loading indicators | Not seen in audited routes. |
| Sparkle, gradient buttons, rainbow underline, glow effects | Sparkle icon appears as static memory affordance, not as a loading effect. No gradient/glow loading effect found. |

## Verification

Automated and local verification already run for the P0 and W2 work:

- `pnpm qa:basquio`: green, 31 files and 130 tests.
- `pnpm qa:catalog`: green.
- `pnpm build`: green, with pre-existing unused-variable warnings.
- `pnpm lefthook run pre-push`: green.
- Production chat audit: Affinity scope chat completed a real smoke-test turn and showed inline suggestions plus answer actions.

This follow-up adds:

- Sidebar navigation fix.
- Sidebar tests that verify scope links keep native href navigation and the transition wrapper does not hijack the route.
- This dedicated audit document requested by the P0 spec.

## Follow-up Priority Register

| Priority | Item |
| --- | --- |
| P0 | Sidebar navigation fix verified in production. |
| P0 | Scope composer visual redesign verified in production. |
| P0 | Deploy and verify chat-first scope shell in production. |
| P1 | Build active chat landing morph, ESC return, and compact active context header. |
| P1 | Move onboarding draft persistence server-side and wire Step 2 extraction reveal to real document processing output. |
| P1 | Add Settings language switch and stakeholder language override for generated deliverables. |
| P2 | Run real-device mobile QA on iOS Safari and Android Chrome. |
| P2 | Deep-audit stakeholder profile write flows, deliverable actions, and generation drawer state transitions with explicit permission for mutating actions. |
