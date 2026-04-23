# Canonical Memory

## Always True Until Explicitly Changed

- Basquio is intelligence-first, renderer-second.
- The moat is package understanding, metric planning, deterministic analytics, insight ranking, narrative planning, slide architecture, and critique.
- Basquio should understand multi-file evidence packages, not only single spreadsheets.
- dataset manifests are the canonical file-role layer for evidence-package understanding.
- `PackageSemantics` is required before trustworthy analytics planning.
- The report brief is part of the product input, not an optional prompt garnish.
- the report brief must explicitly represent client, audience, objective, thesis, and stakes.
- the design target is a core input, not a renderer-side theme override.
- `TemplateProfile` is the canonical output of template and brand interpretation.
- `TemplateProfile` must preserve slide dimensions and placeholder-region geometry when a PPTX template is provided.
- `TemplateProfile` must preserve source-slide exemplars for each usable PPTX layout when a customer template is provided.
- `.pptx` is the only first-class editable template input in v1.
- structured brand token files are a first-class style-system input.
- `.pdf` is a style reference in v1.
- `ExecutableMetricSpec[]` is a required planning contract before deterministic analytics execution.
- explicit left-key and right-key join contracts are required when metrics span related files.
- slide count and section structure must be evidence-driven, not fixed-spine hard-coding.
- The primary export path is Claude code execution, not a fragmented scene-graph renderer stack.
- Claude may generate final deck syntax directly, but only after deterministic ingest, template interpretation, and explicit budget enforcement.
- Full-deck tiers must still come from one accountable deck-generation pass and one durable artifact manifest.
- `data_tables.xlsx` is a first-class Basquio artifact and must be written from the same DataFrames used for charts and reported numbers.
- Haiku is a report-and-data tier, not a low-quality slide tier.
- Production runtime prompt inputs must come from tracked repository files, never workspace-only `.context` files.
- Direct deck generation should default to a light editorial slide language with a warm cream canvas, tonal ivory surfaces, ultramarine light-background logo chrome, ultramarine eyebrow/top-hairline accents, and sparse amber highlights unless the uploaded template clearly overrides it.
- In the direct code-execution path, serif display should be limited to short page-level headlines when no strong template is provided; dense slide text and card internals should use Arial-class safe fonts to reduce cross-viewer layout drift.
- Charts in the direct code-execution path should be rendered as raster image assets and embedded into the PPTX when Basquio needs one visually consistent deliverable across PowerPoint, Keynote, and Google Slides.
- Claude responds much more reliably to explicit slide geometry, forbidden layout patterns, and implementation constraints than to abstract taste language alone.
- Basquio should not ask Claude to "design a deck" from scratch on every slide; it should ask Claude to choose and fill from a small set of elite slide grammars with hard density and spacing limits.
- The direct deck path should reuse the existing slot-archetype library as its grammar source instead of maintaining a second inconsistent set of slide layouts.
- Generic smoke tests are weak signals. Stress tests should target specific historical failure classes such as recommendation-card overlap, footer collisions, or chart visibility drift.
- Prompt-only improvements can raise the floor, but `10/10` output requires rendered-page evaluation, candidate ranking, and hard publish vetoes on weak slides.
- Supabase is the default app database, auth, and storage layer.
- Inngest is no longer the primary deck-generation runtime.
- Durable database-backed run state and internal execution dispatch are the current workflow contract.

## Product Scope Memory

Initial user promise:

- upload a structured evidence package
- provide context, audience, objective, thesis, and stakes
- choose template or style direction
- optionally provide a brand file with design tokens
- receive editable PPTX plus an audit-ready markdown report and data workbook

Initial domain bias:

- executive analytical reporting for strategy, insight, research, and operating teams

## Technical Memory

