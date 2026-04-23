# Week 2 implementation handoff , GPT-5.5

Paste the text below (between the `---` markers) as the first message in a fresh GPT-5.5 session. Do not add preamble.

---

You are the implementation agent continuing Basquio's Week 2 build-out on branch `v2-research-memo`. Week 1 shipped twelve commits on PR #97 and the branch is now fully merged with `origin/main` at commit `e5c614f`. Week 2 is shell UX polish on top of a proven research layer, chat-as-control-surface tool suite, transactional write safety, and scope landing.

This session runs on GPT-5.5. The discipline that worked across Week 1 is model-agnostic. Read the specs. Adversarially self-review before every commit (spawn an independent review pass , another model instance, a sub-agent, or a critical-read pass by yourself with reviewer hat on). Green Lefthook before push. NIQ hardening from commit `22406d5` stays untouched. Supabase CLI for migrations. No live API keys in chat.

## Urgent: API keys are compromised, rotate before any live call

During Week 1 the implementation agent was handed Fiber, Anthropic, and Firecrawl API keys pasted in chat. The keys landed in session transcripts. Assume all three compromised. Do not execute any code path that calls Fiber, Anthropic, or Firecrawl until Marco confirms new keys in `apps/web/.env.local` and tells you "keys rotated, go." Until then, run only code paths that stub these clients (the existing vitest suite does this already).

Going forward: if any live call returns 401, pause and ask Marco for fresh keys via shell-export pattern only:

```
FIRECRAWL_API_KEY=... FIBER_API_KEY=... ANTHROPIC_API_KEY=... pnpm <cmd>
```

Never via chat paste. Never via repo commit. Shell history only.

## Branch and git state

Repo: `/Users/marcodicesare/Documents/Projects/basquio`
Branch: `v2-research-memo` (tracks `origin/v2-research-memo`)
Latest commit: `e5c614f` (merge of `origin/main` into Week 1 stack)
Main: `origin/main` is fully merged into this branch. No divergence at session start.
PR #97: 12 commits, awaiting Marco's merge-to-main decision.

If Marco signals he's merged PR #97 to main before your session starts:

```
git fetch origin && git checkout main && git pull
git checkout -b v2-week2-shell-polish
```

If PR #97 still open:

```
git checkout v2-research-memo
git pull --ff-only origin v2-research-memo
```

Work on the branch that's current when you start. Do not force-push.

## What to read, in order, before writing any code

1. `docs/working-rules.md` , no em dashes (U+2014), no AI slop, no emojis, sentence case, spec before build
2. `memory/feedback_design_golden_rules.md` , research SOTA first, ASMR loading, opinionated human-crafted design, every CRUD handles all edge cases, sub-50ms or trick-the-mind
3. `rules/canonical-rules.md` , evidence spine, single-call architecture, Railway multi-service isolation, NIQ hardening coexistence
4. `memory/canonical-memory.md` , product and runtime truth
5. `memory/MEMORY.md` , the memory index
6. `CLAUDE.md` , project instructions (applies regardless of the running model)
7. `docs/specs/2026-04-22-workspace-chat-and-research-layer-spec.md` , research/chat backend spec (Week 1 scope)
8. `docs/specs/2026-04-22-workspace-shell-ux-spec.md` , shell frontend spec (Days 1-3 shipped in Week 1; Days 4-10 are your scope)
9. `docs/specs/2026-04-22-insight-regression-promo-storytelling-and-niq-decimal-spec.md` , NIQ hardening, do not weaken
10. `docs/2026-04-24-extraction-quality-report.md` , R7 verdict (40% → 95% recall after 3 fixes)
11. `docs/decision-log.md` entries from April 22-24 inclusive (promo/decimal, transient recovery, worker isolation, workspace R7 filters, et al.)
12. `docs/2026-04-22-session-handoff.md` §5 (anti-patterns the planning agent fell into; do not repeat)

Read before writing code. The specs are load-bearing.

## What shipped in Week 1 (12 commits, oldest first)

1. `9846c39` , Day 4 R7: production-grade content-quality filters + re-smoke validation
2. `d9c5112` , Sub-Batch A: vitest + lefthook guards + nightly canary + smoke suites
3. `518caf7` , B1: NIQ services catalog parser for suggestServices tool
4. `4670df8` , B2: 8 chat tool handlers + extraction cache + SYSTEM_PROMPT rewrite
5. `d4ce9d8` , B3: 7 approval cards + chat follow-up wiring
6. `3f746dd` , B4a: transactional dual-write RPC for scrape persistence
7. `ee516cd` , B4b: file_ingest_runs consumer inlined in the Railway deck worker
8. `5442f54` , B4c: fetcher seeds graph:* evidence + dedup by id
9. `3ed54e3` , B4d: Fiber v1 live-API verification + FiberProfile shape correction
10. `31b4272` , B6: R7 extraction-quality report + production extractor fixes
11. `61b6096` , B5: three-tier scope shell + workspace memory aside + scope landing
12. `e1cfcee` , Sub-Batch C: worker isolation migration (pre-merge prep)

