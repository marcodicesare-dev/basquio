# DOCX Artifact Contract

## Purpose

This document defines the standard for Basquio DOCX output when the DOCX lane is enabled.

DOCX is not a slide export format.
DOCX is not a PDF reverse-conversion.
DOCX is not a shallow appendix.

It is a narrative artifact generated from the same evidence-backed reasoning as the PPTX and PDF, but written for readers who need deeper explanation.

In v1, it is intentionally text-first.
Do not embed charts or try to mirror the slide visuals inside Word.

## Core Rule

The DOCX must be derived from the same canonical business story as the deck.

That means:

- the same evidence package
- the same brief
- the same deterministic metrics
- the same ranked insights
- the same recommendation logic

The DOCX may go deeper than the deck, but it must not drift from it.

## Writing Standard

The DOCX must use the same knowledge depth and copywriting rules that govern the deck path.

Required inputs:

- `docs/domain-knowledge/niq-analyst-playbook.md`
- `docs/domain-knowledge/basquio-copywriting-skill.md`

Required behavior:

- explain what happened
- explain why it matters
- explain how the recommendation should be executed
- make the chain of reasoning explicit
- preserve the same commercial conclusion as the PPTX and PDF

The deck is concise by design.
The DOCX should be more explanatory, but still sharp and evidence-led.
The DOCX should stay cheap and reliable to generate, so narrative clarity matters more than layout ambition.

## Consistency Rules

When the same run emits PPTX, PDF, and DOCX:

- claims must agree across all three artifacts
- numbers must agree across all three artifacts
- recommendation direction must agree across all three artifacts
- terminology should stay consistent unless the DOCX needs a fuller explanation

The DOCX may expand the reasoning, caveats, and execution detail.
It must not contradict the deck.

## Structural Expectations

A strong DOCX should usually include:

- executive summary
- business question and scope
- key findings
- evidence-backed reasoning by theme
- implications and risks
- recommendations with what, why, and how
- optional appendix material when useful

In v1, the artifact should stay text-first:

- no embedded charts
- no screenshot dumps
- no attempt to recreate slide layouts inside Word
- no decorative heavy formatting that makes generation brittle

This is a report artifact, not a collection of slide bullets pasted into Word.

## Explicitly Forbidden

Do not implement DOCX by:

- exporting slide text into paragraphs
- converting the PDF into Word
- dumping raw bullets into headings
- weakening the reasoning depth relative to the deck
- using a separate copywriting standard from the deck path
- embedding slide chart screenshots into the Word report
- making DOCX generation depend on fragile chart or layout recreation

## Artifact Contract

When DOCX is present, it should appear as:

- artifact kind: `docx`
- file name: `report.docx`

The artifact manifest should treat DOCX as a first-class downloadable artifact beside PPTX and PDF.