- Package semantics interpretation runs before deterministic analytics execution for multi-file evidence packages.
- Deterministic analytics run from explicit executable metric plans.
- multi-file relationships must support semantically matched keys even when column names differ.
- The AI should decide what to compute; code should compute the numbers.
- Every insight must have evidence and confidence.
- Every substantive claim must resolve to `EvidenceRef[]` before render.
- `AnalyticsResult` plus derived tables are the canonical deterministic output, replacing highlight-only metric summaries.
- Rendering is gated by deterministic and semantic validation, not only schema success.
- deterministic validation and semantic critique should be persisted as separate stages before the combined revision decision.
- The semantic critic must be able to send the run back to metrics, insights, story, design, or slides before render.
- revision decisions should be durable so progress UX can explain where the workflow backtracked.
- Every completed run should emit an `ArtifactManifest`, a `QualityReport`, a `ValidationReport`, and stage traces.
- Every LLM-assisted stage should emit a `StageTrace` with prompt version, requested model, resolved model, provider, status, fallback reason, and timestamp.
- Template and brand interpretation must flow through `TemplateProfile`, not renderer-only style hacks.
- `.pptx` interpretation must materially preserve layout, placeholder, placeholder-frame, theme, and source-origin information.
- uploaded PPTX runs should instantiate the output deck against imported template slides when usable source-slide exemplars exist.
- when the client template is strong, Claude's direct PPTX should be treated as an interim content draft and the shipped PPTX/PDF should be recomposed deterministically against the imported template.
- structured brand token JSON or CSS files are the current file-backed v1 path into `TemplateProfile`.
- generation is an async workflow with durable stage records, not a synchronous page request.
- users should see stage-level progress, elapsed time, and estimated remaining time while generation is running.
- queued runs should persist a reconstructable generation request envelope keyed by `jobId`.
- large browser uploads should use signed resumable transport, while smaller uploads can continue to use signed single-shot transport.
- run execution must be restartable from durable database state without depending on in-memory request context.
- Railway worker deploys must not restart on unrelated repo changes; the worker service should use focused watch patterns, a direct Node start command, and immediate shutdown handoff on `SIGTERM`.
- Railway Config-as-Code now expects current builder values; a stale `builder = "nixpacks"` entry is ignored, so the worker must use a valid builder config to keep its deploy contract in force.
- `data_tables.xlsx` is incomplete when it only contains tables; for chart-bearing runs the worker must deterministically link workbook sheets and inject native Excel companion charts before publish.
- cross-provider model fallback must be explicit and opt-in; strict structured outputs are the default contract for planning stages.
- Supabase REST queries in runtime code must stay compatible with the migrated schema; production log review is the source of truth when local assumptions drift.
- status polling and recovery logic must handle both stale queued runs and stale running-with-zero-checkpoint runs.
- The strongest quality controls for the current direct deck path are archetype contracts, negative rules, artifact QA, and rendered-page review rather than open-ended styling instructions.
- The intelligence quality moat is layered: proprietary knowledge packs, deterministic validation, prompt instructions, and an analyst feedback loop that should compound from real client corrections.
- Client-facing tone is a product constraint, not a copy polish preference. Basquio must frame hard truths as opportunities without weakening the evidence.
- Recommendation quality is its own reusable knowledge surface and must stay evidence-anchored, quantified only when directly supported, and specific about the lever, target, and expected gain.
- Analytical slides should surface supporting numbers on the same page whenever possible through co-located tables or explicit chart annotations.
- High token spend in code-execution runs is often driven by repeated `pause_turn` continuation with growing container history, not only by the initial prompt size.
- For Claude 4.6+ / Opus 4.7, `pause_turn` continuations must not end on an assistant message; Basquio must append assistant history and then an explicit user continuation prompt to stay on the live Anthropic contract.
- `deck_run_request_usage` is part of the durable execution contract: open request rows must be closed when an attempt fails, is superseded, or is interrupted by worker shutdown.
- Railway shutdown must drain before it hands off. Stop claiming new work on `SIGTERM`, keep heartbeats during the drain window, then abort and supersede only the runs still active after the timeout.
- checkpoint resume is only trustworthy when the checkpoint stores the full durable artifact set and recovered analysis is scoped to the same attempt that produced the checkpoint.
- Cost control for the direct path must reduce turn count and context churn, not only trim wording from prompts.
- file-backed budget preflight must use telemetry-shaped cost envelopes rather than output-only projected spend.
- repair routing should prefer deterministic fixes first, then a cheap Haiku lane, and only then Sonnet-class revise when structural repair or major visual redesign is still required.
- revise acceptance must follow an ordered frontier: blocking contract issues, claim traceability, blocking visual issues, visual score, then advisory issues.
- The primary direct-worker generation pattern should be one file-backed Claude generation turn that loads the `pptx` and `pdf` skills from the start, not a prompt-stuffed `understand` call followed by a separate `author` call.
- workspace-origin runs must persist a typed `WorkspaceContextPack` on `deck_runs` plus a durable support packet, not only a prose workspace prelude inside `business_context`.
- the first-class workspace lineage that must survive into deck run state is `workspace_id`, `workspace_scope_id`, `conversation_id`, `from_message_id`, and `launch_source`.
- author, revise, and QA must all consume the same frozen `workspace-context.md` / `workspace-context.json` packet when a run originates from workspace context.
- The current persisted direct-worker phase list is `normalize`, `understand`, `author`, `render`, `critique`, `revise`, `export`.
- `polish` is historical and should not appear in live progress or contract schemas.
- `container_upload` evidence files should be read inside code execution, not summarized back into the prompt as dataset inventory or column dumps.
- document-led runs should upload a normalized evidence packet derived during ingest into the author container so Claude can read repaired PDF/PPTX text before attempting hostile document parsing from scratch.
- The correct production execution surface for long Basquio deck runs is a durable worker, not a Vercel request. Vercel should enqueue `deck_runs`; a Railway worker should claim and execute them.
- Supabase-backed `deck_runs.status = "queued"` is the current queue contract. A separate queue system is unnecessary while one worker claims runs atomically and stale-running runs are re-queued.
- `deck_runs` is the stable user-visible job, but recovery lineage must live in explicit `deck_run_attempts` records so retries do not become confusing top-level clone runs.
- The durable worker must run recurring stale-run recovery, not only startup recovery; otherwise a fast restart after a crash can leave interrupted runs stuck forever.
- The durable worker should heartbeat `deck_runs.updated_at` while a Claude call is in flight so the database reflects live execution rather than only phase boundaries.
- every Anthropic phase request should persist request id, usage, phase, and attempt linkage durably so failed-run cost does not require external log forensics.
- Moving generation off Vercel is not sufficient if the Anthropic client timeout remains at 15 minutes. The durable worker timeout budget must exceed real workbook generation time.
- A concrete rendered-page QA path now exists: upload the generated internal `deck.pdf` to Claude as a document block and judge the rendered pages directly. Local PDF-to-PNG rendering is for debugging and fixture inspection, not the primary production gate.
- Anthropic's token-counting endpoint must not be used with Files API references such as `source: { type: "file", file_id }` or `container_upload` blocks, and it must not be used on server-tool requests that register `code_execution_*` or `web_fetch_*`. File-backed or tool-backed phases need envelope preflight plus post-response budget enforcement from actual usage instead of preflight token counting.
- The final direct-deck publish contract should require `deck.pptx`, `narrative_report.md`, `data_tables.xlsx`, and `deck_manifest.json`. `deck.pdf` remains an internal QA/checkpoint artifact when generated, not a required durable user-facing publish artifact.
- `narrative_report.md` is a live artifact in the direct deck path and must be authored from the same canonical narrative and evidence layer as the deck, not reverse-converted from slides or PDF.
- NielsenIQ-style exports contain hierarchy subtotal traps. Any topline number must reconcile category rows against supplier rows before it is allowed into the artifacts.
- narrative markdown in v1 should be text-first and chart-free. The right trade is a reliable narrative report, not a brittle Word recreation of slide visuals.
- narrative markdown must use the same knowledge depth and copywriting rules as the deck path while expanding the explanation of what happened, why it matters, and how to act.
- When the `pptx` skill is loaded, Basquio should rely on the documented skill contract itself rather than assuming an undocumented internal presentation library implementation.
- scatter manifests must produce native editable scatter charts in `data_tables.xlsx`; the workbook injector and the TypeScript allowlist must stay aligned.
- workbook numeric precision is now a deterministic contract, not a model choice: `MetricPresentationSpec` governs NIQ-style decimal rules for workbook cells and native chart labels.
- workbook-native chart styling now persists as `ExhibitPresentationSpec`; chart bindings alone are not enough to preserve fidelity across PPT screenshots and Excel-native companions.
- the shipped workspace uploader lives in `.context/main-landing`, and that surface must use direct browser-to-Supabase uploads plus confirm-step row creation instead of raw multipart bodies through a Vercel function.
- In the current Anthropic API behavior, loading Skills can auto-inject the code-execution tool. Do not explicitly register another named `code_execution` tool alongside those Skills if the API reports a tool-name conflict.
- The March 27-28 failure cluster was primarily a runtime-truth mismatch problem: speculative docs and forward-looking fixes diverged from live provider/runtime behavior faster than the code was revalidated.
- The canonical March 28 forensic truth source is `memory/march28-48h-forensic-learnings.md`.
- Current production Anthropic contract is `code_execution_20250825` with beta `code-execution-2025-08-25`; treat `code_execution_20260120` as non-canonical until live-validated.
- Current production critique and export judges are both `claude-sonnet-4-6`; do not reintroduce a weaker critique judge followed by a stricter export-only judge.
- Current production `author` / `revise` local watchdogs are disabled; stale recovery must respect active in-flight requests and meaningful progress rather than pure phase age.
- PPTX publish validation should trust the `presentation.xml` slide list over orphaned zip slide parts, and chart-image aspect checks must not treat normal chart-canvas padding as distortion.
- Git-connected Railway worker deployments install the full pnpm workspace graph from the repo root. The repo itself must declare any native build prerequisites needed by workspace dependencies instead of relying on dashboard-only packages or manual snapshot deploy rituals.

