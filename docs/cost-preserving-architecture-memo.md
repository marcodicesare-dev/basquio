# Basquio Cost-Preserving Architecture Memo

Date: March 17, 2026

## 1. Executive Conclusion

The biggest cost in a 10/10 consulting-deck system is not storage, OCR, or export. It is repeated high-context cognition and revision on the parts of the workflow that decide what matters, what the recommendation is, and how the argument should land. In Basquio's current pipeline, the expensive failure mode is architectural: a three-attempt planning loop can rerun metrics, insights, story, slides, validation, and critique even when only one section is weak. That is a cost multiplier hidden inside the orchestration, not inside any single model bill. Repo evidence: `packages/workflows/src/index.ts`, `packages/intelligence/src/model.ts`.

The correct cost strategy is not "use cheaper models everywhere." It is:

1. Keep frontier reasoning only where executive judgment is actually created.
2. Make parsing, analytics, charting, layout, QA, and export deterministic by default.
3. Constrain visual freedom so rendering is correct by construction.
4. Cache evidence understanding and working papers across attempts, revisions, and follow-up runs.
5. Escalate model quality only for ambiguous, high-stakes, or visibly weak sections.

My recommendation is a hybrid architecture:

- `frontier core` for clarified brief, issue tree, recommendation synthesis, executive summary, and final semantic critique
- `mini / mid-tier` models for intake routing, metadata extraction, evidence-grounded fact checking, density/lint passes, and routine slide copy cleanup
- `deterministic scene-graph rendering` for layout, charts, PPTX, PDF, and QA
- `curated house templates by default`, with custom PPTX-template preservation reserved for enterprise paths
- `persistent evidence graph + reusable working papers`, so revisions are local and cheap instead of full reruns

That preserves the north star because the premium parts stay premium while the noisy, failure-prone, low-differentiation parts become cheap and reliable.

## 2. Where Cost Is Really Concentrated

### Pipeline Cost Map

| Stage | Expected cost intensity | Dominant driver | What it scales with | What should run it |
| --- | --- | --- | --- | --- |
| Intake, classification, manifesting | Low | Small model tokens, I/O | Number of files | Deterministic + nano/mini model only for ambiguous routing |
| Spreadsheet parsing | Low | CPU, memory | Rows, sheets, workbook size | Deterministic code |
| OCR / multimodal doc understanding | Medium, sometimes high | Per-page vision / OCR charges | Scanned pages, image-heavy docs | Selective multimodal or OCR vendor only when needed |
| Evidence normalization and storage | Low | Storage, egress | Files, bytes, retention | Deterministic infra |
| Package semantics | Medium | Reasoning tokens | File count, schema ambiguity | Mid-tier by default, frontier on ambiguity |
| Metric planning | Medium | Structured-output tokens | Metrics requested, dataset complexity | Mini/mid-tier + deterministic guards |
| Deterministic analytics | Low to medium | Compute, retries | Rows, joins, derived tables | Deterministic code |
| Insight ranking | Medium to high | Long-context synthesis | Number of candidate findings, sections, revisions | Mid-tier default, frontier on top findings |
| Storyline / issue tree / recommendation synthesis | High | Frontier output tokens + long context | Business ambiguity, slide stakes, revisions | Frontier model |
| Slide planning and authoring | Medium to high if free-form; medium if constrained | Layout ambiguity, writing, retries | Slide count, template freedom | Frontier only for high-value slides; deterministic layout |
| Critique / revision | Highest hidden cost | Duplicate inference + backtracking | Revision count, weak sections | Frontier critic + section-targeted reruns |
| Preview / rendering | Low to medium | Browser sessions, template complexity | Slide count, template complexity | Deterministic renderer |
| QA / export | Low | Browserless/runtime minutes | Slide count, export retries | Deterministic checks |
| Orchestration / retries / replay / caching | High if badly designed | Duplicate stage execution | Attempts, stale runs, replay behavior | Durable workflow + granular caches |

### Opinionated read

The real top-three cost centers are:

