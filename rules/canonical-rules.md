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

## Railway / Multi-Service Deploy Rules (CRITICAL — learned April 21, 2026 forensic)

### The bot-killing root-railway.toml incident
The Discord bot died silently for ~24 hours starting Apr 21 00:22 UTC because three commits hardening the deck worker (`7792727` Harden worker recovery, `d77142e` Fix Railway worker config ingestion, `cbb6445` Watch worker Dockerfile for Railway deploys) rewrote the **root** `railway.toml`. The Railway project `basquio-bot` has TWO services in it (the deck worker AND the Discord bot). Both services were using the root `railway.toml` because neither had a service-scoped config. When the worker config flipped its `startCommand` to `node --import tsx scripts/worker.ts`, the Discord bot service ALSO redeployed with that command, crash-looped on `NEXT_PUBLIC_SUPABASE_URL is required` (it has `SUPABASE_URL` set, not the `NEXT_PUBLIC_` prefix the deck worker code requires), and stopped recording. The 2-hour Apr 21 strategy call was lost and unrecoverable — no audio, no transcript, nothing in storage.

### The rules
- **Every Railway service MUST have a service-scoped config file at its app subdirectory.** Examples: `apps/bot/railway.toml` for the Discord bot, `apps/web/railway.toml` if the web ever moves to Railway. Do NOT rely on a single root `railway.toml` shared between services.
- **The root `railway.toml` is reserved for the deck worker only.** It builds `Dockerfile.worker` and runs `scripts/worker.ts`. If you add a third service, give it its own subdir config — never extend the root one.
- **Service-scoped configs must pin `dockerfilePath` to the service's own Dockerfile** (`apps/bot/Dockerfile`, etc.) and the start command appropriate to that service.
- **Watch patterns must be service-scoped.** The bot's `watchPatterns` should include `apps/bot/**` and the shared deps it cares about; the deck worker's should include `scripts/**`, `packages/**`, etc. Never let one service's deploy retrigger because of a change in an unrelated service's directory.
- **Never change a service's start command without checking what other services in the same Railway project consume the same config.** `railway variables --service <name>` + `railway logs --service <name>` confirm what's actually running. Do this before pushing any deploy-affecting change.
- **Add a heartbeat watchdog for every long-lived service.** A 30-min silence on the Discord bot transcript table (or equivalent for any other always-on service) must alert. Silent-death across a full night is unacceptable.
- **A retired service config must explicitly stay archived, not deleted.** If we ever sunset the deck worker's root config, leave the file with a comment block pointing each service to its scoped config. Deleting silently re-breaks deploys for any service that was implicitly inheriting it.

### Audit-before-touch checklist for any railway.toml or Dockerfile.* change
1. Run `railway list` to see all projects; `railway variables --service <name>` for each service in the affected project.
2. Confirm which services share the file you're about to edit. If more than one, your change must NOT alter `startCommand`, `builder`, or `dockerfilePath` for the others.
3. Tail `railway logs --service <name>` for each affected service for 60 seconds AFTER the deploy completes. If any starts crash-looping, roll back immediately.
4. Update CLAUDE.md, this file, `memory/canonical-memory.md`, and `docs/decision-log.md` in the same commit if the change alters service-to-config mapping.