## Production Incident Memory: April 21, 2026 — Discord bot silent death

- The Railway project `basquio-bot` hosts more than one service. The Discord bot AND the deck worker were both deployed inside it, both reading the SAME root `railway.toml`.
- Three commits on Apr 21 00:22-01:37 UTC (`7792727`, `d77142e`, `cbb6445`) hardened the deck worker by rewriting the root `railway.toml` start command from `pnpm worker` to `node --import tsx scripts/worker.ts`, switching to `Dockerfile.worker`, and expanding watchPatterns.
- The Discord bot service redeployed automatically with the new (deck-worker) start command. It crash-looped because the deck worker code requires `NEXT_PUBLIC_SUPABASE_URL` and the bot service had `SUPABASE_URL` set instead. 77+ restart attempts logged in the next hour.
- The bot stopped recording at Apr 20 21:14 UTC (last successful transcript). The 2-hour Apr 21 strategy session was never captured: no audio in `voice-recordings` storage, no row in `transcripts`, no recovery possible.
- Lesson: every Railway service must own a service-scoped config under its own subdirectory. Root `railway.toml` is reserved for the deck worker. The Discord bot's config lives at `apps/bot/railway.toml` from this incident forward.
- See `rules/canonical-rules.md` → "Railway / Multi-Service Deploy Rules" for the full audit-before-touch checklist.
- Watchdog requirement: any long-lived service (Discord bot, deck worker) must have a heartbeat alarm. A 30-minute silence on the bot's transcript table or worker's claim table fires an alert. Silent death over a full night is unacceptable.

