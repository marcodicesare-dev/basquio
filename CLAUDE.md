# Basquio — AI-native business intelligence deck generation

## North star
Basquio does the same level of analysis as a Claude Code chat. The model decides what to investigate and how to present it. Claude controls every pixel of the final artifact via code execution. No rendering pipeline between the model and the file.

## Architecture (V6 — March 23, 2026)
Single Claude API call with code execution, running on Railway + Vercel + Supabase:

1. **User uploads** Excel/CSV + brief on basquio.com (Vercel)
2. **API queues** `deck_run` with `status="queued"` in Supabase
3. **Railway worker** polls Supabase, claims queued runs, calls `generateDeckRun()`
4. **Claude code execution** — reads data with pandas, analyzes, generates PPTX via PPTX skill (PptxGenJS), generates PDF
5. **Visual QA** — uploads rendered PDF to Sonnet for the critique/export gate
6. **Publish** — uploads artifacts to Supabase Storage, publishes manifest

Key properties:
- Claude controls the full rendering via code execution + PPTX/PDF skills
- `container_upload` files cost 0 input tokens (files go to container disk, not context)
- `web_fetch` tool in tools array = free compute (no container charges)
- Railway worker has no timeout (unlike Vercel routes)
- Streaming API calls prevent Cloudflare 502 on long requests (>10 min)

## Development

```bash
pnpm install
pnpm qa:basquio        # type-check + context QA
npx tsc --noEmit       # type-check only
pnpm worker            # run Railway worker locally
pnpm test:code-exec    # smoke test against Claude API
```

After pushing to `main`, Vercel auto-deploys. The Railway worker is Git-connected, so deploy safety depends on committed `railway.toml` watch patterns and graceful shutdown behavior, not on manual clean-`HEAD` snapshot rituals.

## Key rules

### Token costs (CRITICAL)
- `container_upload` files cost 0 input tokens. NEVER put data summaries in the message text.
- Each `pause_turn` continuation re-sends FULL message history. Minimize continuations.
- Include `web_fetch_20260209` in tools for free code execution compute.
- Expected cost: roughly $3+/deck on Sonnet 4.6 with current code execution. If it materially exceeds $6.00, the run is likely off the rails.

### PPTX skill
The Anthropic PPTX skill uses PptxGenJS (Node.js). Do NOT instruct Claude to use python-pptx when the skill is loaded. Charts should be rendered as PNG images in Python (matplotlib/seaborn) and embedded in the deck.

### Streaming for long requests
Use `.stream()` + `.finalMessage()` for Claude API calls that may take > 10 minutes. Non-streaming requests get 502'd by Cloudflare.

### Railway worker
The worker (`scripts/worker.ts`) polls Supabase every 5s for `status="queued"` runs. It claims atomically, heartbeats via `updated_at`, starts shutdown handoff immediately on `SIGTERM`, and recovers stale runs stuck > 30 minutes. No Inngest needed.
- Railway production start command should invoke Node directly, not `pnpm worker`, so the worker process receives `SIGTERM` reliably.
- Railway production config should use focused `watchPatterns` so unrelated UI-only commits do not redeploy the worker service mid-run.
- Railway production config should set deployment overlap and drain windows long enough for shutdown handoff RPCs to complete.

### Data access
Evidence files are uploaded to Claude via Files API `container_upload`. Claude reads them via pandas/openpyxl in code execution. No preloading into memory.

### Security
Storage policies for artifacts scope access by org membership via `deck_runs` join. All PostgREST queries use `assertUuid()` to prevent operator injection. API read endpoints verify auth + tenancy.

## Package structure
- `packages/workflows/src/generate-deck.ts` — **THE deck generation pipeline**
- `packages/workflows/src/system-prompt.ts` — system prompt with cached static block
- `packages/workflows/src/rendered-page-qa.ts` — visual QA judge
- `packages/workflows/src/cost-guard.ts` — budget enforcement
- `packages/workflows/src/deck-manifest.ts` — manifest parsing
- `packages/data-ingest/` — streaming CSV/XLSX parsers
- `packages/template-engine/` — template profile interpretation
- `packages/scene-graph/` — slide archetypes + deck grammar
- `packages/types/` — shared Zod schemas + TypeScript types
- `apps/web/` — Next.js frontend + API routes
- `scripts/worker.ts` — Railway worker
- `scripts/test-code-exec.ts` — smoke test

