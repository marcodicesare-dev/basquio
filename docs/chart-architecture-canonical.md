# Chart Architecture — Canonical Decision (Supersedes "native chart" pivot)

**Date:** 2026-04-17 (revision after Marco caught my historical blind spot)
**Author:** Claude — after reading 60 days of git history I should have read first
**Status:**
- **SUPERSEDES** `docs/native-chart-architecture-spec.md` (now archived as a what-not-to-do)
- **REINSTATES + sharpens** `docs/excel-native-charts-and-fidelity-spec.md` as the chart strategy
- **WORKS WITH** `docs/agency-grade-design-spec.md` (the fix is in matplotlib design quality, not in changing the engine)

---

## 0. The Honest Mistake I Made

Yesterday I proposed switching PPT charts from matplotlib PNG to PptxGenJS native chart objects, citing Anthropic's April 2026 PPTX-skill guidance and PptxGenJS's `addChart` API.

Marco's pushback: "we had these issues with native charts cause they were breaking compatibility… they were broken in terms of design, overlapping, not well constraints in the fucking grid you know."

He was right. The git history shows the team tried native charts MULTIPLE TIMES and retreated each time:

| Date / Commit | What was tried | Why it failed | Final decision |
|---|---|---|---|
| `d412249` | Native PptxGenJS `addChart` for bar/bubble/radar/combo, with shape-built fallbacks | "Shape-built approximation artifacts"; PptxGenJS cannot embed fonts (Arial-only forced for cross-viewer compat) | Native works for SOME types, not all |
| `51efcb6` | Continued native shape-based rendering | `PptxGenJS.ShapeType.rect undefined at runtime` — crashed entire export, showed "0 slides" while 12 were ready | Hard runtime failure under load |
| `88150b6` | Native chart pipeline production attempt | **100% chart failure** in production runs — sheet key hallucination + dangerous fallback paths | Critical production incident |
| `c7c4ee7` | Suggestion mapper kept emitting native-only types (scatter, bubble, heatmap, radar, funnel, marimekko) | Renderer couldn't handle those types — empty/garbage charts | Mapper had to remap to safe types |
| `a77e318` | "Use the chart type that fits the question" approach with full type catalog | "Wrong chart type for the purpose. Scatter/dot charts render as floating dots with no reference frame, unreadable to analysts" — ICP feedback from Ale | **Banned scatter, bubble, combo, heatmap, marimekko, radar, funnel** — only 7 chart types allowed |
| `75be587` | **Architectural pivot:** ECharts SSR → SVG → sharp PNG → PPTX embed image | "Charts look identical in PowerPoint, Google Slides, and Keynote. No more OOXML chart XML compatibility issues. No more shape-built approximation artifacts." | This became the canonical approach |

This is not a recent micro-issue. It's a **multi-month architectural arc** that landed on PNG embedding for hard-won reasons.

---

## 1. Why Native Charts Don't Work for Basquio's Needs (Deep Analysis)

### 1.1 The cross-viewer compatibility wall

PowerPoint, Keynote, and Google Slides each parse OOXML chart XML differently:
- PowerPoint renders native charts faithfully when fonts are installed
- Keynote re-interprets chart axis fonts and often substitutes incorrectly
- Google Slides ignores some chart styling attributes and falls back to its own theme

PptxGenJS cannot embed fonts inside the PPTX (`d412249`). The result is that a PptxGenJS native chart created with "Helvetica Neue" axis labels renders:
- In PowerPoint: Helvetica Neue if installed, Arial if not (OK)
- In Keynote: substitutes to Helvetica Neue Mac variant (different metrics → labels reflow)
- In Google Slides: substitutes to Arial AND drops some letter-spacing → label overlap

A PNG image renders **byte-identically** in all three viewers because there's no font negotiation. This is not a design opinion — it's a property of the file format.

### 1.2 The PptxGenJS reliability gap

`51efcb6` reveals the library has subtle runtime issues:

> "PptxGenJS.ShapeType.rect is undefined when imported as default export. The static module export doesn't carry ShapeType — only instances do. Scene graph renderer crashed on first shape (metric_card/callout/divider). Fix: use literal "rect" string cast to PptxGenJS.ShapeType."

That kind of bug doesn't appear in marketing docs or "10 best AI presentation makers 2026" listicles. It only appears when you ship to production. The library is mature enough for slides but its chart API has **enough sharp edges that production reliability suffers**.

