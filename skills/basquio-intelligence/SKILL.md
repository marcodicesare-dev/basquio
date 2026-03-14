---
name: basquio-intelligence
description: >
  Use when building or evaluating evidence-package understanding, deterministic analytics,
  insight extraction, confidence scoring, or report-story planning.
---

# Basquio Intelligence

## Goal

Make the intelligence layer trustworthy, evidence-backed, and reusable.

## Rules

- deterministic analysis before LLM reasoning
- every insight needs evidence
- every claim needs confidence
- outputs must be structured and schema-valid
- stories must move from general to specific
- the report brief must materially influence the story
- file-role understanding matters when the input is a package, not one sheet

## Required Outputs

- `DatasetProfile`
- `InsightSpec[]`
- `StorySpec`
- `SlideSpec[]`

## Evaluation Lens

- Is the insight actually supported by data?
- Does the system understand what each file in the package is for?
- Is the ranking of insights useful for a business user?
- Is the story coherent without overselling weak evidence?
- Can each slide be traced back to evidence?