## Environment variables
See `.env.example`. Critical: `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`.
Railway also needs: `BASQUIO_ANTHROPIC_TIMEOUT_MS=1800000`.
If `BASQUIO_WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS` is unset, the worker now assumes roughly 55 seconds of shutdown drain time to match Railway teardown settings.

## Supabase project
Project ID: `fxvbvkpzzvrkwvqmecmi`
Migrations: `supabase/migrations/`

## Hard-won rules (March 27-30, 2026) — DO NOT VIOLATE

### Anthropic execution contract
- Tool type: `code_execution_20250825` — DO NOT upgrade without smoke test
- Beta header: `code-execution-2025-08-25` — DO NOT change
- Canonical config lives in `packages/workflows/src/anthropic-execution-contract.ts`
- `code_execution_20260120` does NOT exist server-side as of March 28. The SDK has forward types.
- `context_management` (clear_tool_uses, compact) was REJECTED by the API on March 29. Do NOT use until Anthropic confirms support.

### Haiku execution contract (March 31, 2026 — 6 failed production runs to discover)
- **`code_execution` MUST be explicit in the tools array for Haiku.** The beta header only enables the API to accept the tool type. For Sonnet/Opus, `container.skills` implicitly enables code execution. For Haiku with no skills, you MUST pass `{type: "code_execution_20250825", name: "code_execution"}` in `tools`. Without this, `container_upload` blocks are rejected.
- **Haiku does NOT support `container.skills`.** API rejects with "container: skills can only be used when a code execution tool is enabled". Drop the `skills-2025-10-02` beta and do NOT pass `container.skills` for Haiku.
- **Haiku container param must be `undefined`, not `{}`.** An empty object `{}` causes the same "skills" error. Omit the field entirely on the first request; use `{id: containerId}` on continuations.
- **Haiku does NOT support programmatic tool calling.** `web_fetch` needs `allowed_callers: ["direct"]`.
- **Haiku does NOT support `effort` parameter.** `buildAuthoringOutputConfig()` returns `undefined`.
- **Haiku gets PptxGenJS via `npm install pptxgenjs`**, not via the PPTX skill. The author prompt includes a conditional fallback instruction.
- Docs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool

### Budget caps (April 12, model-aware)
- Opus: pre-flight $12.00, hard cap $18.00, cross-attempt cap $24.00.
- Sonnet: pre-flight $7.00, hard cap $10.00, cross-attempt cap $15.00.
- Haiku: pre-flight $3.00, hard cap $5.00, cross-attempt cap $8.00.
- Previous lower flat caps killed revise for Opus. The caps must be high enough to only catch genuine runaways, not normal operation.
- Budget caps have been the #1 source of "revise never runs" since March 28. DO NOT lower them without production evidence.

### Real cost model (March 30, 2026 — verified against Anthropic pricing docs)
- Anthropic Usage object has THREE disjoint input token fields: `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens` = total billed input.
- `input_tokens` EXCLUDES cached tokens. If you only read this field, you undercount by 2x.
- Each `pause_turn` continuation is a SEPARATE billed API call that re-sends the ENTIRE conversation.
- Code execution tool_use/tool_result blocks grow the conversation by 100-500K tokens per turn.
- Cache reads are cheap (0.1x base price) but grow QUADRATICALLY with continuations: 3 continuations on a code-exec run = 5M+ cache_read tokens = $1.50+ just for re-reading context.
- **The #1 cost lever is reducing pause_turn continuations.** 0 continuations = ~$0.80. 3 continuations = ~$2.50.
- Code execution compute is FREE when `web_fetch_20260209` is in tools (already included).
- Prompt caching: 5-min write = 1.25x base, 1-hour write = 2x base, read = 0.1x base. Max 4 explicit breakpoints per request.

### Phase timeouts
- Current production truth: local `author` and `revise` watchdog timeouts are disabled.
- The Anthropic client timeout is currently `60m`.
- Author legitimately takes 10-25 minutes for merged understand+author with code execution.
- Setting author watchdog below 25 minutes WILL kill healthy runs. Proven on March 28 (300s, 420s both killed runs).
- Stale recovery must look at active in-flight requests plus meaningful progress, not raw wall-clock age.

