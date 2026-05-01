# Variant J marketing rebuild — session handoff (May 1, 2026)

> Hand-off doc for the next chat. Read this before touching anything in
> `apps/web/`, `apps/web/public/marketing/`, or any branch starting with
> `codex/marketing-variant-j-`. Marco has explicit feedback queued and will
> share more screenshots — the next chat MUST learn from the 14 paths
> (A through N) this session went through.

## What this session was

Marco asked to rebuild the basquio.com marketing comprehension system on
top of the J variant work. The brief was explicit: "treat the previous
attempts as failure cases. The task is not to make another variant. The
task is to rebuild the marketing comprehension system from strategy,
research, visual craft, and browser proof."

The session shipped 14 paths (commits B through N) across 5 variant
branches. Marco gave brutal, accurate feedback at every step. Several
paths shipped real bugs that he caught visually — the next chat MUST
not repeat those mistakes.

## The 5 variant branches

All branched from baseline, sharing all CSS/components, only hero copy
+ CTA priority + hero photo varies per variant.

| Branch | Variant | Hero | Hero photo |
|---|---|---|---|
| `codex/marketing-variant-j-claude-rebuild` | Baseline output-led | "From scattered research files to a finished deck." | memory-context-01 |
| `codex/marketing-variant-j-workspace-led` | Workspace-led | "Your next deck should already know the brief." | memory-context-04 |
| `codex/marketing-variant-j-output-urgency` | Urgency | "The brief changed. The deck is still due." | memory-context-08 |
| `codex/marketing-variant-j-team-led` | Team pilot | "A workspace for teams that ship research outputs every month." | memory-context-02 |
| `codex/marketing-variant-j-italian` | Italian | "Dai file sparsi a una presentazione pronta." | memory-context-06 |

Workflow: edit on baseline → commit → cherry-pick to the other 4 →
push all 5. Italian variant requires manual copy translation when the
cherry-pick conflicts on `apps/web/src/app/page.tsx` (every time).

## Path history (B → N, only the ones that landed)

| Path | What it shipped | Status |
|---|---|---|
| **B** | Composed CSS UI mockups (`marketing-mockups.tsx`, ~340 lines) replacing placeholder SVGs | superseded |
| **C** | Claude Design PNG mockups (slide.png / workspace.png / report.png / workbook.png / security.png) | superseded by SVGs in Path J |
| **D** | Anonymize Pellini → Northstar Coffee, switch to stacked sections | KEEP |
| **E** | Production motion layer (Framer Motion v12 → motion v12). MotionSectionHead, MotionMockupFrame, MotionWorkspaceMockup with cursor + typing + click + spinner + output reveal | KEEP |
| **F** | Scripted workspace demo refined, unified mockup widths to 1180px, hero full-viewport | KEEP |
| **G** | Logo "fix" — DREW OUR OWN CROWN. WRONG. Marco: "i don't understand if you're retarded? there's the official and canonical Basquio favicon logo in the repo." | reverted in H |
| **H** | Reverted to canonical logo, viewport-sized mockups (`min(1440px, 100vw - 64px)`) | KEEP |
| **I** | Locked pricing wireframe (no shift on mode switch), bigger price typography | KEEP |
| **J** | Claude Design SVG mockups (slide / workbook / report / security as scalable SVG, replacing PNGs) — anonymized in-place | KEEP |
| **K** | Slide.svg `%` glyph alignment fix, accent Sign in button, pricing column alignment, FAQ tightened, hero quality 95 | KEEP |
| **L** | HeroDemoFlow — 3-box self-explanatory animation (input files → template → download lights up). Per Rossella's voice note. + bigger hero CTAs (68px) | KEEP |
| **L hotfix** | Tightened hero+demo padding so demo fits above fold | KEEP |
| **L lock-height** | Locked hero-demo boxes to 224px so pills appearing inside don't shift the layout | KEEP |
| **M** | Interactive workspace experiment — clickable projects, clickable suggestion chips, hand-drawn "interactive" callout. **BROKE LAYOUT** | reverted in N |
| **M hotfix** | Tried to lock workspace mockup to 868px to stop click-shift | reverted in N |
| **N** | Reverted Path M entirely. Workspace back to natural 380px height auto-cursor demo only | KEEP |

