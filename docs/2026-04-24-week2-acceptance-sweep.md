# Week 2 Workspace Acceptance Sweep

Date: 2026-04-24
Auditor: Codex
Surface: production `https://basquio.com/workspace`, logged in as `marco@basquio.com`

## Ship Map

| Slice | Commit | Coverage |
| --- | --- | --- |
| Chat P0 base layer | `6885760` | Stable citation keys, streaming plain text render, autosizing composer, custom memo comparators, frame budget logger. |
| W2-1 and W2-2 | `9d86127`, `db04a8b` | Workspace home dashboard, populated and empty state grades, suggestion-to-composer interaction. |
| W2-3 | `60c8c38` | Routed 3-step onboarding flow and completion API. |
| W2-4 and W2-5 | `56b7906` | Shared skeletons, reduced-motion handling, sidebar View Transitions API, creation drawer smoke coverage. |
| W2-6 | `ff4b099` | Suggested actions on home, scope landing, and inline post-message chips with 7-day client dismissal. |
| W2-7, W2-8, W2-9 | `12d028d` | Bilingual shell chrome, mobile hamburger and memory sheet, compact stacked chat tool cards. |
| W2-10 | this commit | Acceptance corrections, production audit notes, gap register. |

## File Coverage Map

| Area | Files |
| --- | --- |
| Workspace shell and navigation | `apps/web/src/components/workspace-shell.tsx`, `apps/web/src/components/workspace-sidebar.tsx`, `apps/web/src/app/global.css` |
| Workspace home | `apps/web/src/app/(workspace)/workspace/page.tsx`, `apps/web/src/components/workspace-home-dashboard.tsx`, `apps/web/src/lib/workspace/db.ts`, `apps/web/src/lib/workspace/scopes.ts` |
| Scope chat shell | `apps/web/src/app/(workspace)/workspace/scope/[kind]/[slug]/page.tsx`, `apps/web/src/components/scope-chat-shell.tsx`, `apps/web/src/components/scope-command-palette.tsx` |
| Chat UX | `apps/web/src/components/workspace-chat/Chat.tsx`, `apps/web/src/components/workspace-chat/ChatMessage.tsx`, `apps/web/src/components/workspace-chat/ChatMarkdown.tsx`, `apps/web/src/components/workspace-chat/ToolChips.tsx` |
| Suggested actions | `apps/web/src/components/workspace-suggestions.tsx`, `apps/web/src/lib/workspace/suggestions.ts` |
| Onboarding | `apps/web/src/app/(workspace)/onboarding/[step]/page.tsx`, `apps/web/src/components/workspace-onboarding.tsx`, `apps/web/src/app/api/workspace/onboarding/route.ts` |
| Loading and motion | `apps/web/src/components/workspace-skeleton.tsx`, `apps/web/src/components/workspace-upload-zone.tsx`, `apps/web/src/components/workspace-generation-drawer.tsx`, `apps/web/src/lib/design-tokens/motion.ts` |
| Bilingual chrome | `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/it.ts`, `apps/web/src/i18n/index.ts` |
| Tests | `apps/web/src/components/*.test.ts`, `apps/web/tests/chat-composer-autosize.spec.ts` |

## Acceptance Status

