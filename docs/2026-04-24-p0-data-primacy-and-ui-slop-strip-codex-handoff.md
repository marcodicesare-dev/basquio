# P0 handoff: data primacy, vertical knowledge expansion, UI slop strip

Session date: 2026-04-24
Owner on hand-off: GPT-5.5 via codex CLI
Branch: cut a fresh branch from `origin/main` named `codex/p0-data-primacy-ui-slop`
Expected effort: two working days, single PR
Do NOT rebase or merge any other codex branch into this one

## 1. Mission

Fix the Rossella cocktails regression where Opus 4.7 fabricated an entire EMEA RTD market deck instead of analyzing her consumer trial-intent survey. Ship fifteen coordinated changes in one PR. Partial merges reopen the bug.

The vertical FMCG knowledge in `system-prompt.ts` stays and expands. Four survey/methodology knowledge files that already exist on disk but are not loaded get added to the active prompt. No scenario classifier, no workspace-scoped rule packs, no horizontal-SaaS drift.

## 2. Forensic context (verified empirically, not pattern-matched)

Rossella's run: `1831a13e-12b4-42cf-ba90-c259f062d22c`, Opus 4.7, workspace_id=null, launch_source="jobs-new", author_model="claude-opus-4-7", 10 target slides, completed in 24m44s.

### The input

One file: `EMEA Pulses w34 IT - cocktails on tap dataset.xlsx`. One sheet: `w34 Cocktails on tap`. 105 rows, 11 columns. 750 Italian respondents answering Q43-Q46 about trial intent for cocktails on tap. Every numeric cell is either a respondent count (57, 61, 107, ... , 750) or a decimal percentage (0.0 to 1.0). No EUR values, no YoY growth, no EMEA geography, no channel sales, no competitor shares, no pricing, no distribution, no format breakdown.

Brief:
- audience: "branca leadership team"
- objective: "raccontare la situazione attuale ed i trend emergenti ai produttori italiani di alcolici che hanno in mente di investire sui ready to drink"
- businessContext: "i dati inseriti sono dati sul consumo di cocktail RTD fuori casa. Analizza i dati trovando i trend."

### The output

Eleven-slide deck with every hero number fabricated:

- "Italia RTD on-trade €96M (+17,1% YoY)", "EMEA TOTALE €1,4 mld", "UK €412M", "Paesi Bassi, Belgio, Polonia, Francia, Spagna, Germania" with respective EUR values
- Full PY→CY bridge table: Valore €82M→€96M, Volume 8,40→9,20 Mln L, Prezzo 9,76→10,43 €/L, Outlet 24,5K→28,1K
- Channel breakdown: "Caffetteria +31%, Stabilimento +26%, Cocktail bar 34% quota, 3.800 pdv"
- Format breakdown: "Draft on tap €11M +52%, Frozen pouch €6,2M +38%, Lattina 330ml €30,2M +14,5%"
- Competitor shares: "Campari 26%, Jack Daniel's +38%, Branca 2,8%"
- 2027 scenarios: "base €125M (+14% CAGR), ambizioso €143M"

Every slide footer cited: "Fonte: NIQ EMEA Pulses w34 IT | On-Premise RTD Cocktails | L52W Set-2025 vs L52W Set-2024". Rossella's actual file is a consumer trial-intent survey, not an on-premise sell-out report. Citation was fabricated to match the filename.

### How it happened

1. The uploaded dataset was correctly parsed. `file_inventory` correctly flagged: "No file was confidently classified as the main analytical table; Basquio is using the first workbook as the primary source."
2. The brief was loose and read as market-sizing ("emerging trends for alcohol producers"). Opus reasonably interpreted it as requiring EMEA + channel + competitor analysis.
3. Opus saw the uploaded survey could not sustain the implied brief.
4. Opus invented the data it wished it had during code execution: wrote synthetic pandas dataframes with fabricated sheet names (`S02_EMEA_Overview`, `S03_Italia_Bridge`, `S04_Italia_Canali`, ...) and fabricated EUR values.
5. `web_fetch_20260209` was in the tools array for author + both revise loops (verified in `deck_run_events`). May have contributed web-sourced numbers, cannot prove from logs (Railway retention + missing telemetry field).
6. The existing `claim_traceability_qa` Haiku validator checked each slide against its LINKED WORKBOOK SHEETS. Opus' fabricated sheets were the linked sheets. Validator passed with one cosmetic complaint on slide 12.
7. Deck shipped with 100% fabricated numbers, 100% fabricated citations, zero slides derived from Rossella's 750-respondent survey.

### Verification commands used (so you can reproduce)

```bash
# Run metadata
curl -s -H "apikey: $SB_KEY" "$SB_URL/rest/v1/deck_runs?id=eq.1831a13e-12b4-42cf-ba90-c259f062d22c&select=*"

# Tool call telemetry
curl -s -H "apikey: $SB_KEY" "$SB_URL/rest/v1/deck_run_events?run_id=eq.1831a13e-12b4-42cf-ba90-c259f062d22c&event_type=eq.tool_call&select=*"

# Fabricated plan
curl -s -H "apikey: $SB_KEY" "$SB_URL/rest/v1/working_papers?run_id=eq.1831a13e-12b4-42cf-ba90-c259f062d22c&paper_type=eq.analysis_result&select=content"

# Validator that passed
curl -s -H "apikey: $SB_KEY" "$SB_URL/rest/v1/working_papers?run_id=eq.1831a13e-12b4-42cf-ba90-c259f062d22c&paper_type=eq.claim_traceability_author&select=content"

# Railway worker env (research flag absent)
railway variables --service basquio-worker --kv | grep -iE "RESEARCH|FIRECRAWL|FIBER"
```

## 3. Non-negotiables

- Do not touch existing rule bullets in [system-prompt.ts](../packages/workflows/src/system-prompt.ts) lines 1340-1399 beyond what is specified in P0.1. Every existing rule stays
- Do not remove any existing knowledge pack file from `KNOWLEDGE_PACK_FILES`. Only ADD
- Do not introduce workspace-scoped rule packs, dataset-shape classifiers, feature flags for existing rules, or per-scenario switches
- Do not change the chat UX or scope landing. Codex on `codex/chat-ux-p0` owns that lane
- No em-dashes anywhere in code, docs, commit messages, or prompt strings. Use commas
- No emojis anywhere
- Working rules at [docs/working-rules.md](working-rules.md) apply. Read them before you start

