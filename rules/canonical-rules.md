# Canonical Rules

## Product Rules

- Build the intelligence layer before polishing the renderer.
- Do not market generic slide generation as the product.
- Do not assume one spreadsheet is the whole truth when the job is a report-grade evidence package.
- Treat the report brief and design input as first-class inputs.
- Do not promise exact editable output from PDF inputs in v1.

## Architecture Rules

- LLMs produce contracts, not final document syntax.
- Package-level file understanding must happen before trustworthy analytics planning when multiple files are uploaded.
- Deterministic analytics must run from explicit `ExecutableMetricSpec[]`.
- Multi-file joins must support explicit left-key and right-key contracts instead of same-name-only assumptions.
- `ReportOutline` must exist before `SlideSpec[]` planning.
- Slide count, sectioning, and layout selection must be plan-driven, not fixed-spine hard-coding.
- `ChartSpec` must not depend on React component props.
- PPTX and PDF must render from the same `SlideSpec[]`.
- Template and brand interpretation must flow through `TemplateProfile`.
- `.pptx` parsing must materially preserve layout, placeholder, placeholder-frame, theme, and source-origin constraints.
- Preview libraries are not allowed to become export architecture by accident.

## Validation Rules

- Rendering must stop when `ClaimSpec`, chart bindings, or numeric assertions fail deterministic validation.
- Rendering must also stop when semantic review finds unsupported leaps, weak recommendation logic, or narrative incoherence.
- The semantic critic must be independent from deterministic validation.
- Validation issues must classify the likely backtrack stage when possible.
- A failed critic pass should trigger upstream revision, not immediate render.

## Workflow Rules

- Use Inngest by default for greenfield Basquio orchestration.
- Use checkpoint-resume patterns for long jobs.
- Never assume one synchronous request should do all work.
- Long-running runs must expose visible progress state with stage detail and time signals.
- Queued jobs must be reconstructable from persisted request state keyed by `jobId`.
- Large or ambiguous decks are allowed to take more revision attempts than simple ones.
- Every LLM-assisted stage must emit auditable trace metadata.
- Status recovery must handle stale queued runs and stale running runs that still have zero durable checkpoints.

## Rendering Rules

- Prefer native editable PPT charts for standard chart families.
- Prefer ECharts SSR SVG for advanced charts and export-grade visuals.
- Use Browserless for PDF generation by default.
- Use `pdf-lib` only for post-processing.

## Data Rules

- Every insight must reference evidence.
- Every substantive claim must resolve to `EvidenceRef[]`.
- Every generated narrative object must be schema-validated.
- Confidence and uncertainty must be represented explicitly.
- Brand colors, typography, spacing, and logo constraints must come from a file-backed contract, not only hardcoded theme values.
- The AI should decide what to compute; code should compute the numbers.

## Change Management Rules

- Architecture changes require a matching decision-log update.
- Contract changes require a matching memory update.
- Run `pnpm qa:basquio` after every context change.
- Supabase-backed runtime queries must be validated against the migration-defined schema before release.
