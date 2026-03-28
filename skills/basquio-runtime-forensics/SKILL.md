---
name: basquio-runtime-forensics
description: >
  Use when production behavior diverges from local assumptions, when a deck run burns money with zero output,
  or when you need a forensic root-cause timeline and anti-regression context update before changing the pipeline.
---

# Basquio Runtime Forensics

## Goal

Find the actual failure class from runtime evidence, tie it to the exact deployment and code change, and update repo context so the same mistake is harder to repeat.

## Required Reads

1. `docs/vision.md`
2. `docs/architecture.md`
3. `memory/canonical-memory.md`
4. `CLAUDE.md`
5. `rules/canonical-rules.md`
6. `memory/march28-48h-forensic-learnings.md`
7. `docs/stack-practices.md` when Supabase, worker liveness, or artifact publishing is involved

## Use This Skill For

- production runs that spend money and return zero artifacts
- local-vs-production drift
- timeout, liveness, retry, or supersede incidents
- schema mismatch or artifact-gate failures after paid model calls
- postmortems that should update memory, rules, or historical docs

## Workflow

1. Identify the exact failed run and attempt ids.
2. Find the last known-good comparable run, with timestamps and deploy/commit context.
3. Gather evidence before proposing fixes:
   - exported web logs
   - exported Postgres logs
   - storage/artifact logs
   - run/attempt/request usage rows
   - worker deployment ids and active commit
4. Split distinct failure classes instead of collapsing them together.
   Example: a zero-token retry loop and a paid schema-parse failure are different bugs.
5. Trace the regression window:
   - last known-good commit/deploy
   - first bad commit/deploy
   - exact diff that changed runtime behavior
6. Only then propose fixes.
7. Update canonical context in the same change:
   - `memory/canonical-memory.md`
   - `CLAUDE.md`
   - `memory/march28-48h-forensic-learnings.md` or the relevant incident doc
   - archival banners on stale briefs/audits when needed
8. Run `pnpm qa:basquio`.

## Hard Rules

- Do not tune timeouts from intuition. Check recent successful phase durations first.
- Do not treat SDK-forward model/tool ids as production truth.
- Do not claim a fix is canonical until a real production-equivalent run proves it.
- Do not swallow billing or publish-path errors just because the main run failed for another reason.
- Do not let historical planning docs outrank live runtime evidence.

## Refuse To Do

- merge multiple unrelated incidents into one speculative root cause
- ship “hardening” commits without identifying the regression they address
- leave contradictory runtime guidance unmarked in `.context` after the forensic work is done
