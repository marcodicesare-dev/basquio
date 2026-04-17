# Basquio Data Fidelity Rules

Use these rules for every chart-bearing and table-bearing slide.

## 1. Source Labels

- Metric labels must use either the exact source column label or the canonical NIQ English label.
- Do not invent labels like `ACV`, `All Commodity Value`, `Penetration`, or `Brand Health` unless the exact source label is shown alongside them.

## 2. Period Ordering

- Period columns must read from past to present.
- Default order: `PY -> CY -> delta`.
- If three periods exist: `2YA -> PY -> CY -> YoY / CAGR`.

## 3. Required Delta Columns

- If a table shows share / quota, include a share delta column.
- If a table shows price, include a price delta column.
- Brand or segment tables without these deltas are incomplete.

## 4. Bar Sorting

- Ranked bar charts must be sorted.
- Valid sorts: descending value, descending delta, or explicit chronological order.
- Random order is not acceptable.

## 5. Bubble Size Disclosure

- Every bubble chart must state the bubble-size metric explicitly.
- Title pattern: `bolla = <metric>` or `bubble = <metric>`.

## 6. Source Line

- Each slide gets exactly one source line.
- Default location is the footer band.
- Do not duplicate the source under the chart and again in the footer.

## 7. Title Claims

- Any number in a slide title must be directly visible in the chart or table on that slide, or derivable from visible values with the derivation explained in body text.
- Do not state a number in the headline if the slide does not prove it.

## 8. Qualitative Claims

- Qualitative claims must be grounded in visible data, the brief, or an explicit field reference.
- Do not infer demographics, positioning, or causal explanations from prior knowledge alone.

## 9. Repetition

- Do not repeat the same chart data on multiple slides without adding a materially new cut or insight.
- Use a stable `dataSignature` to detect repeated exhibits.

## 10. Entity Grounding

- Only name retailers, brands, or other entities that exist in the uploaded input data or the explicit brief context.
- Do not inject retailer names from prior market knowledge when the evidence is only channel-level.
