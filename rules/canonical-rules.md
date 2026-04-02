# Canonical Rules

## Product Rules

- Build the intelligence layer before polishing the renderer.
- Do not market generic slide generation as the product.
- Do not assume one spreadsheet is the whole truth when the job is a report-grade evidence package.
- Treat the report brief and design input as first-class inputs.
- Do not promise exact editable output from PDF inputs in v1.

## Architecture Rules

- LLMs may generate final deck syntax when they do so inside a controlled execution sandbox with deterministic ingest, explicit budget guards, and durable artifact QA.
- Package-level file understanding must happen before trustworthy analytics planning when multiple files are uploaded.
- Deterministic analytics must run from explicit `ExecutableMetricSpec[]`.
- Multi-file joins must support explicit left-key and right-key contracts instead of same-name-only assumptions.
- `SlideSpec[]` remains a valid intermediate planning contract when Basquio needs one, but it is no longer the only permissible path to final artifact generation.
- Slide count, sectioning, and layout selection must still be evidence-driven, not fixed-spine hard-coding.
- `ChartSpec` remains the canonical chart-planning contract even when the direct deck engine decides to render a chart with Python instead of a custom renderer.
- If Basquio uses a direct code-execution deck engine, the deck agent must remain accountable for the final durable user artifacts (`deck.pptx`, `narrative_report.md`, `data_tables.xlsx`) and any internal QA artifacts it generates.
- Template geometry, palette, and typography must still come from `TemplateProfile`, even when the final PPTX is generated directly by Claude.
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

- Use a durable async execution surface for long-running deck jobs.
- Inngest is no longer required when a single code-execution worker owns the full run end to end.
- The preferred durable surface for the current Basquio direct deck engine is a long-running worker process, not a Vercel route handler with request-time limits.
- Use checkpoint-resume patterns or durable event persistence for long jobs.
- Never assume one synchronous request should do all work.
- Long-running runs must expose visible progress state with stage detail and time signals.
- Queued jobs must be reconstructable from persisted request state keyed by `jobId`.
- `deck_runs.status = "queued"` in Supabase is a valid queue contract when a single worker claims runs atomically and updates heartbeat timestamps.
- The durable worker must run recurring stale-run recovery and keep `deck_runs.updated_at` fresh while a run is in flight.
- Git-connected Railway worker deploys must be reproducible from committed repo config, including any native build prerequisites required by workspace dependencies during install.
- Production runtime code must not depend on gitignored workspace-only `.context` files.
- Large or ambiguous decks are allowed to take more revision attempts than simple ones.
- Every LLM-assisted stage must emit auditable trace metadata.
- Status recovery must handle stale queued runs and stale running runs that still have zero durable checkpoints.
- When production behavior and repo assumptions diverge, trust exported runtime evidence before changing timeouts, model config, or recovery policy.
- Separate failure classes by run and attempt. Do not let one expensive failure narrative overwrite a different root cause from another run.

## Rendering Rules

- Prefer direct PPTX generation inside the Claude code-execution sandbox as the primary export path.
- When the PPTX skill is loaded, let the skill own final presentation generation instead of hardcoding a separate presentation library contract in the prompt.
- Use deterministic server-side conversion or model-authored PDF generation as the PDF path.
- Use `pdf-lib` only for post-processing when needed.
- For direct deck generation, default to a premium editorial visual language instead of generic Office styling when the template is weakly specified, but keep dense card text on cross-viewer-safe fonts and reserved non-overlapping layout bands.
- Charts that matter to the argument must be embedded as image assets in the PPTX when Basquio needs one visually consistent deliverable across PowerPoint, Keynote, and Google Slides.
- Claude responds to hard geometry rules and forbidden patterns, NOT taste adjectives. Write design constraints as banned compositions and required band structures, not as "make it beautiful."

## Token Cost Rules (CRITICAL — learned March 23, 2026)

- `container_upload` files cost 0 input tokens. NEVER duplicate file data in the message text.
- Each `pause_turn` continuation re-sends the FULL message history as input tokens. Minimize continuations.
- Include `web_fetch_20260209` in the tools array for free code execution compute.
- If the loaded Anthropic Skills auto-inject code execution, do not also register a second named `code_execution` tool that collides with the injected one.
- The generation call should be a SINGLE turn, not an understand/author split. Multi-turn accumulates tool output and multiplies costs.
- The single-turn file-backed path should be materially cheaper than the split understand/author path. Confirm real cost with live usage telemetry instead of assuming a fixed deck price from prompt theory alone.
- If a smoke test uses > 50K input tokens before meaningful deck output, the prompt or continuation pattern is wrong.

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
- Historical audits or briefs that become non-canonical must be marked as archival at the top and redirected to the current truth source.
- Do not promote forward-looking SDK features or research claims to canonical runtime guidance without live validation.
