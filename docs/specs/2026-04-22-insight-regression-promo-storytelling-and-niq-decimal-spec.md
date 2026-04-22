# Insight Regression + Promo Storytelling + NIQ Decimal Spec

## Scope

This spec covers three linked quality failures raised on April 22, 2026:

1. **Insight quality regressed over the last 5-6 days**, especially in decks for Rossella.
2. **Promo analysis is still not Nielsen-grade**, despite existing NIQ knowledge packs.
3. **Decimal rules are still not deterministic**, even after adding workbook presentation contracts.

This is a forensic and implementation-oriented spec. It does not assume the current prompt stack is correct just because the relevant concepts exist somewhere in the repo.

---

## Verdict

Rossella's feedback is valid.

The current system did not fail because it lacks generic FMCG knowledge. It failed because the last 5-6 days of changes **strengthened recommendation richness and client-pleasing framing more aggressively than they strengthened evidence discipline, storyline sequencing, and NIQ-specific presentation rules**.

The result is a predictable failure mode:

- the deck sounds more "strategic"
- but the story is less linear
- the model is more willing to infer or over-frame the opportunity
- the evidence chain is weaker
- SCQA-style narrative framing is stronger than mechanical NIQ drill-down depth
- promo analysis is not forced through a NielsenIQ-style decomposition cascade
- chart selection is sometimes disconnected from the actual claim being made
- redundant slides survive because commentary changes while the analytical cut does not
- decimal behavior still depends on header heuristics rather than on a deterministic NIQ metric policy

The PepsiCo reference deck confirms the target quality bar. NIQ promo storytelling is not "friendly recommendations with a few promo charts." It is a strict analytical sequence:

1. category baseline
2. value vs volume vs price context
3. promo vs no-promo decomposition
4. discount-tier decomposition
5. channel / format / brand drill-down
6. WD Promo / flyer / display mechanics
7. focal-brand comparison versus the main competitor
8. only then a short growth synthesis

Basquio currently knows pieces of this. It does not yet enforce it as a contract.

---

## Primary Evidence

### Rossella feedback

The user-provided feedback identifies concrete failure classes:

- decimals still wrong
- promo analysis still weak
- the analytical / deck-builder layer now leans too much on SCQA and too little on deep combinatorial mechanics across market x channel x promo x format x competitor
- value sales were over-weighted when price inflation should have pushed the analysis toward volume
- title hallucinated an explicit +10% growth target not present in the brief
- Segafredo disappeared from some manufacturer/player slides
- Borbone growth explanation was invented from narrative priors rather than shown by the numbers
- distribution opportunity claims were not supported by rotation / productivity evidence
- some slides state the right issue but chart the wrong KPI, so the prose and the exhibit are disconnected
- some slides are redundant because the comment evolves but the chart still answers the same question as an earlier slide
- overall message flow was less clear and less linear than prior decks
- restrictive briefs may currently make the system more chaotic instead of more disciplined

### Repo evidence from the regression window

Relevant commits in the last 5-6 days:

- `feedfdb` Harden intelligence upgrade: visual quality, tone, evidence co-location
- `da02a94` Align prompt flow with runtime learnings
- `09d9a5e` Add strategic positioning handoff + consolidate specs and intelligence validators
- `5f33d90` Add author-time rubric for deck quality
- `7adb611` Iterate revise passes based on deck issue load
- `38736c0` Add deterministic workbook presentation contract

### Prompt / runtime evidence

The current prompt stack explicitly pushes recommendation framing:

- `packages/workflows/src/generate-deck.ts`
  - "Use the recommendation framework from the knowledge pack: opportunity first, specific lever second, rationale anchored to visible evidence, and a concrete timeline."
  - long-deck rule now demands large recommendation depth
- `packages/workflows/src/system-prompt.ts`
  - includes `client_pleasing_recommendation_card`
  - explicitly says: "Title states the OPPORTUNITY, not the problem"
  - recommendation cards prioritize action verb, EUR prize, and timeline

