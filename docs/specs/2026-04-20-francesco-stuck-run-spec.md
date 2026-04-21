# Francesco's stuck run — forensic + fix spec (v2, after deeper inspection)

Date: 2026-04-20
Run UUID: `b0e5fe78-aa84-4c02-ad60-b8ab1f058d7b`
Reporter: francesco@basquio.com
Brief: Italian, "Gigante" regional CPG share analysis, 10 slides, Sonnet 4.6, with `Template 2026.pptx` (38 layouts)

This spec replaces the v1 draft. The v1 was wrong about the cause.

---

## 1. What I had wrong in v1

| v1 claim | Reality |
|---|---|
| V2 workspace branch killed the worker via Railway redeploys | All 24 V2 commits between 09:02 and 13:06 UTC touched **only `apps/web/src/lib/workspace/*`** — never the deck pipeline. Railway worker auto-deploy on every push to main may still be misconfigured, but it didn't cause this. |
| `MAX_ATTEMPTS_PER_RUN = 3` cap needed | Marco's call: attempts should be unlimited. Caps would just kill the run earlier without fixing the actual bug. |
| Anthropic 500 was the cause | Only attempt 8's failure_message was a 500. Attempts 1-7 all show `"Run timed out and was automatically recovered."` — they were **stale-recovered**, not failed by Anthropic. The 500 only surfaced on attempt 8 because that was the only attempt that lasted long enough for the SDK to give up retrying. |

## 2. What actually happened — verified

**Pipeline succeeded 3/3 on April 17 (10/70/10 slides, 1 attempt each, all `delivery=reviewed`). Then nothing ran until April 20 09:02. Francesco's run failed.**

Attempts table (`deck_run_attempts`):

| # | started_at | last_meaningful_event_at | gap | failure_phase | message |
|---|---|---|---|---|---|
| 1 | 09:02:55 | 09:03:04 | **9 sec** | stale_timeout | "Run timed out and was automatically recovered." |
| 2 | 09:43:41 | 09:43:48 | **7 sec** | stale_timeout | (same) |
| 3 | 10:15:03 | 10:15:10 | **7 sec** | stale_timeout | (same) |
| 4 | 10:47:34 | 10:47:41 | **7 sec** | stale_timeout | (same) |
| 5 | 11:20:29 | 11:20:35 | **6 sec** | stale_timeout | (same) |
| 6 | 12:01:44 | 12:01:51 | **7 sec** | stale_timeout | (same) |
| 7 | 12:54:46 | 12:54:52 | **6 sec** | stale_timeout | (same) |
| 8 | 13:30:49 | 13:30:56 | **7 sec** | normalize | "500 ... Internal server error" (Anthropic req `req_011CaF752PiyQqzoUPDKes4n`) |

Every attempt: 6-9 seconds of meaningful progress, then frozen. After ~30-40 minutes, stale recovery supersedes. Attempt 8 happened to land in a window where Anthropic's Files API gave up faster (or returned a 500) instead of just hanging — so its catch block ran and persisted the 500 as the failure_message before stale recovery could re-supersede.

## 3. The actual structural bug

Look at `packages/workflows/src/generate-deck.ts:878-1156`. The phase transition sequence is:

```
878:  currentPhase = "normalize"
879:  await markPhase(...)                          // phase = "normalize", touches updated_at
880-936: parseEvidencePackage + interpretTemplateSource +
        persistTemplateDiagnostics + persistEvidenceWorkspace +
        upsertWorkingPaper("execution_brief") + validateAnalyticalEvidence
936:  await completePhase(... "normalize" ...)      // does NOT bump phase pointer
941-948: Promise.all(evidenceFiles.map(client.beta.files.upload))   ← ANTHROPIC FILE UPLOAD
949-958: Promise.all(supportPackets.map(client.beta.files.upload))  ← ANTHROPIC FILE UPLOAD
961-966: client.beta.files.upload(templateFile)                     ← ANTHROPIC FILE UPLOAD
968-987: buildBasquioSystemPrompt + system-prompt assembly
989-1075: checkpoint-eligibility logic + loadArtifactCheckpoint + loadCheckpointArtifacts
1108/1129/1156/1166: next markPhase happens here (HOURS later in francesco's case)
```

