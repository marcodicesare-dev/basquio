# V2 Workspace Independent Code Review — Agent Prompt

Hand this verbatim to a fresh agent (separate Claude Code session, no memory of the build session).

---

## You are reviewing a 10-task product build for spec compliance and production-readiness.

You have full write access to `/Users/marcodicesare/Documents/Projects/basquio`. You can edit, commit, and push. The user's email is `marcodicesare1992@gmail.com`. The domain is `basquio.com`. Team-beta users sign in with `@basquio.com` emails (Marco uses `marco@basquio.com`).

Your job is **not** to nod approvingly. Your job is to find real problems and fix them production-grade. No band-aids. No "looks fine to me."

---

## 1. Context you must load first

Read these before touching anything. They are the contract:

1. **`docs/spec-v1-workspace-v2-research-and-rebuild.md`** — the 8 locked IA decisions and 10-task build sequence. This is the source of truth for what should exist and how it should behave.
2. **`docs/working-rules.md`** — Marco's non-negotiables: no AI slop, no em dashes, no emojis, no progress bars, spec before build, sub-50ms interactions, production-grade visuals, Fibonacci and golden-ratio layout rigor.
3. **`CLAUDE.md`** — codebase-wide rules (V6 deck pipeline context, Supabase project id `fxvbvkpzzvrkwvqmecmi`, environment variables, Anthropic contract).
4. **`git log main -20 --oneline`** — the 10 task commits you are reviewing. They span commits `ea745ba` (Task 7a-e) through `87f8b57` (Task 10). Read each commit message; they describe intended scope.

The 10 tasks you are auditing:

- **Task 1** — `apps/web/src/lib/workspace/constants.ts`, `scopes.ts`, `workspaces.ts`, `types.ts`, `conversations.ts` + migration `supabase/migrations/20260420120000_v2_workspace_tables.sql` — schema + helpers.
- **Task 2** — `apps/web/src/components/workspace-sidebar.tsx`, `workspace-breadcrumb.tsx`, `apps/web/src/app/(workspace)/workspace/scope/[kind]/[slug]/page.tsx` — scope-as-navigation left rail.
- **Task 3** — `apps/web/src/components/workspace-memory-browser.tsx`, `apps/web/src/app/(workspace)/workspace/memory/page.tsx`, memory API under `apps/web/src/app/api/workspace/memory/` — memory browse/edit/add.
- **Task 4** — `apps/web/src/lib/workspace/people.ts`, `people-types.ts`, `apps/web/src/app/api/workspace/people/`, `apps/web/src/components/workspace-stakeholder-editor.tsx`, `apps/web/src/app/(workspace)/workspace/people/` — stakeholder profile pages.
- **Task 5** — `apps/web/src/components/workspace-onboarding.tsx`, `apps/web/src/app/api/workspace/onboarding/route.ts`, workspace home onboarding gate — 4-step guided setup.
- **Task 6** — `apps/web/src/components/workspace-provenance.tsx` and its wire-in to the deliverable page — provenance panel.
- **Task 7** — `apps/web/src/lib/workspace/agent.ts`, `agent-tools.ts`, `apps/web/src/app/api/workspace/chat/route.ts`, `apps/web/src/components/workspace-chat/*` — AI SDK 6 chat with five tools.
- **Task 8** — `apps/web/src/lib/workspace/entity-resolution.ts`, `metaphone.ts`, `scripts/bench-entity-resolution.ts`, `scripts/gen-entity-resolution-corpus.ts`, `scripts/data/entity-resolution-bench.json` — resolution cascade.
- **Task 9** — `apps/web/src/lib/workspace/workspaces.ts` (cloneWorkspace), `apps/web/src/app/api/workspace/clone/route.ts`, `scripts/seed-demo-template.ts` — demo-template + clone.
- **Task 10** — `apps/web/src/app/(app)/jobs/new/page.tsx` (getWorkspaceDeliverablePrefill), `apps/web/src/components/workspace-deliverable-view.tsx` — workspace → deck bridge.

Not every task needs the same depth of review. Calibrate effort to risk.

---

## 2. What "production-grade" means here

Reject and fix, don't tolerate, any of the following:

