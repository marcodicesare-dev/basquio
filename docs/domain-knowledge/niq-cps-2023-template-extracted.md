# NIQ CPS 2023 Template Extracted

Source file: `/Users/marcodicesare/Downloads/NIQ CPS 2023 Template.pdf`

## What This Deck Is

This is an introductory and methodology deck for NIQ Consumer Panel Service in Italy. It explains:

- panel composition and representativeness
- household-based data collection
- database structure
- panel indicators
- standard CPS analyses

For Basquio, this is the core knowledge pack for household shopper and buyer-behavior reporting.

## Core Structure

### Pages 1-12: Panel fundamentals

Core ideas:

- the panel covers around 9,000 households and 25,000+ individuals 14+
- it is designed to represent Italian households
- data are collected through household scanning after purchase
- panel data are validated and then exposed through NIQ tools
- the panel differs from retail panel because it measures household purchases, including behavior across channels and buyers

Basquio implication:

- CPS decks should speak about households, buyers, trips, loyalty, and sourcing behavior
- CPS and RMS should not be merged carelessly; they answer different questions

### Pages 13-18: Sample design and socio-demographic structure

Core ideas:

- sample is stratified and post-stratified
- variables include:
  - geographic area
  - retail-centric clusters
  - household size
  - city size
  - age of main earner / shopper
  - affluency
  - lifestage

Basquio implication:

- CPS narratives should exploit demographic and household segmentation, not only product or channel views

### Pages 19-27: Data collection, database structure, and basic indicators

Core ideas:

- collected data describe buyer, shop, quantity, receipt, and purchase source
- database uses four dimensions similar to RMS:
  - periods
  - products
  - markets, including geographic and demographic markets
  - facts / indicators
- basic facts include purchase value, buyer counts, loyalty, propensity, and related metrics
- value share breakdown and loyalty / propensity interpretation are explicitly presented

Basquio implication:

- CPS can support share decomposition beyond raw sales
- loyalty and buyer-base structure are first-class story objects

## Standard CPS Analyses

### Buyer Exclusivity and Duplication

Purpose:

- identify exclusivists and overlaps among brands / segments

Business questions:

- who buys only us?
- who overlaps with competitors?
- where is switching or co-purchase concentrated?

Useful output shapes:

- overlap matrix
- exclusivity / duplication table
- buyer overlap network

### Distribution Curve

Purpose:

- segment buyers by buying intensity or weight

Business questions:

- who are low / medium / high buyers?
- which buyer groups matter most for value and volume?

Useful output shapes:

- buyer segmentation curve
- KPI table by buyer tier
- socio-demographic profile of heavy buyers

### New / Lost / Retained

Purpose:

- measure buyer-base evolution across periods

Business questions:

- which buyers were acquired?
- which were retained?
- which were lost?

Useful output shapes:

- buyer-flow waterfall
- new / lost / retained decomposition
- retention diagnostic by segment or banner

### Brand Shifting

Purpose:

- decompose brand sales change between two periods

Business questions:

- how much change comes from competitive switching?
- how much comes from market expansion or contraction?
- which brands are net sources or sinks?

Useful output shapes:

- source / destination flow
- competitive factors vs market factors
- shifting decomposition bridge

### Shopper Optimizer

Purpose:

- calculate incremental penetration across combinations of products

Business questions:

- which product adds the most new buyers after the first hero SKU?
- which combinations are redundant versus incremental?

Useful output shapes:

- overlap / incremental penetration matrix
- combination ranking

### Trial & Repeat

Purpose:

- evaluate launch performance through buyer acquisition and repeat

Business questions:

- how many buyers tried?
- how many repeated?
- where is repeat lagging?

### Sourcerer

Purpose:

- evaluate source of purchased volume before and after a launch or intervention

Core source buckets:

- shifting
- category expansion
- possible internal cannibalization / sourcing dynamics

### New Product Alert

Purpose:

- survey-based early read on shopper reaction to a new product

### Intended User

Purpose:

- identify final user of a product at individual level

### Intended Usage

Purpose:

- capture usage occasions or end-use contexts

### Trade Planner

Purpose:

- study buyer behavior within specific retailers / banners

Business outputs shown in the deck:

- category share by banner
- share index by banner
- brand share by banner

## Suggested Knowledge-Graph Nodes

- `consumer_panel_household_model`
- `panel_representativeness`
- `panel_sample_design`
- `affluency`
- `lifestage`
- `buyer_shop_receipt_data`
- `cps_four_dimensions`
- `value_share_breakdown`
- `loyalty_propensity`
- `buyer_exclusivity_duplication`
- `distribution_curve`
- `new_lost_retained`
- `brand_shifting`
- `shopper_optimizer`
- `trial_repeat`
- `sourcerer`
- `new_product_alert`
- `intended_user`
- `intended_usage`
- `trade_planner`
- `banner_share_index`

## Basquio Activation Cues

Activate this pack when the brief or files mention:

- CPS
- consumer panel
- households
- buyers
- loyalty
- exclusivity
- duplication
- retained
- lost
- trial
- repeat
- shifting
- banner

## Important Constraints

- CPS is household / buyer behavior knowledge, not a direct substitute for RMS sell-out.
- Buyer and household language should dominate user-facing narratives when this pack is active.
