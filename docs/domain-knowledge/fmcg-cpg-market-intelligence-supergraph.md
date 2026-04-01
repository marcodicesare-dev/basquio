# FMCG/CPG Market Intelligence Supergraph

**Status:** Definitive domain knowledge file for Basquio AI deck generation
**Scope:** All measurement firms (NIQ, Kantar, Circana, GfK, Euromonitor, dunnhumby), all consulting RGM frameworks (McKinsey, Deloitte, Bain, PwC, EY, Kearney), all commercial levers, all diagnostic patterns
**Last updated:** April 2026

---

## 1. Market Truth Layer -- Measurement Methodology

### 1.1 Cross-Firm Methodology Comparison

| Dimension | NIQ (RMS / Scantrack) | Kantar (Worldpanel) | Circana (Panel + POS) |
|---|---|---|---|
| **Primary method** | Retailer POS barcode scans | Household purchase panels (longitudinal) | Receipt-based longitudinal consumer panel + POS calibration |
| **What it captures** | Exact transaction volumes at store level | WHO bought, cross-category baskets, loyalty | Full trip context, non-barcoded items, e-receipts |
| **Panel scale** | POS from 900K+ stores globally | 130+ panels, 65 markets, 6 billion people represented | 175,000+ static U.S. omnichannel panelists |
| **Unique strength** | Gold standard for market share, distribution, velocity at SKU level | Usage/occasion panels, single-source attitudinal+behavioral (PanelVoice), demand moments | Receipt-first capture (non-barcoded items), POS-calibrated panel metrics, participation-not-purchase incentives |
| **Limitation** | No "who bought" -- only what sold; separate survey samples | Panel-based share estimates less granular at store level than POS | U.S.-centric panel; weaker outside North America |
| **Brand choices tracked** | N/A (POS-based) | 563 billion brand choices/year globally | $5.8 trillion in global sales tracked |
| **Categories** | Full FMCG + selective durables | 1,000 categories at measurement grade | 2,000+ categories across 26 industries |
| **Retailers tracked** | 900K+ stores | 15,000+ retailers | 500,000+ stores |
| **Brands tracked** | Comprehensive at UPC level | 50,000+ brands | Comprehensive via receipt + POS |

### 1.2 NIQ RMS Core Metrics

| Metric | Canonical Key | Formula | Domain |
|---|---|---|---|
| Sales Value | `sales_value` | Base fact (retail selling price x units) | Sales |
| Sales Volume | `sales_volume` | Base fact (category-native: kg, L, etc.) | Sales |
| Sales Units / Packs | `sales_units` | Base fact (consumer units sold) | Sales |
| Value Growth YoY | `value_growth_yoy_pct` | (CY / PY - 1) x 100 | Growth |
| Value Share | `value_share_pct` | Brand Value / Category Value x 100 | Share |
| Share Change | `share_change_pts` | Share CY - Share PY (percentage points) | Share |
| Avg Price per Volume | `avg_price_volume` | Value / Volume | Price |
| Avg Price per Pack | `avg_price_pack` | Value / Units | Price |
| Price Index | `price_index` | (Brand Price / Reference Price) x 100; 100 = parity | Price |
| Numeric Distribution | `numeric_dist_pct` | Selling stores / Universe stores x 100 | Distribution |
| Weighted Distribution | `weighted_dist_pct` | Weighted by store importance (ACV) | Distribution |
| Avg SKUs per Store | `avg_refs_per_store` | Sum item distribution / Line distribution | Assortment |
| Value ROS per Store | `ros_value_weekly` | (Value / Stores) / Weeks | Velocity |
| Promo Sales Value | `promo_value` | Base fact (sales during promotional activity) | Promotion |
| Promo Intensity | `promo_intensity_pct` | Promo Value / Total Value x 100 | Promotion |
| Baseline Sales | `baseline_value` | Estimated non-promo sales (modeled) | Baseline |
| Incremental Sales | `incremental_value` | Total - Baseline | Incrementality |
| Promo Lift | `promo_lift_pct` | Incremental / Baseline x 100 | Effectiveness |
| Segment Mix | `segment_mix_pct` | Segment Value / Total Value x 100 | Derived |
| Mix Gap | `mix_gap_pp` | Brand Mix% - Category Mix% | Derived |

### 1.3 Kantar Purchase Panel Metrics

| Metric | Definition | Analytical Use |
|---|---|---|
| Penetration | % of households/individuals who purchased a brand/category in a period | Size of buyer base; growth diagnostic |
| Loyalty | Share of category spend allocated to a brand by its buyers | Depth of relationship; retention health |
| Repeat Buyers | Buyers who purchased 2+ times in a period | Retention signal; distinguishes trial from adoption |
| New Buyers | First-time purchasers in a period | Trial/recruitment effectiveness |
| Switchers | Buyers who moved between brands across periods | Competitive vulnerability; opportunity sizing |
| Loyalists | Buyers who consistently purchase one brand | Core franchise health |
| Brand Footprint (CRP) | Consumer Reach Points = Penetration x Consumer Choice x Population | Kantar proprietary global brand ranking; the only standardized cross-market brand choice measure |

### 1.4 Circana Panel & Demand Metrics

| Metric | Definition | Use Case |
|---|---|---|
| Buyer Churn Rate | % of households that purchased in T-1 but NOT in T | Natural + competitive loss of buyer base |
| Retail Leakage Rate | % of a brand's buyers whose spend migrated to a competitor | Where lost dollars are going |
| Share of Wallet | Brand's share of a household's total category spend | Heavy category buyer vs. brand loyalist |
| Buyer Retention Rate | % of households that purchased in both T-1 and T | Inverse of churn; holding power |
| Funnel Replacement Rate | Rate at which new households entering replace churned households | Top-of-funnel health |
| Displacement Spend | Consumer spend shifting between categories due to macro pressure | Cross-category wallet reallocation |
| Customer Mobility | Degree to which consumer's brand/retailer repertoire changes over time | Volatile vs. stable buyer segments |
| Incrementality | Whether a new product adds net new volume (not cannibalization) | Gate metric for retailer sell-in |
| Cannibalization Rate | % of new product volume sourced from same brand's existing products | Risk metric for line extensions |
| Source of Volume | Breakdown: new-to-category, competitor switch, existing brand transfer | Innovation business case |
| Whitespace Opportunity Score | Gap identified via PCA of attribute-level data | Unmet consumer needs |
| Purchase Frequency | Average purchase occasions per household per period | Category engagement depth |
| Spend per Trip | Average dollar amount per shopping trip per household | Trip value metric |
| Brand Switching Rate | % of households that purchased Brand A then Brand B | Competitive fluidity |
| Cross-Category Affinity | Adjacent categories most frequently purchased by a brand's buyers | Portfolio expansion signal |
| Channel Split | % of category spend in-store vs. online | E-commerce strategy input |

### 1.5 Derivative Computation Rules

When a dataset contains only base facts, the AI must compute:

| Priority | Derived KPI | Formula | Minimum Inputs |
|---|---|---|---|
| 1 | Value Growth % | (CY / PY - 1) x 100 | Value CY + PY |
| 2 | Value Share % | Brand Value / Category Value x 100 | Value at 2 levels |
| 3 | Share Change pts | Share CY - Share PY | Value at 2 levels x 2 periods |
| 4 | Average Price | Value / Volume (or Units) | Value + Volume/Units |
| 5 | Mix % | Segment Value / Total x 100 | Value at 2 hierarchy levels |
| 6 | Mix Gap pp | Brand Mix% - Category Mix% | Mix at brand + category |
| 7 | Price Index | (Brand Price / Cat Price) x 100 | Avg Price at 2 levels |
| 8 | Concentration (CR4) | Sum top 4 shares | Share for all players |

### 1.6 Data Collection Methods Comparison

| Method | NIQ | Kantar | Circana |
|---|---|---|---|
| **POS/Retail audit** | Primary (barcode scan from retailers) | Secondary (used for grocery market share) | POS calibration layer on top of panel |
| **Household panel** | Homescan (barcode scanner) | Worldpanel Purchase (continuous) | Receipt-based (mobile app photo/upload) |
| **Usage/occasion** | Periodic surveys only | Worldpanel Usage (continuous, longitudinal) | Supplemental surveys |
| **E-commerce** | Retailer feeds | Panel captures online purchases | E-receipt + loyalty card integration |
| **Attitudinal** | Separate survey samples | PanelVoice (same panelists = single-source) | Supplemental surveys |
| **Calibration** | POS is the ground truth | Panel projected to population | Panel calibrated against retailer POS |

