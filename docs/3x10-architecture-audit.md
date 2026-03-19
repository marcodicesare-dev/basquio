# Basquio 3x10/10 Architecture Audit

Date: 2026-03-19

## Executive summary

Basquio is currently trying to do two things at once: keep a legacy contract pipeline alive while also building a more agentic v2 system. That split is the main reason the product is neither reliably premium nor cheap. Intelligence is still partially retail-hardcoded inside shared logic, beauty is limited by a weak house-style system plus lossy template preservation, and compatibility is only truly intentional in the newer v2 PPTX renderer, not across the end-to-end product.

The fastest path to 3x10/10 is not "more agent loops." It is a stricter product contract:

1. Make analysis mode, evidence convergence, and uncertainty first-class runtime objects.
2. Delete retail/client-specific intelligence from the core path.
3. Consolidate onto one orchestration path.
4. Make house-style decks the default product, with template-preserving PowerPoint as a separate premium mode.
5. Use premium models only for the narrowest stages that actually need frontier reasoning.
6. Turn revisions into section-local deterministic repair, not whole-run re-authoring.
7. Replace metadata-based visual QA with actual rendered-preview QA.

My read is:

- 10/10 intelligence is achievable only if Basquio becomes domain-neutral and evidence-first.
- 10/10 beauty is achievable only if Basquio reduces template freedom and leans into locked archetypes.
- 10/10 compatibility is achievable only if export mode becomes an explicit product contract.
- `< $1` is realistic for standard house-style, mostly tabular runs with bounded critique and aggressive caching.
- `< $1` is not realistic for every custom-template, multimodal, revision-heavy run. For those, the honest target is closer to `$1.5-$4` unless quality is reduced.

## Current architecture audit

### 1. Intelligence is not yet domain-neutral

The core intelligence package still contains active retail/Nielsen-specific logic:

- `packages/intelligence/src/metrics.ts:213` routes fallback metric planning through `isRetailMarketDataset(...)`.
- `packages/intelligence/src/metrics.ts:385` hardcodes columns and retail semantics like `AFFINITY`, `MDD`, `MERCATO_ECR4`, and supplier/category logic.
- `packages/intelligence/src/validate.ts:424` special-cases retail market-share validation.
- `packages/intelligence/src/insights.ts:216` and `packages/intelligence/src/story.ts:177` still carry retail narrative assumptions.

This directly conflicts with the stated product requirement that the system infer the right analysis style from brief plus evidence rather than from vertical hardcoding.

### 2. Analysis mode is not a durable contract

The repo has richer mode/type contracts, but they are not driving the runtime:

- `code/contracts.ts:282` and `packages/types/src/index.ts:123` default the brief into a thin, generic executive frame.
- `code/v2-contracts.ts:435` defines richer analysis-mode types, but the active logic still infers mode mostly from prompt keywords.
- `packages/intelligence/src/agents/analyst.ts:71` and `packages/intelligence/src/story.ts:346` use keyword-driven mode/story defaults.

Today, "analysis style" is mostly prompt behavior, not a persisted object shared across semantics, metrics, story, validation, and rendering.

### 3. Evidence convergence is weak

Basquio can cite evidence, but it does not yet model corroboration or conflict:

- `code/contracts.ts:230` gives `EvidenceRef` a single source file identity.
- `packages/intelligence/src/insights.ts:146` computes confidence from cited refs, but not from cross-source convergence.
- `code/v2-contracts.ts:448` has richer typed evidence and source-coverage schemas, but they are not the main execution contract.
- `packages/intelligence/src/tools/data-exploration.ts:321` reconstructs pseudo-tabular data out of PPTX/PDF tables, then computes metrics on that output with weak provenance penalties.

This means the system cannot robustly say "this claim is independently supported by CSV plus PPTX plus PDF" versus "this came from one reconstructed artifact."

### 4. Weak evidence still becomes plausible output

There are several bluffing risks:

- `packages/intelligence/src/utils.ts:127` floors evidence scoring at `0.4`.
- `packages/intelligence/src/analytics.ts:636` starts deterministic confidence at `0.5`.
- `packages/intelligence/src/agents/analyst.ts:305` fabricates a generic fallback analysis if the agent misses structure.
- `packages/intelligence/src/tools/critique.ts:54` can mark claims as verified if an evidence ref exists even when no expected value is supplied.

