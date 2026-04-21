# Workspace → deck context and cost architecture — implementation spec

Date: 2026-04-21  
Status: replace prior partial guidance  
Audience: fresh implementation agent  
Primary goal: make workspace-generated runs fully context-aware end to end, and make summary-tier Sonnet runs economically sane without hard-capping quality

---

## 1. Executive verdict

Two things are true at the same time:

1. The workspace→deck loop is now materially implemented in the shipped workspace code.
2. The deck engine is still architecturally wrong for cost and repair control.

The current shipped workspace path already carries more context than I first gave it credit for:

- chat answer → saved memo / deliverable
- deliverable → `/jobs/new?deliverable=<id>`
- server-side enrichment via workspace memory, stakeholders, and cited documents
- cited knowledge docs upserted into `source_files`
- generation form reuses those `source_file_ids`
- `/api/generate` and `/api/v2/generate` persist `brief` and `source_file_ids` onto `deck_runs`

That part is real and audited.

The remaining problem is that the runtime still treats this rich workspace handoff mostly as a long enriched brief plus files, not as a first-class run contract. At the same time, the revise architecture is too expensive:

- file-backed phases are budget-blind before execution
- revise still regenerates the full artifact set
- revise can regress the deck, then spend more money undoing its own regression
- cheap claim / formatting / traceability fixes are still paying Sonnet-class costs

The correct implementation is not a blunt budget cap. The correct implementation is:

- freeze a formal `WorkspaceContextPack` at run creation
- persist it on the run and make it explicit to author, revise, and QA
- move cheap fixes out of the expensive Sonnet lane
- change revise acceptance from a simple threshold loop to a frontier-based controller
- replace output-only preflight on file-backed phases with telemetry-based cost envelopes

---

## 2. What was audited

### 2.1 Current runtime repo

This worktree is:

- repo: `port-louis`
- head at audit time: `95a56f9`

Audited files:

- `packages/workflows/src/generate-deck.ts`
- `packages/workflows/src/cost-guard.ts`
- `packages/workflows/src/system-prompt.ts`
- `scripts/native-workbook-charts.py`
- `scripts/worker.ts`
- `railway.toml`
- `Dockerfile.worker`

Relevant recent runtime commits:

- `5f33d90` — author-time rubric
- `7adb611` — revise loop based on issue load
- `a0d03bb` — worker recovery + workbook charting hardening
- `95a56f9` — workbook chart injection binding

### 2.2 Shipped workspace code

The current `port-louis` root app code does not contain the shipped workspace UI path. Inside this workspace, shipped `main` is mounted at:

- worktree: `.context/main-landing`
- audited head: `7dfdb21`
- matches `origin/main` at audit time

Audited files:

- `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts`
- `.context/main-landing/apps/web/src/app/(app)/jobs/new/page.tsx`
- `.context/main-landing/apps/web/src/components/workspace-chat/Chat.tsx`
- `.context/main-landing/apps/web/src/components/workspace-chat/ChatMessage.tsx`
- `.context/main-landing/apps/web/src/components/workspace-deliverable-view.tsx`
- `.context/main-landing/apps/web/src/components/generation-form.tsx`
- `.context/main-landing/apps/web/src/components/run-progress-view.tsx`
- `.context/main-landing/apps/web/src/lib/run-launch-draft.ts`
- `.context/main-landing/apps/web/src/app/api/generate/route.ts`
- `.context/main-landing/apps/web/src/app/api/workspace/deliverables/route.ts`
- `.context/main-landing/docs/motion2-workspace-architecture.md`
- `.context/main-landing/docs/2026-04-20-v2-workspace-review-report.md`

Relevant recent workspace commits:

- `87f8b57` — workspace → deck pipeline bridge
- `eff4e21` — chat → output loop
- `58f8d00` — workspace context carried into deck pipeline
- `331e15f` — citation/source-file hardening in a sibling worktree carrying the same feature line

### 2.3 User-provided local inputs

Audited local materials:

- `/tmp/attachments/workspace motion 2.txt`
- `/tmp/attachments/pasted_text_2026-04-21_07-45-34.txt`

These are consistent with the shipped workspace code and the documented Motion 2 thesis.

---

## 3. Verified current state

### 3.1 The shipped workspace loop is already partly closed

This is not hypothetical. It is in code.