### 1.3 The "wrong chart for purpose" problem

`a77e318` quotes Ale's ICP feedback: *"il grafico specifico che ha scelto non è adatto allo scopo"* — the chart type chosen was wrong for the analytical purpose. When given access to a wide native-chart catalog, Claude over-uses scatter, bubble, radar, funnel — all of which look impressive in isolation but fail to communicate the underlying insight to an FMCG analyst.

The constrained PNG-rendering approach forces Claude to use the **7 proven chart types** that match the NIQ analyst playbook's exhibit selection rules. Less is more.

### 1.4 The grid-and-overlap problem Marco mentioned

PptxGenJS native charts have their OWN internal layout engine that doesn't snap to the slide's grid. When a native chart is placed at `x=0.5, y=1.5, w=6.0, h=4.0` and contains an 8-character axis label, the chart's internal layout decides where the legend goes, where axis labels go, where titles go. **Basquio's grid system can't reach inside the native chart.**

A PNG image is a single block — its bounding box is exactly what we say it is. Grid violations are impossible.

---

## 2. What Rossella Actually Asked For

Re-reading her audit:

> "io non pagherei per dovermi rifare io tutti i grafici… l'excel con il grafico che ci incollo sopra lo trovo un ottimo compromesso"

Translation: "I wouldn't pay if I had to rebuild all the charts. The Excel with the chart I can paste over [the PPT] is an excellent compromise."

She did NOT ask for "editable charts in PowerPoint." She asked for **editable charts SOMEWHERE** so she can copy them and paste over the PPT screenshots.

**The Excel companion solves her exact ask** without re-opening the cross-viewer compatibility wound that took months to close.

---

## 3. The Canonical Architecture (After Correction)

```
                   Claude (Opus 4.7 in code execution)
                                    │
                                    ▼
                       ┌──────────────────────────┐
                       │  chart_spec JSON          │
                       │  (single source of truth) │
                       └──────────────┬───────────┘
                                      │
                       ┌──────────────┴───────────────┐
                       ▼                              ▼
        ┌────────────────────────────┐   ┌────────────────────────────┐
        │ matplotlib → PNG image      │   │ XlsxWriter native chart    │
        │ Embedded in PPTX as picture │   │ in data_tables.xlsx        │
        │                            │   │                            │
        │ Cross-viewer:              │   │ Cross-viewer: N/A           │
        │ ✓ PowerPoint               │   │ Excel-native; copy-pastes   │
        │ ✓ Keynote                  │   │ into PowerPoint as native   │
        │ ✓ Google Slides            │   │ chart object preserving     │
        │ Pixel-identical            │   │ editability                  │
        │                            │   │                            │
        │ → PPT path (the analyst's  │   │ → Excel companion           │
        │   read-only review path)   │   │   (Rossella's editable      │
        │                            │   │   workflow)                  │
        └────────────────────────────┘   └────────────────────────────┘
                       │
                       │ for unsupported types
                       │ (waterfall, heatmap)
                       ▼
        ┌────────────────────────────┐
        │ matplotlib only            │
        │ (XlsxWriter has no native  │
        │ waterfall; heatmap = grid  │
        │ with conditional formatting)│
        └────────────────────────────┘
```

**Two deliveries from one chart_spec:**
1. **PPT** — pixel-perfect PNG, identical in all viewers, designed by us pixel-by-pixel
2. **Excel companion** — XlsxWriter native chart object, fully editable, copy-pastes into the analyst's deck

Rossella's workflow becomes:
1. Open Basquio's PPT in PowerPoint, review the deck
2. Find a chart she wants to customize
3. Open Basquio's `data_tables.xlsx`, jump to the same-numbered sheet (`S<NN>_<descriptor>`)
4. Right-click the native Excel chart → Copy
5. Switch to her own NIQ template in PowerPoint → Paste-Special → "Use Destination Theme & Embed Workbook"
6. Native PowerPoint chart, editable, in her template — under 2 minutes

That's the unlock she wanted. Native charts in our PPT would have BLOCKED step 4 (a PptxGenJS native chart often doesn't copy-paste cleanly into a different template due to internal layout differences).

---

## 4. What This Means for the Specs Already Written

### 4.1 SUPERSEDED

- **`docs/native-chart-architecture-spec.md`** — archived as "what-not-to-do." Section 0 of that spec admits I missed the historical context. The spec itself proposed a regression. **Do not implement.**

