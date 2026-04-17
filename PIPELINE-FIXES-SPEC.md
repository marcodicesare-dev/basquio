# Pipeline Fixes Spec — Post-Audit 2026-04-02

Based on forensic audit of runs `401e2826` attempt 1 (Opus, $6.39) and attempt 2 (Sonnet, $5.50).

## Status

- [x] Fix A: Basquio branding via system prompt
- [x] Fix B: Brand colors in system prompt palette
- [x] Fix C: Cross-attempt budget guard ($15 total)
- [x] Fix D: Sonnet efficiency instructions + cost anomaly logging
- [x] Fix E: Footer/branding via system prompt
- [x] Fix F: Layout plan example for layout variety
- [x] Fix G: 300 DPI examples
- [ ] Production validation protocol rerun on the updated pipeline

---

## Critical Finding: render-v2.ts is DEAD CODE for default template

The `BASQUIO_MASTER` slide master (with footer, logo, slide numbers) defined in `packages/render-pptx/src/render-v2.ts` is **never used** for the default "basquio_standard" template path.

**Evidence:** Attempt 2 PPTX has:
- 1 slide master with NO footer text
- 0 mentions of "Basquio" or "Confidential" anywhere
- 0 logo images

**Root cause:** `renderPptxArtifact()` from render-v2.ts is only called at line 5320 of generate-deck.ts, inside the `buildExactTemplateSlidePlan` path — which only runs when a **client PPTX template** is uploaded. For the default path, Claude generates the entire PPTX in code execution via PptxGenJS skill. The system prompt does NOT instruct Claude to add:
- A `defineSlideMaster` with "Basquio | Confidential" footer
- A slide number on each slide
- A Basquio logo on the cover

**Impact:** EVERY single deck generated with the default template has ZERO Basquio branding. This has been true since the system was built. It was never caught because the render-v2.ts code looked complete.

**This means:** Fixes 1-2 from the Part 2/3 spec (brand colors in render-v2.ts, logo on cover master) would have been NO-OPS. The changes need to go in the **system prompt**, not in render-v2.ts.

---

## Fix A: Basquio branding via system prompt (CRITICAL)

### What to add to `packages/workflows/src/system-prompt.ts`

Add a concrete PptxGenJS example showing the complete master setup. This follows the proven quality lever: **few-shot examples, not rules**.

```typescript
// Add to DECK_EXAMPLES array:
{
  name: "perfect_slide_master_setup",
  code: `
// FIRST THING before any addSlide(): define masters
pptx.defineSlideMaster({
  title: "BASQUIO_COVER",
  background: { fill: "0A090D" },
  objects: [],
});

pptx.defineSlideMaster({
  title: "BASQUIO_MASTER",
  background: { fill: "13121A" },
  objects: [
    // Footer rule
    { rect: { x: 0.6, y: 7.1, w: 12.133, h: 0.007, fill: { color: "272630" } } },
    // Footer text
    {
      text: {
        text: "Basquio | Confidential",
        options: {
          x: 0.6, y: 7.15, w: 6, h: 0.25,
          fontSize: 8, fontFace: "Courier New", color: "6B7280",
        },
      },
    },
  ],
  slideNumber: {
    x: 12.0, y: 7.15, w: 0.733, h: 0.25,
    fontSize: 8, fontFace: "Courier New", color: "6B7280", align: "right",
  },
});

// Cover slide uses BASQUIO_COVER master
const coverSlide = pptx.addSlide({ masterName: "BASQUIO_COVER" });

// ALL other slides use BASQUIO_MASTER (gets footer + slide number automatically)
const slide2 = pptx.addSlide({ masterName: "BASQUIO_MASTER" });
`,
}
```

Also add an explicit instruction (kept SHORT, paired with the example above):

```
- Define BASQUIO_COVER and BASQUIO_MASTER slide masters BEFORE any addSlide() call.
- Cover slide uses BASQUIO_COVER. All other slides use BASQUIO_MASTER.
- BASQUIO_MASTER includes the Basquio logo as an IMAGE (not text) in the footer area, plus slide numbers.
- The logo must be added via addImage with a base64 PNG data URI — NOT as editable text.
- When a client template is present, omit the Basquio logo entirely.
```

### Why this works

Per CLAUDE.md: "Few-shot examples in the system prompt are the #1 quality lever." Claude sees the exact PptxGenJS code for master definition and replicates it. No rules needed beyond the pairing instruction.

### Files to change
- `packages/workflows/src/system-prompt.ts` — add example + instruction

---

## Fix B: Brand colors in system prompt palette (CRITICAL)

### Problem
The system prompt communicates colors to Claude via `resolvePromptPalette()`. If this function still returns old `#E8A84C` amber, Claude will use it in matplotlib charts even though render-v2.ts was updated.

### Files to check and fix
- `packages/workflows/src/system-prompt.ts` — `resolvePromptPalette()` and `buildDeckExamples()`
- Verify the prompt palette uses `#F0CC27` (brand amber) not `#E8A84C` (old)
- Verify the chart color sequence in the prompt starts with `F0CC27, 1A6AFF, 4CC9A0, ...`

