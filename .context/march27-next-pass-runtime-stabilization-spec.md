# March 27 Next Pass: Runtime Stabilization And Time Reduction Spec

## Purpose

This is the next implementation pass after:

- `8141f7a` `Harden export recovery and progress truth`

That pass fixed:

- brittle final rendered-page QA JSON killing already-valid decks
- dishonest progress climbing to `99%` long before the run was actually safe
- one class of stale/superseding worker state drift

It did **not** solve the two deepest product failures:

1. runs are still too slow for a live product
2. the engine is still not resilient enough across all major failure boundaries

This spec is for the next implementation agent.

It is not a cleanup pass.
It is not UI polish.
It is not template-fidelity work.
It is a production-grade runtime stabilization and runtime-reduction pass.

The target is:

- materially lower median run time
- materially higher completion rate
- fewer full-run replays after transient failure
- truthful run state and cost state
- no rollback of the good product improvements already shipped

## Non-Negotiables

Keep:

- durable worker architecture
- attempt lineage
- workspace template import model
- DOCX lane
- rendered-page QA
- failure mapping UX
- request/cost telemetry direction

Do **not**:

- revert to the old fragmented renderer stack
- reintroduce inline template interpretation on `/jobs/new`
- hide failures behind fake “completed” states
- solve slowness by weakening quality gates into no-ops

## Root Causes To Address

### 1. The pipeline still has too many expensive AI boundaries

Current live spine:

- `normalize`
- `understand`
- `author`
- `render`
- `critique`
- `revise`
- `export`

This is too many expensive handoffs.
Each extra boundary creates:

- another structured-output parse risk
- another retry surface
- another continuation/history growth path
- another place where the system can spend money and still die late

### 2. Recovery is still too coarse

Current recovery is uneven:

- `understand` can reuse `analysis_result`
- `revise` can salvage back to author artifacts
- final QA now falls back to prior green QA

But we still do not have:

- reliable phase checkpoint reuse across the full run
- artifact checkpoints before non-essential post-checks
- narrow retry units for all major AI/tool boundaries

### 3. Progress is now more honest, but runtime itself is still too long

Progress truth was fixed.
That does not make a 30-40 minute run acceptable.

The next pass must reduce actual time, not just explain delay better.

### 4. The worker state machine still needs stronger integrity

State drift is improved but not finished.
The run engine still has risk around:

- stale queued rows
- recovery duplication
- phase-local telemetry truth
- final logical run truth vs attempt truth

## State Of The Art Direction

Use these patterns as the implementation model:

- Temporal: retry at step/activity boundaries, heartbeat long operations, preserve logical workflow identity across retries
- LangGraph: checkpoint every important step, keep human/repair interrupts resumable, do not replay the whole workflow for one bad boundary
- OpenAI/Anthropic structured-output guidance: smaller schemas, bounded repair, explicit fallback for malformed outputs
- modern progress UX guidance: determinate only when the denominator is real; otherwise show stage, liveness, and checkpoint truth

Practical implication for Basquio:

- one logical run
- narrow recoverable substeps
- checkpointed durable outputs
- no giant “if anything breaks late, rerun the universe” behavior

## Implementation Objectives

## A. Reduce Median Runtime Materially

### Goal

Bring normal healthy runs down materially from the current unacceptable range.

Concrete target for this pass:

- median healthy workbook run: under `15 min`
- p90 healthy workbook run: under `22 min`

Do not treat these as copy promises yet.
Treat them as engineering targets.

### Required changes

#### A1. Collapse the `understand -> author` split for the happy path

Current problem:

- `understand` emits analysis JSON
- `author` then re-enters the same container/thread and does the real deck work
- this duplicates context/history and adds another expensive boundary

Required implementation:

- introduce a new primary path where the model does:
  - evidence inspection
  - story planning
  - deck generation
  - manifest generation
  - artifact generation
  in one main generation turn
- keep the current split path only as a fallback/recovery mode, not the default happy path

Expected effect:

- less continuation churn
- less duplicated context
- fewer structured-output boundaries
- materially lower token cost and latency

#### A2. Cap continuation history growth more aggressively

Current problem:

- `runClaudeLoop()` can accumulate expensive history and pause turns
- it retries inside the same broad thread model

Required implementation:

- add explicit continuation budget by phase
- if a phase exceeds a bounded continuation threshold:
  - checkpoint current useful outputs
  - fail into a recoverable classified state
  - do not keep inflating context endlessly

Also:

- surface continuation count in telemetry in a way the audit tools can use
- make it easy to identify which phases are history-churn heavy

#### A3. Make `render` a true zero-cost bookkeeping phase or remove it from critical timing math

Current problem:

- `render` is not real expensive work anymore
- but it still exists in progress/runtime semantics

Required implementation:

- either keep it as bookkeeping only and exclude it from runtime expectations
- or merge it into `author`

This is mostly a semantics/measurement cleanup, but it should match actual runtime truth.

