# Prompt Contracts

## Global Rules

- use structured outputs only
- no free-form markdown as the primary machine output
- keep model roles narrow
- include evidence references whenever an output makes a claim
- reject output that does not match schema

## Model Roles

### Dataset Classifier

Input:

- normalized workbook data
- optional business context

Output:

- `DatasetProfile`

Must decide:

- column roles
- measure vs dimension
- time fields
- segment fields
- data quality warnings

### Insight Generator

Input:

- `DatasetProfile`
- deterministic analytical summaries

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

Output:

- `StorySpec`

Must decide:

- story arc
- ordering from general to specific
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

### Template Interpreter

Input:

- parsed `.pptx` theme and layout data
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
