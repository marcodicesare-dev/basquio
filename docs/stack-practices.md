# Stack Practices

Last revalidated against official documentation: April 25, 2026.

## Purpose

This document captures the highest-signal implementation guidance for the Basquio stack so future agents do not need to re-derive it from scratch.

The goal is not to replace canonical architecture. The goal is to make day-two execution cleaner:

- safer Supabase usage
- more reliable Inngest workflows
- honest PDF and PPTX rendering boundaries
- export-safe charting
- predictable evidence-package ingestion
- file-backed brand-token handling

## Supabase

### Database exposure model

Use the `public` schema only for tables that must be reachable through the Supabase Data API.

Reason:

- Supabase documents that tables accessible through the Data API must have RLS enabled.
- Supabase also recommends a `private` schema for tables you do not want exposed through the Data API, with access routed through server-side code instead.

Basquio implication:

- keep tenant-facing app tables in `public` only when the client must query them
- move admin-only or workflow-internal tables to a `private` schema if auth complexity grows faster than the product UI
- until tenant-aware RLS is implemented, prefer service-role access from server-side code only

### RLS policy guidance

Do not create permissive `using (true)` / `with check (true)` policies on multi-tenant tables.

Use membership-aware policies based on organization membership once client reads and writes are enabled.

Performance guidance from Supabase:

- index columns used in policy predicates
- remember that RLS affects query performance, especially on wide scans

### Service role usage

Supabase explicitly recommends creating a separate server-side client for `service_role` administration tasks instead of trying to force it through SSR auth helpers.

Basquio implication:

- use SSR/browser clients only for user-scoped access
- use a dedicated server-side client for artifact storage, workflow writes, and admin mutations
- never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser

### Schema compatibility discipline

TypeScript success does not prove Supabase runtime compatibility.

Basquio implication:

- every runtime REST `select` should be compatible with the migration-defined schema
- `pnpm qa:basquio` should fail when runtime selects drift from actual table columns
- production web logs plus Postgres logs are the source of truth when local behavior and hosted behavior disagree

### Storage model

Keep source files, templates, and artifacts in private buckets.

Use signed URLs for delivery, not public buckets, for generated decks and uploaded customer files.

For larger uploads, use signed resumable uploads against Supabase Storage and keep one-shot signed uploads for smaller files.

## Durable Execution

### Railway worker

The current Basquio generation path should run on a long-lived worker process, not inside a request/response handler.

Basquio implication:

- Vercel should enqueue `deck_runs` and return immediately
- Railway should poll Supabase for `status = "queued"` runs and claim them atomically
- Git-connected Railway builds must stay reproducible from committed repo config; if any workspace dependency may invoke `node-gyp`, keep the required native toolchain in `nixpacks.toml`
- the worker must heartbeat `deck_runs.updated_at` while a long Claude call is in flight
- stale-running runs must be re-queued on a recurring interval, not only at startup
- Anthropic client timeouts in the worker must exceed real workbook runtime instead of inheriting old route-era ceilings

### Inngest historical guidance

If Basquio reintroduces a multi-step orchestrator in the future, these constraints still apply.

Inngest documents that:

- successful steps are memoized
- failing steps retry independently
- step IDs are the identity used for memoization across function versions

### Retries

Inngest retries functions and steps by default.
Official docs state that each step gets its own retry budget, and permanent failures should use `NonRetriableError`.

Basquio implication:

- use retriable errors for transient network/storage failures
- use `NonRetriableError` for bad templates, unsupported encrypted workbooks, invalid contracts, and unrecoverable user input

### Idempotency

Inngest recommends idempotency at both the producer and consumer layers.

Basquio implication:

- emit events with a deterministic `id` where possible
- key generation runs by `jobId`
- make storage writes and job-step writes idempotent via upserts or deterministic paths

### Future flow control

When Basquio supports multiple organizations and heavier workloads:

- add org-scoped concurrency controls
- add throttling for expensive render steps
- consider separating template analysis from generation fan-out
- if a worker pool replaces the single worker, preserve atomic claim semantics and heartbeat-based stale-run recovery

