# Narrative Markdown Artifact Contract

## Purpose

This document defines the standard for Basquio narrative markdown output when the narrative lane is enabled.

Narrative markdown is not a slide export format.
Narrative markdown is not a PDF reverse-conversion.
Narrative markdown is not a shallow appendix.

It is a narrative artifact generated from the same evidence-backed reasoning as the PPTX and PDF, but written for readers who need deeper explanation.

In v1, it is intentionally text-first.
Do not embed charts or try to mirror the slide visuals inside Word.

## Core Rule

The narrative markdown must be derived from the same canonical business story as the deck.

That means:

- the same evidence package
- the same brief
- the same deterministic metrics
- the same ranked insights
- the same recommendation logic

The narrative markdown may go deeper than the deck, but it must not drift from it.

## Writing Standard

The narrative markdown must use the same knowledge depth and copywriting rules that govern the deck path.

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
The narrative markdown should be more explanatory, but still sharp and evidence-led.
The narrative markdown should stay cheap and reliable to generate, so narrative clarity matters more than layout ambition.
When a section is dense with numbers, prefer a compact table plus a short explanation over a paragraph made only of figures.
The tone should feel client-ready in both English and Italian: direct, natural, commercial, and easy to reuse.

## Consistency Rules

When the same run emits PPTX, PDF, and narrative markdown:

- claims must agree across all three artifacts
- numbers must agree across all three artifacts
- recommendation direction must agree across all three artifacts
- terminology should stay consistent unless the narrative markdown needs a fuller explanation

The narrative markdown may expand the reasoning, caveats, and execution detail.
It must not contradict the deck.

## Structural Expectations

A strong narrative markdown artifact should usually include:

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
- compact tables are allowed when they improve readability
- no attempt to recreate slide layouts inside Word
- no decorative heavy formatting that makes generation brittle

This is a report artifact, not a collection of slide bullets pasted into Word.

## Explicitly Forbidden

Do not implement narrative markdown by:

- exporting slide text into paragraphs
- converting the PDF into Word
- dumping raw bullets into headings
- weakening the reasoning depth relative to the deck
- using a separate copywriting standard from the deck path
- embedding slide chart screenshots into the Word report
- making narrative generation depend on fragile chart or layout recreation

## Artifact Contract

When narrative markdown is present, it should appear as:

- artifact kind: `md`
- file name: `narrative_report.md`

The artifact manifest should treat narrative markdown as a first-class downloadable artifact beside PPTX and PDF.