## 4. P0.0: brief-to-data reconciliation as soft gate

### Goal
Before Opus authors, a cheap Haiku call checks whether the brief is answerable from the uploaded data. On mismatch, inject a `scope_adjustment` note into the author prompt so Opus narrates the gap honestly. NEVER hard-stop the run. User must always receive a deck.

### File
New: `packages/workflows/src/brief-data-reconciliation.ts`

### API
```ts
export type ReconciliationResult = {
  answerable: "fully" | "partial" | "mismatch";
  uploadedDataFrame: string; // short description of what the data DOES answer
  briefImpliesFrame: string; // short description of what the brief asked for
  scopeAdjustment: string | null; // text to inject into author prompt when partial/mismatch
};

export async function runBriefDataReconciliation(input: {
  client: Anthropic;
  brief: { objective: string; businessContext: string; audience: string };
  datasetProfile: DatasetProfile;
  model?: "claude-haiku-4-5";
}): Promise<ReconciliationResult>;
```

### Integration
In [generate-deck.ts](../packages/workflows/src/generate-deck.ts) between normalize completion and author prompt construction (around line 1290 where `buildBasquioSystemPrompt` is called):

```ts
const reconciliation = await runBriefDataReconciliation({
  client,
  brief: run.brief,
  datasetProfile: parsed.datasetProfile,
});
await upsertWorkingPaper(config, runId, "brief_data_reconciliation", reconciliation);

const scopeAdjustmentBlock = reconciliation.scopeAdjustment
  ? `\n\n<scope_adjustment>\n${reconciliation.scopeAdjustment}\n</scope_adjustment>`
  : "";

// Append to businessContext that reaches the author
const adjustedBusinessContext = `${run.brief.businessContext ?? ""}${scopeAdjustmentBlock}`;
```

### Haiku prompt (exact)
```
You audit whether an analyst brief can be answered from an uploaded dataset.

You return a JSON object matching this schema:
{
  "answerable": "fully" | "partial" | "mismatch",
  "uploadedDataFrame": "one sentence describing what the data actually measures",
  "briefImpliesFrame": "one sentence describing what the brief is asking for",
  "scopeAdjustment": string | null
}

Rules:
- "fully" means every analytical question the brief implies can be answered from the uploaded data alone
- "partial" means the data answers some but not all of the brief's implied questions
- "mismatch" means the data answers a fundamentally different question than what the brief asks
- On "partial" or "mismatch", scopeAdjustment is a 3-5 sentence note the deck author will read. It must name the gap explicitly, describe what the data DOES answer, and instruct the author to narrate the gap in the executive summary and narrative report
- On "fully", scopeAdjustment is null

BRIEF:
audience: {audience}
objective: {objective}
businessContext: {businessContext}

DATASET PROFILE:
{datasetProfile summary: sheet names, column names, column types, sample values, warnings}

Respond with JSON only.
```

### Acceptance
- Rossella's cocktails run (brief = "trend emergenti alcolici RTD", data = trial intent survey) returns `answerable: "mismatch"` with a scopeAdjustment that names the gap
- Segafredo's coffee run (brief = "opportunità di crescita Segafredo", data = NIQ scanner with prices/volumes/promo) returns `answerable: "fully"` with null scopeAdjustment
- Runtime: ≤5s, cost ≤$0.02
- Vitest unit test in `packages/workflows/src/brief-data-reconciliation.test.ts` covering fully / partial / mismatch cases with mocked Anthropic client

## 5. P0.1: data primacy contract as XML block at top of dynamic prompt

### File
[packages/workflows/src/system-prompt.ts](../packages/workflows/src/system-prompt.ts), lines 1512-1521 where `dynamicParts` is assembled.

### Change
Currently the dynamic block prepends the existing rules list with "Template summary:" and "Language requirement:". Move PRIMARY DATA ANCHORING into a top-level XML contract block that renders BEFORE the template summary, not as a bullet in the rules array:

```ts
const dynamicParts: string[] = [
  renderDataPrimacyContract(),
  "",
  "Template summary:",
  templateSummary,
  "",
  `Language requirement: ${input.briefLanguageHint}`,
];
```

### New function
Add to `packages/workflows/src/system-prompt.ts`:

```ts
function renderDataPrimacyContract(): string {
  return [
    "<data_primacy_contract>",
    "NON-NEGOTIABLE, READ FIRST. This contract overrides any other prompt instruction in conflict:",
    "",
    "<rule id=\"uploaded-data-primacy\">",
    "Every numeric value, chart series, and recommendation metric on every slide must come from the uploaded files. External sources (`web_fetch` results, research-layer refs with `firecrawl:` or `graph:` ids, knowledge-base benchmarks) are SUPPORTING CONTEXT ONLY. They may appear as a clearly labeled \"Market context\" paragraph or footnote, citing the actual URL or report title, never as a hero number, never as a chart series, never as a recommendation's quantified impact.",
    "</rule>",
    "",
    "<rule id=\"no-sheet-fabrication\">",
    "You may only reference sheet names, column names, and cell values that exist in the user-uploaded workbook. You MAY NOT invent sheet names, synthetic worksheets, or pandas DataFrames whose provenance is not the uploaded file or a documented external source. If you need a computed view, compute it transparently in code execution from uploaded cells and name the computed view with a prefix like `computed_` so it is clear it is derivative.",
    "</rule>",
    "",
    "<rule id=\"citation-accuracy\">",
    "The source line on every slide must cite ONLY filenames that the user uploaded, or URLs that were actually fetched via `web_fetch` in this run. Never cite an external report name that you have not fetched. If the data is from the uploaded file, cite the exact uploaded filename. If from `web_fetch`, cite the actual URL as a footnote, not rolled into the uploaded filename.",
    "</rule>",
    "",
    "<rule id=\"data-gap-narration\">",
    "If the uploaded data does not support the analytical depth the brief implies, narrate the gap explicitly in the executive summary and in narrative_report.md. Tell the user what their data does answer, and what it does not answer. Cut slides rather than fill the gap with external numbers.",
    "</rule>",
    "",
    "<rule id=\"structural-slot-reservation\">",
    "Deck structure is bound by this ordering:",
    "- Cover slide: hero number MUST come from uploaded data",
    "- Executive summary: at least 3 of 4 metric blocks MUST come from uploaded data",
    "- First half of drill-down slides (positions 3 through ceil(N/2)): uploaded-data only, no external enrichment",
    "- Second half of drill-down slides: external enrichment allowed, clearly labeled \"Market context\" or \"External benchmark\"",
    "- Recommendations: every recommendation must cite by slide position at least one prior uploaded-data slide (e.g., \"cfr. slide 3\")",
    "</rule>",
    "</data_primacy_contract>",
  ].join("\n");
}
```