- Assistant messages expose `Save as memo` and `Generate deck`: `.context/main-landing/apps/web/src/components/workspace-chat/ChatMessage.tsx:79`
- Chat `generateDeck()` first saves the memo, then redirects to `/jobs/new?deliverable=<id>`: `.context/main-landing/apps/web/src/components/workspace-chat/Chat.tsx:252`
- The deliverable page uses the same handoff URL: `.context/main-landing/apps/web/src/components/workspace-deliverable-view.tsx:172`
- `/jobs/new` reads `?deliverable=` and calls `getWorkspaceDeliverablePrefill(...)`: `.context/main-landing/apps/web/src/app/(app)/jobs/new/page.tsx:458`
- That prefill path calls `buildEnrichedBrief(...)`: `.context/main-landing/apps/web/src/app/(app)/jobs/new/page.tsx:360`
- `buildEnrichedBrief(...)` explicitly assembles workspace context and mints cited knowledge documents as `source_files` for the deck pipeline: `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts:51`
- It loads scoped memory and workspace/analyst rules: `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts:90`
- It loads linked stakeholders: `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts:104`
- It resolves cited documents into `source_files`: `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts:119`
- It flattens that state into the markdown `# Workspace context` prelude: `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts:239`
- Generation form seeds from the prefill and reuses existing `source_file_ids` if the user uploads nothing new: `.context/main-landing/apps/web/src/components/generation-form.tsx:271`, `.context/main-landing/apps/web/src/components/generation-form.tsx:867`
- `launchRun()` writes a session draft first, not the final API call: `.context/main-landing/apps/web/src/components/generation-form.tsx:552`, `.context/main-landing/apps/web/src/lib/run-launch-draft.ts:34`
- The actual `/api/generate` POST happens later from the run page: `.context/main-landing/apps/web/src/components/run-progress-view.tsx:282`
- `/api/generate` rebuilds the effective brief, validates reused `existingSourceFileIds`, and enqueues `p_brief` plus `p_source_file_ids`: `.context/main-landing/apps/web/src/app/api/generate/route.ts:595`, `.context/main-landing/apps/web/src/app/api/generate/route.ts:705`, `.context/main-landing/apps/web/src/app/api/generate/route.ts:458`

### 3.2 The shipped workspace loop still drops important structure

What survives into the engine today:

- `businessContext` as one markdown blob containing the workspace prelude plus memo body: `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts:284`
- `client` from `scopeName`: `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts:288`
- `objective` from `deliverable.prompt.slice(0, 400)`: `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts:291`
- `audience = "Executive stakeholder"`: `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts:292`
- `source_file_ids` for cited docs only: `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts:192`

What does not survive as first-class run state:

- `workspace_id`
- `workspace_scope_id`
- `conversation_id`
- `from_message_id`
- full chat history
- uncited workspace files
- structured memory entries
- structured stakeholder objects
- structural scope metadata beyond prose

Additional verified losses:

- citations are harvested only from `retrieveContext` tool outputs, not from all workspace tools: `.context/main-landing/apps/web/src/components/workspace-chat/ChatMessage.tsx:57`
- memo prompt is derived from the first user message, not the full conversation intent: `.context/main-landing/apps/web/src/components/workspace-chat/Chat.tsx:199`
- if `buildEnrichedBrief()` fails, the flow falls back to a thin brief with no workspace-attached `sourceFiles`: `.context/main-landing/apps/web/src/app/(app)/jobs/new/page.tsx:385`

### 3.3 The cost problem is real and architectural

The successful production rerun `d021e65b-68bf-487f-b155-2858d341a116` cost about `$9.08`.

Verified high-level progression:

- author visual QA: `8.7`
- revise 1 visual QA: `8.2` and worse
- revise 2 visual QA: `8.7` and recovery
- claim issues improved `3 -> 2 -> 1`

So the system spent real money on a regress-then-recover loop.

The engine logic that causes this is also in code:

- file-backed preflight skips real token counting and falls back to output-only projection: `packages/workflows/src/cost-guard.ts:44`
- current Sonnet preflight/hard/cross-attempt caps are blunt global constants: `packages/workflows/src/cost-guard.ts:12`
- revise still explicitly demands full artifact regeneration: `packages/workflows/src/generate-deck.ts:4267`
- the compact revise thread still replays the original `generationMessage`, not only a true patch payload: `packages/workflows/src/generate-deck.ts:4315`
- revise stop conditions are threshold-based, not best-state or frontier-based: `packages/workflows/src/generate-deck.ts:7275`
- revise budget is only issue-load weighted, not value-aware: `packages/workflows/src/generate-deck.ts:7287`

### 3.4 Scatter export bug is real

This is a straight capability-matrix bug:

