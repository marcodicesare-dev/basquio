# Decision Log

## Accepted

### Intelligence-first architecture

Accepted because:

- generic AI slide generation is commoditized
- product defensibility comes from package understanding, deterministic analytics, narrative quality, and critique

### Evidence-package plus brief plus design-target input model

Accepted because:

- real analytical deliverables often depend on multiple related files, not one flat sheet
- the brief changes what matters and how it should be framed
- the design target materially changes the artifact, not just its paint

### Dataset manifest and package-semantics layer

Accepted because:

- Basquio needs a canonical contract for file roles without hard-coded filename mapping
- file-role preservation and semantic inference are both required before trustworthy analytics planning

### First-class PPTX template interpretation

Accepted because:

- one of the core user inputs is the design target
- PPTX layout, placeholder, placeholder-frame, theme, and slide-size data must materially affect slide planning and rendering
- shallow theme fallback is not sufficient for report-grade template fidelity
- slide plans should preserve region-level bindings so PPTX and PDF renderers honor the same template geometry contract
- template interpretation must preserve layout-to-source-slide exemplars so the final PPTX can instantiate against the uploaded customer template

### Executable metric-planning stage before analytics execution

Accepted because:

- the AI should decide what to compute
- the code should compute the numbers deterministically
- downstream insight ranking, validation, and chart binding need explicit metric specs and derived-table requests

### Explicit asymmetric join contracts for multi-file analytics

Accepted because:

- real evidence packages often join on semantically equivalent keys with different names
- package understanding should infer join direction and key pairing instead of assuming exact column-name matches
- deterministic analytics need explicit left-key and right-key contracts to stay auditable

### Dynamic report-outline and slide-architecture planning

Accepted because:

- slide count, sectioning, transitions, and layout selection must come from the brief and evidence package
- a fixed hard-coded deck spine does not satisfy report-grade planning requirements

### Hard validation gate before rendering

Accepted because:

- rendering should not start until claims, evidence refs, chart bindings, and numeric assertions resolve
- polished output is dangerous when the reasoning chain is weak

### Independent semantic critic plus revision loop

Accepted because:

- deterministic validation alone does not catch unsupported leaps, weak recommendations, or incoherent story logic
- Basquio needs an evaluator stage that can force upstream revision before rendering
- critique must backtrack to the right stage instead of only failing at the end
- deterministic validation and semantic critique should remain separate durable checkpoints before the workflow decides where to backtrack
- revision decisions should be stored so progress UX can explain which stage was revisited
- template-binding failures should be allowed to backtrack into design translation, not only slide planning

### Stage-level traceability for all LLM-assisted steps

Accepted because:

- AI-native systems need auditable prompt, model, fallback, and error traces
- silent null fallbacks make debugging and trust materially worse
- run history should explain not just the output, but how the output was produced

### Signed resumable uploads for large source packages

Accepted because:

- evidence packages and customer templates can exceed the safe size for one-shot browser uploads
- the hosted client should use signed resumable uploads for large files while preserving direct signed uploads for smaller ones
- storage transport should not be the hidden failure mode that breaks generation before the workflow starts

### Stable durable step IDs separate from user-facing stage labels

Accepted because:

- Inngest memoizes by step ID, not by the friendly stage label shown in the UI
- revision attempts need unique execution identities without mutating the canonical pipeline-stage names users see
- stable displayed stage names and unique internal attempt IDs keep orchestration honest and progress UX clean

### Strict structured-output model policy

Accepted because:

- structured planning stages should use strict schema enforcement instead of ad hoc JSON mode
- cross-provider fallback should be explicit and opt-in, not silent
- model traces should reveal when Basquio honored the requested provider versus when it had to use an allowed fallback

### Post-render QA with artifact manifests

Accepted because:

- Basquio ships paired artifacts, so the system needs a durable `ArtifactManifest` plus a `QualityReport`
- storage success alone is not enough; the system should check artifact existence, metadata consistency, and cross-output alignment

### Async generation with durable visible progress

Accepted because:

- report generation is a long-running workflow, not a request-response toy
- large decks should visibly spend more time on planning, critique, and revision than small ones
- users need stage-level progress, elapsed time, and estimated remaining time while the run is in flight
- queued jobs should be reconstructable from persisted request envelopes instead of depending on in-memory request state

### Schema-aware runtime QA for Supabase-backed status and orchestration code

Accepted because:

- production incidents on March 15, 2026 showed that repo-context QA alone is not enough
- a runtime query selected `generation_job_steps.created_at` even though the migrated table only exposed `started_at`
- the result was a production-only status failure that typecheck and build did not catch
- `pnpm qa:basquio` should fail when runtime REST selects drift from the migration-defined schema
- stale-run recovery must be treated as part of the orchestration contract, not as UI copy

### Brand-token intake as first-class styling input

Accepted because:

- many report-generation workflows need brand fidelity without requiring a full editable PPTX template up front
- design tokens, colors, typography, spacing, and logo rules should enter through a contract, not renderer-only overrides

### PPTX plus PDF from one canonical `SlideSpec[]`

Accepted because:

- it prevents renderer divergence
- it keeps the AI focused on planning instead of document syntax

### PptxGenJS plus pptx-automizer

Accepted because:

- greenfield generation and customer template preservation are different jobs
- the two libraries cover both well enough

### Browserless as primary PDF path

Accepted because:

- Loamly already proves the pattern
- brand fidelity is stronger with HTML/CSS than with React-primitives PDF engines

### Dual chart strategy

Accepted because:

- native PPT charts preserve editability for standard chart families
- ECharts SSR covers advanced export-grade visuals without tying the product to a browser UI library

### Inngest as greenfield workflow default

Accepted because:

- team familiarity reduces integration risk
- Basquio needs durable multi-step execution with retriable stages

### QStash checkpoint-resume as inherited fallback

Accepted because:

- Loamly already has a working self-chain pattern
- the pattern is useful if Basquio is incubated inside existing infrastructure

### Supabase as default database and storage layer

Accepted because:

- it already fits the operational shape of the product
- no alternative currently solves a sharper problem

## Rejected

### Generic "AI makes decks" positioning

Rejected because:

- it is not defensible
- it hides the actual value of evidence understanding and report planning

### PDF as editable template source in v1

Rejected because:

- layout semantics are too unreliable for an honest product promise

### Single-file-only dataset assumption

Rejected because:

- executive reporting often relies on evidence packages with separate fact tables, methodology files, and validation files
- package-level reasoning is part of the intelligence moat

### Fixed-spine slide planning

Rejected because:

- it prevents the system from deciding slide count and section emphasis dynamically
- it treats the report as a prewritten script instead of an inferred plan

### Symmetric same-name-only join assumptions

Rejected because:

- they break when related files use different but semantically equivalent identifiers
- they force case-by-case mapping pressure back into the codebase

### Synchronous generation UX for full report runs

Rejected because:

- it hides long-running orchestration behind a frozen form submission
- it gives users no trustworthy sense of progress, revision depth, or expected wait time

### Deterministic-only validation

Rejected because:

- it misses semantic errors, unsupported recommendations, and narrative incoherence
- it cannot independently challenge the generator's reasoning chain

### Silent model fallbacks

Rejected because:

- they hide reliability problems
- they make AI-native debugging and trust much harder

### Template repaint as the only PPTX render path

Rejected because:

- it discards the uploaded customer template as a first-class artifact source
- it breaks master-slide fidelity and weakens the whole promise of editable template-preserving output

### Recharts or Tremor as canonical export engine

Rejected because:

- they are better treated as preview/dashboard choices
- export needs server-rendered, deterministic, vector-friendly output

### `chartjs-node-canvas` as default chart backend

Rejected because:

- native `canvas` dependency risk is a poor match for Vercel-first deployment
- it does not beat the dual strategy of native PPT charts plus ECharts SSR

### `@react-pdf/renderer` as primary PDF engine

Rejected because:

- Basquio needs HTML/CSS-grade branding flexibility first

## Change Rule

If any accepted decision changes, update all of the following in the same change:

- `docs/architecture.md`
- `docs/decision-log.md`
- `memory/canonical-memory.md`
- `rules/canonical-rules.md`
- `code/contracts.ts`
