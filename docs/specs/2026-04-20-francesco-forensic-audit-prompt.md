# Forensic audit prompt — francesco's stuck run (2026-04-20)

Paste this into a fresh Claude / Codex / GPT session. The agent has no context — give them this whole file. Goal: independent verification (or refutation) of a prior agent's diagnosis.

---

## Your job

You are doing a forensic audit of a failed deck-generation run on Basquio production. A prior agent diagnosed the cause as a missing heartbeat in the `normalize` phase. The user does NOT trust that conclusion and wants you to independently verify or refute it.

**Adversarial stance: try to prove the prior agent wrong.** Find a different cause. If you can't, then and only then confirm the diagnosis. Do not rubber-stamp.

## The incident

- **Run UUID:** `b0e5fe78-aa84-4c02-ad60-b8ab1f058d7b`
- **Reporter:** francesco@basquio.com (basquio co-founder, FMCG analyst)
- **What he tried:** Italian brief for Gigante regional CPG share analysis, 10 slides, Sonnet 4.6, with a `Template 2026.pptx` (38 layouts) attached
- **Outcome:** 8 attempts over 4h28min. Final status `failed`. UI showed "still processing" for 2+ hours; he gave up
- **Cost billed:** $0
- **Last successful runs:** 2026-04-17 — three runs at 07:05, 08:19, 16:40 UTC, all `delivery=reviewed`, 1 attempt each
- **Window of silence:** No runs between 04-17 16:40 and 04-20 09:02

## The prior agent's diagnosis (the claim you must validate or destroy)

> The `normalize` phase in `packages/workflows/src/generate-deck.ts` (lines 878-1166) does NOT call `touchAttemptProgress` between `completePhase("normalize")` (line 936) and `markPhase("author")` (line 1166). That gap contains 3 blocking `client.beta.files.upload(...)` Promise.all calls. Stale recovery in `scripts/worker.ts` supersedes attempts whose `last_meaningful_event_at` is older than 8 minutes. When Anthropic Files API is slow (which it was on 04-20 morning — confirmed by one captured 500 from `req_011CaF752PiyQqzoUPDKes4n`), uploads exceed 8 minutes, stale recovery fires, attempt is superseded mid-upload, repeat forever. Bug is latent for weeks; manifests only when Anthropic Files API degrades. Fix: add 4 `touchAttemptProgress` calls in the gap.

## Repo + access

You have shell access to the repo at `/Users/marcodicesare/conductor/workspaces/basquio/port-louis`. The `git` CLI works. The `railway` CLI is logged in as user `loamly`, project `basquio-bot`, env `production`, service `basquio-worker`. The `gh` CLI works.

The Supabase project for the deck pipeline is `fxvbvkpzzvrkwvqmecmi`. The Supabase MCP is connected to a DIFFERENT project (`nebszkmraojbivrosxdl`) — useless. Use direct PostgREST instead:

```bash
set -a; source /Users/marcodicesare/conductor/workspaces/basquio/port-louis/.env.vercel.local; set +a
URL=$(echo "$NEXT_PUBLIC_SUPABASE_URL" | tr -d '"')
KEY=$(echo "$SUPABASE_SERVICE_ROLE_KEY" | tr -d '"')
# example
curl -s "$URL/rest/v1/deck_runs?id=eq.b0e5fe78-aa84-4c02-ad60-b8ab1f058d7b&select=*" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | python3 -m json.tool
```

The two CSV log exports are at `/tmp/attachments/Basquio Web Log Export Apr 20 2026.csv` and `/tmp/attachments/Supabase Storage Logs (56).csv`.

The relevant tables: `deck_runs`, `deck_run_attempts`, `deck_run_events`, `deck_run_phase_requests`, `working_papers`. Their columns: query the row first to see schema. Notable columns on `deck_run_attempts`: `id`, `run_id`, `attempt_number`, `status`, `recovery_reason`, `failure_phase`, `failure_message`, `worker_deployment_id`, `started_at`, `last_meaningful_event_at`, `updated_at`, `superseded_by_attempt_id`, `supersedes_attempt_id`, `cost_telemetry`, `anthropic_request_ids`.