- prompt contract says scatter is supported in Excel-native chart mapping: `packages/workflows/src/system-prompt.ts:1439`
- Python workbook injector supports `scatter`: `scripts/native-workbook-charts.py:41`
- the TypeScript allowlist excludes `scatter`: `packages/workflows/src/generate-deck.ts:7705`
- chart injection uses that broken allowlist: `packages/workflows/src/generate-deck.ts:6726`

Result: scatter data reaches the workbook, but no native editable scatter chart is injected.

### 3.5 Worker shutdown and stale recovery hardening are already partly fixed

Do not regress the current worker protections:

- explicit shutdown handoff exists: `scripts/worker.ts:66`
- claim race on shutdown is handled: `scripts/worker.ts:126`
- stale recovery now considers active request rows before superseding: `scripts/worker.ts:539`

This spec is about the next layer: context continuity and cost architecture.

---

## 4. Non-negotiable product invariants

These are mandatory. Do not negotiate them away in implementation.

### I1. Workspace-generated decks are not cold runs

If a run originates from workspace context, the runtime must treat it as a workspace-aware run, not as a plain free-text brief with some attached files.

### I2. No silent context loss across boundaries

The following boundary chain must preserve context:

- workspace chat
- deliverable row
- `/jobs/new`
- generation form
- `/api/generate` or `/api/v2/generate`
- `deck_runs`
- worker author phase
- revise phase
- QA / publish

If context is dropped at any step, that is a product failure.

### I3. Budget is a guardrail, not the strategy

Do not solve this by lowering caps until quality dies. Fix the expensive architecture first.

### I4. Repair lanes must match repair type

Do not pay Sonnet/code-exec prices for problems that are deterministic or can be fixed by a small Haiku pass.

### I5. Revise must not accept self-inflicted regressions

The system cannot keep paying for passes that worsen higher-priority dimensions and only later recover them.

### I6. The engine contract must be explicit and typed

Workspace context must become a typed runtime contract, not just a longer `businessContext` string.

---

## 5. Target architecture

### 5.1 Introduce `WorkspaceContextPack`

Add a first-class typed object that represents the frozen workspace context used for a specific run.

Minimum shape:

```ts
type WorkspaceContextPack = {
  workspaceId: string;
  workspaceScopeId: string | null;
  deliverableId: string | null;
  scope: {
    id: string | null;
    kind: string | null;
    name: string | null;
  };
  stakeholders: Array<{
    id: string;
    name: string;
    role: string | null;
    preferences: Record<string, unknown>;
  }>;
  rules: {
    workspace: string[];
    analyst: string[];
    scoped: string[];
  };
  citedSources: Array<{
    documentId: string;
    fileName: string;
    sourceFileId: string | null;
  }>;
  sourceFiles: Array<{
    id: string;
    kind: string;
    fileName: string;
    storageBucket: string;
    storagePath: string;
  }>;
  lineage: {
    conversationId: string | null;
    messageId: string | null;
    deliverableTitle: string | null;
    prompt: string | null;
    launchSource: "workspace-chat" | "workspace-deliverable" | "jobs-new" | "other";
  };
  styleContract: {
    language: string | null;
    tone: string | null;
    deckLength: string | null;
    chartPreferences: string[];
  };
  renderedBriefPrelude: string;
  createdAt: string;
  schemaVersion: number;
};
```

This pack must be frozen at run creation and persisted.

### 5.2 Persist the context pack on the run

Do not rely only on `brief.businessContext`.

Persist the pack:

- either directly on `deck_runs.workspace_context_pack`
- or in a run-scoped support artifact table that is durably linked to `deck_runs`

The agent should prefer a typed JSON column on `deck_runs` plus a rendered markdown support packet uploaded as a run artifact.

### 5.3 Author, revise, and QA must all read the same contract

At minimum:

- author sees `workspace-context.md` and `workspace-context.json`
- revise sees the same pack plus only the delta payload for touched slides
- QA and critique classifiers can inspect workspace rules when deciding whether something is actually a blocker

### 5.4 Revise must become frontier-controlled

Acceptance order:

1. blocking contract / traceability failures
2. claim-traceability failures
3. major / critical visual issues
4. visual score
5. advisory issues

Keep the best state on that ordered frontier. A revise pass that worsens a higher-priority dimension without offsetting benefit should stop or roll back.

### 5.5 Cost preflight must use telemetry for file-backed phases

For file-backed phases, output-only estimates are not acceptable.

Use empirical cost envelopes keyed by:

- model
- target slide count bucket
- phase
- workspace-context run vs cold run
- count and type of file attachments
- presence of revise

This is the right fix for `packages/workflows/src/cost-guard.ts:48`.