The current decimal layer is still heuristic:

- `packages/workflows/src/metric-presentation.ts`
  - infers metric family from header text
  - assigns decimals from semantic-family heuristics
  - does not bind to a first-class NIQ rules table by metric type + variation type + context

### PepsiCo reference deck evidence

The attached PepsiCo PDF and page images show the real NIQ promo grammar:

- Page 4:
  - title states the finding
  - category baseline combines value, volume, promo/no-promo split, promo pressure, and average price
  - this is already an inflation-aware setup, not a naive value-first chart
- Page 28:
  - focal brand vs main competitor
  - price architecture on top
  - evidence table below with `Volume Share`, `Vol Promo Sales`, `WD Promo`, `% Discount`
  - opportunity callout is explicitly supported by WD Promo gap
- Page 82:
  - final recommendation slide is short
  - only 3 actions
  - each action is a compressed synthesis of prior evidence, not a speculative new claim

Local extraction artifact:

- `.context/pepsico-promo-analysis.txt`

Rendered page checks used:

- `/tmp/attachments/NIQ x PEPSICO - Categories Promo Analysis -  AT February 2026 (1)_page_4.png`
- `/tmp/attachments/NIQ x PEPSICO - Categories Promo Analysis -  AT February 2026 (1)_page_28.png`
- `/tmp/attachments/NIQ x PEPSICO - Categories Promo Analysis -  AT February 2026 (1)_page_82.png`

### Additional screenshot evidence from the failed pattern

The user also attached two screenshots that expose a more precise failure mode:

- `/tmp/attachments/image-v8.png`
  - the slide claims a **productivity / rotation** problem in Iper Capsules
  - but the hero chart is **sales value**
  - the true productivity numbers appear only in a small side note
  - this is analytically weak because the exhibit hero does not prove the stated claim
- `/tmp/attachments/image-v9.png`
  - the comment identifies an interesting price-led interpretation
  - but the chart still uses a growth / ranking cut that overlaps with an earlier market-reading slide
  - the better move would have been to switch the exhibit to **price mechanics**, not just rewrite the commentary

These screenshots confirm that the issue is not only weak copy. It is also a chart-selection and evidence-binding problem.

---

## Forensic Findings

## 1. Recommendation framing became stronger than evidence discipline

This is the clearest regression.

The prompt stack now strongly enforces:

- opportunity-first recommendation titles
- quantified upside when possible
- timeline / scenario / roadmap structure
- recommendation-card richness in long decks

But it does **not** enforce with the same strength:

- inflation-aware value-to-volume pivots
- focal-brand persistence on every competitor slide
- "no invented target" rules for slide titles
- rotation / productivity proof before claiming distribution opportunity
- promo decomposition sequencing before synthesis

This creates a bias toward:

- polished framing
- stronger prescriptive language
- more synthesized actions

before the deck has earned that synthesis analytically.

That exactly matches Rossella's complaint: less clear, less linear, more invented.

## 2. The system knows NIQ motifs, but not the NIQ promo storyline contract

The NIQ playbook and master knowledge graph already contain:

- price/mix tension
- promo dependence
- rotation
- distribution gap
- recommendation levers

But they stop at motif-level guidance.

They do **not** currently define a mandatory promo-story sequence such as:

1. state category trend
2. compare value vs volume
3. test whether price inflation is distorting value
4. split promo vs no-promo
5. decompose discount tiers
6. localize by channel / format / area
7. compare focal brand against competitor on WD Promo / discount / rotation
8. only then state the opportunity

The PepsiCo deck shows this sequence repeatedly. Basquio currently does not.

## 2a. The system is leaning too much on SCQA and not enough on combinatorial analytical depth

SCQA is not wrong by itself. It is the wrong dominant abstraction for this class of decks.

For NIQ deep-dive work, especially promo analysis, the real analytical engine should be a mechanical decomposition across dimensions such as:

- market / segment
- channel
- area / retailer
- brand / competitor
- format / pack
- promo vs no-promo
- discount tier
- WD Promo / display / folder
- rotation / productivity

The PepsiCo reference deck is built that way. The current Basquio stack increasingly treats the deck as:

- Situation
- Complication
- Question
- Answer

with stronger synthesis pressure and weaker combinatorial drill-down pressure.

That makes the deck sound cleaner at the paragraph level, but analytically shallower. For this product, SCQA should be the narrative wrapper, not the primary analytical engine.

## 3. Inflation awareness exists conceptually, but not as a hard pivot rule

The knowledge packs already know `price_mix_tension`:

- "value growth > volume growth" means price-driven growth

But the runtime does not yet enforce a hard storytelling consequence:

- when price inflation materially distorts value growth, the deck must acknowledge value first, then pivot to volume-led analysis for the commercial story

Rossella's coffee example is exactly this failure. The system recognized price inflation as a concept, but did not elevate it into a storyline override.

## 4. The system does not protect the focal brand strongly enough during player slides

There is a weak prompt rule:

- if brief is about promotions, benchmark focal brand vs competitors

That is not enough.

Rossella's requirement is stronger:

- whenever the deck talks about players / manufacturers / competitors, the focal brand must remain visible and explicitly located in the comparison, even if it is small

Today there is no first-class runtime rule for this.

## 5. Claim traceability is still too weak for explanatory language

The current stack already blocks some unsupported numbers, but it still leaves room for soft hallucinations such as:

- "premium Italian brand"
- cultural or consumer explanations not shown in the data
- strategic motives assigned to competitors without evidence

The prompt says to distinguish facts from interpretations, but the critique architecture does not yet appear to have a hard domain-specific ban on explanatory copy when the evidence is only numeric.

This is how decks can sound plausible while still making NIQ analysts angry.

## 6. Distribution opportunities are not tied tightly enough to productivity evidence

The NIQ playbook already says opportunities should include:

- distribution gaps
- SKU productivity
- scatter of distribution vs velocity

But the generation prompt does not currently enforce:

- if the recommendation is "expand distribution"
- then the deck must show either rotation, ROS, value per distribution point, or fair-share logic

Without that, "distribution opportunity" becomes generic consulting filler.

Page 28 of the PepsiCo reference deck shows the correct version: the opportunity is grounded in `WD Promo` gap and promo productivity evidence.

## 6a. Chart selection is sometimes disconnected from the claim

This is now a first-class failure mode.

The system can identify the right business issue in prose, but still render a chart for a different metric family. That makes the slide superficially clear while failing analytical scrutiny.

Observed pattern from `/tmp/attachments/image-v8.png`:

- claim: Segafredo has a productivity / rotation problem
- hero chart: sales value by brand
- actual support: a side note with productivity per distribution point

That is backwards. If the claim is rotation, the hero metric must be rotation, ROS, value per distribution point, or another direct productivity measure.

Observed pattern from `/tmp/attachments/image-v9.png`:

- comment: the market dynamic is price-led
- hero chart: another growth / ranking cut
- better exhibit: explicit price mechanics

This means the chart generator and the insight generator are partially decoupled.

## 6b. Redundant slides survive because commentary changes instead of the analytical cut

Rossella's slide-6 feedback exposes another structural issue:

- an earlier slide already covered the market read
- a later slide added a more interesting comment
- but the exhibit stayed on the old metric family instead of moving to a new causal cut

So the system is capable of recognizing a new comment angle without enforcing:

- a new metric
- a new exhibit type
- a new analytical question

That creates decks that feel repetitive even when the text is not identical.

## 7. Decimal rules were added as a contract shell, but not as an NIQ-specific truth table

The recent workbook work added:

- `MetricPresentationSpec`
- `ExhibitPresentationSpec`
- `metric-presentation.ts`

That is good infrastructure, but not sufficient product truth.

Current behavior still depends on:

- tokenized header inference
- broad semantic families
- generic decimal defaults

This is why Rossella can still see wrong decimals after "the rules were added."