Current head on baseline: `be347cc9` (Path N revert).

## Mistakes the next chat must NOT repeat

### 1. Don't draw your own logo. Search the repo first.

The canonical Basquio mark exists at:
- `apps/web/public/brand/svg/favicon/basquio-favicon.svg`
- `apps/web/public/brand/svg/icon/basquio-icon-{ultramarine,white,onyx,amber}.svg`
- `apps/web/public/brand/svg/circle/basquio-circle-{onyx,white}.svg`
- `apps/web/public/brand/svg/logo/basquio-logo-{light-bg-blue,dark-bg,light-bg-mono}.svg`

Path: `M 10,95 L 10,5 L 40,65 L 75,5 L 110,65 L 140,5 L 140,95 Z` in
the 150x100 viewBox. THAT is the canonical brand. It looks like
3 mountain peaks because that IS the canonical brand identity.
Do not redesign it without explicit permission.

### 2. Don't ship without actual visual QA.

Local Claude_Preview screenshot tool has known limitations with
motion-animated content past the hero — DOM inspection works but
screenshots show blank cream. Vercel preview URLs are the source of
truth. After every push:
- Wait 2-4 min
- Check via `gh api repos/marcodicesare-dev/basquio/commits/<sha>/statuses`
- Then `curl -s -L <preview-url>` and grep the HTML for the markers
  you expect

### 3. Real prospect names are a legal-blocking issue.

Anonymize ALL of:
- "Pellini Caffè" → "Northstar Coffee"
- "Casa Vergnano" → "Aurora Espresso"
- "Caffè Motta" → "Caffè Belvedere"
- "Molino Andriani" → "Mulini Vetta"
- "Beatrice Pellini" → "Anna Ricci"
- `marco@pellini.it` → `marco@northstar.it`
- `rossella@niq.eu` / `rossella@iq.eu` → `anna@example.it`
- `veronica@victorinox.com` → `luca@example.com`
- `client:Pellini` → `client:Northstar`

These appear in:
- `apps/web/public/marketing/screenshots/{workspace,report,security}.svg`
- `apps/web/src/components/motion-workspace-mockup.tsx` constants
- Any Claude Design output dropped in fresh

Always grep `Pellini|Casa Vergnano|Caffè Motta|Molino Andriani|@pellini|@niq|@iq.eu|victorinox|Beatrice` before commit.

### 4. The em-dash audit is real.

Lefthook blocks commits containing U+2014 (—). Replace with comma,
colon, parenthetical, or period. Claude Design SVGs sometimes contain
em-dashes in body copy — check before committing.

### 5. Wireframe must stay locked when content animates.

Marco's hard rule: "the container and the content wireframe should
always stay fixed when you run animations inside. Otherwise content
shifts and when the animation restarts it is horrible."

Already locked:
- Hero-demo boxes: `height: 224px` + `overflow: hidden`, pill list
  has `min-height: 96px` to reserve space
- Pricing wireframe: `min-height: 480px` + `align-items: stretch`,
  trial slot always rendered with `buying-iface-trial-empty` placeholder

### 6. Don't add interactive layers without solving the layout first.

Path M (interactive workspace) failed because:
- Wrapping LI contents in a `<button>` conflicted with the LI's CSS
  grid (`grid-template-columns: 14px 1fr`) — buttons got stuck in the
  14px column, were 24px wide
- The rail's `grid-template-rows: auto auto 1fr auto` made the
  projects UL stretch, then each LI stretched with it, blowing 47px
  to 103px without `align-content: start`
- Hard-locking workspace mockup height to 868px created the "huge
  empty container" problem