---

## 2. Consumer & Shopper Truth Layer

### 2.1 Kantar Brand Growth Diagnostic

Kantar's core growth framework decomposes brand performance:

1. **More buyers** (penetration growth) -- PRIMARY growth lever. Kantar/Ehrenberg-Bass research consistently shows penetration is the #1 driver.
2. **More occasions** (frequency/loyalty) -- SECONDARY lever.
3. **More spend per occasion** (premiumization/upsizing) -- TERTIARY lever.

Formula: **Penetration x Frequency x Spend per Trip = Total Brand Revenue**

### 2.2 Shopping Missions Taxonomy (Kantar Worldpanel)

Kantar classifies every shopping basket into mission types. NIQ does not have an equivalent standardized mission classification at this granularity.

| Mission | Description | Price Premium vs. Main Shop | Typical Channel |
|---|---|---|---|
| **Main Shop / Trolley Shop** | Large stock-up trip; full weekly shop | Baseline (reference) | Hypermarket, Supermarket |
| **Top-Up** | Smaller replenishment trip between main shops | Moderate | Supermarket, Convenience |
| **For Tonight** | Same-day meal/occasion purchase | **+19%** per item | Convenience, Supermarket |
| **Specific Journey** | Purpose-driven trip (BBQ, Sunday dinner, celebration) | **+52%** per item | Varies by occasion |
| **Immediate Consumption** | Small baskets for instant use | High | Convenience, Food Service |

Key trend (2023 data): "Main Shop" share returned to 2013 levels after 7 years of gradual decline pre-lockdown. Fewer shoppers visit multiple stores. Implication: NPD focus shifting from specialization to value proposition within single-store main shop.

### 2.3 Mission-Level Analytics

| Analysis Type | What It Reveals | Strategic Application |
|---|---|---|
| Mission mix by retailer | Which retailer captures which missions | Channel strategy; distribution prioritization |
| Price premium by mission | Quantified premiums justify premium NPD | Premium NPD positioning (19% for "For Tonight", 52% for "Specific Journey") |
| NPD alignment by mission | Different missions demand different propositions | Main Shop = value; Top-Up = convenience; For Tonight = premium/treat; Specific Journey = occasion bundles |
| Cross-category basket composition | What else is in the basket when brand is purchased | Cross-sell opportunities; adjacency strategy |

### 2.4 Category Roles (Industry Standard, Kantar CatMan)

| Role | Definition | Strategic Implication |
|---|---|---|
| **Destination** | Drives store choice; shoppers specifically seek out | Invest heavily; competitive pricing; widest assortment |
| **Core / Routine** | Everyday categories expected to be available | Maintain strong availability; competitive pricing |
| **Convenience** | Fills immediate needs; impulse-driven | Premium pricing acceptable; visibility critical |
| **Seasonal** | Time-bound demand spikes | Promotional windowing; event-driven assortment |

### 2.5 Demand Moments Framework (Kantar Worldpanel Usage)

Kantar's proprietary approach decomposes consumption at the micro-occasion level:
- Every eating/drinking event captured as a "moment" with attributes: time of day, location, social context, need-state, food/drink category, brand
- Enables identification of growing, declining, and emerging consumption moments
- Connects purchase data (what was bought) to usage data (when/how consumed)
- Closes the loop: purchase -> consumption -> motivations -> brand choice
- Tracks 4 million+ food and drinks occasions

**Unique to Kantar:** NIQ does not have an equivalent continuous usage panel. NIQ's consumption data comes from periodic surveys or third-party partnerships, not longitudinal behavioral tracking.

### 2.6 Occasion Types for Occasion-Based Marketing

| Occasion Type | Examples | Timing Pattern |
|---|---|---|
| Sporting events | Olympics, Super Bowl | Food purchases 1 week in advance; event items 2+ weeks |
| Cultural holidays | Christmas, Easter, Thanksgiving | Long lead-time planning |
| Gifting occasions | Valentine's Day, Mother's/Father's Day | 2-3 weeks advance |
| Seasonal events | Back-to-School, Memorial Day, 4th of July | Varies by retailer (Walmart: 1 week; Target: 2 weeks) |
| Entertainment | Halloween, BBQ season | Category-specific timing |

Key insight: Food retailers win food-based events. Mass merchandisers win food + item events. Cross-category partnerships are effective for mixed-item occasions like Back-to-School.

### 2.7 Purchase-to-Usage Loop (Kantar Exclusive)

NIQ tracks what was bought. Kantar tracks what was bought AND how/when/where it was consumed. This enables:
- **Waste analysis:** What is purchased but not consumed?
- **Substitution mapping:** What do consumers use instead of your product in specific occasions?
- **Portfolio white space:** Which consumption moments have no brand present?
- **Format optimization:** Which pack sizes match which usage occasions?

### 2.8 OOH vs. Take-Home Dynamics (Kantar)

Kantar tracks both in-store purchases and out-of-home consumption (cafes, restaurants, takeaways, food service). Proven insight: **OOH spend growth in drinks and snacks does NOT cannibalize take-home sales -- they are additive.** NIQ primarily covers retail sell-through; OOH is a separate data universe.

### 2.9 Single-Source Attitudinal + Behavioral (Kantar PanelVoice)

PanelVoice surveys the exact same people whose purchases are tracked. This eliminates the sample-matching problem that plagues separate survey + panel approaches. You can directly correlate "consumers who say X" with "consumers who buy Y."

### 2.10 Circana Churn/Leakage Analysis Framework

**Purpose:** Diagnose why buyers leave and where their dollars go.

| Step | Action | Detail |
|---|---|---|
| 1 | Baseline churn measurement | Segment churn into natural exit (product lifecycle) vs. competitive churn (switched to competitor) |
| 2 | Leakage destination mapping | For churned buyers: which competitor brands, which competitor retailers |
| 3 | Driver decomposition | Root cause per segment: pricing, assortment gaps, out-of-stock, convenience, promotional pull |
| 4 | First-party + third-party fusion | Combine brand CRM/loyalty data (what buyers do WITH you) with panel data (what buyers do AWAY from you) |
| 5 | Activation | Targeted responses: pricing adjustments, assortment changes, media retargeting, supply chain fixes |
| 6 | Continuous measurement loop | Track churn/leakage post-intervention to measure efficacy; iterate |

**Key insight:** A brand's "most valuable buyer" may be a heavy category buyer who splits wallet across many brands. First-party data alone cannot distinguish a loyalist from a promiscuous heavy buyer. Panel data can.

### 2.11 Supply Chain Leakage (Circana)

On-shelf availability (OSA) as a churn driver:
- Correlate churn data with inventory/supply chain data to find stores where out-of-stocks drive customers to competitors
- Circana's "Liquid Supply Chain" product connects POS gaps to panel-observed retailer switching
- Actionable output: store-level OSA improvement targets

### 2.12 GfK Consumer Life / TrendKey Framework

GfK's TrendKey framework maps consumer values and psychographics across markets:
- Tracks how consumer values shift over time (security, sustainability, experience, health)
- Identifies attitudinal segments that cut across demographics
- Maps psychographic clusters to purchase behavior
- Enables brand positioning against consumer value systems rather than demographics alone

### 2.13 Shopper Segmentation Approaches

| Firm | Segmentation Basis | Key Output |
|---|---|---|
| NIQ | Purchase behavior (Homescan) | Heavy/medium/light buyers; brand loyalists vs. switchers |
| Kantar | Purchase + usage + attitudes (PanelVoice) | Mission-based segments; demand moment clusters |
| Circana | Receipt-based behavior + POS-calibrated | Share-of-wallet segments; churn-risk tiers |
| GfK | Psychographic values (Consumer Life) | Value-based attitudinal segments |
| dunnhumby | Loyalty card transaction data | Price sensitivity segments; basket affinity clusters; personalization tiers |

---

## 3. Commercial Levers Layer

### 3.1 The Five RGM Levers (Industry Consensus)

| Lever | Description | Key Metrics |
|---|---|---|
| **Pricing** | Base/list pricing, EDLP, dynamic pricing, price ladders | Price index, price elasticity, price gap vs. competition |
| **Promotions** | Trade promotions, TPR, multi-buy, display, feature | Promo intensity, promo lift, incremental sales, promo ROI |
| **Assortment / Mix** | SKU rationalization, portfolio optimization, range review | SKUs per store, distribution, velocity, mix gap, Pareto (CR4) |
| **Price-Pack Architecture (PPA)** | Pack size, format, price-point design across channels | Price per unit by format, price ladder coverage, WTP |
| **Trade Terms / Trade Investment** | Gross-to-net management, retailer contracts, JBP terms | Trade rate, working vs. non-working trade, retailer passthrough |

