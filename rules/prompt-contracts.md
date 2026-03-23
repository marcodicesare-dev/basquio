# Prompt Contracts

## Global Rules

- use structured outputs only
- no free-form markdown as the primary machine output
- keep model roles narrow
- include evidence references whenever an output makes a claim
- reject output that does not match schema
- for the direct deck engine, charts are screenshots by default, not native Office chart objects
- do not promise cross-viewer compatibility from editable chart XML; require raster chart embeds for PowerPoint, Keynote, and Google Slides consistency
- for the direct deck engine, dense card text and recommendation layouts must prefer cross-viewer-safe typography and reserved non-overlapping bands over fragile ornamental composition

## Model Roles

### Dataset Classifier

Input:

- normalized workbook or evidence-package data
- optional business context

Output:

- `DatasetProfile`
- dataset manifest

Must decide:

- file roles when multiple sources exist
- column roles
- measure vs dimension
- time fields
- segment fields
- data quality warnings

### Insight Generator

Input:

- `DatasetProfile`
- deterministic analytical summaries
- report brief with client, audience, objective, thesis, and stakes

Output:

- `InsightSpec[]`

Each insight must include:

- claim
- evidence
- confidence
- business meaning

### Narrative Planner

Input:

- `DatasetProfile`
- `InsightSpec[]`
- business context
- audience and objective
- thesis and report intent

Output:

- `StorySpec`
- `ReportOutline`

Must decide:

- report thesis
- story arc
- ordering from general to specific
- section spine across framing, methodology, findings, implications, and recommendations
- top messages
- recommendation framing

### Slide Planner

Input:

- `StorySpec`
- `TemplateProfile`
- chart policy

Output:

- `SlideSpec[]`

Must decide:

- slide purpose
- layout choice
- block structure
- chart recommendation
- note content

Chart policy:

- when a slide needs a chart, the planned chart artifact mode is `raster-screenshot`
- screenshot charts must be styled inside the generation environment and embedded as images in the final PPTX

### Template Interpreter

Input:

- parsed `.pptx` theme and layout data
- structured brand token files or CSS-token exports where available
- optional PDF style cues

Output:

- `TemplateProfile`

Must not:

- claim PDF-derived editable fidelity in v1

## Failure Policy

If any model output is missing:

- required fields
- evidence
- confidence
- schema compliance

then the output is rejected and retried or escalated.