The system needs stronger "insufficient evidence" behavior, not prettier medium-confidence labels.

### 5. Orchestration is structurally expensive

The v2 path uses too many expensive cognition passes:

- Analyst: `packages/intelligence/src/agents/analyst.ts:59`, up to 30-step tool loop on `gpt-5.4`.
- Planner: `packages/workflows/src/v2-orchestration.ts:1710`, another `gpt-5.4` planning call.
- Author: `packages/intelligence/src/agents/author.ts:76`, up to 50-step tool loop on `claude-opus-4-6`.
- Critic: `packages/intelligence/src/agents/critic.ts:83`, another multi-step loop.
- Strategic critic: `packages/intelligence/src/agents/strategic-critic.ts:73`, another premium pass.
- Polish: `packages/workflows/src/v2-orchestration.ts:2014`, another author-style pass.

This is inconsistent with the business target of dramatically faster and cheaper runs.

### 6. Cost controls exist but are not active

- `packages/intelligence/src/agent-utils.ts` exports `costBudgetExceeded(...)`.
- The agents import it, but still stop only on `stepCountIs(...)`.
- `packages/workflows/src/observability.ts:42` hardcodes a default budget of `$5`, already far above the desired direction.

So the system observes cost, but does not enforce cost.

### 7. Rework still happens too late and too expensively

- Unused-source failure is checked only near export in `packages/workflows/src/v2-orchestration.ts:3142` and `:3180`.
- Child functions use `retries: 2` on expensive steps even for likely-permanent failures in `packages/workflows/src/v2-orchestration.ts:2902`, `:2981`, and `:3112`.
- The active v2 critique path can hard-fail decks with major issues rather than cheaply repairing them.

This wastes most of the run before discovering failure conditions that should have been handled much earlier.

### 8. Caching and memoization are weak where they matter most

- Sheet rows are repeatedly resolved and loaded via `packages/intelligence/src/tools/data-exploration.ts:645`.
- The v2 orchestration path re-downloads and re-decompresses blobs in `packages/workflows/src/v2-orchestration.ts:1583`.
- Evidence lookup is N+1 in `packages/intelligence/src/tools/authoring.ts:518` and `packages/intelligence/src/tools/critique.ts:134`.

Current caching is not organized around the expensive repeated units of work: normalized sheets, evidence refs, claim checks, section manifests, and render previews.

### 9. Beauty is limited by the rendering stack

The repo has a promising v2 renderer, but the product is not consistently running through a premium visual system:

- The legacy path still renders through the older PPTX path in `packages/workflows/src/index.ts:665`.
- The old PPTX renderer can mis-map editable chart families into the wrong semantics in `packages/render-pptx/src/index.ts:517`, `:552`, and `:588`.
- Template preservation is lossy and can silently fall back to a generic deck in `packages/render-pptx/src/index.ts:865`, `:890`, `:972`, `:988`, and `:996`.
- The PDF renderer is still a generic HTML card/grid system in `packages/render-pdf/src/index.ts:45` and `:123`, with a low-fidelity fallback at `:279`, `:500`, and `:516`.

This is not yet compatible with a design-agency standard.

### 10. Compatibility is only partially productized

The good news:

- `packages/render-pptx/src/render-v2.ts:50` explicitly supports `"powerpoint-native"` and `"universal-compatible"`.
- `packages/render-pptx/src/shape-charts.ts:1` and `packages/render-pptx/src/render-v2.ts:1377` show real cross-suite strategy.

The problem:

- V2 is still largely greenfield/house-style.
- It only uses brand tokens, not robust template geometry.
- It hardcodes 16:9 and safer font defaults like Arial in `packages/render-pptx/src/render-v2.ts:120` and `packages/scene-graph/src/layout-regions.ts:6`.
- QA only checks basic artifact sanity, not whether the deck opens cleanly in PowerPoint, Google Slides, and Keynote.

Compatibility is a promising renderer feature, not yet a full product contract.

## Top blockers to 3x10/10

### Intelligence blockers

1. Retail/client-specific logic is still inside shared intelligence code.
2. Analysis mode is not persisted as a first-class inferred object.
3. Source convergence and contradiction are not first-class evidence states.
4. Weak evidence can still produce medium-confidence output.
5. Methodology/definitions/clarified brief context is collected but not strongly enforced downstream.
6. Single-slide and short-form modes are not honestly supported by validation and authoring constraints.

### Beauty blockers