**Between line 936 (`completePhase("normalize")`) and line 1166 (`markPhase("author")`), there is ZERO call to `touchAttemptProgress`.** That's ~230 lines of synchronous setup including 3+ blocking Anthropic Files API uploads.

The stale-recovery check in `scripts/worker.ts:471-498`:
```ts
const staleMinutes = getMeaningfulStaleMinutesForPhase(runRow.current_phase);   // → 8
const staleBefore = Date.now() - staleMinutes * 60_000;
const progressAt = Date.parse(attempt.last_meaningful_event_at ?? attempt.updated_at);
if (progressAt >= staleBefore) continue;
// otherwise mark stale and supersede
```

So if Anthropic's Files API takes more than ~8 minutes (or hangs and the SDK retries), stale recovery fires while the worker process is still actively waiting on the upload. The attempt is superseded. The next attempt does the same thing.

**This bug has been latent for weeks.** It only surfaces when Anthropic's Files API is slow. The 04-17 runs got lucky — uploads completed in seconds. The 04-20 runs hit a window where uploads were 500-ing or slow.

The worker's `updated_at` is kept fresh by `startHeartbeat` (line 115 of worker.ts), so `workerLikelyDead = false` and the worker process keeps running. But `last_meaningful_event_at` only moves forward when business logic explicitly calls `touchAttemptProgress`, and there is no such call in the normalize→author gap.

## 4. Did my 04-17 commits make it worse?

Slightly, but they did NOT introduce the bug:

- `0406746`, `062c5ca`, `da02a94`, `09d9a5e`, `5f33d90`, `7adb611` — all touched `generate-deck.ts`, `system-prompt.ts`, `slide-plan-linter.ts`, `deck-manifest.ts`, and added new validators.
- None of them changed the normalize phase, the file upload code, or the gap between `completePhase("normalize")` and `markPhase("author")`.
- They did add ~250 lines elsewhere (revise loop, rubric, validators), but those run AFTER the normalize gap, not inside it.

The pipeline ran 3/3 successful on 04-17 because Anthropic was fast. It would have stalled identically on 04-20 even at HEAD = `aa9ab1c` (commit before any of my Wave 2/3 work).

## 5. Why the worker logs are silent

`railway logs --service basquio-worker -n 5000` shows only:
```
Starting Container
[basquio-worker] starting (max concurrency 10)
Starting Container
[basquio-worker] starting (max concurrency 10)
```

That's because (a) Railway only retains logs for the most recent ~1-2 deployments and the worker has been redeployed since, and (b) on a healthy idle poll, the worker prints **nothing** between `await sleep(POLL_INTERVAL_MS)` cycles — no heartbeat log, no "polled, queue empty" log. The only logs come from claim, heartbeat-failure, recovery, and shutdown events. So when nothing is queued, the worker is invisible.

For francesco's morning, attempts 1-8 each generated a `[basquio-worker] claimed run b0e5fe78...` line — those exist in Railway, but only on the deployment that was running at the time of each claim. Each subsequent redeploy wiped the prior deployment's logs. **Nothing is wrong with the worker process itself.**

## 6. Fix

### F1 — Heartbeat the normalize→author setup gap (THE ACTUAL FIX)
Add `await touchAttemptProgress(config, runId, attempt, "normalize")` calls at four points in `packages/workflows/src/generate-deck.ts`:

1. After line 948 (after `uploadedEvidence` Promise.all completes)
2. After line 958 (after `uploadedSupportPackets` Promise.all completes)
3. After line 966 (after `uploadedTemplate` upload completes, if templateFile)
4. After line 1075 (after checkpoint-eligibility resolution, before the next phase decision)

Each call touches `last_meaningful_event_at = NOW()`. Stops stale recovery from firing during file uploads, even if Anthropic Files API is slow.

```ts
// After each upload step:
await touchAttemptProgress(config, runId, attempt, "normalize").catch(() => {});
```

~4 lines added. No retries, no caps, no backoff — just heartbeat.

