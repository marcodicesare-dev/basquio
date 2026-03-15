# Basquio Architecture

## Merged Research Outcome

This architecture merges:

- repo-grounded Loamly patterns that already work in production
- the strongest findings from primary-source research on agent workflows, PPTX structure, and durable orchestration
- the product requirement, clarified on March 14, 2026, that Basquio must ingest an evidence package, a business brief, and a design target, then output executive-grade PPTX and PDF artifacts

## Product Shape

Basquio is not a generic deck generator.

Basquio is an intelligence system that:

- understands a multi-file evidence package
- decides what should be computed
- computes it deterministically
- ranks what matters for the brief
- chooses the report arc
- plans the slides against real template constraints
- critiques the plan before rendering

The renderer is necessary, but it is not the moat.

## What To Inherit From Loamly

Keep these proven patterns:

- Browserless HTML-to-PDF flow
- Supabase Storage plus signed URL artifact delivery
- long-running pipeline mindset with checkpoint-resume
- tokenized chart and brand-system patterns

Useful Loamly references:

- `src/lib/reports/generate-pdf.ts`
- `src/lib/audit/pdf-generator.ts`
- `src/app/api/audit/pipeline-step/route.ts`

## System Shape

### Intelligence Layer

This is the product.

Responsibilities:

- parse evidence packages into normalized analytical structures
- infer package semantics across files instead of relying on filename hard-coding
- support semantic joins where the identifier names differ across files
- produce executable metric plans before deterministic analytics run
- compute deterministic metrics, derived tables, and evidence refs
- rank insights against the brief
- plan the narrative arc and report outline
- plan slides dynamically from the outline, evidence, and template constraints
- collect stage traces for every LLM-assisted stage
- run deterministic and semantic validation before rendering

Canonical planning flow:

1. `DatasetProfile`
2. `TemplateProfile`
3. `PackageSemantics`
4. `ExecutableMetricSpec[]`
5. `AnalyticsResult`
6. `InsightSpec[]`
7. `StorySpec`
8. `ReportOutline`
9. `SlideSpec[]`
10. `ValidationReport`

### Template Layer

Responsibilities:

- ingest `.pptx` as a first-class template source
- ingest structured brand-token files as a first-class styling source
- ingest `.pdf` as a style reference only in v1
- extract theme colors, fonts, slide size, layouts, placeholder frames, source fingerprints, and source-slide exemplars
- preserve template-origin metadata so slide planning can target real layout constraints
- preserve layout-to-source-slide mappings so the PPTX renderer can instantiate against the uploaded customer deck instead of repainting from scratch

Decision:

- `.pptx` is editable-template input
- brand token files are first-class style-system input
- `.pdf` is style-reference input

Do not promise exact editable reconstruction from PDF in v1.

### Rendering Layer

Responsibilities:

- produce editable `.pptx`
- produce branded `.pdf`
- keep both outputs consistent with the same `SlideSpec[]`
- preserve customer PPTX masters and layouts when the run includes a PPTX template input

This layer is implementation, not moat.

## Technology Decisions

### PowerPoint

Use:

- `pptxgenjs` for greenfield deck generation
- `pptx-automizer` for customer template-preserving `.pptx` workflows

Merged decision:

- use native PptxGenJS charts for standard chart families when editability in PowerPoint matters
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

1. Standard editable PPT chart families via PptxGenJS
2. Advanced export-native visuals via Apache ECharts SVG SSR

Policy:

- `ChartSpec` is canonical
- React chart libraries do not define the data contract
- `Recharts`, `Nivo`, `Tremor`, and `visx` can be used for app previews only

### Excel Ingestion

Use:

- `xlsx` / SheetJS as default parser
- `exceljs` only when richer workbook structure inspection is needed

Evidence-package policy:

- Basquio should support a package of related files, not assume one workbook contains the whole analytical truth
- package-level manifests and semantic inference are part of the intelligence layer, not UI-only concerns

### Workflow Orchestration

Default for greenfield Basquio:

- `Inngest`

Why:

- team familiarity
- durable multi-step execution
- per-step retry controls
- clean fit for long-running staged generation

Proven fallback pattern from Loamly:

- QStash checkpoint-resume self-chaining

Use QStash if:

- you build inside existing Loamly job infrastructure
- you want to reuse the exact operational pattern already proven in `audit/pipeline-step`

### Database And Storage

Use:

- Supabase Postgres
- Supabase Storage
- Supabase Auth
- optional `pgvector` only when retrieval is genuinely needed

## Canonical Pipeline

### Phase A: Intake And Parse

- upload the evidence package, brief, and design target
- use signed standard uploads for small files and signed resumable uploads for larger evidence packages or templates
- detect file types
- preserve file identity and role hints in a manifest
- parse tabular sources with SheetJS
- parse report-guide and brand-token inputs where applicable
- create a durable queued job and persist a reconstructable request envelope so long-running runs can expose live progress and restart from `jobId`

