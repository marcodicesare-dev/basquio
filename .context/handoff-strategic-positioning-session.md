# Handoff — Strategic Positioning Session (Apr 17, 2026)

This is the handoff for the next agent. Don't re-read everything — surgical rules below, then the concrete question to answer.

---

## The one thing you must get right before answering anything

**Marco calls out fabricated claims instantly and loses patience.** His exact challenge pattern in this session (verbatim):

> "bro how much junk fabricated claims you're spitting into this nosense... you sound like you make a point at the beginning of your thought process and then you fucking trash inside fabricated shit to make your point sound valid. it's the other way around, you start researching, putting info together, asking yourself questions that you must answer with facts, and then come with the right strategy, if you don't know things... don't say, but if you think it's important to know fucking research it"

**Rule: research → verified facts → questions you can't answer → strategy. Not thesis → fill with sourced-sounding claims.** If you don't know something, say so. Don't pattern-match to a plausible answer.

**Caught-red-handed examples from this session** (own these if he tests you):
- I claimed "Legora gave free access to associates at BAHR, got 80% use, then sold firm." Fabricated. The real Legora GTM was paid founder interviews with ~100 lawyers + embedded design partnership with Mannheimer Swartling + founder-led sales at $3K/seat/yr enterprise pricing day one. Source: [Not Another CEO podcast #64 with Max Junestrand](https://notanotherceo.substack.com/p/max-junestrand-legora-64).
- I implied "6 weeks of PLG produced $10 revenue." Wrong timeframe. TAAFT launched Apr 10 = 7 days old. Basquio itself is older but the distribution motion is new.
- I conflated "62 users $10 revenue" as damning — it's 7 days of PLG, not a funnel you can diagnose yet.

---

## Context files to read in this order (don't skim, these are the facts)

1. **`.context/deep-strategic-research-output.md`** (70KB, Apr 15) — the canonical strategic audit: product, users, GTM, competitors, Legora, Anthropic platform, unit economics, tactical playbook. 8 ADDENDUM sections correcting earlier fabrications. Still mostly accurate as of Apr 17, with two corrections below.
2. **`CLAUDE.md`** — the project's canonical rules (budget caps, execution contract, anti-patterns, cost truths). Non-negotiable.
3. **`docs/intelligence-upgrade-spec.md`** (Apr 16) — Stefania Verini's feedback on Kellanova/Pringles deck, 4-layer defensibility framework (knowledge packs, deterministic validation, prompt, analyst feedback loop).
4. **`docs/quality-first-architecture-spec.md`** (Apr 17) — constraint-at-generation vs post-hoc-correction, SOTA eval patterns.
5. **`docs/agency-grade-design-spec.md`** (Apr 17) — forensic visual audit of run `d580a4df`, Pentagram/Economist aesthetic bar.
6. **`docs/template-fidelity-and-depth-spec.md`** (Apr 17) — redundancy + logo fidelity from Rossella audit.
7. **`docs/excel-native-charts-and-fidelity-spec.md`** (Apr 17) — the Rossella "ottimo compromesso": ship PPTX screenshots + editable Excel chart objects via openpyxl. 15 specific slide-level defects from run `d580a4df`.

---

## Corrections to the deep research doc (Apr 17 verified)

Two things in `.context/deep-strategic-research-output.md` are now known to be inaccurate:

1. **Section on Legora's GTM.** The doc says "Legora grew from 10 to 100 people in 13 months" which is correct, but anywhere it implies freemium or PLG is wrong. Corrected facts (sourced):
   - Max Junestrand paid ~100 lawyers their hourly rate for 1:1 interviews before building.
   - Design-partnered Mannheimer Swartling (Nordic law firm), embedded inside for months.
   - Founder-led sales for 18 months to $2M ARR. Max + founding AE.
   - Founding AEs were ex-McKinsey/ex-BCG, not SaaS reps.
   - Sold to firms directly at $3K/seat/yr, 10-seat minimum = $30K floor ACV, day one. No freemium.
   - BVP calls them "fastest enterprise business to reach $100M ARR" — 18 months.
   - Sources: [BVP Atlas](https://www.bvp.com/atlas/legora-the-fastest-enterprise-business-to-reach-100m-arr), [Not Another CEO #64](https://notanotherceo.substack.com/p/max-junestrand-legora-64), [European Business Magazine](https://europeanbusinessmagazine.com/business/from-zero-to-100-million-in-18-months-legora-is-rewriting-what-legal-ai-can-do/), [Jonathan Rintala blog](https://jonathanrintala.com/blog/ai-startup-journey-leya-saas-legal-tech/).
2. **Revenue signal.** The doc says "$10 total revenue — Andy Howard first paying customer." Still true. Verified Apr 17 via direct Supabase query: 62 users total. Only one external paying user is `andywhoward@gmail.com` ($10 in 2 × $5 template fees). All other Stripe activity is Marco's accounts or Francesco (co-founder). **No external subscription has ever converted.** PLG has been live 7 days.

---

## New facts from this session (Apr 17) you must know

### Stefania Verini's feedback (senior NIQ analyst who tested Kellanova/Pringles deck)

- "Analiticamente ottimo" (analytically excellent) + "veramente utilissime le PPT notes" (speaker notes genuinely useful).
- "Non è da dare così ai clienti" (not client-presentable as-is).
- "Messaggi troppo strong per Pringles" (tone too confrontational for a paying client).
- "Da molti insight senza mostrare i numeri" (insights without supporting data).
- "La faremo lunga almeno 4 volte tanto" (our real deliverable would be 4× longer — 60-100 slides vs Basquio's 18-20).
- **20% gap:** tone polish + evidence density + length. Basquio does 60-80%. Analyst closes the last 20%.

### Rossella's WhatsApp audit (Apr 17 lunch thread — see `/tmp/attachments/pasted_text_2026-04-17_15-46-50.txt` if still present, otherwise archived)

- Rossella flipped twice. Opening: "non hanno un senso molte di queste analisi, non dicono nulla" (NIQ decks are hollow). Middle: "è come se basquio facesse quello che davvero faccio io dopo 7 anni." Closing: "basquio serve a tutti e due" (NIQ AND clients).
- Key insight: "il bravo analitic prende queste informazioni e ti deve dire 'sulla base di quello che hai fatto, cosa devi fare di diverso'" — the 20% is **diagnostic-prescriptive layer**, not cosmetic.
- The NIQ→PepsiCo 171-slide contract is NOT separately outsourced. It's bundled with the data license. **You can't run a vendor-swap wedge against NIQ servicing.** Confirmed by Marco directly.
- Her model: NIQ has 15 analysts, Basquio 3× their speed → NIQ saves €1M+. Clients pay NIQ for data + servicing; Basquio disintermediates the analyst arbitrage.

### PEPSICO benchmark deck (`/tmp/attachments/NIQ x PEPSICO - Categories Promo Analysis - AT February 2026 (1).pptx`)

- 171 slides, 38 layouts, 8 categories (Colas, Sport Drinks, Tea, Snacks, Chips, Tortillas, Multipack, Estrusi).
- Every slide title = micro-claim (mechanism + number). 15-25 words typical.
- Systematic drill-down: Total Italy → Hypermarkets → Supermarkets → Discount → Focus Regular → Focus No Sugar. Same question answered 4-5 times across dimensions.
- **Zero speaker notes.** Zero SCQA framing. Zero diagnostic-prescriptive layer. Pure systematic fact delivery.
- **Implication for Basquio:** "100-slide option" is not "longer decks" — it's *combinatoric drill-down* (slot archetypes × dimensions × entities) with diagnostic-prescriptive pairs injected every 5-6 slides. See the earlier session note in `.context/deep-strategic-research-output.md`, not repeated here.

### Miranda at NIQ Europe S&B

- NIQ Europe S&B leader, independently testing Claude AI for presentations. Marco's earlier session log (BAS-164, Rossella to reach out).
- **Marco rejected her as a design partner** explicitly: "I don't see nielsen as design partner" (Apr 17).
- She's a signal, not a sales target. Keep context, don't pitch her as anchor.

### Lunch call + 18:22 team session (Apr 17)

- Lunch call: NIQ cannot be a corporate deal. Only B2C inside NIQ (individual analysts). "Stiamo dando una Ferrari a chi non ha i soldi per comprarci la benzina." Stefania engagement = product validation, not contract.
- 18:22 session: AI-avatar launch video, LinkedIn + TikTok primary channels, PH secondary. Decisions: focus on emotional/time-saving narrative, not feature walkthrough. BAS-167 created (Giulia owner).
- Key quote (Marco): "Il valore aggiunto è un output fatto da qualcuno di specializzato."

### Loamly-Eminence partnership agreement (Apr 17, signed)

`/tmp/attachments/Loamly-Eminence-Partnership-Agreement.pdf` — **Marco's existing agency-partner services-as-software deal**. This is the proven pattern he's already run at Loamly (his other company).

- Structure: Loamly (tech) + Eminence (agency) joint delivery of GEO/SEO services.
- Phase 1 (Prospecting): Loamly generates leads, runs CHF 150 discovery scan, CHF 1,500 pre-read, CHF 5-20K full audit. Eminence closes.
- Phase 2 (Delivery): rev split by work type — 40/60 setup, 50/50 execution-heavy, 30/70 advisory-only.
- Illustrative Year 1 per client: CHF 97K → CHF 46K Loamly / CHF 51K Eminence (~47/53 split).
- **Goodwill contribution:** Loamly delivered 3 free analyses (SGS Sustainability, Illumina, OM Pharma) BEFORE asking for commercial agreement.
- Stripe payment, 5-day terms, Swiss francs.
- Sales cycle acknowledged: 6-12 months enterprise budget cycles.

### Three new competitors Marco asked about (Apr 17)

1. **[Legora](https://legora.com/)** — $5.55B valuation, $100M ARR in 18 months, law firms only. $3K/seat/yr × 10-seat min = $30K floor. Enterprise from day one. (Corrected GTM facts above.)
2. **[Auxi.ai](https://www.auxi.ai/)** — PowerPoint add-in for consulting/IB. $49-60/seat/mo Pro, enterprise custom. 30-person team, founded by Rami Khoury. 350 consulting firms, 5M slides produced. Logos: PwC, Deloitte, Accenture, KPMG, Mercer, Bosch, RBC, FTI, A.T. Kearney, JLL. Their own positioning page says: *"Most enterprise teams use both: Claude for research and content drafting, auxi for deck production and formatting."* → they sell format automation, NOT analysis. Pricing: [/pricing](https://www.auxi.ai/pricing). Comparison to Claude: [/compare/auxi-vs-claude-for-powerpoint](https://www.auxi.ai/compare/auxi-vs-claude-for-powerpoint).
3. **[Datost](https://www.datost.com/)** — "AI data analyst in Slack." CEO Maceo Cardinale Kwik. SF. Queries warehouses, natural-language analytics. **Not a presentation tool. Not competing with Basquio.**

### Sequoia "Services: The New Software" thesis

- Author: Julien Bek (partner), March 5, 2026. [Full article](https://sequoiacap.com/article/services-the-new-software/).
- Core principle: *"if you sell the tool, you're in a race against the model. But if you sell the work, every improvement in the model makes your service faster, cheaper, and harder to compete with."*
- Vertical map: Management consulting $300-400B (biggest), supply chain & procurement $200B+, recruitment $200B+, insurance brokerage $140-200B, IT managed services $100B+, healthcare revenue cycle $50-80B, transactional legal $20-25B. Market research/analyst work NOT separately called out.
- Entry framework: find already-outsourced intelligence-heavy work. "Replacing an outsourcing contract with an AI-native services provider is a vendor swap."
- **Tension for Basquio:** Legora sells the TOOL (per-seat SaaS). Sequoia says bigger opportunity is the WORK (services-as-software). Not mutually exclusive, but different motions. Unresolved.
- The name "Konrad Bergroth" Marco referenced in conversation could not be verified as the author or a contributor. Julien Bek is confirmed.

---

## Unresolved gated questions Marco couldn't answer (don't make up answers)

1. **NIQ/PepsiCo 171-slide contract outsourced?** No — bundled with data license. Sequoia vendor-swap wedge doesn't apply to NIQ servicing.
2. **Has any FMCG buyer bought "analyst work as a service" from a non-NIQ/Kantar/Circana player?** Not that Marco knows. Likely creating a category if Basquio goes service-model.
3. **Miranda's budget authority?** Unknown. Rossella can answer. Irrelevant if she's not a design partner (confirmed).
4. **Who is Basquio's anchor design partner / anchor agency?** Marco: "no idea, and finding this is not easy." **This is the gating unknown** for both Legora-style and Loamly-style motions.
5. **Highest-tier price any current user paid?** Verified: $10 external. No subscriptions converted externally.

---

## The core strategic tension (what you must answer)

Marco's exact framing, verbatim:

> "what I know for sure is that being in the land of nobody and nowhere is wrong and being not fish not meat as well"

Three live shapes for Basquio, and Marco isn't sure which:

### Shape 1: Vertical AI SaaS (the Legora shape, adapted)

- Sell the tool per-seat/per-subscription. $19 Starter, $149 Pro, Team tier at $49/seat/mo later.
- Self-serve paywall triggered in product. Automated recurring credit-card hits via Stripe.
- Requires: volume (500+ users before the funnel makes statistical sense), product that produces 10/10 output, working paywall trigger.
- Adapted from Legora because Basquio team has full-time jobs and can't do founder-led $3K/seat/yr sales.
- **Analog:** Auxi ($49-60/seat). Not Legora ($3K/seat enterprise from day one — that requires Max-level full-time founder commitment).

### Shape 2: Services-as-software through an agency partner (the Loamly-Eminence shape)

- Sell OUTPUT artifacts (decks, quarterly reviews) to agencies who white-label and sell through.
- Revenue share 40-50% to Basquio, 50-60% to partner agency.
- Requires: one anchor agency (which Marco doesn't have), goodwill contribution (3 free deliverables), 6-12 month enterprise cycle.
- Proven by Loamly-Eminence. The model Marco has already run successfully.
- **Anchor profile:** boutique CPG/category consultancies (5-50 people) in Europe. Not MBB. Not Big 4 (Auxi owns). Not in-house FMCG teams (too slow).

### Shape 3: PowerPoint-integrated workflow (the Auxi shape, but inverted)

- Live inside PowerPoint as an add-in. User stays in their tool of choice. Basquio assists: "analyze this data," "write the insight," "generate supporting chart," "rewrite this slide for tone X."
- Auxi does formatting. Basquio does analysis + copy + structure.
- Requires: Office Web Add-in build (4-6 weeks). Different distribution (AppSource marketplace, team deals, Microsoft ecosystem).
- Could combine with Shape 1 (Pro tier = web app + add-in).
- **Unexplored.** Not researched in depth in any existing spec.

### The tension Marco wants resolved

- **Not fish not meat:** Basquio today is somewhere between a PLG indie SaaS and a consulting-grade deliverable. Neither side buys fully. Free users experience it as a one-off tool. Analysts experience it as 80% of an output but not 100%. Agencies don't know it exists.
- **Nobody/nowhere land:** Basquio isn't Legora (enterprise vertical AI), isn't Auxi (formatting tool for consultants), isn't a Marc-Lou-style indie PLG junk product, isn't a services firm.
- Marco's conviction: "I founded loamly and offered this today to a real agencies where I did already 3-4 audits... geo/seo work, but just to make u understanding." The Loamly pattern works. Can it be run on Basquio?
- Marco's doubt: "no idea" who Basquio's anchor agency is. Unlike Loamly-Eminence where he had pre-existing relationships.

---

## Revenue and metric ground truth (queried Apr 17)

Query these yourself before citing any number:

```bash
source .env.vercel.local
# External paying users
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/credit_ledger?reason=in.(purchase_pack,subscription_grant)&select=*" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
# Active subscriptions
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/subscriptions?select=*" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
# Template fee drafts paid
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/template_fee_checkout_drafts?status=in.(paid,consumed)&select=*" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Apr 17 numbers:
- 62 total users in auth.users
- 1 active subscription (Marco's `@felfel.ch` test account)
- 3 template fees consumed (2 by Andy Howard, 1 by Marco `@felfel.ch`)
- 3 credit_ledger purchase_pack entries (all Marco or Francesco)
- **External non-co-founder revenue: Andy Howard only, $10.**
- PLG via TAAFT launched Apr 10 = 7 days of distribution.

---

## 72 hours of shipping velocity (what landed since the deep research doc)

Commits merged (log `git log --oneline --since="3 days ago"`):
- Opus 4.7 upgrade + adaptive thinking (`0658b0d`, `52a04dd`, `d5f6cc6`)
- Intelligence upgrade prompts + evidence binding (`feedfdb`, `54f2ff3`, `9fb5e1b`, `a758536`, `8c7fbbc`, `144b4e2`)
- Template fidelity + long-deck depth (`e4061ec`, `8689c25`)
- Billing UX traps (`6c5bc96`, `2df73a5`)
- Stripe renewal + receipts (`b5af7ea`, `a5495a9`, `f427680`)
- Free tier: reduced 30→15 then reverted back to 30 (`bf6c601`, `3178875`, `573bc1c`) — **contradicts the deep-research recommendation; Marco walked it back**.

Specs written but not yet implementation-complete:
- `docs/intelligence-upgrade-spec.md` — tone, evidence, depth (from Stefania's feedback)
- `docs/quality-first-architecture-spec.md` — constraint-at-generation vs lint-as-backstop
- `docs/agency-grade-design-spec.md` — Pentagram/Economist visual bar
- `docs/template-fidelity-and-depth-spec.md` — redundancy + logo fidelity
- `docs/excel-native-charts-and-fidelity-spec.md` — editable Excel charts via openpyxl, 15 slide-level defects

---

## The actual question for you (the new agent)

Marco's question — unchanged from the start of the session:

> **"how can we build legora for consultants?"**

But clarified through the session to include the three live shapes above (SaaS / services / PowerPoint add-in) and the "not fish not meat" tension.

### The specific ask

> "think strategically about all of this, understanding those few competitors I mentioned new, they do way different things but position themselves very clearly, and also we need to understand if we should make basquio living in power point or I don't know if we should work more towards a integrated workflow that answer questions, that support the analyst or if we really want to product these kind of output like service type of business. what I know for sure is that being in the land of nobody and nowhere is wrong and being not fish not meat as well."

### How to approach it (don't skip these)

1. **Research verified. Positions fabricated claims as uncacheable.** If you cite a fact about Legora, Auxi, Datost, any competitor, any market size, any customer — link the source or don't cite it. Marco will catch it.
2. **Sit with the question. Don't pattern-match to "PLG vs enterprise."** That's been rejected as a false dichotomy already. The real question is: which positioning lets Basquio stop being "nobody land."
3. **Three shapes, pick one or pick a sequence.** Give Marco an opinionated answer, not a 2×2 matrix. He wants a position, not analysis paralysis.
4. **Constraint-check every answer:** 5 co-founders, all with full-time jobs. Zero external funding. $10 external revenue. 7 days of PLG data. 62 users. Working product (but 20% gap per Stefania). Can't hire ex-MBB AEs. Can't do 18-month founder-led sales motion. Can write code, can ship commits at 14/day pace, can do cold outreach at small volumes.
5. **Look at Auxi's explicit positioning.** Their own comparison page tells you where the whitespace is. Don't reinvent that analysis — use it.
6. **The Loamly-Eminence pattern is the one proven commercial motion Marco has personally run.** Whatever you propose, explain how it relates to that pattern (replicate, ignore, or contradict).
7. **The five gated unknowns** (above) — decide which you can answer with research and which you need Marco's input on. Ask explicitly. Don't fake answers.

### Non-goals

- Don't propose another spec file. There are already 5 new specs from this week.
- Don't re-litigate the pricing tier structure — that's fine.
- Don't suggest hiring a CRO / AE / designer. Team is fixed.
- Don't suggest pivoting away from FMCG/CPG — vertical is set.
- Don't re-research Legora/Auxi/Datost unless you find a specific new angle that changes the recommendation. The facts above are Apr 17 verified.

### Expected output

A strategic position document (~2-3 screens of writing, not a 10-page spec) that answers:

1. **Which shape** — vertical AI SaaS, services-as-software, or PowerPoint add-in — or which **sequence** of them.
2. **Why that answer beats "not fish not meat."** What specifically is the position Basquio claims that nobody else claims.
3. **The first commercial move** — concrete, small, under-30-days, respecting the 5-co-founders-with-full-time-jobs constraint.
4. **What kills the thesis** — what would have to be true for this to be wrong, and what metric tells you within 30 days.
5. **What Marco needs to decide** — specific questions he has to answer that you can't.

Write it as if Marco will push back on every sentence. Because he will.

---

## Files changed but not committed at handoff time

At handoff, these tracked modifications are staged for commit:

- `packages/intelligence/src/index.ts`
- `packages/workflows/src/deck-manifest.ts`
- `packages/workflows/src/generate-deck.ts`
- `packages/workflows/src/system-prompt.ts`

Plus the specs and this handoff doc, all untracked. Full scope committed in the single commit that follows this handoff.

---

## One last thing

Marco's most important correction during this session:

> "if you don't know things... don't say, but if you think it's important to know fucking research it"

Operationalize this. Before every strategic claim, ask yourself: "Do I have a source? If I research this, will the answer change my recommendation?" If either is yes, research first.