### F2 — Stale recovery must respect active worker process
In `scripts/worker.ts:461-498`, the current logic supersedes an attempt the moment `last_meaningful_event_at` ages past 8 min, EVEN IF `updated_at` (the worker's own heartbeat) is still fresh. That's wrong: a fresh `updated_at` means the worker process is alive and almost certainly still working on this attempt — superseding it creates a duplicate.

Change: only supersede when **both** `last_meaningful_event_at` is stale AND `updated_at` is also stale (worker process appears dead). If `updated_at` is fresh but `last_meaningful_event_at` is stale, the run is still "owned" by a live worker doing slow work — let it finish.

Cost: 1 extra column in the SELECT (already there at line 431) + 1 extra condition.

### F3 — File uploads should heartbeat during retry
The Anthropic SDK retries 500s twice internally with backoff. During those retries, `last_meaningful_event_at` is frozen. Wrap each `client.beta.files.upload(...)` call in a small helper that touches progress on each attempt:

```ts
async function uploadWithHeartbeat<T>(label: string, fn: () => Promise<T>) {
  const result = await fn();
  await touchAttemptProgress(config, runId, attempt, "normalize").catch(() => {});
  return result;
}
```

Optional. F1 alone is sufficient if upload normally completes inside 8 min.

## 7. Explicitly NOT going to do

- ❌ **No max-attempts cap.** Marco's call. Attempts retry until the run succeeds or the user cancels.
- ❌ **No "transient_provider" early bail.** If Anthropic is degraded, retry forever — eventually it recovers.
- ❌ **No exponential backoff.** Orthogonal to the bug.
- ❌ **No worker deployment changes.** The Railway redeploy theory was wrong.
- ❌ **No new heartbeat thread inside the Anthropic client call.** Single touchAttemptProgress calls between blocking awaits are sufficient.
- ❌ **No spec rework of `failure_phase` or `failure_message`.** They were correct — the worker just couldn't surface the real Anthropic error before stale recovery raced ahead.

## 8. Validation (no $3 production rerun needed)

1. **Smoke test for F1**: locally, mock `client.beta.files.upload` to sleep 10 minutes. Run a 1-slide deck. Confirm `last_meaningful_event_at` updates after each upload, and stale recovery does NOT fire. Without F1, the run is superseded inside 9 minutes.
2. **Smoke test for F2**: insert a fake `deck_run_attempt` row with `last_meaningful_event_at` 15 min stale but `updated_at` 30 sec fresh. Run `recoverStaleAttempts`. Confirm it does NOT supersede. Then artificially age `updated_at` to 10 min stale — confirm it DOES supersede.
3. **Production verification**: queue a 10-slide Sonnet brief tomorrow morning. Confirm 1-attempt completion. If Anthropic Files API is degraded again, F1 means the upload still finishes (no 8-min window cuts it off) and the attempt either succeeds or fails with a real Anthropic error message instead of "stale_timeout".

## 9. Ranked priority

1. **F1 (THE FIX, ~4 lines)** — ship today.
2. **F2 (defensive, ~5 lines)** — ship next.
3. **F3 (extra safety inside SDK retries)** — only if F1+F2 don't catch every case in the next two weeks of production runs.

---

## Appendix — answer to "what the fuck is the problem now?"

The pipeline was working 72h ago because Anthropic's Files API was fast. It broke today because Anthropic was slow/degraded around 09:00-13:30 UTC (we have one direct 500 from `req_011CaF752PiyQqzoUPDKes4n`).

The structural fragility — **`STALE_ATTEMPT_MEANINGFUL_MINUTES = 8` enforced over a ~230-line synchronous block that does 3 blocking Anthropic file uploads** — has been there for weeks. It only manifests when Anthropic is degraded.

My 04-17 commits did NOT introduce this bug. They added ~250 lines elsewhere in the file (revise loop, rubric, validators) but did NOT touch the normalize → author setup gap.

Fix is small: add 4 `touchAttemptProgress` calls in the gap. The pipeline will then survive multi-minute Anthropic file upload latency without stale-recovery thrashing.
