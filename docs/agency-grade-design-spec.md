# Agency-Grade Design Spec — Making Basquio Ship 10/10 Visual Quality

**Date:** 2026-04-17
**Author:** Claude (forensic deck audit + SOTA research + codebase mapping) — for another agent to implement
**Trigger:** Production 70-slide Opus 4.7 run `d580a4df`. The analysis is near 10. The output looks like **2010 PowerPoint**. Client template is for **colors + logo position only** — all design responsibility is Basquio's.
**Replaces / supersedes Section 3 of:** `docs/quality-first-architecture-spec.md` (the "fails visibly" path is removed — NO run should fail)

---

## 0. The Principle (Non-Negotiable)

1. **No run ever fails silently or visibly.** Every run ships an artifact the user can use. "Fails visibly" was wrong in the prior spec — removing it.
2. **Quality is not "lint passes after we ship trash."** Quality is the generation target. Lint is a backstop.
3. **Agency-level design means:** restraint, hierarchy, whitespace discipline, consistent grid, one palette used sparingly. Not "every chart has a different blue."
4. **Template ≠ design.** Client templates contribute 3 things only: **palette primary colors, logo asset + position, theme fonts**. The 200+ design decisions on every slide are Basquio's responsibility regardless of template.
5. **The deck is a MUSEUM, not a DASHBOARD.** Editorial pacing, breathing room, ONE hero per slide. Think Pentagram + The Economist, not Tableau.

---

## 1. Forensic Visual Audit — Production Run `d580a4df`

Every defect observed visually in the rendered PDF, mapped to the code that produces it.

### 1.1 CRITICAL — Every-Slide Defects (ship-blockers in a quality-first world)

**D1. Duplicate footer overlap on all 70 slides**

- Observed: "Confidential and proprietary © 2026 Nielsen Consumer LLC. All Rights Reserved" overlaps "Pringles Kellogg's | Riservato" at bottom-center of every slide
- Root cause: Claude renders a footer via `slide.addText(...)` at `y=7.12` (following the system-prompt example at `packages/workflows/src/system-prompt.ts:122`) AND the imported NIQ template master already has its own footer text
- PGTI (`packages/render-pptx/src/apply-template-branding.ts`) does not strip the template master's existing footer before injecting, and does not signal "footer exists" to Claude
- Fix surface: `apply-template-branding.ts` + `system-prompt.ts` — skip Claude footer when template master has footer; OR strip template footer and keep Claude's

**D2. Broken Unicode "MlnE" instead of "Mln€" on axis label (slide 6)**

- Observed: bubble chart x-axis reads `Valore MlnE` instead of `Valore Mln€`
- Root cause: `system-prompt.ts:850-865` defines `apply_currency_axis_formatter()` but Claude is shown this as an example and not REQUIRED to use it. When Claude writes its own `ax.set_xlabel("Valore Mln€")` directly in code execution, the `€` character is sometimes consumed by Python string escaping in the worker's JSON serialization of the code block
- Fix surface: system-prompt instruction — mandate the formatter for every currency axis; ensure code execution uses explicit UTF-8 + raw strings or `chr(8364)` for `€` when safety matters

**D3. Label overlap on bubble charts (slides 6, 17, 37)**

- Observed: "EXTRUDED" + "RECONSTITUTED POTATO CHIPS" overlap each other and overlap their bubbles; "VEGETABLE CHIPS" text overlaps its own bubble
- Root cause: `system-prompt.ts:1025-1058` shows scatter/BCG example with hardcoded `xytext=(6, 6)` offset — works for small scatter but fails for bubble charts with variable radius. No adaptive padding based on bubble size. Slot-archetypes.ts has no `bubble` chart type at all

### 1.2 MAJOR — Chart Quality Defects

**D4. Default matplotlib look on slide 3 (category overview)**

- Observed: saturated blue #1A6AFF + cyan #7ABBE0 two-bar chart, chart title inside plot area, unstyled axis labels, chart takes 60% of slide for 2 data points
- Root cause: `packages/workflows/src/system-prompt.ts:804-820` hardcodes palette in the matplotlib preamble. `ACCENT = '#1A6AFF'` is too saturated for print — looks like a plotly default
- Also: 2 data points should be **KPI tiles** (exec-summary archetype), not a bar chart — slot archetype rule missing
- Fix surface: palette desaturation + archetype routing rule (N ≤ 2 bars → KPI tiles, not chart)