## Anthropic provider contract

### Skills and code execution

Anthropic's official docs and the live API need to be validated together because the runtime has branch-specific behavior.

Basquio implication:

- Sonnet and Opus with `webFetchMode: "off"` must include `{ type: "code_execution_20250825", name: "code_execution" }`
- Sonnet and Opus with `webFetchMode: "enrich"` should send `web_fetch` and let the live API auto-inject code execution. Explicit duplicate `code_execution` conflicts on that branch
- Haiku keeps explicit `code_execution` on both branches because it does not load Skills
- never treat an empty `tools` array as valid on author or revise when the worker expects code execution
- For file-backed code-execution requests, follow Anthropic's documented content order: the text instruction block first, then `container_upload` blocks. Basquio author and smoke requests should use that order consistently.
- The author prompt must include a file-availability preflight. If the deterministic ingest found tabular data, Claude must locate and open at least one uploaded workbook or CSV before generating `deck.pptx`, `narrative_report.md`, or `data_tables.xlsx`.
- If Claude reports that an expected workbook is missing from the container, stop the attempt as an evidence availability failure. Do not continue into manifest salvage or revise.
- In merged full-deck author runs, `analysis_result.json` must be a real attached file and must parse before revise starts. Manifest-only analysis salvage can preserve forensic evidence, but it must not be treated as a valid author contract for production reruns.

### Validation discipline

TypeScript and unit tests are not enough for provider-contract changes.

Basquio implication:

- changes to `packages/workflows/src/anthropic-execution-contract.ts` must run live smokes on both the no-web-fetch and enrich branches with a real Anthropic key before merge
- the canonical local commands are `pnpm test:code-exec-no-webfetch` and `pnpm exec tsx scripts/test-anthropic-skills-contract.ts --web-fetch-mode enrich`
- if runtime evidence and historical docs disagree, trust the live provider response and update the docs in the same change
- new forensic validators must be rolled out in true shadow mode: export-only, fail-soft, and advisory-only when env is unset or `warn`
- do not put new workbook reparsing or model-classifier validators on author or revise unless the mode is explicitly blocking and the exact live run path has been proven with production evidence

## Browserless

### PDF generation contract

Browserless `/pdf` accepts either `url` or `html`, but not both.

Basquio implication:

- default to raw HTML for deterministic deck rendering
- use URL mode only when rendering a pre-hosted preview route is materially useful

### Waiting strategy

Use `gotoOptions` and explicit waits intentionally.

Basquio implication:

- avoid assuming `networkidle0` alone is enough for all render cases
- when charts or late-loaded assets exist, add explicit waits or selectors
- keep HTML as self-contained as practical for stable PDF output

### Metadata

Browserless documents that PDF metadata is not part of its native `/pdf` capability.

Basquio implication:

- continue to use `pdf-lib` after Browserless generation for title/author/metadata and small post-processing

## Brand Tokens

### File contract

When Basquio ingests a brand file instead of a full PPTX template, prefer a structured token format over ad hoc prose.

Best-fit direction:

- DTCG-style JSON token files when available
- CSS custom property exports as a pragmatic fallback

Basquio implication:

- normalize uploaded brand files into `TemplateProfile`
- preserve colors, typography, spacing, and logo hints through a contract instead of renderer-only overrides
- do not hide brand decisions in disconnected CSS modules

## ECharts

### Renderer choice

Apache ECharts recommends SVG SSR in export scenarios where vector quality matters, and Canvas when SVG is not applicable.

Basquio implication:

- prefer SVG SSR for PDF visuals and advanced PPT image embeds
- use Canvas or raster fallbacks only when the chart type, downstream consumer, or data density makes SVG a poor fit

### Interaction limits

Server-side output is for static export. Interactions such as tooltips and dynamic legend behavior are not the target.

Basquio implication:

- do not let preview interaction requirements leak into export contracts
- if the app later adds rich preview interactions, keep them as a separate concern

### Data-volume rule of thumb

ECharts notes that Canvas is generally better when data volume gets large, with `>1k` data points given as an experience-based threshold.

Basquio implication:

- small and medium export visuals: SVG-first
- very dense or heatmap-like visuals: evaluate Canvas/raster fallback case by case

## SheetJS

### Parsing strategy

SheetJS parses all worksheets by default, but supports limiting parsed sheets via the `sheets` option.

Basquio implication:

- add preflight sheet detection before full parsing on large customer workbooks
- parse only the tabs required for the current job when Basquio supports sheet selection

### Encryption caveat

SheetJS CE documents limited encryption support.

Basquio implication:

- detect encrypted workbooks explicitly
- fail early with a clear user-facing error instead of opaque parser failure

### Ingest discipline

Do not couple workbook parsing directly to business intelligence reasoning.

Basquio implication:

- parse into normalized workbook structures first
- then infer roles
- then run deterministic summaries

### CSV-first product path

CSV should remain the default v1 tabular input.

Basquio implication:

- make `.csv` the fastest and best-tested product path
- keep `.xlsx` / `.xls` support for workflows where multi-sheet structure matters
- do not design the product around spreadsheet-only assumptions when the broader requirement is evidence-package ingestion

### Evidence-package discipline

Real report-generation jobs may include multiple CSVs, validation files, methodology notes, and brand files.

Basquio implication:

- infer or capture file roles at the package level
- keep file-role understanding inside the intelligence layer
- avoid flattening the whole package into one anonymous table before reasoning

## PptxGenJS

Use PptxGenJS when Basquio needs greenfield slide creation of text, shapes, and images.

Best fit:

- deterministic text/table placement
- decks built from canonical slide objects

Do not treat native editable charts as the export contract for Basquio client deliverables. Embed chart screenshots instead when the deck must survive PowerPoint, Keynote, and Google Slides consistently.

## pptx-automizer

Use `pptx-automizer` when the job is preserving and modifying real customer templates.

Important guidance from the project:

- identify shapes by stable names where possible
- slide number plus shape name is acceptable only when templates are stable
- when masters/layouts differ, slide master import handling matters
- broken relations and unsupported shape/media types are a real troubleshooting class

Basquio implication:

- define template authoring guidelines that require stable named placeholders
- keep a QA path that inflates broken output `.pptx` files and checks `ppt/slides/_rels` plus media references

## Agent Context Rules

When future agents touch the Basquio stack:

1. Start with canonical docs.
2. Read this file before changing workflow, storage, rendering, or ingest implementation.
3. Prefer official docs over blog posts when stack behavior is unclear.
4. Treat export behavior and preview behavior as separate design surfaces.
5. Encode new stack discoveries into skills or this document, not only into code comments.

## Sources

- [Design Tokens Community Group](https://www.designtokens.org/)
- [Design Tokens Format Module](https://www.designtokens.org/tr/drafts/format/)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase hardening data API](https://supabase.com/docs/guides/api/hardening-data-api)
- [Supabase service_role server-side guidance](https://supabase.com/docs/guides/troubleshooting/performing-administration-tasks-on-the-server-side-with-the-servicerole-secret-BYM4Fa)
- [Supabase storage bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase signed URLs](https://supabase.com/docs/guides/storage/serving/downloads)
- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Inngest steps](https://www.inngest.com/docs/learn/inngest-steps)
- [Inngest retries](https://www.inngest.com/docs/features/inngest-functions/error-retries/retries)
- [Inngest idempotency](https://www.inngest.com/docs/guides/handling-idempotency)
- [Inngest docs and agent resources](https://www.inngest.com/docs/)
- [Browserless PDF API](https://docs.browserless.io/rest-apis/pdf-api)
- [Browserless waiting options](https://docs.browserless.io/nav-options/waiting)
- [ECharts server-side rendering](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/)
- [ECharts canvas vs SVG](https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/)
- [SheetJS parse options](https://docs.sheetjs.com/docs/api/parse-options/)
- [SheetJS import tutorial](https://docs.sheetjs.com/docs/getting-started/examples/import)
- [PptxGenJS charts](https://gitbrent.github.io/PptxGenJS/docs/api-charts/)
- [pptx-automizer README](https://github.com/singerla/pptx-automizer)
