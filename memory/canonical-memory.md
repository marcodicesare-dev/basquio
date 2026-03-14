# Canonical Memory

## Always True Until Explicitly Changed

- Basquio is intelligence-first, renderer-second.
- The moat is dataset understanding, insight ranking, and narrative planning.
- `.pptx` is the only first-class editable template input in v1.
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

- upload workbook
- provide context
- choose template or style direction
- receive editable PPTX and polished PDF

Initial domain bias:

- FMCG and business insight storytelling

## Technical Memory

- Standard charts should prefer native editable PPT charts when possible.
- Advanced charts should prefer ECharts SVG SSR.
- Raster output is a fallback, not the canonical chart format.
- Deterministic analytics run before LLM narrative planning.
- Every insight must have evidence and confidence.

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
- whether Basquio preview UI should use client ECharts or Recharts
- whether Vega-Lite becomes necessary for specific analytical chart families
- whether Basquio launches inside Loamly or as a separate repo first