### Why XML block at the top
Anthropic's Claude 4.6/4.7 prompting best practices (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering) explicitly state that rules placed at the TOP of the prompt in XML tags get higher adherence than bullets in a rules list. This matches Anthropic's internal guidance for hallucination reduction (https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations).

### Do not delete existing bullets
DATA TRACEABILITY, Industry benchmarks, promo story contract, decimal policy, focal brand persistence, claim-chart binding, redundancy, storyline contiguity: all stay. They are covered by the static knowledge pack and by existing rule bullets. The XML contract is ADDITIVE.

### Acceptance
- Grep confirms `<data_primacy_contract>` appears exactly once in the rendered dynamic block
- Grep confirms every existing rule bullet in lines 1340-1399 is unchanged
- System prompt token count increases by 400-500 tokens, confirmed via `pnpm qa:basquio`

## 6. P0.2: webFetchMode constraint

### Files
- [packages/workflows/src/anthropic-execution-contract.ts](../packages/workflows/src/anthropic-execution-contract.ts)
- [packages/workflows/src/generate-deck.ts](../packages/workflows/src/generate-deck.ts)

### 6.1 Update buildClaudeTools signature

```ts
export type WebFetchMode = "off" | "enrich";

export function buildClaudeTools(
  model: ClaudeAuthorModel = "claude-sonnet-4-6",
  options: { webFetchMode?: WebFetchMode } = {},
): Anthropic.Beta.BetaToolUnion[] {
  const webFetchMode = options.webFetchMode ?? "enrich";
  const tools: Anthropic.Beta.BetaToolUnion[] = [];

  if (model === "claude-haiku-4-5") {
    tools.push({ type: "code_execution_20250825", name: "code_execution" });
  }

  if (webFetchMode === "enrich") {
    tools.push(
      model === "claude-haiku-4-5"
        ? { type: "web_fetch_20260209", name: "web_fetch", allowed_callers: ["direct"] }
        : { type: "web_fetch_20260209", name: "web_fetch" },
    );
  }

  return tools;
}
```

Default stays `"enrich"` so existing call sites keep current behavior. Only the two sites below get updated.

### 6.2 Author call site

In `generate-deck.ts`, around line 1550-1600 where `tools: buildClaudeTools(MODEL)` is called, compute:

```ts
const authorWebFetchMode: WebFetchMode =
  researchEvidenceRefs.length > 0 ||
  (workspaceContextPack?.citedSources?.length ?? 0) > 0
    ? "enrich"
    : "off";
```

Then pass:
```ts
tools: buildClaudeTools(MODEL, { webFetchMode: authorWebFetchMode }),
```

### 6.3 Revise call sites

Both revise `buildClaudeTools` calls (around line 2172 and any other revise lane): pass unconditionally:
```ts
tools: buildClaudeTools(reviseModel, { webFetchMode: "off" }),
```

### 6.4 Telemetry
Add `webFetchMode` field to the `cost_preflight` event payload for both author and revise so operators can see from the database which runs had web access.

### Acceptance
- Unit test in `packages/workflows/src/anthropic-execution-contract.test.ts`: `buildClaudeTools("claude-opus-4-7", { webFetchMode: "off" })` returns empty array; `buildClaudeTools("claude-opus-4-7", { webFetchMode: "enrich" })` contains web_fetch; `buildClaudeTools("claude-haiku-4-5", { webFetchMode: "off" })` returns single code_execution tool
- Grep confirms `web_fetch_20260209` appears only inside `if (webFetchMode === "enrich")` block
- Every `buildClaudeTools(` call in generate-deck.ts now passes explicit `webFetchMode`

## 7. P0.3a: plan-stage sheet name validator

### Goal
Reject any `analysis_result.slidePlan[].chart.excelSheetName` that does not exist in the uploaded dataset profile's sheets[] before Opus authors. Catches Rossella-class fabrication at $0.05 Haiku planner cost instead of $3-12 Opus author cost.

### File
New: `packages/workflows/src/plan-sheet-name-validator.ts`

### API
```ts
export type PlanSheetNameReport = {
  valid: boolean;
  fabricatedSheetNames: Array<{
    slidePosition: number;
    chartId: string;
    claimedSheetName: string;
    knownSheetNames: string[];
  }>;
};

export function validatePlanSheetNames(input: {
  slidePlan: AnalysisResult["slidePlan"];
  datasetProfile: DatasetProfile;
}): PlanSheetNameReport;
```

### Algorithm
1. Build a set of known sheet names from `datasetProfile.sheets[].name` plus any `computed_` prefixed sheet names the plan declares as derived
2. For each slide in plan with a `chart.excelSheetName`, check membership
3. Allow any name matching `computed_.*` or containing one of the known sheet names as a substring (so "computed_trial_rate_by_gender" based on "w34 Cocktails on tap" still validates if the plan explicitly declares the derivation)
4. Report all fabrications

### Integration
In [generate-deck.ts](../packages/workflows/src/generate-deck.ts) right after `analysis_result.json` is parsed by the planner (search for the existing `deck_plan` working paper write). Before proceeding to author:

```ts
const sheetValidation = validatePlanSheetNames({
  slidePlan: analysisResult.slidePlan,
  datasetProfile: parsed.datasetProfile,
});
await upsertWorkingPaper(config, runId, "plan_sheet_name_validation", sheetValidation);

if (!sheetValidation.valid) {
  // Re-plan: send Haiku back with an explicit rejection message
  const replanMessage = renderSheetNameRejectionMessage(sheetValidation);
  // ... invoke plan re-roll with replanMessage appended
  // If second plan STILL fabricates, log to advisory_issues and proceed (ship artifacts rule)
}
```

### Acceptance
- Unit test with Rossella's plan (references `S02_EMEA_Overview`, `S03_Italia_Bridge`, etc.) against her dataset profile (single sheet `w34 Cocktails on tap`): returns `valid: false` with 10+ fabricated sheets
- Unit test with Segafredo coffee plan against NIQ scanner dataset: returns `valid: true`
- Unit test with `computed_*` prefix: returns `valid: true`

## 8. P0.3b: data primacy validator (hybrid regex + Haiku)

### File
New: `packages/intelligence/src/data-primacy-validator.ts`

### API
```ts
import type { DatasetProfile, ArtifactManifest } from "@basquio/types";

export type UnboundClaim = {
  slideIndex: number;
  slideTitle: string | null;
  location: "title" | "body" | "chart-series" | "chart-axis" | "callout" | "recommendation";
  rawText: string;
  parsedValue: number;
  suggestedAnchor: string | null;
  classification?: "bound-via-derivation" | "bound-via-ratio" | "unbound-external" | "unbound-invented";
};

export type DataPrimacyReport = {
  totalNumericClaims: number;
  boundClaims: number;
  unboundClaims: UnboundClaim[];
  heroUnbound: UnboundClaim[];
  boundRatio: number;
  heroPassed: boolean;
  bodyPassed: boolean;
};

export async function validateDataPrimacy(input: {
  client?: Anthropic;
  manifest: ArtifactManifest;
  datasetProfile: DatasetProfile;
  uploadedWorkbookBuffers: Array<{ fileName: string; buffer: Buffer }>;
  sampleTolerancePct?: number;
}): Promise<DataPrimacyReport>;
```

### Pass 1: regex + tolerance matching

1. Walk every slide in `manifest.slides`. Collect numeric tokens from:
   - slide title (regex: `/-?\d+[\.,]?\d*\s*(%|€|EUR|Mln|M|Miliardi|mld|K|pp|bps)?/g`)
   - body text, bullets, callouts, recommendations
   - `manifest.slides[i].charts[j].series[k].data` datapoints
   - chart axis labels

2. Build a numeric vocabulary from `uploadedWorkbookBuffers` (NOT the workbook Claude produced, the ORIGINAL uploads):
   - Parse each workbook with exceljs, walk every cell, collect numeric values
   - Compute column-level aggregates (min, max, mean, median, sum, count)
   - Normalize: strip `%`, thousand separators (period and comma), EUR, Mln/M, K suffixes. A cell value of 0.628 normalizes to include matches for "62.8", "62,8", "62.8%", "62,8%"

3. A slide numeric token is `bound` if it matches any vocabulary value within `sampleTolerancePct` (default 1.0%), OR exact-match on rounded integer, OR is within 1% of a simple column aggregate.

### Pass 2: Haiku classification for Pass 1 unbound candidates

Only runs if Pass 1 returns non-empty `unboundClaims`. Single Haiku call:

```
You classify numeric claims as bound or unbound to an uploaded dataset.

INPUT:
- A list of unbound claim candidates (from pass 1 regex match)
- The full dataset profile (sheet names, column names, sample values, aggregates)
- The full uploaded workbook data (first 200 rows per sheet)

For each candidate, return one of:
- "bound-via-derivation": the number can be computed from uploaded cells via reasonable arithmetic (e.g., percentage of a count)
- "bound-via-ratio": the number is a ratio or weighted average derivable from uploaded columns
- "unbound-external": the number is clearly from an external source (cited with URL, labeled "Market context")
- "unbound-invented": the number has no plausible derivation path from uploaded data and is not labeled external

Respond with JSON array matching the input order.
```

### Pass 3: classify hero vs body

- Hero: any numeric token in slide title OR primary `series[0].data` OR cover metric blocks
- Body: everything else

`heroPassed = heroUnbound.every(c => c.classification === "bound-via-derivation" || c.classification === "bound-via-ratio" || c.classification === "unbound-external")`
`bodyPassed = boundRatio >= 0.80`

### Gate logic in generate-deck.ts

Read `process.env.BASQUIO_DATA_PRIMACY_VALIDATOR_MODE` (default `"warn"` for first 10 runs, flip to `"block"` after). See P0.10 for flag lifecycle.

Hero enforcement:
- Mode `"warn"`: log `data_primacy_report` to working papers, add to `advisory_issues`, publish anyway
- Mode `"block"`: if `!heroPassed`, route to revise with unbound list; if already last revise iteration, log to advisory_issues and publish

Body enforcement:
- Always `"warn"`: body ratio below 80% logs to advisory_issues, never blocks publish

### Migration

New migration `supabase/migrations/<timestamp>_add_data_primacy_report.sql`:

```sql
alter table public.deck_runs
  add column if not exists data_primacy_report jsonb;

alter table public.deck_runs
  add column if not exists advisory_issues jsonb default '[]'::jsonb;

alter table public.deck_runs
  add column if not exists scope_adjustment text;

alter table public.deck_run_request_usage
  add column if not exists web_fetch_count int default 0;

create table if not exists public.cost_anomaly_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.deck_runs(id),
  phase text not null,
  model text not null,
  projected_usd numeric,
  soft_cap_usd numeric,
  spent_usd numeric,
  created_at timestamptz default now()
);

create index if not exists idx_cost_anomaly_events_run_id on public.cost_anomaly_events(run_id);
```

### Tests