The missing piece is a deterministic NIQ decimal policy keyed by metric semantics, not by opportunistic header matching alone.

## 8. Restrictive briefs are probably being over-obeyed instead of normalized

Rossella's hypothesis is plausible and the current stack supports it.

The runtime says:

- frame around the true commercial question

But the generation layer also passes a very heavy instruction pack plus the brief directly into deck generation. There is not yet a strong, explicit "brief canonicalization" contract that says:

- objective from brief
- constraints from brief
- non-authorized targets that must never be inferred from brief tone

When the brief is restrictive, the model is likely over-fitting to prompt pressure plus recommendation priors instead of clarifying the commercial question and then discarding non-essential verbosity.

---

## Root Cause Mapping To Rossella's Complaints

### "Decimali ancora sbagliati"

Root cause:

- decimal logic is still heuristic in `packages/workflows/src/metric-presentation.ts`
- NIQ decimal rules are not yet a first-class deterministic table shared by workbook, deck labels, markdown tables, and chart labels

### "Parte promozioni da sistemare"

Root cause:

- promo analysis is not governed by a mandatory NIQ promo storyline contract
- the system can mention promotions without performing the full decomposition Nielsen analysts expect

### "Ha fatto prevalere le vendite a valore invece del volume"

Root cause:

- `price_mix_tension` is present as knowledge but not enforced as a narrative override
- there is no hard inflation-aware switch rule

### "Titolo allucinato con +10%"

Root cause:

- recommendation framework and prompt examples heavily bias toward quantified opportunity framing
- no hard anti-hallucination rule prevents invented targets in titles unless the brief or visible evidence explicitly contains them

### "Segafredo manca quando parla dei player"

Root cause:

- no first-class focal-brand persistence rule on competitor/manufacturer slides

### "Attribuisce motivazioni non presenti nei numeri"

Root cause:

- explanatory copy still has too much freedom relative to claim-traceability enforcement

### "Opportunità distributiva senza rotazioni"

Root cause:

- no explicit evidence dependency linking distribution claims to ROS / rotation / productivity / fair-share proof

### "Messaggi meno efficaci, non chiari, flusso non lineare"

Root cause:

- the system is over-optimizing recommendation richness
- under-enforcing drill-down sequence and deck-level storyline compression
- not normalizing restrictive briefs into a clear commercial question early enough

### "Dice rotazioni ma mette vendite nel grafico"

Root cause:

- no hard claim-to-chart metric binding rule
- slide commentary can identify the right issue while the chart generator still selects a more generic KPI

### "Slide 6 inutile, commento interessante ma grafico sbagliato"

Root cause:

- no strong redundancy guard at the analytical-question level
- no rule forcing a new slide to introduce a new metric family or causal driver instead of reusing the previous cut

---

## Target State

Basquio should behave like this for NIQ / promo work:

1. detect inflation / price-mix tension early
2. decide whether the main commercial lens should be value or volume
3. use SCQA only as a wrapper while the body of the deck follows a true multi-dimensional drill-down
4. run a deterministic promo-analysis cascade
5. keep the focal brand visible in every player comparison
6. ban invented strategic motives and invented targets
7. require productivity evidence for distribution claims
8. force the hero chart metric to match the claim metric
9. kill redundant slides unless they introduce a genuinely new analytical question or deeper cut
10. keep recommendation slides short and downstream of evidence
11. apply NIQ decimal policy deterministically everywhere

---

## Required Changes

## A. Add a first-class NIQ Promo Story Contract

### Goal

Turn promo analysis from a loose motif into a reusable analytical sequence.

### New canonical knowledge artifact

Add:

- `docs/domain-knowledge/niq-promo-storytelling-playbook.md`

### Required contract

For promo-led briefs, the analysis must follow this default order unless the evidence truly lacks the required fields:

1. **Category baseline**
   - value sales
   - volume sales
   - average price
   - promo vs no-promo contribution
