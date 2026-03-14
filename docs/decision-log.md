# Decision Log

## Accepted

### Intelligence-first architecture

Accepted because:

- generic AI slide generation is commoditized
- product defensibility comes from dataset understanding and narrative quality

### Evidence-package plus brief input model

Accepted because:

- real analytical deliverables often depend on multiple related files, not one flat sheet
- the report brief changes what matters, how it should be framed, and what the artifact should optimize for

### Dataset manifest layer

Accepted because:

- Basquio needs a canonical contract for file roles instead of flattening multi-file uploads into one anonymous dataset
- report-grade deliverables depend on preserving which file is the main fact table, which file is methodology, which file is citations, and which file defines brand

### Report-outline step before slide planning

Accepted because:

- a report spine should be explicit before slide layouts are chosen
- framing, methodology, findings, implications, and recommendations are structural planning objects, not renderer-side presentation details

### Hard validation gate before rendering

Accepted because:

- rendering should not start until claims, evidence refs, chart bindings, and numeric assertions resolve deterministically
- failed validation should stop PPTX/PDF generation instead of producing polished but weakly-backed artifacts

### Post-render QA with artifact manifests

Accepted because:

- Basquio ships paired artifacts, so the system needs a durable `ArtifactManifest` plus a `QualityReport`
- storage success alone is not enough; the system should check artifact existence, metadata consistency, and cross-output slide/page alignment

### Brand-token intake as first-class styling input

Accepted because:

- many report-generation workflows need brand fidelity without requiring a full editable PPTX template up front
- design tokens, colors, typography, spacing, and logo rules should enter through a contract, not renderer-only overrides

### PPTX plus PDF from one canonical `SlideSpec[]`

Accepted because:

- it prevents renderer divergence
- it keeps the AI focused on planning instead of final document syntax

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
- Basquio needs durable multi-step execution

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
- the category has already shown churn and failure

### PDF as editable template source in v1

Rejected because:

- layout semantics are too unreliable for an honest product promise

### Single-file-only dataset assumption

Rejected because:

- executive reporting often relies on evidence packages with separate fact tables, methodology files, and validation files
- package-level reasoning is part of the intelligence moat

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
