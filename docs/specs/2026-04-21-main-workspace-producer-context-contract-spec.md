# Main workspace producer -> deck context contract — production implementation spec

Date: 2026-04-21  
Status: ready for implementation  
Audience: fresh implementation agent  
Primary target: shipped workspace `main` producer flow in `.context/main-landing`, aligned to the runtime `WorkspaceContextPack` substrate already landed in `port-louis`

---

## 1. Executive verdict

Production `main` is not a cold deck launcher anymore, but it is still not the product-quality context engine Marco wants.

What exists today is a **prose-enriched handoff**:

- workspace chat answer -> deliverable
- deliverable -> `/jobs/new?deliverable=<id>`
- `buildEnrichedBrief(...)` prepends some memory, stakeholder preferences, and cited source names
- cited documents are upserted into `source_files`
- the deck runtime sees a richer `businessContext` blob plus files

That is real and useful, but it is **not yet a first-class workspace-memory run contract**.

The missing production-grade layer is:

1. authoritative server-side assembly of a frozen `WorkspaceContextPack`
2. complete lineage from workspace conversation into `deck_runs`
3. structured context continuity across author, revise, and QA
4. better context selection so the pack is rich without being bloated
5. stable cache geometry and cheaper repair architecture so context does not explode cost

The recent runtime work in this branch already created the substrate for this:

- `code/contracts.ts`
- `packages/types/src/index.ts`
- `supabase/migrations/20260421120000_workspace_context_pack.sql`
- `packages/workflows/src/workspace-context.ts`

The main missing work is now **producer-side on shipped `main`**, plus a few runtime trust/selection fixes.

---

## 2. Why it is still missing

### 2.1 The producer still collapses structured workspace state into prose

Current shipped producer logic lives in `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts`.

It does useful work:

- loads scoped memory
- loads workspace / analyst rules
- loads matching stakeholders
- resolves cited knowledge docs into `source_files`
- emits a markdown `# Workspace context` prelude

But it still outputs mostly this shape:

- `brief.businessContext`: one markdown blob
- `brief.client`: scope name
- `brief.objective`: truncated prompt
- `sourceFiles`: cited docs only

That means the engine receives **flattened prose**, not a typed contract with first-class semantics.

### 2.2 The chat lineage is incomplete and weakly harvested

Current shipped chat flow in `.context/main-landing/apps/web/src/components/workspace-chat/Chat.tsx` and `.context/main-landing/apps/web/src/components/workspace-chat/ChatMessage.tsx` has two critical losses:

- `gatherCitations(...)` only harvests citations from `retrieveContext` tool outputs
- `derivePrompt()` uses the **first user message only**, not the actual conversation intent or local workspace state that evolved later

That means important context can exist in the conversation but never make it into the deck handoff.

### 2.3 The run contract is not authoritative at the server boundary

In the runtime branch, the API now accepts `workspaceContextPack`, but that is still not sufficient for production truth.

Production-grade behavior must be:

- client sends lineage identifiers only
- server rebuilds the authoritative pack from trusted workspace tables
- server persists the frozen pack hash on `deck_runs`

It must **not** be:

- client sends a full pack
- API trusts it
- worker consumes it as truth

### 2.4 The current handoff only carries cited docs, not the full scoped evidence surface

Today `buildEnrichedBrief(...)` only attaches documents that were explicitly cited on the answer.

That is too narrow for the product promise.

A workspace-generated deck should be able to rely on:

- cited docs from the answer
- pinned scope docs
- explicitly attached files in the workspace scope
- recent deliverable lineage when relevant
- structured stakeholder / scope / rule memory

Not every workspace file should be dumped into the run, but **relevance-selected scope evidence** must be available.

### 2.5 Cost control is still too dependent on prompt shape instead of architecture

Even after the runtime fixes, the system still has two remaining structural problems:

- revise still regenerates the full artifact set
- file-backed cost envelopes are still heuristic rather than empirically learned from production telemetry

So the context contract fix and the cost architecture fix must be shipped together. Otherwise a richer workspace handoff simply creates a richer expensive prompt.

---

## 3. Forensic evidence from shipped history

Shipped `main` worktree: `.context/main-landing`

Relevant recent commits:

- `965133b` — shipped Anthropic Memory Tool + ask-anything generation
- `ea745ba` — AI SDK 6 chat surface plumbing
- `eff4e21` — chat -> output bridge (`Save as memo`, `Generate deck`)
- `58f8d00` — workspace context carried into deck pipeline
- `331e15f` — citation/source-file hardening