1. Too much of the visual stack still depends on heuristic template interpretation.
2. The premium path is not a locked Basquio archetype system yet.
3. PDF rendering is not scene-graph-faithful enough.
4. Visual QA is mostly metadata QA, not artifact QA.
5. The active product path still carries older renderer behavior.

### Compatibility blockers

1. Only v2 has a real compatibility strategy.
2. Template-preserving PowerPoint can silently degrade.
3. Charts can export with incorrect editable semantics in the legacy path.
4. There is no formal suite-specific QA gate for PowerPoint, Google Slides, and Keynote.

## Top blockers to sub-$1 / fast analysis

1. Premium models are used by default in too many stages.
2. Tool-loop budgets are based on step count, not dollar cost.
3. Dual critique plus polish is overkill for the default path.
4. Expensive failures are discovered late.
5. Repeated sheet/evidence lookups are not memoized.
6. Retries treat permanent failures like transient failures.
7. Orchestration still supports two architectural worlds.
8. Rendering and critique are not localized to changed sections.

The practical implication is simple: Basquio is still paying frontier-model prices for workflow uncertainty and architectural duplication.

## Recommended target architecture

### 1. One runtime, four explicit product modes

Replace fuzzy behavior with explicit run modes:

- `fast-house`
  - Locked Basquio archetypes
  - Universal-compatible charts and fonts
  - Strict cost ceiling
  - Target: `$0.40-$1.00`, `3-7 min`
- `premium-house`
  - Same archetypes, stronger critique and visual QA
  - One selective frontier escalation allowed
  - Target: `$1.00-$3.00`, `5-10 min`
- `powerpoint-template`
  - Premium PowerPoint editing fidelity
  - Template geometry honored only if template passes compatibility checks
  - Target: `$2-$6+`, `8-15 min`
- `universal-compatible`
  - Shape charts, safe fonts, explicit Google Slides/Keynote contract
  - Prioritize openability over edit richness

This is the key product simplification. Do not promise one magical mode that is simultaneously cheapest, most beautiful, most editable, and universally compatible.

### 2. Canonical analysis contract

Create a persisted `RunIntent` object immediately after intake:

- `analysis_mode`
- `deck_depth`
- `audience`
- `decision_type`
- `output_mode`
- `required_source_coverage`
- `confidence_policy`
- `allowed_cost_band`
- `allowed_latency_band`

This object should be inferred once from brief plus evidence summary, then used by every downstream stage.

### 3. Canonical evidence graph

Normalize all sources into one evidence graph:

- Canonical tables
- Canonical text chunks
- Canonical image/OCR extracts
- Canonical slide/page objects
- Canonical facts/claims/metrics

Every claim should carry:

- `support_level`: `corroborated | single_source | reconstructed | conflicted | insufficient`
- `source_classes`: `raw_tabular | pptx_table | pdf_table | OCR | prose`
- `derivation_lineage`
- `confidence`
- `coverage_status`

This is how Basquio reaches "same facts across formats should converge."

### 4. Deterministic-first intelligence

Use AI for planning and synthesis, not arithmetic or blind exploration:

- AI stage 1: clarify brief and infer run intent
- Deterministic stage 2: normalize all evidence, build joins, derive metric candidates, compute coverage gaps
- AI stage 3: choose which candidate metrics and claim families matter
- Deterministic stage 4: compute metrics and claim tables
- AI stage 5: synthesize recommendations and storyline from deterministic outputs

The current system lets expensive agents discover too much that the runtime could know deterministically.

### 5. Section-local authoring

Generate deck sections independently from a bounded section contract:

- section brief
- allowed evidence IDs
- approved metrics/claims
- layout archetype options
- chart/table components available

Then only rerun changed sections, not the entire deck.

### 6. Critique as a funnel, not a gauntlet

Default critique stack:

1. Deterministic coverage/consistency/number checks
2. Cheap model-based brief alignment and narrative coherence check
3. Visual QA on actual thumbnails
4. Escalate to frontier critique only if score is below threshold or run mode allows it

Do not run premium critique by default on every deck.

### 7. House-style beauty system

For 10/10 beauty, move away from open-ended template interpretation and toward:

- 8-12 locked slide archetypes
- tight spacing/typography/chart/table rules
- brand tokens for identity only
- scene-graph-native rendering
- actual preview-based scoring

This is the only credible way to make the output consistently expensive-looking.