### Visual QA alignment
- The judge that blocks publish must also shape revise.
- Current production truth: critique and final export both use `claude-sonnet-4-6`.
- Do not reintroduce a weaker critique judge followed by a stricter export-only judge.
- Haiku for BOTH critiques is acceptable (same model at both stages) but not yet proven in production.

### Publish gate
- ONLY structural corruption blocks publish: `pptx_present`, `pdf_present`, `pptx_zip_signature`, `pdf_header_signature`, `slide_count_positive`, `pptx_zip_parse_failed`, `pdf_parseable`.
- Everything else (lint, visual QA score, contract violations) is ADVISORY, not blocking.
- A run that spent $1+ MUST ship artifacts. "Export failed" after 25 minutes is NEVER acceptable to a user.

### Revise architecture
- Revise MUST receive the rendered PDF as a `document` source with `base64` encoding so Claude can SEE what's broken.
- Revise should use a compact thread (synthetic summary of what was generated) NOT replay the full 150K+ author conversation.
- Research (Huang et al. ICLR 2024, ChartIR March 2026) proves: LLM self-correction without new visual information FAILS. The PDF is the new information that makes correction work.
- Revise should be slide-specific: list which slides to fix, forbid touching the rest.

### Narrative artifact architecture
- Narrative markdown MUST be generated INSIDE the author code execution turn, NOT as a separate post-hoc API call.
- Claude already has pandas loaded, analysis done, charts made. Writing a 2000-word narrative from that state is trivial.
- A separate API call that receives a stripped-down summary will ALWAYS produce shallow output.
- The author prompt should require `narrative_report.md` as a mandatory output file alongside deck.pptx, deck.pdf, deck_manifest.json.
- Target: 2000-3000 words with executive summary, methodology, detailed findings with caveats, and operational recommendations.

### Schema parsing
- Claude's output shape varies. Use `.passthrough()` on Zod objects for LLM output.
- Normalize/coerce fields instead of rejecting. A run that spent $1+ MUST NOT die on parseable-but-differently-shaped JSON.
- `analysis_result.json` frequently has schema violations (figureSize as string, missing chart.id). Salvage from manifest if parsing fails.

### Prompt engineering
- NEVER add "suppress output" or "compact output" instructions that could cause Claude to skip file generation. Proven regression on March 30.
- Any instruction that says "don't print" or "suppress" MUST be followed by "but you MUST still generate all required output files."
- "Finish in one turn" instructions reduce cost by eliminating continuations. Use them.
- Per-slide spatial constraints (figsize, maxCategories, card geometry) from slot-archetypes MUST be included in the author message.
- **Few-shot examples in the system prompt are the #1 quality lever.** Proven on March 30: adding 2 concrete PptxGenJS code examples (exec-summary with filled SCQA + chart slide with matplotlib) raised quality from 6/10 to 7.4/10 in one commit (fda7621). More examples = better quality. Rules without examples don't work.
- The author prompt should have ~50 lines of instructions + 2-5 concrete examples, NOT 130 lines of rules with 0 examples.
- Examples must show: exact PptxGenJS calls with real coordinates matching archetypes, matplotlib code with dark-background styling, SCQA body with real sentences not empty labels, charts with highlight color and source note padding.

### SQL functions
- Always qualify column references in PL/pgSQL (use `table.column`, not bare `column`)
- FK ordering: INSERT new row BEFORE updating old row's FK reference to it

### Commit discipline
- Max 3 pipeline commits per day
- Each commit validated with 1 production run before next commit
- No "fix" commit without identifying which prior commit introduced the regression
- NEVER ship SDK type-level features without verifying the API actually accepts them (context_management, code_execution_20260120 both failed)

### Narrative artifact architecture
- Narrative markdown MUST be generated INSIDE the author code execution turn, NOT as a separate post-hoc API call.
- Claude already has pandas loaded, analysis done, charts made. Writing a 2000-word narrative from that state is trivial.
- A separate API call that receives a stripped-down summary will ALWAYS produce shallow output.
- The author prompt should require `narrative_report.md` as a mandatory output file alongside deck.pptx, deck.pdf, deck_manifest.json.
- Target: 2000-3000 words with executive summary, methodology, detailed findings with caveats, and operational recommendations.