1. `storyline + recommendation synthesis`
2. `critique + revision loops`
3. `template-induced slide repair and rerender churn`

OCR and storage matter far less unless users upload lots of scanned PDFs. Supabase's public pricing makes that clear: the baseline database/storage economics are modest relative to repeated model calls and retries, with Pro starting at $25/month, 100 GB storage included, and egress/storage overages measured in cents per GB rather than dollars per deck-sized operation. Source: https://supabase.com/pricing

Browser rendering is also usually not the main problem. Browserless public pricing starts at $25/month and scales by browser-time units, which matters operationally but is still small relative to repeatedly sending high-context prompts through premium models. Source: https://www.browserless.io/pricing

### Why model routing matters so much

As of March 17, 2026, public pricing spreads are large enough that sloppy allocation is margin destruction:

| Model family | Standard input / 1M | Standard output / 1M | Implication |
| --- | --- | --- | --- |
| OpenAI GPT-5.4 | $2.50 | $15.00 | Use only for sections where judgment quality matters |
| OpenAI GPT-5 mini | $0.25 | $2.00 | Good default worker for structured, bounded tasks |
| Claude Sonnet 4.6 | $3.00 | $15.00 | Premium strategist / critic tier |
| Claude Haiku 4.5 | $1.00 | $5.00 | Strong cheaper worker tier |
| Gemini 2.5 Pro | $1.25 | $10.00 | Lower-cost frontier alternative |
| Gemini 2.5 Flash | $0.30 | $2.50 | High-volume worker tier |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | Classification and lint tier |

Sources:

- https://openai.com/api/pricing/
- https://platform.claude.com/docs/en/about-claude/pricing
- https://ai.google.dev/gemini-api/docs/pricing

That means the system should be designed around `where premium judgment changes deck quality`, not around uniform model assignment.

## 3. What Can Be Safely Made Cheaper

### Safe downgrades

| Job | Cheapest safe tier | Why |
| --- | --- | --- |
| File triage, role hints, manifest cleanup | Nano / Flash-Lite / Haiku-class | Mostly classification and extraction |
| Spreadsheet metadata extraction | Deterministic or nano | Headers, shape, basic types do not need frontier reasoning |
| OCR routing | Deterministic first | Only scanned/visual docs should incur vision cost |
| Package semantics draft | Mid-tier | Most of the work is schema interpretation, not recommendation quality |
| Metric planning draft | Mini / mid-tier | Deterministic guards catch invalid joins and columns |
| Fact checking against already-structured evidence | Mini / Haiku / Flash | This is verification, not original synthesis |
| Claim lint, density checks, layout lint, citation completeness | Nano / mini | Cheap reviewer passes are enough |
| Chart generation | Deterministic | Charts should come from `ChartSpec`, not model improvisation |
| Layout placement | Deterministic | Scene graph plus archetypes is cheaper and more reliable than AI positioning |
| PPTX/PDF rendering | Deterministic | Rendering is implementation, not moat |

### High-leverage cost levers available now

1. `Prompt caching`
   OpenAI says prompt caching can cut input token cost by up to 90%, and Anthropic cache hits cost 10% of base input pricing. This is especially valuable for repeated brief, evidence summary, template profile, and working-paper prefixes.
   Sources:
   - https://developers.openai.com/api/docs/guides/prompt-caching/
   - https://platform.claude.com/docs/en/about-claude/pricing

2. `Batch / Flex for non-urgent stages`
   OpenAI Batch gives a 50% discount, and Flex uses Batch-rate pricing with better caching flexibility. Anthropic Batch also gives a 50% discount. Google Gemini Batch prices are also materially lower than standard rates.
   Sources:
   - https://developers.openai.com/api/docs/guides/batch/
   - https://developers.openai.com/api/docs/guides/flex-processing/
   - https://platform.claude.com/docs/en/about-claude/pricing
   - https://ai.google.dev/gemini-api/docs/pricing