**D5. Chart titles rendered inside plot area, no margin above**

- Observed across many chart slides: matplotlib titles set via `ax.set_title()` which places title INSIDE axes, creating cramped composition
- Root cause: few-shot examples use `ax.set_title("...")` directly. State-of-the-art (Datawrapper, Financial Times) places chart title ABOVE the axis as a text element, not as an `ax.set_title()`, with proper top padding
- Fix surface: system-prompt chart examples — replace `ax.set_title()` with `fig.text(0.02, 0.92, ...)` or with a separate PptxGenJS title above the image

**D6. Matplotlib fonts not matching deck typography**

- Observed: chart axis labels rendered in a default sans-serif that doesn't match the deck's Arial. Chart axis font looks slightly different (DejaVu Sans — the bundled font from `dejavu-fonts-ttf`) while slide body text is Arial
- Root cause: DejaVu Sans is the only font we bundle for the worker container (to fix the blank preview bug). Matplotlib charts render with DejaVu, but PptxGenJS text declares Arial. When opened in Keynote or PowerPoint with Arial installed, the contrast is visible
- Fix surface: either bundle Arial-metric-compatible fonts (Liberation Sans via `dejavu-fonts-ttf` extension) and set PptxGenJS fontFace to Liberation Sans, OR declare fontFace of ALL slide elements to match DejaVu Sans

**D7. Colors not adapting to client template**

- Observed: even with a NIQ template uploaded, charts still use Basquio's default `#1A6AFF` instead of any NIQ corporate blue
- Root cause: `apply-template-branding.ts` injects theme colors into PPTX after generation, but matplotlib chart PNGs are already rasterized with hardcoded Basquio colors. The "template-aware chart theme" example at `system-prompt.ts:1060-1090` is commented as a STRUCTURE example and Claude is never told to apply it when a template is uploaded
- Fix surface: pass `templateProfile.brandTokens.palette` to the author message as environment variables; Claude reads them in its matplotlib preamble

### 1.3 MAJOR — Layout Defects

**D8. Cards underfilled on slides 41 (Roadmap 2026), 42-45 (Recommendations), 51-53 (Scenarios)**

- Observed: 4-5 inch tall cards with content using only the top 60% — big empty dead space at bottom
- Root cause: `scene-graph/src/slot-archetypes.ts` defines `scenario-cards.body` with `h: 3.55` and `recommendation-cards.body` similar. Slot height is fixed but content is variable. No `valign: center` or content-aware height
- Fix surface: either (a) add `valign: center` to content, (b) auto-shrink card height to content, or (c) fill remaining space with a progress indicator / accent bar / supplementary evidence

**D9. Executive Summary is a wall of text**

- Observed: slide 2 has KPI tiles at top, then SITUAZIONE / COMPLICAZIONE / DOMANDA / RISPOSTA as one long paragraph block with zero visual hierarchy between the four parts
- Root cause: `system-prompt.ts:165-169` shows SCQA as `"\\n\\n"`-joined text in a single `addText()` call. No visual distinction of the four parts. No line breaks, no accent bars, no icon differentiation
- Fix surface: render SCQA as 4 separate text elements with distinct label strips, or use bold+color on the S/C/Q/R prefixes

**D10. Chart-slide monotony across 40+ slides**

- Observed: slides 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19 all look structurally identical: eyebrow top-left, title, chart left, text right. 40+ slides of the same layout = editorial boredom
- Root cause: layout-variety rule from yesterday's spec enforces ≥6 archetype types but Claude uses the same "chart-split" archetype 40+ times, just varying the chart type. Layout variety ≠ content variety
- Fix surface: force structural variety every 5 slides (full-bleed chart, split, centered, table-only, quote-driven, photo-driven if we get imagery)

### 1.4 MINOR — Typography + Spacing Defects

**D11. All titles ALL CAPS eyebrow + sentence-case headline**

- Consistent but monotonous — every slide's eyebrow reads exactly like the previous. Agency design varies eyebrow treatment by chapter (ultramarine CAPS for Cat 1, amber CAPS for Cat 2, etc.)

**D12. Source line vertical position drift**

- Some slides have source at `y=6.95`, some at `y=7.05`, creating inconsistent bottom baseline

**D13. Cover slide dead center**

- Slide 1: huge empty middle space between the title and the source metadata. Agency cover slides use the full canvas (imagery, generous negative space with intent, or metadata chip card). Our cover has NEITHER.

---

