# Vision

## Product Thesis

Basquio wins only if it is better at business intelligence, narrative construction, and brand-controlled report generation than generic AI slide tools.

Generic "make me a deck" products are not durable. The moat is domain-specific understanding:

- parse messy evidence packages, not only single spreadsheets
- infer the actual business question
- detect what matters in the data
- explain why it matters
- build an executive story that a consultant, strategist, or brand manager would accept

## Product Promise

Inputs:

- one or more structured business data files, with `.csv` as the default v1 input and `.xlsx` / `.xls` still supported
- optional non-tabular support files such as a methodology guide, definitions file, or report brief
- free-text business context, audience, objective, and thesis
- brand input from either:
  - a `.pptx` template when editable layout fidelity matters
  - a structured brand token file when colors, typography, spacing, and logo rules should drive rendering
  - a `.pdf` as style reference only in v1

Outputs:

- editable `.pptx`
- polished `.pdf`
- both from the same canonical story and slide spec
- a report-grade narrative that explains what happened, why it matters, and what the audience should do next

## Target User

Initial focus:

- strategy, insight, and research teams
- consultants and agencies building recurring analytical deliverables
- internal operating teams that need executive-ready reporting from structured evidence packs

The product should later generalize to adjacent analytical reporting categories, but v1 should optimize for recurring executive narratives such as market intelligence, AI visibility, category performance, share, trend, segment, and competitive reporting.

## Product Moat

The moat is not:

- PowerPoint export
- PDF export
- prompt wrappers
- generic chart rendering
- generic "AI report writer" behavior

The moat is:

- canonical dataset-package understanding
- insight ranking with evidence
- narrative planning from business objective plus data state
- reusable template and brand intelligence
- consistent output quality under real client constraints

## Non-Negotiable Principle

The AI does not generate final slides directly.

The AI produces structured planning objects on top of deterministic analysis:

- `DatasetProfile`
- `InsightSpec[]`
- `StorySpec`
- `SlideSpec[]`

Renderers then deterministically produce PPTX and PDF from those contracts.

## Immediate Product Direction

As of March 14, 2026, the correct Basquio target is:

- upload a multi-file evidence package
- provide a clear report brief
- attach a brand system or template
- generate an executive-grade report artifact

That is a materially different product from a generic one-shot deck generator, and future agents must preserve that distinction.
