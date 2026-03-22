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
- read `docs/stack-practices.md` before changing rendering-library behavior
- read `docs/brand-system.md` and `docs/design-synthesis.md` before changing Basquio shell, landing page, or product-surface design direction
- keep Basquio in the editorial-light plus technical-dark merged direction instead of drifting into a generic SaaS dashboard or a dark-only brand
- treat image-chart rendering as a production contract, not a best-effort nicety; if the screenshot path fails in prod, audit why before accepting renderer fallbacks
- do not silently accept shape-built or native-chart fallback as "close enough" when the intended contract is pixel-perfect chart images
- overflow, collision, clipped callouts, unreadable tables, and underfilled slides are render failures, not polish debt
- PPTX and PDF must share the same visual contract, not just the same slide list; token/background/layout drift between renderers is a regression

## Implementation Checklist

1. Confirm the planned output can be expressed in `ChartSpec` and `SlideSpec`.
2. Choose native PPT chart vs. ECharts export path intentionally.
   If the product promise for the run is pixel-perfect screenshots, verify the image-render path is the one actually used in production.
3. Preserve theme, brand-token, and layout constraints from `TemplateProfile`.
4. Verify exported slides fit inside the canonical grid with no overlaps, no clipped boxes, and no effectively empty slides.
5. Treat scene audit failures as artifact failures, not just warnings to log away.
6. When production artifacts look worse than the plan, inspect downloaded PPTX/PDF plus runtime logs before changing spacing heuristics.
7. When changing product UI, preserve the canonical shell and landing-page rules from the design synthesis doc.
8. Validate output opens and assets resolve.
9. Run `pnpm qa:basquio`.
10. Keep preview-layer charting choices out of export contracts.