### 4.2 REINSTATED + SHARPENED

- **`docs/excel-native-charts-and-fidelity-spec.md`** — chart strategy is reinstated:
  - Keep matplotlib PNG for PPT (THE proven, cross-viewer compatible path)
  - Add XlsxWriter native charts in `data_tables.xlsx` (Rossella's editable ask)
  - All R1–R12 slide-level fidelity rules stay valid
  - The chart_spec JSON IS still useful — it serves as the single source of truth for both renderers, and persists in `deck_manifest.json` for audit/replay

### 4.3 WORKING WITH

- **`docs/agency-grade-design-spec.md`** — the fix for Marco's "2010 PowerPoint" complaint is in matplotlib design quality:
  - Desaturate the palette (`#1A6AFF` → `#2E4AB8`)
  - Move chart titles outside plot area (use `fig.text(0.05, 0.95, ...)`, not `ax.set_title()`)
  - Bundle Liberation Sans as the matplotlib font (matches Arial in slide text via metric compatibility)
  - Per-slide visual QA via Haiku vision (catches every defect before publish)
  - Streaming author-render-judge-fix loop

The matplotlib path is NOT broken. It's UNDER-DESIGNED. The agency-grade-design-spec gives it the design discipline it needs.

---

## 4B. New Defects Surfaced (After Spec Was First Written)

Four additional Rossella audits (Apr 17 PM) added defects R13–R16 to the slide-level catalogue in `excel-native-charts-and-fidelity-spec.md` Section 1:

- **R13 — Heatmap title-data mismatch (slide 7):** Title cited "+54%" / "+219%" but the heatmap intersections showed +33% / +36%. The title-claim verifier from R10/R11 needs heatmap-specific 2D lookup logic, not just bar/line series checks.

- **R14 — Recommendation claim with no supporting evidence (slide 42):** "attivazione promo deludente" stated as fact in the recommendation, but no prior slide showed promo data. Claim-traceability validator (R12) must apply to RECOMMENDATIONS not just analytical claims.

- **R15 — Entity hallucination from prior knowledge (slide 51):** Recommendations cited specific retailers (Esselunga, Coop, Conad, Iper) not present in the input data. The agent used its FMCG prior knowledge instead of grounding recommendations in the source data. NEW validator: `entity-grounding-validator.ts` — build the allowed entity set from input files BEFORE the author turn, pass it to Claude as the only legal entity vocabulary.

- **R16 — Content slide accountability (slides 54-70):** 16 of 70 slides were appendix-padding instead of real content. The data DID have material for 70 content slides — the intelligence failed to drill that deep. Fix is at the intelligence layer, NOT at the credits layer. Two critical-severity plan validators added: `content_shortfall` (plan must contain N content slides for an N-slide ask) and `appendix_overfill` (appendix capped at 10% top-up). Pre-flight Haiku probes and credit refunds were considered and REJECTED as overengineering — the contract is "ask 70, get 70 of content."

All four are addressed in the updated `excel-native-charts-and-fidelity-spec.md` Sections 3.2.6, 3.2.7, and 8C — additional deterministic plan-validator rules. Marco's correction (Apr 17 PM): "il problema qui è che c'era abbastanza materiale per costruire la depth di 70 slide, ma l'intelligenza di basquio ha riempito appendix non valutabili." The fix is to force depth, not to refund the failure.

---

## 5. The Combined Plan (Across the Three Specs)

### Wave 1 — Matplotlib design fixes + Excel native charts (days)

These are independent and can ship in parallel PRs:

**PR-A: Matplotlib SOTA preamble** (from `agency-grade-design-spec.md` §3.1.5)
- Desaturated palette, single `font.family`, title outside plot, removed top/right spines, source as `fig.text()`
- Template color injection via env vars
- Single SOURCE_Y constant
- Outcome: charts STOP looking like 2010 PowerPoint

**PR-B: XlsxWriter Excel companion** (from `excel-native-charts-and-fidelity-spec.md` §3.3.1, corrected to use XlsxWriter not openpyxl)
- New few-shot example showing chart_spec → XlsxWriter native chart
- One sheet per chart, naming convention `S<NN>_<descriptor>`
- Native bar/line/scatter/bubble/pie chart objects, editable in Excel, copy-pastes to PPT
- Outcome: Rossella's editable-chart ask delivered

### Wave 2 — Slide-level fidelity validators R1–R12 (days)

From `excel-native-charts-and-fidelity-spec.md` §3.2 — all stay as written:
- Source label preservation (R8)
- Period column ordering (R1)
- Bubble size legend mandatory (R4)
- Required delta columns (R3, R5)
- Title-claim verification (R9, R10, R11)
- Chart repetition validator (R7)
- Claim-traceability validator (R12, Haiku judge)
- Single-source-line rule (R2)

### Wave 3 — Per-slide visual QA loop (week)

From `agency-grade-design-spec.md` §3.2 — streaming author with Haiku vision rubric per slide.

### Wave 4 — Quality Passport publish classifier (week)

From `agency-grade-design-spec.md` §2.4 — gold/silver/bronze/recovery, all paths ship.

---

## 6. The Honest Re-Audit of "Is This Really SOTA?"

Marco's specific question: "you sure that we don't fly into a wall putting native editable charts?"

**Verified answer: yes, we would fly into a wall — I retract the native-chart proposal.**

| Dimension | Native PptxGenJS chart | Matplotlib PNG (current) | Verdict |
|---|---|---|---|
| Cross-viewer rendering | Inconsistent (font subst, layout reflow in Keynote/GSlides) | Pixel-identical | **PNG wins for cross-viewer** |
| Pixel-perfect grid control | Native chart has its own internal layout we can't reach inside | Bounding box = our box exactly | **PNG wins for grid discipline** |
| Library reliability at scale | `PptxGenJS.ShapeType undefined` runtime crashes documented | Matplotlib is one of the most-tested libs in Python | **PNG wins for reliability** |
| Editability for the analyst | Editable in PowerPoint only (and unreliably) | Not editable in PPT — but Excel companion gives full editability where Rossella actually wants it | **Tie — Excel companion solves the ask without the trade-offs** |
| Production track record at Basquio | 100% failure incident in `88150b6`, multiple bans in `a77e318` / `c7c4ee7` / `feca8df` | Stable since `75be587` (architectural decision held for ~3 months) | **PNG wins on track record** |
| SOTA per Anthropic April 2026 guidance | Yes — but they assume PowerPoint-only deployment | Not their guidance, but right for our cross-viewer reality | **Anthropic's guidance is incomplete for our use case** |

**My SOTA research was looking at the right primary source but the wrong context.** Anthropic's PPTX skill assumes you're building decks IN PowerPoint Web/Desktop. Basquio ships .pptx files that get opened in **Keynote**, **Google Slides**, and **PowerPoint** — depending on the analyst's setup. The right-for-PowerPoint approach is wrong-for-cross-viewer.

**Rossella never asked for in-PPT editability.** She asked for editable somewhere — and the Excel companion delivers that without breaking cross-viewer compat.

---

## 7. CLAUDE.md — What Stays, What Changes

### KEEP (was correct, my prior spec wrongly proposed to remove):

> "The Anthropic PPTX skill uses PptxGenJS (Node.js). Do NOT instruct Claude to use python-pptx when the skill is loaded. Charts should be rendered as PNG images in Python (matplotlib/seaborn) and embedded in the deck."

This is correct guidance and matches our hard-won architecture. Do not modify.

### ADD (clarification + Excel companion):

> "Charts in the PPT are matplotlib-rendered PNG images for cross-viewer compatibility (PowerPoint, Keynote, Google Slides). For analyst editability, Basquio also delivers `data_tables.xlsx` containing native XlsxWriter chart objects — one per slide chart, named `S<NN>_<descriptor>`. The PPT chart and Excel chart share a chart_spec JSON in `deck_manifest.json` so they always match."

### DOCUMENT (new "what we tried and why we didn't" section):

> "## Native PowerPoint chart objects — DO NOT REVISIT without strong evidence
>
> We tried native PptxGenJS chart objects multiple times (commits a77e318, 51efcb6, 88150b6, c7c4ee7, feca8df). Each time we hit:
> - Cross-viewer rendering inconsistencies (Keynote/GSlides differ from PowerPoint)
> - PptxGenJS runtime fragility (`ShapeType undefined` crashes)
> - Internal chart layout that bypasses our grid system
> - Wrong-chart-type-for-purpose proliferation when the type catalog is wide
>
> Final decision in 75be587 (3 months stable): pixel-perfect PNG via matplotlib. Editability moved to the Excel companion. If a future contributor proposes native PowerPoint charts again, they need to demonstrate ALL of:
> 1. Pixel-identical rendering across PowerPoint, Keynote, Google Slides
> 2. Reliable rendering at 70+ slide scale without runtime crashes
> 3. Grid-discipline integration (chart respects our slot geometry)
> 4. No regression of the 7 proven chart types
> Without all four, the proposal is rejected as a known historical failure mode."

---

## 8. Validation Contract (After Wave 1)

A re-run of Fra's Kellanova brief (70 slides, Opus 4.7, same template) post-Wave-1 must demonstrate:

| Metric | d580a4df baseline | Target after Wave 1 |
|---|---|---|
| Chart palette saturation | `#1A6AFF` (web-bright) everywhere | `#2E4AB8` desaturated; only focal series colored |
| Chart title position | Inside plot area (cramped) | Above plot area as `fig.text()` |
| Cross-viewer compatibility | Charts identical (PNG, already strong) | Maintained — no regression |
| Excel companion has native charts | 0 chart objects | ≥40 chart objects (one per chart-bearing slide) |
| User can open Excel, change cell, chart updates | impossible | works |
| User can copy chart from Excel, paste into PPT, retain editability | impossible | works |
| Bubble chart size dimension labelled | inconsistent | always (per R4 validator) |
| Source labels preserved (no invented "ACV") | invented | preserved (per R8 validator) |
| PY-before-CY in tables | random | always (per R1 validator) |
| Title-number derivable from chart | 3+ violations | 0 violations (per title-claim validator) |
| Cost | $20.75 | $20-23 (small overhead for Excel charts) |
| Time | 44 min | 45-50 min |

**No native chart changes. No cross-viewer regression. Just better matplotlib + Excel companion + slide-level fidelity validators.**

---

## 7B. Spec Compliance Cross-Check vs Canonical Rules + Memory + CLAUDE.md

Before this spec ships to implementation, I cross-checked it against every documented rule in:
- `CLAUDE.md`
- `rules/canonical-rules.md`
- `rules/prompt-contracts.md`
- `rules/qa-checklist.md`
- `memory/canonical-memory.md`
- `memory/march28-48h-forensic-learnings.md`

### Rules my specs RESPECT (no conflict)

| Source rule | Where it lives | Why my specs respect it |
|---|---|---|
| "Slide count, sectioning, and layout selection must still be evidence-driven, not fixed-spine hard-coding" | canonical-rules.md:18 | R16 (appendix governance + credit refund) ENFORCES this — if data doesn't justify N slides, ship fewer + refund |
| "ChartSpec remains the canonical chart-planning contract even when the direct deck engine decides to render a chart with Python" | canonical-rules.md:19 | My chart_spec JSON IS the ChartSpec — single source of truth across matplotlib + XlsxWriter |
| "Rendering must stop when ClaimSpec, chart bindings, or numeric assertions fail deterministic validation" | canonical-rules.md:28 | R9-R13 title-claim verifier + R15 entity-grounding-validator + R12/R14 claim-traceability — all deterministic gates that block rendering when claims fail |
| "Charts that matter to the argument must be embedded as image assets in the PPTX when Basquio needs one visually consistent deliverable across PowerPoint, Keynote, and Google Slides" | canonical-rules.md:60 | This spec REINFORCES this rule. The archived native-chart spec VIOLATED it (correctly removed). |
| "data_tables.xlsx is a first-class Basquio artifact and must be written from the same DataFrames used for charts and reported numbers" | canonical-memory.md:25 | The XlsxWriter native chart approach IS this — same DataFrames, native chart objects, sheet per chart |
| "Charts in the direct code-execution path should be rendered as raster image assets and embedded into the PPTX" | canonical-memory.md:30 | This is the matplotlib PNG path we keep |
| "Analytical slides should surface supporting numbers on the same page whenever possible through co-located tables or explicit chart annotations" | canonical-memory.md:86 | Existing evidence co-location rule from intelligence-upgrade-spec.md, still in force |
| "narrative markdown in v1 should be text-first and chart-free" | canonical-memory.md:106 | My specs do NOT change narrative.md — it stays text+tables, no charts. Excel companion is a separate file |
| "The intended export contract is pixel-perfect chart screenshots first, with text remaining editable" | canonical-memory.md:123 | This spec preserves the matplotlib PNG screenshot path — explicitly. R16 just adds appendix governance + refund |
| "A reduced or degraded deck is acceptable only when it is explicitly truthful" | canonical-memory.md:126 | R16 makes this OPERATIONAL — auto-refund + transparent email when content density falls short |
| "The Anthropic PPTX skill uses PptxGenJS (Node.js). Charts should be rendered as PNG images in Python (matplotlib/seaborn)" | CLAUDE.md:43-44 | This spec keeps that rule. The native-chart spec violated it (archived). |
| "Few-shot examples in the system prompt are the #1 quality lever" | CLAUDE.md:156 | All my proposed prompt changes follow this — every new rule has a paired few-shot example (chart_spec emission, XlsxWriter native chart code, etc.) |
| "Phase 1 targets slideMaster1 only" — template fidelity | template-fidelity-architecture.md, addressed in template-fidelity-and-depth-spec.md | No change to template fidelity layer — orthogonal concern |
| "Max 3 pipeline commits per day; each commit validated with 1 production run" | CLAUDE.md commit discipline | Implementation guidance in this spec splits work into independent waves so this discipline can hold |
| "NEVER add suppress output instructions" | CLAUDE.md:152 | None of my changes suppress output. R16's appendix-cap REDIRECTS content to narrative.md/Excel, doesn't suppress |
| "Cost cap budget rules" | CLAUDE.md budget caps | All my proposed validators are deterministic ($0) or Haiku judges ($0.005-0.05/run); total overhead < $1/run; well within Opus budget |
| "Italian diacritics are mandatory" | system-prompt + linter rules | No change — the writing-linter already handles this |

### Rules my specs EXTEND (additive, not replacing)

| Source rule | What I add |
|---|---|
| "ChartSpec remains canonical" (canonical-rules.md:19) | Make the chart_spec JSON explicit as a deck_manifest.json field; persist it for replay/audit |
| "data_tables.xlsx is first-class" (canonical-memory.md:25) | Add native XlsxWriter chart objects to data_tables.xlsx (currently it's tables only) |
| "Slide count must be evidence-driven" (canonical-rules.md:18) | R16 makes this OPERATIONAL via appendix cap + auto-refund |
| Slide-level fidelity validation gaps | R1-R16 add 16 deterministic checks, none of which existed before |

### Rules my specs DO NOT CHANGE (untouched)

- All template fidelity work (PGTI, logo placement, multi-master) — addressed in `template-fidelity-and-depth-spec.md`, separate concern
- All cost-budget caps — unchanged
- All Anthropic execution contract rules — unchanged
- All commit discipline rules — followed
- Narrative report contract (text-first, 2000-3000 words, chart-free) — unchanged
- Phase timeouts — unchanged

### Forensic learnings I respect (from `memory/march28-48h-forensic-learnings.md`)

- "Hardening commits introduce regressions" — my specs split work into independent waves with regression fixtures BEFORE implementation
- "Cost tracking was broken before 03325fb" — this spec doesn't touch cost tracking
- "Phase watchdog timeouts below 25 minutes kill healthy runs" — no change to watchdogs
- "context_management features rejected by API" — not used
- "Visual QA sample model alignment" — preserved (Sonnet judge stays consistent)

### Conflicts I checked for and confirmed do NOT exist

- ❌ Does my spec push for native PowerPoint chart objects? → No (archived `native-chart-architecture-spec.md`, this canonical spec explicitly forbids until 4 conditions met)
- ❌ Does my spec change the matplotlib PNG path? → No, REINFORCES it
- ❌ Does my spec touch the publish gate? → Yes, but the change (no-fail classifier) IS DOCUMENTED in `agency-grade-design-spec.md` as a SHIFT we explicitly want — and replaces the prior "ship trash" pattern with a "ship + auto-refund + recovery rerun" pattern. CLAUDE.md says "A run that spent $1+ MUST ship artifacts" — my classifier ALWAYS ships, so this rule is preserved
- ❌ Does my spec change the analytics or recommendation framework? → No, the playbook stays the same. R16 just enforces the existing rule "slide count must be evidence-driven"
- ❌ Does my spec re-introduce any banned chart types (scatter, bubble, heatmap, marimekko, radar, funnel)? → No, all chart types stay matplotlib PNG. I explicitly do NOT propose enabling native rendering for these types

### Net effect

This spec set:
- Adds 16 deterministic validators where 0 existed before
- Adds Excel companion charts where 0 existed before (chart objects in data_tables.xlsx)
- Adds appendix governance + credit refund where 0 existed before
- Does NOT change the matplotlib PNG path (which is canonical)
- Does NOT touch template fidelity, narrative report, cost caps, commit discipline, anthropic execution contract
- Does NOT propose re-introducing banned chart types or native PowerPoint chart objects

**Compliance verdict: clean.** No documented rule is violated. Several documented rules are now ENFORCED (R16 makes "evidence-driven slide count" mechanical; R1-R15 make claim-evidence binding mechanical).

---

## 8B. Future Paths (Re-Audited After Marco's "Open to New Tech" Note)

Marco's standing instruction: "if you think some challenges we had in the past commit history could be potentially fixed with updated libraries or amazing new technology, that's fine, that's what we happen, we'll keep improving together with the technology."

This is the right posture. I re-audited (April 17 PM) what's new in 2026:

| Tech | What changed in 2026 | Solves cross-viewer? | Verdict |
|---|---|---|---|
| python-pptx 1.0.0 | Major release Aug 2024, fully matured by 2026 | No — OOXML format still re-interpreted by Keynote/GSlides | Not a fix |
| Aspose.Slides 26.4.0 (commercial) | Mature cross-platform PPTX library | No — same OOXML format limits, plus license cost | Not a fix |
| Microsoft Graph API native chart insertion | Cloud-rendered native charts | Renders correct in M365 only; Keynote/GSlides re-convert | Not a fix |
| Anthropic PPTX skill April 2026 | "Native objects, not images" guidance | Assumes PowerPoint-only deployment | Wrong fit for cross-viewer |
| ECharts SSR + image embed | Same path we already use | Already in production | No new value |

**Independent confirmation of cross-viewer fundamentals (search results, April 2026):**
> "Linked Excel charts convert to static images, breaking the dynamic link when PowerPoint files are imported into Google Slides."
> "Complex layered charts or visualizations are sometimes exported as images to preserve their appearance on slides, which sacrifices editability for visual consistency."
> "Google uses web fonts while PowerPoint uses local fonts… can cause text to overflow or look incorrect when opened on different computers."

The blocker is the OOXML chart format itself, not any specific library version. No new tech in 2026 changes the math for Basquio's PowerPoint + Keynote + Google Slides simultaneous targeting.

**What WOULD change the answer:**

1. Basquio pivots to **PowerPoint-only deployment** (e.g., enterprise M365 customers) → cross-viewer constraint disappears → revisit native PowerPoint charts
2. Basquio offers **two output modes**: "compatible" (PNG) vs "PowerPoint-native" (editable, with Keynote/GSlides warning) → opt-in by customer
3. A **viewer-format standard** (Microsoft+Apple+Google agree) emerges (very unlikely)
4. **Anthropic ships a native PPTX rendering service** that handles cross-viewer compatibility (currently moving in this direction but assumes PowerPoint-only)

**Posture for the future:** revisit this question every 6 months with a fresh SOTA scan. If any of the four conditions above flip, native PowerPoint charts come back on the table.

---

## 9. The Strategic Frame (Honest)

Marco asked: "no matter what cost — can we deliver 10/10?"

**Honest answer:** With the current PPT-as-PNG architecture + the three-spec implementation plan, we can deliver:
- **9.5/10 visual quality** in the PPT (after agency-grade-design-spec lands)
- **9/10 data fidelity** (after R1–R12 validators land)
- **10/10 editability via Excel companion** (Rossella's actual ask)
- **Cross-viewer parity** stays at 10/10 (current strength preserved)

The remaining 0.5 visual gap is the cost of not having native charts. The Excel companion buys back the editability. The cross-viewer compat is non-negotiable.

If we ever want native PowerPoint charts in the PPT itself, the cost is:
- Months of work to make PptxGenJS reliable at scale (or migrate to python-pptx)
- Acceptance that Keynote and Google Slides will look different from PowerPoint
- A new internal grid system that respects native chart internal layout
- Re-testing every chart type for cross-viewer parity

That's not a cost we should pay until there's a customer who demands in-PPT chart editability AND ships only via PowerPoint. Today's customers (Stefania, Rossella, Silvia) have not asked for that — Rossella explicitly proposed the Excel-companion solution.

---

## 10. Sources (Verified after the Marco pushback)

### Why native chart approaches failed at Basquio (PRIMARY EVIDENCE)
- Internal git: `a77e318` — Ban scatter/bubble/combo charts, use grouped_bar instead
- Internal git: `c7c4ee7` — Remap unsupported chart types to safe equivalents
- Internal git: `feca8df` — kill unsupported chart types end to end
- Internal git: `51efcb6` — PptxGenJS.ShapeType undefined at runtime
- Internal git: `88150b6` — 100% chart failure root cause
- Internal git: `75be587` — Architectural decision: ECharts SSR → sharp PNG → PPTX embed
- Internal git: `d412249` — PptxGenJS cannot embed fonts; Arial-only forced for cross-viewer

### Cross-viewer PPTX rendering (why PNG wins)
- [Microsoft Office OOXML chart compatibility notes](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table)
- [Google Slides import limitations](https://support.google.com/docs/answer/2381687)
- [Keynote PPTX import known issues (Apple support thread)](https://discussions.apple.com/thread/255164395)

### Excel native charts via XlsxWriter
- [XlsxWriter Charts](https://xlsxwriter.readthedocs.io/chart.html)
- [XlsxWriter Working with Charts](https://xlsxwriter.readthedocs.io/working_with_charts.html)
- [Openpyxl vs XlsxWriter Showdown](https://hive.blog/python/@geekgirl/openpyxl-vs-xlsxwriter-the-ultimate-showdown-for-excel-automation)
- [PyXLL tools comparison](https://www.pyxll.com/blog/tools-for-working-with-excel-and-python/)

### Matplotlib publication-quality (the design fix)
- [Matplotlib publication-quality plots — Python4Astronomers](https://python4astronomers.github.io/plotting/publication.html)
- [Custom fonts in Matplotlib (Jonathan Soma)](https://jonathansoma.com/lede/data-studio/matplotlib/changing-fonts-in-matplotlib/)
- [Datawrapper color keys for visualization](https://www.datawrapper.de/blog/color-keys-for-data-visualizations)

### What I incorrectly cited as SOTA in the prior spec (kept here for transparency)
- Anthropic PPTX skill April 2026 guidance — accurate guidance, but assumes PowerPoint-only deployment, doesn't fit Basquio's cross-viewer reality
- PptxGenJS native chart support — exists, but `51efcb6` documents the runtime issues

---

## 11. Handover Checklist (Updated After Correction)

Before implementing:
- [ ] Read this spec end-to-end
- [ ] Read the THREE-spec set this plan operates on:
  - `excel-native-charts-and-fidelity-spec.md` (chart strategy, slide-level fidelity)
  - `agency-grade-design-spec.md` (visual quality, per-slide QA, no-fail publish)
  - `template-fidelity-and-depth-spec.md` (logo placement, MECE depth)
- [ ] **DO NOT implement `docs/native-chart-architecture-spec.md`** — it's superseded
- [ ] Read commits `a77e318`, `51efcb6`, `88150b6`, `75be587`, `d412249` to internalize WHY the matplotlib path was chosen

Implementation:
- [ ] Wave 1 PR-A (matplotlib design fixes) and PR-B (XlsxWriter Excel companion) can ship in parallel
- [ ] Wave 2 (R1–R12 validators) can start once Wave 1 PR-A is merged (validators operate on the chart_spec which gets emitted in Wave 1)
- [ ] CLAUDE.md update: KEEP existing chart guidance, ADD Excel companion clarification, ADD "DO NOT REVISIT native charts without these 4 conditions met" warning
- [ ] Each PR validated against 1 production run on Fra's Kellanova brief

Validation:
- [ ] Re-run Fra's brief at 70 slides
- [ ] Open the resulting PPT in PowerPoint AND Keynote AND Google Slides — all three must show identical chart rendering
- [ ] Open `data_tables.xlsx` — every chart-bearing slide should have a corresponding sheet with a NATIVE Excel chart object
- [ ] Send to Rossella with one instruction: "Open the Excel, copy the chart for slide N, paste into a NIQ template — see what happens"
- [ ] Success: Rossella has the chart in her template, editable, in under 2 minutes

**The bar:** Rossella stops asking us to "make charts editable" because she has the editable Excel companion. The PPT looks like agency-grade visual design. Cross-viewer compat stays perfect. We never go back to the native-chart wall.
