# Deck Grammar V1

This is the active slide grammar for the direct Claude code-execution deck path.

The canonical implementation source is:

- `packages/scene-graph/src/slot-archetypes.ts`

The direct deck engine should reuse these archetype IDs and constraints instead of inventing new slide compositions ad hoc.

## Purpose

The grammar exists to force:

- stable cross-viewer rendering
- consulting-grade information density
- predictable layout math
- lower token waste from freeform design exploration

## Approved Archetypes

### `cover`

- opening slide
- short high-impact title
- optional subtitle
- no data density

### `section-divider`

- historical section break archetype
- avoid in normal decks; use the category/header label to signal sections instead
- reserve only for rare cover-style transitions when the user explicitly asks for them

### `exec-summary`

- KPI strip plus one compact synthesis band
- 3 to 5 metrics
- short body and one callout

### `title-chart`

- one full-width chart
- title plus optional kicker
- one concise takeaway or callout

### `chart-split`

- chart on one side, insight on the other
- use for explanatory analysis, not for dashboard clutter

### `evidence-grid`

- metric row plus chart plus synthesis block
- for evidence-dense but still disciplined slides

### `comparison`

- direct side-by-side comparison
- two visuals max
- one clear takeaway

### `recommendation-cards`

- exactly two action cards
- each card must reserve separate bands for:
  - index
  - title
  - body
  - footer KPI
- no stacked decorative ordinals
- no floating footer metrics

### `table`

- disciplined high-density data table
- only when the table is the point of the slide

### `summary`

- close the deck with synthesis and actions
- no weak generic recap language

## Global Grammar Rules

- every slide must declare one approved archetype
- every archetype has hard density limits
- if content does not fit an archetype, cut or split the slide
- do not invent custom decorative layouts in the default path
- do not trade cross-viewer stability for ornamental styling

## Quality Rules

- titles state findings, not topics
- one visual center per slide
- no placeholder chrome
- no chart frame without a visible chart
- no card geometry that depends on exact line wrapping
- no recommendation card without explicit footer-band space
