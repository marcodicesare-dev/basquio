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
- narrative `.md` report with deeper explanation
- audit-ready `data_tables.xlsx` with the exact analysis tables behind the findings
- all from the same canonical evidence interpretation and deck intent
- a report-grade narrative that explains what happened, why it matters, and what the audience should do next
- Haiku is the report-and-data tier: `narrative_report.md` + `data_tables.xlsx` without presentation output

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

The AI must be accountable for final deck quality, not just intermediate planning objects.

Basquio still requires deterministic ingest, evidence grounding, template interpretation, and budget guards, but the current primary path allows Claude to generate the final PPTX and PDF inside a controlled execution sandbox when that produces better report quality than a fragmented renderer stack.
The generated PDF is an internal QA artifact in the current direct path; the durable user-facing outputs are the PPTX, markdown report, and data workbook.

## Quality Principle

Beautiful output cannot depend on vague "make it elegant" prompting.

Basquio should win by combining:

- a small number of proven consulting-grade slide grammars
- evidence-backed content filling
- viewer-safe implementation constraints
- rendered-page evaluation
- candidate ranking and rejection of weak variants

The system should be optimized to refuse brittle or mediocre slides, not merely to produce a complete deck.

## Immediate Product Direction

As of March 14, 2026, the correct Basquio target is:

- upload a multi-file evidence package
- provide a clear report brief
- attach a brand system or template
- generate an executive-grade report artifact

That is a materially different product from a generic one-shot deck generator, and future agents must preserve that distinction.
