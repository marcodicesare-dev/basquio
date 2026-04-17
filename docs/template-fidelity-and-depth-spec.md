# Template Fidelity + Deck-Depth Architecture Spec

**Date:** 2026-04-17
**Author:** Claude (forensic audit + SOTA research) — for another agent to implement
**Triggers:**
- Rossella: "Slide 4=5, 6=7, 16=17… poi ha deciso di mettere logo NIQ in alto a destra senza nessun tipo di senso" (Opus 4.7 60-slide Kellanova run, April 16)
- Veronica: "Allungando l'output ci sono slides che si ripetono"
- Power users now running 100-slide decks — redundancy and template fidelity are the two remaining blockers before consulting-grade output

**Runs referenced:**
- `babaeae1-4814-42be-9f35-8c7b015451ec` (Francesco EN, 60 slides, Opus 4.7)
- `cfd904b4-2b46-401d-960c-412513495ee7` (Francesco IT, 60 slides, Opus 4.7)

**Scope:** TWO problems at once. This spec is the brief for the next implementing agent. Do NOT implement here — research + plan only.

---

## 0. Architectural Framing (Read This First)

Both issues share the same root pattern: **the pipeline optimizes for LOCAL rules and loses GLOBAL fidelity.**

| Issue | Local rule that fires | Global truth ignored |
|---|---|---|
| Logo in top-right | "promote small logos to be visible" | "preserve the client's template intent" |
| Slide 4=5 redundancy | "use ≥6 layout types, 4-6 slides per chapter" | "each slide must carry a unique, non-overlapping insight" |

The implementing agent must think about each fix as **"make the global truth explicit and enforceable"**, not "add another heuristic on top."

**Defensibility layer mapping (from the intelligence-upgrade-spec):**
- Logo fix → Layer B (deterministic rendering contract)
- Redundancy fix → Layer A (knowledge packs) + Layer C (prompt) + Layer B (validation)

---

## 1. ISSUE #1 — Template Logo Pixel-Perfect Placement

### 1.1 Forensic Summary (Proven)

**File:** `packages/render-pptx/src/apply-template-branding.ts`, function `resolveVisibleLogoPosition()` lines 265-307.

**The bug, as code:**
```typescript
// Current logic
if (!needsPromotion) {
  return clampLogoToSlide(original, slideSize);  // respects template
}
// WHEN logo needs promotion (too small to be visible):
// hardcoded TOP-RIGHT regardless of original position
return clampLogoToSlide({
  x: slideSize.widthInches - marginX - width,   // ← always right edge
  y: marginY,                                    // ← always top
  w: width,
  h: height,
}, slideSize);
```