Also verify: `code/design-tokens.ts` `BASQUIO_CHART_PALETTE` — this may be what the prompt palette reads from.

### The dark theme preamble in examples must use correct colors

Every matplotlib example in `DECK_EXAMPLES` that references colors must use:
```python
ACCENT = '#F0CC27'   # NOT #E8A84C
PALETTE = ['#F0CC27', '#1A6AFF', '#4CC9A0', '#9B7AE0', '#E8636F', '#5AC4D4', '#6B7280', '#7ABBE0']
```

---

## Fix C: Cost tracking — cumulative cross-attempt guard (HIGH)

### Problem
`estimatedCostUsd` on `deck_runs` accumulates all attempts ($6.39 + $5.50 = $11.89). But the hard cap guard in `assertDeckSpendWithinBudget` only checks per-attempt spend because `spentUsd` resets to 0 at line 565 of generate-deck.ts.

A user who manually retries can accumulate unlimited cost with no guard.

### Solution

Add a cross-attempt budget check at the START of `generateDeckRun()`:

```typescript
// At the start of generateDeckRun(), after resolving the run:
const priorAttemptsCost = await getPriorAttemptsCost(config, runId, attempt?.id);
const CROSS_ATTEMPT_BUDGET = 15.0; // Total budget across ALL attempts
if (priorAttemptsCost > CROSS_ATTEMPT_BUDGET) {
  throw new Error(
    `Run has already spent $${priorAttemptsCost.toFixed(2)} across prior attempts. ` +
    `Cross-attempt budget is $${CROSS_ATTEMPT_BUDGET.toFixed(2)}.`
  );
}
```

Where `getPriorAttemptsCost` queries `deck_run_attempts` for completed attempts and sums their `cost_telemetry.estimatedCostUsd`.

### Budget values

Per CLAUDE.md: "Budget caps have been the #1 source of 'revise never runs'. DO NOT lower them without production evidence."

- Per-attempt: keep at pre-flight $7.00, hard cap $10.00 (unchanged)
- Cross-attempt: $15.00 (allows 2 full Opus attempts or 3 Sonnet attempts)

### Files to change
- `packages/workflows/src/generate-deck.ts` — add cross-attempt check at function entry
- `packages/workflows/src/cost-guard.ts` — add `getPriorAttemptsCost()` helper

---

## Fix D: Sonnet verbosity costs more than Opus (MEDIUM)

### Problem
Sonnet generated 71K output tokens vs Opus's 50K for the same brief. This caused 7.9M cache_read (vs 3.4M) — 2.3x more. The author phase alone cost $4.01 on Sonnet vs $3.72 on Opus. Sonnet's price advantage is NEGATIVE for this workload.

### Root cause
Sonnet is more verbose in code execution. It prints more debug output, writes longer code blocks, and may do more exploration rounds before converging. Each extra round re-sends the ENTIRE conversation (cache_read grows quadratically per CLAUDE.md).

### Cost breakdown (Sonnet author)

| Component | Tokens | Cost | % of total |
|-----------|--------|------|------------|
| cache_read | 7,902,049 | $2.37 | 59% |
| output | 71,009 | $1.07 | 27% |
| cache_create | 147,538 | $0.55 | 14% |
| input | 7,050 | $0.02 | 0.5% |

59% of author cost is cache_read. This is the "UNCONTROLLABLE per-request" cost documented in CLAUDE.md.

### Solutions (ranked by feasibility)

**D1. Add "finish in one turn" instruction more aggressively for Sonnet**

Per CLAUDE.md: "'Finish in one turn' instructions reduce cost by eliminating continuations."

For Sonnet specifically, add to the system prompt:
```
- Complete ALL chart generation and PPTX writing in as few code execution rounds as possible.
- Avoid printing intermediate results or debug output.
- Generate all charts in a single script, not one chart per execution.
```

This won't eliminate the cache_read growth within a single API call (which is Anthropic's in-turn auto-caching), but it reduces the number of code execution rounds, which reduces context accumulation.

**D2. Track per-model cost baselines and alert on anomalies**

Add to the cost telemetry: `expectedCostRange` per model.
- Opus 15-slide: expected $5-7
- Sonnet 15-slide: expected $3-5
- Sonnet 10-slide: expected $2-4
- Haiku 10-slide: expected $0.80-1.50

If actual cost exceeds 1.5x the upper range, log a warning.

**D3. Accept that Sonnet is NOT cheaper for 15-slide decks**

This is a CLAUDE.md-documented reality: "59% of cost is cache_read_input_tokens from in-turn auto-caching during code execution. This is UNCONTROLLABLE per-request."

For 15-slide decks, Opus may actually be cheaper because it converges faster (fewer output tokens = fewer rounds = less cache_read). The model choice should be:
- 10-slide deck: Sonnet ($3-4) or Haiku ($0.80-1.50)
- 15-slide deck: Opus ($5-7) — fewer rounds, actually cheaper than Sonnet

### Files to change
- `packages/workflows/src/system-prompt.ts` — add efficiency instructions for Sonnet
- `packages/workflows/src/generate-deck.ts` — add cost anomaly logging

---

