# Quality-First Architecture Spec
## "Ship 10/10, Don't Lint Trash"

**Date:** 2026-04-17
**Author:** Claude (deep SOTA research) — for another agent to implement
**Trigger:** Production 70-slide Opus 4.7 run `d580a4df` shipped with:
- 133 lint issues flagged as "advisory" (not blocking)
- 18 MECE pair violations detected but ignored at publish
- 45/70 titles without numbers
- 8/14 required drill-down dimensions covered
- `finalContract` flagged `"70 slides (max 30)"` (stale validator)

**Status quo problem:** The current pipeline ships a lint-failed deck because lint is advisory. Revise runs 1 iteration and stops. Publish gate only blocks on structural corruption. Quality is an afterthought, not a precondition.

**Core question (Marco's):** Why do we not force quality 10/10 from the beginning, with lint as the worst-case safety net?

**Answer from SOTA:** Because the pipeline is built on the "generate → correct" pattern (evaluator reflect-refine loop, AWS 2026). State of the art says the opposite: **constrain correctness at generation time**, then verify at acceptance. Generating trash and correcting is provably less efficient than constraining upfront.

---

## 0. Architectural Diagnosis

### Current Basquio Pipeline (post-hoc correction)

```
[Analyze] → [Author entire 70-slide deck monolithically]
                                 ↓
                        [Lint + Contract (advisory)]
                                 ↓
                        [Revise (1 iteration, not lint-driven)]
                                 ↓
                        [Visual QA (reused from author)]
                                 ↓
                        [PUBLISH unless structural corruption]
                                 ↓
                        Lint issues ship to user as "advisories"
```

**The structural flaws:**

1. **Lint is cosmetic** — violations surface in telemetry but don't block shipping
2. **Revise fires once regardless of issue count** — 133 issues and 1 issue trigger the same 1 revise iteration
3. **No upfront constraints** — Claude is told the rules in prose, but nothing enforces them during generation
4. **Monolithic output** — the entire 70-slide deck is rendered in one author turn, so there's no per-slide gate
5. **Publish gate is too narrow** — only blocks on "structural corruption" (zip signature, slide count > 0), accepts any non-corrupt output regardless of quality

### State of the Art (April 2026) — Quality-First Patterns

Research synthesized from:
- [AWS Prescriptive Guidance — Evaluator reflect-refine loop patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/evaluator-reflect-refine-loop-patterns.html) (Apr 2026)
- [Scaling LLM Test-Time Compute Optimally](https://arxiv.org/abs/2408.03314) — verifier-guided sampling
- [Constrained Decoding: Grammar-Guided Generation](https://mbrenndoerfer.com/writing/constrained-decoding-structured-llm-output) — production-ready since early 2026
- [Anthropic Adaptive Thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking) — serial test-time compute at generation
- [Anthropic Demystifying Evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — rubric-based scoring
- [Anthropic Property-Based Testing with Claude](https://red.anthropic.com/2026/property-based-testing/) (2026)
- [LLMOps Architecture 2026](https://calmops.com/architecture/llmops-architecture-managing-llm-production-2026/) — CI/CD eval gates

**Six quality-at-generation patterns the SOTA uses:**

| Pattern | What it does | Where it fires | Basquio today |
|---|---|---|---|
| **1. Constrained decoding** | Grammar/schema forces valid tokens at decode time | Inside inference | ❌ Not used |
| **2. Rubric in system prompt** | Quality criteria injected as explicit scoring rubric | System prompt | ⚠️ Implicit (rules, no rubric) |
| **3. Inner critic (same turn)** | Model judges its own draft before committing, using thinking blocks | Inside author turn | ❌ Not used |
| **4. Verifier-guided sampling** | Generate N candidates, pick best by verifier score | Per output unit | ❌ Not used |
| **5. Pre-generation plan validation** | Validate plan against rules BEFORE generation begins | Plan phase | ⚠️ Advisory only (`understandPlanLint`) |
| **6. Blocking acceptance gates** | Hard thresholds that reject and retry or fail | Publish decision | ❌ Advisory only |

**Basquio uses 0.5 of 6.** That's the gap.

### The Inversion

Current mental model: **"Generate → check quality → ship if structurally sound"**

Quality-first model: **"Constrain quality upfront → generate with inner critic → accept only if quality proven → lint is backstop for edge cases"**

The difference is not incremental. It's architectural.

---

## 1. The Spec — Three Tiers of Quality Enforcement

### Tier 1: Constrain Quality at Generation Time

This is the most valuable tier and the least exercised today. State of the art: quality is shaped during decoding, not after.

#### 1.1 The Quality Rubric as First-Class Prompt Input

Today: rules are scattered across system prompt, author message, and per-slide constraints as prose.

Move to: a single, explicit **machine-readable rubric** embedded in the author prompt. Structure:

```
QUALITY RUBRIC (every slide must pass ALL; self-score before committing):

TITLE (weight 30):
  [✓/✗] Contains ≥1 digit
  [✓/✗] Is a full sentence (≥5 words, has verb)
  [✓/✗] States an insight, not a topic label (TOPIC_LABELS regex must not match)
  [✓/✗] Not ALL CAPS unless section divider
  [✓/✗] Language matches brief language

BODY (weight 20):
  [✓/✗] Word count within archetype limit
  [✓/✗] Zero AI slop patterns
  [✓/✗] Zero client-aggressive framing
  [✓/✗] Zero competitor tool names (Kantar/Circana/IRI) when data is NielsenIQ
  [✓/✗] At least one number
  [✓/✗] Active voice

EVIDENCE (weight 20):
  [✓/✗] Chart type matches analytical question
  [✓/✗] Data table co-located (non-exempt archetypes)
  [✓/✗] Source line visible

STRUCTURE (weight 15):
  [✓/✗] Archetype is from approved catalog
  [✓/✗] Different from ≥5 other layout types across deck
  [✓/✗] Not an MECE duplicate of any other planned slide

RECOMMENDATIONS (weight 15, if applicable):
  [✓/✗] Title states opportunity size (€ or %)
  [✓/✗] Cites evidence slide with "cfr. slide N"
  [✓/✗] Uses FMCG lever from playbook

PASS THRESHOLD: 95/100 per slide. Below → revise slide in-loop before moving on.
```

Claude is instructed to internally score every slide against this rubric and only commit slides scoring ≥95. This is **generation-time self-critique**, not post-hoc linting.

Anthropic research (Demystifying Evals, 2026): "Creating clear, structured rubrics to grade each dimension of a task, and then grading each dimension with an isolated LLM-as-judge rather than using one to grade all dimensions can help avoid hallucinations."

#### 1.2 Use Adaptive Thinking for Per-Slide Self-Critique

Claude Opus 4.7 supports adaptive thinking. Current author message doesn't force the model to use thinking for self-evaluation.

**Spec:** inside the code-execution turn, when the model is about to write a slide, it should first emit a thinking block that runs through the rubric for THAT slide, spots failures, and corrects before the slide is committed to the PPTX. Example instruction:

> Before adding a slide with `slide.addText(...)`, emit a thinking block that:
> 1. Scores the planned title against the title rubric (5 checks).
> 2. Scores the planned body against the body rubric (6 checks).
> 3. Scores evidence/structure.
> 4. If any check fails, rewrite the slide content in the thinking block until all pass.
> 5. Only then commit the slide to the PPTX.

The model pays for the thinking tokens but produces fewer post-hoc lint failures, reducing revise iterations. Net cost: roughly equal or less than the current 2-pass architecture.

#### 1.3 Constrained Decoding for Hard Invariants

Some rules are absolute and should be enforced at decode time, not asked-for in prose.

**Candidates for constrained decoding (grammar-guided generation):**

| Invariant | Grammar constraint |
|---|---|
| Non-cover slide titles must contain a digit | Title regex: `^(?=.*\d).{5,90}$` |
| Recommendation titles must contain € or % | Regex: `(€|%)` present in title |
| Section labels cannot be > 40 chars | Max length on uppercase eyebrow text |
| Bullet prefixes cannot be gerunds | Negative lookahead on `(Driving|Optimizing|Leveraging...)` |
| Title cannot be ALL CAPS (non-divider) | Require at least 2 lowercase letters |

Implementation options in descending order of rigor:
- **XGrammar / llguidance / Outlines** — compile grammar once, apply during decode (near-zero overhead per 2026 benchmarks). Anthropic GA since January 2026.
- **Regex constraints via tool-use JSON schema** — when outputting `slidePlan[]`, every title field validated against regex at generation time.
- **Post-generation validate + retry** — cheapest but wasteful.

Tier-1 cost: ~equal to current pipeline. Tier-1 benefit: first-pass lint pass rate jumps from "9% passing" (current: 7 slides of 70 clean) to "90%+".

#### 1.4 Verifier-Guided Sampling for Critical Slides

The executive summary, recommendation cards, and chapter dividers carry disproportionate weight. SOTA test-time compute research (Scaling LLM Test-Time Compute, arxiv 2408.03314) shows 4× efficiency gain from multi-sample + verify over single-pass.

**Spec:** for these high-value slides only, generate N=3 candidates, score against rubric, pick the highest. This doesn't 3× cost because:
- Only 5-8 slides in a 70-deck deserve this treatment
- Scoring is local (per slide, not whole deck)
- Verification can run with Haiku as a cheap judge

---

### Tier 2: Inner-Loop Critic (Quality During Generation, Before Publish)

This tier catches what the generator missed.

#### 2.1 Per-Slide Acceptance Gate (streaming authoring)

Today: the entire deck is authored in one turn, then lint runs against the completed PPTX. That's the wrong order.

Move to: author-gate-commit, slide by slide:

```
for slide in plan:
    draft = author_slide(slide, rubric=RUBRIC)
    score = run_inline_linter(draft)
    if score < 95:
        draft = author_slide(slide, rubric=RUBRIC, feedback=score.issues)
        score = run_inline_linter(draft)
    if score < 95 and retries_left > 0:
        draft = author_slide(slide, rubric=RUBRIC, feedback=score.issues, retries-=1)
    commit(draft) if score >= 80 else escalate_to_revise_queue
```

This is the same loop the pipeline already has, but at slide granularity instead of deck granularity. Failures at slide N don't poison slide N+1, and the revise budget is spent where it's needed.

Tradeoff: more code-execution rounds → slower → more expensive if naive. Mitigation:
- Haiku-as-judge for the inline linter (not Opus)
- Deterministic lint rules run in Python without an LLM call (cheaper by ~100×)
- Batch commit every 5 slides with one critique pass (amortize)

#### 2.2 Pre-Author Plan Validation (BLOCKING, not advisory)

The new `understandPlanLint` from yesterday's PR runs but its failures are currently advisory. They should be blocking for long decks.

**Spec:**

```
if target_slide_count >= 40:
    plan_lint = run_slide_plan_linter(plan)
    if plan_lint.mece_violations > 0 or plan_lint.dimensions_covered < required:
        raise PlanValidationError(
            f"Plan fails MECE: {plan_lint.mece_violations} dup pairs, "
            f"{plan_lint.dimensions_covered}/{required} dimensions"
        )
        # → Router instructs Claude to REPLAN before authoring
        # → Max 2 replan attempts before hard fail
```

Today the validator logs `mecePairViolations: 18, drillDownDimensions: 8, minRequiredDimensions: 14` and proceeds to author. With blocking, the same run would have **replanned before authoring**, producing a plan that actually meets MECE coverage.

This converts an advisory check into a hard invariant. Nothing downstream has to change — the improvement compounds at the plan stage.

#### 2.3 Escalating Revise Budget on Lint Failure

Current: revise runs 1 iteration regardless of lint count. If 1 lint issue found → 1 revise. If 133 lint issues found → still 1 revise.

Spec: revise iterations scale with issue count and severity:

```
revise_iterations_needed = ceil(
    (critical_count * 3 + major_count * 1 + minor_count * 0.2)
    / revise_issue_capacity
)
max_revise_iterations = min(revise_iterations_needed, 3 for <40 slides, 5 for ≥40 slides)
```

Per CLAUDE.md budget evidence, revise rarely exceeds $4-6 per iteration, well within cross-attempt budget of $40-48 for 40+ slide Opus runs. The budget is already there; it's just not being spent.

#### 2.4 Targeted Revise, Not Global Re-Author

Today's revise appears to re-generate large portions of the deck. It should target only the failing slides.

Spec (reuses the existing revise architecture, just bounds scope):

```
revise_message = {
  "failing_slides": [4, 5, 16, 17, ...],  # from lint + MECE pair violations
  "issues_per_slide": { 4: [...], 5: [...] },
  "do_not_touch": [everything_else],
  "instruction": "Fix the failing slides to reach rubric score ≥95. Do not modify others."
}
```

Per CLAUDE.md hard-won rules: "Revise should be slide-specific: list which slides to fix, forbid touching the rest." That rule exists but the telemetry shows it's not being applied as tightly as it could be.

---

### Tier 3: Publish Gates That Actually Gate

This tier decides whether a deck is allowed to ship.

#### 3.1 The "Quality Passport" Acceptance Model

Per AWS Evaluator reflect-refine pattern (2026): "The loop repeats until the result meets a set of criteria, is approved, or reaches a retry limit."

Current publish gate per CLAUDE.md:
> "ONLY structural corruption blocks publish: `pptx_present`, `pdf_present`, `pptx_zip_signature`, `pdf_header_signature`, `slide_count_positive`, `pptx_zip_parse_failed`, `pdf_parseable`. Everything else (lint, visual QA score, contract violations) is ADVISORY, not blocking. A run that spent $1+ MUST ship artifacts."

This rule exists because "export failed after 25 minutes is NEVER acceptable to a user." That intent is correct for catastrophic failures. But it's been extended to mean "ship whatever survived the pipeline, regardless of quality." **These are different guarantees.**

**Proposed three-tier publish decision:**

| Output class | Quality passport | User sees |
|---|---|---|
| `gold` | Lint pass + contract pass + MECE pass + coverage met | Delivered normally |
| `silver` | One or two majors present but not blocking, all criticals clear | Delivered with "minor issues flagged" banner |
| `bronze` | Multiple majors or one critical | Held in `needs_analyst_review` state; email says "Analyst is reviewing, expect within 30 min"; operator reviews before release |
| `failed` | Contract violations (max slide count exceeded, chart limit, etc.) + no salvageable artifacts | Failure email with specific fixable issues |

This preserves the "never silent-fail" principle while refusing to deliver trash as gold. Bronze runs don't ship until an operator confirms. `d580a4df` would have been bronze with 133 lint issues and 18 MECE violations.

#### 3.2 Update the Structural Publish Rules

The specific list of "structural corruption" blockers per CLAUDE.md should expand to include the intent violations that actually make a deck unusable:

```
Existing (keep):
  pptx_present, pdf_present, pptx_zip_signature, pdf_header_signature,
  slide_count_positive, pptx_zip_parse_failed, pdf_parseable

Add (critical severity):
  no_duplicate_near_identical_slides  (MECE pairs with similarity > 0.9)
  no_competitor_tool_references       (when data is NielsenIQ)
  no_fabricated_financial_projections (recommendations with unsupported numbers)
  title_number_coverage_minimum_80pct (at least 80% of non-divider titles have numbers)

Add (major but blocking for ≥40 slide decks):
  drilldown_dimension_coverage_minimum
  chapter_decomposition_depth_minimum_L3
```

#### 3.3 Stale Validator Fix (Immediate)

The `finalContract` flagged `"70 slides (max 30)"` in the production run. The DB migration raised the ceiling to 100 but the contract validator wasn't updated. Same for chart count.

**This is a non-obvious regression:** the rendering contract is internal but it's the gating mechanism. An internal-but-wrong threshold defeats the entire quality-first architecture regardless of everything else.

Action: audit every hardcoded limit (slides, charts, bullets, words per slide) against the DB migration ceilings. Replace with centralized constants from `apps/web/src/lib/credits.ts` or equivalent.

---

## 2. Implementation Path (Order of Operations)

Ship quality-first in four waves, each independently valuable:

### Wave 1 — Immediate (hours): Fix the Stale Gate

- **Audit all rendering/contract thresholds** against the DB migration values. Centralize constants.
- **Remove `"70 slides (max 30)"` false-positive** — this is a one-line fix today and blocks nothing else.
- **Convert 4-5 existing lint rules from advisory → blocking**: competitor tool references, fabricated financials, title-number coverage, MECE duplicates. No new code, just severity changes.

**Effect:** Today's existing telemetry becomes decisions.

### Wave 2 — Short-term (days): Blocking Plan Validation

- **Hook `understandPlanLint` into plan acceptance**: if MECE/coverage fails at ≥40 slides, trigger replan before authoring.
- **Add replan budget** (max 2 replans, reuses existing cross-attempt budget envelope).
- **Add Quality Passport classification** at publish decision — pipe it into the delivery status (`reviewed` vs `needs_analyst_review`).

**Effect:** Bad plans don't reach the author stage. Bad decks don't silently reach the user.

### Wave 3 — Medium-term (week): Rubric-Driven Generation

- **Embed the quality rubric** as an explicit section in the author prompt.
- **Instruct Claude to self-score** each slide using thinking blocks before committing to PPTX.
- **Per-slide Haiku-judge loop** for high-value slides (exec summary, recommendations).

**Effect:** First-pass lint compliance jumps from ~10% to ~80-90%.

### Wave 4 — Long-term (weeks): Constrained Decoding + Verifier Sampling

- **Integrate constrained decoding** for hard invariants where Anthropic or a proxy supports it.
- **Verifier-guided sampling** (N=3 candidates) for critical slides.
- **Streaming per-slide authoring** so revise can target individual slides rather than the whole deck.

**Effect:** Architectural — quality becomes the default, not the goal.

---

## 3. What SOTA Says About Cost

Concern: "quality enforcement costs more". Research says the opposite for production systems.

| Pattern | Cost impact vs today |
|---|---|
| Constrained decoding | Same or **cheaper** (near-zero overhead, avoids retry loops) |
| Rubric in system prompt | ~2-5% token overhead, ~20-30% reduction in revise cost |
| Adaptive thinking for self-critique | +thinking tokens, but eliminates 1-2 revise iterations |
| Verifier-guided sampling (critical slides only) | +20-30% cost on the 5-8 affected slides; payoff is published quality |
| Blocking publish gates | **Cheaper** — bad runs fail fast instead of spending full budget then shipping trash |
| Targeted revise | **Cheaper** — fixes only failing slides vs re-authoring globally |

The `d580a4df` run cost $20.75 and delivered lint-failed output. A quality-first architecture would target $22-25 (slightly more due to self-critique thinking) but ship `gold` or fail visibly — not ship `bronze` labeled as `gold`.

---

## 4. What NOT to Do

- ❌ **Don't replace "ship trash then lint" with "never ship anything"** — hard failures with no artifact are worse than bronze delivery
- ❌ **Don't add a fifth revise iteration as the answer** — more retries on a broken architecture still produces broken outputs; the architecture has to change
- ❌ **Don't use a second full LLM call as the "critic"** — it's expensive and not much better than the generator. Use deterministic lint + Haiku judge + rubric-scored self-critique
- ❌ **Don't make the rubric 200 items long** — it needs to be scannable by Claude in a thinking block. Keep to the 20-25 most consequential checks
- ❌ **Don't gate publish on visual QA score alone** — it's noisy. Use the composite Quality Passport
- ❌ **Don't break the "never silent-fail" principle** — bronze delivery with operator review is the escape valve for the edge cases

---

## 5. Validation Contract for This Architecture

A production 70-slide Opus 4.7 run after the quality-first upgrade must demonstrate:

| Metric | Today (d580a4df) | Target after architecture change |
|---|---|---|
| First-pass lint issues | 133 | ≤ 10 |
| MECE pair violations at publish | 18 | 0 critical, ≤2 minor |
| Drill-down dimensions covered | 8/14 | ≥10/14 at plan validation, ≥12/14 at publish |
| Title-number coverage | 25/70 (36%) | ≥56/70 (80%) |
| Contract violations shipped | 3 | 0 |
| Revise iterations when triggered | 1 | proportional to severity (2-5) |
| Publish class | `reviewed` with 133 advisories | `gold` OR `needs_analyst_review` — never `reviewed` with majors |
| Cost | $20.75 | $22-27 (small increase) |
| Time to user | 44 min | 40-50 min |

**Success criterion:** re-run Fra's Kellanova brief at 70 slides on the upgraded pipeline. Either the deck is `gold` quality with the rubric met, or it fails loudly with a specific fixable reason.

---

## 6. Handover Checklist for the Next Agent

Before implementing, next agent must:
- [ ] Read this spec end-to-end
- [ ] Read `docs/intelligence-upgrade-spec.md` (3-layer moat)
- [ ] Read `docs/template-fidelity-and-depth-spec.md` (yesterday's spec)
- [ ] Read CLAUDE.md — especially the publish-gate rules (they're wrong, but the REASON they exist is right)
- [ ] Decide: wave 1 and wave 2 can land in the same PR. Wave 3 and wave 4 are separate
- [ ] Fixtures BEFORE implementation — two comparison runs, one with stale gate, one with blocking gate, same brief

During implementation:
- [ ] CLAUDE.md: max 3 pipeline commits per day
- [ ] Each commit validated with 1 production run
- [ ] No "hardening" commits that introduce regressions
- [ ] Never break silent-fail principle — always deliver something, even bronze with operator review

Post-implementation validation:
- [ ] Re-run Fra's Kellanova brief (70 slides, Opus 4.7). Expected: `gold` OR explicit failure with fixable reason
- [ ] Verify first-pass lint issues drop to ≤10
- [ ] Verify MECE violations reach 0 critical
- [ ] Send new deck to Rossella / Stefania for blind comparison

---

## 7. Research Sources (SOTA 17.04.2026)

### Quality-at-Generation Patterns
- [AWS Prescriptive Guidance — Evaluator reflect-refine loop patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/evaluator-reflect-refine-loop-patterns.html) — April 2026
- [Scaling LLM Test-Time Compute Optimally](https://arxiv.org/abs/2408.03314) — 4× efficiency from verifier-guided sampling
- [VerifierQ: Enhancing LLM Test Time Compute with Q-Learning-based Verifiers](https://openreview.net/forum?id=OD9pwKQzXl) — 2025
- [Mechanisms for test-time compute](https://www.innovationendeavors.com/insights/mechanisms-for-test-time-compute)

### Constrained Decoding
- [Constrained Decoding: Grammar-Guided Generation for Structured LLM Output](https://mbrenndoerfer.com/writing/constrained-decoding-structured-llm-output)
- [LLM Structured Outputs: Schema Validation for Real Pipelines (2026)](https://collinwilkins.com/articles/structured-output)
- [llguidance — Super-fast Structured Outputs](https://github.com/guidance-ai/llguidance) — 2026 production-grade engine
- [Awesome-LLM-Constrained-Decoding](https://github.com/Saibo-creator/Awesome-LLM-Constrained-Decoding)

### Self-Refine / Inner Critic
- [Self-Reflection in LLM Agents: Effects on Problem-Solving Performance](https://arxiv.org/pdf/2405.06682)
- [Reflection Agents — LangChain blog](https://blog.langchain.com/reflection-agents/)
- [Decoding Agentic Workflows: Self-Refinement in LLMs](https://medium.com/@cadmos.ka/decoding-agentic-workflows-exploring-self-refinement-in-llms-405b7e8abdb3)
- [Automatically Correcting Large Language Models survey — TACL](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00660/120911/)

### Anthropic-Specific
- [Adaptive thinking — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Building with extended thinking — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — rubric pattern
- [Property-Based Testing with Claude](https://red.anthropic.com/2026/property-based-testing/) — 2026

### LLMOps / Quality Gates
- [LLMOps Architecture: Managing LLMs in Production 2026](https://calmops.com/architecture/llmops-architecture-managing-llm-production-2026/)
- [CI/CD Eval Gates for LLM Apps](https://www.maxpetrusenko.com/blog/ci-cd-eval-gates-for-llm-apps)
- [LLM/RAG Evaluation & Quality Gates Course 2026](https://nanoschool.in/course/llm-rag-evaluation-quality-gates/)
- [How to Validate Your LLM Pipeline & Strategy](https://medium.com/@puttt.spl/how-to-validate-your-llm-pipeline-strategy-89f3c037da1c)