2. **Inflation test**
   - compare value trend vs volume trend
   - if value is materially inflated by price, state that and pivot the rest of the story to volume
3. **Promo pressure**
   - total promo intensity
   - discount tier decomposition
   - display / folder / in-store mechanics where available
4. **Competitive lens**
   - focal brand versus key competitor(s)
   - keep focal brand visible even if it is smaller
5. **Localization**
   - channel
   - area / geography
   - format / pack
6. **Mechanics**
   - WD Promo
   - % discount
   - promo sales
   - no-promo sales
   - monthly activation timing if present
7. **Opportunity**
   - only after evidence shows the gap and mechanism
8. **Synthesis**
   - 2-4 short actions max

### Analytical depth rule

For NIQ / promo decks, SCQA may organize the macro-arc, but the body of the deck must be planned as a drill-down matrix across:

- market / segment
- channel
- area / retailer
- brand / competitor
- pack / format
- promo mechanic
- productivity / rotation

The deck should aim to be at least as analytically deep as the PepsiCo reference and ideally stronger.

### Runtime impact

Wire this into:

- `packages/workflows/src/system-prompt.ts`
- `packages/workflows/src/generate-deck.ts`
- `packages/intelligence/src/domain-knowledge.ts`
- `packages/intelligence/src/fmcg-semantic-layer.ts`

## B. Add an inflation-aware value-to-volume pivot rule

### Goal

Prevent value-inflated decks from telling the wrong commercial story.

### Required behavior

If the evidence shows material `price_mix_tension`, the deck must:

1. acknowledge value trend
2. explicitly show price inflation / average price change
3. pivot the commercial interpretation to volume
4. keep recommendations and growth claims anchored to volume unless the brief explicitly says value is the primary KPI

### Trigger rule

Use a deterministic condition such as:

- price growth materially positive and
- value trend materially better than volume trend

The exact numeric threshold can be tuned, but the behavior must be deterministic and visible.

### Runtime impact

Wire into:

- `docs/domain-knowledge/niq-analyst-playbook.md`
- `docs/domain-knowledge/niq-master-knowledge-graph.md`
- `packages/workflows/src/generate-deck.ts`
- critique / lint layers so a value-first deck fails QA when inflation-aware pivot is missing

## C. Ban invented targets and inferred strategy titles

### Goal

Stop slide titles from creating client objectives that were not in the brief.

### Required rule

A title or recommendation may only include:

- an explicit target from the brief, or
- a quantified opportunity directly derivable from visible data

It may **not** invent:

- growth targets
- market-share targets
- financial targets
- competitor motives
- cultural / premium / shopper narratives not shown in the evidence

### Runtime impact

Strengthen:

- `packages/workflows/src/system-prompt.ts`
- `packages/workflows/src/claim-traceability-qa.ts`
- revise critique prompts

Add a QA rule such as:

- `invented_target_or_motive`

## D. Add focal-brand persistence on player slides

### Goal

Ensure the client's brand never disappears from competitive analysis.

### Required rule

When the deck discusses:

- players
- manufacturers
- competitors
- supplier comparison

the focal brand must remain explicitly shown, called out, or annotated on the exhibit.

Even if the focal brand is small, the slide must answer:

- where is the focal brand?
- how is it performing relative to the leaders?
- what implication follows for the focal brand?

### Runtime impact

Wire into:

- `packages/workflows/src/generate-deck.ts`
- `packages/intelligence/src/slide-plan-linter.ts`
- critique / QA

Add a lint rule such as:

- `focal_brand_missing_from_player_slide`

## E. Require productivity proof for distribution opportunities

### Goal

Ban generic "expand distribution" recommendations.

### Required rule

A distribution recommendation must show at least one of:

- rotation / ROS
- value per distribution point
- fair-share index
- distribution gap plus above-benchmark productivity

Without that evidence, the recommendation must be reframed as a hypothesis or removed.

### PepsiCo-derived contract

The closest NIQ-style support set is:

- `WD Promo`
- `Vol Promo Sales`
- `% Discount`
- optionally ROS / rotation / fair share

### Exhibit binding rule

If the slide claim is about:

- rotation
- productivity
- ROS
- distribution productivity gap

then the hero exhibit must show that metric family directly.

It is not acceptable to:

- chart sales value
- mention productivity only in a side note
- expect the prose to bridge the gap

### Runtime impact

Wire into:

- `docs/domain-knowledge/niq-analyst-playbook.md`
- `packages/workflows/src/system-prompt.ts`
- `packages/workflows/src/claim-traceability-qa.ts`

## F. Replace heuristic decimals with a deterministic NIQ metric policy

### Goal

Make decimal behavior deterministic across all artifacts.

### Required canonical artifact

Add:

- `docs/domain-knowledge/niq-decimal-policy.md`

This policy must encode, at minimum:

- sales value / volume / packs
- distribution
- TDP
- promo intensity
- share
- price
- average refs
- rotation
- indices
- variation columns inheriting the base metric precision
- scaled-thousands / millions exceptions

### Required runtime change

`MetricPresentationSpec` should not be inferred only from header tokens.

It should resolve by:

1. canonical metric mapping if known
2. NIQ decimal policy table
3. only then heuristic fallback

### Runtime impact

Wire into:

- `packages/workflows/src/metric-presentation.ts`
- `packages/workflows/src/generate-deck.ts`
- workbook chart labels
- markdown tables
- PPT metric chips / exhibit labels

If necessary, extend:

- `code/contracts.ts`

with explicit NIQ metric presentation policy objects

## G. Normalize restrictive briefs into a commercial question contract

### Goal

Prevent restrictive briefs from creating chaotic decks.

### Required behavior

Add a clarified-brief stage that explicitly separates:

- true commercial objective
- focal entity / brands
- mandatory constraints
- prohibited inferences
- preferred KPI lens: value / volume / both
- requested deliverable tone

If the brief is overly procedural or restrictive, the system must compress it into a cleaner analytical objective instead of obeying every phrase literally.

### Runtime impact

Wire into:

- `packages/workflows/src/generate-deck.ts`
- possibly `packages/workflows/src/v2-orchestration.ts` if reused
- working papers for `clarified_brief`

## H. Make the final recommendation section shorter and more downstream of evidence

### Goal

Return to Nielsen-style synthesis instead of overbuilt recommendation theater.

### Required behavior

For promo / NIQ decks:

- recommendation section should usually be 1-2 slides in short and medium decks
- each action must compress prior evidence
- no new unsupported claim should first appear on the recommendation slide

This is the opposite of the current drift toward more cards, more roadmap, more scenario machinery by default.

### Runtime impact

Tune:

- `docs/domain-knowledge/basquio-recommendation-framework.md`
- `packages/workflows/src/generate-deck.ts`
- `packages/workflows/src/system-prompt.ts`

to let evidence depth cap recommendation depth rather than forcing card count from deck length alone

## I. Add claim-to-chart metric binding and redundancy guards

### Goal

Ensure that each exhibit directly proves the claim on the slide and that repeated analytical cuts are eliminated.

### Required behavior

For every analytical slide:

1. infer the claim metric family from the title and commentary
2. verify that the hero chart uses that same metric family or a valid causal driver of it
3. reject the slide if the chart and the claim are mismatched

Examples:

- if the claim says rotation problem, chart rotation / ROS / productivity
- if the claim says price-led growth, chart price and value-vs-volume decomposition
- if the claim says distribution gap, chart distribution plus productivity if the recommendation is expansion

### Redundancy rule

Two slides may not survive if they answer the same analytical question with:

- the same metric family
- the same grain
- the same comparison set

while only changing the prose.

To justify a second slide, it must introduce at least one of:

- deeper grain
- different metric family
- different causal driver
- different decision-relevant comparison set

### Runtime impact

Wire into:

- `packages/intelligence/src/slide-plan-linter.ts`
- `packages/workflows/src/generate-deck.ts`
- critique / revise QA