### Proven quality levers (ranked by impact, March 30)
1. **Few-shot examples in system prompt** — 6/10 → 7.4/10 in one commit. THE highest-impact change.
2. **Per-slide spatial budgets from archetypes** — prevents wrong chart sizes, enforces slot constraints.
3. **Mandatory archetype selection** — prevents freeform addShape/addText that causes overlaps.
4. **In-turn narrative markdown generation** (`narrative_report.md`) — 320-word stubs → 1,688-word real reports.
5. **Revise with rendered PDF** — Claude can SEE what's broken (vs blind text-only critique).

### Cost truth (March 31, verified against Anthropic billing)
- Cost tracking was broken before `03325fb`, so the old $0.76-$1.53 numbers were undercounted. Real cost has always been about $3+/deck on Sonnet 4.6.
- Current working assumption: baseline Sonnet cost is around $3.40/deck, not sub-$2.
- 59% of cost ($2.00) is cache_read_input_tokens from in-turn auto-caching during code execution. This is UNCONTROLLABLE per-request — it happens inside a single API call as code execution rounds accumulate context.
- 0 pause_turn continuations does NOT reduce cost to $1 because the in-turn cache reads dominate.
- The same run on Haiku 4.5 would cost ~$1.13. This is the only path to <$1.50/deck without architecture changes.
- Code execution compute is FREE (web_fetch_20260209 in tools).
- Budget guards: pre-flight cap = $4.50, hard cap = $6.00. Anything lower starves revise.

### Current production baseline (run 47da3b5e, March 30 evening)
- Visual quality: 7.4/10 (exec summary 8/10, charts 7-8/10, recommendations 7/10)
- Narrative artifact quality: 6/10 (1,688 words, real methodology + findings + recommendations, but below 2K target)
- Cost: $3.42 (Sonnet 4.6, 0 continuations, cache-aware tracking)
- Reliability: completed, delivery "reviewed", QA passed
- Time: ~20 min
- Slide count: 10 (canonical, respected)

### Anthropic prompting best practices (from official docs, March 30)
- "Show your prompt to a colleague with minimal context. If they'd be confused, Claude will be too."
- Claude 4.6 defaults to high effort. Set `effort: "medium"` for most workloads to control token usage.
- Few-shot examples inside `<example>` tags dramatically improve accuracy and consistency. Use 3-5 examples.
- XML tags reduce misinterpretation. Wrap instructions, context, examples in separate tags.
- "Be specific about desired output format. If you want above-and-beyond behavior, explicitly request it."
- For code execution: "Complete ALL work in a single session. Do not end the turn until all required files are attached."
- Avoid over-prompting that causes overtriggering. "CRITICAL: You MUST" language from older models causes Claude 4.6 to overreact.
- `max_tokens: 64000` recommended at medium/high effort to give room for thinking + output.
- Adaptive thinking (`thinking: { type: "adaptive" }`) with `effort: "medium"` replaces extended thinking with budget_tokens.

