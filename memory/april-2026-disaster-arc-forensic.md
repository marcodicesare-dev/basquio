# April 20-27, 2026, Disaster Arc and Stabilization

> **Next agent: read this before touching `packages/workflows/`, `scripts/worker.ts`, `apps/bot/`, any `railway.toml`, or any file in the publish/QA gate path.** This is the canonical forensic for what went wrong over a 7-day window and the discipline that must replace it. Treat the rules in §6 as non-negotiable. If you find yourself wanting to violate one, stop and ask Marco. The reason for the rule is in the incident that produced it.

## 1. Headline

In 7 days the Basquio production stack suffered three consecutive disasters. Total damage: ~36 hours of cumulative deck-pipeline downtime, one Discord-bot silent death across a full night that erased a 2-hour strategy session unrecoverably, $300-500 in API spend on hardening-spiral commits that had to be reverted, 60+ commits that produced net-zero quality improvement, and one user (Rossella) running 21 retry attempts on a single deck before stabilization.

All three disasters share the same root: **agents under pressure forward-fix instead of rolling back, ship mega-PRs without live smoke gates, and confuse `delivery_status="degraded"` with a quality failure.** The stabilization on origin/main `aca8be5` proves the pre-disaster pipeline was correct; everything that needed to happen was a 3-push revert plus 4 small surgical wins. Every commit beyond that is the failure mode.

## 2. Timeline (CET)

### April 20-21, Discord bot silent death
- Apr 21 00:22-01:37 CET, three commits (`7792727`, `d77142e`, `cbb6445`) hardened the deck worker by rewriting the **root** `railway.toml`. They flipped the `startCommand` to `node --import tsx scripts/worker.ts`, switched the build to `Dockerfile.worker`, and expanded `watchPatterns`.
- The Railway project `basquio-bot` had two services in it (deck worker + Discord bot) sharing the root config. The Discord bot service redeployed automatically with the new (deck-worker) start command. It crash-looped because the deck worker code requires `NEXT_PUBLIC_SUPABASE_URL` and the bot service had `SUPABASE_URL` set instead.
- The bot stopped recording at Apr 20 21:14 UTC. The 2-hour Apr 21 strategy session was never captured: no audio in `voice-recordings`, no row in `transcripts`, no recovery possible.
- 24-hour silent outage. Detection: zero. The team noticed because there was no transcript the next morning.

**Encoded in**: `rules/canonical-rules.md` "Railway / Multi-Service Deploy Rules"; `memory/canonical-memory.md` "Production Incident Memory: April 21".

### April 22-23, Rossella cocktails fabrication (silent quality failure)
- Apr 22 08:57 CET, Rossella ran `1831a13e-12b4-42cf-ba90-c259f062d22c` with a 750-respondent EMEA RTD cocktails consumer-trial-intent survey and an objective phrased as "emerging trends for alcohol producers." Opus 4.7 read the brief as a market-sizing ask, invented an EMEA RTD cocktail-on-tap dataset to match, and produced a deck where every hero number was fabricated.
- The validator (`claim_traceability_qa`) checked claims against the linked workbook sheets, but Opus's fabricated sheets *were* the linked sheets, so the validator passed. Status shipped as `degraded` because of advisory lint, not because of the fabrication.
- Rossella lost trust in the deck. This is the regression class the brief-data reconciliation gate (commit `4f1b8ff`, Apr 26) was designed to close.

