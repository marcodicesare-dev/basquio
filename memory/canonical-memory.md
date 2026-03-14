# Canonical Memory

## Always True Until Explicitly Changed

- Basquio is intelligence-first, renderer-second.
- The moat is dataset understanding, insight ranking, and narrative planning.
- Basquio should understand multi-file evidence packages, not only single spreadsheets.
- dataset manifests are the canonical file-role layer for evidence-package understanding.
- The report brief is part of the product input, not an optional prompt garnish.
- the report brief must explicitly represent client, audience, objective, thesis, and stakes.
- `ReportOutline` is a required planning step before `SlideSpec[]`.
- `.pptx` is the only first-class editable template input in v1.
- structured brand token files are a first-class style-system input.
- `.pdf` is a style reference in v1.
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
- provide context, audience, objective, and thesis
- choose template or style direction
- optionally provide a brand file with design tokens
- receive editable PPTX and polished PDF

Initial domain bias:

- executive analytical reporting for strategy, insight, research, and operating teams

## Technical Memory

- Standard charts should prefer native editable PPT charts when possible.
- Advanced charts should prefer ECharts SVG SSR.
- Raster output is a fallback, not the canonical chart format.
- Deterministic analytics run before LLM narrative planning.
- Every insight must have evidence and confidence.
- Every substantive claim must resolve to `EvidenceRef[]` before render.
- Rendering is gated by deterministic validation, not only schema success.
- Every completed run should emit an `ArtifactManifest` and a `QualityReport`.
- Template and brand interpretation must flow through `TemplateProfile`, not renderer-only style hacks.
- structured brand token JSON or CSS files are the current file-backed v1 path into `TemplateProfile`.

## Design Memory

- Basquio UI should feel like an executive reporting product, not a generic SaaS admin shell.
- The canonical shell direction is a pale editorial canvas with darker technical-stage surfaces used intentionally for workflow, pipeline, and proof moments.
- CostFigure is the reference for editorial rhythm, spacing discipline, and token governance, not for color direction.
- Inngest is the reference for technical confidence, dark-stage framing, and pipeline-proof presentation, not for brand cloning.
- Landing-page copy must describe the real product: evidence package plus report brief plus brand direction in, PPTX plus PDF artifacts out.
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
