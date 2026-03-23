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
- PPTX and PDF must still come from one accountable deck-generation pass and one durable artifact manifest.
- Production runtime prompt inputs must come from tracked repository files, never workspace-only `.context` files.
- Direct deck generation should default to a premium dark editorial slide language with restrained card surfaces, sparse accents, and disciplined whitespace unless the uploaded template clearly overrides it.
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
- receive editable PPTX and polished PDF

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
- structured brand token JSON or CSS files are the current file-backed v1 path into `TemplateProfile`.
- generation is an async workflow with durable stage records, not a synchronous page request.
- users should see stage-level progress, elapsed time, and estimated remaining time while generation is running.
- queued runs should persist a reconstructable generation request envelope keyed by `jobId`.
- large browser uploads should use signed resumable transport, while smaller uploads can continue to use signed single-shot transport.
- run execution must be restartable from durable database state without depending on in-memory request context.
- cross-provider model fallback must be explicit and opt-in; strict structured outputs are the default contract for planning stages.
- Supabase REST queries in runtime code must stay compatible with the migrated schema; production log review is the source of truth when local assumptions drift.
- status polling and recovery logic must handle both stale queued runs and stale running-with-zero-checkpoint runs.
- The strongest quality controls for the current direct deck path are archetype contracts, negative rules, artifact QA, and rendered-page review rather than open-ended styling instructions.
- High token spend in code-execution runs is often driven by repeated `pause_turn` continuation with growing container history, not only by the initial prompt size.
- Cost control for the direct path must reduce turn count and context churn, not only trim wording from prompts.
- A concrete rendered-page QA path now exists: upload the generated `deck.pdf` to Claude as a document block and judge the rendered pages directly. Local PDF-to-PNG rendering is for debugging and fixture inspection, not the primary production gate.

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