## 2. State-of-the-Art Research (SOTA April 2026)

### 2.1 Agency Design Systems — What "Good" Looks Like

Research sources: [Pentagram](https://www.pentagram.com/), [Pentagram × Mozilla Nothing Personal](https://www.itsnicethat.com/articles/mozilla-foundation-pentagram-graphic-design-project-131125), [Fontfabric 2026 Design Trends](https://www.fontfabric.com/blog/10-design-trends-shaping-the-visual-typographic-landscape-in-2026/), [Design Signal 2026 Trends](https://designsignal.ai/articles/design-systems-trends-2026).

**Core principles top agencies use in 2026:**

| Principle | What it means | How Basquio does today |
|---|---|---|
| **Grid over freeform** | Every element snaps to a 4- or 8-column grid | ❌ Freeform x,y coordinates |
| **Typographic behaviors** | Fonts respond to hierarchy, not one-size-fits-all | ❌ Single Arial everywhere |
| **Systemic restraint** | One accent color per context, muted primary | ❌ Bright #1A6AFF everywhere |
| **Carefully unpolished** | Slight imperfection signals authenticity | ❌ Over-polished PptxGenJS look |
| **Editorial pacing** | Full-bleed moments, quiet slides, dense slides balanced | ❌ Every slide same density |
| **Content-aware spacing** | Whitespace expands/shrinks based on content | ❌ Fixed slot heights |
| **Direct labeling over legends** | Labels attached to data, not keyed | ⚠️ Mixed — BCG chart does, others don't |
| **One hero per slide** | A single focal point drives the eye | ⚠️ Most slides OK, some broken (exec summary) |

### 2.2 Publication-Quality Matplotlib (Datawrapper, FT, The Economist standard)

Research: [Fonts in Matplotlib](https://matplotlib.org/stable/users/explain/text/fonts.html), [Publication-Quality Plots — Python4Astronomers](https://python4astronomers.github.io/plotting/publication.html), [Typography in graphs — Oxford Protein Informatics](https://www.blopig.com/blog/2017/09/typography-in-graphs/), [Datawrapper color keys](https://www.datawrapper.de/blog/color-keys-for-data-visualizations), [Matplotlib beautiful plots with style](https://www.futurile.net/2016/02/27/matplotlib-beautiful-plots-with-style/).

**The SOTA chart recipe (circa 2026):**

1. **Title OUTSIDE the plot**, placed as text above the axis, using figure-relative coordinates, not `ax.set_title()`
2. **Subtitle below title** explaining the unit, period, what the reader is looking at
3. **Axis labels minimal** — remove redundant axis labels when title already says it (e.g., don't label "Valore €M" if title is "Sales by segment, €M")
4. **Direct-label series** instead of using a legend; legend only when 4+ series and labels can't fit
5. **Remove top and right spines** (default matplotlib look has all 4 — signals "tool default")
6. **Gridlines are a light neutral grey** (#E5E7EB or similar), NEVER brand color
7. **Muted primary color for non-focal data**, accent color ONLY on the focal series
8. **Value labels on bars** rather than relying on axis ticks
9. **Consistent rounding** — e.g., always `%.1f` for percentages
10. **Source line is figure text** (bottom-left, 7-8pt muted)
11. **One sans-serif** throughout — no mixing fonts

### 2.3 The Anthropic Visual QA Pattern (Marco's Dream)

Claude 4.7 supports vision. We can render a slide to PNG, show it to a critic Claude call, get a scored rubric back **before** committing that slide to the final PPTX.

Cost: Haiku vision ~$0.01 per slide. For 70 slides = $0.70, well within budget.

**This is the missing piece.** Every defect in Section 1 could have been caught by a vision model scoring each slide against a visual rubric before it shipped. Today the only vision QA that runs is at the END of the whole deck (`visualQaAuthor` / `visualQaRevise`), which is too late to fix structural issues per slide.

### 2.4 Quality-First Flow (Updated — "No Fail" Path)

Replacing Section 3.2 of `quality-first-architecture-spec.md`. The classification is preserved but none of the paths is `failed`:

| Output class | Passport criteria | What the user receives |
|---|---|---|
| **gold** | Visual QA score ≥8.5, lint clean, MECE pass, drill-down coverage met | Delivered normally with no banner |
| **silver** | Visual QA 7.0–8.4, ≤3 major lint issues, MECE pass | Delivered with advisory ("minor polish pending") |
| **bronze** | Visual QA 5.0–6.9, OR 4+ major lint issues, OR MECE fail | Delivered immediately + auto-queued for a revise pass + Slack/email to operator with diff |
| **recovery** | Visual QA < 5.0 OR contract violation OR missing artifacts | **Deliver best-effort artifact** + auto-trigger a second, tightened attempt on the same brief in the background. User gets initial + notification when better version is ready |

No path is "fail." Every path ships something. The difference is the quality promise the email / UI makes.

---

## 3. The Spec — Agency-Grade Design System

### 3.1 LAYER A (Knowledge / Design Tokens) — Proprietary Design IP

#### 3.1.1 New: `basquio-design-system.md` Knowledge Pack (NEW)

Create a dedicated design-system knowledge pack that Claude loads alongside the NIQ playbook. Required sections:

**(a) The Grid**

12-column grid at 13.33" × 7.5":
- Outer margin: 0.45" all sides
- Column width: 1.04"
- Gutter: 0.08"
- Header band: y=0.0 to y=0.75 (cover and section dividers) / y=0.22 to y=1.10 (content)
- Body band: y=1.10 to y=6.70
- Footer band: y=6.85 to y=7.35

Every shape, text, and chart must snap to grid column boundaries.

**(b) The Color System (desaturated for print)**

Replace the current saturated palette with a print-safe editorial palette:

```
Ink         #0B0C0C   primary text
Slate       #334155   secondary text
Dim         #6B7280   tertiary / meta
Border      #D6D1C4   hairlines (warm beige)
Canvas      #F5F1E8   slide background
Surface     #FBF8F1   card background

Accent      #2E4AB8   (was #1A6AFF — desaturated 24%)   focal series
Positive    #3D9B7E   (was #4CC9A0 — desaturated 12%)   growth, green deltas
Negative    #C65766   (was #E8636F — desaturated 18%)   decline, red deltas
Highlight   #C69B14   (was #F0CC27 — desaturated 25%)   amber for attention
```

Every chart uses ACCENT only for the focal series; all other series in SLATE, DIM, or a 3-step grey ramp. Positive/Negative only when a delta is the point of the slide.

When a client template is uploaded, its primary color overrides ACCENT but the rest stays. The other four colors are Basquio's voice and do NOT change.

**(c) Typography hierarchy**

Single type family for the whole deck: Arial / Liberation Sans on the worker (DejaVu Sans as fallback for matplotlib).

| Element | Size (pt) | Weight | Color | Case |
|---|---|---|---|---|
| Cover title | 44–56 | 700 | Ink | Sentence case |
| Section divider number | 120+ | 100 (thin) | Accent | Numeral |
| Slide eyebrow | 9 | 700 letterSpacing 1.5 | Accent | ALL CAPS |
| Slide title | 20 | 700 | Ink | Sentence case |
| Slide subtitle | 13 | 400 | Slate | Sentence case |
| Body text | 11 | 400 | Slate | Sentence case |
| Micro-label / meta | 8 | 500 letterSpacing 1.2 | Dim | ALL CAPS |
| Callout | 10 | 600 | Ink on Accent 15% tint | Sentence case |
| KPI value | 24–28 | 700 | Ink | N/A |
| Table header | 9 | 700 | Ink on Canvas | ALL CAPS |
| Chart title | 12 | 700 | Ink | Sentence case |
| Chart axis | 9 | 400 | Dim | Sentence case |
| Chart data label | 9 | 500 | Ink | N/A |
| Source line | 8 | 400 italic | Dim | Sentence case |

No other sizes allowed. Period.

**(d) Spacing**

- Vertical rhythm: 4pt baseline grid → 0.056" — all vertical spacing is a multiple of this
- Card internal padding: 0.24" all sides
- Section break between content groups: 0.35"
- Minimum whitespace around a focal element: 0.45" on at least 2 sides

**(e) Chart styling contract** (hard rules, no prose interpretation)

```python
# Canonical matplotlib preamble — Claude MUST copy this verbatim at the top of every chart cell:
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# Colors come from env vars when a template is provided
import os
ACCENT    = os.environ.get('BASQUIO_ACCENT', '#2E4AB8')
POSITIVE  = os.environ.get('BASQUIO_POSITIVE', '#3D9B7E')
NEGATIVE  = os.environ.get('BASQUIO_NEGATIVE', '#C65766')
HIGHLIGHT = os.environ.get('BASQUIO_HIGHLIGHT', '#C69B14')
INK       = '#0B0C0C'
SLATE     = '#334155'
DIM       = '#6B7280'
BORDER    = '#D6D1C4'
CANVAS    = '#F5F1E8'

plt.rcParams.update({
    'figure.facecolor': CANVAS,
    'axes.facecolor': CANVAS,
    'text.color': INK,
    'axes.labelcolor': DIM,
    'axes.edgecolor': BORDER,
    'xtick.color': DIM,
    'ytick.color': DIM,
    'xtick.labelsize': 9,
    'ytick.labelsize': 9,
    'axes.labelsize': 9,
    'font.family': 'DejaVu Sans',
    'font.size': 10,
    'axes.spines.top': False,
    'axes.spines.right': False,
    'axes.grid': True,
    'grid.color': '#E6E0D5',
    'grid.linewidth': 0.5,
    'axes.axisbelow': True,
    'figure.dpi': 300,
    'savefig.dpi': 300,
    'savefig.bbox': 'tight',
    'savefig.facecolor': CANVAS,
})
```

Chart titles: never `ax.set_title()`. Always `fig.text(0.05, 0.95, "Title", ...)` with matching figure margin.

Direct-label series: the canonical `label_series_at_end()` helper must be used for all line charts with ≤6 series.

### 3.2 LAYER B (Validation) — Inline Visual Critic + Inline Structural Checks

#### 3.2.1 Per-Slide Vision Gate (Marco's "dream")

**What:** After Claude renders the PPTX for a slide, export that slide as a 1080-width PNG, call Haiku vision with a **visual rubric**, receive a score. If < threshold, the slide is placed on a "needs polish" list for the revise phase.

**Rubric for every slide** (machine-scored by Haiku vision):

```
VISUAL RUBRIC (score 0-10 per dimension):

COMPOSITION (weight 25):
  hierarchy       : one clear focal point, eye moves top-left → bottom-right
  balance         : no dead space > 25% of slide area
  grid alignment  : text and shapes line up on implied grid
  breathing room  : focal element has ≥0.45" margin on ≥2 sides

TYPOGRAPHY (weight 20):
  size hierarchy  : eyebrow < title < body, clear scale
  consistency     : same font face everywhere, no rogue typefaces
  case discipline : ALL CAPS used only for eyebrows and meta
  line length     : body lines 50-80 chars

COLOR (weight 15):
  palette match   : uses ≤4 distinct hues
  accent restraint: accent color on ≤1 focal element
  contrast        : body text >= 4.5:1 contrast vs background
  no default blue : no default-ish saturated primary

CHART QUALITY (weight 25, if chart present):
  readability     : all labels legible at 1080px width
  no overlap      : 0 label collisions, 0 axis-title collisions
  direct labeling : series labeled at end, or max 1 legend
  title above     : chart title is NOT inside plot area
  focal emphasis  : one series in accent, others muted

CONTENT QUALITY (weight 15):
  title is insight: full sentence, ≥1 number, not a label
  source present  : bottom-of-slide source line visible
  footer clean    : no overlapping footer text
  no duplicates   : no two elements in the same coordinate

OVERALL PASS: ≥8.5/10 and zero "collision" defects.
```

**Where:** runs AFTER each slide is committed to the working PPTX but BEFORE the next slide starts. Streaming architecture; see section 3.3.

**Cost:** Haiku vision ~$0.01 × 70 slides = $0.70. Neglibible vs $20 run cost.

#### 3.2.2 Structural Lint Gate (deterministic, zero-LLM)

The existing writing-linter + slide-plan-linter already covers most of this. Additions required:

- **Coordinate collision detector:** any two shapes with >0.5 overlap on the Z-axis within the same z-index flagged as `coord_collision`. Today we flag overlap at plan stage but not at render time
- **Footer uniqueness check:** exactly one text element allowed in the footer band `y > 6.85`
- **Axis-label unicode validator:** any axis label containing `MlnE`, `EuroM`, `EURM`, or other mangled unicode triggers `axis_label_unicode_corruption`
- **Underfill detector:** any card whose content uses <60% of its slot height flagged as `card_underfill`

All four additions are < 100 lines of code each in `packages/intelligence/src/`.

#### 3.2.3 Revised Publish Classifier (replaces Section 3.2 of prior spec)

| Lint | Visual QA | MECE | Publish class | User experience |
|---|---|---|---|---|
| 0 critical, ≤3 major | ≥8.5 | pass | **gold** | Normal delivery |
| 0 critical, ≤6 major | 7.0–8.4 | pass | **silver** | Normal delivery, "polish hints in speaker notes" |
| 0 critical, ≤10 major | 5.0–6.9 | advisory | **bronze** | Normal delivery + auto-queue improved revision; email says "refined version in ~20 min" |
| 1+ critical OR <5.0 OR MECE fail | — | — | **recovery** | Deliver current artifact + silent background re-run with tighter rubric + email says "v2 coming" |

**Every class ships.** No fail mode. Recovery just means the user gets a v2 later.

### 3.3 LAYER C (Prompt / Generation) — Streaming per-Slide Authoring with Visual Gate

#### 3.3.1 Architectural shift: batch → streaming

Today: Claude authors all 70 slides in one code-execution turn, saves the PPTX, we lint/QA the completed deck.

Move to: Claude authors in **batches of 5 slides**, after each batch:
1. Renders the batch to PDF/PNG via local LibreOffice headless OR our own matplotlib preview
2. Runs the inline visual QA rubric (Haiku vision call)
3. Runs the deterministic lint
4. If any slide scores <8.5 or has lint issues, fix before continuing to next batch

This is the "evaluator reflect-refine loop" from AWS 2026 Agentic patterns applied at slide granularity, not deck granularity.

**Cost impact:** +$0.70 for vision + roughly same Claude cost (inline fixing is cheaper than global revise). Total delta +3%.

**Time impact:** +3–5 minutes. Acceptable for agency-grade output.

#### 3.3.2 Author message updates

- **Mandatory matplotlib preamble:** every code-execution chart cell starts with the canonical preamble from section 3.1.5. System prompt states this as CODE TO COPY, not PROSE TO INTERPRET.
- **Template color env injection:** the worker sets `BASQUIO_ACCENT` / `BASQUIO_POSITIVE` / etc. environment variables BEFORE calling Claude's code execution, based on the uploaded template profile. Claude reads via `os.environ.get()`.
- **Slot dimensions in-context:** the author message includes the exact `figsize=(W, H)` tuple for each slide based on the archetype. No comments, no inference — explicit.
- **Footer rule:** exactly one `addText` in the footer band per slide. If a client template is imported, Claude is told whether the master already has a footer (strip-and-replace mode vs additive mode).
- **Card valign:** scenario-card / recommendation-card body shapes must use `valign: center` (if short content) OR Claude must pad with spacers to fill the slot.

#### 3.3.3 New few-shot examples

- **`perfect_chart_preamble`** — the canonical preamble, labeled "copy this verbatim"
- **`perfect_bubble_chart_adaptive_labels`** — shows `xytext=(radius * 1.5, radius * 1.5)` for bubble charts
- **`perfect_executive_summary_scqa`** — SCQA with 4 distinct visual zones, not wall of text
- **`perfect_cover_slide_editorial`** — cover with intentional use of full canvas
- **`perfect_section_divider_numeral`** — big chapter number + short hook, editorial pacing
- **`anti_example_cramped_default_chart`** — counter-example showing what NOT to do

### 3.4 LAYER D (Feedback Loop) — Visual Regression Fixtures

#### 3.4.1 Golden fixtures

Pick 5 canonical briefs (Kellanova/NIQ, petfood/Kantar, beauty/Circana, wine/IRI, FMCG/generic). Run each at 20 / 40 / 70 slides. Store the resulting slide PNGs as `fixtures/visual-regression/<brief>/<slide-count>/slide-<n>.png`.

Every PR that touches `apply-template-branding.ts`, `system-prompt.ts`, `slot-archetypes.ts`, or matplotlib preambles must re-render the fixtures and diff against the golden. Any visual regression > 2% pixels-different on any slide blocks the PR.

This is the "CI/CD eval gates" pattern applied to visual output. Prevents the "harden-commit regression" class of failure CLAUDE.md warns about.

#### 3.4.2 Analyst-edit diff pipeline

When Stefania/Silvia edit a Basquio deck and return it, a diff tool extracts every changed position/color/font/wording. That diff becomes new training data for the rubric and new examples for the system prompt.

Low priority for this sprint — but the pipeline should be designed knowing this is the direction.

---

## 4. The Defect → Code Map (Cheat Sheet for the Implementer)

| Defect ID | Observed in run d580a4df | Root cause file + lines | Fix surface |
|---|---|---|---|
| D1 | Duplicate footer on all 70 slides | `system-prompt.ts:122` + `apply-template-branding.ts:110-180` | Strip-or-skip footer coordination |
| D2 | "MlnE" broken unicode | `system-prompt.ts:850-865` | Mandate currency formatter usage |
| D3 | Bubble label overlap slides 6, 17, 37 | `system-prompt.ts:1025-1058` + `slot-archetypes.ts` (no bubble type) | Adaptive padding + new archetype |
| D4 | 2-bar default matplotlib chart slide 3 | `system-prompt.ts:804-820` hardcoded saturated blue + no archetype routing | Desaturate + "≤2 data points → KPI tiles" rule |
| D5 | Chart title inside plot area | All chart examples use `ax.set_title()` | Replace with `fig.text()` in examples |
| D6 | Font mismatch matplotlib vs PptxGenJS | `generate-deck.ts:7232` Resvg config + PptxGenJS default | Unify on DejaVu Sans OR bundle Liberation Sans |
| D7 | Template colors ignored by matplotlib | No env var injection in code execution setup | Inject `BASQUIO_ACCENT` env var from template profile |
| D8 | Underfilled cards slides 41, 42-45, 51-53 | `slot-archetypes.ts:363-403` fixed-height body | valign:center + spacer padding |
| D9 | Exec summary wall of text | `system-prompt.ts:165-169` single addText call | 4 separate zones with label strips |
| D10 | 40+ chart-split slides in a row | Layout-variety linter only counts archetypes, not structural pattern | Structural-variety linter + forced breaks |
| D11 | ALL CAPS eyebrow monotony | `system-prompt.ts` eyebrow examples all uppercase | Section-color variation in system prompt |
| D12 | Source y-coord drift | `system-prompt.ts` source line examples | Single constant SOURCE_Y = 6.95 |
| D13 | Cover slide dead center | Cover example lacks full-canvas treatment | New `perfect_cover_slide_editorial` example |

---

## 5. Implementation Waves (for the next agent)

### Wave 1 — Kill the visible ship-blockers (hours)

- **D1 Duplicate footer** — detect template-master footer; skip Claude footer if present (or strip template footer and keep Claude)
- **D2 Unicode corruption** — mandate `apply_currency_axis_formatter` usage
- **D7 Template colors** — inject env vars into code execution
- **D12 Source y-coord drift** — single SOURCE_Y constant

These are 1–3 line code changes each. Ship them first.

### Wave 2 — Chart quality + layout discipline (days)

- **D4-D6** — desaturate palette, move chart titles above plot area, bundle Liberation Sans
- **D8-D9** — card valign + SCQA visual zones
- **D3** — adaptive bubble label padding + new bubble archetype
- **D13** — editorial cover template

### Wave 3 — Streaming per-slide visual QA (week)

- Batch-of-5 author → render → vision-score → fix cycle
- Haiku vision critic with the visual rubric
- Deterministic structural collision / underfill / footer-uniqueness detectors
- Revised publish classifier (`gold`/`silver`/`bronze`/`recovery`, **no fail**)

### Wave 4 — Design system lockdown (weeks)

- Publish `basquio-design-system.md` knowledge pack
- Visual regression fixtures (5 briefs × 3 slide counts)
- CI gate that blocks PRs on >2% pixel diff against golden

---

## 6. What NOT To Do

- ❌ **Do not add a "failed" publish class** — every run ships
- ❌ **Do not make the client template the scapegoat** — template contributes 3 things (palette accent, logo position, fonts). Everything else is Basquio
- ❌ **Do not ask Claude to "design better"** in prose — design is a system with hard rules, not creative judgment
- ❌ **Do not run visual QA on the finished deck only** — it's too late, per-slide gating is the point
- ❌ **Do not bundle more fonts** — DejaVu Sans is the floor; add one Arial-metric-compatible family at most
- ❌ **Do not add a second author pass as the answer** — streaming-with-inline-critic is cheaper and better
- ❌ **Do not introduce "beautiful but wrong" chart defaults** — accuracy > style. Desaturate BUT keep readable
- ❌ **Do not overwrite client template primary color in chart code** — read env var, don't hardcode

---

## 7. Validation Contract

A post-implementation re-run of Fra's Kellanova brief (70 slides, Opus 4.7, same template) must demonstrate:

| Metric | d580a4df baseline | Target |
|---|---|---|
| Duplicate footers | 70/70 slides | 0/70 |
| Axis-label unicode corruption | ≥1 | 0 |
| Bubble label overlaps | 3 slides | 0 |
| Saturated #1A6AFF primary usage | All chart series | Focal series only |
| Card underfill (>40% dead space) | 15+ slides | ≤2 slides |
| Visual QA score (Haiku judge, average per slide) | Never measured | ≥8.5 |
| Per-slide visual QA run | No | Yes, every slide |
| Publish class | "reviewed" with 133 lint issues | `gold` or `silver` |
| Cost | $20.75 | $22–25 (+5–15%) |
| Time to deliver | 44 min | 45–55 min |

**Success = Stefania/Rossella look at the v2 deck and say "questo sembra Nielsen" instead of "sembra 2010 PowerPoint".**

---

## 8. Sources (SOTA 17.04.2026)

### Design Systems / Agency Standards
- [Pentagram — The world's largest independent design consultancy](https://www.pentagram.com/)
- [Pentagram × Mozilla Foundation "Nothing Personal"](https://www.itsnicethat.com/articles/mozilla-foundation-pentagram-graphic-design-project-131125) — 2025 editorial platform
- [Fontfabric: Top 10 Design & Typography Trends for 2026](https://www.fontfabric.com/blog/10-design-trends-shaping-the-visual-typographic-landscape-in-2026/)
- [Design System Trends 2026 — Design Signal](https://designsignal.ai/articles/design-systems-trends-2026)
- [Presented by Brandpad: how to systemise a brand, featuring Pentagram, How&How and Studio Blackburn](https://the-brandidentity.com/interview/presented-by-brandpad-how-to-systemise-a-brand-featuring-pentagram-how-how-and-studio-blackburn)

### Chart Design — Publication Quality
- [Fonts in Matplotlib — Matplotlib 3.10.8](https://matplotlib.org/stable/users/explain/text/fonts.html)
- [Publication-quality plots — Python4Astronomers](https://python4astronomers.github.io/plotting/publication.html)
- [Matplotlib: beautiful plots with style](https://www.futurile.net/2016/02/27/matplotlib-beautiful-plots-with-style/)
- [Typography in graphs — Oxford Protein Informatics Group](https://www.blopig.com/blog/2017/09/typography-in-graphs/)
- [Custom fonts in Matplotlib — Jonathan Soma](https://jonathansoma.com/lede/data-studio/matplotlib/changing-fonts-in-matplotlib/)

### Data Journalism / Editorial Chart Systems
- [Datawrapper color keys for data visualizations](https://www.datawrapper.de/blog/color-keys-for-data-visualizations)
- [Flourish — Datawrapper (Europa data guide)](https://data.europa.eu/apps/data-visualisation-guide/flourish)
- [Visualizing Data: Flourish templates (Google News Initiative)](https://newsinitiative.withgoogle.com/resources/trainings/data-journalism/flourish-data-visualization-templates/)
- [Visual Storytelling: Top Data Visualization Tools for Data Journalists](https://www.rigordatasolutions.com/post/visual-storytelling-top-data-visualization-tools-for-data-journalists)

### Agentic Quality Patterns
- [AWS Prescriptive Guidance — Evaluator reflect-refine loop patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/evaluator-reflect-refine-loop-patterns.html) — April 2026
- [Anthropic Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Anthropic Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

---

## 9. Handover Checklist

Before implementing, next agent must:
- [ ] Read this spec AND `docs/quality-first-architecture-spec.md` AND `docs/template-fidelity-and-depth-spec.md`
- [ ] Understand Section 0 principle #1: **no run ever fails**. The recovery class ships AND triggers a silent background rerun
- [ ] Open `/Users/marcodicesare/Desktop/fra-70-slide-opus47/deck.pptx` and visually verify every defect in Section 1
- [ ] Map each code fix to the defect ID in Section 4
- [ ] Wave 1 and Wave 2 can land in one PR if each defect has a regression fixture; otherwise split
- [ ] Wave 3 is a separate PR — architectural change requires its own validation window
- [ ] Follow CLAUDE.md: 3 pipeline commits max per day; each validated against 1 production run; never a "harden" commit that introduces regressions
- [ ] When done: re-run Fra's Kellanova brief at 70 slides, diff against `d580a4df`, send v2 to Stefania for blind comparison

Post-implementation: **NO run should ship worse than silver**. Bronze or recovery runs quietly improve themselves in the background. The user's mental model is "Basquio always ships good" — the system just works harder behind the scenes for the hard cases.