CLAUDE.md is at `/Users/marcodicesare/conductor/workspaces/basquio/port-louis/CLAUDE.md`. Read the "Hard-won rules" section.

## Verifiable facts (don't take these on trust — confirm each)

1. The `deck_runs` row for `b0e5fe78-aa84-4c02-ad60-b8ab1f058d7b` shows `status=failed`, `failure_phase=normalize`, `latest_attempt_number=8`, `failure_message` containing the Anthropic 500 + `req_011CaF752PiyQqzoUPDKes4n`, `cost_telemetry.failureClass=transient_provider`, `cost_telemetry.estimatedCostUsd=0`.
2. The 8 rows in `deck_run_attempts` for that run: each has a different `worker_deployment_id`. Attempts 1-7 have `failure_message="Run timed out and was automatically recovered."` and `failure_phase=stale_timeout`. Attempt 8 has the real Anthropic 500.
3. For each of attempts 1-8, `last_meaningful_event_at - started_at` is between 6 and 9 seconds. Then 30-45 minutes pass before `updated_at` shows the attempt was superseded.
4. The 6 commits I'm worried about (mine, on `port-louis` branch, all on 04-17 evening UTC): `0406746`, `062c5ca`, `da02a94`, `09d9a5e`, `5f33d90`, `7adb611`. Get them with `git log --since="2026-04-17" --oneline -- packages/workflows/ packages/intelligence/`.
5. Between 09:02 and 13:06 UTC on 04-20, 24 commits hit `main` from a separate effort (V2 workspace UI), all touching only `apps/web/src/lib/workspace/*`. Get with `git log origin/main --since="2026-04-20T08:00:00Z" --until="2026-04-20T14:00:00Z" --pretty="%h %ai %s" --name-only`.
6. `STALE_ATTEMPT_MEANINGFUL_MINUTES=8` and `STALE_RUN_MINUTES=5` in `scripts/worker.ts:12-15`. `getMeaningfulStaleMinutesForPhase` returns 8 for `normalize` (default branch).
7. `touchAttemptProgress` is called from `generate-deck.ts` at lines 1229, 1262, 1746, 1777, 1900, 2993, 4258 — but check: NONE of these are in the 936-1156 gap.
8. `client.beta.files.upload` is called at lines 941-948, 949-958, 961-966 (three separate blocks) — all inside the 936-1156 gap.
9. `ANTHROPIC_TIMEOUT_MS` is `process.env.BASQUIO_ANTHROPIC_TIMEOUT_MS ?? "3600000"` (60 min default; CLAUDE.md says Railway env sets it to 1800000 = 30 min).
10. Anthropic SDK config in `generate-deck.ts:813-816`: `maxRetries: 2`, `timeout: ANTHROPIC_TIMEOUT_MS`.

## Counter-hypotheses to investigate

You must investigate ALL of these before agreeing or disagreeing. Cite evidence.

### H1 (the prior agent's claim) — heartbeat gap in normalize→author setup
Verify by inspecting `generate-deck.ts:878-1166`. Confirm or refute: is there really no `touchAttemptProgress` in that window? Could one of the helper calls (e.g. `markPhase`, `completePhase`, `insertEvent`, `persistTemplateDiagnostics`, `persistEvidenceWorkspace`, `upsertWorkingPaper`) implicitly bump `last_meaningful_event_at`? Read each helper's source.

### H2 — Anthropic Files API was actually fine; something else broke
Check Anthropic's status page archive for 2026-04-20 09:00-14:00 UTC. If Anthropic was healthy, then 7 sequential 6-9-second attempt deaths cannot be explained by API slowness. What else could it be?
- A code-level early throw between `markPhase("normalize")` and the file uploads?
- A network-level issue from Railway egress?
- A Supabase storage issue (the source files have to be downloaded first — check `loadSourceFiles`)?