### 3.2 PPA Four Pillars

| Pillar | Description | Key Activities |
|---|---|---|
| **Price Elasticity Modeling** | Forecasts, optimized pricing, competitor awareness | Elasticity curves, cross-price effects, simulation |
| **Value Perception Scoring** | Aligned features, effective communication, customer focus | Consumer research, value-for-money tracking, pack claims |
| **Competitive Positioning** | Competitive advantages, effective countermoves, market awareness | Price gap analysis, competitive response modeling |
| **Consumer Willingness to Pay (WTP)** | Accurate estimation, revenue maximization, informed product development | Conjoint analysis, Van Westendorp, Gabor-Granger |

### 3.3 PPA 7-Step Implementation

| Step | Name | Key Activities |
|---|---|---|
| 1 | Category Deep Dive | Map competitive landscape, track price-pack trends, identify white spaces, analyze consumer behavior |
| 2 | Value Proposition Development | Map consumer decision hierarchy, identify key value drivers, track emerging need states |
| 3 | Price Pack Design | Create distinct value propositions, cover all key price points, build flexibility for future innovation |
| 4 | Financial Modeling | Model complete P&L impact, account for cross-SKU cannibalization, factor competitor responses, sensitivity analysis |
| 5 | Go-to-Market | Clear value communication, phased implementation, robust tracking, internal alignment |
| 6 | Continuous Optimization | Monitor performance, track consumer response, watch competitor moves, adjust quickly |
| 7 | (Iterate) | Review and restart cycle based on market dynamics |

### 3.4 PPA Strategy by Market Type

| Market Type | Approach | Key Characteristics |
|---|---|---|
| **Developed** | AI-enabled insights, mid-tier customer modeling, nuanced pricing | Discount stacking rules vary by country; sophisticated channel strategies |
| **Semi-developed** | Mix of modern and traditional trade | Sachet economy coexists with premiumization; segment shoppers and channels precisely |
| **Developing** | Visibility is victory; multilayered distribution | Balance top-down standards with on-the-ground realities |

### 3.5 Channel-Specific PPA

| Channel | Strategy | Example |
|---|---|---|
| E-commerce | Convenience packs, club packs for pantry-loaders | Price transparency creates channel conflict challenges |
| Mass retail | Value packs, multi-buy formats | Volume-driven shoppers |
| Premium channels | Experience-led packs | Premiumization positioning |
| Quick commerce | Trial/impulse packs | INR 20 trial packs driving 30% repeat purchase |

### 3.6 Category Management 8-Step Process (Kantar)

