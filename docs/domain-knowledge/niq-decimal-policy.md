# NIQ Decimal Policy

This file is the deterministic decimal policy for NielsenIQ-style decks and companion workbooks.

It is derived from the Rossella decimal rule file and should override heuristic formatting whenever the metric can be mapped confidently.

## Core Rule

Variations inherit the decimal precision of the base metric.

Example:

- if `Prezzo Medio` uses 2 decimals, `Var.% Prezzo Medio` also uses 2 decimals
- if `Quote` use 1 decimal, `Abs chg Quota` also uses 1 decimal

## Policy Table

| Metric family | Examples | Decimals | Notes |
|---|---|---:|---|
| Sales value / volume / packs | `V. Valore`, `V. (ALL)`, `V. Confezioni`, `Promo Sales`, `No Promo Sales` | 0 | Use 1 decimal only when shown in K / M / B units |
| Weighted / numeric distribution | `Distr. Pond.`, `Distr. Num.`, `WD Promo` | 0 | Absolute variation by default |
| Promotion pressure / promo intensity | `Promo Intensity`, `Promo Pressure` | 0 | Absolute variation unless the message explicitly needs relative % |
| TDP | `TDP`, `Total Distribution Points` | 0 | Variation often shown as % |
| Intensity index | `Intensity Index` | 1 | Absolute variation |
| Share | `Quota`, `Value Share`, `Volume Share`, `% Discount` | 1 | Applies to share-like percents and discount depth |
| Price | `Prezzo Medio`, `Avg Price`, `Avg No Promo Price`, `Avg Promo Price` | 2 | Variation may be absolute or % depending on the message |
| Average refs per store | `N. Medio Ref per pdv`, `Avg refs` | 1 | Absolute variation |
| Indices | `Price Index`, `Promo Effectiveness Index` | 0 | Absolute variation |
| Rotation / ROS / productivity | `Rotazioni`, `ROS`, `Sales per point`, `Value per distribution point` | 1 | Variation typically shown as % |

## Scaling Rule

If a value / volume / pack metric is explicitly presented in:

- thousands
- millions
- billions

use 1 decimal.

Examples:

- `€958M` -> 1 decimal if decimal is needed
- `125.5K kg` -> 1 decimal

If the metric is shown in raw base units, use the table above.

## Variation Rule

Variations should inherit the base precision and then choose the most effective representation:

- absolute if the business message is clearer in raw deltas
- percentage if the business message is clearer in relative change

The decimal count does not change when switching between base metric and variation.

## Runtime Rule

Policy resolution order:

1. canonical NIQ metric mapping
2. NIQ decimal policy table in this file
3. heuristic fallback

Heuristic inference alone is not enough for NIQ deliverables.