### Phase B: Template Interpretation

- parse `.pptx` template structure when provided
- extract theme colors, fonts, slide size, layouts, placeholder frames, source fingerprint, and source-slide exemplars
- map brand-token inputs into the same `TemplateProfile` contract
- preserve template-origin metadata for downstream slide planning
- allow design translation to be rerun when the critic determines that template interpretation, not narrative planning, is the broken stage

### Phase C: Package Semantics

- infer entities, relationships, time grains, metric candidates, and answerable questions
- infer roles across files without hard-coded filename mapping
- infer asymmetric joins with explicit left and right keys when file schemas use different names
- output `PackageSemantics`

### Phase D: Metric Planning

- generate executable `ExecutableMetricSpec[]`
- define joins, filters, dimensions, metrics, and derived-table requests
- keep the LLM responsible for deciding what to compute
- keep the code responsible for computing the numbers

### Phase E: Deterministic Analytics

- execute the metric plan
- materialize aggregate metrics and derived tables
- preserve evidence refs and provenance
- output `AnalyticsResult`

### Phase F: Insight Ranking

- detect candidate findings from deterministic output
- rank by business relevance, confidence, and usefulness for the brief
- preserve reviewer feedback when the critic requests a revision

### Phase G: Narrative Planning

- generate `StorySpec`
- represent client, thesis, audience, objective, and stakes explicitly
- decide the report arc from general to specific
- map sections to a report spine instead of only loose slide ordering

### Phase H: Outline Planning

- generate `ReportOutline`
- lock the sections before layout selection
- make section count and emphasis dynamic

### Phase I: Slide Architecture

- generate `SlideSpec[]`
- choose slide count dynamically from the brief, evidence density, and outline
- bind layouts, blocks, charts, notes, and transitions
- bind template constraints through `TemplateProfile`
- bind slide blocks to concrete template-region geometry so downstream renderers do not infer placement independently

### Phase J: Critique And Validation

- run deterministic validation on refs, chart bindings, structural consistency, and numeric assertions
- run semantic validation with an independent reviewer model
- persist deterministic validation and semantic critique as separate durable checkpoints before combining the result
- classify issues by likely backtrack stage such as metrics, insights, story, design, or slides
- reject plans that fail either deterministic or semantic review

### Phase K: Revision Loop

- rerun the appropriate upstream stage when the critic finds a real problem
- pass reviewer feedback into replanning stages
- allow large or ambiguous decks to spend more attempts than trivial decks
- persist stage traces and validation history across attempts
- persist revision decisions so users can see which stage the workflow revisited and why

### Phase L: Render

- PPTX via PptxGenJS or pptx-automizer
- PDF via HTML plus Browserless
- charts via native PPT charts or ECharts SVG
- when a PPTX template is present, instantiate the output deck against imported template slides so customer masters and layouts survive into the final artifact

### Phase M: Artifact QA And Delivery

- schema validation
- missing-asset checks
- chart-binding validation
- artifact-open checks
- persist `ArtifactManifest`, `QualityReport`, `ValidationReport`, and stage traces
- store outputs in private storage and create signed URLs
- expose live job-stage progress for long-running runs

## Multi-Agent Behavior

Basquio should behave like a typed orchestrator with specialized roles, not like one long prompt.

Specialized roles:

- package-understanding agent
- metric-planning agent
- deterministic analytics executor
- insight-ranking agent
- narrative-planning agent
- slide-architecture agent
- template-translation agent
- semantic critic

These roles must not simply paraphrase one another. Each stage must own a distinct contract.

## Auditability

Every LLM-assisted stage must emit a `StageTrace` that includes:

- stage name
- prompt version
- requested model id
- resolved model id
- provider
- status
- fallback reason
- error message when relevant
- generation timestamp

Basquio should never silently swallow an LLM failure without recording the fallback path.

## Canonical Data Contracts

Basquio must revolve around these objects:

- `DatasetProfile`
- `TemplateProfile`
- `PackageSemantics`
- `ExecutableMetricSpec`
- `AnalyticsResult`
- `InsightSpec`
- `StorySpec`
- `ReportOutline`
- `SlideSpec`
- `ChartSpec`
- `EvidenceRef`
- `ClaimSpec`
- `ValidationReport`
- `ArtifactManifest`
- `QualityReport`
- `StageTrace`

The product should never let LLM-generated prose bypass these contracts.

## Performance Target

Initial operational target:

- 10 to 20 slide deck
- async generation flow
- normal jobs should usually complete within about 90 seconds
- larger decks are allowed to take longer when the system is intentionally revising upstream stages

This is a product target, not a hard SLA.

## What Not To Build

Do not build:

- an unconstrained "make me any deck" AI
- a slide planner with a fixed hard-coded spine
- a template pipeline that ignores PPTX layout semantics
- a semantic reviewer that is actually the same generator pass in disguise
- a workflow that renders after deterministic success but before semantic review
- a pipeline that assumes one request can do all work reliably