3. `Selective multimodal parsing`
   Scanned-doc OCR should be conditional, not default. Spreadsheet-like files already have cheaper parsing paths. OpenAI's file-input flow explicitly summarizes spreadsheets from up to the first 1,000 rows per sheet rather than blindly shipping full sheets into context, which is a clue that smart pre-processing matters.
   Source: https://developers.openai.com/api/docs/guides/file-inputs/

4. `Targeted reruns instead of full deck reruns`
   The cheapest high-quality system is the one that does not recompute healthy sections.

5. `Section-level escalation`
   Recommendation slides, the executive summary, and any slide flagged as weak should be the first escalation targets. Commodity evidence slides should not automatically inherit frontier pricing.

## 4. What Must Stay Premium

These are the sacred parts of the system. If Basquio cheapens these, it stops being Basquio and becomes another deck tool.

1. `Clarified brief`
   The model must understand client, audience, objective, thesis, and stakes before planning. A cheap misunderstanding here poisons the whole run.

2. `Issue tree / narrative spine`
   This is the intellectual product. If the issue tree is weak, no amount of rendering polish saves the deck.

3. `Recommendation synthesis`
   Users pay for what the deck tells them to do and why that recommendation is defensible.

4. `Executive summary and top 3-5 slides`
   These slides carry outsized buyer value. They should get the best reasoning and best critique.

5. `Evidence grounding of substantive claims`
   Every strong claim still needs evidence. This can use cheaper verification models in places, but the standard cannot drop.

6. `Independent semantic critique`
   A category-defining product needs a partner-level reviewer, not just schema validation.

7. `Final artifact trust`
   The user-visible output must feel finished. "Pipeline succeeded but the deck needs manual cleanup" breaks the north star.

## 5. Template Strategy Recommendation

### Recommendation

Use a `default house-template strategy` with `strict slide archetypes`, and reserve `arbitrary uploaded PPTX template fidelity` for enterprise.

The best template strategy for both quality and margin is:

1. `3-5 premium house templates` for default runs
2. `scene-graph-driven slide archetypes` underneath those templates
3. `template profile extraction once` for custom enterprise templates
4. `strict rendering into bounded zones`, not free-form AI visual composition

### Why this is the right trade

Fully flexible template generation sounds premium but is usually fake premium. It increases:

- planning ambiguity
- layout failure modes
- revision count
- PDF/PPT divergence risk
- QA surface area

By contrast, constrained template systems already win in the market because they deliver "beautiful and done" more reliably than blank-canvas freedom. Beautiful.ai explicitly sells Smart Slides and auto-design behavior, not total design freedom. Pitch and Gamma also package branded outputs and collaboration at tens of dollars per seat, not custom consulting-grade visual reasoning as the default experience.

Sources:

- https://www.beautiful.ai/pricing
- https://pitch.com/pricing/us
- https://gamma.app/pricing

### Opinionated answer to the user questions

- `Does offering only a few premium templates massively reduce cost and failure modes?`
  Yes. It reduces not only render cost but also revision cost, testing burden, and artifact QA risk.

- `Can pixel-perfect rendering be made much cheaper if the layout system is more constrained?`
  Yes. A scene-graph plus archetype system makes pixel fidelity mostly a deterministic rendering problem instead of an inference problem.

- `Does the user care more about "beautiful and done" than "infinite template freedom"?`
  Usually yes. Infinite template freedom matters mainly for enterprise brand-governed teams and agencies.

- `Which template strategy best preserves 10/10 while reducing complexity?`
  House templates by default, custom template preservation as a separately priced enterprise capability.

## 6. Best Architecture Options (Ranked)

### Option 1. Standard-template default + frontier strategist/critic + targeted escalation

| Dimension | Assessment |
| --- | --- |
| What changes | Default all runs to Basquio house templates and slide archetypes; use frontier only for brief clarification, story, recommendation slides, executive summary, and final critique |
| Savings target | Largest immediate savings on inference and revision churn |
| Quality impact | Positive if the house templates are genuinely premium |
| Risk to 10/10 | Low |
| Complexity | Medium |
| Best for | Default product path |

Why it ranks first:

- It attacks the biggest cost center, which is expensive cognition applied too broadly.
- It also attacks the biggest reliability problem, which is open-ended visual ambiguity.

### Option 2. Persistent evidence graph + cached working papers + section-level reruns

| Dimension | Assessment |
| --- | --- |
| What changes | Persist package semantics, metric outputs, evidence summaries, and slide-level working papers so revisions update only affected sections |
| Savings target | Revision-loop cost, prompt duplication, repeat-run cost |
| Quality impact | Strong positive |
| Risk to 10/10 | Very low |
| Complexity | High |
| Best for | Basquio's long-term moat |

Why it matters:

This is the architecture move that turns follow-up requests and revisions from "start over" into "continue thinking." It is one of the few cost reductions that also raises quality.

### Option 3. Cheap analysts + frontier strategist/critic

| Dimension | Assessment |
| --- | --- |
| What changes | Use cheap workers for intake, metadata, lint, fact checks, and candidate-insight generation; frontier model consolidates into the final story |
| Savings target | High-volume stage spend |
| Quality impact | Neutral to positive if arbitration is strong |
| Risk to 10/10 | Medium if the cheap analysts get too much authority |
| Complexity | Medium |
| Best for | Mature agent runtime with uncertainty scoring |

This works only if cheap analysts do not directly own the final recommendation.

### Option 4. Two-tier product: standard premium vs enterprise custom-brand

| Dimension | Assessment |
| --- | --- |
| What changes | Standard plan uses house templates and stricter slide-count ranges; enterprise adds uploaded PPTX masters, brand calibration, and custom QA |
| Savings target | Template complexity and support cost |
| Quality impact | Positive because the standard path becomes more reliable |
| Risk to 10/10 | Low |
| Complexity | Low to medium |
| Best for | Margin discipline and packaging clarity |

This is as much a product move as an architecture move, but it is one of the most important ones.

### Option 5. Human-in-the-loop only for high-risk decks

| Dimension | Assessment |
| --- | --- |
| What changes | Add manual review checkpoints only for enterprise, board, investor, or recommendation-heavy decks |
| Savings target | Avoid blanket human QA while protecting highest-stakes output |
| Quality impact | Positive for top-tier runs |
| Risk to 10/10 | Low if limited to flagged decks |
| Complexity | Medium |
| Best for | Enterprise and launch phase |

### Option 6. Full arbitrary-template support for all users

| Dimension | Assessment |
| --- | --- |
| What changes | Any user can upload any PPTX and expect near-perfect layout preservation |
| Savings target | None |
| Quality impact | Mixed |
| Risk to 10/10 | High |
| Complexity | Very high |
| Best for | Not the default product |

This is intentionally ranked last. It is expensive, support-heavy, and only strategically correct for higher-paying segments.

## 7. Recommended Product Packaging / Pricing Logic

### Core principle

Charge for `deck complexity and brand complexity`, not for raw model usage.

### Recommended packaging

#### Standard

- House templates only
- Strong reasoning and polished final slides
- Limited slide-count band, for example 10-30 slides
- Async turnaround, no arbitrary template upload

This should be the economic core of the business.

#### Premium

- House templates plus deeper critique, more revisions, or larger evidence packages
- Better fit for strategy and insight teams that care most about recommendation quality

#### Enterprise Custom Brand

- Uploaded PPTX master or brand system
- Template calibration fee
- Higher QA bar
- SLA / higher-touch support

### Willingness-to-pay hierarchy

This is partly an inference from public market pricing and partly a product judgment.

1. `Insight quality`
   This is the main wallet opener. Generic design tools are priced cheaply because design alone is not enough.

2. `Final slides I do not need to fix`
   This is nearly as important as insight quality because cleanup time destroys ROI.

3. `Brand fidelity`
   Very important for agencies, client-service teams, and enterprise internal comms. Less important for operators who just need a high-quality answer.

4. `Template flexibility`
   Valuable, but not nearly as valuable as a strong recommendation plus trustworthy output.