**Why NielsenIQ template triggers it:**
The NIQ master has a logo sized somewhere around 0.4-0.5" wide (typical corporate master). Basquio's `minVisibleWidth` threshold is `~0.6"`. Logo → `needsPromotion: true` → position discarded → hardcoded to top-right.

**What gets extracted correctly today:**
- `brandTokens.logo.imageBase64` — the actual logo bytes ✓
- `brandTokens.logo.position = { x, y, w, h }` — the original EMU→inch coordinates ✓
- Theme colors, fonts, decorative shapes, master background ✓

**What gets thrown away during injection:**
- Original `x, y` when size promotion triggers
- Anchor edge (left vs right, top vs bottom) the client intended

**Commit origin:** `4154f4a` (April 3, 2026) — PGTI initial implementation. The hardcoded top-right behavior has been there since day one and has never been revisited.

### 1.2 State of the Art Research (OOXML, April 2026)

Consulted: officeopenxml.com, python-pptx docs (v1.0 — the canonical Python PPTX library), VerdanaBold PowerPoint OOXML Training (January 2026 edition).

**The OOXML 3-layer hierarchy:**
```
┌──────────────────────────────────────────────────┐
│ slide1.xml (top layer — instance content)        │
│   overrides layout where explicitly set          │
├──────────────────────────────────────────────────┤
│ slideLayout{N}.xml (middle layer — layout design)│
│   overrides master where explicitly set          │
├──────────────────────────────────────────────────┤
│ slideMaster1.xml (bottom — defaults for all)     │
│   defines default shapes, placeholders, geometry │
└──────────────────────────────────────────────────┘
```

**Placeholder position inheritance (python-pptx canonical doc):**
> "Placeholders inherit their position and size from their layout placeholder… Position, size, and even geometry are inherited from the layout placeholder, which may in turn inherit from a master placeholder. This inheritance is overridden if the position and size of a placeholder are changed."

**Implication for logos:** In a proper corporate template, the logo is a `<p:pic>` or fixed shape on the **master** (not a placeholder). Its position is explicit on the master, applied to every slide that uses that master. **If you're overwriting that position, you're destroying the template designer's intent.**

**EMU coordinate system (OOXML spec):**
- 914,400 EMUs = 1 inch
- `<a:off x="..." y="..."/>` = position from slide origin (top-left)
- `<a:ext cx="..." cy="..."/>` = extent (width, height)
- Standard slide: 12,192,000 × 6,858,000 EMU = 13.33" × 7.5" (widescreen 16:9)

**Pixel-perfect fidelity contract (industry consensus):**
1. Read shape positions directly from the source XML (no heuristics)
2. Preserve the edge anchor (left-aligned, right-aligned, top, bottom)
3. Preserve the margin relative to that edge
4. Only resize when both width AND height are below a visibility floor
5. When resizing, keep the anchor — scale around the edge position, not the center
6. Never move a shape that was correctly extracted with a valid position

### 1.3 What Must Change (Design, Not Code)

**The core contract:** `resolveVisibleLogoPosition()` must respect the edge anchor at ALL sizes.

#### 1.3.1 Edge Anchor Detection

Add explicit edge classification based on the extracted position:

```
Given: original = { x, y, w, h } (inches), slide = { widthInches, heightInches }
Compute:
  distLeft   = original.x
  distRight  = slide.widthInches - (original.x + original.w)
  distTop    = original.y
  distBottom = slide.heightInches - (original.y + original.h)

Edge classification:
  horizontalAnchor = distLeft < distRight ? "left" : "right"
  verticalAnchor   = distTop  < distBottom ? "top"  : "bottom"
  marginHoriz = min(distLeft, distRight)
  marginVert  = min(distTop,  distBottom)
```

This gives the designer intent: which corner/edge the client placed the logo at.

#### 1.3.2 Promotion That Preserves Intent

When `needsPromotion === true`, do NOT hardcode top-right. Instead:

```
1. Keep horizontalAnchor and verticalAnchor from original
2. Scale width/height up to visibility minimum (aspect-preserving)
3. Re-anchor to the same edge:
   - If horizontalAnchor === "right": x = slide.widthInches - marginHoriz - newWidth
   - If horizontalAnchor === "left":  x = marginHoriz
   - If verticalAnchor === "bottom":  y = slide.heightInches - marginVert - newHeight
   - If verticalAnchor === "top":     y = marginVert
