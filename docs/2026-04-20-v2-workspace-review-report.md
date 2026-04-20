# V2 Workspace review report

Date: 2026-04-20
Reviewer: independent review session (see `docs/v2-workspace-review-agent-prompt.md`)
Branch: `v2-research-memo`
Commits audited: `ea745ba` (Task 7a-e) through `87f8b57` (Task 10)

## What I checked

1. Type-check from the repo root, filtered to touched files.
2. `apps/web` Next.js build.
3. Entity resolution benchmark (170 pairs, 48 candidates).
4. Seed script dry-run against production Supabase.
5. Live smoke on basquio.com for every V2 route listed in the prompt.
6. Emoji and em-dash grep over the Task 1-10 file set.
7. AI-slop phrase grep over the Task 1-10 file set.
8. Security matrix for every route under `apps/web/src/app/api/workspace/*` (16 handlers, 3 layers each: sign-in, team-beta, resource ownership).
9. `import "server-only"` contamination audit. Every client component under `apps/web/src/components/workspace-*.tsx` that imports from `@/lib/workspace/` uses `import type` only. No runtime server-only regression.
10. Spec §3 checklist walk, decision by decision.
11. Dead code hunt (`void <expr>;` band-aids, unused locals and functions).
12. Type-escape hunt (`as any`, unchecked JSON paths).

## Findings and fixes

| # | Finding | File and line | Impact | Fix commit |
|---|---------|---------------|--------|------------|
| A | 18 em dashes across Task 8 and Task 9 source files and scripts (working rules §4) | entity-resolution.ts, metaphone.ts, workspaces.ts, gen-entity-resolution-corpus.ts, seed-demo-template.ts | AI-tell, rejected by working rules | [502fc13](../../../502fc13) |
| B | `/api/workspace/scopes/[id]` GET, PATCH, DELETE did not verify scope belongs to the current workspace | apps/web/src/app/api/workspace/scopes/[id]/route.ts | Team-beta user could rename or delete scopes in the demo_template workspace (seeded by Task 9) | [10d5ccd](../../../10d5ccd) |
| C | `getWorkspaceDeliverablePrefill` ignored the user id and scoped nothing, silencing an unused param with `void userId` | apps/web/src/app/(app)/jobs/new/page.tsx | Content exfiltration path: the body_markdown and prompt of any deliverable (including demo_template) loads when the id is known. Leaks become real once customer workspaces ship. | [06cc9b1](../../../06cc9b1) |
| D | `cloneWorkspace` logged scope / entity / memory insert errors to console.error and returned the new workspace row as success | apps/web/src/lib/workspace/workspaces.ts | Clone API returns 200 with a half-populated workspace when an insert fails. No loud failure for the caller. | [13e1d69](../../../13e1d69) |
| E | Five `void <expr>;` band-aids paired with dead locals or functions | entity-resolution.ts (queryInitial, initialKey), agent-tools.ts (two ctx voids, one misleading), workspace-memory-browser.tsx (pinned), seed-demo-template.ts (slugify) | Code written to silence warnings rather than against the task. Misleading `void ctx` in showStakeholderCardTool was especially bad because ctx IS used two lines later. | [83a8215](../../../83a8215) |
| F | `scripts/seed-demo-template.ts` imported `@supabase/supabase-js` which only lived in `apps/web/node_modules` | package.json | `pnpm typecheck` from the repo root failed with TS2307, polluting the signal-to-noise ratio of every review or CI run | [6daa239](../../../6daa239) |

All six fixes are new commits, not rebases or amendments. Every fix ran the full check suite and the live smoke before commit.

## Spec gaps not fixed (with justification)