### 5.6 Repair must be routed by type

Split fix types into lanes:

- deterministic lane
  - title numbering
  - punctuation / em dash / formatting
  - manifest hygiene
  - direct chart binding fixes where data already exists
- Haiku lane
  - traceability wording
  - citation phrasing
  - recommendation softening / hardening
  - title claim normalization
- Sonnet lane
  - structural slide redesign
  - chart redesign
  - storyline repair
  - true visual / analytical re-authoring

### 5.7 Revise must become patch-based

Do not regenerate the full deck for local fixes.

The correct target is:

- select touched slides only
- generate a patch plan
- rerender only touched slides and manifest slices
- run one final compose/export step

That is the long-term canonical architecture.

---

## 6. Required implementation workstreams

## W1. Formalize and persist `WorkspaceContextPack`

Goal: upgrade the shipped enrichment path from “longer brief” to “formal runtime contract”.

Primary code paths:

- `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts`
- `.context/main-landing/apps/web/src/components/workspace-chat/Chat.tsx`
- `.context/main-landing/apps/web/src/components/workspace-chat/ChatMessage.tsx`
- `.context/main-landing/apps/web/src/app/(app)/jobs/new/page.tsx`
- `.context/main-landing/apps/web/src/components/generation-form.tsx`
- `.context/main-landing/apps/web/src/components/run-progress-view.tsx`
- `.context/main-landing/apps/web/src/app/api/generate/route.ts`
- `.context/main-landing/apps/web/src/app/api/workspace/deliverables/route.ts`
- runtime run schema / migrations in the current repo

Required changes:

- make `buildEnrichedBrief` return both:
  - `renderedBriefPrelude`
  - structured `WorkspaceContextPack`
- persist `workspace_id`, `workspace_scope_id`, `conversation_id`, `from_message_id`, and launch source onto the run lineage
- persist the pack at run creation
- upload a rendered `workspace-context.md` support packet into the run container
- keep the current enriched brief as a human-readable convenience, but stop treating it as the only contract
- stop deriving the deck prompt from only the first user message when richer conversation lineage exists
- decide explicitly which non-`retrieveContext` tool outputs should become structured run context instead of being silently dropped

Done when:

- a workspace-generated run can be reloaded later and its exact context pack is still inspectable
- author, revise, and QA can all access the same persisted pack

## W2. Add context continuity tests

Goal: prove context does not silently disappear.

Required tests:

- workspace memo with:
  - scoped memory
  - workspace rule
  - stakeholder preference
  - cited knowledge document
- generate a run
- assert:
  - `deck_runs` stores the pack
  - support packet exists
  - author receives the pack
  - revise receives the same pack
  - cited docs remain attached as `source_file_ids`

## W3. Replace file-backed budget blind spot with telemetry envelopes

Primary code path:

- `packages/workflows/src/cost-guard.ts`

Required changes:

- keep the count-tokens path for inline-only calls
- for file-backed phases, replace output-only fallback with empirical envelope lookup
- envelope inputs must include at least:
  - model
  - phase
  - target slide bucket
  - file count
  - workspace-context flag
  - prior spend
- persist predicted vs actual to improve the envelope table over time

Do not:

- solve this by simply raising the caps
- solve this by lowering the caps until runs fail earlier

## W4. Add repair routing before Sonnet revise

Primary code path:

- `packages/workflows/src/generate-deck.ts`

Required changes:

- classify critique issues into deterministic / Haiku / Sonnet buckets
- run deterministic patchers first
- run one cheap Haiku pass for traceability and textual repair
- enter Sonnet revise only if structural/visual issues remain

This is the highest-ROI spend reduction after W3.

## W5. Replace threshold-only revise control with frontier control

Primary code path:

- `packages/workflows/src/generate-deck.ts`

Current problem:

- `deckStillNeedsRevise(...)` at `packages/workflows/src/generate-deck.ts:7275` is threshold-only
- `computeReviseIterationBudget(...)` at `packages/workflows/src/generate-deck.ts:7287` is severity-only

Required changes:

- compute an ordered frontier state after author and after each revise pass
- checkpoint best state
- refuse a pass that worsens higher-priority dimensions without compensating gain
- allow rollback to best state before publish

Do not implement score-only rollback. It is too naive.

## W6. Shrink revise context aggressively

Primary code path:

- `packages/workflows/src/generate-deck.ts`

Current problem:

- revise still carries `generationMessage` into `buildMinimalReviseThread(...)`: `packages/workflows/src/generate-deck.ts:4315`

Required changes:

- stop replaying the full author prompt payload
- include only:
  - `WorkspaceContextPack` summary
  - touched slide JSON
  - touched workbook slices
  - current rendered deck evidence for touched slides
  - issue list

This work should materially reduce cache-read spend.

## W7. Make revise patch-based

Primary code path:

- `packages/workflows/src/generate-deck.ts`

Required changes:

- build slide patch plans
- rerender only touched slides
- update manifest incrementally
- perform one final export/compose step

This is the largest refactor. Schedule it after W3-W6 unless the agent can do it cleanly without destabilizing production.

## W8. Fix scatter export and add workbook regression coverage

Primary code paths:

- `packages/workflows/src/generate-deck.ts`
- `scripts/native-workbook-charts.py`

Required changes:

- include `scatter` in `supportsNativeExcelChart(...)`
- add a regression that opens the generated workbook and asserts a native `ScatterChart` exists when manifest requests scatter

This bug is separate from cost, but it is a real production correctness miss and should land in the same implementation program.

---

## 7. Recommended rollout order

### Wave 1 — stop obvious money leaks

Ship first:

- W3 telemetry envelopes
- W4 repair routing
- W5 frontier control
- W8 scatter fix + regression

Expected effect:

- summary-tier Sonnet runs stop burning money on obviously misrouted repair work
- scatter workbook output becomes correct

### Wave 2 — make workspace context contractual

Ship second:

- W1 `WorkspaceContextPack`
- W2 continuity tests

Expected effect:

- workspace-generated runs become reproducible and inspectable
- context continuity stops depending on a long prose prelude

### Wave 3 — canonical runtime architecture

Ship third:

- W6 compact revise context
- W7 patch-based revise

Expected effect:

- revise cost moves from “expensive second author pass” toward “local patch pass”

---

## 8. Acceptance criteria

The implementation is only done if all of the following are true.

### A. Workspace context continuity

- A workspace-generated run stores a typed context pack.
- The pack includes memory, stakeholders, rules, lineage, and cited source attachment metadata.
- The exact same pack is visible to author, revise, and QA.

### B. Cost sanity

- A clean 10-slide Sonnet summary-tier run should normally land closer to `$4` than `$9`.
- One local repair pass should not look like a second full author pass.
- File-backed preflight is no longer output-only blind.

### C. Revise quality control

- A revise pass that worsens the best frontier state is not silently accepted.
- Cheap textual / traceability fixes do not route through expensive Sonnet code execution unless they are entangled with true structural repair.

### D. Workbook correctness

- Scatter manifests produce editable scatter charts in `data_tables.xlsx`.

---

## 9. Validation plan

### Runtime / cost

- fixed canary on a stable 10-slide workspace-backed brief
- compare:
  - author spend
  - revise spend
  - cache-read spend
  - total spend
- verify predicted vs actual envelope accuracy

### Context continuity

- integration test for workspace memo → run creation → worker receipt → revise receipt
- assert exact same `WorkspaceContextPack.schemaVersion` and pack hash across stages

### Workbook

- workbook fixture with scatter manifest
- assert native scatter chart XML exists

### Safety

- rerun existing worker and publish QA
- do not regress shutdown handoff behavior already present in `scripts/worker.ts`

---

## 10. Required documentation updates when code lands

If this implementation changes runtime architecture, the implementation agent must also update:

- `docs/decision-log.md`
- `memory/canonical-memory.md`
- `code/contracts.ts`

And run:

- `pnpm qa:basquio`

If migrations are added, verify selected columns against the actual migration-defined schema before shipping.

---

## 11. External references used for architecture decisions

Primary references only:

- Anthropic prompt caching: `https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching`
- Anthropic pricing: `https://docs.anthropic.com/en/docs/about-claude/pricing`
- Anthropic context management + memory tool announcement: `https://www.anthropic.com/news/context-management`
- Anthropic “Building effective agents”: `https://www.anthropic.com/research/building-effective-agents`
- Motion 2 local architecture thesis: `/Users/marcodicesare/Documents/Projects/basquio/docs/motion2-workspace-architecture.md`

What these references imply here:

- cache reads are cheaper, not free
- long input contexts still materially affect cost
- context editing and durable memory should be treated as first-class runtime architecture, not prompt garnish
- evaluator/optimizer loops should be used narrowly and only when they add measurable value

---

## 12. Final instruction to the implementation agent

Do not paper over this by writing a bigger prompt or tweaking a single cap.

You are implementing two linked changes:

1. formal workspace-context continuity across the entire run pipeline
2. cost-correct repair architecture for file-backed deck generation

If you only do one of them, the product remains wrong.