This sequence matters.

It shows the product has intentionally evolved in three stages:

1. **workspace answer generation**
2. **chat-to-output loop closure**
3. **enriched-brief bridge into deck pipeline**

The thing still not shipped is the fourth stage:

4. **first-class structured workspace run contract**

So the gap is not accidental. The team closed the loop at the prose-and-files layer, but stopped short of a typed run-context architecture.

---

## 4. State-of-the-art guidance as of 2026-04-21

### 4.1 Anthropic context management: memory must sit outside the active window

Anthropic’s official guidance is now explicit:

- the **memory tool** stores and consults information outside the active context window
- **context editing** clears stale tool results while preserving critical information via memory
- Anthropic reports **+39%** improvement on internal agentic-search evals from combining memory + context editing, and **84% token reduction** on a 100-turn web-search evaluation

Implication for Basquio:

- the correct architecture is **not** “make `businessContext` longer”
- the correct architecture is “freeze the right context, keep it structured, and pass only the relevant projection into each phase”

### 4.2 Anthropic prompt caching: stable prefixes matter, dynamic prose breaks caches

Anthropic’s prompt-caching docs matter here for two reasons:

- caching works on the **full prefix** and depends on identical prefix segments
- cache failures are often silent when the prefix changes shape or falls below model minimums
- key ordering and per-request variability can break cache reuse

Implication for Basquio:

- a workspace context pack should be rendered into a **stable canonical order**
- static workspace memory/rules should be separated from dynamic per-run deltas
- do not regenerate the same context as slightly different prose on every run

### 4.3 Anthropic context editing: long-running flows should preserve what matters, not replay everything

Anthropic’s current docs recommend combining memory with context editing, and explicitly recommend server-side compaction over SDK-side compaction when managing long-running conversations.

Implication for Basquio:

- workspace chat and deck generation should not rely on replaying giant message histories
- conversation lineage should be summarized into structured durable state at the handoff boundary
- author, revise, and QA should read the same frozen packet, not reconstruct context differently each time

### 4.4 AI SDK 6: the UI already supports structured message parts; use them

AI SDK 6 is current and `useChat()` is transport-based with structured `UIMessage.parts`.

Implication for Basquio:

- do not throw away tool output structure too early
- the producer can extract structured data from tool parts before converting to a deliverable snapshot
- `conversation_id`, message parts, and tool outputs can be used to build a better authoritative pack

### 4.5 Long-term memory best practice: namespace and type memory explicitly

Current LangChain/LangGraph guidance for long-term memory is straightforward:

- persist memory across sessions
- namespace it explicitly
- store long-term memory as structured documents, not only freeform chat replay
- distinguish long-term memory from short-term thread state

Implication for Basquio:

- workspace memory should remain typed and scoped (`workspace`, `analyst`, `scope`, `stakeholder`, etc.)
- the deck runtime should receive the selected structured memory projection, not only prose derived from it

### 4.6 Agent workflow best practice: keep the workflow as simple as possible and only iterate where it creates measurable value

Anthropic’s “Building effective agents” guidance still applies:

- prefer the simplest workflow that works
- use evaluator/optimizer loops only where they create measurable value

Implication for Basquio:

- a summary-tier Sonnet run should not pay for full-deck regenerate loops to fix punctuation, title wording, or citation phrasing
- claim/text/rule repairs need a cheaper lane than full Sonnet code-exec revise

---

## 5. Non-negotiable product invariants

### I1. Workspace-generated decks are workspace-native runs

If the user starts from workspace chat or a workspace deliverable, the run must preserve workspace memory, scope, lineage, and relevant evidence as first-class runtime state.

### I2. No silent context loss across boundaries

Context must survive all of these boundaries:

- workspace chat
- deliverable save
- `/jobs/new`
- launch draft
- `/api/generate`
- `deck_runs`
- worker author
- worker revise
- worker QA / publish

### I3. Server-side truth beats client-supplied truth

The client may send hints or IDs. The server assembles the final authoritative `WorkspaceContextPack`.

### I4. Context selection beats context dumping

The goal is not “include everything.”
The goal is “include the right stable context and the right scoped evidence.”

### I5. Quality cannot depend on a blunt budget cap

Budget caps remain safety rails. They must not be the primary cost-control mechanism.

### I6. Revise must be patch-oriented and frontier-controlled

The runtime must not repeatedly pay to regress and then recover.

---

## 6. Target architecture

## 6.1 Freeze a first-class `WorkspaceContextPack` at run creation

