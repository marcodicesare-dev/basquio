# Circana Knowledge Graph for FMCG Analyst AI

**Source:** Scraped from circana.com (April 2026). 3 of 5 files yielded content; 2 returned 404.
**Scope:** Panel methodology, churn/leakage analytics, product expansion research.
**Companion:** Use alongside `.context/fmcg-niq-canonical-pack.md` for NIQ-side knowledge.

---

## 1. Data Collection Methodology

### 1.1 Consumer Panel Architecture

Circana operates a **receipt-based longitudinal consumer panel** (as of Nov 2025, expanded to 175,000+ static U.S. participants -- the largest U.S. omnichannel receipt panel).

**Collection methods (4 streams):**

| Stream | Mechanism | What It Captures |
|--------|-----------|-----------------|
| Receipt scanning (mobile app) | Panelists photograph/upload receipts from brick-and-mortar + e-commerce | UPC-level data: item, quantity, price |
| E-receipt + loyalty card integration | Panelists link digital accounts / loyalty programs for automatic capture | Online + in-store transactions without manual effort; covers small everyday purchases |
| Supplemental surveys + purchase journals | Select panelists answer short why-behind-the-buy surveys | Purchase motivation: promotion-driven, convenience, habit |
| POS data alignment (calibration) | Panel receipts cross-referenced against retailer point-of-sale feeds | Validates panel against "market truth"; corrects missing/misclassified purchases |

**Key differentiator vs. NIQ:** Circana's panel is **receipt-first** (optical capture of real receipts) rather than barcode-scanning-first. This means:
- Captures non-barcoded items (foodservice, fresh produce)
- Captures full basket including retailer name, trip total, multi-category shopping
- E-receipt linking automates online purchase capture

### 1.2 Panelist Quality Controls

| Control | Detail |
|---------|--------|
| Representative recruitment | Balanced across demographics, regions, household types |
| Minimum submission threshold | Panelists must submit a minimum number of valid receipts per month |
| Participation-based incentives | Rewards tied to **participation** (submitting receipts), NOT to **purchases** (spend amount, specific brands) |
| Anti-influence design | No brand/retailer/spend-amount rewards that would distort shopping behavior |
| POS calibration | Continuous cross-referencing of panel data against retailer POS to correct for bias |
| Scale-based noise reduction | 175K+ households -- individual anomalies have negligible impact on aggregates |

### 1.3 POS Calibration Process

**Definition:** The process of aligning consumer-reported receipt data with actual retailer POS sales data to produce market-truth-calibrated panel metrics.

**Steps:**
1. Panel receipts are matched to retailer POS transactions at UPC level
2. Missing or misclassified purchases are identified and corrected
3. Random variation is minimized through statistical adjustment
4. Calibration is maintained across industries: grocery, beauty, general merchandise, foodservice

**Why it matters for an analyst AI:** POS-calibrated panel data can be trusted as a primary source for share-of-wallet calculations, channel shift analysis, and cross-retailer comparisons. Non-calibrated receipt panels produce systematically biased share estimates.

---

## 2. Metrics & KPIs (Circana-Specific)

### 2.1 Churn & Retention Metrics

| Metric | Definition | Use Case |
|--------|-----------|----------|
| **Buyer churn rate** | % of households that purchased in period T-1 but did NOT purchase in period T | Measures natural + competitive loss of buyer base |
| **Retail leakage rate** | % of a retailer's/brand's buyers whose spend migrated to a competitor retailer/brand in the same category | Quantifies where lost dollars are going |
| **Share of wallet** | A brand's/retailer's share of a household's total category spend | Distinguishes heavy category buyers from brand loyalists |
| **Buyer retention rate** | % of households that purchased in both T-1 and T | Inverse of churn; measures holding power |
| **Funnel replacement rate** | Rate at which new households entering a brand's buyer base replace churned households | Measures top-of-funnel health |
| **Displacement spend** | Consumer spend that shifts between categories (e.g., dining out -> grocery) due to macroeconomic pressure | Captures cross-category wallet reallocation |
| **Customer mobility** | Degree to which a consumer's brand/retailer repertoire changes over time | Identifies volatile vs. stable buyer segments |