| Step | Name | Key Activity |
|---|---|---|
| 1 | Define Categories | Group products by consumer need/usage similarity |
| 2 | Assess Roles | Assign Destination / Core / Convenience / Seasonal role |
| 3 | Assess Performance | Benchmark against retailer sales data and competitors; Category Scorecard |
| 4 | Set Objectives & Targets | Goals for margin, sales, volume; tracked via Category Scorecard |
| 5 | Devise Strategies | Transaction Building (increase basket), Excitement Building (trial/engagement), Image Enhancing (premiumization) |
| 6 | Set Tactics (4 P's) | Product (assortment), Price, Placement (planogram/shelf), Promotions (aligned to purchase timelines) |
| 7 | Implement | Execute via planograms; embody category plan physically |
| 8 | Review | Continuous; reflect changing consumer environment |

### 3.7 Category Scorecard Metrics

Tracking instrument for category objectives (CatMan Step 4):
- Sales (value, volume, units)
- Margin (gross, contribution)
- Category growth vs. market
- Share of category by brand/supplier
- Promotional uplift
- Distribution metrics (numeric, weighted)

### 3.8 Circana Product Expansion / Innovation Framework

| Step | Name | Detail |
|---|---|---|
| 1 | Need-State Assessment | Measure consumer satisfaction with existing assortment; determine if genuine gap exists |
| 2 | Market Structure Analysis | PCA + shopper purchase-based market structure to find whitespace |
| 3 | Demand Space Redefinition | Map how consumers actually categorize products (e.g., "hydration" not "carbonated soft drinks") |
| 4 | Source of Volume Modeling | Predict: new-to-category, competitor switch, or own-brand cannibalization |
| 5 | Concept Testing | Simulated shelf environment (virtual shelf sets) to measure purchase intent |
| 6 | Volumetric Forecasting | Circana "Growth Predictor": consumer behavior data + demand models |
| 7 | Retailer Sell-In | Data-backed incrementality story: positive impact on category, aisle, traffic, basket size |
| 8 | Post-Launch Monitoring | Actual vs. predicted performance; identify underperformers for rationalization |

Key analytical techniques:
- Principal Component Analysis (PCA) on attribute-level data
- Purchase-based market structure (Hendry Market Structure model)
- Virtual shelf simulation / concept testing
- Volumetric demand forecasting
- Trade-off analysis (conjoint-style): flavor, size, price attribute trade-offs

### 3.9 NIQ Innovation / BASES Metrics

| Metric | Definition | Use |
|---|---|---|
| Trial Volume | Predicted first-purchase volume from concept/product test | Launch sizing |
| Repeat Rate | % of triers who repurchase within defined window | Adoption signal |
| Incrementality | Net new volume to brand/category (not just redistribution) | Retailer sell-in story |
| Awareness-to-Trial Conversion | % of aware consumers who purchase | Marketing effectiveness |
| Trial-to-Repeat Conversion | % of triers who become repeat buyers | Product-market fit signal |

### 3.10 TPM vs. TPO

| Capability | TPM (Trade Promotion Management) | TPO (Trade Promotion Optimization) |
|---|---|---|
| Function | Plans, budgets, contracts, claims tracking | Predicts, simulates, improves incremental impact |
| Output | Execution management | Reallocation from weak to strong events |
| Maturity | Baseline (most companies) | Advanced (minority of companies) |
| Benchmark | Nearly half of large European CPGs have no TPO tool (McKinsey) | TPO ROI improvement from reallocation: 2-4 pp |

### 3.11 Operationalizing TPO in JBP

- Arrive at JBP with **3 pre-simulated promotion options per window**, each with modeled incremental units, retailer margin, and category impact
- Set joint targets for on-time execution and on-shelf availability
- Publish one-page recap after each event with net incrementality and agreed next steps
- Key JBP KPIs: incremental units, new-to-brand rate, contribution margin, display compliance

---

## 4. Financial Levers Layer

### 4.1 Full Gross-to-Net Waterfall

**Gross Revenue** (total invoiced dollars before any deductions)

**Contra Revenue (9 items, above the line):**

| # | Line Item | Description |
|---|---|---|
| 1 | Cash Term Discounts | Early payment incentives |
| 2 | Slotting Fees | Payment for shelf space (gray area: trade-related but often separate budget) |
| 3 | Manufacturer Chargebacks (MCBs) | Retailer-imposed cost adjustments |
| 4 | Off-Invoice Discounts | Deductions at point of invoicing |
| 5 | EDLPs (Everyday Low Prices) | Ongoing price support to maintain shelf price |
| 6 | Fair Share | Distributor allocation programs |
| 7 | Spoilage Allowances | Compensation for product spoilage/waste |
| 8 | Short Shipments | Deductions for incomplete deliveries |
| 9 | Returns | Product returns from retailers |

= **Net Revenue** (Gross Revenue - Contra Revenue)

**Cost of Sales (4 items, above the line):**

| # | Line Item | Description |
|---|---|---|
| 1 | Freight and Delivery Costs | Transportation to retailer |
| 2 | Damaged Goods | Cost of product damage in transit/storage |
| 3 | Shipping Penalties | Fines for delivery failures |
| 4 | Fulfillment Fees | Warehouse/picking/packing costs |

= **Gross Profit** (Net Revenue - Cost of Sales)

**Below the Line (SG&A / Trade Marketing):**
- Retailer Ads
- Coupons
- Displays
- Admin Fees

### 4.2 Trade Spend Classification

| Category | Type | Examples | Consumer Impact |
|---|---|---|---|
| **Working Trade Spend** | Directly influences consumer purchase | Scan-based discounts (TPRs), retailer ads, coupons, display programs | Yes -- drives trial, conversion |
| **Non-Working Trade Spend** | Supports shelf access, no consumer influence | Spoilage, distributor programs ("Fair Share"), admin fees | No -- cost of doing business |
| **Trade Deductions (Promotional)** | Promotion-related | Promotions, EDLPs, display fees, promo admin fees, advertising, fair share | Mixed |
| **Non-Trade Deductions (Operational)** | Operations-related | Logistics fees, spoils, shortages, fines and penalties | No |

Benchmark: Non-working trade typically ~20% of total trade spend. For every $10M in trade, ~$2M may go to non-converting programs.

### 4.3 All 22 Trade Spend KPIs (with Definitions and Formulas)

| # | KPI | Definition | Formula / Notes |
|---|---|---|---|
| 1 | **Trade Rate** | Total trade spend as % of gross revenue | Trade Spend / Gross Revenue |
| 2 | **Blended Trade Rate** | Trade spend % over a set period, smoothing across events | Total Trade Spend / Total Revenue over period |
| 3 | **Trade Promotion ROI** | Return on promotional investment | (Incremental Gross Margin - Promotional Spend) / Promotional Spend |
| 4 | **True ROI** | Incremental net revenue per dollar of event spend | Incremental Net Revenue / Total Event Spend; breakeven = 1.0 |
| 5 | **Incremental Sales** | Volume above what would have sold without promotion | Actual Promoted Volume - Modeled Baseline Volume |
| 6 | **Incremental Revenue** | Revenue from incremental volume | Incremental Volume x Net Price Realized |
| 7 | **Contribution Margin ROI** | Return after all deductions | Incremental Contribution Margin / Total Spend |
| 8 | **Account Profitability** | Net profit per account after trade spend | Net Revenue per Account - Trade Spend per Account - Allocated Expenses |
| 9 | **Event Spend ROI** | Return on non-promoted activities | Incremental Revenue from Non-Promo Activities / Total Event Spend |
| 10 | **Promotion Effectiveness** | Composite: uplift + ROI + acquisition | Sales Uplift + Promo ROI + Customer Acquisition Rate |
| 11 | **Customer Lifetime Value (CLV)** | Total expected revenue from customer relationship | Sum of discounted future revenues from a customer |
| 12 | **Sales Uplift** | % increase during promotion vs. baseline | (Promoted Volume - Baseline Volume) / Baseline Volume x 100 |
| 13 | **New-to-Brand Rate** | % of promo buyers who are new to brand | New Brand Buyers During Promo / Total Promo Buyers x 100 |
| 14 | **Repeat Rate** | % of promo buyers who repurchase within 8-12 weeks | Repeat Buyers / Total Promo Buyers x 100 |
| 15 | **Display/Feature Compliance** | % of planned displays actually executed in-store | Executed Displays / Planned Displays x 100 |
| 16 | **OOS During Event** | Out-of-stock rate during promotional window | OOS Stores During Event / Total Stores x 100 |
| 17 | **Halo Effect** | Positive volume lift on adjacent SKUs/categories from a promotion | Volume Lift on Non-Promoted Adjacent Items |
| 18 | **Cannibalization Rate** | % of promo lift sourced from sibling SKUs | Sibling SKU Volume Loss / Promo Incremental Volume x 100 |
| 19 | **Deduction Recovery Cycle Time** | Days to resolve/recover trade deductions | Average days from deduction claim to resolution |
| 20 | **Retailer Margin** | Margin earned by retailer on promoted events | (Retailer Selling Price - Retailer Cost) / Retailer Selling Price |
| 21 | **Retailer Passthrough** | Price support actually passed to consumer | Consumer Price Reduction / Manufacturer Price Support x 100 |
| 22 | **Promo/Event ROI** | Revenue impact ensuring no negative portfolio impact | Net Portfolio Revenue Impact / Total Event Spend |

### 4.4 Key Formulas

```
Trade Rate          = Trade Spend / Gross Revenue
Trade Budget        = Target Trade Rate x Projected Revenue
Trade Promotion ROI = (Incremental Gross Margin - Promotional Spend) / Promotional Spend
True ROI            = Incremental Net Revenue / Total Event Spend  (breakeven = 1.0)
Incremental Lift    = Actual Promoted Volume - Modeled Baseline Volume
Blended Trade Rate  = Total Trade Spend / Total Revenue (over period)
Net Revenue         = Gross Revenue - Contra Revenue
Gross Profit        = Net Revenue - Cost of Sales
Brand Footprint CRP = Penetration x Consumer Choice x Population
```

### 4.5 Trade Investment Benchmarks

| Benchmark | Value | Source |
|---|---|---|
| Trade spend as % of gross sales | **20-30%** | Deloitte |
| Trade spend as % of gross revenue | **~20%** | McKinsey |
| Trade spend as 2nd largest P&L line | After COGS | Deloitte |
| Target trade rate (emerging brand) | **15%** of gross revenue | TrewUp |
| Non-working trade as % of total | **~20%** | TrewUp |
| Promotional sales as % of retail volume (Europe) | **28-50%** | McKinsey/IRI |
| Promo events that underperform | **Majority** | McKinsey, Bain |
| Promo investment contributing to category growth | Only **~20%** (80% fails) | Bain |
| Promo sales cannibalizing non-promo sales | **~50%** | Bain |
| SKUs generating unneeded complexity | **~70%** (delivering <5% of category revenue) | Bain |
| RGM programs delivering joint profit growth | Only **~25%** (75% fail for both retailer and manufacturer) | Bain |

### 4.6 Impact Benchmarks

| Impact Area | Benchmark | Source |
|---|---|---|
| RGM annualized gross margin gain | **4-7 percentage points** | McKinsey |
| RGM gross profit improvement | **3-5% of gross profit per year** | Deloitte |
| Precision promo EBITDA improvement | **4-5%** EBITDA, 1-2 pp margin | McKinsey (European CPG case) |
| Precision promo additional sales | **1-2%** incremental | McKinsey |
| PPA EBIT margin impact | Up to **4 percentage points** | Roland Berger |
| Advanced collaboration top-line growth | **Mid-single-digit** | Deloitte |
| TPO ROI improvement from reallocation | **2-4 percentage points** | TPO guide |
| Quick wins from TPO | **1-2 promotional cycles** to see ROI | TPO guide |
| RGM quick wins in Year 1 | Up to **20%+** of expected RGM upside | Bain |
| Wasted spend uncovered (visibility exercise) | **$50M** (single food supplier, SE Asia) | PwC |
| Brands trying new brands during COVID | **30-40%** of shoppers | McKinsey |
| 90% of product launches fail to meet financial targets | Often linked to ineffective pricing | Industry |
| 70% of consumers more price-conscious | Yet 67% still willing to pay more for genuine value | Industry |
| Unilever weather-based demand forecasting | **~30% sales increase** in certain ice cream markets | Case study |

### 4.7 Margin Pool Analysis Metrics

| Metric | Definition |
|---|---|
| Gross Margin | Net Revenue - COGS, as % of Net Revenue |
| Contribution Margin | Net Revenue - Variable Costs (COGS + trade spend) |
| Trade Profit (Bain) | Retailer economics improvement -- must-have KPI for RGM negotiation |
| 360-Degree Manufacturer ROI (Bain) | Includes supply chain and procurement impact, not just sales P&L |
| Joint Profit Pool | Combined retailer + manufacturer profit from a category/promotion |
| EBITDA Margin Impact | Precision promotions: 4-5% EBITDA improvement, 1-2 pp margin increase (McKinsey) |
| EBIT Margin Impact | Enhanced PPA: up to 4 pp increase (Roland Berger) |

### 4.8 Private Label Economics

| Metric | Value | Source |
|---|---|---|
| U.S. private label market size | **$283 billion** | Industry data 2025 |
| Private label growth vs. national brands | **3x** growth rate | Industry data 2025 |
| Private label share (U.S. grocery) | **~20%** and rising | Industry data |
| Retailer gross margin on PL vs. branded | **+10-15 pp** higher for PL | Industry average |
| PL quality perception improvement | Accelerating (was barrier; now parity or better in many categories) | Euromonitor/industry |

---

## 5. Consulting & Decision Systems Layer

### 5.1 Named RGM Frameworks (All 8)

| # | Framework | Source | Description |
|---|---|---|---|
| 1 | **Trifecta Approach** | Bain | Maximize value simultaneously for consumers, retailers, and manufacturers. Three must-have KPIs: trade profit, consumer value, 360-degree manufacturer ROI. |
| 2 | **Precision RGM** | McKinsey | Four maturity levels for promotion capabilities: (1) Basic ROI, (2) Standard optimization, (3) Promotion-impact simulation, (4) Household penetration + microtargeting. |
| 3 | **Modern vs. Traditional RGM** | Deloitte | Shift from rudimentary single-metric approaches to balanced scorecarding, portfolio mindset, sell-out insistence. |
| 4 | **Three-Speed RGM** | PwC | Segment markets into Developed (AI-enabled), Semi-Developed (hybrid trade), Developing (visibility-first). |
| 5 | **RGM Maturity Index** | Bain | Proprietary index measuring RGM capabilities based on 200+ benchmarks. |
| 6 | **Six Interlocking Elements** | Bain | (1) Transparency & alignment, (2) Operating model, (3) Path to excellence, (4) Tools & data power, (5) Convert insights into results, (6) Ensure repeatability & continuous improvement. |
| 7 | **Balanced Scorecarding** | Deloitte | Multi-metric evaluation of promotions considering performance, strategy, and retailer outcome. |
| 8 | **Market Archetype Segmentation** | PwC | Classify markets by 6 characteristics: trade classification, route-to-market complexity, data availability, financial controls, regulatory environment, local RGM talent. |

### 5.2 RGM Maturity Stages (Composite, 4 Levels)

| Level | Name | Characteristics |
|---|---|---|
| 1 | **Basic** | Spreadsheet-based, single-metric, sell-in data, gut-feel planning |
| 2 | **Standard** | Basic ROI tracking, internal data, limited promotion optimization |
| 3 | **Advanced** | Predictive simulators, multi-metric balanced scorecards, sell-out data, cross-portfolio analysis |
| 4 | **Precision** | Household-level penetration analysis, microtargeting, loyalty-card data integration, real-time AI-enabled optimization |

Note: Nearly half of large European CPGs have no TPO tool; most companies stall at Level 2 (McKinsey).

### 5.3 Joint Business Planning Frameworks

#### Deloitte JBP Framework ("Winning with Retail")

Five Collaboration Opportunity Areas:
1. **Joint Business Planning (JBP)**: Real-time alignment system with shared data, transparent targets, AI-enabled decision-making
2. **Revenue Growth Management (RGM)**: Common RGM vision for price perception, promo efficiency, category growth
3. **Innovation**: Joint ambition-setting, first-party data sharing, AI-enabled concepting
4. **Route to Market (RTM)**: Shared view of priorities, lower-cost/higher-service value chain
5. **Talent**: Free teams from capacity bottlenecks to focus on value creation

Key findings (Deloitte 2026 Benchmark Study):
- 73% of companies increased collaboration over past 5 years
- 86% saw higher sales from collaboration
- Companies want to collaborate 1.2x-2x more than they do today
- Advanced collaboration can deliver **mid-single-digit top-line growth**
- JBP Perception Gap: ~90% of retailers want stronger collaboration, but CPGs perceive "lack of desire" as top barrier. Capacity constraints, not willingness, are the true culprit.

#### Bain "Customer GM Mindset"

Multifunctional teams sharing the ultimate goal of growing the **joint profit pool** of both retailer and manufacturer. RGM insights must be realistic and flexible, not just analytically elegant.

### 5.4 Operating Model Design

#### Kearney RGM Operating Model (2025 Brief, n=51 CPG practitioners)

**Move 1: Give RGM a seat at the table**
- 71% of global RGM leads sit at same level as P&L owner or one step below
- 84% at regional levels, 88% at market levels
- 56% report to business profit center (not functional cost center)
- Leading orgs: 85%+ report directly to or one level below P&L owners
- Two-thirds of regional organizations combine RGM and commercial development responsibilities

**Move 2: Build capacity where it can scale**
- Leading organizations: **5.9 RGM FTEs per 1,000 employees** (2.3x that of progressing companies at 2.6)
- Tiered operating model:
  - Global centers: Define frameworks, guardrails, analytical toolkits
  - Regional hubs: Apply frameworks, define value creation opportunities, drive adoption (~21% of RGM staff)
  - Shared services centers: Data processing, automation, analysis, reporting (~10% of RGM staff)
  - Local teams: Apply plays to local consumers and customers (<50% of RGM staff in leading orgs)

**Move 3: Embed RGM early in value definition**
- Leading companies involve RGM in core innovation pricing and commercial innovation
- Greater integration in financial planning and portfolio management
- Opportunity: tactical S&OP, where RGM often plays limited role despite relevance

#### EY RGM Operating Model
- Cross-functional approach: CCO, CIO, CFO as key stakeholders
- Center of Excellence (CoE) model for multi-market execution
- Technology that decouples data from analytics, supporting entire IBP cycle
- Change management with communications, stakeholder engagement, business readiness, training

#### PwC Operating Model Principles
- RGM-as-a-Service: Shared global expertise, centralized analytics, locally deployed insights
- Regional Centers of Excellence to lift capability across adjacent markets
- RGM embedded as cross-functional capability within finance, sales, and category management
- Segment markets by archetype, not just geography

#### Bain Operating Model Principles
- Customer GM mindset: Multifunctional teams sharing goal of growing joint profit pool
- Build on existing commercial routines (don't redesign everything)
- Upgrade performance management KPIs to ensure RGM woven into customer planning
- End-user-back technology design: save time for commercial front line
- MVS (Minimum Viable Solution) approach: launch quickly in test markets, then scale

### 5.5 Five Barriers to Scaling RGM (Kearney)

| # | Barrier | Detail |
|---|---|---|
| 1 | Technology & data foundations | 50% cite as major challenge |
| 2 | Capability gaps | Only 14% have scaled RGM upskilling; of those, just 14% rate content as high quality |
| 3 | Capacity constraints | 83% of leading firms cite as top-2 barrier |
| 4 | Process integration | 9 in 10 early-stage companies cite as key barrier |
| 5 | People/structural issues | ~33% cite, but often symptom of integration/ownership/automation gaps |

### 5.6 RGM Governance Metrics

| Metric | Value | Source |
|---|---|---|
| CEOs saying RGM is key enabler | 67% | Kearney |
| RGM leads feeling equipped to perform | Only 33% | Kearney |
| Top 20 CPGs describing RGM as central | 50%+ | Industry |
| CPGs highlighting RGM as important | 80%+ | Deloitte |
| CP chief executives dissatisfied with RGM results | 80%+ | Bain |
| CPGs with increased marketing/promo spending as top priority | 51% | KPMG 2024 |

### 5.7 Issue Trees and Diagnostic Structure

Standard FMCG issue tree decomposition:

```
Revenue Shortfall
├── Volume problem
│   ├── Distribution (numeric, weighted)
│   │   ├── New store listings
│   │   └── Delisted stores
│   ├── Velocity (ROS per store)
│   │   ├── Base velocity
│   │   └── Promotional lift
│   └── Portfolio (mix, SKU count)
│       ├── New product contribution
│       └── Tail rationalization
├── Price problem
│   ├── List price vs. competition
│   ├── Promotional depth
│   └── Mix shift (channel, pack, format)
└── Trade spend efficiency
    ├── Working trade ROI
    ├── Non-working trade reduction
    └── Retailer compliance
```

### 5.8 AI in RGM (Kearney 2025)

| Metric | Value |
|---|---|
| Organizations with AI pilots in RGM | **53%** (mostly small-scale) |
| Systematic, scaled AI rollouts | **~10%** |
| Centralized data lake adoption | 40%+ overall; ~60% among advanced players |
| Global product owners for RGM technology | 49% |

AI pilot focus areas (ranked):
1. Data analysis (low-code/no-code tools for visualization, interpretation, automation)
2. Data integration (visual recognition of retailer contracts, syndicated data lake)
3. Recommendation engines
4. Chatbots/copilots for natural language recognition

Three moves to scale AI in RGM:
1. Codified RGM process blueprint: common strategy, KPIs, planning rhythms
2. Governed single source of truth: clean data layer with shared semantics, KPI definitions, automated quality checks
3. Embed product ownership into delivery: accountability, investment, operating model placement

AI in Category Management (Kantar 2025 Study):
- Manufacturer priorities: (1) Shopper insights, (2) Performance monitoring, (3) New product innovation
- Retailer priorities: (1) Shopper engagement, (2) Performance monitoring, (3) Shopper insights
- Highest-impact AI functions: demand planning, competitive analysis, pricing strategy, trend identification, shopper research, strategic business planning, promotional planning, assortment planning

---

## 6. Foresight & Trends Layer

### 6.1 Euromonitor 2026 Global Consumer Trends

| Trend | Description | Benchmark / Signal |
|---|---|---|
| **Comfort Zone** | Consumers prioritize emotional well-being, self-care, stress reduction; seek products that provide comfort and familiarity | Wellness economy valued at $1.8T globally; "comfort" claims growing 15%+ YoY in food/beverage |
| **Fiercely Unfiltered** | Authenticity over perfection; consumers reward brands that show real, unpolished identity; reject over-produced marketing | Social media engagement 2-3x higher for "authentic" content; brand trust correlated with transparency |
| **Rewired Wellness** | Health-wellness convergence goes mainstream; technology-enabled health tracking; personalized nutrition; gut health, sleep, mental health as purchase drivers | Functional food market growing at 8-10% CAGR; sleep aid market $100B+ globally by 2028 |
| **Next Asian Wave** | Asian beauty, food, and wellness trends going global; K-beauty, J-beauty, Asian functional ingredients (matcha, turmeric, gochujang) mainstreaming | Asian beauty exports growing 20%+ YoY; Asian flavors fastest-growing segment in western markets |

### 6.2 GfK TrendKey Framework

GfK Consumer Life tracks global consumer values shifts:
- Security vs. adventure orientation
- Individual vs. collective focus
- Tradition vs. innovation openness
- Material vs. experiential priorities
- TrendKey scores enable brand positioning against evolving consumer psychographics

### 6.3 Private Label Structural Shift

| Metric | Value |
|---|---|
| U.S. private label market size | **$283 billion** |
| Growth rate vs. national brands | **3x** |
| U.S. grocery share | ~20% and rising |
| European grocery share | 30-40% in major markets (UK, Germany, Spain) |
| Retailer margin premium on PL | +10-15 pp vs. branded |
| Quality perception | Parity or better in many categories (accelerating) |

Strategic implications:
- Brands must demonstrate incremental value beyond PL (innovation, premiumization, brand equity)
- Trade negotiations shift as retailers have credible "build vs. buy" option
- PPA strategies must account for PL price anchoring
- Category management must explicitly model PL share trajectory

### 6.4 Health-Wellness Convergence

- Functional food market growing 8-10% CAGR
- Gut health, probiotics, adaptogens mainstreaming from niche
- Clean label demands increasing across categories
- Plant-based stabilizing after hype cycle; finding sustainable niche
- Personalized nutrition enabled by wearables and data
- Mental health and sleep emerging as product positioning dimensions

### 6.5 Retail Media Networks

- Retailer-owned advertising platforms (Amazon, Walmart Connect, Kroger Precision Marketing, Tesco Clubcard media)
- Rapidly growing share of CPG advertising budgets
- Closed-loop measurement: connect ad exposure to purchase
- Implications for trade spend allocation: blurring line between trade and media budgets
- dunnhumby pioneered retailer media with Tesco; now industry-wide

### 6.6 dunnhumby / Loyalty-Based Intelligence

| Capability | Description |
|---|---|
| Customer Data Science | Transaction-level loyalty card data fueling personalization |
| Price sensitivity segments | Cluster shoppers by price response patterns |
| Basket affinity analysis | Identify product adjacencies and cross-sell opportunities |
| Personalized offers | 1-to-1 promotional targeting based on purchase history |
| Retail media optimization | Use loyalty data to target ads to specific shopper segments |
| Assortment optimization | Model impact of SKU additions/deletions on loyal customer baskets |

---

## 7. Executive Output Layer

### 7.1 SCQA Framework (NIQ StoryMasters)

| Element | Rule | Quality Check |
|---|---|---|
| **Situation** | Current state already known by client; sets strategic context with specifics and numbers | Must contain detail and context -- not generic |
| **Complication** | The problem; the challenge to the situation; why it matters NOW | Must be quantified and specific |
| **Question** | The strategic issue to solve; rooted in opportunity for growth | Only ONE answer per SCQA |
| **Answer** | Quantified, action-oriented recommendation; NOT a generic observation | Must be implementable |

Bad: "Decline is due to distribution loss"
Good: "Gaining back z% of buyers at Retailer A through bigger pack launch would boost sales by x%"

### 7.2 Pyramid Principle (Barbara Minto)

```
Level 1: ANSWER (from SCQA) -- the exec summary title
  Level 2: POV 1 (Supporting Implication) -- section theme
    Level 3: Evidence 1.1 -- chart slide
    Level 3: Evidence 1.2 -- chart slide
  Level 2: POV 2
    Level 3: Evidence 2.1
  Level 2: POV 3
    Level 3: Evidence 3.1
```

### 7.3 Deductive vs. Inductive Storytelling

| Dimension | Deductive (DEFAULT) | Inductive |
|---|---|---|
| Answer position | FIRST (slide 2) | LAST |
| Flow | Answer -> Reasons -> Data evidence | Issue -> Data -> Data -> Answer |
| Audience | Short on time, senior, decision-driven | Needs context, educational/exploratory |
| Basquio rule | Default unless brief says otherwise | Only for "walk me through the analysis" briefs |

### 7.4 What / So What / Now What

Every slide must pass this test:
- **What?** -- Descriptive evidence from data
- **So What?** -- Analytical interpretation (risk or opportunity)
- **Now What?** -- Forward-looking, actionable recommendation

### 7.5 Interpretation Lenses

When reviewing findings, classify each as:
- **Connection** -- confirms existing hypothesis
- **Contradiction** -- challenges assumptions
- **Curiosity** -- unexpected signal worth investigating

### 7.6 Role-Specific Output Shaping

| Role | Language Register | Primary Metrics | Exhibit Density | Narrative Depth | Key Frameworks |
|---|---|---|---|---|---|
| **Analyst** | Technical, data-rich | All KPIs, full granularity | High (chart-per-slide) | Medium | Diagnostic motifs, exhibit rules, KPI dictionary |
| **Category Manager** | Commercial, action-oriented | Distribution, velocity, assortment, mix, promo ROI | Medium-High | Medium | CatMan 8-step, category roles, PPA, JBP |
| **Shopper Insights Manager** | Consumer-centric | Penetration, loyalty, missions, occasions, churn | Medium | High (narrative) | Kantar demand moments, shopping missions, brand growth diagnostic |
| **RGM Lead** | Financial + commercial | Trade rate, promo ROI, gross-to-net, elasticity, contribution margin | Medium | Medium-High | RGM maturity, PPA 4 pillars, TPO, gross-to-net waterfall |
| **CFO Partner / Commercial Finance** | Financial, margin-focused | Gross margin, trade rate, EBITDA impact, joint profit pool | Low-Medium | High (narrative) | Gross-to-net waterfall, margin pool, impact benchmarks |
| **Consultant** | Framework-driven, strategic | Depends on engagement scope | Medium | High | All frameworks, issue trees, scenario planning, maturity models |
| **Executive / Board** | Synthesis, decision-ready | 3-5 headline KPIs maximum | Low (dashboards/scorecards) | Low (bullet synthesis) | SCQA, Pyramid, headline recommendations with sizing |

### 7.7 Exhibit Selection Rules (Absolute)

| Question Type | Correct Chart | Forbidden Chart |
|---|---|---|
| How big is each segment? | horizontal_bar (ranked) | pie (>5 segments), line |
| How does mix compare? | stacked_bar_100 (side by side) | separate pies, line |
| CY vs PY (2 periods)? | grouped_bar / waterfall | line, area |
| What's growing/declining? | horizontal_bar (diverging) | table, line |
| Who dominates? | doughnut / pareto | scatter |
| Top N items? | horizontal_bar (humanized labels) | table with codes |
| What changed and why? | waterfall bridge | stacked bar |
| Trend over time (4+ periods)? | line | bar |
| Distribution vs velocity? | scatter | line |
| Market flat/stable? | KPI delta card | any complex chart |
| Unordered categorical buckets? | bar (vertical or horizontal) | NEVER line or area |

### 7.8 Anti-Patterns (Must NEVER Happen)

- Line chart for categorical (unordered) comparisons
- Line chart for 2-period CY/PY data
- Value and packs on same axis without normalization
- Raw SKU codes (P-008294-001) as chart labels -- use product names
- Memo slides when a chart can prove the point
- "Category Overview" as a slide title -- must be the insight
- Share without specifying the denominator
- More than 1 text-only slide per deck

### 7.9 Recommendation Actions (FMCG Levers)

Prioritize by: Prize x Feasibility x Ease x Time x Fit

| Lever | Description | Typical Data Required |
|---|---|---|
| Distribution expansion | Sell-in to retailers; new store listings | Numeric/weighted distribution, velocity |
| Pricing/pack architecture | Price ladder, format design, price index | Price index, elasticity, PPA analysis |
| Promotion optimization | Quality > quantity; shift from weak to strong events | Promo intensity, baseline, incremental, ROI |
| Portfolio rebalancing | Shift investment to whitespace segments | Mix gap, segment growth rates |
| Hero renovation | Refresh declining lead products | SKU Pareto, hero growth trends |
| Tail pruning | Cut low-performing SKUs to fund growth | SKU contribution, velocity ranking |
| Buyer recovery / loyalty | Penetration, frequency, retention programs | Panel data: penetration, repeat, churn |
| Channel prioritization | Focus on highest-return channels | Channel split, channel growth, channel margin |

---

## 8. Cross-Firm Source Map

| Firm | Specialty | Key Metrics / Outputs | When to Use Their Lens |
|---|---|---|---|
| **NIQ (NielsenIQ)** | Retail measurement (POS), market share, distribution, velocity | Sales value/volume, share, distribution, velocity, price index, promo baseline/incremental | Market sizing, competitive share tracking, distribution gaps, SKU productivity, promo effectiveness |
| **Kantar (Worldpanel)** | Household purchase panels, usage/occasion panels, single-source attitudinal | Penetration, loyalty, repeat, switchers, CRP (Brand Footprint), demand moments, shopping missions | Who is buying, buyer growth diagnostics, occasion-based strategy, portfolio white space, OOH dynamics |
| **Circana** | Receipt-based consumer panel, POS-calibrated, churn/leakage, innovation | Buyer churn rate, retail leakage, share of wallet, source of volume, whitespace score, volumetric forecast | Churn diagnosis, leakage mapping, innovation pipeline, POS-calibrated panel analysis (esp. U.S.) |
| **GfK** | Consumer psychographics, values tracking, tech/durables | TrendKey scores, value segments, price sensitivity clusters | Brand positioning vs. consumer values, psychographic segmentation, long-term trend alignment |
| **Euromonitor** | Global trends, market sizing, country profiles, category forecasts | Trend narratives, market size estimates, growth forecasts, structural shifts | Strategic foresight, trend validation, market entry sizing, global category outlook |
| **dunnhumby** | Loyalty card analytics, retailer media, personalization | Customer segments, basket affinity, price sensitivity tiers, personalized offer ROI | Retailer-specific shopper analysis, media optimization, assortment decisions using loyalty data |
| **McKinsey** | RGM strategy, precision promotions, maturity models | EBITDA impact, margin benchmarks, maturity assessment | RGM transformation strategy, promotion optimization, executive business cases |
| **Deloitte** | JBP, collaboration, modern RGM, trade analytics | Collaboration benchmarks, JBP frameworks, gross profit improvement | Retailer-manufacturer collaboration, JBP design, RGM modernization |
| **Bain** | Trifecta RGM, maturity index, customer GM mindset | 200+ benchmark maturity index, joint profit pool, promo failure rates | RGM maturity assessment, trade negotiation strategy, joint value creation |
| **PwC** | Three-speed RGM, market archetype, RGM-as-a-Service | Market archetype classification, wasted spend identification | Multi-market RGM design, market entry, developing market strategy |
| **EY** | CoE operating models, consumer analytics platforms, IBP | IBP integration, AI analytics platform design | Technology-led RGM transformation, operating model design |
| **Kearney** | Operating model benchmarks, FTE norms, barrier analysis | 5.9 FTEs/1000 employees, 5 barriers, AI adoption rates | Operating model design, capability benchmarking, organizational design |

---

## 9. Diagnostic Motif Library (Expanded)

### 9.1 NIQ Core Motifs (7 Original)

| Motif | Signals | Meaning | Story Angle | Recommended Chart |
|---|---|---|---|---|
| **Availability Problem** | Low distribution, reasonable ROS | Can sell, not available | Distribution expansion | scatter (dist vs velocity) |
| **Velocity Problem** | Good distribution, weak ROS | Available, not selling | Proposition/pricing fix | horizontal_bar (ROS ranked) |
| **Price/Mix Tension** | Value growth > volume growth | Fragile price-driven growth | Pack architecture | grouped_bar (value vs vol growth) |
| **Promo Dependence** | Intensity >50%, weak baseline | Unsustainable promo reliance | Rebuild baseline | stacked_bar (baseline vs incremental) |
| **Portfolio Mismatch** | Mix gap > +/-5pp | Over/under-indexed vs category | Portfolio rebalancing | stacked_bar_100 (cat vs brand mix) |
| **Hero Concentration** | Top 3 SKUs >50% of value | Revenue depends on few aging products | Hero renovation, tail prune | pareto + horizontal_bar (hero growth) |
| **Share Erosion** | Declining share, stable category | Losing competitive position | Competitive response | grouped_bar (share CY vs PY) |

### 9.2 Circana Churn/Leakage Motifs (5 New)

| Motif | Signals | Meaning | Story Angle | Recommended Chart |
|---|---|---|---|---|
| **Leaky Bucket** | High churn rate, adequate funnel replacement | Buying trial but not retention | Fix product experience, loyalty program | waterfall (buyer flow: new, retained, churned) |
| **Wallet Bleed** | Low churn but declining share of wallet | Buyers staying but spending less | Win back share of basket; frequency/cross-sell | stacked_bar (brand share of wallet over time) |
| **Competitive Poaching** | Leakage concentrated to 1-2 competitors | Specific competitor taking buyers | Targeted competitive response (price, innovation) | horizontal_bar (leakage destination by competitor) |
| **OSA-Driven Churn** | Churn correlated with out-of-stock events | Supply chain failure losing customers | Store-level OSA improvement | scatter (OSA rate vs churn rate by store) |
| **Displacement Churn** | Category-level spend declining, cross-category shift | Macro pressure reallocating consumer wallet | Reposition as essential; value messaging | grouped_bar (category spend shift: dining out vs grocery) |

### 9.3 Kantar Shopping Mission Motifs (4 New)

| Motif | Signals | Meaning | Story Angle | Recommended Chart |
|---|---|---|---|---|
| **Mission Mismatch** | Brand over-indexed in Main Shop, absent from For Tonight/Specific Journey | Missing premium occasions | Launch occasion-specific formats | stacked_bar_100 (brand presence by mission type) |
| **Trial Without Adoption** | Penetration growth without loyalty growth | Leaky bucket at household level | Improve repeat; product/price/experience fixes | grouped_bar (penetration vs loyalty over time) |
| **Niche Trap** | High loyalty without penetration growth | Shrinking franchise | Recruitment campaign; NPD for broader appeal | scatter (penetration vs loyalty, bubble = revenue) |
| **Consumption Gap** | Stable purchases, declining consumption occasions | Potential waste/stockpiling | Format right-sizing; usage occasion expansion | line (purchase frequency vs consumption occasions) |

### 9.4 Financial/Trade Motifs (3 New)

| Motif | Signals | Meaning | Story Angle | Recommended Chart |
|---|---|---|---|---|
| **Trade Spend Bloat** | Trade rate >25%, non-working trade >25% of total | Paying for shelf access, not consumer conversion | Shift to working trade; retailer passthrough audit | waterfall (gross-to-net breakdown) |
| **Promo Value Destruction** | Cannibalization rate >30%, negative True ROI | Promotions destroying more value than they create | Reduce depth/frequency; shift to loyalty/trial programs | horizontal_bar (promo ROI ranked by event) |
| **Margin Erosion Despite Growth** | Revenue growing but gross margin declining | Price/mix working against you | PPA redesign; premiumization; channel mix management | waterfall (revenue growth decomposition: price, mix, volume) |

### 9.5 Motif Detection Quick Reference

| Data Available | Motifs Detectable |
|---|---|
| NIQ RMS (POS data) | Availability, Velocity, Price/Mix Tension, Promo Dependence, Portfolio Mismatch, Hero Concentration, Share Erosion, Trade Spend Bloat, Promo Value Destruction, Margin Erosion |
| Kantar Panel (purchase + usage) | Trial Without Adoption, Niche Trap, Consumption Gap, Mission Mismatch + all NIQ motifs via panel share |
| Circana Panel (receipt + POS) | Leaky Bucket, Wallet Bleed, Competitive Poaching, OSA-Driven Churn, Displacement Churn + all NIQ motifs via calibrated data |
| Financial/Trade data (gross-to-net) | Trade Spend Bloat, Promo Value Destruction, Margin Erosion |

---

## 10. Role Router

### Which layers to inject for each user role:

| Role | Layer 1: Market Truth | Layer 2: Consumer/Shopper | Layer 3: Commercial Levers | Layer 4: Financial Levers | Layer 5: Consulting/Decision | Layer 6: Foresight | Layer 7: Output |
|---|---|---|---|---|---|---|---|
| **Analyst** | FULL | Summary | FULL | Summary | Motifs only | Summary | Full exhibit rules |
| **Shopper Insights** | Summary | FULL | Summary | Minimal | Brand growth diagnostic | Summary | Full narrative + exhibit |
| **Category Manager** | FULL (NIQ focus) | Shopping missions + brand growth | FULL (CatMan 8-step, PPA) | Summary | CatMan frameworks | Summary | Full exhibit rules |
| **RGM Lead** | Summary | Summary | FULL | FULL | FULL (all RGM frameworks) | Summary | Full + financial exhibits |
| **Commercial Finance / CFO** | Minimal | Minimal | Trade spend focus | FULL | Gross-to-net + JBP | Summary | Financial narrative + scorecards |
| **Consultant** | FULL | FULL | FULL | FULL | FULL | FULL | Full + framework overlays |
| **Executive / Board** | Headline only | Headline only | Headline only | Headline impact benchmarks | SCQA + Pyramid only | Trend headlines | Synthesis + scorecards |

### Injection Cost by Role

| Role | Estimated Payload Size | Estimated Token Cost |
|---|---|---|
| Analyst | ~3K tokens | ~$0.01 |
| Shopper Insights | ~2.5K tokens | ~$0.008 |
| Category Manager | ~3K tokens | ~$0.01 |
| RGM Lead | ~4K tokens | ~$0.013 |
| Commercial Finance | ~2K tokens | ~$0.007 |
| Consultant | ~5K tokens | ~$0.017 |
| Executive | ~1K tokens | ~$0.003 |

---

## 11. Routing Cues

### 11.1 Positive Activation Cues (Inject FMCG domain knowledge)

**Column-level signals** (score +10-15 each):
- ECR hierarchy: AREA_ECR, COMPARTO, FAMIGLIA, MERCATO
- Brand hierarchy: FORNITORE, MARCA, MANUFACTURER, BRAND, SUPPLIER
- Retail metrics: SHARE, DISTRIBUTION, VELOCITY, PENETRATION, ROS
- Value/volume pairs: VALORE, CONFEZIONI, VALUE, VOLUME, PACKS, UNITS
- Price indicators: IDX PR, PRICE INDEX, PREZZO MEDIO
- Promo indicators: PROMO, BASELINE, INCREMENTAL, LIFT, TPR
- Trade finance: TRADE RATE, GROSS TO NET, DEDUCTIONS, SLOTTING
- Panel metrics: CHURN, LOYALTY, REPEAT, TRIAL, SWITCHERS, WALLET

**Metadata signals** (score +20):
- File name or metadata contains: NielsenIQ, NIQ, IRI, Circana, Kantar, Euromonitor, GfK, dunnhumby, Homescan, Scantrack, Worldpanel, RMS

**Brief-level signals** (score +15 each):
- Terms: fmcg, cpg, category, brand, retailer, shopper, sku, trade marketing, market share, consumer panel, distribution, penetration, promotion, price pack, assortment, category management, joint business planning, revenue growth management, trade spend, gross to net

**Threshold:** Score >= 30 activates FMCG domain knowledge injection.

### 11.2 Negative Activation Cues (Do NOT inject FMCG domain knowledge)

- Business plans, financial models, stock market analysis
- SaaS metrics (MRR, ARR, tech churn, LTV in software context)
- HR / people analytics
- Generic data with no industry context
- Marketing campaign performance (digital marketing, not trade marketing)
- Academic research datasets
- Government/public sector data

### 11.3 Data Source Detection Heuristics

| If data contains... | Likely source | Recommended analytical lens |
|---|---|---|
| UPC/EAN-level sales, store-level distribution | NIQ RMS / Scantrack | Market Truth (section 1) + NIQ motifs |
| Household-level purchase, penetration, loyalty | Kantar Worldpanel or NIQ Homescan | Consumer/Shopper Truth (section 2) |
| Receipt-based data, POS-calibrated metrics | Circana | Churn/leakage motifs (section 9.2) |
| Shopping mission classifications | Kantar | Mission motifs (section 9.3) |
| Usage/occasion data, demand moments | Kantar Usage Panel | Demand moments framework (section 2.5) |
| Trade spend, gross-to-net, deductions | Internal finance | Financial Levers (section 4) |
| Loyalty card transaction data | dunnhumby / retailer | Personalization + basket affinity |
| Consumer attitudes, values, psychographics | GfK Consumer Life | Trend/foresight layer (section 6) |
| Category forecasts, market sizing, trend data | Euromonitor | Foresight layer (section 6) |

---

## 12. Terminology Cross-Reference

### Kantar vs. NIQ vs. Circana

| Kantar Term | NIQ Equivalent | Circana Equivalent | Notes |
|---|---|---|---|
| Worldpanel | Homescan / Consumer Panel | Consumer Panel (receipt-based) | Kantar longitudinal with usage; NIQ barcode-scanner; Circana receipt-first |
| Worldpanel Usage | No direct equivalent | No direct equivalent | Kantar continuous usage panels are unique |
| PanelVoice | Bases / Consumer Surveys | Supplemental surveys | Kantar surveys actual panelists (single-source) |
| Demand Moments | Occasion Studies (ad hoc) | N/A | Kantar continuous; NIQ project-based |
| Brand Footprint (CRP) | No direct equivalent | No direct equivalent | Unique global brand ranking |
| Shopping Missions | Trip Mission (some markets) | Trip-level basket analysis | Kantar most standardized globally |
| Grocery Market Share | Scantrack / RMS | POS data | Kantar = panel-based; NIQ = POS-based; Circana = POS-calibrated panel |
| Behavioural Analytics | Assortment Optimizer / BASES | Growth Predictor | Different underlying data |
| ComTech | No equivalent | No equivalent | Kantar tech/entertainment panel |
| N/A | RMS / Scantrack | Liquid Data Go | Market share and performance tracking |
| N/A | BASES | Growth Predictor | Innovation forecasting |
| N/A | N/A | Unify+ | Multi-source data integration |
| N/A | N/A | Liquid Supply Chain | Supply chain analytics |
| N/A | N/A | Hendry Market Structure | Purchase-based market structure |

---

## 13. Circana Product/Platform Glossary

| Product Name | What It Does |
|---|---|
| **Unify+** | Integrates disparate data sources (1P + 3P + POS) into single analytical view |
| **Liquid Data Go** | Self-service analytics for market share, trends, category performance |
| **Liquid Supply Chain** | Supply chain analytics linking POS gaps to inventory/OSA issues |
| **Growth Predictor** | Volumetric forecasting for new product launches |
| **Complete Consumer** | Consumer behavior monitoring tracking buyer trends and market signals |
| **Hendry Market Structure** | Purchase-based market structure analysis for whitespace identification |
| **Liquid AI** | Circana's AI layer powering industry rankings and automated insights |

---

## 14. Practitioner Wisdom

**On funding:** "I've never seen a properly resourced RGM project fail to create significant value. At any level." -- Nikitas Paraskevopoulos, Bayer Consumer Health (via Kearney)

**On AI:** "80% of the value created by AI in RGM will come from the skills of the people using it." -- Marc Viarnaud, Avon (via Kearney)

**On organizational home:** "RGM should sit under commercial, ideally reporting to the chief commercial officer, with a dotted line to finance." -- Marc Viarnaud, Avon

**On PE value creation:** "In a five-year investment cycle, RGM is one of the fastest ways to create measurable value -- way faster than cost-cutting or operational restructuring." -- Marc Viarnaud, Avon

**On market adaptation:** "What works in Philadelphia rarely works in Jakarta, and it's a waste of time and money to pretend otherwise." -- PwC

**On visibility:** "In some markets, success isn't precision. It's visibility." -- PwC

**On the triple win:** "Any pricing or promotional move has to work for the consumer and retailer too, otherwise execution suffers." -- Marc Viarnaud, Avon

**On balanced metrics:** "Track net price per unit, but also measure like-for-like volume metrics, consumer cohorts, and ultimately the cashflow impact of your RGM initiatives." -- Marc Viarnaud, Avon

**On growth:** Kantar/Ehrenberg-Bass research consistently shows penetration gain is the #1 driver of brand growth. Frequency and premiumization are secondary and tertiary levers.

**On promotions:** Only ~20% of promotional investment contributes to category growth; ~50% of promo sales cannibalize non-promo sales; 75% of RGM programs fail to deliver joint profit growth for both retailer and manufacturer. (Bain)

**On complexity:** ~70% of SKUs deliver <5% of category revenue, generating unneeded complexity. (Bain)