Do **not** invent a second schema. Reuse the runtime substrate already landed in this branch:

- `code/contracts.ts`
- `packages/types/src/index.ts`
- `packages/workflows/src/workspace-context.ts`

Canonical pack fields already exist:

- `workspaceId`
- `workspaceScopeId`
- `deliverableId`
- `scope`
- `stakeholders`
- `rules`
- `citedSources`
- `sourceFiles`
- `lineage`
- `styleContract`
- `renderedBriefPrelude`
- `createdAt`
- `schemaVersion`

Implementation rule:

- the shipped workspace producer in `.context/main-landing` must build this exact contract
- the runtime API must persist this exact contract on `deck_runs.workspace_context_pack`
- the worker must continue consuming the same contract and support packets

## 6.2 Introduce an authoritative server-side builder on shipped `main`

Add a new server-only builder in shipped `main`, for example:

- `.context/main-landing/apps/web/src/lib/workspace/build-workspace-context-pack.ts`

It must take trusted inputs such as:

- `deliverableId`
- authenticated viewer identity
- `launchSource`

It must query and assemble:

- workspace + scope metadata
- deliverable lineage (`conversation_id`, `from_message_id`, title, prompt)
- structured memory entries by scope class
- linked stakeholders and preferences
- cited docs already attached to the answer
- pinned / scoped source files that are explicitly eligible for deck generation
- style contract derived from scope + stakeholder + rules
- canonical rendered prelude for backward compatibility

## 6.3 Keep two outputs from the same builder

The builder must output both:

1. `workspaceContextPack` — typed JSON, persisted on `deck_runs`
2. `renderedBriefPrelude` — stable human-readable markdown for prompt compatibility

This keeps backward compatibility while moving the engine onto a typed contract.

## 6.4 Use stable pack rendering for cache geometry

The rendered prelude must use:

- deterministic section ordering
- deterministic sorting within sections
- no timestamps inside the rendered prelude
- no per-request random order
- no duplicated content already present in support packets

Why:

- Anthropic caches full prefixes
- minor shape drift breaks cache reuse
- Basquio should keep static workspace context stable and move run-specific delta into small dynamic sections

## 6.5 Capture richer lineage than the current bridge

The producer must preserve these first-class identifiers end to end:

- `workspace_id`
- `workspace_scope_id`
- `conversation_id`
- `from_message_id`
- `launch_source`
- `deliverable_id`

Additionally add a server-side conversation snapshot for the handoff:

- latest relevant user turns
- latest assistant answer turn
- memory/tool events that materially informed the answer

This should be stored as a compact structured projection, not the raw full transcript.

## 6.6 Expand evidence selection beyond cited-only docs

The pack builder should select evidence in priority order:

1. docs cited on the saved answer
2. docs explicitly pinned to the workspace scope
3. docs attached in the current scope and marked `indexed` + `deck-eligible`
4. optional recent deliverables in the same scope when flagged as reusable references

Do **not** automatically attach the entire workspace corpus.

Add an explicit eligibility rule, for example:

- only `indexed` documents
- only allowed mime/types for the deck worker
- only files under a configurable max count / byte threshold
- only the highest-priority set after relevance scoring

## 6.7 Treat stakeholder/style memory as a contract, not descriptive prose

The current prelude already hints at this, but the engine contract should make it explicit.

Normalize and persist a style contract shaped like:

```ts
{
  language: string | null,
  tone: string | null,
  deckLength: string | null,
  chartPreferences: string[],
}
```

Then author, revise, and QA can consume it directly.

## 6.8 Make the runtime API authoritative

In the tracked runtime branch:

- `/api/generate`
- `/api/v2/generate`

must stop trusting arbitrary client `workspaceContextPack` payloads as production truth.

Production behavior should become:

- if the request carries `deliverableId` / workspace lineage, server rebuilds the pack
- if the request is a rerun and `deck_runs.workspace_context_pack` exists, reuse the persisted pack
- if the request is not workspace-originated, no pack is attached

The client can still show a preview, but the persisted pack must be server-built.

---

## 7. Required implementation workstreams

## W1. Shipped `main` producer: build the authoritative pack

### Target files

- `.context/main-landing/apps/web/src/lib/workspace/build-workspace-context-pack.ts` (new)
- `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts`
- `.context/main-landing/apps/web/src/app/(app)/jobs/new/page.tsx`
- `.context/main-landing/apps/web/src/components/generation-form.tsx`
- `.context/main-landing/apps/web/src/components/run-progress-view.tsx`
- `.context/main-landing/apps/web/src/lib/run-launch-draft.ts`

