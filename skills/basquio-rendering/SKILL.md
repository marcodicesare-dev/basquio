---
name: basquio-rendering
description: >
  Use when implementing template ingestion, brand-token interpretation, chart rendering,
  PowerPoint generation, PDF generation, and artifact QA.
---

# Basquio Rendering

## Goal

Render high-quality artifacts without turning renderer constraints into product architecture.

## Rules

- PPTX and PDF come from the same `SlideSpec[]`
- prefer editable PPT charts for standard families
- prefer ECharts SSR for advanced export visuals
- use Browserless for PDF by default
- treat brand token files as first-class styling input
- treat PDF templates as style references in v1
- read `Basquio/docs/stack-practices.md` before changing rendering-library behavior
- read `Basquio/docs/brand-system.md` and `Basquio/docs/design-synthesis.md` before changing Basquio shell, landing page, or product-surface design direction
- keep Basquio in the editorial-light plus technical-dark merged direction instead of drifting into a generic SaaS dashboard or a dark-only brand

## Implementation Checklist

1. Confirm the planned output can be expressed in `ChartSpec` and `SlideSpec`.
2. Choose native PPT chart vs. ECharts export path intentionally.
3. Preserve theme, brand-token, and layout constraints from `TemplateProfile`.
4. When changing product UI, preserve the canonical shell and landing-page rules from the design synthesis doc.
5. Validate output opens and assets resolve.
6. Run `pnpm qa:basquio`.
7. Keep preview-layer charting choices out of export contracts.