`packages/intelligence/src/data-primacy-validator.test.ts`:
- Deck where every slide number matches a dataset cell: `heroPassed=true`, `bodyPassed=true`
- Deck with one invented market-size number on slide 3 title: `heroPassed=false`, `heroUnbound.length===1`
- Deck where body number is percentage derivable from counts: Pass 2 classifies as `bound-via-derivation`, counted as bound
- Deck with Italian number format "13,5%" vs dataset "0.135": bound via normalization
- Empty deck: `heroPassed=true`, `bodyPassed=true`

### Acceptance
- All tests pass via `pnpm vitest run packages/intelligence/src/data-primacy-validator.test.ts`
- Migration applies cleanly: `pnpm supabase:start && pnpm supabase:reset`
- Validator runtime ≤15s total (Pass 1 ≤2s, Pass 2 Haiku ≤10s)

## 9. P0.4a: cost guard warnings with $30 emergency ceiling

### File
[packages/workflows/src/cost-guard.ts](../packages/workflows/src/cost-guard.ts)

### Change
Convert three preflight throws (lines 66-68, 97-99, 115-117) and the hard-cap throw in `assertDeckSpendWithinBudget` (149-151) to warnings. Single emergency ceiling remains as circuit breaker.

```ts
const EMERGENCY_USD_CEILING = 30.0;

// Inside enforceDeckBudget, replace each "throw new Error(...)" with:
if (projectedUsd > EMERGENCY_USD_CEILING) {
  throw new Error(
    `Projected Claude cost $${projectedUsd.toFixed(3)} exceeds emergency ceiling $${EMERGENCY_USD_CEILING.toFixed(2)}. Circuit breaker.`,
  );
}
if (projectedUsd > maxUsd) {
  console.warn(
    `[cost-guard] projected spend $${projectedUsd.toFixed(3)} exceeds soft cap $${maxUsd.toFixed(2)} for ${input.model}, continuing.`,
  );
}
```

`enforceDeckBudget` returns `overBudget: boolean` in its result object. Call sites log it but do not branch on it for work-skipping.

In `assertDeckSpendWithinBudget`, same pattern: warn above soft cap, throw above emergency ceiling.

### Cost anomaly telemetry
When a soft-cap warning fires, insert into `cost_anomaly_events`:
```ts
await db.from("cost_anomaly_events").insert({
  run_id: runId,
  phase: phase,
  model: model,
  projected_usd: projectedUsd,
  soft_cap_usd: maxUsd,
  spent_usd: spentUsd,
});
```

### Tests
Update `packages/workflows/src/cost-guard.test.ts`:
- Projection $15 on Opus soft cap $12: does not throw, returns `overBudget: true`, logs warning, writes cost_anomaly row
- Projection $31: throws emergency ceiling error
- Revise phase, spentUsd $5, projected $4: does not throw, `overBudget: false`, no anomaly row

### Acceptance
- `pnpm vitest run packages/workflows/src/cost-guard.test.ts` passes
- Grep confirms no `throw new Error.*exceeds budget` remains in `cost-guard.ts`
- Exactly one `throw new Error.*emergency ceiling` exists

## 10. P0.4b: UI slop strip + filename normalization

### File
[apps/web/src/components/run-progress-view.tsx](../apps/web/src/components/run-progress-view.tsx)

### 10.1 Line 780 "Export complete" kicker
Delete:
```tsx
<p className="artifact-kind">Export complete</p>
```

### 10.2 Lines 782-784, resultMeta caption
Delete the entire `<p className="muted">{resultMeta}</p>`. Delete the `resultMeta` variable (lines 750-752) if no longer referenced.

### 10.3 Lines 814-822, compact-meta-row block
Delete the full `<div className="compact-meta-row">` and the `<p className="muted">{templateSummary.detail}</p>` paragraph beneath it. Delete:
- `capabilityPills` (line 753-755)
- `templateSummary` (line 744-746) if not referenced elsewhere
- `reviewSuggested` (line 747) if not referenced elsewhere
- `describeTemplateDiagnostics` import if now unused

### 10.4 Lines 827-842, billing-stats-row
Delete the full `<div className="billing-stats-row">` containing all three cards (Slides, Credits used, Status).

### 10.5 Lines 760-773, completion toast
Delete the floating blue toast. Delete `showCompletionToast` state and `setShowCompletionToast` setter.

### 10.6 Lines 847-851, "Preview before you download" block
Replace:
```tsx
<div className="workspace-section-head">
  <h2>Preview before you download</h2>
</div>
<p className="muted" style={{ maxWidth: 720 }}>
  Review a few slide thumbnails here first. If the story looks right, grab the editable deck and supporting files.
</p>
```
With:
```tsx
<h2>Preview</h2>
```

### 10.7 Download filename normalization
Current download URLs serve files as `deck.pptx`, causing browser auto-rename to `deck (2).pptx` on re-download. In the download handler (search for `Content-Disposition` in `apps/web/src/app/api/artifacts/**` and `apps/web/src/app/api/v2/artifacts/**`):

```ts
const uploadedBaseName = sourceFiles
  .find(sf => sf.kind === "workbook")
  ?.fileName
  ?.replace(/\.[^.]+$/, "") ?? "basquio";
const now = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const downloadName = `${uploadedBaseName}-basquio-deck-${now}.pptx`;
response.headers.set("Content-Disposition", `attachment; filename="${downloadName}"`);
```

Apply the same pattern to PDF, XLSX, and narrative markdown downloads.

### 10.8 Final deliverable-page shape
```tsx
<section className="panel job-result-hero">
  <div className="stack-lg job-result-copy">
    <div className="stack">
      <span className="job-result-check" aria-hidden>
        <Check size={18} weight="bold" />
      </span>
      <h1>{readyLabel}</h1>
    </div>
    <div className="job-result-actions">
      {/* download buttons unchanged */}
    </div>
  </div>
</section>

{previewImages.length > 0 ? (
  <section className="panel stack-lg">
    <h2>Preview</h2>
    <div style={{...grid styles unchanged...}}>
      {/* thumbnails unchanged */}
    </div>
  </section>
) : null}
```

