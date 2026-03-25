# Direct Deck Design Spec

This document defines the visual contract for the direct Claude code-execution deck engine.

The target is not generic SaaS slides. The target is a premium editorial consulting deck that feels deliberate, sparse, and board-ready.

## Core Visual Direction

- default canvas: dark editorial background, close to `#0A090D`
- card surfaces: slightly lifted charcoal panels, not flat black and not light dashboard cards
- headlines: large serif display, high contrast, strong left alignment, generous whitespace
- body copy: restrained sans serif, muted gray, short paragraphs only
- metadata and labels: monospace or tightly tracked small caps
- accents: sparse and structural, not decorative

## Canonical Palette

- background: `#0A090D`
- surface: `#13121A`
- card: `#16151E`
- border: `#272630`
- headline/body high contrast: `#F2F0EB`
- secondary text: `#A09FA6`
- muted text: `#6B6A72`
- amber accent: `#E8A84C`
- green accent: `#4CC9A0`
- blue accent: `#6B8EE8`
- purple accent: `#9B7AE0`
- cyan accent: `#5AC4D4`

If an uploaded template provides a stronger palette, preserve that template. Otherwise this is the fallback baseline.

## Typography

- use serif display sparingly for cover titles and short page-level headlines when the template does not override it
- use Arial for dense slide text, card titles, KPI numerals, recommendation labels, and all explanatory copy that must survive PowerPoint, Keynote, and Google Slides without layout drift
- monospace is only for micro-labels, footnotes, metadata, time ranges, source lines, and compact numeric labels
- never depend on exotic fonts or tight font metrics for core slide geometry

## Layout Rules

- one visual center per slide
- titles should usually sit in the upper-left quadrant
- use fewer blocks with more breathing room
- avoid symmetric dashboard grids unless the slide is explicitly a KPI summary
- do not fill empty space with filler paragraphs
- do not place long narrative text beside a weak chart just to occupy the page
- use 2-column layouts only when both columns have legitimate information weight
- cards should have restrained rounding and thin borders
- top accent rules on cards are preferred over thick decorative borders

## Slide Archetypes

- executive summary: 4-6 KPI cards max, then one decisive takeaway
- evidence list: two columns of short bullets grouped by theme, color-coded labels
- opportunity ladder: 3 horizontal size bars or stacked cards with one clear explanatory note
- pricing / packaging: parallel cards with one price band, one short descriptor, one rationale
- table slide: high-density but disciplined; monospace numbers, alternate row shading, one action title
- matrix / heatmap: compact, color-banded, readable in one glance
- recommendation / action cards: use dedicated vertical bands for index, title, body, and footer; do not let decorative numbers collide with the title or footer KPI

## Cross-Viewer Layout Safety

- optimize for PowerPoint, Keynote, and Google Slides import stability, not only for one viewer
- do not rely on stacked decorative numerals unless they sit in a reserved block with enough width and height to remain on one line
- prefer a simple single-line `01` / `02` badge over a fragile oversized ornament
- body copy must stop above the footer band; never float KPI values directly under body paragraphs without reserved space
- footer KPI value and footer label must sit on one dedicated baseline or footer row, not in separate drifting text boxes
- avoid narrow text boxes that force line-wrap changes across apps
- if a composition depends on exact line breaks, simplify it

## Chart Rules

- charts must look native to the slide system, not default matplotlib screenshots pasted blindly
- use dark chart backgrounds that match the slide or transparent backgrounds over dark slides
- axis labels, legends, and value labels must be readable on dark surfaces
- prefer a single emphasized series plus muted comparison series
- use solid amber / teal / blue accents with limited palette variety
- do not use rainbow palettes
- do not use 3D charts, SmartArt, or Microsoft Office default chart themes
- never stretch a rendered chart to fill a mismatched picture box; render the chart at the target slot aspect ratio or place it with contain/pad behavior
- treat chart aspect ratios as editorial choices:
  - wide landscape only for dense rankings, time series, or multi-series comparisons that genuinely need width
  - squarer or narrower compositions for sparse charts, dominant-leader rankings, and low-signal category share slides
- if one bar dominates and the rest are near zero, do not waste a full hero chart band on microscopic tails; switch to a commentary-led composition or a split layout
- if a chart would leave a giant dead frame, use a different slide grammar instead of scaling the weak chart larger
- positive labels must show `+` exactly once, negatives use `-`, and pp labels should render as forms like `+0.09pp` or `-1.2pp` with no doubled signs or mixed conventions

## PowerPoint / Keynote Compatibility

- do not use native PowerPoint chart objects for final deliverables when a chart can be rendered as an image
- generate charts as PNG assets in Python, sized for slide resolution, and insert them with `slide.shapes.add_picture(...)`
- reuse the same raster chart asset in both PPTX and PDF outputs
- do not rely on SVG, OLE objects, SmartArt, or embedded Office chart XML for critical visuals

## Restraint Rules

- no placeholder boxes
- no default 2000s PPT gradients or beveled effects
- no dense wall-of-text slides
- no more than one major message per slide
- no generic AI wording such as "key insights", "in conclusion", "overall performance overview"

## Title Rules

- titles must state the finding, not the topic
- keep titles short enough to read in one glance
- prefer numbers or directional language when supported by evidence
- subtitle is optional and should usually clarify period / scope / basis
