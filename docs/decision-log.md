# Decision Log

## April 21, 2026 — Service-scoped Railway configs (post-Discord-bot-silent-death forensic)

Decision:
- The repo root `railway.toml` is the deck worker config exclusively. Builds `Dockerfile.worker`. Runs `scripts/worker.ts`.
- Every other Railway service in the `basquio-bot` project must ship a service-scoped config under its own subdirectory. Discord bot lives at `apps/bot/railway.toml` pinned to `apps/bot/Dockerfile` and `tsx src/index.ts`.
- Watch patterns are service-scoped. Editing one service's config never re-deploys another.
- Add a heartbeat watchdog for every long-lived service. Silent death across a full night must alert.
- Audit-before-touch checklist for any `railway.toml`/`Dockerfile.*` change is recorded in `rules/canonical-rules.md` → "Railway / Multi-Service Deploy Rules".

Why:
- Apr 21 00:22 UTC, three commits hardening the deck worker (`7792727`, `d77142e`, `cbb6445`) rewrote the root `railway.toml`. Both Railway services in the `basquio-bot` project (deck worker AND Discord bot) consumed the SAME root config because neither had a service-scoped override.
- The Discord bot's service redeployed with the deck worker's start command. It crash-looped on `NEXT_PUBLIC_SUPABASE_URL is required` because the Discord bot's env vars use `SUPABASE_URL` (no `NEXT_PUBLIC_` prefix). 77+ restart attempts over the next hour.
- Last successful Discord transcript landed at Apr 20 21:14 UTC. The 2-hour Apr 21 strategy call was never captured. No audio file in `voice-recordings`. No row in `transcripts`. Permanently lost.
- Strategic content lost from that call (per Marco's recall): exists only in human memory. Reconstruction is on the team, not on tooling.

Cross-references:
- Rule text: `rules/canonical-rules.md` → "Railway / Multi-Service Deploy Rules (CRITICAL — learned April 21, 2026 forensic)"
- Memory entry: `memory/canonical-memory.md` → "Production Incident Memory: April 21, 2026 — Discord bot silent death"
- CLAUDE.md update: "Railway multi-service deploy isolation"
- Bot operator notes: `apps/bot/README.md` → "Railway deploy contract"

## April 21, 2026 — Freeze workspace context on deck runs and gate revise by frontier

Decision:
- persist a typed `WorkspaceContextPack` on `deck_runs` together with first-class lineage fields: `workspace_id`, `workspace_scope_id`, `conversation_id`, `from_message_id`, and `launch_source`
- upload `workspace-context.md` plus `workspace-context.json` into the authoring container and persist the same pack in working papers for later inspection
- stop replaying the full author prompt during revise; revise now carries a compact run summary plus the frozen workspace context packet
- replace file-backed output-only preflight with telemetry-shaped cost envelopes keyed by phase, slide count, file count, and workspace-context presence
- gate revise acceptance on an ordered frontier: blocking contract issues, claim-traceability issues, blocking visual issues, visual score, then advisory issues
- route non-structural repair work to a cheaper Haiku revise lane when no Sonnet-class structural or major visual issues remain

Why:
- workspace-origin runs were still arriving in the worker mostly as prose inside `business_context`, which made lineage non-inspectable and context continuity fragile
- revise could regress the deck on a higher-priority dimension, spend more money, and only later recover
- file-backed phases skipped token counting but still used an output-only projection that was too blind to real deck cost drivers

Implication:
- workspace-generated runs are now durable workspace-aware runs rather than cold briefs with a few attached files
- author, revise, and QA all see the same frozen workspace contract in both JSON and markdown form
- the worker keeps the best frontier state instead of silently accepting self-inflicted regressions
- cheap textual or claim-traceability repairs can avoid a Sonnet-class revise pass when structural redesign is not required

## April 21, 2026 — Make workbook-native charts deterministic

Decision:
- keep PPTX charts as raster screenshots for cross-viewer stability
- make `data_tables.xlsx` companion charts deterministic in the worker instead of relying only on model compliance
- require chart-bearing runs to publish workbook sheet links plus native Excel chart objects for supported chart families

Why:
- a completed production run on April 15, 2026 shipped `data_tables.xlsx` with zero `xl/charts/chart*.xml` entries even though the deck had six chart slides
- the workbook already contained the right analysis tables, so the failure was contract enforcement rather than missing data
- editable companion charts belong in Excel, where they do not threaten PPTX fidelity across PowerPoint, Keynote, and Google Slides

Implication:
- the worker must bind chart-bearing slides to workbook sheets deterministically from slide metadata plus workbook content
- after author and revise, the worker should inject native Excel charts into `data_tables.xlsx` for supported families before final QA and publish
- workbook-native chart checks become publish blockers for chart-bearing runs so this gap cannot regress silently

## April 11, 2026 — Normalize document-led evidence before authoring

Decision:
- when a run is document-led (`pdf` / `pptx` evidence with little or no tabular data), generate a normalized evidence packet during deterministic ingest and upload it into the Claude container alongside the original source files
- make author-phase missing-file recovery a one-shot fallback for Opus and Sonnet too, not only Haiku

Why:
- the Alexion IGAN production failure showed a hostile PDF extraction pattern where readable content survived ingest but came out letter-spaced enough to waste the author turn and produce no durable files
- the recent Simrock PDF-only success proved the document-led lane itself was viable; the regression was in evidence normalization quality, not in the overall architecture
- a paid author turn that returns no required files is recoverable enough to justify one explicit missing-file retry regardless of author model

Implication:
- document-led author prompts should tell Claude to read the normalized evidence packet first and fall back to raw PDF/PPTX parsing only when it needs missing detail or visual verification
- deterministic ingest should clean hostile PDF spacing before the author lane sees it
- author-phase recovery logic should keep one bounded missing-file retry for all full-deck models, without expanding into unbounded repair loops

## March 31, 2026 — Add audit-ready data workbook and Haiku report tier

Decision:
- add `data_tables.xlsx` as a first-class durable artifact
- require every quantitative finding to be traceable to a correctly filtered pandas DataFrame
- treat Haiku as a report-only tier that publishes markdown + Excel + manifest, not a degraded deck tier
- keep generated PDFs for internal rendered-page QA, not as a required durable artifact for new successful publishes

Why:
- the Haiku forensic audit showed that wrong toplines came from systematic double-counting of NielsenIQ hierarchy subtotals, not random hallucination
- users need an audit trail they can inspect in Excel, not only charts and prose
- forcing Haiku through PPTX/PDF generation created low-quality deck output and fragile failure modes

Implication:
- the NIQ playbook and system prompt must explicitly warn about hierarchy subtotal rows and require reconciliation checks before any topline claim
- `generate-deck.ts` must publish `data_tables.xlsx` for every run
- report-only runs must skip deck QA stages and ship only the artifacts they can produce honestly

## March 31, 2026 — Ship narrative markdown instead of DOCX

Decision:
- replace the generated narrative artifact lane from `report.docx` to `narrative_report.md`
- treat the markdown report as a first-class durable artifact alongside the PPTX and data workbook
- remove the post-hoc DOCX conversion and salvage builders from the direct worker path
- raise direct-worker budget guards to `pre-flight = $4.50` and `hard = $6.00` so `revise` can actually execute after normal author spend

Why:
- the highest-quality narrative already existed as `narrative_report.md` inside the author code-execution turn
- converting that markdown into OOXML added a failure surface without improving the content
- users explicitly wanted an AI-friendly narrative output that they can reuse downstream
- the old budget caps were below the observed Sonnet author baseline, which starved `revise` and made the repair loop effectively dead

Implication:
- artifact contracts, download routes, UI affordances, and QA checks must use `md` / `narrative_report.md`
- canonical docs and publish summaries must describe PDF as an internal QA artifact rather than a required user-facing durable artifact
- publish validation for the narrative lane should check markdown content quality, not DOCX zip signatures
- canonical docs and memory should describe narrative markdown as the live narrative artifact lane

## March 26, 2026 — Runtime reliability and cost hardening

Decision:
- keep `deck_runs` as the stable user-facing job object, but move retry and recovery lineage into explicit `deck_run_attempts`
- persist Anthropic request ids plus usage in durable `deck_run_request_usage` rows
- write final `cost_telemetry` on failed attempts, not only on success
- make the top-level run cost reflect the whole logical run, not only the latest attempt
- replace ad hoc clone scripts with one official operator retry entry point

Why:
- March 26 production recovery required manual clone runs, artifact re-pointing, and external Anthropic logs to reconstruct spend
- failed runs were dropping meaningful cost even after real model usage
- one user incident could silently become multiple top-level runs, which made dashboard state and operator recovery misleading

Implication:
- worker claim, heartbeat, and stale recovery should operate on attempts, not only naked run rows
- `/api/jobs/[jobId]` and the legacy v2 progress route should read event history from the active/latest attempt instead of mixing old failed attempt traces into the live snapshot
- operators should recover a run with `scripts/retry-run-attempt.ts`, not `.context` clone scripts
- run-level `cost_telemetry.estimatedCostUsd` should reflect full logical-run spend, while the attempt record keeps the per-attempt cost
- bounded same-container repair should stay limited to one missing-artifact repair after `author` and one after `revise`

## March 23, 2026 (evening) — V6 Architecture Reset

### Kill the understand/author split — single-turn generation

Decision:
- The deck generation call must be a SINGLE Claude API call, not a two-step understand+author split.
- Claude reads the uploaded file via code execution, analyzes it, and generates the PPTX in one pass.

Why:
- The V5 understand+author split used 890K input tokens on a 3-slide smoke test ($2.67 in input alone).
- Each `pause_turn` continuation re-sends the full message history including accumulated server_tool_use blocks.
- A real Discount Excel file timed out on the understand phase alone.
- `container_upload` files cost 0 input tokens, so the file data is not the cost driver — conversation accumulation is.

Implication:
- `generate-deck.ts` must collapse to one `runClaudeLoop` call for generation.
- No separate understand phase. No dataset inventory in the prompt.
- The user message contains only: brief + "analyze the uploaded file and create a deck."
- Expected cost should drop materially from the split-path baseline, but the exact deck COGS must be validated from live usage telemetry rather than assumed from prompt theory.

### Include web_fetch tool for free code execution compute

Decision:
- Always include `{ type: "web_fetch_20260209", name: "web_fetch" }` in the tools array.
- When Skills already auto-inject code execution, do not also register another named `code_execution` tool that collides with the injected tool name.

Why:
- Anthropic pricing docs: "Code execution is free when used with web search or web fetch."
- Without it, container time is billed at $0.05/hour with a 5-minute minimum.

### Let the PPTX skill drive rendering

Decision:
- Do not instruct Claude to use a separate hardcoded presentation library contract when the PPTX skill is loaded.
- Let the skill own final presentation generation while Python focuses on analysis and chart-image creation.

Why:
- Public Anthropic docs confirm the `pptx` skill exists and is intended for creating and editing presentations, but they do not require Basquio to depend on an undocumented internal implementation detail.
- Hardcoding a different presentation library contract in the prompt creates conflicting guidance and makes the worker less resilient to skill evolution.

### March 23, 2026 guidance superseded on Apr 23, 2026 — pause_turn continuations must end with user

Decision:
- For Claude 4.6+ / Opus 4.7, a `pause_turn` continuation must append the assistant history and then add a short user continuation message.
- Do not send a follow-up request whose last message is `assistant`.

Why:
- Anthropic's current prompt-engineering guidance for Claude 4.6+ says to migrate away from prefilled last-assistant responses.
- Production run `7cb2e67c-c4cb-4edc-b351-e467ef5b81ad` failed in `author` with: `This model does not support assistant message prefill. The conversation must end with a user message.`
- The older "just resend the assistant turn" assumption is no longer safe on the live model contract Basquio uses in production.

Implication:
- `runClaudeLoop()` pause-turn continuation must preserve assistant history for context, but the next request must end with an explicit user continuation instruction.
- Any future docs or prompts that recommend trailing-assistant continuation are stale unless revalidated against the live Anthropic contract.

### Apr 23, 2026 — request lifecycle must close cleanly on failure, supersession, and shutdown

Decision:
- `deck_run_request_usage` rows are part of the execution contract, not best-effort telemetry.
- Any in-flight request sentinel opened before a Claude call must be closed when an attempt fails, is superseded, or is interrupted by worker shutdown.

Why:
- Production run `7cb2e67c-c4cb-4edc-b351-e467ef5b81ad` showed that deploy-time recovery can legitimately supersede a running attempt while a provider request is still open.
- Leaving `completed_at = null` request rows behind forever does not break recovery immediately, but it pollutes telemetry and weakens stale-run reasoning.
- Production-grade execution needs request state, attempt state, and recovery lineage to agree.

Implication:
- `finalizeFailure()` must mark open request rows as terminal.
- worker shutdown handoff and ownership-loss paths must explicitly close in-flight request rows with an interruption/superseded status before handing off or exiting.

### Move long-running execution off Vercel request routes

Decision:
- Vercel request handlers should only enqueue `deck_runs`.
- A long-running Railway worker should poll Supabase for queued runs and execute `generateDeckRun(runId)`.

Why:
- Real workbook generation takes longer than the practical Vercel request ceiling.
- The direct Claude deck engine is the right quality architecture, but it still needs a durable host.
- Supabase already persists run state, heartbeat timestamps, progress, and artifact records, so it can serve as the queue/state layer without reintroducing the old orchestration maze.

Implication:
- The `/api/jobs/[jobId]/execute` Vercel route is retired.
- `/api/generate` and `/api/v2/generate` should create queued runs and return immediately.
- Railway hosts the polling worker and stale-run recovery loop.

### Finish the durable worker, not just the route cutover

Decision:
- The Railway worker must load the same app env locally, run stale-run recovery on a recurring interval, heartbeat active runs, and use a materially longer Anthropic client timeout than the old 15-minute route-era default.
- The shared live phase contract must match the real direct-worker spine: `normalize`, `author`, `critique`, `revise`, `export`.

Why:
- A worker that only recovers stale runs once at startup can still strand interrupted runs forever after a fast restart.
- A worker without heartbeats makes long Claude calls look dead in Supabase for too long and weakens stale-run detection.
- Keeping the Anthropic client timeout at 15 minutes simply recreates the same failure class on a different host.

Implication:
- `scripts/worker.ts` should load `apps/web/.env.local` for local parity, refresh `updated_at` while a run is in flight, and rerun stale recovery on a timer.
- `generateDeckRun()` and the smoke harness should use a longer configurable Anthropic timeout via `BASQUIO_ANTHROPIC_TIMEOUT_MS`.
- Pre-finalization `delivery_status` should stay on the canonical `draft` state, not invent a route-era transitional label.
- `BASQUIO_PHASES` and the current progress UI should no longer advertise legacy `understand` / `polish` phases for the direct worker, even if broader legacy contracts remain in the repo for historical orchestration code.

### Git-connected Railway worker builds must be repo-reproducible

Decision:

- Railway worker deployments must succeed from committed repo config, not from dashboard-only packages or one-off local snapshot rituals.
- The repo must declare native build prerequisites needed by any workspace dependency that may compile during the worker install path.

Why:

- Railway Git builds install the full pnpm workspace graph from the service root before the worker starts.
- The `basquio-worker` Git deployment failed on April 2, 2026 because `@discordjs/opus` fell back to `node-gyp` and the build image had no Python/toolchain.

Implication:

- `nixpacks.toml` is part of the live worker deployment contract.
- Any new native workspace dependency must be evaluated against Railway's Git-connected build path, even if the worker does not import that package at runtime.

---

## March 23, 2026 (morning)

### Files API references must not go through Anthropic token counting

Decision:

- preflight budget checks must not call Anthropic `countTokens` on requests that contain Files API references such as `source: { type: "file", file_id }` or `container_upload` blocks
- file-backed phases should use conservative preflight gating plus hard post-response spend enforcement from actual usage instead

Why:

- the production run `bfab7641-1e6b-4366-a6a0-8d86f3534e23` crashed because the worker called the token-counting endpoint on a file-backed request
- Anthropic accepts those file references in the Messages API, but rejects them in the token-counting endpoint with `invalid_request_error: File sources are not supported in the token counting endpoint.`
- the production run `5e270fed-6525-411d-aae6-46bcec26fc22` later proved the same endpoint is also invalid for server-tool requests that register `code_execution_*` or `web_fetch_*`, even when the request body itself is text-only

Implication:

- file-backed understand/author/revise/visual-QA phases may skip token counting without skipping budget discipline
- actual per-phase usage must be enforced against the hard deck budget after each model response
- future budget logic must distinguish inline-countable requests from file-backed requests explicitly

### Understand phase must not depend on analysis file attachment

Decision:

- the `understand` phase must accept the analysis plan either as attached `basquio_analysis.json` or as valid JSON returned in the final assistant message
- the `understand` phase should use structured JSON output as its primary response contract instead of relying on prompt-only formatting

Why:

- the production run `8b4bdbee-77c0-44cf-98d9-32f6712df930` failed because the worker hard-required a file attachment even though Claude can validly return the analysis as message text after code execution
- the next run `f1e72aa6-eb1e-4262-9dc4-3ed05494c677` failed because prompt-only text still allowed Claude to end on prose without emitting the actual JSON object

Implication:

- analysis extraction now prefers the file when present but falls back to parsing assistant text JSON
- the prompt contract for `understand` treats message JSON as the required output and file attachment as optional convenience
- the live `understand` request now uses structured output with an explicit JSON schema so this stage is governed by API-level structure, not only prompt wording
### Direct deck engine visual contract tightened

Decision:

- the direct Claude code-execution deck engine should target a light editorial Basquio-standard slide language by default when the uploaded template does not strongly override the look
- the direct deck engine should render charts to raster image assets and embed those images into the PPTX instead of relying on native PowerPoint chart objects whenever one visually consistent deck must survive PowerPoint, Keynote, and Google Slides

Why:

- the earlier prompt contract produced generic Office-style deck aesthetics that did not meet the required consulting-grade bar
- native PPT chart objects are a compatibility risk for Apple Keynote, while raster chart embeds preserve the intended visual output across viewers

Implication:

- prompt knowledge now includes an explicit direct-deck design spec
- artifact QA now fails decks that declare charts but do not include raster chart media or that still contain native PPT chart XML

### Direct deck typography and card layout safety tightened

Decision:

- the direct code-execution path should favor cross-viewer-safe fonts for dense slide text and card internals even when the overall visual direction is editorial
- recommendation and action cards should use reserved non-overlapping bands for index, title, body, and footer instead of fragile ornamental compositions

Why:

- recent real exports showed stacked recommendation ordinals and footer KPI collisions after import between different PPTX viewers
- the product needs fewer visually ambitious but brittle card patterns and more layouts that survive PowerPoint, Keynote, and Google Slides predictably

Implication:

- prompt rules and design spec now explicitly forbid narrow stacked numeral ornaments and floating footer metrics in the default direct deck path
- smoke verification now stresses a recommendation-card slide instead of only a generic chart deck

### `10/10` quality path requires grammar, judging, and ranking

Decision:

- Basquio should evolve from open-ended deck prompting toward a constrained deck-grammar system with rendered-page evaluation and candidate ranking

Why:

- recent prompt improvements showed that Claude follows explicit geometry and forbidden-pattern rules much better than abstract style language
- the remaining gap to consulting-grade consistency is not raw rendering anymore; it is selection, rejection, and deck-level editorial judgment

Implication:

- the next architecture step is not "bigger prompt"
- the next step is a small set of elite slide archetypes, slide-level variant generation, rendered-page judging, and hard publish vetoes on weak decks

### Direct deck path now reuses slot archetypes and PDF visual judging

Decision:

- the direct Claude code-execution path should reuse the existing slot-archetype library as its grammar source
- rendered-page QA should use the generated `deck.pdf` as a Claude document input instead of relying on native server-side PDF rasterization dependencies in production

Why:

- the archetype library already contains the repo's best explicit layout budgets and should not be duplicated
- PDF document judging is concrete, production-safe, and avoids relying on platform-specific image-rendering binaries in the live worker

Implication:

- `slideArchetype` is now part of the direct analysis and manifest contract
- visual QA is now a real worker step over the rendered artifact, not only a future plan item

## Accepted

### Intelligence-first architecture

Accepted because:

- generic AI slide generation is commoditized
- product defensibility comes from package understanding, deterministic analytics, narrative quality, and critique

### Evidence-package plus brief plus design-target input model

Accepted because:

- real analytical deliverables often depend on multiple related files, not one flat sheet
- the brief changes what matters and how it should be framed
- the design target materially changes the artifact, not just its paint

### Dataset manifest and package-semantics layer

Accepted because:

- Basquio needs a canonical contract for file roles without hard-coded filename mapping
- file-role preservation and semantic inference are both required before trustworthy analytics planning

### First-class PPTX template interpretation

Accepted because:

- one of the core user inputs is the design target
- PPTX layout, placeholder, placeholder-frame, theme, and slide-size data must materially affect slide planning and rendering
- shallow theme fallback is not sufficient for report-grade template fidelity
- slide plans should preserve region-level bindings so PPTX and PDF renderers honor the same template geometry contract
- template interpretation must preserve layout-to-source-slide exemplars so the final PPTX can instantiate against the uploaded customer template

### Executable metric-planning stage before analytics execution

Accepted because:

- the AI should decide what to compute
- the code should compute the numbers deterministically
- downstream insight ranking, validation, and chart binding need explicit metric specs and derived-table requests

### Explicit asymmetric join contracts for multi-file analytics

Accepted because:

- real evidence packages often join on semantically equivalent keys with different names
- package understanding should infer join direction and key pairing instead of assuming exact column-name matches
- deterministic analytics need explicit left-key and right-key contracts to stay auditable

### Dynamic report-outline and slide-architecture planning

Accepted because:

- slide count, sectioning, transitions, and layout selection must come from the brief and evidence package
- a fixed hard-coded deck spine does not satisfy report-grade planning requirements

### Hard validation gate before rendering

Accepted because:

- rendering should not start until claims, evidence refs, chart bindings, and numeric assertions resolve
- polished output is dangerous when the reasoning chain is weak

### Independent semantic critic plus revision loop

Accepted because:

- deterministic validation alone does not catch unsupported leaps, weak recommendations, or incoherent story logic
- Basquio needs an evaluator stage that can force upstream revision before rendering
- critique must backtrack to the right stage instead of only failing at the end
- deterministic validation and semantic critique should remain separate durable checkpoints before the workflow decides where to backtrack
- revision decisions should be stored so progress UX can explain which stage was revisited
- template-binding failures should be allowed to backtrack into design translation, not only slide planning

### Stage-level traceability for all LLM-assisted steps

Accepted because:

- AI-native systems need auditable prompt, model, fallback, and error traces
- silent null fallbacks make debugging and trust materially worse
- run history should explain not just the output, but how the output was produced

### Signed resumable uploads for large source packages

Accepted because:

- evidence packages and customer templates can exceed the safe size for one-shot browser uploads
- the hosted client should use signed resumable uploads for large files while preserving direct signed uploads for smaller ones
- storage transport should not be the hidden failure mode that breaks generation before the workflow starts

### Stable durable step IDs separate from user-facing stage labels

Accepted because:

- Inngest memoizes by step ID, not by the friendly stage label shown in the UI
- revision attempts need unique execution identities without mutating the canonical pipeline-stage names users see
- stable displayed stage names and unique internal attempt IDs keep orchestration honest and progress UX clean

### Strict structured-output model policy

Accepted because:

- structured planning stages should use strict schema enforcement instead of ad hoc JSON mode
- cross-provider fallback should be explicit and opt-in, not silent
- model traces should reveal when Basquio honored the requested provider versus when it had to use an allowed fallback

### Post-render QA with artifact manifests

Accepted because:

- Basquio ships paired artifacts, so the system needs a durable `ArtifactManifest` plus a `QualityReport`
- storage success alone is not enough; the system should check artifact existence, metadata consistency, and cross-output alignment

### Async generation with durable visible progress

Accepted because:

- report generation is a long-running workflow, not a request-response toy
- large decks should visibly spend more time on planning, critique, and revision than small ones
- users need stage-level progress, elapsed time, and estimated remaining time while the run is in flight
- queued jobs should be reconstructable from persisted request envelopes instead of depending on in-memory request state

### Schema-aware runtime QA for Supabase-backed status and orchestration code

Accepted because:

- production incidents on March 15, 2026 showed that repo-context QA alone is not enough
- a runtime query selected `generation_job_steps.created_at` even though the migrated table only exposed `started_at`
- the result was a production-only status failure that typecheck and build did not catch
- `pnpm qa:basquio` should fail when runtime REST selects drift from the migration-defined schema
- stale-run recovery must be treated as part of the orchestration contract, not as UI copy

### Brand-token intake as first-class styling input

Accepted because:

- many report-generation workflows need brand fidelity without requiring a full editable PPTX template up front
- design tokens, colors, typography, spacing, and logo rules should enter through a contract, not renderer-only overrides

### PPTX plus PDF from one canonical `SlideSpec[]`

Accepted because:

- it prevents renderer divergence
- it keeps the AI focused on planning instead of document syntax

### PptxGenJS plus pptx-automizer

Accepted because:

- greenfield generation and customer template preservation are different jobs
- the two libraries cover both well enough

### Browserless as primary PDF path

Accepted because:

- Loamly already proves the pattern
- brand fidelity is stronger with HTML/CSS than with React-primitives PDF engines

### Dual chart strategy

Accepted because:

- native PPT charts preserve editability for standard chart families
- ECharts SSR covers advanced export-grade visuals without tying the product to a browser UI library

### Inngest as greenfield workflow default

Accepted because:

- team familiarity reduces integration risk
- Basquio needs durable multi-step execution with retriable stages

### QStash checkpoint-resume as inherited fallback

Accepted because:

- Loamly already has a working self-chain pattern
- the pattern is useful if Basquio is incubated inside existing infrastructure

### Supabase as default database and storage layer

Accepted because:

- it already fits the operational shape of the product
- no alternative currently solves a sharper problem

### Claude code execution as the primary deck engine

Accepted because:

- the previous planner plus charts plus scene-graph plus renderer stack split accountability across too many layers
- the model needs to see and repair the artifact it is creating, not emit disconnected intermediate contracts and hope downstream renderers stay faithful
- Claude code execution plus the PPTX skill lets Basquio keep deterministic ingest and domain logic while collapsing final-authoring responsibility into one accountable worker
- Supabase-backed run state, working papers, artifact manifests, and QA remain durable without requiring Inngest as the primary generation path

### Tracked prompt knowledge only for production runtime

Accepted because:

- production deployments cannot rely on gitignored workspace-only `.context` files
- the code-execution deck worker needs deterministic, versioned prompt inputs that exist in every deployed environment
- runtime prompt sources should be auditable in git alongside the code that depends on them

## Rejected

### Generic "AI makes decks" positioning

Rejected because:

- it is not defensible
- it hides the actual value of evidence understanding and report planning

### PDF as editable template source in v1

Rejected because:

- layout semantics are too unreliable for an honest product promise

### Single-file-only dataset assumption

Rejected because:

- executive reporting often relies on evidence packages with separate fact tables, methodology files, and validation files
- package-level reasoning is part of the intelligence moat

### Fixed-spine slide planning

Rejected because:

- it prevents the system from deciding slide count and section emphasis dynamically
- it treats the report as a prewritten script instead of an inferred plan

### Symmetric same-name-only join assumptions

Rejected because:

- they break when related files use different but semantically equivalent identifiers
- they force case-by-case mapping pressure back into the codebase

### Synchronous generation UX for full report runs

Rejected because:

- it hides long-running orchestration behind a frozen form submission
- it gives users no trustworthy sense of progress, revision depth, or expected wait time

### Deterministic-only validation

Rejected because:

- it misses semantic errors, unsupported recommendations, and narrative incoherence
- it cannot independently challenge the generator's reasoning chain

### Silent model fallbacks

Rejected because:

- they hide reliability problems
- they make AI-native debugging and trust much harder

### Template repaint as the only PPTX render path

Rejected because:

- it discards the uploaded customer template as a first-class artifact source
- it breaks master-slide fidelity and weakens the whole promise of editable template-preserving output

### Recharts or Tremor as canonical export engine

Rejected because:

- they are better treated as preview/dashboard choices
- export needs server-rendered, deterministic, vector-friendly output

### `chartjs-node-canvas` as default chart backend

Rejected because:

- native `canvas` dependency risk is a poor match for Vercel-first deployment
- it does not beat the dual strategy of native PPT charts plus ECharts SSR

### `@react-pdf/renderer` as primary PDF engine

Rejected because:

- Basquio needs HTML/CSS-grade branding flexibility first

### Prompt-only client template fidelity

Rejected because:

- palette and copy guidance alone do not preserve client PPTX cover geometry, footer treatment, or master-slide chrome
- strong client templates need deterministic recomposition against imported template slides after authoring, not more prompt pressure on Claude's final PPTX
- Claude remains responsible for analysis, story, chart image generation, markdown, and audit tables, but exact client-template composition is a renderer responsibility

### Manifest-only template recomposition in the current main lane

Temporarily rejected in production because:

- the current manifest only carries titles and chart metadata, not the full rendered slide body content
- recomposing from manifest metadata preserved some template geometry but destroyed slide content in live runs
- imported PPTX profiles were also contaminated by Basquio defaults (`coverBg`, logo paths, accent tokens), which made prompt-level template fidelity look worse than it really was
- until the manifest can carry full rendered content, Basquio must prefer prompt-driven template fidelity with clean extracted palette data over post-hoc slide reconstruction

## Change Rule

If any accepted decision changes, update all of the following in the same change:

- `docs/architecture.md`
- `docs/decision-log.md`
- `memory/canonical-memory.md`
- `rules/canonical-rules.md`
- `code/contracts.ts`

## April 3, 2026

### Durable template-fee draft before Stripe redirect

Accepted because:

- free-plan custom-template runs cannot safely redirect to Stripe from `/jobs/new` unless Basquio persists uploaded files and the brief first
- a durable checkout draft lets the app confirm payment and resume generation without forcing the user to re-upload evidence after payment
- it closes the server-side bypass where a free user could inherit a workspace default custom template without paying the template fee

## April 11, 2026

### Delivery UX uses durable preview assets plus reminder triggers

Accepted because:

- the completion moment is part of the product, not a thin wrapper around download links
- preview thumbnails can be generated best-effort from the published manifest without changing the durable artifact contract
- completion and reminder emails should be driven by durable run state plus download telemetry, not browser heuristics
- low-credit and unfinished-setup nudges must remain specific, one-time, and evidence-backed instead of generic lifecycle spam

## April 21, 2026 — Trust persisted workspace packs on reruns and canonicalize evidence bindings

Decision:
- treat `deck_runs.workspace_context_pack` as the authoritative context source for workspace-origin reruns when a rerun references a prior run
- canonicalize any incoming `WorkspaceContextPack` against the actual attached `source_files` before enqueue so spoofed file metadata or unattached citations cannot enter run state
- carry `sourceRunId` through the rerun launch draft and both generate APIs so runtime trust does not depend on the browser reposting the original pack faithfully

Why:
- the first workspace pack rollout still allowed reruns to rely on client-posted JSON even when the original run already had a persisted frozen pack
- cited source ids and source-file metadata are only trustworthy if they match real `source_files` rows attached to the new run
- workspace-native UX work in the other branch needs a stable runtime contract now, without requiring the browser to be the source of truth

Implication:
- reruns inherit the frozen workspace context from the originating run by default instead of reconstructing it from transient client state
- the worker receives only canonical source-file references that are actually attached to the run and belong to the same organization/project boundary
- the workspace UX branch can evolve its composer without weakening runtime evidence integrity or rerun continuity

## April 21, 2026 — Direct workspace uploads and workbook presentation contracts

Decision:
- the shipped workspace uploader must stop posting raw file bodies through a Vercel function and instead use the same prepare -> direct storage upload -> confirm pattern already used by `/jobs/new`
- Basquio workbook exports now carry deterministic `MetricPresentationSpec` and `ExhibitPresentationSpec` contracts so decimal precision, number formats, and native-chart styling are chosen by code rather than left to model drift

Why:
- the production HAR proved the old workspace upload path fails at the platform boundary with `413 FUNCTION_PAYLOAD_TOO_LARGE`, so no request-body tuning can make medium files reliable
- Rossella’s NIQ feedback was correct: `data_tables.xlsx` had the right data lineage but not a first-class numeric or styling contract, so workbook output still required manual cleanup

Implication:
- workspace uploads up to the product cap can go browser-to-Supabase without depending on Vercel request-body limits, with resumable upload as the default above 6 MB
- deck manifests now preserve workbook-native exhibit styling metadata alongside chart bindings, and the workbook post-processor applies shared number formats to both cells and native Excel charts

## April 24, 2026 - Workspace chat upload lanes stay separate

Decision:
- chat uploads must render as attached as soon as the storage object and conversation attachment row exist
- memory indexing failures must never be presented as upload failures
- the confirm endpoint queues `file_ingest_runs` for the Railway worker and must not run chunking, embeddings, or entity extraction inside Vercel `after()`
- supported workspace upload types must have matching parsers for the memory lane when a text projection is possible, including PDF and PPTX

Why:
- production logs for Giulia showed Supabase Storage PUT, upload confirm, and retry requests all returning 200 while the UI still showed a red indexing failure chip
- the actual failures were downstream memory-lane defects: PDF parsing called the wrong `pdf-parse` runtime API, and PPTX was accepted by the uploader but had no parser in `workspace/parsing`

Implication:
- the user mental model is "the file is in this chat now"; background memory enrichment is separate, async, and retryable
- the chat can still answer against an attached file through Layer A even when Layer B has not indexed it yet

## April 22, 2026 — Client-friendly copy is gated by intelligence non-negotiables

Decision:
- keep client-friendly copy as a presentation objective, but make it strictly subordinate to intelligence non-negotiables
- harden NIQ / promo decks around explicit contracts: promo drill-down sequence, inflation-aware value-to-volume pivot, claim-to-chart metric binding, redundancy control, and deterministic NIQ decimal policy
- enforce storyline branch contiguity so analytical chapters do not hop from one branch to another and then back unless the revisit is an explicit synthesis/comparison or a clearly deeper follow-up
- use eval-driven hardening logic: code-based checks first, then rubric-based model grading, with regression cases treated as blockers instead of style improvements being accepted on vibe

Why:
- the recent quality regression proved that making copy more polished can silently weaken analytical depth if style and intelligence are optimized in the same undifferentiated prompt layer
- Rossella’s feedback showed the failure modes clearly: wrong metric on the chart, repeated analytical cuts, promo analysis that skips mechanics, and slide claims that are better written than they are evidenced
- current best-practice guidance from OpenAI and Anthropic converges on the same operating model: task-specific evals, multidimensional scorecards, automated grading where possible, and continuous regression testing on every change

Implication:
- Basquio should never accept a quality hardening pass just because the copy sounds nicer; the change must preserve claim/evidence coherence and analytical depth
- prompt changes alone are not sufficient; deterministic validators and explicit domain policies must carry the non-negotiable rules
- NIQ decimal rules and promo-storytelling mechanics now belong in the knowledge and validation layer, not only in agent memory or ad hoc instructions
- narrative linearity is not a soft editorial preference; branch backtracking is a planner defect and should fail plan lint before authoring

## April 23, 2026 — Shutdown/recovery must preserve attempt integrity, not just availability

Decision:
- Railway worker shutdown now uses a two-stage policy: stop claiming immediately, keep heartbeats during a bounded drain window, and only abort/supersede in-flight runs after the drain timeout expires
- Claude author/revise loops must accept a worker abort signal and throw a shutdown-specific interrupt before another provider continuation or retry is issued
- checkpoint resume is only valid when the checkpoint carries the full durable artifact set (`deck.pptx`, `deck.pdf`, `narrative_report.md`, `data_tables.xlsx`) and recovered analysis matches the same attempt that produced the checkpoint
- stale recovery must close open request-usage sentinel rows and must not supersede an attempt while there is still a reasonably fresh in-flight phase request
- forensic audit scripts must dedupe shadow `request_record` rows from phase-level usage rows before summing or presenting token spend

Why:
- the prior worker design could hand off a run on SIGTERM before the live Claude request was actually canceled, which allowed overlapping attempts and duplicate provider spend
- the previous checkpoint lane could publish artifacts from one attempt while loading analysis from a different attempt, and could not actually skip to export because `data_tables.xlsx` was missing from checkpoint storage
- leaving open request rows behind after stale or shutdown recovery polluted telemetry and made incident forensics untrustworthy

Implication:
- deploy-triggered interruptions should now either drain naturally or supersede cleanly, without a window where old and new attempts both keep billing
- a “resume from checkpoint” path is now a real publish path, not a partial artifact shortcut
- attempt lineage remains internally consistent across recovery, export, and postmortem tooling

## April 23, 2026 — Superseded attempts must be terminalized, not left as ghost-running rows

Decision:
- any recovery path that supersedes an older attempt must stamp the old attempt with a terminal `completed_at`
- if a worker loses attempt ownership to a newer active attempt, it must finalize the old attempt row as superseded instead of only closing request-usage rows
- the `recover_deck_run_attempt` RPC must set `completed_at` on the old attempt when it transitions that attempt into a terminal state

Why:
- the previous shutdown/recovery hardening closed the spend window, but older attempts could still remain `status = running` or `completed_at = null` after being superseded
- that created ghost-running lineage in incident forensics and made checkpoint/recovery audits harder to trust even when the live worker behavior was otherwise correct

Implication:
- superseded attempts now leave one coherent lineage trail: terminal attempt row, closed request rows, and a single active owner for the run
- postmortems and spend audits can distinguish real active work from historical superseded attempts without manual cleanup

## April 23, 2026 — Imported master backgrounds are advisory; workbook-native charts need a presentation shell

Decision:
- extracted PPTX master backgrounds are no longer treated as authoritative deck canvas tokens
- Basquio now injects a master background only when it is brand-aligned, using palette hints and a neutral-placeholder guard at both template-extraction time and render time
- the native Excel companion is now treated as a user-facing consulting workbook, not just a native-chart side effect
- workbook post-processing must apply a deterministic shell: README/index, freeze panes, styled headers, styled Excel tables, explicit column widths, reserved right-panel chart placement, and helper columns pushed beyond the visible chart panel

Why:
- Rossella’s fresh rerun showed a full-deck grey surface caused by blindly injecting an extracted neutral `masterBackground`
- the same rerun also showed that analytically linked Excel charts were still visually low-grade because the workbook path had no real layout contract beyond number formats and a fixed chart anchor near hidden helper columns
- current library docs support both explicit chart anchors and table styling, so the limitation was our architecture, not the file format libraries

Implication:
- existing saved template profiles with junk master-background tokens can no longer poison newly generated decks
- future imported template profiles should persist only brand-aligned master backgrounds
- `data_tables.xlsx` should now read as a consulting artifact: easier to scan, less chart clutter, and no more chart-vs-table collisions from crude anchoring

## April 23, 2026 — Bare provider/tool termination must auto-recover, not hard-fail

Decision:
- treat opaque provider/tool interruption strings such as `terminated`, `container_expired`, `execution_time_exceeded`, `too_many_requests`, and tool-result `unavailable` as `transient_provider`
- normalize a bare `terminated` stream error close to the Claude request loop so worker-level failure classification sees a provider/tool interruption instead of an undifferentiated internal error
- rely on the existing superseding-attempt recovery path once the failure is classified correctly, instead of introducing a separate ad hoc retry path

Why:
- the Apr 23 Rossella rerun `ec91f0d0-...` failed in `author` before any completed provider usage existed, with the worker logging only `terminated`
- the same failure signature already existed on Apr 11, Apr 15, and Apr 21 across Sonnet 4.6, Opus 4.6, and Opus 4.7 deployments, so the root defect was not the latest render/template commit and not the model switch alone
- Anthropic's current code-execution docs explicitly document retryable tool/container error codes such as `unavailable`, `execution_time_exceeded`, `container_expired`, and `too_many_requests`

Implication:
- transient provider/tool interruptions should create a superseding attempt automatically instead of burning the run as `internal_processing_error`
- postmortems can distinguish true logic/output failures from provider/tool execution interruptions

## April 23, 2026 — Worker deploys must be isolated from the web app build

Decision:
- the Railway worker image must not run the web app build as part of `Dockerfile.worker`
- worker-only runtime dependencies such as credit-refund recovery must live under the worker/runtime packages, not under `apps/web`
- worker watch patterns must exclude broad `apps/web/**` paths unless the worker actually imports those files at runtime

Why:
- the previous worker image still ran `pnpm run build`, which only builds `@basquio/web`; that meant unrelated Next/web regressions could block deployment of worker-only resilience fixes
- the worker still imported `refundCredit` from `apps/web/src/lib/credits`, so the deploy boundary between long-running generation and the web app was not actually clean
- a system with the product promise “a run must never fail” cannot keep the critical recovery service coupled to unrelated frontend build health

Implication:
- worker releases now exercise only worker/runtime code paths during container build
- worker redeploys should no longer trigger for arbitrary web-route changes
- the web app can still share billing logic conceptually, but the worker owns the minimal recovery code it needs to refund failed runs without depending on Next build correctness

## April 24, 2026: Scope routes are chat-first, not briefing-first

Decision:
- `/workspace/scope/[kind]/[slug]` uses the workspace chat pane as the primary viewport.
- Scope metadata, stakeholders, counts, recent deliverables, suggested actions, and memory move into the right context rail.
- Suggested actions also render as composer pills above the input, so the next prompt is one click away.
- Scope navigation, memory, and deliverable jumps are available through a lightweight Cmd-K palette.

Why:
- the Apr 22 context-first scope landing made the analyst scroll past five briefing sections before reaching the input
- live production review showed that a polished composer at the bottom of a briefing page still felt below the bar set by Codex, Claude Code, Notion Agent, Legora, and Conductor-style work surfaces
- Basquio is an intelligence workspace, so scope context must stay visible beside the conversation rather than blocking access to it

Implication:
- the old `ScopeLanding` briefing-stack component is retired
- future scope polish should extend the chat pane and context rail, not recreate a dashboard above the composer
- mobile scope routes collapse context into a one-line expandable strip while keeping chat first
