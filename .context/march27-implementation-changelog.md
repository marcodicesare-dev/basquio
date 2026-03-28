## P0-0 revise phase try/catch

Before: a throw anywhere in the revise phase could escape to the global catch and fail the run after valid author artifacts already existed.
After: the entire revise phase is wrapped in a try/catch that logs telemetry and completes the phase as salvaged while keeping the author-phase PPTX/PDF/manifest in place for export.
Verification: `pnpm qa:basquio` passed.

## P0-1 wire lintDeckText into pipeline

Before: the writing linter existed but the V6 deck pipeline never called it, so critical deck text problems never fed into revise and no final lint telemetry existed.
After: author-manifest linting now runs immediately after manifest parse, critical/major lint findings are appended to critique issues for revise, and a final non-blocking lint pass records remaining violations before export.
Verification: `pnpm qa:basquio` passed.

## P0-2 harden salvage error path

Before: understand analysis was only stored as `analysis_result`, checkpoint salvage died if the saved manifest was malformed, and export-phase failures could still drop valid in-memory PPTX/PDF buffers on the floor.
After: understand now also persists `analysis_checkpoint` and recovery prefers it, checkpoint salvage synthesizes a manifest from PPTX slide XML when needed, and export-phase fallback now republishes valid in-memory artifacts with stub DOCX/minimal QA instead of failing zero-byte.
Verification: `pnpm qa:basquio` passed; `npx tsc --noEmit` passed.

## P0-3 reduce continuation budgets

Before: author could consume up to 10 pause turns and revise up to 8, which amplified context replay cost on long runs.
After: author is capped at 5 pause turns and revise at 4, matching the audit’s continuation budget reductions.
Verification: `pnpm qa:basquio` passed.

## P0-4 phase-level wall-clock timeouts

Before: `runClaudeLoop` had no per-phase wall-clock ceiling and no remaining-budget gate between continuations, so long pause-turn chains could keep running until a broader failure stopped them.
After: `runClaudeLoop` now supports per-phase timeout signals plus a continuation budget threshold, and understand/author/revise plus their artifact-recovery turns pass the audit’s timeout budgets into the shared loop.
Verification: `pnpm qa:basquio` passed; `npx tsc --noEmit` passed.

## P1-1 extend claim-exhibit mismatch detection

Before: deterministic mismatch detection only caught distribution-change claims paired with distribution-level chart titles, and manifest chart metadata did not preserve category-count hints.
After: chart metadata now retains optional category/category-count fields, mismatch detection also flags broader growth/acceleration claims against level-only chart metadata, and top-N claims are checked against chart category count when the manifest provides it.
Verification: `pnpm qa:basquio` passed; `npx tsc --noEmit` passed.

## P1-2 deterministic recommendation-card geometry

Before: the system prompt only described recommendation-card separation qualitatively, which left card internals vulnerable to overlap when the model improvised spacing.
After: the static prompt now provides explicit pixel geometry for the recommendation-card bounding box plus index/title/body/footer bands, with hard non-overlap instructions.
Verification: `pnpm qa:basquio` passed.

## P1-3 wire validateDeckContract into pipeline

Before: the V6 pipeline no longer ran deck-level rendering-contract validation after manifest parse, so those deterministic layout/shape violations never reached revise.
After: deck contract validation now runs on author manifests, its violations are appended to critique issues for revise, and the final shipped manifest gets a non-blocking contract telemetry pass alongside the final lint pass.
Verification: `pnpm qa:basquio` passed; `npx tsc --noEmit` passed.

## Runtime verification and diagnosis

Before: local `/api/v2/generate` verification was blocked by a stale local `SUPABASE_SERVICE_ROLE_KEY`, so the route failed during source-file upload before the worker ever saw the run.
After: with the corrected local key, a terminal-authenticated `/api/v2/generate` request returned `202` and queued run `74e906b0-16fa-4266-a09e-17fccf0f0265` successfully through the real V2 path.
Verification: the controlled V2 run was claimed by the worker, then failed in `understand` with `failure_message = "request ended without sending any chunks"`, `failure_phase = "understand"`, `continuationCount = 0`, `requestCount = 0`, and `estimatedCostUsd = 0`. This isolates the remaining blocker to an Anthropic zero-chunk/provider response during understand, not the V2 API, auth, storage, or worker queue path.

## Worker concurrency and shutdown hardening

Before: the worker had first been changed from sequential execution to unbounded fire-and-forget concurrency, but that version could immediately requeue still-running attempts during shutdown and could also claim duplicate attempts for a run already active in the same process.
After: the worker now uses bounded configurable concurrency (`BASQUIO_WORKER_MAX_CONCURRENCY`, default `2`), skips already-active run IDs before claiming, and on shutdown waits up to a drain timeout before requeueing only the still-running attempts.
Verification: `npx tsc --noEmit` passed; `pnpm qa:basquio` passed.

## Export publish and transient storage hardening

Before: export salvage still depended on a fresh final artifact upload, so runs could fail after successful checkpoint salvage if Supabase storage rejected the final `artifacts/<runId>/deck.pptx` publish; worker supersession also ignored transient storage/network failures.
After: checkpoint-backed exports now publish `artifact_manifests_v2` directly against the durable checkpoint storage paths and treat DOCX upload as best-effort during salvage, workflow storage uploads fall back from direct object POST to signed PUT with clearer transient-storage errors, and the worker auto-retries both transient provider and transient network/storage failures (`transient_network_retry` is also checkpoint-resume eligible).
Verification: `npx tsc --noEmit` passed; `pnpm qa:basquio` passed.