### Acceptance
- `pnpm --filter @basquio/web build` compiles cleanly
- Open the deliverable page for a recent completed run, visually confirm absence of: "Export complete", chips row, template paragraph, billing cards, toast, lecture copy
- Grep confirms `"Review suggested"`, `"review_suggested"`, `"Ready to review"`, `"Export complete"`, `"review a few slide thumbnails"`, `"template interpretation status"` appear zero times in `apps/web/src/`
- Download a deck twice. Second download should NOT be named `deck (2).pptx` but match the normalized format

## 11. P0.4c: review_suggested plumbing removal

After P0.4b, grep the codebase:
```
rg -n 'review[_\s]suggested|Review suggested|review a few slide' apps/web/src packages/
```
Expected: zero matches. Delete any stragglers in helpers, fixtures, or types.

Note: `qaPassed` stays in the database and in internal telemetry. User surfaces expose nothing.

## 12. P0.5 (renumbered): not applicable (folded into others)

## 13. P0.6: citation fidelity validator with URL-was-fetched cross-check

### Goal
Every slide source line must cite a filename that was uploaded OR a URL that was actually fetched in this run. Ban fabricated citations.

### File
New: `packages/intelligence/src/citation-fidelity-validator.ts`

### API
```ts
export type CitationViolation = {
  slideIndex: number;
  rawSourceLine: string;
  citedEntity: string;
  violationType: "unknown-filename" | "unfetched-url" | "fabricated-report-name";
};

export type CitationFidelityReport = {
  violations: CitationViolation[];
  passed: boolean;
};

export function validateCitations(input: {
  manifest: ArtifactManifest;
  uploadedFileNames: string[];
  fetchedUrls: string[]; // from the run's author message thread tool_use blocks
}): CitationFidelityReport;
```