Add lint rules such as:

- `claim_chart_metric_mismatch`
- `redundant_analytical_cut`
- `commentary_ahead_of_exhibit`
- `storyline_backtracking`

## J. Add storyline branch-contiguity rules

### Goal

Stop decks from jumping from one analytical branch to another and then back again in a way that feels non-linear.

### Required behavior

For analytical content slides, each branch should stay contiguous.

Bad:

- category
- segments
- channels
- segments again
- promo mechanics

Good:

- category
- segments
- channels / retailers
- price / promo mechanics
- synthesis / implication

### Exception

A later revisit is allowed only when it is clearly marked as one of:

- explicit comparison
- synthesis
- implication recap
- genuinely deeper follow-up

Otherwise it should fail plan lint as storyline backtracking.

### Runtime impact

Wire into:

- `packages/intelligence/src/slide-plan-linter.ts`
- plan-lint handling in `packages/workflows/src/generate-deck.ts`

---

## Implementation Plan

## Phase 1. Forensic-safe prompt and QA fixes

1. Add NIQ promo storytelling playbook.
2. Add NIQ decimal policy.
3. Add anti-hallucination rule for invented targets and motives.
4. Add focal-brand persistence rule.
5. Add rotation / productivity dependency for distribution claims.
6. Add inflation-aware value-to-volume pivot rule.
7. Add claim-to-chart metric binding checks.
8. Add redundancy checks at the analytical-question level.

Expected impact:

- immediate quality improvement
- low schema risk
- should reduce the exact Rossella failure modes

## Phase 2. Deterministic runtime binding

1. Replace heuristic decimal resolution with policy-first lookup.
2. Persist the resolved metric presentation in manifests and workbook bindings.
3. Add explicit critique / lint rules for:
   - invented target or motive
   - missing focal brand on competitor slide
   - distribution recommendation without productivity proof
   - inflation-aware pivot missing
   - promo storyline order broken
   - claim / chart metric mismatch
   - redundant analytical cut

Expected impact:

- quality becomes less prompt-fragile
- revise can catch the failures before export

## Phase 3. Brief normalization and long-deck tightening

1. Add clarified commercial-question contract.
2. Make recommendation depth conditional on evidence depth, not only slide count.
3. Adjust long-deck planning so drill-down coherence beats card richness.
4. Make SCQA explicitly subordinate to drill-down depth in NIQ / promo planning.

Expected impact:

- fewer chaotic decks from restrictive briefs
- more linear stories

## Phase 4. Eval-driven hardening so copy upgrades cannot break intelligence

This phase is mandatory. Prompt changes alone are not a safe control system.

The quality hardening pass must follow current eval best practices:

- deterministic gates for hard failures
- rubric-based grading for softer qualities
- pairwise / pass-fail judgment where possible instead of vague open-ended scoring
- continuous evaluation on every meaningful prompt / runtime change
- machine-readable eval outputs stored over time

For Basquio that means:

1. separate **intelligence non-negotiables** from **client-friendly copy**
2. fail the run or change set if intelligence regresses, even when readability improves
3. keep a benchmark corpus of Rossella / Francesco class good decks and known-bad regression cases
4. run deterministic validators first, then optional LLM-judge grading for softer dimensions
5. tag failures by class so tuning can be surgical

### Required eval dimensions

Hard-gate dimensions:

- factuality
- evidence linkage
- intelligence non-negotiables
- decimal discipline
- compatibility

Soft optimization dimensions:

- client-friendly copy
- narrative linearity
- promo analytical depth
- strategic value
- visual quality

### Intelligence non-negotiables

The eval harness must fail if any of these occur:

- invented target
- invented motive / narrative
- claim / chart metric mismatch
- focal brand missing from a player slide
- distribution claim without productivity proof
- inflation-aware pivot missing
- redundant analytical cut surviving
- decimal policy violation

### Runtime impact

Wire this into:

- `packages/intelligence/src/eval-harness.ts`
- deterministic validators under `packages/intelligence/src/*`
- regression scripts under `scripts/*`
- release / QA process so every prompt hardening pass is compared against the benchmark set before rollout

---

## Acceptance Criteria

The fix is not complete unless all of the following are true.

### A. Inflation-aware storytelling

For a category with visible price inflation:

- deck acknowledges value trend
- deck shows price inflation
- deck pivots to volume-led interpretation when appropriate
- recommendations do not stay naively value-led

### B. Promo-analysis depth

For a promo brief:

- deck includes promo vs no-promo logic
- discount tiers are analyzed when available
- WD Promo / display / folder mechanics are shown when available
- final synthesis only appears after those evidence steps

### C. Focal-brand persistence

For every competitor / manufacturer slide:

- focal brand is visible or explicitly annotated
- slide states the implication for the focal brand

### D. Anti-hallucination

The system must never:

- invent a growth target not present in the brief or derivable from the data
- invent competitor motives or premium narratives not supported by evidence

### E. Distribution proof

If the deck says "distribution opportunity":

- it must show productivity evidence
- otherwise the claim fails QA

### F. Claim / exhibit coherence

If the slide says a metric is the issue:

- the hero chart must show that metric or a direct driver of it
- support text cannot rescue a mismatched hero exhibit

### G. Redundancy control

If a later slide only rewrites the commentary while keeping the same analytical cut:

- it should be merged, replaced, or deepened
- it should not survive as a separate content slide

### H. Decimals

The same metric must display with the same decimal rule across:

- workbook cells
- workbook chart labels
- PPT labels
- markdown tables

### I. Storyline quality

Compared to the current regression class, Rossella-style review should observe:

- fewer vague messages
- fewer inferred narratives
- fewer SCQA-only slides that skip the mechanical drill-down
- charts that directly prove the governing thought
- fewer repeated analytical cuts with different prose
- clearer What -> Why -> So What -> Now What flow
- recommendation slides that feel compressed and earned

### J. Safety against style regressions

If a prompt or runtime change improves:

- client-friendly tone
- readability
- recommendation polish

but worsens any intelligence non-negotiable, the change must fail evaluation and not be treated as an improvement.

---

## Non-Goals

This spec does not propose:

- new UI polish
- new template work
- generic "make copy friendlier" prompt tuning
- broader market-research or shopper-panel features outside the current NIQ promo scope

The issue is analytical contract quality, not visual chrome.

---

## Concrete Files To Touch In The Implementation Pass

Priority candidates:

- `docs/domain-knowledge/niq-analyst-playbook.md`
- `docs/domain-knowledge/niq-master-knowledge-graph.md`
- `docs/domain-knowledge/basquio-recommendation-framework.md`
- `packages/workflows/src/system-prompt.ts`
- `packages/workflows/src/generate-deck.ts`
- `packages/workflows/src/metric-presentation.ts`
- `packages/workflows/src/claim-traceability-qa.ts`
- `packages/intelligence/src/domain-knowledge.ts`
- `packages/intelligence/src/fmcg-semantic-layer.ts`
- `packages/intelligence/src/slide-plan-linter.ts`
- `code/contracts.ts` if the decimal policy or promo-story contract becomes schema-backed

New docs likely required:

- `docs/domain-knowledge/niq-promo-storytelling-playbook.md`
- `docs/domain-knowledge/niq-decimal-policy.md`

---

## Final Judgment

The regression is real, but it is not a mysterious "Opus got worse" problem.

It is a contract problem:

- the system now pushes stronger recommendation behavior than analytical discipline
- the system lets SCQA dominate over NIQ-style mechanical drill-down depth
- NIQ promo analysis is under-specified as a story contract
- chart selection is not tightly bound to the claim being made
- redundant slides are not being killed when the analytical question is unchanged
- decimal logic is still heuristic
- restrictive briefs are not normalized hard enough

If we only tune the prompt tone again, this will recur.

The fix must be structural and QA-enforced.
