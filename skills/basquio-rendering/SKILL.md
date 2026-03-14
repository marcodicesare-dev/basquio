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

## Implementation Checklist

1. Confirm the planned output can be expressed in `ChartSpec` and `SlideSpec`.
2. Choose native PPT chart vs. ECharts export path intentionally.
3. Preserve theme, brand-token, and layout constraints from `TemplateProfile`.
4. Validate output opens and assets resolve.
5. Run `pnpm qa:basquio`.
6. Keep preview-layer charting choices out of export contracts.