## Fix E: Footer/branding via system prompt (already covered in Fix A)

The footer is missing because Claude's code execution doesn't define the master. Fix A solves this.

---

## Fix F: Layout variety in system prompt (from Part 3, reconfirmed)

### Evidence from attempt 2
Attempt 2 lint passed with 0 deck-level issues (was 1 in attempt 1: ">50% two-column"). Layout variety improved naturally in the Sonnet run. But we should still add the example-based variety rule from Part 3 Fix 4 to make this consistent.

### What to add
A few-shot example showing a 15-slide layout plan:

```
<layout_plan_example>
15-slide deck layout plan:
  1. cover
  2. exec-summary (3-5 KPIs + SCQA body)
  3. title-chart (full-width channel growth)
  4. chart-split (market share chart + text)
  5. chart-split (brand portfolio chart + text)
  6. comparison (dual-panel distribution comparison)
  7. evidence-grid (metrics + chart)
  8. title-chart (full-width pricing analysis)
  9. chart-split (competitive landscape + text)
  10. evidence-grid (promo effectiveness metrics + chart)
  11. key-findings (3 key findings)
  12. title-chart (full-width growth bridge waterfall)
  13. recommendation-cards (3 priority actions)
  14. scenario-cards (bear/base/bull scenarios)
  15. summary (next steps)

Layout count: cover(1), exec-summary(1), title-chart(3), chart-split(3), comparison(1), evidence-grid(2), key-findings(1), recommendation-cards(1), scenario-cards(1), summary(1) = 10 types, no type >3.
</layout_plan_example>
```

---

## Fix G: Chart DPI (from Part 3 Fix 3, reconfirmed)

### Evidence from attempt 2
ALL chart images are now >= 1644px wide. The smallest is 1644x1071. This is MUCH better than attempt 1's 283px thumbnails.

However, the DPI in the few-shot examples is still 200. Changing to 300 would give sharper charts without any cost impact (code execution compute is free).

### What to change
In `DECK_EXAMPLES`, all `dpi=200` → `dpi=300`.

---

## Implementation plan (CLAUDE.md compliant)

### Commit discipline: max 3 pipeline commits per day

**Commit 1 (P0): Branding + colors in system prompt**
- Fix A: Add `perfect_slide_master_setup` example to DECK_EXAMPLES
- Fix A: Add 4-line master instruction
- Fix B: Verify/fix prompt palette colors
- Fix G: DPI 200→300 in examples
- Validate with 1 production Opus run on the same NPP brief

**Commit 2 (P1): Layout variety + efficiency**
- Fix F: Add layout plan example
- Fix D1: Add Sonnet efficiency instructions
- Validate with 1 production Sonnet run

**Commit 3 (P2): Cost guard**
- Fix C: Cross-attempt budget check
- Fix D2: Cost anomaly logging
- Validate with type-check only (no production run needed for a guard change)

### What NOT to do (CLAUDE.md compliance)

- Do NOT modify render-v2.ts BASQUIO_MASTER for the default template path — it's dead code for that path
- Do NOT lower per-attempt budget caps below $7/$10
- Do NOT add "suppress output" or "compact output" instructions
- Do NOT add more than ~50 lines of instructions to the prompt — use examples instead
- Do NOT ship Fix C (budget guard) before Fix A (branding) — branding is the user-visible fix

### Validation protocol

Each commit gets exactly 1 production run before the next:

1. After Commit 1: Run 1 Opus 15-slide deck
   - Verify: "Basquio | Confidential" footer on all non-cover slides
   - Verify: Slide numbers present
   - Verify: Chart colors use `#F0CC27` amber
   - Verify: Charts rendered at 300 DPI (check pixel dimensions > 2000px wide for full-width)
   - Score: target >= 8.0/10

2. After Commit 2: Run 1 Sonnet 15-slide deck
   - Verify: At least 5 layout types
   - Verify: No layout type > 40% of slides
   - Verify: Output tokens < 65K (efficiency improvement)
   - Score: target >= 8.0/10

3. After Commit 3: Type-check only
   - `pnpm qa:basquio` passes
   - No production run needed

---

## Scores: current vs expected after fixes

| Dimension | Attempt 2 (current) | After Commit 1 | After Commit 2 | Final |
|-----------|---------------------|-----------------|-----------------|-------|
| Analysis depth | 8/10 | 8/10 | 8/10 | 8/10 |
| Chart accuracy | 8/10 | 8/10 | 8/10 | 8/10 |
| Chart design | 7/10 | 7.5/10 | 8/10 | 8/10 |
| Slide layout | 7/10 | 7/10 | 8/10 | 8/10 |
| Branding | 5/10 | **8/10** | 8/10 | 8/10 |
| Cost efficiency | 5/10 | 5/10 | 6/10 | **7/10** |
| **Overall** | **7.2/10** | **7.8/10** | **8.2/10** | **8.2/10** |

The remaining gap to 10/10:
- 9/10 requires: logo on cover slide (needs base64 PNG embed), chart emphasis highlighting, client testimonials
- 10/10 requires: multi-run regression suite, A/B testing, template fidelity across PowerPoint/Slides/Keynote
