# Basquio Architecture

## Merged Research Outcome

This architecture merges:

- repo-grounded Loamly patterns that already work in production
- the strongest findings from the second research pass on charting, templates, workflows, and database
- the corrected insight that Basquio must be intelligence-first, not renderer-first

## What To Inherit From Loamly

Keep these proven patterns:

- Browserless HTML-to-PDF flow
- Supabase Storage plus signed URL artifact delivery
- long-running pipeline mindset with checkpoint-resume
- tokenized chart and brand system patterns

Useful Loamly references:

- `src/lib/reports/generate-pdf.ts`
- `src/lib/audit/pdf-generator.ts`
- `src/app/api/audit/pipeline-step/route.ts`

## System Shape

### 1. Intelligence Layer

This is the product.

Responsibilities:

- parse files into normalized analytical structures
- infer measures, dimensions, hierarchies, and time semantics
- compute deterministic metrics before any LLM step
- detect candidate insights and attach evidence
- rank insights by business relevance, confidence, and narrative usefulness
- build a story from general to specific

Canonical flow:

1. `DatasetProfile`
2. `InsightSpec[]`
3. `StorySpec`
4. `SlideSpec[]`

### 2. Template Layer

Responsibilities:

- ingest `.pptx` as a first-class template source
- extract colors, fonts, slide size, layouts, placeholders, and named shapes
- ingest `.pdf` as a style reference only in v1

Decision:

- `.pptx` is editable-template input
- `.pdf` is style-reference input

Do not promise exact editable reconstruction from PDF in v1.

### 3. Rendering Layer

Responsibilities:

- produce editable `.pptx`
- produce branded `.pdf`
- keep both outputs consistent with the same `SlideSpec[]`

This layer is implementation, not moat.

## Technology Decisions

### PowerPoint

Use:

- `pptxgenjs` for greenfield deck generation
- `pptx-automizer` for customer template-preserving `.pptx` workflows

Merged decision:

- use native PptxGenJS charts for standard chart families when editability in PowerPoint is important
- use embedded images only when the chart type exceeds native PPT chart capabilities

### PDF

Use:

- Browserless for primary HTML-to-PDF generation
- `pdf-lib` only for post-processing

Rejected as primary engine:

- `@react-pdf/renderer`

Reason:

- Basquio needs HTML/CSS-grade brand fidelity more than React-primitives-first PDF composition

### Charts

Use a dual strategy:

1. Standard editable PPT chart families

- PptxGenJS native charts for bar, line, area, pie, combo, and similar families when the output is PPTX and editability matters

2. Export-native advanced charts

- Apache ECharts SVG SSR as the canonical export engine for advanced or custom visuals
- convert to PNG only when a target renderer requires raster output

Policy:

- `ChartSpec` is canonical
- React chart libraries do not define the data contract
- `Recharts`, `Nivo`, `Tremor`, and `visx` can be used for app previews only

Rejected as canonical export engine:

- `Recharts`
- `Tremor`
- `chartjs-node-canvas`

Reason:

- Recharts and Tremor are UI-layer/browser-first choices
- `chartjs-node-canvas` brings native `canvas` dependency risk on Vercel and is not the best fit for a serverless-first export pipeline

Secondary option:

- Vega-Lite if the product later needs richer declarative statistical grammars than ECharts comfortably provides

### Excel Ingestion

Use:

- `xlsx` / SheetJS as default parser
- `exceljs` only when richer workbook structure inspection is needed

### Workflow Orchestration

Default for greenfield Basquio:

- `Inngest`

Why:

- already familiar to the team
- better developer ergonomics than hand-rolled chaining
- clean fit for multi-step durable generation jobs

Proven fallback pattern from Loamly:

- QStash checkpoint-resume self-chaining

Use QStash if:

- you build inside existing Loamly job infrastructure
- you want to reuse the exact operational pattern already proven in `audit/pipeline-step`

Alternative:

- `Trigger.dev` if the pipeline becomes more worker-like or needs heavier long-running execution patterns

Do not use as the primary workflow runtime:

- Supabase Queues alone

Reason:

- it is a queue primitive, not a full workflow abstraction

### Database And Storage

Use:

- Supabase Postgres
- Supabase Storage
- Supabase Auth
- optional `pgvector` only when retrieval is genuinely needed

Rationale:

- best operational fit for jobs, tenants, templates, artifacts, and delivery
- low integration cost
- no evidence yet that a separate database choice solves a current product problem

## Canonical Pipeline

### Phase A: Parse

- upload files
- detect file types
- parse workbook with SheetJS
- extract PPT theme data where applicable

### Phase B: Analyze

- infer schema and metric roles
- compute deterministic analytical summaries
- detect anomalies, deltas, trends, rankings, and segment shifts
- produce `DatasetProfile`

### Phase C: Insight

- generate `InsightSpec[]`
- every insight must include evidence and confidence
- rank by business relevance, novelty, and strategic importance

### Phase D: Narrative

- generate `StorySpec`
- plan sequence from general to specific
- map claims to evidence blocks

### Phase E: Slide Planning

- generate deterministic `SlideSpec[]`
- bind layouts, blocks, charts, notes, and validation rules

### Phase F: Render

- PPTX via PptxGenJS or pptx-automizer
- PDF via HTML plus Browserless
- charts via native PPT charts or ECharts SVG

### Phase G: QA

- schema validation
- missing-asset checks
- chart-binding validation
- overflow heuristics
- artifact-open checks

### Phase H: Delivery

- store in private storage
- create signed URLs
- persist generation metadata and versions

## Canonical Data Contracts

Basquio must revolve around these objects:

- `DatasetProfile`
- `InsightSpec`
- `StorySpec`
- `SlideSpec`
- `ChartSpec`
- `TemplateProfile`

The product should never let LLM-generated prose bypass these contracts.

## Performance Target

Initial operational target:

- 10 to 20 slide deck
- async generation flow
- typical completion target under 90 seconds for normal analytical jobs

This is a product target, not a hard SLA.

## What Not To Build

Do not build:

- an unconstrained "make me any deck" AI
- a renderer that depends on React preview components for export
- a PDF template-editing promise that the system cannot keep
- a workflow that assumes one request can do all work reliably