### 8. Compatibility as a hard export contract

Make export mode explicit:

- `powerpoint-native`: editable Office-first output, richer object semantics, best for Microsoft users
- `universal-compatible`: safe fonts, shape-built charts, safer object subset, best for Google Slides/Keynote

Then add real suite QA:

- openability test
- font substitution detection
- chart/object integrity checks
- screenshot diff against render preview

## Specific implementation plan

### Fix now: next 2-4 weeks

1. Delete retail logic from shared intelligence.
   - Remove `isRetailMarketDataset(...)` routing from core fallback planning.
   - Remove retail-specific validation/story/insight assumptions from shared paths.
   - If retail deserves special handling, reintroduce it as an explicit mode/plugin outside the core engine.

2. Consolidate onto v2 orchestration.
   - Stop investing in the older pipeline except for migration safety.
   - Remove the legacy `/api/generate` path once the v2 contract fully covers it.

3. Downshift the default model stack.
   - Use mini/flash-class models for routing, brief clarification, metric-family selection, lint, and basic critique.
   - Reserve frontier reasoning for recommendation synthesis and only when evidence complexity is high.
   - Remove `claude-opus-4-6` as the default author model.

4. Turn on hard dollar budgets.
   - Use `costBudgetExceeded(...)` as an actual stop condition.
   - Create per-mode ceilings, for example:
     - `fast-house`: `$0.75`
     - `premium-house`: `$2.50`
     - `powerpoint-template`: `$5.00`

5. Restore cheap targeted revise.
   - Re-enable section-local repair.
   - Delete dead or disabled revise branches.
   - Never force a full rerun for isolated critique failures.

6. Move source-coverage checks earlier.
   - Detect uncovered uploaded files immediately after normalization and planning.
   - Fail fast or explicitly mark a file as non-material before authoring starts.

7. Memoize normalized data.
   - Cache decompressed sheet rows by `run_id + blob_checksum + sheet_key`.
   - Cache evidence lookup sets in memory per run.
   - Batch notebook/evidence fetches instead of N+1 REST calls.

8. Simplify critique.
   - Default to one cheap narrative/brief critique plus deterministic checks.
   - Run strategic premium critique only on escalation or premium mode.

9. Lock the beauty system for default runs.
   - Default to Basquio house layouts and v2 renderer.
   - Treat template geometry preservation as a separate mode, not the default.

### Medium-term: next 4-8 weeks

1. Build the evidence graph and convergence states.
2. Persist `RunIntent` as the canonical mode contract.
3. Replace PDF HTML composition with scene-graph-faithful PDF output or PPTX-derived rendering.
4. Add rendered-thumbnail QA and suite-openability QA.
5. Add section-level cache invalidation and partial rerender.
6. Add template qualification scoring so only high-confidence templates can use the template-preserving mode.

### Optional / later

1. Vertical plugins for retail, investor updates, board summaries, etc.
2. Retrieval over prior successful decks for style/reference reuse.
3. Premium multimodal escalation for especially ambiguous non-tabular evidence.
4. Offline batch/flex evaluation harnesses for nightly quality tuning.

## Cost/latency optimization plan

The current pricing environment strongly supports a cheaper routing stack if Basquio is disciplined about when it uses frontier reasoning:

- OpenAI pricing page as of 2026-03-19 shows `gpt-5.4` at `$2.50 / 1M input` and `$15.00 / 1M output`, `gpt-5.4 mini` at `$0.75 / 1M input` and `$4.50 / 1M output`, and `gpt-5.4 nano` at `$0.20 / 1M input` and `$1.25 / 1M output`. Source: <https://openai.com/api/pricing/>
- OpenAI prompt caching applies automatically for prompts `1024` tokens or longer and works best when static prefixes are placed first. Source: <https://developers.openai.com/api/docs/guides/prompt-caching>
- OpenAI Batch API gives `50%` lower costs for asynchronous jobs. Source: <https://developers.openai.com/api/docs/guides/batch>
- OpenAI Flex processing uses Batch-rate pricing for slower asynchronous work. Source: <https://developers.openai.com/api/docs/guides/flex-processing>
- Anthropic pricing as of 2026-03-19 still makes Opus materially more expensive than Sonnet/Haiku, and tool use adds extra system-prompt tokens. Anthropic prompt caching reads are `0.1x` base input price and Batch retains a `50%` discount. Source: <https://platform.claude.com/docs/en/about-claude/pricing>
- Gemini pricing as of 2026-03-19 shows very cheap Flash-Lite bands, including `$0.10 / 1M input` and `$0.40 / 1M output` standard, with lower batch rates. Source: <https://ai.google.dev/gemini-api/docs/pricing>