### 2.2 Product Expansion Metrics

| Metric | Definition | Use Case |
|--------|-----------|----------|
| **Incrementality** | Whether a new product adds net new volume to category/subcategory/brand (not just shuffling existing sales) | Gate metric for retailer sell-in |
| **Cannibalization rate** | % of new product volume sourced from the same brand's existing products | Risk metric for line extensions |
| **Source of volume** | Breakdown of where a new product's sales originate: new-to-category, competitor switch, existing brand transfer | Shapes the business case for innovation |
| **Whitespace opportunity score** | Gap in the market identified via principal component analysis of attribute-level data | Identifies unmet consumer needs |
| **Concept test score** | Consumer reaction to a new product concept in a simulated shelf environment | Pre-launch demand signal |
| **Volumetric forecast** | Predicted unit/dollar sales for a new product based on consumer behavior data + simulation | Quantifies launch potential for retailer sell-in |

### 2.3 Demand & Panel Health Metrics

| Metric | Definition |
|--------|-----------|
| **Purchase frequency** | Average number of purchase occasions per household per period within a category |
| **Spend per trip** | Average dollar amount per shopping trip per household |
| **Brand switching rate** | % of households that purchased Brand A in one period and Brand B in the next |
| **Cross-category affinity** | Adjacent categories most frequently purchased by a brand's buyers |
| **Channel split** | % of category spend occurring in-store vs. online |

---

## 3. Analytical Frameworks

### 3.1 Churn/Leakage Analysis Framework

**Purpose:** Diagnose why buyers leave and where their dollars go.

**Steps:**
1. **Baseline churn measurement** -- Segment churn into natural exit (product lifecycle, e.g., durable goods like air fryers) vs. competitive churn (switched to competitor)
2. **Leakage destination mapping** -- For churned buyers, identify where they spent: which competitor brands, which competitor retailers
3. **Driver decomposition** -- Determine root cause per segment: pricing, assortment gaps, out-of-stock, convenience, promotional pull
4. **First-party + third-party fusion** -- Combine brand's CRM/loyalty data (what buyers do WITH you) with Circana panel data (what buyers do AWAY from you) for full wallet visibility
5. **Activation** -- Deploy targeted responses: pricing adjustments, assortment changes, media retargeting, supply chain fixes
6. **Continuous measurement loop** -- Track churn/leakage metrics post-intervention to measure efficacy; iterate

**Key insight from Circana:** A brand's "most valuable buyer" may actually be a heavy category buyer who splits wallet across many brands. First-party data alone cannot distinguish a loyalist from a promiscuous heavy buyer. Panel data can.

### 3.2 Supply Chain Leakage Analysis

**On-shelf availability (OSA) as a churn driver:**
- Correlate churn data with inventory/supply chain data to find specific stores where out-of-stocks drive customers to competitors
- Circana's "Liquid Supply Chain" product connects POS gaps to panel-observed retailer switching
- Actionable output: store-level OSA improvement targets

### 3.3 Product Expansion / Innovation Framework

**Purpose:** De-risk line extensions and new product launches using data.

**Steps:**
1. **Need-state assessment** -- Measure consumer satisfaction with existing assortment; determine if genuine gap exists
2. **Market structure analysis** -- Principal component analysis + shopper purchase-based market structure to find whitespace
3. **Demand space redefinition** -- Map how consumers actually categorize products (e.g., "hydration" not "carbonated soft drinks") vs. how brand historically defines category
4. **Source of volume modeling** -- Predict whether new product will attract new-to-category, switch from competitor, or cannibalize own brand
5. **Concept testing** -- Simulated shelf environment (virtual shelf sets) to measure purchase intent in realistic context
6. **Volumetric forecasting** -- Circana "Growth Predictor" tool: blends consumer behavior data with demand models to forecast sales
7. **Retailer sell-in** -- Build data-backed incrementality story showing positive impact on category, aisle, traffic, basket size
8. **Post-launch monitoring** -- Continuous tracking of actual vs. predicted performance; identify underperformers for rationalization