## Production Incident Memory: March 21-22, 2026

- The March 21 run `10669fc3-917b-4a4e-84cf-a3ae07493839` did not fail because the analyst could not reason. It failed because the planner emitted a hallucinated chart sheet key (`→` separators plus duplicated filename), all 10 charts loaded zero rows, and the author fell into guaranteed fallback mode.
- LLM-authored chart bindings are not trustworthy identifiers. Chart programs must bind through canonical dataset handles or normalized resolver logic, never raw freeform sheet-key strings authored by the planner.
- The March 22 run `4daa609e-0284-40f3-9146-0d5836dac7b4` proved the chart-binding fix was not enough. The run achieved `chartCoverage=100%`, but every image-chart render failed at runtime because `sharp` could not load on Vercel Linux, so the renderer silently fell back to shape-built charts.
- The intended export contract is pixel-perfect chart screenshots first, with text remaining editable. If the screenshot path is unavailable in production, that is a P0 rendering incident, not a harmless fallback.
- Scene-graph overflow and collision findings are real artifact failures, not cosmetic warnings. The March 22 deck shipped with `scene_no_overflow` and `scene_no_collisions` failing, and the resulting PPTX was visibly not agency-grade.
- PPTX and PDF are still not trustworthy if they do not share one identical visual contract. Simplified scene-graph defaults or token remapping in the PDF path can create a different product, even when both artifacts came from the same slide plan.
- A reduced or degraded deck is acceptable only when it is explicitly truthful. A full consulting-style deck must not ship after total chart-program collapse, screenshot-path collapse, or layout-integrity failure.
- Mixed-language output remains a real intelligence-quality defect. The deck language must be enforced as a hard authoring constraint, not a soft prompt hint.
- Production telemetry must be read end to end. Phase-local cost summaries can understate total run cost; the final job-finished event is the authoritative run cost.
- When production behavior and code claims disagree, trust the exported logs, artifact screenshots, and downloaded deck before trusting any self-report in commit messages.

## Design Memory