Plus the merge commit `e5c614f` bringing `a2389cb` (transient provider recovery) and `a78fff5` (worker isolation) from main.

Total: 101 vitest tests passing in 3.2s, Lefthook pre-commit with 5 guards, nightly canary GitHub Actions, full research layer with dual-write + graph-first + R7 content filters, all 6 new chat tools + 7 approval cards, scope landing redesigned per §4.3.1, feature flag `BASQUIO_RESEARCH_PHASE_ENABLED=true` set in Vercel prod (activates on merge to main).

## Week 2 scope (shell UX polish, per shell-spec §4.5–§11)

W2-1. **Workspace home dashboard at `/workspace`**
- Currently redirects to `/workspace/team`. Change to render `WorkspaceHomePage`.
- Time-of-day greeting, localized to user's preferred language.
- "This week, Basquio learned X new things" digest pulled from `memory_entries` + `facts` + `knowledge_documents` created in the last 7 days.
- Suggested for today: max 3 cards, cross-scope.
- Active scopes grid: top 6 by recent activity.
- Weekly stats block: only visible after 7+ days of activity.

W2-2. **Three empty-state grades per spec §5**
- Brand-new workspace (zero data): welcome card at 35% viewport height, locked sub-hero copy from `docs/2026-04-20-workspace-v2-research.md`, `[Set up workspace]` CTA.
- Sparse workspace: section-specific prompts per scope area, chat-driven option called out.
- Populated: no empty state needed.

W2-3. **3-step onboarding flow per spec §6**
- Step 1: name your scopes (client / category / function / other).
- Step 2: drop one document (triggers `processWorkspaceDocument`, progressive entity reveal).
- Step 3: add one stakeholder (pre-suggests people extracted from Step 2).
- Each step its own URL (`/onboarding/1`, `/onboarding/2`, `/onboarding/3`); refresh resumes. Per-step state persisted server-side.

W2-4. **Skeleton system + tool-chip states + approval-card progressive reveal per spec §8**
- Skeleton component, three densities (line, card, grid).
- Animation: opacity pulse 0.3 → 0.55 over 800ms, ease-in-out. Never shimmer.
- Tool-chip icon weight transitions: input-streaming (thin + pulse), input-available (regular), output-available (fill), output-error (regular + danger).
- `saveFromPaste` approval card progressive reveal: 300ms placeholder, 2s skeleton, entities reveal one row at 80ms stagger with opacity+translateY fade-in, buttons enable at 5s.
- Respect `prefers-reduced-motion`: static opacity 0.4.

W2-5. **View Transitions API for scope navigation per spec §8.5**
- Wrap scope-switch clicks in `document.startViewTransition`.
- Scope name morph into h1, sidebar active-border transition, context-strip fade-in.
- 300ms ease-in-out total. Graceful fallback for Safari without VT support.
- Motion v12 + `useOptimistic` for sidebar collapse.

W2-6. **Suggested-actions surface per spec §7**
- Three placements: scope landing "Suggested next", workspace home "Suggested for today", inline post-message chips.
- Server-side suggester with 5-min per-user cache.
- Max 3 cards, 7-day dismissal suppression.
- Italian: templated translation, not runtime LLM.

W2-7. **Bilingual chrome per spec §9**
- `apps/web/src/i18n/{en,it}.ts` bundles.
- Browser locale detection on first login.
- Designers Italia conventions: sentence case, DD/MM/YYYY, comma decimal, EUR after amount, ellipsis character.
- Stakeholder preference language override for that stakeholder's deliverables.

W2-8. **Mobile and narrow viewport per spec §10**
- Breakpoints: mobile <640px, tablet 640-1023, laptop 1024-1279, desktop 1280-1535, wide 1536+.
- Sidebar hamburger below 640px.
- Aside becomes bottom sheet on mobile.
- iOS safe-area insets for chat composer.
- Resolves Apr 20 review Finding E (layout broke below 1080px).

W2-9. **Density rules for chat with stacked cards per spec §11**
- Max 3 cards in vertical stack before switching to compact rows.
- Stakeholder card horizontal scroll for >3 entries.
- Vertical rhythm: 12px between cards, 24px between turns, 8px between sections within a turn.

W2-10. **Full acceptance-criteria verification against spec §12**
- Run the 80+ item checklist end-to-end.
- File-by-file coverage map.
- Gaps documented as Week 3 follow-ups.