### H3 — Bug was introduced by one of my 04-17 commits
For each commit (`0406746`, `062c5ca`, `da02a94`, `09d9a5e`, `5f33d90`, `7adb611`), run `git show <sha> -- packages/workflows/src/generate-deck.ts` and look for any change in or near lines 800-1200. Also check `git show <sha> -- scripts/worker.ts`. Also check changes to anything that could affect normalize: `loadRun`, `loadSourceFiles`, `parseEvidencePackage`, `interpretTemplateSource`, `markPhase`, `completePhase`, `client.beta.files.upload` patterns, `Anthropic` client construction.

If a commit changed any of these in a way that could regress, say which commit + which lines.

### H4 — Railway redeployed the worker mid-attempt
The 8 different `worker_deployment_id` values per attempt look suspicious. Check: are these Railway deployment IDs (proving the worker process was killed and restarted 8 times) or just the worker's session ID (different on every attempt by design)? Read `scripts/worker.ts` to find where `worker_deployment_id` is set. If it's the Railway deployment ID, check `railway logs --service basquio-worker --build` and the Railway deploy history (via `railway status` or the dashboard) — was the worker actually redeployed 8 times in 4.5 hours? If yes, why? CLAUDE.md says deploys are manual.

### H5 — Worker was healthy but couldn't claim the run
Check the worker's claim logic: `claimNextQueuedAttempt` in `scripts/worker.ts`. Could a database condition (RLS, exclusive lock, mismatched status enum) have prevented the worker from claiming the run for hours? Then attempt 1 would have started 09:02:55 with `last_meaningful_event_at` = 9 sec because that's when the worker finally got the claim through. But wait — there's only 9 sec of meaningful event then nothing. So the worker DID start. This hypothesis is probably wrong but verify.

### H6 — `touchAttemptProgress` is broken / silently failing
Even if it's called somewhere, maybe it errors silently. Read its implementation in `generate-deck.ts:3020+` (around line 3020-3050). Does it catch its own errors? Could the upsert have been failing for weeks?

### H7 — Stale recovery's threshold is the wrong knob to fix
Maybe the bug is that stale recovery shouldn't be running at all on attempts where the worker process is verifiably alive. Read `scripts/worker.ts:425-580` (`recoverStaleAttempts`). What's the relationship between `last_meaningful_event_at` (attempt-level), `updated_at` (attempt-level, bumped by heartbeat), and `workerLikelyDead` (computed from `updated_at` of the deck_runs row)? Is the prior agent's F2 fix coherent?

## What to deliver

A single response under 800 words structured as:

```
## Verdict
ONE OF: confirms prior diagnosis | refutes prior diagnosis | partial: confirms X, refutes Y, finds new cause Z

## Evidence summary
[Bulleted facts you confirmed via reading code or querying the DB. Cite file:line and SQL output.]

## Per-hypothesis findings
H1: [confirmed/refuted, with evidence]
H2: ...
...
H7: ...

## What the prior agent got wrong (if anything)
[Specific corrections, with evidence]

## What the prior agent got right (if anything)
[Specific affirmations, with evidence]

## Recommended fix
[Either the same as prior agent's, or your alternative. Specify file:line + actual code change.]

## Validation plan
[How to verify the fix without spending $3 on a production run.]
```

## Rules

- Cite file:line for code claims. Cite SQL output (with the actual query you ran) for data claims.
- If a fact is uncertain, say so. Do not invent.
- The user pushed back on the prior agent twice with "you sure? inspect inspect" — apply the same energy.
- Do not propose adding max-attempts caps, backoff, or worker-deployment-strategy changes. The user has explicitly rejected those.
- Do not edit any files. Read and report only.
- Stay under 800 words.