- Basquio UI should feel like an executive reporting product, not a generic SaaS admin shell.
- The canonical shell direction is a pale editorial canvas with darker technical-stage surfaces used intentionally for workflow, pipeline, and proof moments.
- CostFigure is the reference for editorial rhythm, spacing discipline, and token governance, not for color direction.
- Inngest is the reference for technical confidence, dark-stage framing, and pipeline-proof presentation, not for brand cloning.
- Landing-page copy must describe the real product: evidence package plus report brief plus design target in, PPTX plus PDF artifacts out.
- `/jobs/new` is the primary action path and should read like a report-composer surface, not a generic upload form.
- `/templates` and `/artifacts` should read as report-generation tools and deliverable surfaces, not generic cards or file lists.
- Shared visual rules should live in the web token layer first, then page structure, instead of ad hoc one-off component styling.

## Process Memory

Before implementation:

1. read `docs/vision.md`
2. read `docs/architecture.md`
3. read this file
4. run `pnpm qa:basquio`

When production incidents happen:

1. inspect exported web logs
2. inspect exported database logs
3. compare runtime queries against migrations
4. only then trust or revise the progress UI explanation

Template fidelity lesson:

- imported client PPTX profiles must not inherit Basquio defaults; if `coverBg`, logo paths, or callout colors look like house-style values, the extractor is contaminated
- imported client PPTX profiles may carry extracted `brandTokens.logo.imageBase64`, `brandTokens.logo.position`, and `brandTokens.decorativeShapes`; those fields are part of the live template-fidelity contract and must not be stripped from the schema
- the current manifest is not rich enough to rebuild final slides from metadata alone; manifest-only recomposition can preserve geometry while destroying actual slide content
- until full rendered slide content is carried explicitly, prefer clean prompt palette injection over post-hoc PPTX reconstruction
- free-plan custom-template runs must persist a durable checkout draft before redirecting to Stripe so `/jobs/new` can resume safely after payment without losing uploaded files or the brief
- the completion surface should show durable slide previews before download; preview thumbnails are best-effort assets derived at publish time and stored on `artifact_manifests_v2.preview_assets`
- `artifact_download_events` is the durable truth for whether a completed run was actually opened, and reminder emails should key off that instead of page visits
- reminder UX should stay tied to concrete user states: completed-with-no-download, uploaded-template/no-run, and low-credit after a successful debit
- sample-data onboarding is a valid acquisition path for Basquio because many signups arrive without a workbook ready; the sample run should live directly inside `/jobs/new`, not on a detached marketing flow
- a full-deck author turn that spends model time but returns no required files should get one bounded missing-file retry on Opus/Sonnet as well as Haiku; do not treat that recovery path as Haiku-only

When architecture changes:

1. update decision log
2. update this memory
3. update contracts
4. rerun QA

## Open Questions

- exact v1 template authoring guidelines for customer PPTX uploads
- how strict the brand-token validator should become beyond the current JSON/CSS token path
- whether Basquio preview UI should use client ECharts or Recharts
- whether Vega-Lite becomes necessary for specific analytical chart families
- whether Basquio launches inside Loamly or as a separate repo first
- workspace-origin reruns should prefer the persisted `deck_runs.workspace_context_pack` from the source run over browser-posted workspace context payloads.
- server-side workspace-pack canonicalization must bind `sourceFiles` and cited source ids only to real attached `source_files` rows inside the same `organization_id` / `project_id` boundary before enqueue.
- client-friendly copy is a valid goal only after intelligence non-negotiables pass. The hard blockers are: no invented targets, no invented competitor motives, no missing focal-brand positioning on competitor slides, no chart/claim metric mismatch, no distribution opportunity without productivity proof, no value-led story when inflation makes volume the real signal, and no redundant analytical cut.
- NIQ promo decks must be built as a drill-down matrix across market, channel, retailer/area, format, competitor, promo mechanics, and productivity. SCQA is only the narrative wrapper.
- narrative linearity for NIQ decks means analytical branches stay contiguous. Jumping from segments to channels and then back to segments is a planner failure unless the revisit is an explicit synthesis/comparison or a clearly deeper follow-up.
- deterministic NIQ decimal policy must override heuristic formatting when the metric family is known: value/volume/packs 0 unless scaled, distribution/promo pressure/TDP 0, intensity index 1, shares and discount depth 1, prices 2, indices 0, rotation/ROS/productivity 1, with variations inheriting base precision.
- quality hardening should follow eval-driven development: automated/code-based checks first, LLM judges only with explicit rubrics, and regression cases treated as release blockers rather than allowing style wins to hide intelligence regressions.
- superseded attempts are terminal lineage, not active lineage. Any recovery or ownership-loss path must stamp the old attempt row with `completed_at` and close request rows so forensic audits never show ghost-running attempts after handoff.