### Recommended routing

- `nano / flash-lite / haiku-class`
  - file classification
  - brief lint
  - source coverage classification
  - low-risk extract/label tasks
  - simple narrative lint
- `mini / flash-class`
  - analysis-mode inference
  - metric-family selection
  - claim grouping
  - section brief generation
  - first-pass critique
- `frontier`
  - final recommendation synthesis
  - executive summary wording
  - only-on-escalation critique for ambiguous, high-stakes decks

### Prompt/token tactics

1. Put static house prompts, schema guidance, and rubric text in stable prefixes to maximize prompt caching.
2. Split long tool loops into smaller bounded request families with shared cached prefixes.
3. Stop sending full evidence manifests to every stage; send section-local approved evidence.
4. Store normalized evidence summaries once and reference them by ID.
5. Batch offline scoring/evaluation jobs instead of synchronous calls.

### Deterministic tactics

1. Precompute joins and derived metric candidates once.
2. Precompute chart-ready series tables once.
3. Persist rendered thumbnails and scene graph once per section.
4. Reuse source-coverage and evidence-validation results across authoring and critique.

### Expected impact

These are directional estimates from code inspection plus current public pricing, not measured production benchmarks.

- Remove default Opus authoring plus dual premium critique:
  - expected cost reduction: `50-80%`
  - expected latency reduction: `30-60%`
- Add row/evidence memoization and batched lookups:
  - expected latency reduction: `15-30%`
  - expected reliability gain: fewer timeouts and fewer duplicate fetch failures
- Fail fast on source coverage and permanent validation errors:
  - expected cost reduction on bad runs: `30-70%`
  - expected latency reduction on bad runs: `40-80%`
- Move to section-local revise:
  - expected rerun cost reduction after critique: `50-90%`
  - expected rerun latency reduction: `50-90%`

My pragmatic forecast:

- With the "fix now" changes, Basquio should be able to move from roughly `30 min / $10-20` toward roughly `6-10 min / $1.5-4` for many runs.
- With the medium-term architecture in place, standard `fast-house` runs can plausibly reach `3-7 min / $0.40-1.00`.
- Premium template-preserving runs will remain above `$1` unless Basquio accepts lower fidelity or lower reasoning depth.

## What to stop doing

1. Stop keeping retail heuristics inside shared intelligence code.
2. Stop using premium models by default for authoring and critique.
3. Stop running multiple high-context critique/polish passes on every run.
4. Stop discovering source coverage failures at export time.
5. Stop treating template-preserving fidelity as the default product path.
6. Stop accepting "evidence ref exists" as equivalent to "claim is verified."
7. Stop retrying expensive child functions on permanent failures.
8. Stop paying repeated data-loading and N+1 evidence lookup costs.
9. Stop shipping artifact QA that only checks bytes, counts, and ZIP headers.
10. Stop maintaining two architectural truths in parallel longer than necessary.

## Definition of done

Basquio is at the desired state when all of the following are true:

1. The core engine contains no vertical-specific logic.
2. Every run persists a canonical `RunIntent` inferred from brief plus evidence.
3. Every claim carries an explicit convergence/support state.
4. Weak or conflicting evidence visibly downgrades output and can block recommendations.
5. The default product path uses locked Basquio archetypes and the v2 renderer.
6. Export mode is explicit and tested as either `powerpoint-native` or `universal-compatible`.
7. The system can repair isolated section failures without rerunning the whole deck.
8. Cost ceilings are enforced, not just logged.
9. Source coverage is decided before authoring.
10. Render QA includes actual thumbnails and suite-openability checks.
11. Standard house-style runs land near the target operating band of a few minutes and around `$1` or below.
12. Premium template-preserving runs have an honest, explicit higher-cost product contract.

## Bottom line

The repo does not need a more complicated agent system. It needs a stricter product contract, a smaller and better-routed model budget, and a harder separation between house-style quality and template-preserving compatibility. If Basquio does that, it can become both much better and much cheaper. If it keeps layering premium loops and heuristic template behavior on top of the current split architecture, it will stay expensive, slow, and inconsistent.
