# Canonical Rules

## Product Rules

- Build the intelligence layer before polishing the renderer.
- Do not market generic slide generation as the product.
- Do not assume one spreadsheet is the whole truth when the job is a report-grade evidence package.
- Treat the report brief and brand input as first-class inputs.
- Do not promise exact editable output from PDF inputs in v1.

## Architecture Rules

- LLMs produce contracts, not final document syntax.
- Deterministic analytics must run before narrative generation.
- Package-level file understanding must happen before final narrative planning when multiple files are uploaded.
- A dataset manifest must preserve file roles before Basquio compresses anything into report outputs.
- `ReportOutline` must exist before `SlideSpec[]` planning.
- `ChartSpec` must not depend on React component props.
- PPTX and PDF must render from the same `SlideSpec[]`.
- Template and brand interpretation must flow through `TemplateProfile`.
- Preview libraries are not allowed to become export architecture by accident.

## Rendering Rules

- Prefer native editable PPT charts for standard chart families.
- Prefer ECharts SSR SVG for advanced charts and export-grade visuals.
- Use Browserless for PDF generation by default.
- Use `pdf-lib` only for post-processing.

## Workflow Rules

- Use Inngest by default for greenfield Basquio orchestration.
- Use checkpoint-resume patterns for long jobs.
- Never assume one synchronous request should do all work.

## Data Rules

- Every insight must reference evidence.
- Every generated narrative object must be schema-validated.
- Confidence and uncertainty must be represented explicitly.
- Brand colors, typography, spacing, and logo constraints must come from a file-backed contract, not only hardcoded theme values.

## Change Management Rules

- Architecture changes require a matching decision-log update.
- Contract changes require a matching memory update.
- Run `pnpm qa:basquio` after every context change.