| Spec area | Status | Evidence |
| --- | --- | --- |
| 12.1 Scope route | Superseded | Apr 24 production review rejected the briefing-first scope landing. Current route is chat-first with context in the rail and suggestions as composer pills. See `docs/2026-04-24-workspace-ux-audit.md`. |
| 12.2 Workspace home | Verified | Production `/workspace` is the default route. Greeting, learned count, Suggested for today, Active scopes, recent chats, memory summary, weekly stats, and workspace chat all render. This sweep adds relative updated labels to active scope cards and sorts them by latest activity. |
| 12.3 Empty states | Verified | Component tests cover brand-new, sparse, and populated states. Sparse state uses specific prompts: Add a stakeholder, Upload one brief, Teach one rule. |
| 12.4 Onboarding | Partial | `/onboarding/1`, `/onboarding/2`, `/onboarding/3` exist, refresh resumes from session draft, every step is skippable, and Step 3 creates the scope, stakeholder, and memory entries. Server-side per-step persistence, Step 2 progressive extraction reveal, Step 3 extracted-person pre-suggestions, and automatic explainBasquio after completion remain follow-up work. |
| 12.5 Suggested actions | Verified | Production home and Affinity scope show max 3 suggestions. Use in chat prefilled and focused the composer. Inline post-message chips appeared after a real Affinity scope chat reply. Dismissal is 7-day client localStorage suppression. |
| 12.6 Loading and transitions | Partial | Shared skeletons use opacity pulse and reduced-motion static handling. Sidebar scope navigation uses View Transitions API and skips it under reduced motion. Spinner audit found no new spinner pattern in the workspace work. Motion v12 modal/drawer springs and optimistic persisted sidebar collapse remain follow-up work. |
| 12.7 Bilingual | Partial | Browser locale detection and static `en` and `it` bundles are implemented and tested. Italian number and date helpers are tested. Settings language switch and stakeholder language override for deliverables remain follow-up work. |
| 12.8 Mobile | Partial | CSS breakpoints cover mobile, tablet, laptop, desktop, and wide. Sidebar collapses to a hamburger below 640px. Scope memory aside becomes a bottom sheet on mobile. Composer uses safe-area padding. In-app browser tooling did not expose viewport resize, so real mobile production verification remains follow-up work. |
| 12.9 Density | Partial | Chat tool cards render the first 3 full cards and compact the 4th and later cards under Show all. Vertical turn rhythm is covered in CSS. Stakeholder horizontal overflow and cited-source default collapse remain follow-up work. |
| 12.10 Latency | Verified for changed paths | Local P0 stream perf logged `[stream-perf] avg 8.3ms, 0/5425 frames >16.67ms`. Production audit confirmed non-LLM controls opened or navigated immediately through the in-app browser. Workspace home and suggested actions are server-rendered with cached suggestion generation. |

## Production Audit Notes

| Route | Result |
| --- | --- |
| `/workspace` | Home dashboard rendered with Suggested for today, Active scopes, Recent chats, What Basquio knows, This week, and Workspace chat. Use in chat prefilled composer and enabled Send. |
| `/workspace/scope/client/affinity-petcare` | Scope route is now chat-first with scope context, suggestions, deliverables, and memory in the rail. Production verification for this Apr 24 override is tracked in `docs/2026-04-24-workspace-ux-audit.md`. |
| `/workspace/people` | People index rendered grouped stakeholders and profile links. |
| `/workspace/memory` | Memory index rendered counts, filters, memory entries, and disabled unavailable action controls. Mutating archive, pin, and delete style controls were not clicked. |
| Account menu | Settings and App home links work when clicked as links. Sign out was not clicked. |
| Sidebar creation buttons | New client, New category, and New function open and cancel cleanly. No new scopes were submitted. |

## P0 Chat Audit

| Requirement | Status |
| --- | --- |
| Remove `Math.random()` citation key | Verified in source and test. |
| Stable CitationChip identity on rerender | Verified by Vitest. |
| No ReactMarkdown parse during active stream | Verified by Vitest with mocked `react-markdown`. |
| Autosize composer minRows 1, maxRows 10 | Verified by source, Vitest, Playwright composer height test, and production DOM. |
| Custom memo comparators | Verified in source and render-count test coverage. |
| Before and after recordings | Blocked by local macOS screen recording permissions. `screencapture -v` failed before it could write video. |
| Frame budget | Local 1500-token style stream logged avg 8.3ms and 0 slow frames. |

## Follow-ups

1. Build the active chat landing morph, ESC return, and compact active context header from shell spec 12.1.
2. Move onboarding draft persistence server-side and wire Step 2 extraction reveal to real `processWorkspaceDocument` output.
3. Add Settings language switch and stakeholder language override for generated deliverables.
4. Add Motion v12 drawer/modal spring presets if the product keeps drawer-heavy workflows.
5. Run real-device mobile production QA on iOS Safari and Android Chrome.
