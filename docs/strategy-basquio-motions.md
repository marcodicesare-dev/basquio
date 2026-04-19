# Basquio Commercial Strategy — Canonical Motions

**Version:** 1.0
**Locked:** 2026-04-18
**Source of truth:** this file. If any other doc contradicts it, this file wins.

This document defines the three channels Basquio uses to generate revenue. Every future session should reference this file rather than re-debate what Crosby-model or Workspace-model means.

**Companion docs (both lock alongside this one):**
- [motion1-gtm-playbook.md](motion1-gtm-playbook.md) — concrete Motion 1 tactical playbook with Italian fractional CMO price anchor, 90-day targets, contracting stack
- [motion2-workspace-architecture.md](motion2-workspace-architecture.md) — Motion 2 technical architecture: bi-temporal KG via Graphiti, Harvey three-scope memory, Anthropic Memory Tool, Nango + Recall.ai stack

---

## Verified whitespace (Apr 19 2026 research)

The most important finding: **zero CPG/FMCG incumbent uses memory/context as the primary pitch on their marketing page.** ([research dossier](motion2-workspace-architecture.md#1-product-thesis-locked))

- **NIQ Ask Arthur Chat** (launched Apr 1, 2026): AI-powered conversational interface for report building. US only, SMB-first. Zero memory/workspace language. ([NIQ press](https://nielseniq.com/global/en/news-center/2026/niq-launches-ask-arthur-chat-to-expand-access-to-consumer-insights-through-ai/))
- **Circana Liquid AI + Brainwave + Emiri** (Jan 2026 update): all three are query/reporting surfaces. ([Circana Liquid AI](https://www.circana.com/solutions/liquid-ai))
- **84.51° Agent Monday** (Nov 2025, Kroger data): weekly email digest, not a workspace. ([Modern Retail](https://www.modernretail.co/technology/kroger-launches-ai-generated-email-digest-for-suppliers/))
- **Stackline / Profitero / Crisp / dunnhumby Shop**: retail-execution tools and research portals. None positioned as daily analyst workspace with compounding memory.

**Verticalization playbook is proven in adjacent domains** (verified Apr 2026):
- Harvey: $100M → $190M ARR in 5 months, $11B valuation ([CNBC Mar 25 2026](https://www.cnbc.com/2026/03/25/legal-ai-startup-harvey-raises-200-million-at-11-billion-valuation.html))
- Legora: $1M → $100M ARR in 18 months, $5.55B valuation ([TechCrunch Mar 10 2026](https://techcrunch.com/2026/03/10/legora-reaches-5-55-billion-valuation-as-ai-legaltech-boom-endures/))
- Sierra: $26M → $150M ARR in 12 months ([Sacra](https://sacra.com/c/sierra/))
- Rogo: 27x ARR growth, $750M post-money ([Rogo Series C](https://rogo.ai/news/scaling-rogo-to-build-the-future-of-investment-banking-our-75m-series-c-and-european-expansion))
- OpenEvidence: $12B valuation, medical vertical ([CNBC](https://www.cnbc.com/2026/01/21/openevidence-chatgpt-for-doctors-doubles-valuation-to-12-billion.html))
- Glean (horizontal reference): $100M → $200M ARR in 9 months ([Glean press](https://www.glean.com/press/glean-surpasses-200m-in-arr-for-enterprise-ai-doubling-revenue-in-nine-months))

**Post-mortems on losing horizontal bets:**
- Jasper: ~$120M peak → ~$35M 2024 (-53%) — horizontal AI writing compressed by incumbents + frontier models ([Sacra](https://sacra.com/c/jasper/))
- Tome: shuttered Apr 30 2025 despite 20M users, pivoted to Lightfield. Founder: *"building lasting differentiation in the general-purpose presentation market would prove difficult… they needed more context"* ([VentureBeat](https://venturebeat.com/technology/tomes-founders-ditch-viral-presentation-app-with-20m-users-to-build-ai))
- Rewind/Limitless: Meta acquired Dec 5 2025, products wound down
- Sana: Workday acquired $1.1B Sep 2025

**Basquio's whitespace = Harvey/Legora pattern applied to CPG consumer insights.** Daily workspace + compounding memory + cross-source integration + team collaboration + deliverable generation. 12-18 month window before NIQ/Circana could ship a real workspace (not just a chat layer).

---

## Team skills and capacity (the constraint these motions must fit)

| Co-founder | Day job status | Skills Basquio uses | Capacity for Basquio |
|---|---|---|---|
| Marco | Part-time until €10K MRR | CTO, product, full-stack engineering (14 commits/day avg), writing, product demos | ~4h/day evenings + weekends |
| Alessandro (Ale) | Part-time, NIQ | GTM, enriched 3,500-contact graph, BDR outreach, prospect research | ~1h/day |
| Rossella | Part-time, NIQ | Senior FMCG analyst credibility, domain expert, emotional intelligence, NIQ internal network | ~1-2h/day |
| Francesco (Fra) | Part-time, NIQ | Ex-analyst, methodical QA on deliverables, pilot test owner | ~1h/day |
| Giulia | Part-time, ex-Mondelez | Marketing content, brand, video strategy, brother Giuseppe produces video | ~1h/day |
| Veronica | Part-time, Victorinox (ICP) | Client-side insights manager perspective, first design-partner user, CPG content review | ~1h/day |

**Hard constraint:** no co-founder transitions full-time before €10K MRR. No budget for hires. No budget for paid ads. Founder-led sales cycle length must fit part-time capacity.

---

## The three revenue channels

Basquio generates revenue from three distinct channels with three distinct buyers, pitches, and pricing shapes. They run in parallel but are NOT interchangeable.

### Channel 1 — Agency-output (Crosby model)

**Canonical reference:** [Crosby.ai](https://crosby.ai/) — registered AI-powered law firm, fixed price per contract, human-in-the-loop on each deliverable. The "AI firm" not "AI tool" framing.

**Basquio shape applied to FMCG:**

- **Product:** fixed monthly retainer for 3-5 guaranteed deliverables (decks, memos, data workbooks, category reviews, promo analyses). 48-hour turnaround per deliverable.
- **Pricing:** €2-5k/mo fixed. €30-60k/yr annualized.
- **Buyer:** CMO, Head of Marketing, Head of Insights, Head of Category at mid-market CPG, with **autonomous budget authority** (the key constraint).
- **Payment:** corporate procurement as agency retainer line item. Matches existing "we already spend on consultancies" budget shape. No IT/Legal escalation required if under procurement signing threshold.
- **Delivery:** Basquio engine produces the artifact, ex-analyst co-founder (Rossella / Fra / Veronica) QAs before client ships. Human-in-the-loop is part of the product promise.
- **Target companies:** Italian mid-market CPG (Caffè Borbone / Loacker / Bauli / GranTerre / Gruppo Montenegro / Campari mid-tier), PE-backed CPG portfolios, boutique consulting firms using Basquio as delivery engine (Patrizia / Lama SME consultant tier).
- **Pitch language:** "AI-native insights firm for mid-market FMCG. Delivery speed and price that traditional consultancies cannot match."
- **Contract template:** adapt the Loamly-Eminence Partnership Agreement shape (5-day Stripe payment, Swiss francs or EUR, quarterly review).
- **Why this works:** procurement knows how to buy a retainer, doesn't know how to buy "AI SaaS seats." CMO with budget autonomy avoids corporate Legal escalation. Ex-analyst credibility opens doors via warm intros.

**Capacity ceiling:** 10-15 customers before part-time delivery overwhelms team.
**Cost structure:** high delivery labor (10-20% of revenue goes to co-founder QA time) but procurement-friendly.
**Structural comparable:** [EvenUp](https://www.evenuplaw.com/) (AI personal-injury demand letters, €110M revenue, 672 people — but margins are BPO not SaaS).

### Channel 2 — Workspace SaaS (Legora model, laddered)

**Canonical reference:** [Legora](https://legora.com/) — vertical AI for law firms, eventually $3K/seat/yr with 10-seat minimum at maturity. We are NOT starting at Legora's mature floor ACV. We ladder up from an accessible entry tier because we don't have Max Junestrand's full-time founder-led enterprise sales motion.

**Basquio shape applied to FMCG (Veronica Apr 18 session vision):**

Per-seat SaaS workspace for consumer insights analyst teams. The analyst's daily working surface. NOT primarily a deck generator — the deck is one output among several.

**Core capabilities (all tiers):**
- **Context memory per client/brand/category** — remembers the brief, prior decks, meeting notes, agency outputs
- **Multi-format ingestion** — upload briefs, meeting transcripts, prior decks, data files
- **Shared team workspace** — multi-seat, per-user roles, shared memory
- **CRM primitives** — track which client asked what, when, with what outcome
- **Deck + memo + workbook generation** — on demand from accumulated context
- **192KB encoded FMCG domain knowledge + 10 validators** — category-awareness from day one

**Pricing ladder (not one floor, three steps):**

#### Tier 2a — Team Starter (entry tier, 90-day motion)

- **€500/mo for 3-10 seats** (self-serve or lightly sales-assisted checkout)
- Per-seat: €50-167/mo = €600-2K/seat/yr
- Shared workspace, team memory, CRM primitives, deck generation
- No external API connectors yet (customer uploads data)
- No enterprise security features (no SSO, no DPA template)
- Buyer: Head of Insights or Marketing Director signing €500/mo without procurement escalation
- **Sales cycle: 1-2 weeks via warm intro**
- Target: SMB and mid-market CPG teams of 3-10 analysts (Victorinox-scale, Felfel-scale, smaller divisions of Barilla/Lavazza/Ferrero, boutique category consulting firms)

#### Tier 2b — Workspace Full (mid-tier, Q3 2026 motion)

- **€2.5-5k/mo for 10-25 seats**
- Per-seat: €100-250/mo = €1.2-3K/seat/yr
- Adds: external API connectors (NIQ Discover, Kantar, Circana, retailer 1P), Slack/Teams/Gmail ingestion, per-client context memory, DPA, onboarding
- Sales-assisted, 2-3 month pilot → annual contract
- Buyer: Head of Insights / Head of Analytics / CMI leader with structured insights function
- Target: mid-market CPG with 10-25 analyst team (Barilla-scale, Lavazza-scale, illycaffè-scale, PE-backed portfolios scaling insights)

#### Tier 2c — Enterprise / Workspace Plus (post-€10K MRR)

- **Custom pricing €10k+/mo**
- SSO, SOC 2 Type I, data residency, dedicated FMCG Engineer forward-deployed
- Full Legora-shape enterprise motion
- Target: top-100 global CPG, retailer media networks (Walmart Scintilla, Kroger 84.51°, dunnhumby)

**Why the ladder works:**
- Tier 2a is reachable in 90 days. €500/mo close cycle is 1-2 weeks via warm intro. 20 Tier 2a customers = €10K MRR alone.
- Tier 2b is the Veronica Victorinox target for Q3 2026. Tier 2a users graduate here when they want external connectors or DPA.
- Tier 2c is post-gate, post-portfolio, post-SOC 2.
- Gives natural upsell path: Pro individual (Channel 3) → Team Starter 2a → Workspace Full 2b → Enterprise 2c.

**Structural moat across all tiers:** cross-source (NIQ + Kantar + Circana + retailer 1P). NIQ Ask Arthur and Circana Liquid AI structurally cannot do this because they are commercial enemies. Context memory compounds switching cost. 192KB of encoded FMCG domain knowledge gives category-awareness no horizontal AI has.

**Current state of Channel 2 product:**
- ✅ Multi-tenant web app foundation (organizations, organization_memberships, per-org auth)
- ✅ Domain knowledge library (192KB)
- ✅ Intelligence package (500KB) with 10 FMCG validators
- ✅ Discord bot (130KB) has ingestion + hybrid search + CRM + extraction, but single-tenant
- ⚠️ Web-native analyst UI for search + CRM + ingestion: NOT YET SHIPPED
- ⚠️ Per-org memory wiring scoped by organization_id: NOT YET SHIPPED
- ⚠️ NIQ / Kantar / Circana / retailer API connectors: NOT YET SHIPPED (needed for Tier 2b)
- ⚠️ External communication connectors (Slack, Teams, Gmail, Outlook): NOT YET SHIPPED (needed for Tier 2b)
- ⚠️ SSO + SOC 2 + DPA: NOT YET SHIPPED (needed for Tier 2c)

**For Tier 2a (90-day motion), only the web-native analyst UI + per-org memory wiring is required**, not the full connector suite. That is a 4-6 week engineering scope Marco can ship part-time in parallel to Channel 1 sales.

### Channel 3 — PLG tail (individual user subscriptions)

**Canonical reference:** existing Basquio Starter/Pro pricing, already live on basquio.com. Not a new model, the tail of the product that already ships.

**Basquio shape:**

- **Product:** existing deck generation pipeline, template library, recipes, artifacts. What a user gets today when they sign up and use a credit.
- **Pricing:** Free 30 credits + €5/run template fee; Starter €19/mo; Pro €149/mo; Team €49-99/seat (not yet launched).
- **Buyer:** individual analyst, freelance consultant, marketing manager / brand manager expensing on personal card or team credit card. No corporate procurement involved.
- **Payment:** Stripe checkout, individual card, no purchase order, no Legal review.
- **Traffic sources:**
  - Launch video on LinkedIn (primary) + TikTok (secondary) — Giulia + Giuseppe, BAS-167
  - Directory listings: Uneed, G2, Capterra, Product Hunt (secondary because audience mismatch acknowledged)
  - Warm intros from Ale's 3,500-contact graph (CMO/Head-level filtered OUT for this channel — these individuals buy Pro, not Workspace)
  - Organic SEO from Basquio Research biweekly content pieces
  - Stefania-as-Chris-Messina tactic at NIQ (see below)

**Stefania / Silvia tactic (Rossella's Apr 17 distribution move):**
- Give free 2-month trial to Stefania and Silvia at NIQ as "Chris Messina" figures
- They validate product for the NIQ insights analyst community
- Individual NIQ analysts subscribe to Pro €149/mo on personal cards based on their recommendation
- Deliberately avoids any NIQ corporate / Legal / IT escalation because the buyer is the individual user responsible for themselves
- 2-month trial cap (verbatim Rossella Apr 17 voice)

**Why this exists as a channel and not a motion to "push" strategically:**
- Revenue-positive, organic, doesn't require direct sales effort
- Low-friction long-tail capture of individual marketing managers + analysts + freelance consultants who find Basquio on their own
- Commodity risk from Claude Design bundled with Claude Pro ($20/mo) — but Basquio's FMCG vertical specialization protects against this for the specific segment that cares about NIQ/Kantar/Circana column semantics
- Cap around €20-30K MRR before needs upgrade to Team plan or Channel 1/Channel 2 conversion

---

## Sequencing to €10K MRR

Three motions run in parallel, each contributing 30-40% of the gate. No single motion carries all the risk.

### Three-motion 90-day contribution table

| Channel | Target count | Price | MRR contribution |
|---|---|---|---|
| Channel 1 Agency-output | 1-2 pilot | €3-5K/mo | €3-10K |
| Channel 2 Tier 2a Team Starter | 5-15 teams | €500/mo | €2.5-7.5K |
| Channel 3 Pro subscriptions | 20-40 users | €149/mo | €3-6K |
| Channel 3 Starter + template fees | tail | — | €0.5-1.5K |
| **Total trajectory** | | | **€9-25K** |

The gate is reached when at least two of the three main channels land their minimum floor.

### What ships in the 90-day window

**Channel 1 (Agency-output):**
- Warm-intro outreach by Ale + Rossella + Veronica to 10 top CMO-level mid-market Italian CPG
- Deliverable QA process defined (rotating among Rossella / Fra / Veronica / Giulia)
- DPA template adapted from Loamly-Eminence
- Target: 1-2 signed pilots by end of Week 8

**Channel 2 Tier 2a (Team Starter €500/mo):**
- Marco ships web-native workspace UI (4-6 week scope): ingestion for briefs/meetings/prior decks, search, CRM view, scoped by organization_id using existing multi-tenant foundation
- Veronica validates on Victorinox data as design partner zero
- Ale outreach lists a targeted Head-of-Insights / Marketing-Director tier for this pricing
- Target: 5-15 Tier 2a teams signed by end of Week 12 (via Veronica pilot → referrals + Ale warm intros)

**Channel 3 (PLG tail):**
- Giulia + Giuseppe launch video published on LinkedIn + TikTok
- Basquio Research biweekly content pieces on public FMCG data
- Stefania + Silvia Chris-Messina 2-month free trial at NIQ
- Ale warm-intro campaign to individual Marketing / Brand / Trade Marketing Managers
- Target: 30-50 Pro + Starter subs organically by end of Week 12

### Post-€10K MRR (Q3-Q4 2026)

- Tier 2b Workspace Full shipped (external connectors + DPA + enhanced memory)
- First paid pilot at Tier 2b pricing
- Pre-seed or seed fundraise conversations
- Team full-time transition planning
- First FMCG Engineer hire (ex-NIQ via Alessandro's graph)

---

## What is explicitly NOT a revenue channel

- **NIQ corporate enterprise deal.** Rossella Apr 17 voice: off-limits, legal wall escalation, pre-portfolio. Post-€10K MRR + SOC 2 Type I, maybe.
- **Top-100 global CPG direct enterprise sale** (P&G, Unilever, Nestlé, Mondelez corporate). Same legal wall issue. Individual users at these companies are OK via Channel 3 PLG.
- **Retail Media Network channel** (Walmart Data Ventures, Kroger 84.51°, dunnhumby, Roundel, Carrefour Links). Too long a sales cycle. Post-€10K MRR exploration.
- **PowerPoint add-in.** Anthropic + Microsoft own that rail. Strategic dead end.
- **Generic horizontal SaaS deck tool for non-FMCG.** Gamma / Claude Design territory, commodity race.
- **Paid ads as a growth lever.** No budget, no payback math.

---

## Kill conditions (re-check monthly)

Thesis dies or requires reshape if:

- **Channel 1**: zero signed pilots after 6 months of warm-intro outreach. Would mean agency-retainer shape is wrong or pricing is wrong for Italian mid-market.
- **Channel 2 (product direction)**: NIQ Ask Arthur or Circana Liquid AI ships production-grade white-label cross-source deck generation before end of Q1 2027. Would close the window.
- **Channel 3**: organic conversion rate from signup to paid <0.5% after 500+ signups from video + warm intros. Would mean product experience isn't closing the paywall.
- **Team capacity**: Marco drops below 50 commits/week sustained, or 2+ co-founders lose Basquio time to day jobs.

If 2+ kill conditions hit at same monthly review: freeze plan, regroup, reconsider shape.

---

## Open questions for future sessions (unresolved)

1. **Who does delivery QA on Channel 1 deliverables?** Rotating among Rossella / Fra / Veronica / Giulia or assigned per customer? What's the process document?
2. **DPA template for Channel 1**: who drafts it? Reuse Loamly-Eminence template translated to EUR?
3. **First Channel 2 design partner**: Veronica uses Basquio on Victorinox data today (Channel 3 free-trial mode). Does that convert to Channel 2 workspace pilot at some point in 2026, or does Victorinox stay in Channel 1 as Veronica's internal agency retainer?
4. **Boutique consulting partner**: Jakala is Marco's cofounder consulting relationship for Lumina (NOT a Basquio channel). Are there other Italian category-consultancy partners worth exploring as Channel 1 extension?
5. **How to handle the "individual NIQ analyst on personal card who asks for a team plan" escalation**: when does a Channel 3 subscriber become a Channel 2 prospect? Trigger threshold?

---

## Appendix: common terms glossary

**Crosby model** = agency-output, fixed monthly retainer for deliverables, procurement buys as agency line item, human-in-the-loop on output, not seat-based. See [crosby.ai](https://crosby.ai/).

**Legora model** = vertical AI workspace, per-seat SaaS with high floor ACV (€30K+), context memory + connectors + team collaboration, sold to heads-of-function with budget. See [legora.com](https://legora.com/).

**Workspace** = Channel 2. The Veronica vision. The analyst's daily working surface. Not just a deck tool.

**PLG tail** = Channel 3. Existing Starter/Pro subscriptions. Individual users on personal cards.

**Chris Messina tactic** = Rossella Apr 17 voice strategy: give free trial to 1-2 validated insiders (Stefania/Silvia at NIQ) for max 2 months, let them generate internal word-of-mouth so individual colleagues subscribe personally to Channel 3, avoiding corporate escalation.

**Cross-source moat** = Basquio works on NIQ + Kantar + Circana + retailer 1P simultaneously because it's not a data provider. NIQ/Kantar/Circana can't do this because they're commercial enemies. Structural, permanent competitive advantage.

**€10K MRR gate** = threshold that unlocks team conversations about full-time transition, fundraise (pre-seed or seed, not Series A yet), hiring first engineer or first FMCG Engineer. Before this gate, nothing changes in any co-founder's life.