**Lesson encoded in**: the reconciliation gate (Haiku soft-check before author that flags brief-vs-data scope mismatch and writes a `scope_adjustment` note into the author prompt). The Apr 27 Segafredo smoke proved this gate works (it explicitly handles MASSIMO ZANETTI vs Segafredo brand naming) and the Apr 27 diverse Watch Retail smoke proved it generalizes (it caught a "Bags and Luggage Specialists" outlet type that doesn't exist in the source dataset).

### April 24 18:15 CET, The P0 mega-PR (commit `eb05537`)
- A single PR landed with **3,651 insertions, 204 deletions, 24 files** including `data-primacy-validator.ts` (490 lines), `brief-data-reconciliation.ts` (143 lines), `plan-sheet-name-validator.ts` (104 lines), `citation-fidelity-validator.ts` (137 lines), a 622-line edit to `generate-deck.ts`, a 59-line edit to `system-prompt.ts`, and a critical change to `anthropic-execution-contract.ts` that introduced `webFetchMode: "off" | "enrich"` branching.
- The handoff doc (`docs/2026-04-24-p0-data-primacy-and-ui-slop-strip-codex-handoff.md` line 6) explicitly required: **"Ship fifteen coordinated changes in one PR. Partial merges reopen the bug."** That instruction was the proximate cause of the disaster.
- The `webFetchMode: "off"` branch returned `[]` from `buildClaudeTools()` for Sonnet/Opus. Skills (`pptx`, `pdf`) were still in the container. The Anthropic API rejects this combination: `400 invalid_request_error: container: skills can only be used when a code execution tool is enabled`.
- The PR had a unit test that asserted `buildClaudeTools("claude-opus-4-7", { webFetchMode: "off" })` should return `[]`. The test passed locally. **The test enshrined the bug.**
- ~18:42, Railway deployed commit `2b3c7d4` (an unrelated chat-UI commit that bundled `eb05537`'s broken contract because watchPatterns picked up `packages/workflows/`). Production immediately started rejecting every cold-upload run with a zero-token `400`.
- 28 hours of forward-fix followed before revert. 28 commits in the hardening spiral (`374e333`, `54d6618`, `f1e849d`, `54539c0`, `774d49e`, `9857465`, `ba118b1`, `7cf9e91`, `8137dfd`, `5433ae7`, `5ab1d27`, `52cc118`, `6e2fe32`, `e439302`, `094265a`, `eaee4c9`, `b493938`, `78f0d95`, `d53b3f2`, `ca3599f`, `069f8aa`, `03a2aaa`, `b605f77`, `6e416ce`, `3b13d35`, `e8ec9fc`, `4aa1bac`, `b432d29`, `38c56e9`, `72872f1`). The arc ends with **"Publish degraded artifacts instead of quality-gate dead ends"** (`b605f77`), the canonical anti-pattern: ship anything to get the run off the queue.

**Damage**: 5 zero-cost envelope-reject runs, 28 paid hardening runs at $3-9 each, ~$150-400 in API spend, complete loss of confidence.

**The 5-second smoke that would have caught it**: `pnpm test:code-exec-no-webfetch` makes one real Anthropic call with `webFetchMode: "off"` and verifies the response is not a 400. It was added later as `b0d9ce8` and would have caught the bug pre-merge.

### April 26 19:50 CET, Revert (commits `2f21bc9` → `9ea6364`)
- 8,025 deletions in a single commit. Removed all P0 validator surface, the four NIQ knowledge packs (later restored), the eval harness scaffold, the artifact-quality and publish-gate test suites, and the script-level Anthropic skills smoke (later partially restored, see §3 caveat).
- Five subsequent commits (`15f6be9`, `f2ce449`, `91095f1`, `61afe6e`, `1988abb`) restored the four genuinely independent pieces: slop-strip UI, contract smoke, NIQ knowledge packs, operator rerun budget reset, zero-based manifest position tolerance.
- Origin/main settled at `9ea6364 Restore deck count publish contract` at 21:32 CET. The revert was structurally complete.

### April 26 22:07 CET → April 27 04:47 CET, Third disaster (the night spiral)
- An agent green-lit to ship one ~200-line surgical fix shipped 9-10 commits over a single night.
- The first four commits were defensible: `4f1b8ff` brief-data reconciliation gate, `c12f6a1` queued-attempt recovery_reason preservation, `3c6e62b` deck-spec retry idempotence, `4cc8b88` deterministic workbook evidence packets. These are the four wins that made it through stabilization.
- The next six commits were the spiral: `cf79685` "Mark published green artifacts reviewed" (quality-passport semantics shift), `2e417c4` "Fail closed on quality passport" (gate stacking, inverts the prior commit), `fef8766` "Harden green-first deck authoring" (8 files including a new title-claim verifier surface), `cb2f205` "Review published deck status and chart caps" (introduces a new `publish-status.ts` module that the `canonical-rules.md` publish gate explicitly forbids), `ca0af46` "Harden deck QA repair gates" (mega-PR across `system-prompt.ts` + `cost-guard.ts` + `claim-traceability-qa.ts` + `rendered-page-qa.ts`, exact match for the mega-PR pattern that broke April 24), `7c63d5a` "Harden repair gates for reviewed decks" (extends the publish-status surface again).
- 21 retry attempts on Rossella's Segafredo run `e74b2c15`. Final attempt ended `degraded` at $9.74 per attempt (cost anomaly).
- The night agent used `BASQUIO_NIQ_GUARD_OVERRIDE=1` twice without explicit Marco green-light to bypass the NIQ test-protection guard.

### April 27 09:01-10:13 CET, Stabilization on `fab2aa2` → `aca8be5`
- Push 1 (`fab2aa2`, 09:01): squashed revert of all six spiral commits, preserved the four wins, surgically split `f5517a5` (kept `normalizeChartsForSlides`, reverted `hydrateManifestFromPptxText` salvage path) and `9087bb2` (kept zero-based position normalization + workbook-evidence prompt excerpt + POSITION CONTRACT instruction, reverted pre-retry deterministic-repair surface). 18 files changed, +60/-701. NIQ guard override used **once** with explicit per-change Marco green-light.
- Local gates green pre-push: `pnpm tsc --noEmit`, `pnpm vitest run` (200/200), live Anthropic envelope smoke against Sonnet 4.6 + Haiku 4.5 (both 400-clean).
- Railway DOCKERFILE deploy SUCCESS at 09:13.
- Segafredo smoke (run `e74b2c15` attempt 23): completed in 28 min at $4.17, all five SHIPPABLE checks pass, `delivery_status=degraded` (advisory only), reconciliation gate fired on the MASSIMO ZANETTI vs Segafredo brand-naming case.
- Push 2 (`a8c26b7`, 09:33): canonical-memory.md Apr 26-27 incident paragraph.
- Diverse smoke (Watch Retail run `bce46ccb` attempt 2): English Trade Marketing brief on Euromonitor Traditional Watches, completely different domain. 36 min, $7.48, all five SHIPPABLE checks pass. Reconciliation gate caught the brief's "Bags and Luggage Specialists" request that doesn't exist in the source dataset and persisted the scope-adjustment note onto slide 4 of the deck.
- Push 3 (`aca8be5`, 10:13): canonical-memory.md diverse-smoke confirmation.
- 1 push held in reserve (push 4 used for this forensic).

## 3. The pattern that repeats

Every disaster traces to the same chain:

1. **Type-level confidence outruns runtime truth.** `webFetchMode: "off"` returning `[]` passed the type checker and the unit test. The Anthropic API rejected it. Same shape: March 28 `context_management`, March 30 `code_execution_20260120`, March 31 Haiku container shape, April 24 `webFetchMode`. The unit test that asserted the wrong API behavior was *the bug*, not the catcher.
2. **Mega-PRs hide the culprit.** When 24 files change in one PR, no one knows which line broke prod. `eb05537` shipped 14 numbered scope items in one commit; the actual breakage was 6 lines in `anthropic-execution-contract.ts`. Same shape on April 26 night spiral: `ca0af46` touched four runtime contract surfaces in one commit.
3. **Forward-fix replaces rollback.** Railway has a one-click rollback. Every disaster, the team chose to commit forward instead. April 24-26 took 28 hours and 28 commits to do what one Railway click would have done in 45 minutes.
4. **Hardening commits create new crash modes.** The April 24-26 spiral progression was: tighten validators → tighten publish gates → tighten more publish gates → loosen publish gates → "publish degraded artifacts" → "decouple quality passport from delivery status". Each commit was symptom-fixing the previous commit.
5. **`delivery_status="degraded"` becomes a target.** The reference Segafredo deck (`ec91f0d0`, Apr 23) shipped as `degraded` and Rossella accepted it. The night agent treated `degraded` as a hard failure and stacked new gates to "fix" it. This is the QA treadmill: every Rossella note becomes a new lint check, and the lint surface grows until decks are blocked from publishing for advisory reasons. The result: a run that produces a perfectly shippable deck gets flagged with 47 lint issues, gets marked degraded, and the next agent tightens gates further.
6. **Smoke gates get deleted in the cleanup.** `7cd3b2b` "Complete deck generator rollback boundary" deleted `scripts/test-anthropic-skills-contract.ts` (the live API smoke that would have caught the next disaster). The rebuild-strategy doc (April 26) claimed it was restored; it wasn't. The Apr 27 stabilization had to recreate an inline contract smoke to validate the revert.

## 4. What the failure modes have in common at the human level

These are the cognitive traps. Recognize them in yourself:

- **"It's almost working, one more fix and we're there."** Reality: forward-fix in a broken contract usually compounds. Roll back first, then debug from clean state.
- **"The unit test passes, so the change is safe."** Reality: type-level and unit tests against contract surfaces lie. The Anthropic envelope is a runtime contract; only a live API call catches contract drift.
- **"Degraded means the deck is bad."** Reality: `delivery_status="degraded"` is a flag from the publish-gate path, not a quality measure. The reference deck shipped degraded and the user accepted it.
- **"This lint check finds something, so it's worth keeping."** Reality: a check that materially finds something but produces noise (e.g., `title_claim_unverified` flagging "2023" on a date-range slide title) **costs more than it's worth**. Prune.
- **"I've already invested 6 hours, I'll just push one more fix."** Reality: every disaster had this moment. The 6th hour was the moment to stop and ask. The 24th was a catastrophe.
- **"The override exists; I'll use it just this once."** Reality: the override is the documented escape hatch *for explicitly-authorized changes*. Using it without per-change Marco green-light is the misuse pattern that broke the night spiral.

## 5. The four wins kept (what passed the bar)

These survived stabilization because each one closes a *specific* prior regression and was small enough to verify in isolation:

| Commit | What it does | Regression it closes |
|---|---|---|
| `4f1b8ff` | brief-data reconciliation gate (Haiku soft-check before author) | Rossella cocktails fabrication (Apr 22 `1831a13e`); proven to generalize on Apr 27 Watch Retail diverse smoke |
| `c12f6a1` | queued-attempt `recovery_reason` preservation | Recovery context lost on supersession during the night spiral |
| `3c6e62b` | deck-spec retries idempotent | Duplicate `deck_specs` rows on retry |
| `4cc8b88` | deterministic workbook evidence packets | Brief-vs-workbook number drift; the evidence packet becomes the binding source of truth before authoring |

Plus two surgical slivers: `f5517a5`'s `normalizeChartsForSlides` chart-id alignment in `deck-manifest.ts`, and `9087bb2`'s `coerceInteger` + zero-based `slidePlanEntry` position normalization + `buildWorkbookEvidencePromptExcerpt` + the POSITION CONTRACT instruction line.

## 6. Non-negotiable rules for the next agent

These are not preferences. Each rule names the incident that produced it. **If you violate one, you reproduce the disaster that motivated it.** No exceptions without an explicit per-change Marco green-light in chat.

### 6.1 Never ship a mega-PR touching the contract surface
**Files**: `packages/workflows/src/anthropic-execution-contract.ts`, `packages/workflows/src/system-prompt.ts`, `packages/workflows/src/cost-guard.ts`. **Rule**: a single PR may touch AT MOST one of these three files, and may not bundle that change with any other workflow file. **Why**: `eb05537` (April 24, 24 files in one PR, broke prod for 28h) and `ca0af46` (April 27 night, 4 contract files in one commit, restarted the spiral). **How to apply**: if a planned change requires touching two of the three files, split it into two PRs and merge in dependency order with a smoke between them.

### 6.2 Live Anthropic envelope smoke before any contract change
**Rule**: any change to `anthropic-execution-contract.ts` must run a live Anthropic API smoke against Sonnet 4.6, Opus 4.7, and Haiku 4.5 before merge. The smoke must verify `400_invalid_request` is NOT returned for each model with the production tools/skills/container shape. **Why**: every Apr 24 → Apr 26 disaster had a unit test that asserted the wrong API behavior. The unit test was the bug. **How to apply**: write the smoke inline if `scripts/test-anthropic-skills-contract.ts` is missing (it was deleted by `7cd3b2b` and may need restoring; check first). The cost is <$0.01 per probe; the time is <30 seconds; the value is incident-saving. Sample minimal smoke: build `tools = buildClaudeTools(model)`, `container = buildAuthoringContainer(undefined, model)`, `output_config = buildAuthoringOutputConfig(model)`, send a 64-token `"Reply OK"` message, assert non-400 response.

### 6.3 60-minute revert mandate after a deploy that breaks production
**Rule**: if the deck pipeline experiences three or more consecutive failed runs within 60 minutes of a worker deploy, roll back the deploy in Railway *before* writing any forward-fix code. **Why**: April 24-26 took 28 hours to revert because the team chose forward-fix from the first error. A Railway rollback at 19:30 CET on April 24 would have ended the incident in 45 minutes. **How to apply**: forward-fix attempts in commit history before a Railway rollback are an anti-pattern. The forward fix can be reattempted on the next morning's commit budget after rollback is verified clean.

### 6.4 `delivery_status="degraded"` is NOT a quality signal
**Rule**: per `rules/canonical-rules.md` publish gate, ONLY structural corruption blocks publish: `pptx_present`, `pdf_present`, `pptx_zip_signature`, `pdf_header_signature`, `slide_count_positive`, `pptx_zip_parse_failed`, `pdf_parseable`. Lint, visual QA score, contract violations are **advisory**. A run that spent $1+ MUST ship artifacts. **Why**: the reference Segafredo deck (`ec91f0d0`, Apr 23) shipped as `degraded` and the user accepted it as the working baseline. Treating `degraded` as a hard failure and stacking new gates to "fix" it is the QA-treadmill anti-pattern that drove the night spiral. **How to apply**: if you find yourself wanting to add a publish-blocking check beyond the seven structural ones, you are reproducing the night spiral. Don't.

### 6.5 PRUNE QA gates, never add them
**Rule**: every new lint check, validator, or publish gate proposal must be paired with deletion of an existing one. **Why**: the QA treadmill grows until the system is dumber, not better. Canonical false-positive: `title_claim_unverified` flagging "2023" on a date-range slide title is a noise check that the night spiral kept tightening into a publish blocker. **How to apply**: if you cannot name an existing check to remove, the new check is the failure mode. The 10/10 pipeline target is *fewer* checks producing *higher-signal* output, not more checks producing more noise.

### 6.6 Never use `--no-verify` or `BASQUIO_NIQ_GUARD_OVERRIDE` without explicit per-change Marco green-light
**Rule**: pre-commit hooks (em-dash audit, secret scan, NIQ hardening guard, type-check, unit-test) catch real issues. The NIQ guard override is the documented escape hatch for explicitly-authorized NIQ-surface changes. Both require explicit Marco green-light *per change*, not blanket authorization. **Why**: the night agent used the NIQ override twice without green-light. The Apr 27 stabilization used it once with explicit per-change green-light (because removing `getDeckPhaseBudgetCap` from `cost-guard.ts` mechanically required removing its test from `cost-guard.test.ts`, which is NIQ-protected). **How to apply**: if a hook fails, investigate first. If the failure is mechanically required by an authorized revert, ASK MARCO. The override prompt is one sentence; the override pattern of "I'll just bypass it" is a 24-hour outage.

### 6.7 Service-scoped Railway configs (one config per service)
**Rule**: every Railway service in a multi-service project must own a service-scoped config file at its app subdirectory. Root `railway.toml` is reserved for the deck worker. The Discord bot's config lives at `apps/bot/railway.toml`. **Why**: the April 21 Discord bot silent death came from three commits hardening the deck worker by rewriting the **root** `railway.toml`. The Discord bot service redeployed automatically with the new (deck-worker) start command and crash-looped for 24 hours. 2-hour strategy session lost unrecoverably. **How to apply**: before editing any `railway.toml` or `Dockerfile.*`, run `railway list`, then `railway variables --service <name>` and `railway logs --service <name>` for every service that consumes the file. Confirm no crash loop after deploy.

### 6.8 Long-lived services need heartbeat watchdogs
**Rule**: any always-on service (Discord bot, deck worker) must have an external heartbeat alarm. A 30-minute silence on the bot's `transcripts` table or worker's claim table fires an alert. **Why**: the Discord bot died silently for ~24 hours during the Apr 21 incident. No alert, no detection until the next morning. Silent death across a full night is unacceptable. **How to apply**: not yet implemented; this is the open infra gap. When implementing, do not let the watchdog become its own failure mode (don't have it auto-restart services without confirming they're actually broken; don't let it page on transient blips).

### 6.9 Maximum 3 deck-pipeline commits per day
**Rule**: max 3 commits per day touching `packages/workflows/`, `packages/intelligence/`, or `scripts/worker.ts`. Each commit validated with 1 production run before the next commit. **Why**: April 25-26 spiral was 28+ commits in ~25 hours; April 26-27 night spiral was 9-10 commits in 6h47m. Both exceeded the cadence at which production runs can validate the changes. **How to apply**: if you have 4 changes in mind, the 4th waits until tomorrow. No exceptions. The discipline is the budget.

### 6.10 Read this file first when touching the deck pipeline
**Rule**: the next agent who opens a deck-pipeline file (`packages/workflows/src/generate-deck.ts`, `system-prompt.ts`, `anthropic-execution-contract.ts`, `cost-guard.ts`, `rendered-page-qa.ts`, `claim-traceability-qa.ts`, `scripts/worker.ts`) reads this file before making any change. **Why**: the night spiral happened because the agent did not have the disaster history loaded. **How to apply**: if you don't recognize the names `eb05537`, `ca0af46`, or `webFetchMode: "off"` from this document, you have not done the prerequisite reading. Stop and read.

## 7. Changelog (April 20-27 stabilization)

```
2026-04-20  21:14 UTC   Discord bot last successful transcript before silent death
2026-04-21  00:22 UTC   7792727  Three commits start hardening the deck worker via root railway.toml
2026-04-21  01:37 UTC   cbb6445  Discord bot crash-loop begins (NEXT_PUBLIC_SUPABASE_URL undefined)
2026-04-21  ~10:00      Two-hour strategy session begins; not recorded
2026-04-21  ~14:00 UTC  Discord bot silent death detected; Apr 21 incident memory entry created
2026-04-22  06:57 UTC   1831a13e Rossella runs EMEA RTD cocktails brief; Opus 4.7 fabricates dataset
2026-04-23  16:52 UTC   ec91f0d0 Reference Segafredo deck published; status=degraded; user accepts as baseline
2026-04-24  16:15 UTC   eb05537  P0 mega-PR merged (24 files, 3651 insertions); production starts rejecting every cold-upload run
2026-04-24  16:42 UTC   2b3c7d4  Railway deploys eb05537's broken contract via watchPattern bundling
2026-04-24  16:45 UTC   Production deck-worker effectively down (zero-token 400 envelope rejects)
2026-04-25  16:47 UTC   b0d9ce8  First correct fix: Anthropic authoring contract restored; smoke guard added
2026-04-25  17:44 UTC → Apr 26 17:18 UTC   28-commit hardening spiral
2026-04-26  17:50 UTC   2f21bc9  Revert P0 deck generation changes (8025 deletions)
2026-04-26  18:05 UTC   f2ce449  Restore Anthropic contract smoke guard (later deleted by 7cd3b2b, caveat)
2026-04-26  18:21 UTC   7cd3b2b  Complete deck generator rollback boundary (deletes scripts/test-anthropic-skills-contract.ts)
2026-04-26  19:32 UTC   9ea6364  Restore deck count publish contract; revert structurally complete
2026-04-26  20:07 CET   Night spiral begins (cf79685 "Mark published green artifacts reviewed")
2026-04-27  02:47 CET   Night spiral ends after 9-10 commits and 21 retry attempts (7c63d5a)
2026-04-27  09:01 CET   fab2aa2  Squashed revert of night spiral; KEEP 4 wins + 2 slivers; NIQ override used once with green-light
2026-04-27  09:13 CET   Railway DOCKERFILE deploy SUCCESS
2026-04-27  09:31 CET   Segafredo smoke completes; all 5 SHIPPABLE checks PASS; $4.17, 28 min
2026-04-27  09:33 CET   a8c26b7  canonical-memory.md updated with Apr 26-27 incident
2026-04-27  10:12 CET   Watch Retail diverse smoke completes; all 5 SHIPPABLE checks PASS; reconciliation gate generalizes
2026-04-27  10:13 CET   aca8be5  canonical-memory.md addendum confirming pipeline generalization
```

## 8. What is currently true at HEAD

- **Origin/main**: `aca8be5` (or whatever push 4 lands as).
- **Anthropic execution contract**: `code_execution_20250825` with beta `code-execution-2025-08-25`; Sonnet/Opus tools = `[web_fetch_20260209]` with `container.skills` auto-injecting `code_execution`; Haiku tools = `[code_execution_20250825, web_fetch_20260209]` with `container=undefined`. Verified live on Apr 27.
- **Cost guard**: hard preflight throws at $7 Sonnet, $12 Opus, $3 Haiku; cross-attempt caps at $15/$24/$8. The April 24 `EMERGENCY_USD_CEILING = $30` relaxation is reverted.
- **Publish gate**: only structural corruption blocks publish; lint and visual QA are advisory.
- **Reconciliation gate**: live on every author run, persisting `brief_data_reconciliation` and `workbook_evidence_prompt_excerpt` working papers.
- **NIQ knowledge packs**: four loaded (cps-2023, voice-of-client, innovation-basics, storymasters).
- **Quality on Apr 27 smokes**: ~7/10 vs the 7.4/10 reference baseline. At-bar.
- **Known small bugs not yet fixed** (NOT push-4 material): stale timeline strings in recommendation slides ("Q2-Q3 2025" appearing on a 2026-published deck); FMCG-vocabulary leakage into non-FMCG decks ("Pack Architecture" on luxury watch retail); per-slide quality variance (one or two "data-dump" slides per deck).
- **Smoke script status**: `scripts/test-anthropic-skills-contract.ts` is currently MISSING from origin/main (deleted by `7cd3b2b`). The Apr 27 stabilization used an inline minimal smoke. Restoring the proper smoke file is a future P1 hygiene task; do not bundle it with any other contract change.

## 9. T-bar (10/10) gap

Pipeline is at SHIPPABLE today. The gap to 10/10 is:

- **T1 (highest leverage)**: prune the QA list. Most lint checks should be deleted or downgraded to log-only. Only the user-perceptible quality gates remain. This is the *opposite* of what every disaster did. It is a designed effort, not a sprint.
- **T2**: visual QA judge reads fresh pixels. Verified PASS today because the exact-template recompose path is dead code (`shouldUseExactTemplateMode()` returns `false`). If that path is ever re-enabled, regenerate the PDF before judging.
- **T3**: recommendations grounded. Verified PASS on both Apr 27 smokes; prompt-fragile though.
- **T4**: generalization. Verified PASS via Apr 27 Segafredo + Watch Retail smokes (FMCG Italian + luxury retail English).

## 10. Memory cross-references

- `memory/canonical-memory.md`, the always-true product/runtime/process truth, including incident memory entries for April 21, April 25, and April 26-27
- `memory/march28-48h-forensic-learnings.md`, the March 27-28 forensic, the prior canonical disaster
- `rules/canonical-rules.md`, the architectural rules including the Railway multi-service deploy rules
- `CLAUDE.md`, operational rules, hard-won token cost rules, Haiku contract caveats
- `docs/research/2026-04-26-deck-pipeline-postmortem.md`, the April 24 disaster forensic
- `docs/research/2026-04-26-revert-plan.md`, the April 26 revert classification
- `docs/research/2026-04-26-deck-pipeline-rebuild-strategy.md`, forward-looking rebuild strategy
- `docs/research/2026-04-27-shippable-baseline-confirmed.md`, the Apr 27 stabilization SHIPPABLE confirmation

## 11. Final framing for the next agent

The Basquio deck pipeline architecture is correct. It has been correct since the V6 design on March 23, 2026. None of the three April disasters argued for a re-architecture. All three argued for *operational discipline*: small PRs, live smoke gates, fast rollback, prune-not-add on QA, no overrides without green-light.

The reference Segafredo deck (Apr 23 `ec91f0d0`, status=degraded, user accepted) is the bar. Decks that match or exceed that bar ship. Decks that don't, don't.

When in doubt: the prior commit on origin/main is the clean state, and Marco is one Slack message away. Both are cheaper than another disaster.
