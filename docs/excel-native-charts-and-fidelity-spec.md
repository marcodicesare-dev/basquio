# Excel-Native Charts + Slide-Level Fidelity Spec

**Date:** 2026-04-17
**Author:** Claude (Rossella audit synthesis + codebase forensic + SOTA research) — for another agent to implement
**Triggers:**
- Rossella's slide-by-slide audit of run `d580a4df` (Apr 17, 11:18–12:00)
- Rossella's "ottimo compromesso" insight: ship the PPTX as-is (screenshots) AND deliver `data_tables.xlsx` with **NATIVE editable Excel chart objects** so analysts can paste them straight into their own decks
- Marco's strategic frame: "80% is gospel — this refinement must never block finding users. We're 6 people, parallel work."
- Rossella's bottom line: "Io non pagherei per dovermi rifare io tutti i grafici. L'excel con il grafico che ci incollo sopra è un ottimo compromesso."

**This spec replaces nothing.** It adds Layer-A (knowledge), Layer-B (validation), Layer-C (prompt) work that complements `quality-first-architecture-spec.md` and `agency-grade-design-spec.md`.

---

## 0. The Two Big Insights

**Insight #1 — The Excel charts are the pricing unlock.**

The PPTX is a "first draft visual" — analysts will iterate on top of it regardless. The PPTX layout polish never hits 100% (CLAUDE.md says we're at 80%, Rossella says 50% for NIQ-grade).

But if Basquio also delivers `data_tables.xlsx` with **every chart as a native, editable Excel chart object** (BarChart, LineChart, BubbleChart) referencing the data in the same workbook, then the analyst's workflow becomes:
1. Open Basquio's Excel
2. Right-click a chart → Copy → Paste-Special into their NIQ deck
3. Done — no rebuilding from scratch

That is the **80% Marco talks about** delivered as a package the analyst can actually pay for. The PPT alone is 50%. The PPT + editable Excel charts is 80%+.

**Insight #2 — Slide-level defects are the missing per-slide rubric.**

Rossella's slide-by-slide audit caught 12 specific issues in 70 slides. They're not random — they cluster into 4 categories:
1. **Data fidelity to source** (preserve labels, PY before CY, var quota/prezzo columns)
2. **Title-chart alignment** (numbers in titles must match data on chart)
3. **Repetition without depth** (slide 13 redrew slide 12 minus data, no insight added)
4. **Hallucination** (Rusticheaq "for adults" with no data; ACV invented label)

Each maps to a deterministic check that can run BEFORE the slide ships.

---

## 1. Forensic Audit — Rossella's 12 Specific Defects

| # | Slide | Rossella's exact words | Defect class | Fix surface |
|---|---|---|---|---|
| R1 | 3 (Categoria €1.020M) | "qui nella tabella si deve ricordare che il PY viene sempre prima del CY" | NIQ convention | Period column ordering rule |
| R2 | All chart slides | "sta source si riesce a fargliela mettere sempre accanto al logo o sempre sopra?" + "in generale sotto ogni grafico c'è la source che è però scritta in fondo alla slide" | Source duplication | Single-source-line rule (in chart OR slide footer, not both) |
| R3 | 4 (Sette segmenti) | "nella tabella avrei messo anche var quota e var prezzo" | Missing canonical columns | Required-deltas table rule |
| R4 | 5 (Bubble matrice) | "manca la legenda per la size della bolla: a occhio direi che è uguale alle vendite a valore, ma non c'è scritto e non ne sarei sicura da inviare a cliente" | Bubble legend missing | Bubble-size-legend mandatory |
| R5 | 8 (Pack size delta) | "ordine del grafico da invertire-nice to have. nella tabellina manca variazione quota. la slide 7 in questo invece è perfetta" | Bar order + missing column | Bar-sort rule + delta columns |
| R6 | 12 (Salt/Original 60%) | (positive) "questa slide nella sua semplicità mi piace tantissimo - punto di vista molto critico... forse i messaggi sono ancora tanto bold se dovessi dire una cosa" | Tone slightly too bold | Existing tone rule (yesterday) |
| R7 | 13 (Each flavour adult vs child) | "qua il brus stava shockato, ha ripetuto malamente il grafico della slide precedente (la 12), ha tolto delle line di analisi non si sa perchè (es Salt e Vinegar qui non c'è, ma nella slide prima è il primo gusto per crescita). in più l'insight non l'ho capito. si è spinto un po' troppo" | Chart repetition + data loss + insight failure | MECE check + data-completeness check |
| R8 | 14 (Pringles distribution) | "se l'è inventato lui che la distribuzione è all commodity value (ACV finale) →gli si deve dire che deve tenere la stessa identica label dell'indicatore che gli si da nell'input. e poi su tutti i grafici a bolla deve mettere in legenda la size della bolla" | Invented label + bubble legend | Source-label preservation rule |
| R9 | 18 (Multipack Discount +17%) | "molto bella" + "qui refuso di titolo, l'intersezione più performante è il single pack negli iper piccoli" | Title-data mismatch | Title-claim verification rule |
| R10 | 20 (Veggy +26% +50% iper medi) | "anche qui titolo non centrato rispetto ai numeri - non cresce in nessun canale del 50%, il canale più forte sono gli iper piccoli e non li ha citati. lo ha scritto nel commento accanto, ma non nel titolo" | Title-data mismatch + missing reference | Title-claim verification rule |
| R11 | 21 (PL al 51% e Doritos al 18%) | "anche qua si è schockato nel titolo: 81 milioni che cosa sono? la somma di PL e doritos fa meno di 81 milioni. Se parla poi di premium/no premium deve mettere anche i prezzi nella tabella" | Number in title not derivable from chart + missing supporting data | Number-in-title verification + prerequisite-data rule |
| R12 | 22 (San Carlo Rustica) | "qui slide top, non capisco come fa a dire che le rustiche sono per gli adulti, sta un poco allucinato forse" | Hallucination — claim has no source | Claim-traceability rule |
| R13 | 7 (Heatmap Segmento × Pack Size) | "questa slide completamente errati sia titolo che commento rispetto al grafico" — title says "Veggy Single Serve +54%, Multipack Reconstituted +219%: le intersezioni emergenti" but heatmap shows Vegetable Chips Single Serve at +33% and Vegetable Chips Multipack at +36%, no +54%/+219% anywhere | Heatmap title-data mismatch (severe) | Title-claim verifier MUST handle heatmap intersections, not just bar/line series |
| R14 | 42 (Recommendation 1 Must-Win Q1-Q2) | "attivazione promo deludente — non motivata con le slide precedenti, magari sarà vero, ma non ci sono i numeri a supporto" | Recommendation claim has no on-deck supporting evidence | Claim-traceability validator must apply to RECOMMENDATIONS not just analytical claims |
| R15 | 51 (Scenari Multipack) | "nelle reco cita le insegne, ma le insegne non sono nei numeri che abbiamo dato come input. ci sta dire esselunga perché è nel loro store format potenziale, quindi ok, ma come sa basquio che esselunga sia ok? cioè per quanto in questo caso sia giusto, da evitare che lui dia raccomandazioni sulla base di conoscenza che non gli abbiamo dato noi nell'input" | Recommendations cite specific entities (Esselunga, Coop, Conad, Iper) not present in input data — agent using prior knowledge instead of data | NEW — entity-grounding validator |
| R16 | All slides 54-70 | "dalla slide 54 è solo appendix. quindi il deck non è di 70 slide, ma di 54. oltre le 54 terrei buone solo le slide 63 e 64, il resto è da cestinare. se da utente ti chiedo 70 slide ne voglio 70 di contenuto, se me ne fai solo 56 di contenuto mi sento fregato. rimborsami i crediti se basquio pensa non ci sia abbastanza materiale da fare 70 slide" | Appendix bloat: 16 of 70 slides are appendix-padding; user paid for 70 content slides, got 56 | NEW — appendix governance + auto-credit-refund |

**Pattern (updated):** 9 of 15 defects are "what's stated isn't supported by what's on the chart or in the input data". The agent generates titles, body, and recommendations with confidence its sources don't justify. This is a **claim-evidence binding gap** that needs THREE deterministic checks:
1. **Title numbers verifiable on chart** (R9, R10, R11, R13)
2. **Body claims observable on data** (R12, R14)
3. **Entity references grounded in input data** (R15) — the new dimension Rossella surfaced

---

## 2. SOTA Research — Editable Excel Charts via openpyxl

Sources (April 2026):
- [openpyxl 3.1 — Charts introduction](https://openpyxl.readthedocs.io/en/3.1/charts/introduction.html)
- [openpyxl 3.1 — Bar and Column Charts](https://openpyxl.readthedocs.io/en/stable/charts/bar.html)
- [openpyxl 3.1 — Line Charts](https://openpyxl.readthedocs.io/en/stable/charts/line.html)
- [openpyxl 3.1 — Scatter Charts](https://openpyxl.readthedocs.io/en/stable/charts/scatter.html)
- [openpyxl 3.1 — Bubble Charts](https://openpyxl.readthedocs.io/en/3.1/charts/bubble.html)
- [openpyxl.chart.series module](https://openpyxl.readthedocs.io/en/stable/api/openpyxl.chart.series.html)
- [Add and Edit Excel Charts using Python openpyxl](https://pytutorial.com/add-edit-excel-charts-using-python-openpyxl/)

### 2.1 What openpyxl supports today (Apr 2026)

| Chart type | openpyxl class | Native editable in Excel? | Bubble size dim |
|---|---|---|---|
| Vertical bar | `BarChart(type="col")` | yes | n/a |
| Horizontal bar | `BarChart(type="bar")` | yes | n/a |
| Stacked bar | `BarChart(grouping="stacked")` | yes | n/a |
| 100% stacked | `BarChart(grouping="percentStacked")` | yes | n/a |
| Line | `LineChart()` | yes | n/a |
| Scatter | `ScatterChart()` | yes | n/a |
| Bubble | `BubbleChart()` | yes | yes (3rd dim) |
| Pie | `PieChart()` | yes | n/a |
| Doughnut | `DoughnutChart()` | yes | n/a |
| Area | `AreaChart()` | yes | n/a |
| Stock | `StockChart()` | yes | n/a |
| Radar | `RadarChart()` | yes | n/a |
| Surface 3D | `SurfaceChart3D()` | yes | n/a |
| Waterfall | NOT supported by openpyxl | — | — |
| Heatmap | NOT supported (no native Excel heatmap) | conditional formatting | — |

**Coverage of Basquio's chart needs:** ~90% of the chart types in our slot-archetypes catalog have a native Excel equivalent. Waterfall and heatmap need to fall back to a "table with conditional formatting" (Excel handles this natively as a heatmap visually).

### 2.2 Canonical openpyxl chart-creation pattern

```python
from openpyxl.chart import BarChart, Reference, BubbleChart, Series
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.drawing.fill import ColorChoice

with pd.ExcelWriter('data_tables.xlsx', engine='openpyxl') as writer:
    # 1. Write the data
    brand_share_df.to_excel(writer, sheet_name='Slide_15_Brand_Share', index=False)
    ws = writer.sheets['Slide_15_Brand_Share']

    # 2. Build the native chart object referencing the same data
    chart = BarChart()
    chart.type = "bar"            # horizontal
    chart.style = 10              # built-in clean style
    chart.title = "Top 10 brand: PRINGLES leader 8.9% (-4.3%)"
    chart.y_axis.title = "Brand"
    chart.x_axis.title = "Quota Valore (%)"

    # Reference the data range (column 2 = values, header in row 1)
    data = Reference(ws, min_col=2, min_row=1, max_row=ws.max_row, max_col=2)
    cats = Reference(ws, min_col=1, min_row=2, max_row=ws.max_row)
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(cats)

    # Apply Basquio palette to the focal series
    series = chart.series[0]
    series.graphicalProperties = GraphicalProperties(solidFill='2E4AB8')
    series.dLbls = DataLabelList(showVal=True)

    # Anchor the chart to the right of the data
    ws.add_chart(chart, f"E2")
```

This produces a `BarChart` object that:
- Lives in the same XLSX file as the data
- Updates automatically if the user edits the data cells
- Can be right-clicked → Edit Data, Format Series, etc.
- Can be copy-pasted into PowerPoint with "Paste Link" or "Embed" — preserving editability in the new deck

### 2.3 Bubble chart with size legend (the slide-5 fix)

```python
from openpyxl.chart import BubbleChart, Series, Reference

ws = writer.sheets['Slide_05_Bubble_Matrix']

bubble = BubbleChart()
bubble.style = 18
bubble.title = "Matrice Dimensione × Crescita — bolla = Sales Value (€M)"
bubble.x_axis.title = "Sales Value (€M)"
bubble.y_axis.title = "Var. % YoY"

# Each series = one segment, with x, y, and bubble-size references
xvalues   = Reference(ws, min_col=2, min_row=2, max_row=ws.max_row)  # sales value
yvalues   = Reference(ws, min_col=3, min_row=2, max_row=ws.max_row)  # growth %
sizes     = Reference(ws, min_col=4, min_row=2, max_row=ws.max_row)  # bubble size = sales

series = Series(values=yvalues, xvalues=xvalues, zvalues=sizes, title="Segments")
bubble.series.append(series)
ws.add_chart(bubble, "G2")
```

The chart title MUST include the bubble-size dimension explicitly ("bolla = Sales Value (€M)") — this fixes Rossella's R4 / R8 complaint about missing bubble legends.

### 2.4 Excel sheet naming convention

Sheet names in Excel are limited to 31 characters and forbidden from containing `\ / ? * [ ]`. Convention:

```
S<NN>_<short_descriptor>     e.g.  S15_BrandShare
S<NN>_<short_descriptor>     e.g.  S05_BubbleMatrix
S<NN>_<short_descriptor>     e.g.  S20_VeggyChannel
```

This makes it trivial for the analyst to find the chart for a specific PPT slide.

---

## 3. The Spec — Three New Layers

### 3.1 LAYER A — New Knowledge: `basquio-data-fidelity-rules.md` (NEW)

A dedicated knowledge pack for data fidelity. Required sections:

#### 3.1.1 Source Label Preservation (R8 fix)

> When a metric appears on a chart, in a table, or in body text, the LABEL must be either:
>
> 1. **The exact source column name from the input data** (e.g., "Distr. Pond.", "V. Valore"), OR
> 2. **The canonical English from the NIQ playbook section 3 Column Recognition table** ("Weighted Distribution", "Sales Value")
>
> NEVER invent a label or use a synonym not in either set. Forbidden examples:
> - "ACV" or "All Commodity Value" (when the source is "Distr. Pond.")
> - "Penetration" (when the source is "Distr. Num.")
> - "Brand Health" (when the source is anything else)
>
> If the analyst needs a domain term in narrative ("ACV is the All Commodity Value retail share"), use the term ONCE in body text with the source label in parentheses: "ACV (Distr. Pond.) of 44%". Never on chart axis labels or table headers without the source-label fallback.

#### 3.1.2 Period Column Ordering (R1 fix)

> Tables containing two or more time periods must order columns chronologically:
>
> ```
> [Dimension] | PY | CY | Δ value | Δ %
> ```
>
> Never CY first. Never random. The convention follows NIQ standard format: past → present → delta.
>
> For three-period analysis: `[Dim] | 2YA | PY | CY | YoY % | 2-yr CAGR %`.
>
> Apply to: narrative markdown tables, slide tables, `data_tables.xlsx` columns.

#### 3.1.3 Required Delta Columns (R3 / R5 fix)

> Tables for brand/segment performance must include both:
>
> - **Δ quota** (share variation in pp) when share is shown
> - **Δ prezzo** (price variation in % or absolute €/kg) when price is shown
>
> Minimum table contract for "brand performance" tables:
>
> ```
> Brand | Sales Value PY | Sales Value CY | Δ value % | Quota PY | Quota CY | Δ quota pp | Prezzo PY | Prezzo CY | Δ prezzo %
> ```
>
> A table that shows only `Brand | Quota CY | Δ value %` is incomplete and fails this rule.

#### 3.1.4 Bar Order Rule (R5 fix)

> Bar charts comparing magnitudes must be sorted in one of three valid ways:
>
> 1. By value descending (default for "ranked comparison" question)
> 2. By delta descending (when the chart shows growth/decline)
> 3. By an explicit dimension order specified in the brief (e.g., chronological)
>
> Random order is forbidden. Mixed order (some by value, some by delta) within the same deck is forbidden.

#### 3.1.5 Bubble Size Legend Mandatory (R4 / R8 fix)

> Every bubble chart and scatter-with-size chart MUST declare the bubble-size dimension explicitly. Required positions:
>
> 1. Chart title MUST include "bolla = <metric>" (Italian) or "bubble = <metric>" (English)
> 2. AND a note in the chart subtitle/caption stating the unit
>
> Example title: `"Matrice Dimensione × Crescita — bolla = Sales Value (€M)"`
>
> A bubble chart without explicit size dimension is non-deliverable.

#### 3.1.6 Source Line — Single Origin (R2 fix)

> Each slide has EXACTLY ONE source line. Default position: bottom of slide footer band (`y > 6.85`). NEVER duplicate the source under the chart.
>
> Exception: appendix tables that span multiple sheets/pages may include a per-page source line.

#### 3.1.7 Title-Claim Verification (R9 / R10 / R11 fix)

> Every slide title that contains a number must satisfy:
>
> 1. The number appears verbatim on the chart or table on the same slide, OR
> 2. The number is derivable from values shown on the chart by simple arithmetic (sum, average, max), AND the derivation is shown in the body text or callout
>
> Example violations:
> - Title says "+50% in iper medi" but the chart shows +26% as the maximum (R10)
> - Title says "€81M" but the values shown sum to less than €81M (R11)
>
> The implementing agent must add a deterministic check that scans slide titles for numbers, then verifies each number against the chart's data series.

#### 3.1.8 Claim-Traceability Rule (R12 fix)

> Any qualitative claim made in slide body text or callouts (e.g., "Rustica targets adults", "Veggy is in the premium segment") must be either:
>
> 1. Directly observable on a chart in the deck (e.g., a chart showing Rustica price index 130+ supports "premium"), OR
> 2. Quoted from the brief or business context, with a `(brief)` reference, OR
> 3. Sourced from a data column in the uploaded file with a `(cfr. <field>)` reference
>
> Forbidden: pure inference based on the brand name, packaging color, or the model's prior knowledge. If the claim has no observable source, remove it.

#### 3.1.9 Chart-Repetition Rule (R7 fix)

> A chart's data + chart-type combination cannot repeat across two slides. Specifically:
>
> - Same data + same chart type = redundant (forbidden)
> - Same data + different chart type = allowed only if the new chart unlocks an insight the previous chart cannot show (e.g., bar → small multiples to reveal outliers)
> - Different data subset + same chart type = allowed (e.g., flavour growth top-12 vs flavour growth top-3 selected)
>
> When generating slide N, Claude must declare the chart's `data_signature` (hash of the data range) and verify it does not match the `data_signature` of any previous slide. If it does, the new slide must drop bars/series/columns to introduce delta vs the previous, OR be replaced.

### 3.2 LAYER B — New Validators

Add to `packages/intelligence/src/`:

#### 3.2.1 `title-claim-verifier.ts` (NEW)

Inputs: slide title, chart data (categories + values), table data (rows × columns), chart type.
Output: violations.

Logic:
1. Extract every number from the title (regex `\d+([,.]\d+)?\s*(%|pp|M|MLN|€|EUR)`)
2. For each number, check based on chart type:
   - **Bar/line/scatter:** number appears in the chart's value array OR table cells (tolerance ±2%)
   - **Heatmap (Rossella R13):** number appears in the heatmap's intersection grid — this is a 2D lookup, not 1D. The verifier MUST iterate over (row, col) pairs and check each cell value
   - **Bubble:** number appears in either x-axis values, y-axis values, OR bubble-size values
3. If a number doesn't appear, flag `title_claim_unverified` with the offending number and the closest match found

**Heatmap special case (R13):** the production deck's slide 7 had title "Veggy Single Serve +54%, Multipack Reconstituted +219%" but the heatmap showed `Vegetable Chips × Single Serve = +33%` and `Vegetable Chips × Multipack = +36%`. The verifier should have caught: "+54%" not in any heatmap cell, "+219%" not in any heatmap cell. Two critical violations.

Severity: **major** for general — triggers per-slide revise. **Critical** when the offending number is the headline claim and is off by >50% (R13's case: title said +54% when actual was +33% — 60% wrong).

#### 3.2.2 `source-label-validator.ts` (NEW)

Inputs: slide title, body, chart axis labels, table headers; uploaded data columns; canonical NIQ playbook column map.
Output: violations.

Logic:
1. Extract every metric label from chart axis titles, table headers, body
2. For each, check if it matches: (a) a source data column name, or (b) a canonical NIQ playbook English name
3. If not, flag `invented_label` with the offending label and a list of legal candidates

Severity: **major**.

#### 3.2.3 `period-order-validator.ts` (NEW)

Inputs: any table headers in the deck.
Output: violations if PY appears AFTER CY in the same row.

Logic: regex match for `(CY|Anno corr|2025|2026)` + `(PY|Anno prec|2024|2025)` and verify left-to-right ordering is past → present.

Severity: **minor** initially, **major** after 1 week of bake-in.

#### 3.2.4 `bubble-size-legend-validator.ts` (NEW)

Inputs: chart manifest entries for type=bubble or type=scatter with size encoding.
Output: violations if title doesn't contain `bolla = ...` / `bubble = ...`.

Severity: **major**.

#### 3.2.5 `chart-repetition-validator.ts` (NEW)

Inputs: all slides' chart data signatures (hash of categories + values + chart type).
Output: violations for any duplicate signature pair.

Severity: **major**.

#### 3.2.6 `claim-traceability-validator.ts` (NEW — uses LLM-as-judge)

This one CANNOT be purely deterministic — it requires understanding whether a claim is supported by the chart. Use a Haiku judge call with prompt:

> Given this slide's chart data and body text, identify any qualitative claim (e.g., "X targets Y demographic", "X is premium positioned", "promo activation underwhelming", "expand in retailer X") that is NOT directly observable from the chart values, the source data, or supporting evidence on prior slides. Return a list of unsupported claims with severity (major/critical).

Severity: **major** when the claim is on a recommendation slide (Rossella R14), **major** elsewhere. Cost ~$0.005 per slide × 70 = $0.35 per deck. Negligible.

**This validator MUST also run on recommendation slides.** R14 showed the agent makes claims like "attivazione promo deludente" with no supporting evidence on prior slides. Recommendation evidence must come from the deck, not the model's prior knowledge of the category.

#### 3.2.7 `entity-grounding-validator.ts` (NEW — Rossella R15)

The most subtle hallucination class — the agent uses its prior knowledge of FMCG (specific retailer names: Esselunga, Coop, Conad, Iper, Carrefour, Selex, Végé) when those retailers are NOT mentioned in the uploaded input data.

Inputs:
- Slide body, callouts, recommendations text
- The set of entities (brands, retailers, channels, segments) actually present in the uploaded data files

Logic:
1. Build a set of "known entities" from the source data: every unique value in retailer/brand/channel/segment columns of the uploaded files
2. Extract every named entity in slide text (proper nouns, capitalized phrases)
3. For each named entity in the text, check whether it appears in the known entities set
4. If not, flag `entity_not_in_input` with the entity name

Special handling for retailers:
- The NIQ RMS export typically aggregates to channel-level (Hyper, Super, Discount, Superette) — NOT retailer-level (Esselunga, Coop, etc.)
- A recommendation that says "list in Esselunga" when the input only contains "Super" channel data is making a recommendation Basquio cannot justify
- Better recommendation framing: "list in Super channel (top 3 retailers by region)"

Severity: **major** (Rossella explicitly flagged this even when the recommendation might be correct — "per quanto in questo caso sia giusto, da evitare").

Cost: $0 (deterministic — no LLM call needed if we have the input entities catalogued).

**Implementation note:** the worker should build the `known_entities` catalogue from the parsed source files BEFORE Claude's author turn and pass it as an explicit list in the author message, so Claude knows what entities it can name.

#### 3.2.7 Wire all six into the existing `understandPlanLint` + per-slide visual QA from `agency-grade-design-spec.md`

The visual QA rubric from yesterday's spec gets two new dimensions:
- **Data fidelity (weight 15)**: source-label preservation, period order, bubble legend, title-claim
- **Claim-traceability (weight 10)**: every qualitative claim on the slide is observable from the chart

### 3.3 LAYER C — Prompt Updates + Excel-Native-Charts Pattern

#### 3.3.1 New few-shot example: `data_tables_xlsx_with_native_charts`

Add a new named example to `system-prompt.ts` showing the full pattern:

```python
import pandas as pd
from openpyxl.chart import BarChart, BubbleChart, LineChart, Reference, Series
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.shapes import GraphicalProperties

# Basquio chart palette (read from env var if set)
import os
ACCENT   = os.environ.get('BASQUIO_ACCENT', '#2E4AB8')
POSITIVE = os.environ.get('BASQUIO_POSITIVE', '#3D9B7E')
NEGATIVE = os.environ.get('BASQUIO_NEGATIVE', '#C65766')
SLATE    = '#334155'
DIM      = '#6B7280'

with pd.ExcelWriter('data_tables.xlsx', engine='openpyxl') as writer:

    # === Slide 5: Bubble matrix segment × growth ===
    seg_df = segments_with_growth_and_size  # columns: Segment, ValueEUR, GrowthPct, Size
    seg_df.to_excel(writer, sheet_name='S05_BubbleMatrix', index=False)
    ws = writer.sheets['S05_BubbleMatrix']

    bubble = BubbleChart()
    bubble.style = 18
    bubble.title = "S05 — Matrice Dimensione × Crescita — bolla = Sales Value (€M)"
    bubble.x_axis.title = "Sales Value (€M)"
    bubble.y_axis.title = "Var. % YoY"

    xvalues = Reference(ws, min_col=2, min_row=2, max_row=ws.max_row)
    yvalues = Reference(ws, min_col=3, min_row=2, max_row=ws.max_row)
    sizes   = Reference(ws, min_col=4, min_row=2, max_row=ws.max_row)
    bubble.series.append(Series(values=yvalues, xvalues=xvalues, zvalues=sizes, title="Segments"))
    ws.add_chart(bubble, "G2")

    # === Slide 15: Brand share horizontal bar ===
    brand_df = brand_share_top10  # columns: Brand, Quota_PY_pct, Quota_CY_pct, Delta_quota_pp, Delta_value_pct
    brand_df.to_excel(writer, sheet_name='S15_BrandShare', index=False)
    ws = writer.sheets['S15_BrandShare']

    bar = BarChart()
    bar.type = "bar"
    bar.style = 10
    bar.title = "S15 — Top 10 brand — Quota CY %"
    data = Reference(ws, min_col=3, min_row=1, max_row=ws.max_row)  # Quota_CY column
    cats = Reference(ws, min_col=1, min_row=2, max_row=ws.max_row)  # Brand column
    bar.add_data(data, titles_from_data=True)
    bar.set_categories(cats)
    bar.series[0].graphicalProperties = GraphicalProperties(solidFill=ACCENT.lstrip('#'))
    bar.series[0].dLbls = DataLabelList(showVal=True)
    ws.add_chart(bar, "G2")

    # === Slide 25: Tortilla price ladder ===
    price_df = corn_chips_brand_price   # columns: Brand, ValueEUR, Prezzo_kg, Quota_pct
    price_df.to_excel(writer, sheet_name='S25_TortillaPrices', index=False)
    # ... etc
```

#### 3.3.2 Mandatory rule in author message

Add to `buildAuthorMessage()`:

> EXCEL-NATIVE-CHARTS RULE: For every slide that contains a matplotlib chart in the PPTX, you MUST also write the chart's underlying DataFrame to a sheet in `data_tables.xlsx` named `S<NN>_<descriptor>`, AND embed a native Excel chart object (BarChart / LineChart / BubbleChart / etc.) in that sheet that references the same data range.
>
> The Excel chart object must:
> - Use the same chart type as the matplotlib chart (bar → BarChart, line → LineChart, bubble → BubbleChart)
> - Use the same focal color (BASQUIO_ACCENT env var) for the focal series
> - Have a title that matches the matplotlib chart title
> - Have axis titles matching the matplotlib axis labels
> - For bubble charts: declare bubble-size dimension in title ("bolla = <metric>")
>
> This is mandatory, not optional. The Excel file is a deliverable that the analyst will copy charts FROM, not a debug artifact.

#### 3.3.3 Update the data fidelity rules visible to Claude

Inject the new `basquio-data-fidelity-rules.md` knowledge pack into `KNOWLEDGE_PACK_FILES` so it's loaded at every author turn.

### 3.4 LAYER D — Manifest Coupling

The `deck_manifest.json` needs to know about the Excel sheet for each chart so downstream tooling (the email, the dashboard, the Excel review UI) can link slide N → Excel sheet S<NN>.

Add to manifest schema:

```typescript
charts: Array<{
  id: string;
  title: string;
  type: ChartSlotType;
  excelSheetName?: string;    // NEW — e.g., "S05_BubbleMatrix"
  excelChartCellAnchor?: string;  // NEW — e.g., "G2"
  dataSignature?: string;     // NEW — hash for repetition validation
  pngPath?: string;           // existing
}>
```

The completion email becomes: "Your deck is ready — and every chart is also editable in `data_tables.xlsx`. Click any slide to jump to its Excel sheet."

---

## 4. Implementation Path (Order of Operations)

### Wave 1 — Excel native charts (the killer feature) — days

The single biggest user-value lever:
- Add the `data_tables_xlsx_with_native_charts` few-shot example to `system-prompt.ts`
- Add the EXCEL-NATIVE-CHARTS RULE to `buildAuthorMessage()`
- Update manifest schema with `excelSheetName` field
- Update completion email template to mention "editable charts in attached Excel"

Test: re-run Fra's brief at 70 slides. Open `data_tables.xlsx` — every slide's chart should appear as a native Excel chart object next to its data. Right-click → Edit Data should work.

### Wave 2 — Data fidelity rules (kill the slide-level defects) — days

In priority order based on Rossella's audit:
- R8 source-label preservation (`source-label-validator.ts`)
- R1 period column ordering (`period-order-validator.ts`)
- R4 / R8 bubble size legend (`bubble-size-legend-validator.ts`)
- R3 / R5 required delta columns (knowledge pack rule + table validator)
- R5 bar order (knowledge pack rule)
- R9 / R10 / R11 title-claim verification (`title-claim-verifier.ts`)
- R12 claim traceability (`claim-traceability-validator.ts` — Haiku judge)
- R7 chart-repetition validator
- R2 single-source-line rule

Each rule is small (50-100 lines). All wired into the per-slide rubric from `agency-grade-design-spec.md`.

### Wave 3 — Tighten the per-slide loop — week

Per `agency-grade-design-spec.md` Wave 3: streaming author with batch-of-5 + visual QA + content QA. The new validators from Wave 2 plug into the same loop.

### Wave 4 — Power features — month

- "Open in Excel" button in the dashboard that downloads `data_tables.xlsx` and highlights the matching sheet for the slide the user is viewing
- An "Open chart in Excel" link inside the slide preview overlay
- Eventually: a web-Excel embed so the user can edit charts in-browser without downloading

---

## 5. Cost & Performance

| Change | Cost delta | Time delta |
|---|---|---|
| Excel native charts | +1-2 minutes (chart object creation) | +1-2 min |
| Source label validator | $0 (deterministic) | +0s |
| Title-claim validator | $0 (deterministic) | +0s |
| Claim-traceability (Haiku judge) | +$0.35 / deck | +30 sec |
| Bubble legend validator | $0 (deterministic) | +0s |
| All other validators | $0 (deterministic) | +0s |

**Total impact:** +$0.35-0.50 per deck, +1-3 min run time. Less than 2% cost overhead for the killer feature + 7 fidelity validators.

---

## 6. Validation Contract

A re-run of Fra's Kellanova brief (70 slides, Opus 4.7, same template) after Wave 1+2 must demonstrate:

| Defect | d580a4df status | Target |
|---|---|---|
| `data_tables.xlsx` chart objects | 0 native charts | ≥40 native charts (one per chart-bearing slide) |
| Excel chart sheet naming | Random (`Category_Overview`) | `S<NN>_<descriptor>` for every chart |
| Bubble size legend (slide 5, etc.) | Missing | Always declared in title |
| Invented labels (ACV) | ≥1 | 0 |
| PY-before-CY column order | Random | 100% |
| Required delta columns (var quota, var prezzo) | Missing | 100% on brand/segment tables |
| Title number unverifiable on chart | ≥3 | 0 critical, 0 major |
| Chart repetition across slides | Slide 13 = slide 12 | 0 |
| Claim with no traceable source | Slide 22 Rustica "for adults" | 0 |
| Source line duplicated under chart + on footer | All slides | At most one source per slide |

**Real validation:** Stefania / Rossella receives the v2 deck. Open `data_tables.xlsx`. Right-click chart → Copy → Paste into NIQ deck. Done in < 2 minutes per chart vs current 30+ min rebuild.

---

## 7. Strategic Frame (Marco's "80% must")

Per Marco: "Per me l'80% è il vangelo. Questo tipo di refinement non deve mai bloccare il lavorare a trovare user. Siamo in 6, possiamo fare cose in parallelo."

This spec respects that frame:
- Wave 1 (Excel native charts) is the SINGLE biggest user-value bump per development hour. Ship it first, even alone.
- Waves 2-4 are incremental fidelity improvements that compound. Each can ship independently as one-day tasks.
- None of this work is on the critical path of "find users". One agent can work this while others work GTM, sales, demos.
- Rossella's slide-by-slide audit is GOLD as a permanent backlog of fidelity checks. Every validator we ship from her audit is a check that **never regresses**.

The pricing thesis becomes: "Basquio delivers a 50% PPT screenshot deck PLUS a 100% editable Excel chart pack — in 30 minutes vs 3 days. The analyst takes the Excel charts, drops them into their template, polishes the 20%, ships."

That's a paid product. Without the Excel charts, it's not.

---

## 8. What NOT To Do

- ❌ **Do not delete the matplotlib PNG path.** The PPTX screenshots stay. The Excel charts are ADDITIONAL, not REPLACEMENT. (See `chart-architecture-canonical.md` for why native PowerPoint charts are not viable.)
- ❌ **Do not let Excel chart generation block PPT generation.** If openpyxl/XlsxWriter chart creation throws on an edge case, log warning, skip THAT chart's Excel object, continue. The PPT must still ship.
- ❌ **Do not use openpyxl for waterfall or heatmap** — neither has native Excel support. Fall back to "table with conditional formatting" or "raw table only" for those types.
- ❌ **Do not invent column names** to make the Excel pretty. Source label preservation is non-negotiable.
- ❌ **Do not duplicate the source line** in narrative + chart + footer. Pick one canonical position (footer).
- ❌ **Do not skip the claim-traceability check** to save $0.35. The hallucination defects (R12, R14) destroy trust faster than the cost saves money.
- ❌ **Do not let Claude name retailers/brands not in the input data** (R15). Build the entity catalogue from the input files BEFORE Claude's author turn, pass it as the allowed entity set in the author message.

---

## 8C. Content Slide Accountability — Strengthen Depth Intelligence (R16)

### Diagnosis (corrected)

Production run `d580a4df` (70 slides):
- Slides 1-54 = real content
- Slides 55-70 = appendix (16 slides, 23% of deck)
- Of those 16 appendix slides, only 63 and 64 had value per Rossella's review

Rossella: *"se da utente ti chiedo 70 slide ne voglio 70 di contenuto, se me ne fai solo 56 di contenuto mi sento fregato."*

**The corrected diagnosis (Marco):** *"il problema qui è che c'era abbastanza materiale per costruire la depth di 70 slide, ma l'intelligenza di basquio ha riempito appendix non valutabili."*

The data DID have enough material for 70 slides of real content. The pipeline FAILED to drill that deep. Instead of producing 70 content slides through proper depth (segment × channel × format × SKU drill-downs, retailer breakdowns, scenario sensitivity, etc.), the agent took the lazy path: produce ~56 content slides + 16 appendix dumps.

**This is an intelligence failure, not a credit-pricing problem.** The fix is at the intelligence layer, not at the billing layer.

### Rejected approaches (overengineered)

I previously proposed three fixes; rejecting two:

- ❌ **Pre-flight Haiku content-density probe.** Overengineering. Adds a separate API call, pre-debit warning UX, complicated user flow. The data feasibility was never the problem — Claude's depth was.
- ❌ **Auto credit refund on content shortfall.** Overengineering. Refund mechanics don't fix the quality issue; they paper over it. Worse, they create perverse incentives where shipping fewer slides is "fine" because we refund. The contract should be: ask for 70, get 70 of content. Refunds are a last resort, not an architecture.
- ✅ **Appendix cap + depth intelligence enforcement.** Keep. This is the only part that addresses the root cause.

### The fix — strengthen depth intelligence so Claude produces N content + ~10% appendix top-up

**The contract:**
- User requests `N` slides
- Claude produces `N` content slides through MECE drill-down (no padding allowed)
- Claude MAY add up to `ceil(N * 0.10)` appendix slides AS A TOP-UP, not as filler
- Total ships at `N + appendix_topup`, where appendix is genuinely supplementary, not gap-filling

For Fra's 70-slide ask:
- Today: 54 content + 16 appendix = 70 total (16 appendix is 23% of asked count — too much)
- New contract: 70 content + up to 7 appendix = 77 total (or 70 content + 0 appendix if not warranted)

The user always gets at least N content slides. Appendix is bonus, not the way to hit N.

### The mechanism — three reinforcements at the intelligence layer

**Mechanism 1 — Tighten the depth tier prompts (Layer C)**

The current depth tier instruction for 41-70 slide decks (from `template-fidelity-and-depth-spec.md` Section 2.3.4) needs an explicit content/appendix accounting clause. Append to the existing tier instruction:

> "The requested slide count is your CONTENT slide count, not your total. Produce exactly N content slides through proper MECE drill-down (segment × channel × format × SKU, retailer breakdowns, promo decomposition, scenario sensitivity, competitor deep-dives). You MAY add up to ceil(N × 0.10) appendix slides as supplementary material, but appendix is OPTIONAL TOP-UP, not a way to reach N. If you find yourself padding the back of the deck with appendix to hit count, you have failed the depth contract — drill deeper into the existing chapters instead."

**Mechanism 2 — Slide-plan validator: hard appendix cap (Layer B)**

In `packages/intelligence/src/slide-plan-linter.ts`, add a new rule:

```typescript
// Appendix cap rule
const appendixSlides = plan.filter(s =>
  s.role === 'appendix' || s.role === 'methodology' || s.role === 'source-trail' ||
  /^appendice\b|^appendix\b/i.test(s.title)
);
const contentSlides = plan.filter(s => /* not appendix, not cover, not divider */);
const appendixCap = Math.ceil(targetSlideCount * 0.10);

if (appendixSlides.length > appendixCap) {
  violations.push({
    rule: 'appendix_overfill',
    severity: 'critical',
    message: `Plan has ${appendixSlides.length} appendix slides for a ${targetSlideCount}-slide ask; max is ${appendixCap} (10% top-up). Drill deeper in existing chapters instead.`,
  });
}

if (contentSlides.length < targetSlideCount) {
  violations.push({
    rule: 'content_shortfall',
    severity: 'critical',
    message: `Plan has only ${contentSlides.length} content slides; user asked for ${targetSlideCount}. Add ${targetSlideCount - contentSlides.length} more content slides through deeper drill-down (SKU level, retailer level, intersection cross-tabs).`,
  });
}
```

Both rules are **critical severity**, which means the plan is rejected and Claude must replan before authoring. This is the same blocking-validator pattern as the existing MECE check.

**Mechanism 3 — Drill-down catalog expansion in NIQ playbook (Layer A)**

The current drill-down dimension catalog (from `template-fidelity-and-depth-spec.md` Section 2.3.1) lists 14 dimensions covering category → segment → channel → SKU. For 70+ slide decks, expand the catalog with explicit "depth multipliers":

| Drill-down | Adds slides |
|---|---|
| Per-segment deep-dive (CY/PY/drivers) | +1 per segment |
| Per-segment × top-3 brands | +1 per segment-brand pair |
| Per-channel performance per segment | +1 per channel-segment pair |
| Per-format per channel | +1 per format-channel pair |
| Top-N SKU contribution per brand | +1 per brand at SKU level |
| Promo intensity × effectiveness per channel | +1 per channel |
| Price ladder per segment | +1 per segment |
| Scenario sensitivity (Bear/Base/Bull) per recommendation | +1 per recommendation |
| Retailer-specific (when input data has retailer-level rows) | +1 per retailer |

For the Kellanova brief at 70 slides, this catalogue easily supports 70+ content slides if the agent is forced to drill rather than pad. The validator from Mechanism 2 enforces "drill, don't pad" by rejecting plans that don't reach the content count.

### What goes in PPT vs narrative.md vs data_tables.xlsx

Clear separation of artifacts (this part stays as before — it's correct and Marco confirmed):

| Content type | Lives in | Why |
|---|---|---|
| Decisive insights with evidence | **PPT** | Visual, presentable, board-ready |
| Recommendations + roadmap | **PPT** | Action-oriented, decision-driving |
| Methodology, full data tables, raw cross-tabs, source trails, supporting calculations, full SKU lists | **narrative_report.md** | Standalone written deliverable, reads like a NIQ report |
| Structured raw data, every chart's underlying data, cross-tabs at every aggregation | **data_tables.xlsx** | Analyst working file, copy-pasteable |

The "extra info" that today gets dumped into appendix slides goes here instead, per Marco's clear instruction.

### Validation contract update for R16

| Metric | d580a4df baseline | Target after R16 fix |
|---|---|---|
| Content slide count vs requested | 56/70 (80%) | **70/70** content slides minimum |
| Appendix slides | 16 (23% of asked) | ≤7 (≤10% top-up of asked) |
| Total deck size | 70 | 70-77 (content + optional appendix top-up) |
| Pre-flight Haiku probe | does not exist | does not exist (rejected as overengineering) |
| Credit refund mechanism | does not exist | does not exist (rejected — fix the depth instead) |
| Plan validator: content shortfall as critical violation | not enforced | enforced (rejects plan, triggers replan) |
| Plan validator: appendix overfill as critical violation | not enforced | enforced (rejects plan, triggers replan) |

**The contract:** ask for 70 → get at least 70 content slides + at most 7 appendix top-ups. Period. No refunds, no warnings, no probes. Claude has to drill.

---

## 8B. Future Paths That Could Unlock Native PowerPoint Charts (Re-Audit After Marco's "Open to New Tech" Note)

Marco asked: "if you think some challenges we had in the past commit history could be potentially fixed with updated libraries or amazing new technology, that's fine."

Honest re-research — what's NEW in 2026 that could change the calculus:

### 8B.1 New tech surveyed (April 2026)

| Technology | What it claims | Does it solve our blockers? | Verdict |
|---|---|---|---|
| python-pptx 1.0.0 (Aug 2024 release, mature in 2026) | Native chart objects + embedded XLSX backing data | Cross-viewer issue is OOXML-format-fundamental, not library-fundamental. Library quality has improved but the format still fails the same way in Keynote/GSlides | **NOT a fix** for our blockers |
| Aspose.Slides for Python/.NET (commercial, 26.4.0 in 2026) | Cross-platform PPTX with high-fidelity rendering | Cross-platform = code runs everywhere; rendering FIDELITY across viewers is still PowerPoint-best-effort. Commercial license adds cost/dependency. | **NOT a fix** — same OOXML format limitations |
| Microsoft Graph API for chart insertion | Cloud-rendered native charts via Microsoft's own engine | Renders correctly in PowerPoint and Microsoft 365 web. Still gets re-interpreted by Keynote/GSlides converters. Adds Microsoft account dependency. | **NOT a fix** for cross-viewer |
| LibreOffice headless rendering pipeline | Render PPTX to PDF/PNG server-side, post-process | Doesn't help us — we already render PNG via matplotlib at higher quality | **NOT new value** |
| ECharts SSR + sharp (already tried in 75be587) | High-quality SVG chart rendering, embed as image | This IS our path (replaced sharp with resvg-js but same architecture) | **Already in production** |

**Independent confirmation of the cross-viewer problem (April 2026 sources):**
> "Linked Excel charts convert to static images, breaking the dynamic link when PowerPoint files are imported into Google Slides." — Google Slides import documentation
>
> "Complex layered charts or visualizations are sometimes exported as images to preserve their appearance on slides, which sacrifices editability for visual consistency." — Google Slides import notes
>
> "Google uses web fonts while PowerPoint uses local fonts, and this transition can cause text to overflow or look incorrect when opened on different computers." — Cross-platform PPTX rendering analysis

The fundamental blocker is the OOXML chart format, not any specific library. As long as Basquio targets PowerPoint + Keynote + Google Slides simultaneously, native chart objects will render inconsistently.

### 8B.2 What WOULD unlock native PowerPoint charts in the future

If at any point Basquio:

1. **Pivots to PowerPoint-only deployment** (e.g., enterprise customers who only use M365)
   - The cross-viewer constraint disappears
   - Native PowerPoint chart objects become viable
   - Revisit `native-chart-architecture-spec.md` (currently archived)

2. **OR offers two output modes:** "compatible" (current PNG) vs "PowerPoint-native" (editable charts in-PPT)
   - Customer chooses based on their deployment
   - Native mode opt-in, with clear UX warning about Keynote/GSlides limitations
   - Requires significant pipeline duplication — only worth it if customer demand is strong

3. **OR a Microsoft + Apple + Google chart-format standard emerges** (extremely unlikely in any reasonable timeframe)

4. **OR Claude itself ships a native PPTX rendering service** (Anthropic's PPTX skill is moving in this direction but assumes PowerPoint-only)

### 8B.3 The current path remains correct

For the current customer set (Stefania, Rossella, Silvia — NIQ analysts who polish Basquio output in their own templates) the matplotlib PNG + Excel companion approach is:
- Cross-viewer pixel-perfect ✓ (PNG renders identically everywhere)
- Editable for the analyst ✓ (Excel companion gives full editability)
- Reliable at production scale ✓ (matplotlib is one of the most-tested libs in Python)
- Grid-disciplined ✓ (we control the bounding box exactly)
- Wave 1 (matplotlib design fixes from `agency-grade-design-spec.md`) closes most of the visual quality gap
- Wave 2 (R1–R15 fidelity validators) closes the data fidelity gap
- Wave 3 (per-slide visual QA loop) closes the per-slide quality gap

**No new technology in 2026 changes this answer for Basquio's current deployment.** When the customer mix or deployment shifts, revisit. Until then, ship the matplotlib + Excel architecture and stop debating.

---

## 9. Sources (SOTA 17.04.2026)

### openpyxl native charts
- [openpyxl 3.1 Charts introduction](https://openpyxl.readthedocs.io/en/3.1/charts/introduction.html)
- [openpyxl Bar and Column Charts](https://openpyxl.readthedocs.io/en/stable/charts/bar.html)
- [openpyxl Line Charts](https://openpyxl.readthedocs.io/en/stable/charts/line.html)
- [openpyxl Scatter Charts](https://openpyxl.readthedocs.io/en/stable/charts/scatter.html)
- [openpyxl Bubble Charts](https://openpyxl.readthedocs.io/en/3.1/charts/bubble.html)
- [openpyxl chart series API](https://openpyxl.readthedocs.io/en/stable/api/openpyxl.chart.series.html)
- [Add and Edit Excel Charts using Python openpyxl (PyTutorial)](https://pytutorial.com/add-edit-excel-charts-using-python-openpyxl/)
- [Plotting charts in Excel using openpyxl Set 1 (GeeksforGeeks)](https://www.geeksforgeeks.org/python/python-plotting-charts-in-excel-sheet-using-openpyxl-module-set-1/)
- [Plotting charts in Excel using openpyxl Set 2 (GeeksforGeeks)](https://www.geeksforgeeks.org/python-plotting-charts-in-excel-sheet-using-openpyxl-module-set-2/)
- [openpyxl: Automate Excel Tasks with Python (DataCamp)](https://www.datacamp.com/tutorial/openpyxl)

### NIQ analyst conventions (referenced from internal playbook)
- `docs/domain-knowledge/niq-analyst-playbook.md` Section 3 (Column Recognition)
- `docs/domain-knowledge/niq-analyst-playbook.md` Section 4 (Core 20 KPIs)

### Related internal specs
- `docs/quality-first-architecture-spec.md` — quality-first vs post-hoc correction
- `docs/agency-grade-design-spec.md` — visual quality + per-slide visual QA + no-fail publish classifier
- `docs/template-fidelity-and-depth-spec.md` — template logo + MECE depth validator

---

## 10. Handover Checklist for Next Agent

Before implementing:
- [ ] Read this spec end-to-end + the 3 related specs
- [ ] Open `/Users/marcodicesare/Desktop/fra-70-slide-opus47/data_tables.xlsx` and confirm there are ZERO chart objects today (only tables)
- [ ] Read Rossella's audit text at `/tmp/attachments/pasted_text_2026-04-17_13-48-10.txt` for direct-source quotes
- [ ] Decide: Wave 1 in PR1 (Excel native charts), Wave 2 in PR2 (fidelity validators), Wave 3 in PR3 (per-slide loop). Do NOT bundle.

Implementation:
- [ ] CLAUDE.md: max 3 pipeline commits per day
- [ ] Each PR validated against 1 production run on Fra's Kellanova brief
- [ ] Excel chart object generation must be defensive (try/except per chart, never block PPT)

Validation:
- [ ] Re-run Fra's brief at 70 slides
- [ ] Open the `data_tables.xlsx` — count native chart objects (target: ≥40 of ~50 chart-bearing slides)
- [ ] Open chart in Excel, right-click → Edit Data, verify it works
- [ ] Send to Rossella for blind comparison: time-to-build-her-own-deck before vs after

Success: Rossella opens the Excel, copy-pastes 5 charts into a NIQ template in under 10 minutes. That's the test. That's why she pays.
