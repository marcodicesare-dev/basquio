# V5 Deck Quality Implementation Plan

This plan translates the latest direct deck learnings into concrete work that can move Basquio from "better-looking" to reliably consulting-grade.

## Goal

Produce `10/10` executive decks with:

- stable cross-viewer rendering
- disciplined consulting-style information density
- strong visual hierarchy
- evidence-backed claims
- hard rejection of weak slides
- production-safe cost controls

## What We Learned

- Claude follows explicit geometry and forbidden patterns better than abstract taste language.
- "Make it beautiful" is weak. "Use this archetype with these bands, font rules, and density caps" is strong.
- The remaining quality gap is selection and judgment, not only generation.
- The current direct deck path needs fewer slide grammars, stricter archetypes, rendered-page evaluation, and candidate ranking.
- Cost spikes are driven mostly by too many resumed code-execution turns with growing context, not only by prompt size.

## Target System

Basquio should generate decks with five layers:

1. Deterministic evidence and template interpretation
2. Slide grammar selection from a small approved archetype library
3. Model-native PPTX and PDF generation in Claude code execution
4. Rendered-page evaluation on slide images, not only JSON manifests
5. Variant ranking and hard publish vetoes

## Phase 1: Freeze A Strong Slide Grammar Library

Ship a small set of high-confidence slide archetypes and stop letting the model invent arbitrary compositions.

Current implementation status:

- the direct deck path now reuses the archetype library in `packages/scene-graph/src/slot-archetypes.ts`
- `slideArchetype` is part of the direct analysis and manifest contract
- `recommendation-cards` is now a first-class archetype instead of an accidental freeform layout

Initial archetypes:

- cover
- executive summary KPI strip
- evidence list
- comparison chart
- recommendation cards
- opportunity ladder
- pricing / packaging cards
- disciplined table
- closing summary

Requirements:

- each archetype gets explicit region math
- each archetype gets density caps
- each archetype gets approved typography rules
- each archetype gets "forbidden patterns"

Deliverables:

- `docs/deck-grammar-v1.md`
- `code/contracts.ts` schema additions for `slideArchetype`
- prompt contract updates so authoring must choose from the grammar set

Acceptance:

- no freeform layout invention in the default path
- every generated slide declares one approved archetype

## Phase 2: Add Archetype-Specific Authoring Contracts

Move from generic authoring to archetype-specific instructions.

Examples:

- recommendation cards:
  - separate index, title, body, footer bands
  - no stacked decorative ordinals
  - no footer overlap
- KPI strip:
  - max card count
  - max title length
  - fixed footer alignment
- chart split:
  - max body words
  - fixed chart area ratio
  - title and annotation limits

Deliverables:

- author prompt builder split by archetype
- revise prompt builder that names the broken archetype and failure class
- new manifest QA rules by archetype

Acceptance:

- every known failure class from March 2026 maps to a concrete archetype rule

## Phase 3: Add Rendered-Page QA

Manifests are not enough. Evaluate the rendered artifact itself.

Production method:

- upload `deck.pdf` to Claude as a beta document block
- run a structured visual judge over the rendered PDF pages plus slide metadata
- persist that report as a working paper and inside artifact QA

Debug method:

- optionally rasterize PDF pages to PNG locally for human review and regression fixtures

Pipeline:

- judge the rendered PDF artifact, not only the manifest JSON
- detect:
  - overflow
  - collisions
  - dead space abuse
  - weak hierarchy
  - unreadable charts
  - ugly recommendation cards
  - generic "dashboard sludge" patterns

Deliverables:

- `packages/workflows/src/rendered-page-qa.ts`
- persisted per-slide visual QA results
- red/yellow/green publish gating based on image review

Acceptance:

- a deck with visible overlap or collision cannot publish as success

## Phase 4: Multi-Candidate Slide Generation

Stop polishing a weak first draft. Generate variants for high-risk archetypes.

Scope:

- recommendation cards
- executive summary slides
- closing summary
- complex comparison slides

Process:

- generate 2 variants for only the risky slides
- render all candidates
- score them with the visual judge
- keep the best candidate

Cost control:

- candidate generation is selective, not whole-deck by default
- limit to at most 2 slides flagged as weak or high-value in one run
- if the run is already near the budget ceiling, skip candidate generation and fail closed instead

Deliverables:

- slide candidate schema
- candidate render loop
- ranking function with evidence + image inputs

Acceptance:

- the system can replace a weak slide without regenerating the whole deck

## Phase 5: Deck-Level Editorial Judge

Add a final judge that evaluates the deck as a whole, not just slide-by-slide.

Judge questions:

- is the story cumulative and sharp
- does each slide have one clear job
- is there redundancy across slides
- does the deck feel consultant-grade or generic
- should a human send this to a client or exec

Deliverables:

- deck-level judge prompt and schema
- persisted deck-level quality report
- publish veto when the deck remains below threshold

Acceptance:

- decks that are structurally valid but obviously mediocre do not ship

## Phase 6: Cost Discipline

The new quality loop must stay under the target cost envelope.

Controls:

- cache the static Basquio brain
- reduce open-ended stdout
- reduce total pause-turn iterations
- keep analysis outputs compact
- generate variants only for flagged slides
- use cheaper judge paths where acceptable
- cap total candidate count per run

Instrumentation:

- cost per phase
- cost per slide family
- cost per candidate
- total pause-turn count
- total container-turn count
- inline-only requests may use Anthropic `countTokens`, but file-backed phases using Files API refs or `container_upload` must rely on actual-response usage because the token-counting endpoint rejects those sources

Deliverables:

- richer `cost_telemetry`
- budget gates per phase
- alerting on unusually high continuation counts

Acceptance:

- normal decks stay within the target cost range
- expensive runs explain where the spend came from

## Phase 7: Golden Set Evaluation

Build the quality bar from real briefs and real reference decks.

Set:

- bootstrap with 5 representative briefs and strong reference decks
- paired outputs:
  - Basquio output
  - strong human or Cowork reference

Evaluation:

- blind pairwise rating
- per-slide failure tags
- pass/fail shipping threshold

Deliverables:

- `fixtures/golden-decks/`
- regression dashboard
- required pre-release evaluation run

Acceptance:

- model or prompt changes do not ship without regression results on the bootstrap golden set
- expand from 5 references toward 20+ over time instead of blocking the first release on a full corpus

## Immediate Work Order

Do this next, in order:

1. Define `deck-grammar-v1` with 8-10 archetypes and hard layout rules.
2. Refactor authoring prompts to require those archetypes explicitly.
3. Implement rendered-page QA from generated PDF pages.
4. Add candidate generation only for recommendation and summary slides.
5. Add deck-level publish veto.
6. Add per-phase cost telemetry and continuation-count telemetry.
7. Build the first golden set and use it as a release gate.

## Kill Criteria

Stop investing in prompt-only aesthetic tuning if:

- slide geometry failures continue after archetype freezing
- deck quality remains inconsistent without candidate ranking
- cost rises faster than quality

If that happens, Basquio should move even more of the quality loop into explicit archetype rendering and ranking rather than trying to "prompt harder."