- **Tool key naming.** Spec §3 Decision 2 names the five tools as `readMemory`, `teachRule`, `retrieveContext`, `showMetricCard`, `showStakeholderCard`. Code uses `memory` as the first key (both in `agent-tools.getAllTools` and in the `ChatMessage.tsx` switch). Renaming to `readMemory` is a one-line change in both files, but persisted conversations in `workspace_conversations.messages` carry `tool-memory-*` parts today. Renaming would silently stop rendering the readMemory chip on any re-opened prior conversation. The behavior (subtle chip for agent-initiated memory read, bold card for user-initiated teachRule) already matches the spec, so this is a cosmetic internal-key divergence. Not fixed in this review.
- **`/api/workspace/entities/[entityId]` scoping via the legacy constant.** The route relies on `BASQUIO_TEAM_ORG_ID` as the implicit workspace filter inside `getWorkspaceEntityDetail`. In V1 this is equivalent to `getCurrentWorkspace().id`. For the future V2 multi-tenant path this will need to migrate to the explicit `getCurrentWorkspace()` pattern used by memory/people/scopes routes. Not a V1 leak today, so not fixed here per the "do not harden failure modes that do not exist" rule in the prompt.
- **Entity resolution stage 6 is Levenshtein, not embedding cosine.** The spec research memo recommends embedding similarity. The shipped cascade uses Levenshtein on normalized strings and hits 98.84% precision / 100% recall on the 170-case benchmark, above the 90%/85% targets. Ship as-is. If precision degrades on real CPG traffic, reopen as a separate ticket.

## Final check output

### Type-check
```
apps/web/src/lib/workspace/parsing.ts(50,11): error TS2339: Property 'PDFParse' does not exist on type '{ default: (dataBuffer: Buffer<ArrayBufferLike>, options?: PdfParseOptions | undefined) => Promise<PdfData>; }'.
```
The only remaining type error is pre-existing in `parsing.ts` (Session B/C code, not Task 1-10 scope). No new errors introduced by the six review fixes.

### Next build
Passes. All 6 workspace routes render:
```
/workspace                     12.3 kB    335 kB
/workspace/deliverable/[id]    5.97 kB    111 kB
/workspace/memory              6.6 kB     112 kB
/workspace/people              161 B      105 kB
/workspace/people/[id]         3.24 kB    109 kB
/workspace/scope/[kind]/[slug] 190 B      323 kB
```

### Entity resolution benchmark
```
Candidates:   48
Test cases:   170
Accuracy:     99.41%
Precision:    98.84%    (target: ≥ 0.90)
Recall:       100.00%   (target: ≥ 0.85)
F1:           99.42%
TP: 85   FP: 1   TN: 84   FN: 0
RESULT: pass.
```

### Seed dry-run
```
Seeding demo template (dry-run=true)
[workspace] exists id=8ef04863-d24e-4bc5-84cc-245a19697ef5
Done. workspace_id=8ef04863-d24e-4bc5-84cc-245a19697ef5, scopes=7, entities=8, memories=4
```

### Live smoke
```
200  https://basquio.com/workspace
200  https://basquio.com/workspace/memory
200  https://basquio.com/workspace/people
200  https://basquio.com/workspace/scope/client/mulino-bianco
200  https://basquio.com/workspace/deliverable/ac2644ef-ef32-4120-93a8-31158937765e
200  https://basquio.com/jobs/new?deliverable=ac2644ef-ef32-4120-93a8-31158937765e
```

### Emoji and em-dash grep
Zero matches in Task 1-10 files.

### AI-slop phrase grep
Zero matches.

## Summary

Six findings, six fixes, all checks green.

Two were real security-adjacent bugs (scopes/[id] ownership leak, getWorkspaceDeliverablePrefill ownership leak).
One was a correctness bug hidden by a console.error (cloneWorkspace partial-failure swallowing).
Three were code hygiene violations (em dashes, dead code band-aids, missing root dep).

Three spec divergences documented but not fixed: tool key internal naming, entities/[entityId] legacy scoping pattern, and the Levenshtein-vs-embedding cascade stage 6. Each has a specific reason to ship as-is.

Production live smoke green at the moment this report was written. All fixes are on `v2-research-memo` and ready to push to origin.
