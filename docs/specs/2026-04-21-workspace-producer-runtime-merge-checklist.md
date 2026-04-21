# Workspace Producer + Runtime Merge Checklist

## Goal

Merge the workspace-native deck producer from `origin/main` with the runtime-side `WorkspaceContextPack` trust and rerun guarantees from `port-louis` without drifting the contract or duplicating logic.

This checklist is intentionally narrow. It covers only the remaining integration work needed after:
- `origin/main` commits `bd9aae6` and `8c886a4`
- `port-louis` runtime work for typed workspace packs, canonicalization, rerun pack reuse, worker consumption, revise/cost hardening, and workbook scatter support

## Current truth

### Producer side already landed on `main`
- workspace-native drawer and in-chat status surface
- server-built workspace pack producer
- brief synthesizer
- workspace generate route that sends first-class workspace RPC params

### Runtime side already landed in `port-louis`
- canonical `WorkspaceContextPack` schema in `code/contracts.ts`
- canonical exported type/schema in `packages/types/src/index.ts`
- server-side pack canonicalization helper in `apps/web/src/lib/workspace-context-pack.ts`
- reruns prefer persisted `deck_runs.workspace_context_pack`
- worker consumes `workspace_context_pack`, persists working papers, uploads `workspace-context.md/json`, and reuses the frozen pack during revise

## Required merge actions

### 1. Replace producer-local pack copies with the canonical shared contract

Files on `main` to update after merging `port-louis`:
- `apps/web/src/lib/workspace/build-context-pack.ts`
- `apps/web/src/app/api/workspace/generate/route.ts`

Required change:
- remove the local `WorkspaceContextPack` type copy
- import `workspaceContextPackSchema` and `WorkspaceContextPack` from `@basquio/types`
- remove the local `packSchema`

Why:
- there must be exactly one schema owner
- local producer copies will drift as soon as the runtime contract evolves

### 2. Stop trusting posted workspace packs in `/api/workspace/generate`

File on `main` to update after merging `port-louis`:
- `apps/web/src/app/api/workspace/generate/route.ts`

Required change:
- use the shared helper from `apps/web/src/lib/workspace-context-pack.ts`
- parse the posted pack with `parseWorkspaceContextPack`
- load authoritative attached `source_files`
- resolve the pack with `resolveAuthoritativeWorkspaceContextPack`
- hash with `hashWorkspaceContextPack`
- persist only the canonicalized/trusted pack to `enqueue_deck_run`

Do **not** rely on:
- local `stableStringify`
- local `hashPack`
- raw client `pack.sourceFiles`

Why:
- the producer branch currently validates shape but does not canonicalize against actual attached `source_files`
- runtime trust must stay server-owned

### 3. Keep reruns using the frozen persisted pack

If workspace-native reruns are added on `main`, they must follow the same rule already implemented in `port-louis`:
- when a rerun references a prior run, prefer the persisted `deck_runs.workspace_context_pack`
- do not rebuild or trust a browser-reposted pack by default

Required field:
- `sourceRunId`

Why:
- the workspace-native producer should not weaken the frozen-context guarantee already added to `/api/generate` and `/api/v2/generate`

### 4. Keep producer `businessContext` compatible with runtime extension rules

Current producer behavior on `main`:
- `/api/workspace/generate` composes `businessContext` as `renderedBriefPrelude + # Brief + synthesized narrative`

Current runtime behavior in `port-louis`:
- worker runs `extendBusinessContextWithWorkspacePack(...)`
- it is already duplicate-safe because it checks whether the prelude is already present before prepending it

Action:
- keep this behavior unless there is a measured token/cost reason to change it
- do not remove the worker-side duplicate guard

Why:
- this already merges safely
- changing both sides at once adds unnecessary risk

### 5. Do not overclaim the brief synthesizer

Current producer behavior on `main`:
- `apps/web/src/lib/workspace/synthesize-brief.ts` keeps the first user turn plus the last ~6 turns
- it does **not** synthesize from the full conversation transcript

Action:
- treat this as a bounded V1 heuristic, not “full-conversation synthesis”
- if upgraded later, do it with a proper conversation summary/cache, not raw unbounded transcript stuffing

Why:
- the current behavior is product-useful, but the implementation should be described honestly

### 6. Keep worker consumption as the runtime owner

No producer-side code should duplicate the worker’s responsibilities for:
- `workspace-context.md/json` support packet generation
- working paper persistence
- revise-time reuse of the frozen pack
- business-context extension policy

Those stay owned by:
- `packages/workflows/src/generate-deck.ts`
- `packages/workflows/src/workspace-context.ts`

### 7. Keep evidence harvesting limitations explicit

Current producer pack-building on `main` harvests evidence from:
- `retrieveContext` citations
- deliverable citations
- scoped/workspace/analyst memory
- workspace stakeholders

It does **not** yet guarantee inclusion of:
- uncited but relevant workspace documents
- arbitrary tool outputs outside the citation path
- full conversation state as structured evidence

Action:
- do not present this as the final state-of-the-art memory architecture
- treat it as the first production bridge

## Acceptance criteria after merge

### Contract
- producer imports `WorkspaceContextPack` and `workspaceContextPackSchema` from `@basquio/types`
- no local duplicate pack schema remains in workspace producer code

### Trust
- `/api/workspace/generate` uses the shared canonicalization helper before `enqueue_deck_run`
- spoofed or unattached `sourceFiles` cannot survive into `deck_runs.workspace_context_pack`

### Continuity
- workspace-origin reruns prefer the persisted pack from the source run
- worker receives the same frozen pack across author, critique, revise, and export

### UX
- workspace generation remains drawer-native and does not redirect into the old generic `/jobs/new` flow

### Validation
Run all of:
- `pnpm typecheck`
- `pnpm test:workspace-context-pack`
- `pnpm test:native-workbook-charts`
- `pnpm qa:basquio`

If producer files are merged into this repo tree, also manually verify:
- click `Generate deck` from workspace chat
- drawer opens and stays inside workspace chrome
- generated run row persists first-class workspace lineage fields
- run row persists `workspace_context_pack` and `workspace_context_pack_hash`
- worker uploads `workspace-context.md/json`
- the deck run reads any `knowledge-base` source files successfully

## Finish sequence

1. Merge `port-louis` runtime work
2. Rebase or merge the workspace producer commits from `main`
3. Apply actions 1 and 2 above immediately
4. Run validation
5. Run one workspace-native production canary
6. Only then call the workspace→deck bridge production-grade