### Changes

- add the new builder
- have `buildEnrichedBrief(...)` call it rather than assembling prose ad hoc
- include `workspaceContextPack` in the launch draft payload
- preserve it through reruns and draft rehydration
- keep `renderedBriefPrelude` derived from the pack, not rebuilt separately

### Hard rule

Do not let the UI invent its own pack shape. It must import the shared schema/contract.

## W2. Shipped `main` chat lineage: stop losing context before save

### Target files

- `.context/main-landing/apps/web/src/components/workspace-chat/Chat.tsx`
- `.context/main-landing/apps/web/src/components/workspace-chat/ChatMessage.tsx`
- `.context/main-landing/apps/web/src/app/api/workspace/deliverables/route.ts`

### Changes

- replace `derivePrompt()` with a conversation-intent summarizer built from the current conversation, not only the first user turn
- extend citation harvesting beyond `retrieveContext` where relevant tool outputs are source-bearing
- persist richer lineage on the deliverable record or an adjacent snapshot row
- persist enough structure to rebuild the pack later without depending on the browser state

### Hard rule

Do not store the entire raw transcript on `deck_runs`. Store a compact structured projection.

## W3. Runtime trust boundary: server rebuilds the pack

### Target files

- `apps/web/src/app/api/generate/route.ts`
- `apps/web/src/app/api/v2/generate/route.ts`
- `apps/web/src/app/api/jobs/[jobId]/route.ts`
- `apps/web/src/lib/workspace/...` server builder or imported helper

### Changes

- if request is workspace-originated, rebuild or validate the authoritative pack server-side
- compute and persist `workspace_context_pack_hash`
- expose the stored pack in the jobs snapshot/debug view
- ensure reruns keep the original frozen pack unless the user explicitly re-launches from a new workspace state

### Hard rule

Reruns should use the same frozen pack by default. Do not silently mutate run context during retry.

## W4. Context selection quality: add explicit eligibility and ranking

### Target files

- new scoped source selector helper under workspace libs
- existing brief enrichment / pack builder

### Changes

- add a relevance-scored file selector for workspace-origin runs
- introduce `deck-eligible` / `pinned-for-output` metadata if needed
- cap selected scoped evidence by count and size
- expose why each file was included in the pack metadata for auditability

### Hard rule

A run should be able to explain why a source file was included.

## W5. Runtime prompt geometry: eliminate duplication

### Target files

- `packages/workflows/src/generate-deck.ts`
- `packages/workflows/src/workspace-context.ts`

### Changes

- ensure the prompt receives workspace context from one canonical rendered packet path
- do not repeat the same context in `business_context`, support packets, and inline generation instructions
- author, revise, and QA must all load the same support packets

### Hard rule

One contract. One rendered prelude. No triple injection.

## W6. Cost architecture: finish the missing production pieces

### Target files

- `packages/workflows/src/cost-guard.ts`
- `packages/workflows/src/generate-deck.ts`
- telemetry tables already in Supabase

### Changes

1. replace heuristic file-backed envelopes with empirically learned envelopes from production request-usage telemetry
2. keep frontier-based revise acceptance
3. add true deterministic repair handlers for punctuation/title/format/reference issues
4. keep Haiku lane for claim/traceability wording repairs
5. implement touched-slide / patch-based revise instead of full artifact regeneration

### Hard rule

Do not ship a richer workspace context path while revise still pays full-deck Sonnet costs for cheap fixes.

## W7. Scatter and workbook regression coverage

### Target files

- `packages/workflows/src/generate-deck.ts`
- `scripts/native-workbook-charts.py`
- `scripts/test-native-workbook-charts.ts`

### Changes

- keep `scatter` in the TS native allowlist
- keep `scatter` in the Python injector
- assert native `ScatterChart` presence in workbook regression tests

This is not directly a context-contract issue, but it is a proven production miss in the same output surface.

---

## 8. Acceptance criteria

## A. Context continuity

For a workspace-origin run:

- `deck_runs.workspace_id` is populated
- `deck_runs.workspace_scope_id` is populated when scoped
- `deck_runs.conversation_id` is populated
- `deck_runs.from_message_id` is populated
- `deck_runs.launch_source` is correct
- `deck_runs.workspace_context_pack` is non-null
- `deck_runs.workspace_context_pack_hash` is non-null
- worker uploads `workspace-context.md` and `workspace-context.json`
- author, revise, and QA all read the same frozen packet

## B. Producer truth