- **Band-aid fixes.** A try/catch that swallows the error without logging or surfacing it. A zod schema that accepts anything. A console.error with no recovery. A "TODO: fix later" in new code.
- **Scope leakage.** `import "server-only"` modules being pulled into client components (we hit this during Task 3 — verify it hasn't regressed). Check every file under `apps/web/src/components/` that imports from `@/lib/workspace/` — each import must either be a pure types file or the component must be server-only.
- **Dead code.** Functions or exports that aren't called anywhere. Commented-out blocks. Duplicate Zod schemas. Unused state variables.
- **Any emoji** in any committed source file, comment, or user-facing string. Marco's non-negotiable. Only Phosphor or Heroicons components are allowed for visual glyphs. If you find one, remove it and replace with the correct icon component.
- **Em dashes (—) or en dashes (–)** in any committed string. Replace with periods, commas, parentheses, or colons. This includes commit messages authored by the prior agent — you don't need to rewrite history, but new commits you make should not reintroduce them.
- **"AI slop" phrases**: "dive deep", "leverage", "unlock", "empower", "seamless", "game-changer", "revolutionize", "cutting-edge", "next-generation", "embark on a journey", "at the end of the day". In any copy or comment.
- **Unhandled async rejections.** Every `fetch`, Supabase call, and `await` outside a try/catch that could propagate to user-facing pages must be intentional (documented) or wrapped.
- **Hardcoded UUIDs in the app layer.** The only allowed place for `BASQUIO_TEAM_WORKSPACE_ID` is `apps/web/src/lib/workspace/constants.ts` and the seed migration. Grep for `15cc947e-70cb-455a-b0df-d8c34b760d71` outside those.
- **Security gaps.** Every `/api/workspace/` route must do three things in this order: (1) `getViewerState()` for sign-in check, (2) `isTeamBetaEmail()` for team-beta gate, (3) resource-level ownership check (does the resource belong to the current workspace?). Audit every route under `apps/web/src/app/api/workspace/` and confirm all three layers exist.
- **Type escapes.** `as any`, `as unknown as X`, or unchecked JSON parse that feeds into a rendering path. Replace with zod or a narrow runtime guard.
- **Missing loading / error states.** Every client component that hits the network must render a distinguishable state for the three outcomes: loading, error, empty. Empty state copy must follow Marco's crafted-copy rule (human, not AI-slop).
- **Spec misalignment.** For each of the 8 locked IA decisions in the spec, verify the live behavior matches. Example: Decision 4 says "first-time workspace entry shows a guided flow, not an empty state" — if an empty workspace renders the hero and not the onboarding, that is a spec violation.

---

## 3. Required checks to run (and keep running until clean)

Run these before declaring done, after each fix, and in the final pass:

```bash
# 1. Type-check. Filter to only files you've touched; pre-existing errors in
#    packages/workflows, packages/intelligence, packages/render-pptx are
#    out of scope.
npx tsc --noEmit 2>&1 | grep -v "^packages/" | grep -v "^scripts/seed-workspace-marco" | head -50

# 2. Next.js build. Must pass.
cd apps/web && pnpm run build 2>&1 | tail -30

# 3. Entity resolution benchmark (Task 8). Must exit 0 and meet thresholds.
pnpm exec tsx scripts/bench-entity-resolution.ts

# 4. Seed script (Task 9). Dry-run only unless you need a real mutation.
set -a && . apps/web/.env.local && set +a
pnpm exec tsx scripts/seed-demo-template.ts --dry-run

# 5. Emoji and em-dash grep. Must return nothing in the 10 task files.
#    Use Grep tool, not Bash grep.
#    Pattern for emojis: [\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]
#    Pattern for em-dash: — (U+2014)   en-dash: – (U+2013)
#    Scope: apps/web/src/components/workspace-*.tsx,
#           apps/web/src/components/workspace-chat/**,
#           apps/web/src/lib/workspace/**,
#           apps/web/src/app/(workspace)/workspace/**,
#           apps/web/src/app/api/workspace/**,
#           scripts/bench-entity-resolution.ts,
#           scripts/gen-entity-resolution-corpus.ts,
#           scripts/seed-demo-template.ts

# 6. Live verification. Re-auth each time — cookies expire after 3600s.
./scripts/auth-as-marco.sh
for url in \
  "https://basquio.com/workspace" \
  "https://basquio.com/workspace/memory" \
  "https://basquio.com/workspace/people" \
  "https://basquio.com/workspace/scope/client/mulino-bianco" \
  "https://basquio.com/workspace/deliverable/ac2644ef-ef32-4120-93a8-31158937765e" \
  "https://basquio.com/jobs/new?deliverable=ac2644ef-ef32-4120-93a8-31158937765e"
do
  code=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/marco-sb-cookie.txt "$url")
  printf "%s  %s\n" "$code" "$url"
done
# Every URL must return 200.
```

Keep running these in a loop. Each fix you make, rerun the affected checks. Do not declare the review complete while any of them shows a problem in your touched files.

---

## 4. Spec-compliance checklist (walk through each, do not skip)

For every item: open the relevant file, confirm the behavior matches. If any diverges, fix the code, not the spec.

### Decision 1 — Scope-as-navigation (spec §3.1)
- [ ] `WorkspaceSidebar` renders Home / Clients / Categories / Functions / People / Memory as a persistent left rail
- [ ] No scope chip inside the prompt (the prompt is scope-aware via its parent page, not via an explicit dropdown)
- [ ] Cmd+K is a documented shortcut and actually focuses the prompt (test it in a browser if possible, or grep for the key handler)

### Decision 2 — Chat surface (spec §3.2)
- [ ] Uses AI SDK 6 (`ai@^6.x`, `@ai-sdk/anthropic@^3.x`)
- [ ] `streamText` → `toUIMessageStreamResponse` → `convertToModelMessages` (the last is async in v6)
- [ ] Five tools: `readMemory` (subtle chip), `teachRule` (bold card), `retrieveContext`, `showMetricCard`, `showStakeholderCard`
- [ ] Tool rendering: message.parts discriminated-union switch in `ChatMessage.tsx`
- [ ] Rate-limited (spec doesn't mandate a number; current is 12/min/user, which is fine — check it's actually enforced)
- [ ] Conversations persisted on `onFinish`

### Decision 3 — Memory as first-class (spec §3.3)
- [ ] Memory browse page lists by type (procedural / semantic / episodic) and scope
- [ ] Edit-in-place: click a card, edit the body, save without leaving the page
- [ ] Pin / archive / delete actions render per card
- [ ] "Teach a rule" card (user-initiated, bold) is distinct from the agent's subtle chip (readMemory tool)

### Decision 4 — 4-step onboarding (spec §3.4)
- [ ] First-time empty workspace routes to `WorkspaceOnboarding`, not the default hero
- [ ] 4 steps: Role → Scopes → Stakeholders per scope → Seed files
- [ ] Skip button visible on every step
- [ ] Post-setup: workspace.metadata.onboarded_at is set, and the home switches to the new hero
- [ ] New hero copy is exactly "Your analyst memory, always there." with the sub-hero "Basquio knows your clients, stakeholders, and style. Ask a question, get the answer your client expects. Every answer cites where it came from." (Decision 6)

### Decision 5 — Provenance panel (spec §3.5)
- [ ] Every ready deliverable opens with a summary strip: "Based on X source excerpts · Y grounded facts · Z memory rules"
- [ ] Strip is a click-to-expand, not a permanent wall of text
- [ ] Expanded panel shows per-citation: label, source type, filename, excerpt
- [ ] Failed generations do not show the panel

### Decision 7 — Demo-template + clone (spec §3.7)
- [ ] `workspaces.kind` enum has a `demo_template` value
- [ ] A demo template workspace exists in production (id `8ef04863-d24e-4bc5-84cc-245a19697ef5`)
- [ ] POST `/api/workspace/clone` accepts `{template_id, name, slug, visibility}` and returns `{workspace_id, name, slug, template_id}`
- [ ] Clone is a deep copy: scopes (with remapped parent_scope_id), entities (with remapped workspace_id), memory_entries (with remapped workspace_scope_id)
- [ ] Clone does NOT copy deliverables, documents, or facts (those belong to the user who generates them)

### Decision 8 — Deck bridge (spec §3.8)
- [ ] "Generate deck" button visible on every ready deliverable
- [ ] Clicking navigates to `/jobs/new?deliverable=<id>`
- [ ] `/jobs/new` fetches the deliverable and prefills the `GenerationForm` (brief.businessContext = body_markdown, brief.client = scope, brief.objective = prompt)
- [ ] Prefill only fires when `recipePrefill`, `fromRunPrefill`, and `templateFeeDraftPrefill` are all absent (no clobbering)

### Entity resolution (Task 8, spec'd separately)
- [ ] 4-stage cascade spec'd: alias → Metaphone → embedding → Haiku tiebreak. The shipped cascade has 7 stages (exact, alias, token_set, initials, metaphone, similarity, haiku). That is a superset and is acceptable *if* the embedding stage is actually present or there is an explicit justification in the code for omitting it. The current `similarity` stage is Levenshtein, not embedding cosine — decide: is this a spec gap that should be filed as BAS-(next), or a scope-down that is fine to ship as-is? Document your call.
- [ ] Benchmark passes 90% precision / 85% recall (current: 98.84% / 100%). Run the benchmark and confirm.
- [ ] Resolver is pure (no Supabase dependency). Test this by running the benchmark outside the Next.js environment — if it crashes on `server-only`, that's a regression from this review onwards.

---

## 5. Workflow for fixing findings

When you find something to fix:

1. **Name the finding** precisely. File path, line number, specific behavior or divergence.
2. **Describe the impact.** What breaks, who sees it, what the user-visible symptom is. If you cannot describe an impact, the "finding" is probably not a finding.
3. **Fix it production-grade.** No wrapper try/catches that swallow. No `// TODO`. The fix must be the change you would ship to customers.
4. **Type-check + build + benchmark** after each fix. If any of them regresses, your fix is wrong — revert and try again.
5. **Re-run the live smoke (step 3.6).** If a URL that was 200 is now non-200, your fix broke a surface — revert or complete the fix before moving on.
6. **Commit in small chunks.** One logical fix per commit. Message format: `Review fix: <what>` plus a body explaining the finding and the impact.
7. **Push.** After each commit.
8. **Loop.** Go back to step 4 (run all checks). Keep looping until a full pass produces zero new findings.

Do not batch all fixes into one giant commit. Do not skip the live smoke between fixes. Do not stop while any check is still failing.

---

## 6. What to deliver

When the loop terminates (all checks clean, zero outstanding findings):

1. A final commit with message `Review complete: <N> findings fixed, all checks green` whose body lists each finding (one line each) and the commit sha that fixed it.
2. A short Markdown report at `docs/2026-04-20-v2-workspace-review-report.md` with:
   - Summary of what you checked
   - List of findings (name, file:line, impact, fix commit sha)
   - Any spec gaps you identified but chose not to fix (with justification)
   - The final benchmark numbers (precision, recall, F1)
   - The final live smoke output
3. A push to origin/main.

The report goes on origin/main under `docs/`. Do not write a report that says "everything looks great" unless you genuinely checked everything in §3 and §4 and found nothing. A zero-finding report that skipped checks is worse than a report with real findings, because it misleads.

---

## 7. Things you should not do

- Do not rewrite history. No `git rebase -i`, no `git commit --amend` on pushed commits, no force push. Your fixes land as new commits.
- Do not touch the deck pipeline (`packages/workflows/**`, `packages/render-pptx/**`, `packages/intelligence/**`, `scripts/worker.ts`). That is a separate product surface with its own canonical rules in CLAUDE.md.
- Do not add "hardening" for failure modes that do not exist. The `CLAUDE.md` file lists 13 "harden" commits that each introduced a regression — learn from them. Add guards only where a real bug exists.
- Do not lower the entity-resolution benchmark thresholds (90% / 85%) without explicit spec-level justification. If the bench fails, fix the resolver, not the target.
- Do not introduce new emojis, em dashes, or AI-slop phrases in your fixes. The ban applies to you too.
- Do not silently remove features. If you think a feature should be removed, leave a specific note in the report ("removed `X` because `Y`") and commit the removal separately with a clear message.

---

## 8. Kickoff

Start by:

1. `git log main --oneline -15` — orient yourself on the 10 commits.
2. Read `docs/spec-v1-workspace-v2-research-and-rebuild.md` end-to-end.
3. Run the full check suite (§3) once. Every red is a finding. File each before you start fixing.
4. Then walk the spec checklist (§4). File each divergence.
5. Loop (§5) until everything is green.

Go.