- Hand-drawn "interactive" annotation, while clean in isolation,
  read as accidentally-shipped scribble next to polished CSS

If interactivity comes back, the layout work has to come FIRST. Do
not ship interactive without verifying the wireframe is locked at
exactly the right height (no dead space, no overflow, no shift).

### 7. The lefthook unit-test gate has 4-5 pre-existing failures.

`packages/research/src/filters.test.ts` and
`packages/research/src/clients.test.ts` have flaky/failing tests
unrelated to any UI work. Bypass with `LEFTHOOK=0` only when:
- Diff is purely CSS / JSX / SVG / mockup component changes
- You've verified the failures pre-exist on origin (`git stash` +
  run tests + confirm same failures)
- You note the bypass in the commit message

These should be fixed in a separate session.

### 8. Cherry-pick to all 5 every time.

The flow is:
1. Edit on baseline `codex/marketing-variant-j-claude-rebuild`
2. `LEFTHOOK=0 git commit ...`
3. `for branch in workspace-led output-urgency team-led italian; do git checkout codex/marketing-variant-j-${branch}; git cherry-pick <sha>; done`
4. Italian usually conflicts on page.tsx — manually translate with the
   replacements in the Italian variant (see git log for the Italian
   commits to learn the pattern)
5. `LEFTHOOK=0 git push origin <all 5 branches>`

## What's working and SHOULD STAY

- The 3-box HeroDemoFlow demo with cursor → file pills → template pill →
  spinner → download lights up + 3 artifact pills (Path L)
- The MotionWorkspaceMockup auto-cursor demo (Path E/F, no interactive
  layer)
- 4 Claude Design SVGs in `public/marketing/screenshots/` for slide,
  workbook, report, security (Path J)
- Pricing locked wireframe (Path I)
- Caveat font (Google) loaded for the never-shipped "interactive" label
  (kept on disk in case Marco wants script callouts elsewhere)
- next.config.ts `images: { qualities: [75, 95] }`
- All 5 variants have anonymized data, big hero CTAs (68px), full-bleed
  hero, locked pricing wireframe, scripted hero demo

## Marco's working rules (the ones he reminds me of)

- No em dashes anywhere in copy or commit messages
- No real prospect names (Pellini etc.)
- No emojis ("ABSOLUTE BAN" - see `memory/feedback_no_emojis.md`)
- No AI slop, no walls of text, human-crafted copy
- Production-grade visuals every session
- Spec before build (see `docs/working-rules.md`)
- Sub-50ms transitions or trick-the-mind
- Self-serve UX — page should be self-explanatory like a file converter
  (see Rossella's voice note distilled into HeroDemoFlow)

## Open feedback Marco has queued

He said: "I have plenty of feedback that I will share." This means
the next chat will get screenshots + bullets to fix. Be ready for:

- More layout / typography / spacing critiques
- Possibly: re-design of workspace mockup as Marco sketched
  ("polished full-width interactive product section, OR cleaner
  static workflow preview with three clear columns: inputs,
  intelligence/memory, outputs")
- Possibly: nav changes (he flagged "Try with your data" CTA in the
  header should be removed; "PowerPoint Tax" should be removed; add
  "Workspace" between Product and Pricing — but that's on the live
  fix/francesco-feedback branch, not this branch)
- Possibly: hero image higher-res source
- More copy edits
- More polish on the 3-box demo

## What the next chat should DO at the start

1. Read this file end-to-end
2. Read `memory/feedback_no_emojis.md`,
   `memory/feedback_design_golden_rules.md`,
   `memory/feedback_no_company_names.md`
3. `git checkout codex/marketing-variant-j-claude-rebuild`
4. `git log --oneline -25` to see the path history
5. ASK Marco for the new feedback before changing anything
6. Plan the change end-to-end (which file, what change, how it propagates
   to 5 variants, what could break) before touching code
7. Verify the change on Vercel preview after push, not just locally