## B. Make Late Failures Non-Terminal Whenever A Valid Deck Already Exists

### Goal

If the system already has a valid deck artifact set in memory or durable checkpoint, a late non-essential failure must not kill the run.

### Required changes

#### B1. Persist a durable pre-export artifact checkpoint

Current problem:

- a run can complete `author` or `revise`
- have a valid `deck.pptx`, `deck.pdf`, `deck_manifest.json`
- then die in export/final QA before anything durable is written

Required implementation:

- after author success and after revise success, persist a recoverable internal artifact checkpoint
- this checkpoint may be:
  - private storage artifact set plus manifest
  - or a durable recovery bundle keyed to attempt/run
- it must not be published as the final customer artifact automatically
- but it must be available for salvage if final export QA or notification/post-processing fails

Acceptance criteria:

- if export fails after a valid revise artifact set exists, the run can recover from the checkpoint instead of replaying generation

#### B2. Classify final visual QA as “publish gate” vs “salvageable enrichment”

Current problem:

- final visual QA is currently powerful enough to kill the run

Required implementation:

- separate the responsibilities:
  - blocking artifact-integrity failures
  - advisory/polish failures
- if prior QA was green and final QA parsing fails, salvage should publish from the last valid checkpoint
- only explicit hard artifact-integrity failure should keep the run terminally failed

#### B3. Add bounded structured-output repair for all remaining JSON choke points

The next pass must ensure all remaining structured boundaries use the same standard:

- parse
- deterministic repair
- one bounded re-ask
- salvage if a prior valid state exists
- terminal fail only if none of the above succeeds

This must cover:

- final rendered-page QA
- any remaining manifest parsing paths
- any critique/revise structured substeps not already hardened

## C. Unify Phase Checkpoints And Recovery Semantics

### Goal

Every major phase should either:

- be replay-cheap
- or be checkpointed and resumable

### Required changes

#### C1. Define canonical checkpointable outputs by phase

At minimum:

- `normalize`
  - parsed evidence workspace
  - template diagnostics
- `understand` or merged planning path
  - analysis/story/deck plan
- `author`
  - first valid artifact set
- `revise`
  - improved valid artifact set
- `export`
  - published artifact manifest and delivery state

The implementation agent must explicitly document and code these checkpoint contracts.

#### C2. Recovery should resume from the highest valid checkpoint, not restart from `normalize`

Current problem:

- stale/transient recovery still restarts too much of the run

Required implementation:

- if `author` checkpoint exists, recover from there
- if `revise` checkpoint exists, recover from there
- only restart from `normalize` when no higher durable checkpoint exists

#### C3. Distinguish replay-safe vs replay-expensive steps

Examples:

- replay-safe:
  - metadata patching
  - notification fan-out
  - manifest publication if idempotent
- replay-expensive:
  - model generation
  - rendered-page QA
  - artifact repair turns

Recovery policy must prefer replay-safe work and avoid replay-expensive work whenever a checkpoint exists.

## D. Tighten Worker State Integrity

### Goal

One logical run must not drift into inconsistent attempt state.

### Required changes

#### D1. Recover stale queued runs, not only stale running attempts

Current problem:

- worker recovery focuses on stale `running` attempts
- stale queued work can still be stranded

Required implementation:

- add recurring stale queued-run repair
- define safe thresholds
- ensure the parent `deck_runs` row and attempt rows stay in sync

#### D2. Claim only attempts that are still canonically active

Current pass already tightened this.
Next pass must complete it:

- no claim of orphaned attempts
- no double-claim of superseded attempts
- parent run pointer must remain canonical

#### D3. Make shutdown recovery provably safe

Current graceful requeue is better than before, but still needs proof via test coverage.

Required implementation:

- add focused tests for:
  - shutdown during author
  - shutdown during revise
  - stale recovery collision
  - transient retry followed by shutdown

## E. Make Progress Truthful Without Feeling Broken

### Goal

The progress bar must stop lying, but the UX must still feel alive and informative.

### Required changes

#### E1. Use determinate progress only for bounded substeps

Required behavior:

- phase-level percent should stay conservative
- real determinate counts should be shown when available, for example:
  - files indexed
  - artifacts produced
  - recovery attempt number
  - slides under critique/repair when known

Do **not** pretend to know total completion just because a phase timer passed.

#### E2. Add explicit “risk boundary” messaging

Examples:

- `Draft complete. Running visual review.`
- `Deck repaired. Final export checks in progress.`
- `Temporary provider issue. Retrying automatically.`

The user should understand when the run is:

- still composing
- reviewing
- repairing
- finalizing publish

#### E3. Never show `99%` or equivalent before publish is actually safe

The current pass caps below completion.
Next pass should codify the final rule:

- pre-publish max percent should be bounded to the stage band
- completed means artifacts are durably published

#### E4. Show checkpoint truth instead of synthetic reassurance

Examples:

- `Story locked`
- `Draft deck generated`
- `Revision pass running`
- `Export checkpoint saved`

This is better than a smooth-but-fake bar.

## F. Make Failure Classes Operationally Useful

### Goal

The system needs failure classes that drive behavior, not just UI copy.

### Required changes

#### F1. Canonical failure classifier must drive:

- in-phase retry
- superseding attempt policy
- template fallback policy
- salvage eligibility
- refund/billing behavior
- UI message mapping

#### F2. Split structured-output failures more precisely

Current `structured_output_invalid` is too broad.

Split into at least:

- analysis JSON invalid
- manifest invalid
- rendered-page QA invalid
- artifact repair invalid

The point is not taxonomy for its own sake.
The point is to:

- retry the right step
- salvage from the right checkpoint
- audit the right failure cluster

## G. Make Cost And Request Truth Good Enough To Trust

### Goal

When a run fails, operators must still know what was attempted and how much it cost.

### Required changes

#### G1. True request linkage

Current telemetry is still phase-linked, not fully request-linked.

Required implementation:

- request-start row and request-complete row must be the same logical record
- retries within the same phase must remain distinguishable
- phase aggregation should be derived from request truth, not the reverse

#### G2. Cost truth must survive failed late-stage runs

Required implementation:

- every request that actually hit Anthropic must be visible in durable telemetry
- failed export/final-QA runs must no longer show ambiguous or incomplete request truth

#### G3. Add a simple operator-facing reconciliation view/script

Not a dashboard project.
Just enough to answer:

- what requests happened
- which phase they belong to
- which attempt they belong to
- what the total was

## H. Template-Backed Reliability Gate

### Goal

Do not let template-backed runs remain the weakest lane.

### Required changes

#### H1. Track template-backed run success rate separately

This must be explicit in telemetry and operator audit tools.

#### H2. Template fallback must be phase-aware and narrow

Fallback should only happen when the failure is plausibly template-caused.
Do not silently convert unrelated runtime bugs into Basquio Standard reruns.

#### H3. Do not claim template mode truthfully unless surfaced

If a run fell back:

- the API must say so
- the run UI should expose it cleanly
- the operator should not need DB forensics to know it happened

## Implementation Order

The next agent should work in this order:

1. checkpoint contract definition
2. merged happy-path generation design (`understand + author` reduction)
3. export checkpoint persistence
4. recovery-from-highest-checkpoint
5. request-truth telemetry
6. worker stale queued/run integrity
7. progress/checkpoint UI truth refinements
8. template-backed lane reliability gate

Do not start with UI polish.
Do not start with docs.
Do not start with notifications.

## Minimum Files Likely To Change

- [generate-deck.ts](/Users/marcodicesare/conductor/workspaces/basquio/la-paz/packages/workflows/src/generate-deck.ts)
- [worker.ts](/Users/marcodicesare/conductor/workspaces/basquio/la-paz/scripts/worker.ts)
- [failure-classifier.ts](/Users/marcodicesare/conductor/workspaces/basquio/la-paz/packages/workflows/src/failure-classifier.ts)
- [rendered-page-qa.ts](/Users/marcodicesare/conductor/workspaces/basquio/la-paz/packages/workflows/src/rendered-page-qa.ts)
- [jobs route](/Users/marcodicesare/conductor/workspaces/basquio/la-paz/apps/web/src/app/api/jobs/[jobId]/route.ts)
- [v2 progress route](/Users/marcodicesare/conductor/workspaces/basquio/la-paz/apps/web/src/app/api/v2/runs/[runId]/progress/route.ts)
- [run-progress-view.tsx](/Users/marcodicesare/conductor/workspaces/basquio/la-paz/apps/web/src/components/run-progress-view.tsx)
- supporting persistence/storage helpers as needed

## Acceptance Criteria

This pass is only done when all of the below are true:

1. A healthy workbook-led run no longer commonly takes 30-40 minutes.
2. A late malformed export QA response does not kill a valid revised deck.
3. Recovery resumes from the highest valid checkpoint, not from `normalize`, whenever possible.
4. Stale/recovered attempts cannot easily fork into ghost duplicate work.
5. Progress never races to fake completion while risky work is still pending.
6. Template-backed runs are no longer the obviously weaker lane.
7. Operators can reconcile request and cost truth from internal telemetry without Anthropic console forensics.
8. A fresh production smoke run proves the new behavior on:
   - Basquio Standard
   - imported workspace template

## Verification Required

- `pnpm typecheck`
- `pnpm qa:basquio`
- focused unit/integration coverage for:
  - final QA malformed JSON salvage
  - checkpoint reuse after stale recovery
  - stale queued/run repair integrity
  - request-truth telemetry linkage
- one fresh production Basquio Standard smoke run
- one fresh production imported-template smoke run

## Final Rule

Do not declare this done because the code looks cleaner.

Done means:

- faster
- materially more reliable
- truthful in state, progress, and cost
- proven on fresh production runs