**Key analytical techniques mentioned:**
- Principal component analysis (PCA) on attribute-level data
- Purchase-based market structure (Hendry Market Structure model)
- Virtual shelf simulation / concept testing
- Volumetric demand forecasting
- Trade-off analysis (conjoint-style): flavor, size, price attribute trade-offs

### 3.4 Marketing Mix Modeling Integration

Circana integrates consumer panel insights with media planning via marketing mix modeling (MMM):
- Measures ROI of pricing, assortment, and marketing interventions on churn reduction
- Creates feedback loop: measure -> insight -> optimize -> re-measure
- Targets "meaningful buyer segments" based on panel-verified behavior, not self-reported demographics

---

## 4. Circana Product/Platform Glossary

| Product Name | What It Does |
|-------------|-------------|
| **Unify+** | Integrates disparate data sources (1P + 3P + POS) into single analytical view |
| **Liquid Data Go** | Self-service analytics platform for market share, trends, category performance |
| **Liquid Supply Chain** | Supply chain analytics linking POS gaps to inventory/OSA issues |
| **Growth Predictor** | Volumetric forecasting tool for new product launches |
| **Complete Consumer** | Consumer behavior monitoring tool tracking buyer trends and market signals |
| **Hendry Market Structure** | Purchase-based market structure analysis for whitespace identification |
| **Liquid AI** | Circana's AI layer powering industry rankings and automated insights |

---

## 5. Unique Circana Intelligence (Not Available from NIQ)

### 5.1 Receipt-First Panel Design
NIQ's traditional panel (Homescan) is barcode-scanner-based. Circana's receipt-capture approach inherently captures:
- **Full trip context** (total basket, retailer identification, trip spend) without requiring panelists to scan each item
- **Non-barcoded purchases** (fresh, deli, foodservice)
- **E-receipt automation** reducing panelist burden and improving coverage of online purchases

### 5.2 POS-Calibrated Panel Metrics
Circana emphasizes that their panel metrics are continuously calibrated against retailer POS data. This is a methodological differentiator: raw receipt panel data is adjusted to match POS "market truth" before being surfaced as insights. This reduces systematic bias in share and volume estimates.

### 5.3 Participation-Not-Purchase Incentive Model
Circana's incentive design rewards panelists for submitting receipts (participation), never for what they buy or where they shop. This is explicitly positioned against competitors who tie rewards to spend amounts or specific retailers, which introduces bias.

### 5.4 Integrated Demand Measurement Lens
Circana frames their offering around two pillars:
- **Measure Demand** -- understand what is happening (panel, POS, supply chain)
- **Accelerate Demand** -- act on insights (innovation, media, assortment optimization)

This framing is more activation-oriented than NIQ's traditional "track and report" positioning.

### 5.5 Discretionary vs. Non-Discretionary Spend Analysis
Circana explicitly models macroeconomic pressure on consumer wallets, tracking whether reduced spend in one category (e.g., dining out) transfers to another (e.g., grocery) or simply disappears. This "displacement spend" concept is actionable for brands navigating inflationary environments.

---

## 6. Data Coverage (Self-Reported)

- $5.8 trillion in global sales tracked
- 26 industries covered
- 2,000+ categories
- 500,000+ stores
- 175,000+ static U.S. omnichannel panelists

---

## 7. Gaps in This Extraction

The following Circana topics were targeted but returned 404 pages during scraping:
- **Innovation methodology** (`innovation.md`) -- the Circana innovation assessment framework, including Growth Predictor details, was not captured
- **Omnichannel demand measurement** (`omnichannel-demand.md`) -- the full omnichannel demand framework was not captured

These should be re-scraped or supplemented from other sources to complete the knowledge graph. Key URLs to retry:
- https://www.circana.com/solution-areas/innovation
- https://www.circana.com/solutions/growth-predictor
- Omnichannel demand measurement content (URL unknown, likely moved)