5. `Raw speed`
   Important only until the deck arrives inside the acceptable work window. Same-day beats perfect-in-3-minutes if the 3-minute version needs cleanup.

### Why I believe this

Public slide-tool pricing is low:

- Gamma: $9-$18/seat/month for mainstream paid plans, $90 for Ultra
- Beautiful.ai: $12/month individual, $40/user/month team
- Pitch: $13-$25/seat/month on annual plans

Sources:

- https://gamma.app/pricing
- https://www.beautiful.ai/pricing
- https://pitch.com/pricing/us

Inference:

The market clearly supports paying tens of dollars per seat for visual tooling and collaboration. That is not enough to absorb heavy, repeated frontier reasoning plus custom-brand complexity on every run. Therefore Basquio should not package itself like a commodity seat-priced presentation tool if it intends to deliver consultant-grade output.

## 8. What I Would Build First If Optimizing for Both Margin and 10/10 Quality

### First 30-45 days

1. `Stop whole-deck reruns`
   Persist stage outputs and make revisions section-targeted.

2. `Introduce deck modes`
   `standard`, `premium`, `enterprise-custom-brand`.

3. `Make house templates the default`
   Build premium house styles and route most runs there.

4. `Split slides by value density`
   Frontier for executive summary, recommendations, and any weak section; cheap/default for evidence slides and QA passes.

### Next 45-90 days

1. `Build a scene-graph renderer`
   Make slide placement deterministic and shared across PPTX and PDF.

2. `Persist evidence graph and working papers`
   Cache package semantics, metric outputs, evidence refs, and section summaries.

3. `Add prompt-cache-aware request design`
   Stable prefixes for brief, evidence summaries, template profiles, and prior accepted sections.

4. `Move non-urgent worker stages to Batch / Flex`
   Intake, lint, candidate-insight generation, and some fact-check passes.

### Longer-term architecture

1. `Per-section confidence scoring`
   Only weak or ambiguous sections escalate.

2. `Enterprise template calibration pipeline`
   Parse uploaded templates once, create a reusable template profile, charge for it.

3. `Artifact refinement loop`
   Render early, critique the actual preview, then repair only the affected sections.

## 9. Red Flags / Fake Optimizations To Avoid

1. `Using cheaper models everywhere`
   This directly attacks the product moat.

2. `Keeping arbitrary template freedom as the default`
   This raises cost and failure rates without increasing willingness to pay for most users.

3. `Running multimodal parsing on every file`
   Many files can be handled deterministically.

4. `Letting the model do visual polish directly`
   Visual quality should be achieved through better templates, archetypes, and rendering contracts.

5. `Rerunning the entire planning loop when one section fails critique`
   This is the most obvious hidden margin killer in the current architecture.

6. `Vectorizing everything`
   Retrieval only helps where memory reuse or evidence recall is genuinely needed. Blanket embedding is easy to justify and hard to monetize.

7. `Competing on seat price with Gamma / Pitch / Beautiful.ai`
   If Basquio delivers consultant-grade reasoning, its economics and packaging should not look like a slide editor.

8. `Optimizing export infra before fixing revision architecture`
   Browser/runtime spend is rarely the main issue. Duplicate cognition is.

## Source Notes

Primary repo context:

- `packages/workflows/src/index.ts`
- `packages/intelligence/src/model.ts`
- `docs/vision.md`
- `docs/architecture.md`
- `memory/canonical-memory.md`

External sources used:

- OpenAI pricing: https://openai.com/api/pricing/
- OpenAI prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching/
- OpenAI Batch API: https://developers.openai.com/api/docs/guides/batch/
- OpenAI Flex processing: https://developers.openai.com/api/docs/guides/flex-processing/
- OpenAI file inputs: https://developers.openai.com/api/docs/guides/file-inputs/
- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Browserless pricing: https://www.browserless.io/pricing
- Supabase pricing: https://supabase.com/pricing
- Gamma pricing: https://gamma.app/pricing
- Beautiful.ai pricing: https://www.beautiful.ai/pricing
- Pitch pricing: https://pitch.com/pricing/us

