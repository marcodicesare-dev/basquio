# March 28 — 48h Forensic Learnings

This file is the canonical forensic truth source for the March 27-28 stabilization window.
Use it to avoid reintroducing the same failure classes.

## Last Known-Good Baseline

- Comparable production success before the regression cluster: run `281f287a-3a72-41af-b84e-e6fe84efd646`
- Created: `2026-03-28 10:14:38 UTC`
- Completed: `2026-03-28 11:19:05 UTC`
- Web deploy baseline: Vercel deploy for commit `d1e4c03`
- Worker baseline: pre-hardening Railway worker deployment built from the code around `c205d35`

Use that baseline before claiming any March 28 hardening changed the main lane for the better.

## Regression Sequence

1. `13a50fd` plus `6177b0c` introduced the March 28 liveness/watchdog hardening direction.
   This improved observability intent, but it reintroduced wall-clock author killing for workloads that historically needed about 20 minutes.

2. `9f4b045`, `347dadb`, `a8b95f1`, and `c1b8db6` churned Anthropic execution config during a live incident window.
   The main lesson is not that every one of these commits was useless. The lesson is that config churn outpaced runtime revalidation.

3. `eba4036` through `bfd26a2` were corrective liveness iterations.
   They fixed real issues, but several still inherited the wrong premise that local wall-clock watchdogs should drive author truth.

4. `9843c5a`, `90879b4`, and `a704cfa` were the recovery set that restored a real user run to completion.
   They fixed liveness semantics, analysis salvage, publish-gate contract normalization, and judge alignment.

## What Actually Failed

1. The main lane regressed because we treated long `author` code-execution turns as stalls.
   Evidence: Francesco-class runs that historically needed about 20 minutes in `author` were aborted or superseded early.

2. We trusted SDK-forward Anthropic config over live provider reality.
   `code_execution_20260120` was treated as an upgrade path before it existed server-side for this runtime.

3. The merged `author` path lost structured-output enforcement.
   Claude returned useful `analysis_result.json`, but strict parsing rejected it on shape drift and the run died after spending money.

4. Recovery logic wrote foreign keys in the wrong order.
   `recover_deck_run_attempt()` updated `superseded_by_attempt_id` before the new attempt existed, causing FK failures and stranded runs.

5. Publish-gate contract checks mixed template-facing layout names with canonical layout ids.
   Valid decks failed on `cover` and closing-layout checks even when the rendered artifact was structurally fine.

6. Final export used a stricter visual judge than revise.
   Earlier critique could pass a deck that Sonnet later rejected, so the run failed at the very end instead of getting actionable revise feedback earlier.

7. Some export checks were false blockers.
   Counting all `ppt/slides/slide*.xml` files instead of the `presentation.xml` slide list caused false slide-count failures.
   Chart-image aspect checks were too strict for normal chart canvas padding.

8. Refund and billing paths were not trustworthy enough.
   We hit both an ambiguous SQL column bug and a runtime RPC-path failure during refunds.

## What Got Better Vs. Worse

### Better

- artifact and phase checkpointing became much more useful
- attempt lineage and per-request usage truth became much more visible
- publish-gate correctness improved materially
- critique/export judge alignment improved the revise loop

### Worse

- runtime truth became harder to reason about because briefs, audits, and live code drifted apart
- too many same-day commits changed timeouts and Anthropic config without one stable validation lane
- historical docs started reading like live contracts instead of clearly archival analysis

## What Improved In Production

1. Long `author` and `revise` turns are no longer killed by local wall-clock watchdogs.
2. Stale recovery now respects active in-flight generation requests instead of superseding healthy attempts.
3. `analysis_result.json` shape drift no longer kills runs immediately; manifest salvage and normalization exist.
4. Recovery FK ordering is fixed.
5. Publish-gate contract normalization is fixed.
6. Critique now uses the same Sonnet judge that the final gate trusts.
7. Final export no longer fails on orphaned PPTX slide xml files or chart-canvas aspect padding.
8. The failed user run `0ffb5ce9-dc24-401a-bd0b-cb52c976060d` completed successfully on attempt `5`.

## Hard Rules

1. Do not change Anthropic execution config without a live smoke test and a production-equivalent rerun.
   Canonical source: `packages/workflows/src/anthropic-execution-contract.ts`

2. Do not set local `author` or `revise` watchdogs from intuition.
   Current truth: no local watchdog for those phases; rely on the broader Anthropic timeout and in-flight-request-aware liveness.

3. Do not trust a stricter final judge unless the same judge already shaped revise.
   If Sonnet is the publish gate, Sonnet must be in the critique path too.

4. Do not reject paid LLM output for recoverable shape drift.
   Normalize and salvage first. Fail only when the content is genuinely unusable.

5. Do not treat raw zip file counts as artifact truth when the format has a canonical manifest.
   For PPTX, trust `presentation.xml` slide references over orphaned `ppt/slides/slide*.xml`.

6. Do not document forward-looking architecture ideas as live truth.
   Historical and audit docs must be clearly marked when they diverge from production reality.

## Current Canonical Runtime Truth

- Anthropic tool type: `code_execution_20250825`
- Anthropic beta header: `code-execution-2025-08-25`
- Critique judge: `claude-sonnet-4-6`
- Final export judge: `claude-sonnet-4-6`
- Anthropic client timeout default: `60m`
- Local `author` and `revise` phase timeout: disabled
- Local `author` and `revise` request watchdog: disabled
- Worker deploy model: Railway worker is deployed manually from a clean `HEAD` snapshot, not Git-auto-deployed
- Canonical memory entry point: `memory/MEMORY.md`

## What Still Needs Validation

1. A fresh 10-run production batch on the post-`a704cfa` worker.
2. Replica strategy and whether Railway is really running the intended number of live worker instances.
3. Whether the remaining monolith size of `generate-deck.ts` is still hiding failure classes that should become explicit modules.

## Use This Before Touching The Pipeline

Read in this order:

1. `CLAUDE.md`
2. `memory/canonical-memory.md`
3. `memory/march28-48h-forensic-learnings.md`
4. `packages/workflows/src/anthropic-execution-contract.ts`