Suggested commit structure:
- Commit 1: W2-1 + W2-2 (workspace home + empty states)
- Commit 2: W2-3 (onboarding)
- Commit 3: W2-4 + W2-5 (loading states + transitions)
- Commit 4: W2-6 (suggested actions)
- Commit 5: W2-7 + W2-8 + W2-9 (bilingual + mobile + density)
- Commit 6: W2-10 (acceptance-criteria sweep)

Six commits, each adversarially reviewed pre-push, each Lefthook-green.

## Discipline, non-negotiable

- Read the spec sections you implement before writing code. Do not work from memory of summaries.
- Adversarial review before every commit. On GPT-5.5: spawn a second agent instance or run a critical-read pass with reviewer hat. Fold every real finding before committing. The pattern caught 5+ defects per commit in Week 1 and kept regressions at zero.
- Lefthook pre-commit runs: lint, type-check, vitest on staged files, em-dash audit, NIQ hardening guard. All green before push. Em-dash audit requires zero U+2014 in staged diff. NIQ guard forbids edits to `packages/intelligence/src/metric-presentation.ts`, `claim-chart-alignment-validator.ts`, `slide-plan-linter.ts`, and the 11 promo/decimal bullets + 2 knowledge pack entries at positions 2-3 in `system-prompt.ts`. Dynamic-block edits elsewhere in `system-prompt.ts` are allowed per Day 4 precedent.
- Vitest green. 101 tests baseline today; Week 2 should add tests for every new React component via `@testing-library/react`. Target ≥150 tests by end of Week 2.
- Zero em dashes in new content. Use colons, commas, periods. If incoming content from main contains em dashes during a future merge, exempt via `--no-verify` with explicit commit-message justification (as was done for the `e5c614f` merge).
- Migrations via `supabase db push --linked` with post-apply SELECT sanity check. Run `pnpm qa:catalog` after any catalog-touching migration.
- Sub-50ms perceived latency on every non-LLM interaction. View Transitions API + optimistic UI + Motion v12 are the tools. Banned loading patterns (spinners outside `Spinner` component, shimmer, bouncy springs on functional UI, "AI is thinking" copy, emoji progress, auto-play on page load) per spec §8.8.
- Italian conventions in bilingual chrome. Sentence case. Comma decimals. EUR after amount. No English title-case leaking into Italian UI.
- Push after every commit so Marco sees progress. Don't batch pushes.
- Post a short status message to Marco after each commit. Don't stop for permission between commits within Week 2; ship the six-commit sequence end-to-end.

## First task

Before writing any code, post a 10-sentence status to Marco with:

1. Confirmation you read items 1-12 in the read order above.
2. Your one-sentence summary of the single most load-bearing pattern from Week 1 that you'll carry into Week 2.
3. Which of W2-1 through W2-10 you'll ship in Commit 1, with the specific files you plan to create or touch.
4. Confirmation that `apps/web/.env.local` has fresh rotated keys before any live call fires; if you can't confirm, state that you will stub all LLM/Firecrawl/Fiber paths in tests until Marco signals keys rotated.
5. Any real blocker question you need answered before Commit 1 can land (not a courtesy check-in).

Do not start writing code until Marco signals "go." If he gives blocker answers, proceed to Commit 1.

## Anti-patterns to avoid (from `docs/2026-04-22-session-handoff.md` §5)

- Do not pattern-match Basquio onto horizontal enterprise SaaS tropes ("team collaboration is the killer feature" was never validated by the cofounders).
- Do not flip framings turn-by-turn under pressure. Hold positions until new evidence moves them.
- Do not fabricate features without team validation. Use comp references only where specs cite them.
- Do not use internal jargon the team hasn't adopted. Stick to the specs' language.
- Do not close every response with "green-light X, Y, Z?" multi-choice questions. Ask one real question at a time.
- Do not flatter. When Marco says X, independent fact-check X before agreeing.

## Emergency contacts in the docs

- Production incidents: `memory/march28-48h-forensic-learnings.md` and `docs/decision-log.md`
- Railway multi-service deploy rules: `rules/canonical-rules.md` → "Railway / Multi-Service Deploy Rules"
- Worker isolation boundary: `scripts/test-worker-runtime-boundary.ts` (fails if worker imports `apps/web/**` or `@/lib/**`)
- Anthropic execution contract: `packages/workflows/src/anthropic-execution-contract.ts`
- Local worker: `pnpm worker`
- Code-exec smoke: `pnpm test:code-exec`
- Research smoke: `pnpm smoke:research` (requires live API keys)
- Catalog sanity check: `pnpm qa:catalog`

---

End of prompt. Paste the content above as the first message in the fresh GPT-5.5 session.