### Anti-patterns (proven failures from March 27-30)
- Adding "hardening" commits that create new crash modes (13 "harden" commits, most introduced regressions)
- Fixing cost tracking without reducing cost (you see the real bill but it's still $2.50)
- Post-hoc narrative generation from stripped context (produces 320-word stubs)
- Stdout suppression instructions that kill file generation
- Phase watchdog timeouts below 25 minutes for author
- context_management API features that don't exist server-side
- Separate "enriched" narrative builders that produce worse output than the original

## Memory & learnings
Read `memory/MEMORY.md` for the current index. Critical files:
- `memory/canonical-memory.md` — canonical product, runtime, and process truth
- `memory/march28-48h-forensic-learnings.md` — March 27-28 forensic truth source
- `rules/canonical-rules.md` — execution contract and anti-drift rules
- `packages/workflows/src/anthropic-execution-contract.ts` — canonical Anthropic tool/beta/skill contract

### 72-hour forensic summary (March 28-30, 2026)
- 60+ commits in 72 hours. $50+ in API costs. Net quality improvement: marginal until examples were added.
- The pattern: fix one thing → break another → fix that → break something else.
- What actually works: V6 code execution + PPTX skill. When Claude gets good constraints AND concrete examples, it produces consulting-grade output.
- What keeps failing: downstream recovery/hardening/salvage infrastructure that adds complexity without improving the happy path.
- **March 30 breakthrough (commit fda7621):** Adding 2 few-shot PptxGenJS examples to the system prompt raised visual quality from 6/10 to 7.4/10 in a single commit. This is the first proven quality improvement in 72 hours. The examples fixed: empty SCQA labels, overlapping scenario cards, chart-split layout issues. The architecture (one Claude turn with PPTX skill) is correct — the missing ingredient was showing Claude what good output looks like, not telling it what to avoid.
- The fundamental insight: make the happy path succeed, don't catch every failure mode.
- **March 30 breakthrough (commit fda7621):** Adding 2 few-shot PptxGenJS examples to the system prompt raised visual quality from 6/10 to 7.4/10 in a single commit. This is the first proven quality improvement in 72 hours. The examples fixed: empty SCQA labels, overlapping scenario cards, chart-split layout issues. The architecture (one Claude turn with PPTX skill) is correct — the missing ingredient was showing Claude what good output looks like, not telling it what to avoid.

### Proven quality levers (ranked by impact, March 30)
1. **Few-shot examples in system prompt** — 6/10 → 7.4/10 in one commit. THE highest-impact change.
2. **Per-slide spatial budgets from archetypes** — prevents wrong chart sizes, enforces slot constraints.
3. **Mandatory archetype selection** — prevents freeform addShape/addText that causes overlaps.
4. **In-turn narrative markdown generation** (`narrative_report.md`) — 320-word stubs → 1,688-word real reports.
5. **Revise with rendered PDF** — Claude can SEE what's broken (vs blind text-only critique).

### Cost truth (March 31, verified against Anthropic billing)
- Cost tracking was broken before `03325fb`, so the old $0.76-$1.53 numbers were undercounted. Real cost has always been about $3+/deck on Sonnet 4.6.
- Current working assumption: baseline Sonnet cost is around $3.40/deck, not sub-$2.
- 59% of cost ($2.00) is cache_read_input_tokens from in-turn auto-caching during code execution. This is UNCONTROLLABLE per-request — it happens inside a single API call as code execution rounds accumulate context.
- 0 pause_turn continuations does NOT reduce cost to $1 because the in-turn cache reads dominate.
- The same run on Haiku 4.5 would cost ~$1.13. This is the only path to <$1.50/deck without architecture changes.
- Code execution compute is FREE (web_fetch_20260209 in tools).
- Budget guards: pre-flight cap = $4.50, hard cap = $6.00. Anything lower starves revise.

### Current production baseline (run 47da3b5e, March 30 evening)
- Visual quality: 7.4/10 (exec summary 8/10, charts 7-8/10, recommendations 7/10)
- Narrative artifact quality: 6/10 (1,688 words, real methodology + findings + recommendations, but below 2K target)
- Cost: $3.42 (Sonnet 4.6, 0 continuations, cache-aware tracking)
- Reliability: completed, delivery "reviewed", QA passed
- Time: ~20 min
- Slide count: 10 (canonical, respected)

### Anthropic prompting best practices (from official docs, March 30)
- "Show your prompt to a colleague with minimal context. If they'd be confused, Claude will be too."
- Claude 4.6 defaults to high effort. Set `effort: "medium"` for most workloads to control token usage.
- Few-shot examples inside `<example>` tags dramatically improve accuracy and consistency. Use 3-5 examples.
- XML tags reduce misinterpretation. Wrap instructions, context, examples in separate tags.
- "Be specific about desired output format. If you want above-and-beyond behavior, explicitly request it."
- For code execution: "Complete ALL work in a single session. Do not end the turn until all required files are attached."
- Avoid over-prompting that causes overtriggering. "CRITICAL: You MUST" language from older models causes Claude 4.6 to overreact.
- `max_tokens: 64000` recommended at medium/high effort to give room for thinking + output.
- Adaptive thinking (`thinking: { type: "adaptive" }`) with `effort: "medium"` replaces extended thinking with budget_tokens.
