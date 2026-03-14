# Vision

## Product Thesis

Basquio wins only if it is better at business intelligence and narrative construction than generic AI slide tools.

Generic "make me a deck" products are not durable. The moat is domain-specific understanding:

- parse messy business files
- infer the actual business question
- detect what matters in the data
- explain why it matters
- build an executive story that a consultant or brand manager would accept

## Product Promise

Inputs:

- Excel or tabular business data
- free-text business context
- preferred template input, with `.pptx` as first-class and `.pdf` as style reference

Outputs:

- editable `.pptx`
- polished `.pdf`
- both from the same canonical story and slide spec

## Target User

Initial focus:

- FMCG and market-insight teams
- strategy and category managers
- consultants building recurring data storytelling deliverables

The product should later generalize to adjacent analytical reporting categories, but v1 should optimize for recurring category, share, trend, segment, and performance narratives.

## Product Moat

The moat is not:

- PowerPoint export
- PDF export
- prompt wrappers
- generic chart rendering

The moat is:

- canonical dataset understanding
- insight ranking with evidence
- narrative planning from business objective plus data state
- reusable template intelligence
- consistent output quality under real client constraints

## Non-Negotiable Principle

The AI does not generate final slides directly.

The AI produces structured planning objects on top of deterministic analysis:

- `DatasetProfile`
- `InsightSpec[]`
- `StorySpec`
- `SlideSpec[]`

Renderers then deterministically produce PPTX and PDF from those contracts.