4. Clamp to slide bounds (existing clampLogoToSlide is fine)
```

This preserves the 4-corner intent and the relative margin.

#### 1.3.3 Trust the Extractor — Eliminate the "Heuristic Fallback" Path

Template-engine already validates the logo is near an edge before accepting (line 602-606 of `template-engine/src/index.ts`). **Once accepted, position should be authoritative.** The promotion logic should be:

- Promote size when too small for legibility
- Never override position anchor
- If extracted position is invalid for some reason, log a warning and skip injection entirely (better missing logo than wrong-placed logo)

#### 1.3.4 Multi-Master Support (Phase 2)

Canonical memo (line 223 of `.context/template-fidelity-architecture.md`) already acknowledges: "Phase 1 targets slideMaster1 only. Phase 2: detect which master Claude's layouts reference."

For NIQ-class templates that ship multiple masters (cover, content, divider, closing), the logo is often different on each:
- Cover master: large centered logo
- Content master: small corner logo
- Divider master: huge decorative logo

**Spec requirement (near-term):** Detect all `ppt/slideMasters/slideMaster*.xml` files, run the extractor on each, and inject the correct logo into each. Do not force a single logo into `slideMaster1.xml` when the template has multiple masters.

#### 1.3.5 Placeholder Respect (Not Injection)

Critical distinction: if the template already places the logo via a `<p:pic>` element on the master, Basquio's PGTI currently **adds a new `<p:pic>`** to the master spTree — potentially duplicating the logo.

**Spec requirement:** Before injecting, check if the master already contains a `<p:pic>` with a similar image signature (same base64 hash or same size+position). If yes, skip injection — the template already handles it.

### 1.4 Validation Contract for the Fix

A deck built on the NIQ template must satisfy ALL of:

| Check | How to verify |
|---|---|
| Logo present on every content slide | Parse generated PPTX, count `<p:pic>` referencing logo mediaId per slide |
| Logo position matches template (±5% tolerance) | Compare extracted `{x,y,w,h}` vs PGTI-injected position |
| No duplicate logos on same slide | Count unique logo positions per slide ≤ 1 |
| Logo size ≥ visibility minimum | Width AND height above legibility floor |
| Anchor edge preserved after promotion | Test with synthetic small logo on all 4 corners |

The validation suite should live under `tests/pgti-fidelity/` with one fixture per canonical corporate template (NIQ, Kantar-style, McKinsey-style, generic). **If a future PGTI change fails any fixture, the PR is blocked.**

### 1.5 What NOT to Do

- ❌ Don't add "if template looks like NIQ then do X" — per-client hardcoded paths are technical debt
- ❌ Don't use OCR to "find the logo" — the extractor already gives you EMU-precise coordinates
- ❌ Don't ask Claude to place the logo — PGTI is deterministic on purpose
- ❌ Don't remove the promotion entirely (0.2" logos ARE unreadable) — just preserve the anchor during promotion

### 1.6 Required Instrumentation

Add structured logs:
```
[PGTI] Logo extracted: edge={horizontalAnchor}-{verticalAnchor} margin={marginHoriz}x{marginVert} size={w}x{h}
[PGTI] Logo promoted: size {origW}x{origH} → {newW}x{newH}, anchor preserved: {horizontalAnchor}-{verticalAnchor}
[PGTI] Logo injected at ({x}, {y}) {w}x{h} in slideMaster1.xml
```

These become the breadcrumbs for debugging the next template mismatch without downloading the PPTX.

---

## 2. ISSUE #2 — Deck-Depth Redundancy at Long Formats

### 2.1 Forensic Summary (Proven)

**Files:**
- `packages/workflows/src/generate-deck.ts` lines 3299-3311 — depth tier instructions
- `packages/workflows/src/v2-orchestration.ts` lines 3187-3232 — post-hoc dedup (only post-planning, weak threshold)
- `packages/workflows/src/system-prompt.ts` line 3437 — layout variety rule
- `docs/domain-knowledge/basquio-recommendation-framework.md` line 59 — recommendation scaling (only tier that scales)
- `packages/intelligence/src/writing-linter.ts` — no rule for conceptual duplication

**The bug, as a structural pattern:**

At 60 slides, Claude receives this:
> "This is a Full-report deck. Deliver 4-6 slides per chapter, dedicated slides for cross-tab analyses, and cover the full NielsenIQ-style chapter set including appendix."

Plus:
> "LAYOUT VARIETY: use at least 6 different archetype layouts."

There is **zero prescription about what "deeper" means analytically**. Claude's rational response is:
1. Generate N insights from the data (e.g., 12-15 findings)
2. Stretch across 60 slides by VARYING THE VISUAL (bar → line → heatmap → table) while keeping the same underlying finding
3. Use 6 different archetypes as instructed
4. Each individual slide passes all linters (title has number, layout is approved, tone is client-friendly)

**Result:** Visually varied, analytically redundant. Slides 4 and 5 both state "-1.4pp share loss" — one as a bar chart, one as a line trend. Slides 6 and 7 both quantify Multipack growth. Slides 16 and 17 both argue Reconstituted decline.

**Why this is structural, not incidental:**
- The system has a **content-filling mindset** (generate N slides with M layouts) instead of a **content-planning mindset** (what UNIQUE sub-question does each slide answer?)
- No issue-tree / MECE enforcement at the slide-plan stage
- Deduplication fires AFTER planning with a weak threshold (0.4 Jaccard) on titles only
- Depth tier 41-70 is the ONLY tier that lost the "drill down individually" instruction that exists at tier 21-40 ("deep-dive each segment or competitor individually") and at tier 71-100 ("dimension-specific slides, retailer and SKU drill-downs")

### 2.2 State of the Art Research (Consulting Methodology, April 2026)

Consulted: Slideworks (McKinsey/BCG/Bain methodology), StrategyU, casebasix Issue Tree guides, Crafting Cases, firmsconsulting, MyConsultingOffer hypothesis tree guide.

**The MECE issue tree (McKinsey & BCG canonical):**

> "An issue tree is a structured problem-solving framework that breaks complex questions into smaller MECE-based components. **Mutually exclusive** means sub-issues don't overlap. **Collectively exhaustive** means sub-issues together cover all elements of the parent issue, leaving no gaps."

**Applied to deck planning:** Each slide is a leaf on the issue tree. Each slide answers exactly ONE distinct sub-question. Two slides cannot answer the same sub-question in different visual forms — that violates ME (mutual exclusivity).

**Hypothesis-driven approach (BCG/McKinsey):**

> "The hypothesis-led approach is the go-to method. Each node in the hypothesis tree is a testable claim. The analysis decomposes the parent hypothesis into child hypotheses that together cover it."

**Applied to deck planning:** A 60-slide deck is a hypothesis tree with ~60 leaf hypotheses. If two slides test the same hypothesis, one of them is redundant.

**Progressive disclosure vs broadening (consulting literature consensus):**

A deck gets LONGER by **drilling down one dimension per slide**, not by repeating the same finding across multiple layouts:

```
LEVEL 1 (exec summary):   "Category grows +5%, brand loses 1.4pp share"
LEVEL 2 (segment split):  "Share loss concentrated in Reconstituted segment (-2.1pp)"
LEVEL 3 (channel split):  "Reconstituted loss sharpest in Super (-2.8pp), flat in Discount"
LEVEL 4 (SKU split):      "Within Reconstituted Super: top 3 SKUs drive 70% of loss"
LEVEL 5 (driver):         "Those 3 SKUs: price index +8, distribution stable — pricing issue"
LEVEL 6 (lever):           "Price index reduction to 103 recovers 0.7pp, costs €2.1M margin"
```

Each level answers a UNIQUE question: "so what's driving THIS?" — that's genuine depth.

**Contrast with redundant stretching:**
```
SLIDE A: bar chart of share loss
SLIDE B: line chart of share loss (same data, different viz)   ← redundant
SLIDE C: table of share loss                                    ← redundant
SLIDE D: stacked area of share loss                              ← redundant
```

**The NielsenIQ category review standard (from Stefania's feedback):**
A proper 60-slide review contains specific decomposition dimensions:
- Segment × Channel (heatmap cross-tab)
- Segment × Format
- Segment × Flavour
- Format × Channel
- Brand × Channel
- Brand × SKU concentration (Pareto / top-10)
- Brand × Pack × Occasion (where data supports)
- Retailer-specific penetration
- Promo intensity × effectiveness decomposition
- Price ladder by brand
- Distribution vs velocity scatter

Each of those is a different analytical CUT, not a different chart of the same cut.

### 2.3 What Must Change (Design, Not Code)

The spec is: **force the planner to think in terms of UNIQUE leaf-hypotheses, not slide slots.**

This requires changes at all three moat layers.

#### 2.3.1 LAYER A — Knowledge Pack Addition: `basquio-deck-depth-architecture.md` (NEW)

A dedicated knowledge pack that defines what "deeper" means as slide count grows. Structure:

**A. The Issue Tree Mandate**

> Before generating slide plans for decks ≥ 20 slides, construct an analytical issue tree: one root question (the brief), 3-5 chapters (first-level decomposition), and a set of leaf hypotheses (one per planned slide). The set of leaves must be MECE — no two leaves can be answered by the same data cut.

**B. The Drill-Down Dimension Catalog**

For FMCG/NielsenIQ briefs, the catalog of valid drill-down dimensions:

| Dimension | What it decomposes | Valid at deck size |
|---|---|---|
| Segment (ECR2/ECR3) | Category total → segment performance | ≥10 |
| Channel | Segment total → per channel dynamics | ≥15 |
| Format (pack size) | Segment total → per format | ≥20 |
| Brand × Segment | Who is where | ≥20 |
| Brand × Channel | Cross-channel competitive map | ≥25 |
| Top-N SKUs | Brand total → SKU Pareto | ≥30 |
| Flavour | Category/brand → flavour decomposition | ≥30 |
| Promo intensity × effectiveness | Quantify wasted budget | ≥30 |
| Price ladder | Brand positioning within segment | ≥30 |
| Retailer-specific | If panel data supports — per insegna | ≥40 |
| Occasion / daypart | If CPS data supports | ≥50 |
| Sensitivity analysis | Per recommendation scenario | ≥50 |
| SKU-level contribution waterfall | Δ value by top N SKUs | ≥60 |
| Cohort / shopper segment | If CPS data supports | ≥70 |

A 60-slide deck MUST cover at least 10 of these dimensions. A 100-slide deck must cover 14+.

**C. The MECE Test for Slide Pairs**

For any pair of slides A and B in the plan, both of the following must be true for the plan to be valid:
1. **Mutual exclusivity**: the data cut of A ≠ data cut of B (different dimension, or same dimension at different level of decomposition)
2. **Collective contribution**: removing either A or B loses information the reader cannot reconstruct from the other

Test sentence: "If I had only slide A, would I know the content of slide B?"
- If yes → redundant, collapse
- If no → both kept

**D. Anti-Patterns (Banned)**

- Same finding shown as bar + line + table across 3 slides
- Same segment appearing on 2+ adjacent slides with only chart type differing
- "Chart A for CY, chart B for PY" when a grouped bar / waterfall would handle both in one slide
- "Category overview" followed by "market overview" followed by "category performance" — all describing the same data
- Filling appendix with slides that replicate body-slide content at different aggregation

**E. Progressive-Disclosure Required Patterns**

- Each chapter must go through at least 3 drill-down levels (Category → Segment → Brand OR Brand → Channel → SKU)
- Cross-tabs must be unique per pair (Segment × Channel heatmap appears ONCE, not twice)
- Decomposition chains must be explicit in slide titles ("Share loss concentrated in X" → "Within X, driven by Y" → "Y is a pricing problem, not distribution")

#### 2.3.2 LAYER A — Update: `basquio-recommendation-framework.md`

Already has depth-by-slide-count scaling. Update to require matching analytical depth:

> For every recommendation card, the evidence must draw from at least 2 distinct drill-down levels. A 60-slide deck with 7 recommendations must have ≥14 distinct analytical findings feeding them. If a recommendation cites only 1 finding, either strengthen the evidence or remove the recommendation.

#### 2.3.3 LAYER A — Update: `niq-analyst-playbook.md`

Existing Section 14 (FMCG Action Levers) is prescriptive for recommendations. Add a parallel Section 17: **Drill-Down Decomposition Cascade**:

> For any insight at segment level (e.g., "Reconstituted -4.2%"), the playbook requires going down at least 2 more levels before recommending an action:
>
> LEVEL 1: Segment performance (-4.2%)
> LEVEL 2: WHICH channel / format / brand drives the -4.2%?
> LEVEL 3: WHY is that driver under pressure? (price, distribution, assortment, velocity)
>
> Only after Level 3 is a recommendation credible. Skipping to recommendations from Level 1 produces generic advice the client already knows.

This gives Claude a methodological reason to DRILL instead of BROADEN.

#### 2.3.4 LAYER C — Prompt Update: Depth Tier 41-70

Replace current passive instruction:
> "This is a Full-report deck. Deliver 4-6 slides per chapter, dedicated slides for cross-tab analyses, and cover the full NielsenIQ-style chapter set including appendix."

With prescriptive, MECE-mandated language (to be written by implementer):
> "This is a Full-report NielsenIQ-grade deck. BEFORE generating any slide, plan an MECE issue tree: 4-6 chapters (root), each chapter with 4-6 leaf questions, each leaf a UNIQUE data cut. No two slides may answer the same question with different chart types — that violates mutual exclusivity. Cover at least 10 drill-down dimensions from the deck-depth knowledge pack catalog. Every segment finding must be decomposed to at least L3 (WHY). Verify plan before authoring: run the MECE test between every slide pair."

#### 2.3.5 LAYER C — New Few-Shot Example: "drill-down cascade"

System prompt currently has chart examples but no example of the 3-slide drill-down pattern at 60-slide scale. Add a named example showing:
- Slide N: Segment-level finding (bar chart, segment split)
- Slide N+1: Channel-level decomposition of the SAME finding (heatmap, segment × channel)
- Slide N+2: SKU-level decomposition of the channel driver (Pareto, top-10 SKUs)

And a counter-example labeled `bad_redundant_broadening` showing what NOT to do (same finding, 3 different charts).

#### 2.3.6 LAYER B — New Validation: Slide-Plan MECE Check

Add a phase BEFORE deck generation: a "slide plan review" that runs on the `slidePlan[]` inside `analysis_result.json`.

For each pair of planned slides, compute a **data-cut similarity score**:
- Same segment/brand/channel/format axis AND same aggregation level → high similarity (⚠️)
- Same axis but different level (e.g., both segment-level vs one segment + one SKU) → mid similarity (ok)
- Different axes entirely → low similarity (ok)

If any pair scores above threshold (e.g., 0.7), the plan is flagged and Claude is asked to replan before PPTX generation. This is the slide-plan equivalent of the existing writing-linter's deduplication check, but for CONCEPTUAL content, not title overlap.

Similarity signal can be derived from:
- `pageIntent` string
- `chartId` + `chart.dimension` fields
- The set of entities (brands, segments, channels) referenced in title + body

The check must be MECHANICAL (no LLM-as-judge for every pair — too expensive at 60 slides = 1,770 pairs). Use heuristics that compare the entity set and aggregation level on each side of the pair.

#### 2.3.7 LAYER B — New Validation: Drill-Down Coverage

At publish time, verify the deck covers at least N distinct drill-down dimensions:
- 20 slides: ≥4 dimensions
- 40 slides: ≥7 dimensions
- 60 slides: ≥10 dimensions
- 100 slides: ≥14 dimensions

Threshold failure → advisory on publish, surface to analyst as "consider deepening X/Y/Z".

### 2.4 Validation Contract for the Fix

A 60-slide deck must satisfy ALL of:

| Check | How to verify |
|---|---|
| No two slides with >0.7 data-cut similarity | Mechanical pair-wise check on slidePlan |
| ≥10 distinct drill-down dimensions | Classify each slide's primary dimension, count unique |
| Each chapter has ≥3 decomposition levels | Parse issue tree structure from plan |
| Each recommendation cites ≥2 distinct evidence slides | Count evidence anchors per recommendation card |
| Zero "same finding, different chart" violations | Writing-linter new rule on conceptual duplication |
| Appendix slides are strictly additive (not body-duplicates) | Entity overlap between appendix and body ≤ 50% |

### 2.5 What NOT to Do

- ❌ Don't ask Claude to "not be redundant" as a free-form instruction — it cannot self-check 60 slides without a mechanical contract
- ❌ Don't make the issue tree generated by a second LLM call — too expensive; must be part of the analysis turn
- ❌ Don't use pair-wise LLM judging — 1,770 pairs at 60 slides is prohibitive
- ❌ Don't weaken the layout variety rule — it's correct, just needs to be paired with the MECE rule so variety means different content, not same content differently
- ❌ Don't change Opus budget caps — deeper analysis happens in the existing author turn

### 2.6 Required Instrumentation

Add structured logs after the analysis turn:
```
[plan] deck size: 60 slides
[plan] chapters: 5 (Market / Segments / Brand / Channels / Recommendations)
[plan] drill-down dimensions covered: 11/10 minimum ✓
[plan] MECE check: 0 pairs above 0.7 similarity ✓
[plan] deepest chapter: "Brand" reaches L4 (Segment → Channel → SKU → Driver)
[plan] recommendations: 8 cards, avg evidence anchors per card: 2.4
```

---

## 3. Order of Operations (for the Implementer)

### 3.1 Sequencing

1. **Ship the logo fix first** — smaller blast radius, easier to validate, blocks client deliveries
2. **Then ship the depth fix** — larger change, needs fixture decks to validate
3. Both can be in the same PR if CI can run them together; split if not

### 3.2 Testing Plan

**For logo fix:**
- Synthetic test: generate 8 template fixtures with logo at each corner (4 corners × 2 sizes = 8) — verify PGTI preserves anchor
- Real fixture: use the exact NIQ template that triggered Rossella's complaint
- Regression: re-run Fra's Kellanova brief with upgraded PGTI, verify logo matches template

**For depth fix:**
- Re-run the same Kellanova brief at 60 slides on the upgraded pipeline
- Verify: zero "slide 4=5, 6=7, 16=17" pairs
- Verify: at least 10 distinct drill-down dimensions present
- Verify: each chapter reaches L3 or deeper
- Send back to Rossella for validation

### 3.3 Rollback Plan

- Logo fix: feature flag `PGTI_RESPECT_ANCHOR_ON_PROMOTION` defaulting true; if templates break, flip to false and fall back to hardcoded top-right (regression to current behavior)
- Depth fix: wrap MECE plan review in feature flag `DECK_PLAN_MECE_CHECK` defaulting true at 40+ slides only; disable if it causes excessive replans

### 3.4 Success Criteria (End-to-End)

Rossella/Stefania receive a new 60-slide Kellanova deck and report:
1. NIQ logo is in the SAME position it is in the master template (not top-right by default)
2. No "slide 4=5" or similar pairs — every slide answers a different question
3. Drill-down depth visible in at least one chapter reaching SKU/retailer level
4. Recommendations anchored to multi-level evidence

---

## 4. Research Sources (SOTA 17.04.2026)

### Template Fidelity
- [Office Open XML (OOXML) — Presentations — Slides](http://officeopenxml.com/prSlide.php) — canonical slide hierarchy reference
- [Office Open XML — Slide Layouts](http://officeopenxml.com/prSlideLayout.php) — master/layout/slide inheritance
- [python-pptx — Working with placeholders](https://python-pptx.readthedocs.io/en/latest/user/placeholders-using.html) — position inheritance reference
- [python-pptx — Understanding placeholders](https://python-pptx.readthedocs.io/en/latest/user/placeholders-understanding.html) — geometry inheritance
- [PowerPoint OOXML Training (2026 Edition)](https://www.verdanabold.com/post/powerpoint-ooxml-training) — January 2026 — XML editing of masters/themes
- [Microsoft Learn — Working with slide layouts](https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-slide-layouts) — OOXML Microsoft reference

### Deck Depth / MECE / Issue Tree
- [The BCG and McKinsey problem solving process](https://slideworks.io/resources/mckinsey-problem-solving-process) — Slideworks methodology
- [Issue Tree Guide with Examples and Templates for Consulting](https://www.casebasix.com/pages/issue-trees) — MECE issue tree structure
- [Using Decision Tree Consulting to Build MECE Hypotheses](https://firmsconsulting.com/build-hypotheses-mece-with-decision-tree/) — hypothesis tree methodology
- [Issue Trees — What Are They and How Do You Use Them?](https://strategyu.co/issue-tree/) — StrategyU canonical guide
- [Issue Trees: The Definitive Guide](https://www.craftingcases.com/issue-tree-guide/) — Crafting Cases comprehensive guide
- [Hypothesis-driven approach: the definitive guide](https://careerinconsulting.com/hypothesis/) — consulting hypothesis decomposition
- [Consulting Hypothesis Tree: Everything You Need to Know](https://www.myconsultingoffer.org/case-study-interview-prep/hypothesis-tree/) — hypothesis tree vs issue tree distinction
- [Full View™ — Measurement (NIQ)](https://nielseniq.com/global/en/insights/report/2025/full-view-measurement/) — NIQ's own measurement framework

---

## 5. Handover Checklist for Next Agent

Before starting implementation, next agent must:
- [ ] Read this spec end-to-end
- [ ] Read existing `docs/intelligence-upgrade-spec.md` (the 3-layer moat architecture)
- [ ] Read `memory/canonical-memory.md` (especially lines about template-fidelity contract)
- [ ] Read `.context/template-fidelity-architecture.md` (existing architecture doc)
- [ ] Read the two referenced production runs' manifests to see real data
- [ ] Confirm the fix plan matches the 3-layer moat (A/B/C) with the implementer
- [ ] Write fixtures for the template fidelity validation suite BEFORE touching PGTI code
- [ ] Follow CLAUDE.md's hard-won rules, especially:
  - No "harden" commits that introduce regressions
  - Max 3 pipeline commits per day
  - Each commit validated with 1 production run

After implementation:
- [ ] Validate with Rossella/Stefania on a new 60-slide run
- [ ] Update `memory/canonical-memory.md` with outcomes
- [ ] Add to `docs/intelligence-upgrade-spec.md` Appendix (production evidence, before/after metrics)
- [ ] Never introduce a feature flag that silently breaks existing behavior; always log the flag state
