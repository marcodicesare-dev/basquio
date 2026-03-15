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
- `SlideSpec[]` should carry template-region bindings when a template layout exposes usable placeholder geometry.
- `.pptx` is the only first-class editable template input in v1.
- structured brand token files are a first-class style-system input.
- `.pdf` is a style reference in v1.
- `ExecutableMetricSpec[]` is a required planning contract before deterministic analytics execution.
- explicit left-key and right-key join contracts are required when metrics span related files.
- `ReportOutline` is a required planning step before `SlideSpec[]`.
- slide count and section structure must be plan-driven, not fixed-spine hard-coding.
- The AI must output structured contracts, not freestyle final slides.
- `ChartSpec` is canonical and must stay independent from preview UI libraries.
- PPTX and PDF must come from the same `SlideSpec[]`.
- Browserless is the default PDF render path.
- Supabase is the default app database, auth, and storage layer.
- Inngest is the default greenfield workflow runtime.
- QStash self-chaining is the proven inherited fallback pattern from Loamly.

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

- Standard charts should prefer native editable PPT charts when possible.
- Advanced charts should prefer ECharts SVG SSR.
- Raster output is a fallback, not the canonical chart format.
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
- Inngest execution IDs should stay distinct from the user-facing canonical stage names shown in progress UI.
- cross-provider model fallback must be explicit and opt-in; strict structured outputs are the default contract for planning stages.

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