### Algorithm
1. For each slide, extract the source/footer text (search for "Fonte:" or "Source:" or common patterns, or read from slide manifest's `sourceLine` field if present)
2. Parse each token: if it looks like a filename (`*.xlsx`, `*.pptx`, etc.), match against `uploadedFileNames`
3. If it looks like a URL, match against `fetchedUrls`
4. If it looks like a report name without a URL ("NIQ EMEA Pulses w34 IT" when no such file was uploaded and no URL was fetched): flag as `fabricated-report-name`

### fetchedUrls extraction
From the author call's message thread, extract every `tool_use` block where `name === "web_fetch"` and collect the `input.url` values. These are the URLs Claude actually asked to fetch. Store as part of the run metadata in a new column `deck_runs.fetched_urls` (jsonb).

### Integration
At publish gate in [generate-deck.ts](../packages/workflows/src/generate-deck.ts), after P0.3b:
```ts
const citationReport = validateCitations({
  manifest: finalManifest,
  uploadedFileNames: sourceFiles.map(sf => sf.file_name),
  fetchedUrls: extractedFromAuthorMessageThread,
});
await upsertWorkingPaper(config, runId, "citation_fidelity", citationReport);
if (!citationReport.passed) {
  // Route to revise with violations list; if last iteration, advisory + publish
}
```

### Acceptance
- Rossella's run with "NIQ EMEA Pulses w34 IT" citation and no actual uploaded NIQ report: returns `passed: false` with fabricated-report-name violations on all 11 slides
- Real run with uploaded file "q3-promo-data.xlsx" cited as "q3-promo-data.xlsx": returns `passed: true`
- Real run citing `https://retailwatch.it/article/123` which was fetched by web_fetch: returns `passed: true`
- Real run citing `https://example.com/fake` which was NOT fetched: returns violation `unfetched-url`

## 14. P0.8: load four curated FMCG knowledge files

### Goal
Expand the vertical knowledge pack to cover consumer panel, voice of client, innovation / trial intent, and storytelling. These files already exist on disk but are not loaded in KNOWLEDGE_PACK_FILES.

### Files to load
Add to `KNOWLEDGE_PACK_FILES` array at [system-prompt.ts:10-21](../packages/workflows/src/system-prompt.ts):

```ts
const KNOWLEDGE_PACK_FILES = [
  "docs/domain-knowledge/niq-analyst-playbook.md",
  "docs/domain-knowledge/niq-promo-storytelling-playbook.md",
  "docs/domain-knowledge/niq-decimal-policy.md",
  "docs/domain-knowledge/niq-cps-2023-template-extracted.md",          // NEW
  "docs/domain-knowledge/niq-voice-of-the-client-extracted.md",        // NEW
  "docs/domain-knowledge/niq-innovation-basics-extracted.md",          // NEW
  "docs/domain-knowledge/niq-storymasters-module-1-extracted.md",      // NEW
  "docs/domain-knowledge/basquio-data-fidelity-rules.md",
  "docs/domain-knowledge/basquio-copywriting-skill.md",
  "docs/domain-knowledge/basquio-deck-depth-architecture.md",
  "docs/domain-knowledge/basquio-recommendation-framework.md",
  "docs/domain-knowledge/fmcg-rgm-consulting-finance-layer.md",
  "docs/domain-knowledge/kantar-knowledge-graph.md",
  "docs/domain-knowledge/circana-knowledge-graph.md",
] as const;
```

### Slop lint each file before commit

For each of the four new files, run this sanity check before committing to git:

```bash
for f in docs/domain-knowledge/niq-cps-2023-template-extracted.md \
         docs/domain-knowledge/niq-voice-of-the-client-extracted.md \
         docs/domain-knowledge/niq-innovation-basics-extracted.md \
         docs/domain-knowledge/niq-storymasters-module-1-extracted.md; do
  echo "=== $f ==="
  grep -c "$(printf '\xe2\x80\x94')" "$f" && echo "FAIL: em-dash present in $f"
  grep -iE "\b(delve|nuanced|comprehensive|robust|leverage|utilize|crucial|significant)\b" "$f" | head -5
done
```

If any em-dash is found, replace with commas. If AI vocabulary is found, rewrite those sentences in direct, operator-grade prose. The working rules apply to knowledge pack files too.

### Commit
These files are currently untracked (`??` in `git status`). Add them with an explicit commit message:

```
Load CPS, voice-of-client, innovation, storymasters knowledge packs

Basquio's vertical knowledge expands from scanner-only (NIQ promo, Circana,
Kantar RMS) to include consumer panel methodology, voice-of-client custom
research, innovation/trial intent, and storytelling. This closes the gap
Rossella's cocktails run revealed: a consumer trial-intent survey cannot
be analyzed with scanner-only playbooks.

All four files reviewed for em-dash and AI vocabulary before load.
```

### Acceptance
- `pnpm qa:basquio` passes (no em-dashes or slop in any loaded knowledge file)
- System prompt token count increases by roughly 25-30K tokens (~100KB of markdown)
- First-call write cost increases by ~$0.30 (5-min cache write at 1.25x base); subsequent calls within the same cache window add ~$0.03 per call (cached reads)

## 15. P0.9: eval harness

### File
New: `packages/intelligence/src/eval-harness/rossella-regression.test.ts`

### Test cases

**Case 1: Rossella cocktails (survey + market brief mismatch)**
- Input: `/Users/marcodicesare/Desktop/rossella-last-run-1831a13e-inputs/` (XLSX, brief.json, Template 2026.pptx)
- Expected outputs:
  - `brief_data_reconciliation.answerable === "mismatch"`
  - Deck's `data_primacy_report.heroPassed === true`
  - `citation_fidelity.passed === true`
  - Zero slide hero numbers fabricated (every hero number traces to Q43-Q46 cells)
  - Narrative report contains explicit gap narration (search for "non contiene dati" or "non consente stimare")

**Case 2: Segafredo coffee (scanner + promo brief, happy path)**
- Input: `/Users/marcodicesare/Desktop/rossella-run-ec91f0d0/` (or the original Segafredo inputs if available)
- Expected outputs:
  - `brief_data_reconciliation.answerable === "fully"`
  - Deck quality ≥ baseline (manual spot-check 3 hero numbers trace to NIQ scanner data)
  - No regression on NIQ promo depth, decimal policy, focal brand persistence
  - `citation_fidelity.passed === true`

**Case 3: Synthetic thin survey, impossible brief**
- Input: fabricate a small XLSX with just 50 respondents × 3 columns + brief asking for 50-slide market analysis
- Expected outputs:
  - `brief_data_reconciliation.answerable === "mismatch"`
  - Scope adjustment appears in author prompt
  - Deck is ≤ 10 slides, all anchored to the 50-respondent data
  - Narrative explicitly tells the user the brief cannot be fully answered

### Run mode
These tests do NOT run in CI by default (they require real Anthropic API calls). They run via `pnpm vitest run packages/intelligence/src/eval-harness/rossella-regression.test.ts` as an explicit pre-merge gate.

The test file sets `process.env.BASQUIO_EVAL_HARNESS === "true"` to skip when unset, so normal `pnpm vitest` does not pay the API cost.

### Acceptance
- All three cases pass before PR merge
- Test output captures the full `data_primacy_report` and `citation_fidelity` report for audit

## 16. P0.10: feature flag for data primacy validator

### Goal
Ship the new validator behind a flag. First 10 real production runs in `"warn"` mode, where the validator runs, logs results, but does not block publish. After 10 clean runs, flip to `"block"` for hero-number violations.

### Implementation
- New env var on Railway worker: `BASQUIO_DATA_PRIMACY_VALIDATOR_MODE` (values: `"off"` | `"warn"` | `"block-hero"`)
- Default behavior if unset: `"warn"`
- In [generate-deck.ts](../packages/workflows/src/generate-deck.ts) at the publish gate, read the env var and branch accordingly

### Rollout plan (DOCUMENT THIS IN PR DESCRIPTION, MARCO ENFORCES)
1. Ship PR with flag defaulting to `"warn"`, deploy to Railway
2. Run Rossella's cocktails brief and Segafredo's coffee brief manually. Confirm both pass hero checks (Rossella post-fix, Segafredo already clean)
3. Wait for 10 real production runs to complete. Check `working_papers.data_primacy_report` for false positives
4. If zero false positives: set Railway env var to `"block-hero"`, redeploy worker
5. If any false positives: tune the validator thresholds, repeat step 3

Marco flips the flag manually. Do not automate the flip in code.

### Acceptance
- PR merges with `BASQUIO_DATA_PRIMACY_VALIDATOR_MODE` unset on Railway (defaults to `"warn"`)
- PR description includes the four-step rollout plan
- README or handoff doc explicitly says "Marco flips the flag to `block-hero` after 10 clean runs"

## 17. P0.11: web_fetch telemetry column

### Goal
Capture `serverToolUse.webSearchRequests` from every Anthropic `usage` object. Future Rossella-class audits become database queries not two-hour forensics.

### File
[packages/workflows/src/request-usage-lifecycle.ts](../packages/workflows/src/request-usage-lifecycle.ts) (or wherever `persistRequestUsage` is defined; search for it)

### Change
In the usage extraction, add:
```ts
const webFetchCount =
  (usage?.server_tool_use?.web_fetch_requests ?? 0) +
  (usage?.server_tool_use?.web_search_requests ?? 0);
```

And include `web_fetch_count: webFetchCount` in the inserted row. The migration in P0.3b already added the column.

### Acceptance
- Next production run with `webFetchMode: "enrich"` and actual fetches: `web_fetch_count > 0` in `deck_run_request_usage`
- Next production run with `webFetchMode: "off"`: `web_fetch_count === 0`
- Historical runs without this field: default 0

## 18. P0.12: manual Rossella-rerun acceptance gate

### Pre-merge requirement
Before merging this PR, perform this manual acceptance test:

1. Check out the PR branch locally
2. Start local Supabase: `pnpm supabase:start`
3. Apply migrations: `pnpm supabase:reset`
4. Start local worker: `pnpm worker`
5. In a separate terminal, upload Rossella's exact inputs to the local web app:
   - XLSX: `/Users/marcodicesare/Desktop/rossella-last-run-1831a13e-inputs/EMEA Pulses w34 IT - cocktails on tap dataset.xlsx`
   - Brief: paste from brief.json
   - Template: `/Users/marcodicesare/Desktop/rossella-last-run-1831a13e-inputs/Template 2026.pptx`
   - Target slides: 10
   - Model: claude-opus-4-7
6. Wait for the run to complete (typical time: 20-25 min)
7. Download the produced deck
8. Open in PowerPoint or Keynote
9. Check three hero numbers on three different slides. Each must either:
   - Appear as a count or percentage computable from Q43-Q46 rows, OR
   - Be clearly labeled "Market context" with an actual URL footnote, where the URL appears in `deck_runs.fetched_urls` for this run

Criteria to merge:
- All three hero number checks pass
- Narrative report includes an honest gap statement if the brief scope was reduced
- Download filename is NOT `deck.pptx` but matches the normalized format
- Deliverable page shows no "Review suggested", no chips row, no billing cards, no toast

If any check fails, do not merge. Fix, rerun, recheck.

### Who does the acceptance
Marco or Rossella. Not codex. Not self-merged.

## 19. PR shape

One PR titled: `P0 data primacy, vertical knowledge expansion, UI slop strip`

Body:

```
Fixes the Rossella cocktails regression where Opus 4.7 fabricated an entire
EMEA RTD market deck instead of analyzing her consumer trial-intent survey.

Fifteen coordinated changes in one PR. Full spec at
docs/2026-04-24-p0-data-primacy-and-ui-slop-strip-codex-handoff.md

Summary:
- P0.0 brief-to-data reconciliation soft gate (Haiku pre-check before author)
- P0.1 <data_primacy_contract> XML block at top of dynamic prompt
- P0.2 web_fetch off for cold /jobs/new uploads, always off in revise
- P0.3a plan-stage sheet name validator rejects fabricated sheets
- P0.3b data primacy validator (regex pass 1 + Haiku pass 2)
- P0.4a cost guard warnings + $30 emergency ceiling + cost_anomaly_events
- P0.4b UI slop strip on deliverable page + download filename normalization
- P0.4c review_suggested plumbing removal
- P0.6 citation fidelity validator with URL-was-fetched cross-check
- P0.8 load CPS, voice-of-client, innovation, storymasters knowledge packs
- P0.9 eval harness: Rossella cocktails, Segafredo coffee, synthetic thin-data
- P0.10 feature flag BASQUIO_DATA_PRIMACY_VALIDATOR_MODE (warn by default)
- P0.11 web_fetch_count telemetry column on deck_run_request_usage
- P0.12 manual Rossella rerun acceptance gate before merge

Vertical FMCG rules in system-prompt.ts stay and expand. No scenario
classifiers, no workspace-scoped rule packs. Rules stay in code.

Rollout: Marco flips BASQUIO_DATA_PRIMACY_VALIDATOR_MODE from warn to
block-hero after 10 clean production runs.
```

Reviewers: Marco. Do not self-merge.

## 20. What NOT to touch

- `apps/web/src/components/workspace-chat/*` (codex/chat-ux-p0 lane)
- `apps/web/src/components/scope-landing.tsx` (codex/chat-ux-p0 lane)
- `apps/web/src/app/(workspace)/workspace/**` (codex/chat-ux-p0 lane)
- `docs/domain-knowledge/*` (Marco owns; you only ADD four files per P0.8, do not edit any existing file)
- `memory/*` (Marco owns)
- `rules/*` (Marco owns)
- `packages/research/*` (research layer, currently feature-flagged off)
- `packages/workflows/src/research-phase.ts` (research layer)

If any of these need a change to compile or pass tests, STOP and surface to Marco. Do not speculatively edit.

## 21. Verification I did before writing this spec

- Confirmed Rossella's cocktails run `1831a13e-12b4-42cf-ba90-c259f062d22c` row via Supabase REST: `workspace_id=null`, `workspace_context_pack_hash=null`, `launch_source="jobs-new"`, `author_model="claude-opus-4-7"`, completed in 24m44s
- Confirmed `BASQUIO_RESEARCH_PHASE_ENABLED` and `FIRECRAWL_API_KEY` are NOT set on Railway worker via `railway variables --service basquio-worker --kv`
- Confirmed `web_fetch_20260209` was in tools array for author + both revise loops via `deck_run_events` tool_call payloads
- Extracted Rossella's deck from the downloaded pptx. All eleven slides contain fabricated EUR market values and fabricated NIQ citations. Zero slides derived from her Q43-Q46 survey data
- Parsed her uploaded XLSX with openpyxl: 411 unique numeric cells, all between 0 and 750 (respondent counts) or between 0 and 1 (percentages as decimals). Zero EUR values, zero YoY growth, zero EMEA geography
- Pulled `working_papers.analysis_result` for her run: Opus fabricated sheet names `S02_EMEA_Overview`, `S03_Italia_Bridge`, `S04_Italia_Canali`, and more, none of which exist in her upload
- Pulled `working_papers.claim_traceability_author` for her run: the existing Haiku validator reported only one cosmetic issue (slide 12 empty body). Did not flag any fabricated numbers because it validated against Opus' fabricated workbook, not against Rossella's original upload
- Confirmed four survey/methodology knowledge files exist on disk but are not in `KNOWLEDGE_PACK_FILES`: `niq-cps-2023-template-extracted.md`, `niq-voice-of-the-client-extracted.md`, `niq-innovation-basics-extracted.md`, `niq-storymasters-module-1-extracted.md`
- Verified Port Louis retrospective at `/Users/marcodicesare/conductor/workspaces/basquio/port-louis/docs/specs/2026-04-24-session-nightmares-retrospective-up-to-a78fff5.md` argues for deterministic plan validators (§8.1-8.2) and final artifact QA (§8.5)
- Verified Anthropic Claude 4.6/4.7 prompting docs recommend XML-wrapped top-of-prompt rules for adherence and recommend grounded citations for hallucination reduction

## 22. Open points, none blocking

- Anthropic's `web_fetch_20260209` supports `allowed_domains` param. P0.2 intentionally does NOT use it to keep scope tight. Follow-up PR (not P0): when `webFetchMode === "enrich"`, populate `allowed_domains` from the workspace's `source_catalog_scrapes` trusted sources
- Port Louis §8.1-8.4 Layer A/B/C architecture (planner, validator, copywriter) is a bigger rework than P0. P0's plan-stage sheet name validator is Layer B's first step. Full Layer A/B/C comes later

End of spec.