- server can rebuild the pack from trusted workspace records without client-sent pack JSON
- reruns preserve the same frozen pack unless the user launches a fresh run from workspace

## C. Scope/evidence quality

- cited documents are included
- pinned scoped documents are included when eligible
- unrelated workspace documents are excluded
- included file count / bytes stay within configured caps
- pack metadata explains why each source file was selected

## D. Cost sanity

For the standard summary-tier Sonnet workspace fixture:

- author-only run stays within the target band defined from telemetry
- cheap textual repairs do not invoke Sonnet full-deck revise
- regress-then-recover loops are rejected by frontier control
- touched-slide revise materially reduces per-pass cost versus current full regeneration

## E. Auditability

- `/api/jobs/[jobId]` exposes stored pack + hash for inspection
- working papers record pack summary and author/revise/QA usage telemetry
- a failed run still preserves the pack and the phase-level request usage records

---

## 9. Tests the implementation agent must add

## T1. Workspace pack continuity test

Fixture:

- workspace memory entries in `workspace`, `analyst`, and scoped namespaces
- one linked stakeholder with structured preferences
- one cited doc
- one pinned scoped doc
- conversation lineage with `conversation_id` and `from_message_id`

Assert:

- server-built `WorkspaceContextPack` contains the correct structured fields
- launch draft carries it
- `/api/generate` persists it
- rerun reuses it unchanged

## T2. Producer trust test

Assert:

- malicious client-supplied pack contents do not override the authoritative server-built pack

## T3. Source selection test

Assert:

- cited doc included
- pinned scoped doc included
- unrelated indexed workspace doc excluded
- over-cap docs pruned deterministically

## T4. Prompt duplication test

Assert:

- rendered workspace prelude appears exactly once in the final authoring prompt/support-packet path

## T5. Cost-lane routing test

Fixture issues:

- deterministic-only issues -> deterministic lane
- claim-traceability-only issues -> Haiku lane
- major structural issues -> Sonnet revise lane

## T6. Scatter workbook regression test

Assert:

- scatter manifest produces native editable scatter chart in `data_tables.xlsx`

---

## 10. Rollout order

## Phase 1 — producer truth and continuity

Ship first:

- W1
- W2
- W3
- T1
- T2

This closes the core product gap: workspace-origin runs become first-class context-aware runs.

## Phase 2 — context quality and cost geometry

Ship next:

- W4
- W5
- T3
- T4

This prevents the richer pack from simply becoming a larger, more fragile prompt.

## Phase 3 — cost architecture completion

Ship next:

- W6
- T5

This gets summary-tier Sonnet runs back toward sane economics.

## Phase 4 — workbook regression hardening

Ship next:

- W7
- T6

---

## 11. What the implementation agent must not do

- Do not invent a second workspace context schema.
- Do not trust client-sent pack JSON as production truth.
- Do not attach the whole workspace corpus to every run.
- Do not fix this by only raising budget caps.
- Do not keep duplicating the same workspace context across multiple prompt surfaces.
- Do not regress the existing worker shutdown/recovery protections.
- Do not make runtime code depend on gitignored `.context` files in production.

---

## 12. Source list

### Local repo and worktree evidence

- `.context/main-landing/apps/web/src/components/workspace-chat/Chat.tsx`
- `.context/main-landing/apps/web/src/components/workspace-chat/ChatMessage.tsx`
- `.context/main-landing/apps/web/src/app/api/workspace/deliverables/route.ts`
- `.context/main-landing/apps/web/src/lib/workspace/brief-enrichment.ts`
- `.context/main-landing/docs/motion2-workspace-architecture.md`
- `.context/main-landing/docs/spec-v1-workspace-v2-research-and-rebuild.md`
- `/tmp/attachments/workspace motion 2.txt`
- `/tmp/attachments/pasted_text_2026-04-21_07-45-34.txt`
- `code/contracts.ts`
- `packages/types/src/index.ts`
- `packages/workflows/src/workspace-context.ts`
- `supabase/migrations/20260421120000_workspace_context_pack.sql`

### Official external guidance

- Anthropic memory tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- Anthropic context editing: https://platform.claude.com/docs/en/build-with-claude/context-editing
- Anthropic context management announcement: https://claude.com/blog/context-management
- Anthropic prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Anthropic building effective agents: https://www.anthropic.com/research/building-effective-agents
- AI SDK `useChat`: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat
- AI SDK reference / current major docs: https://ai-sdk.dev/docs/api-reference
- LangChain long-term memory: https://docs.langchain.com/oss/javascript/langchain/long-term-memory

