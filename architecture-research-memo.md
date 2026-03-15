# Basquio Architecture Research Memo — Definitive Edition

**Date:** 2026-03-15
**Scope:** Redesigning Basquio from pipeline-wrapper to AI-native deck generation
**Sources:** Three independent research agents auditing Basquio code + primary docs from OpenAI, Anthropic, Vercel AI SDK

---

## Executive Summary

Basquio is not an AI-native analysis system. It is a deterministic report pipeline with LLM-assisted planning stages wrapped around it. That is explicit in the product doctrine: *"The AI does not generate final slides directly"* and *"LLMs produce contracts, not final document syntax."* `docs/vision.md:64`, `rules/canonical-rules.md:13`

The code matches the doctrine. The only model primitive in Basquio is `generateObject()` — one-shot structured JSON generation with strict schemas and no tool loop. `packages/intelligence/src/model.ts:19,49`

The result: Basquio asks the model to fill schemas, then replaces actual analysis, charting, slide authoring, and export with deterministic transforms, heuristics, canned block builders, and brittle runtime recovery. That architecture suppresses model capability instead of unlocking it. `packages/intelligence/src/metrics.ts:66`, `packages/intelligence/src/analytics.ts:30`, `packages/intelligence/src/slides.ts:66,339,727`

**This is why a plain Claude Code chat outperforms Basquio.** In a chat, the model reads your files, reasons iteratively over the data, critiques its own work, and generates narrative content with full creative latitude. In Basquio, the model fills slots in predetermined schemas, its output is sanitized and overridden by deterministic code, and if AI fails at any stage, a hardcoded fallback silently takes over — producing lifeless template output that the user sees as the final product.

**Recommended architecture:** Keep deterministic parsing/rendering/QA, but rebuild the core as a Basquio-owned agent runtime over real data and real template state. Use Vercel AI SDK v6 `ToolLoopAgent` as the TypeScript orchestration layer, OpenAI Responses API as the primary inference provider, Anthropic Claude for authoring/critique phases, and Inngest as the durable outer workflow. Define canonical state objects (DeckRun, EvidenceWorkspace, AnalysisNotebook, DeckSpecV2, ArtifactManifest) that replace the current planner chain.

---

## 1. Current Basquio Architecture Audit

### 1.1 Pipeline Structure

The system is a **13-stage sequential pipeline** orchestrated by Inngest durable functions (`packages/workflows/src/index.ts`). Each stage is wrapped in `runStage()` (L150-187) which handles persistence, heartbeating, and error recovery.

| # | Stage | AI? | What It Actually Does |
|---|-------|-----|-----------------------|
| 1 | Intake/profiling | No | Parse Excel/CSV, build column metadata |
| 2 | Package semantics | **Yes** (structured output) | AI interprets what the dataset represents |
| 3 | Metric planning | **Yes** (structured output) | AI decides what to compute — then `sanitizeMetricPlan()` drops anything referencing non-existent columns |
| 4 | Analytics execution | No | Pure computation engine — aggregations, joins, distributions |
| 5 | Insight ranking | **Yes** (structured output) | AI ranks/narrates findings — then deterministic code overrides confidence scores and drops invalid evidence refs |
| 6 | Story architecture | **Yes** (structured output) | AI plans narrative arc — deterministic fallback if it fails |
| 7 | Outline architecture | No | Deterministic conversion of story sections to report structure |
| 8 | Design translation | No | Deterministic template interpretation |
| 9 | Slide architecture | **Yes** (structured output) | AI plans slide layouts — then deterministic validation and layout scoring override its choices |
| 10 | Deterministic validation | No | Referential integrity checks, numeric assertion verification |
| 11 | Semantic critique | **Yes** (structured output) | Cross-model review — the only genuinely valuable AI quality check |
| 12 | Rendering | No | PPTX/PDF generation |
| 13 | QA/delivery | No | Checksum, page count verification, storage |

**Source:** `packages/workflows/src/index.ts` L190-756

### 1.2 The AI Abstraction Layer

Every AI call in the entire system goes through a single function: `generateStructuredStage()` in `packages/intelligence/src/model.ts` (L49-63).

```typescript
// This is ALL the AI Basquio ever does:
generateObject({
  model: resolvedModel,
  schema: zodSchema,          // strict JSON schema
  prompt: inlineStringPrompt, // concatenated strings, no versioning
  temperature: 0.2,           // hardcoded low creativity
  experimental_strictJsonSchema: true,
})
```

**No tool use. No streaming. No free-text generation. No iterative reasoning within a stage.**

Temperature is 0.2 across the board (except OpenAI reasoning models where it's omitted). Prompts are inline string concatenations with no separate files, no versioning, no templating. The `promptVersion` field exists in the trace schema but is always `"v1"`.

Model resolution (`model.ts` L102-161): Each stage has its own env var (e.g., `BASQUIO_METRIC_MODEL`). Provider is inferred from name prefix ("claude" → anthropic, else openai). Cross-provider fallback if `BASQUIO_ALLOW_MODEL_FALLBACK=true`. Defaults: `gpt-5-mini` for metrics/insights/slides, `claude-sonnet-4-6` for story/semantics.

OpenAI's `strictJsonSchema: true` mode (L59) means schemas must be fully deterministic — no `anyOf`, no optional discriminated unions. This limits the expressiveness of what AI can output.

### 1.3 What's "Agentic"?

**Only one thing:** The orchestrator-level revision loop (`packages/workflows/src/index.ts` L325-629). It runs stages 3-12 up to `maxPlanAttempts = 3` times. If semantic critique or validation identifies issues, it backtracks to the earliest problematic stage (priority: metrics > insights > story > design > slides) and re-runs everything downstream with `reviewerFeedback` appended.

The semantic critique (L557-582) deliberately uses a *different model provider* than the primary generation stages — if the main pipeline used OpenAI, the critic uses Anthropic, and vice versa. This cross-model adversarial pattern is one of the few genuinely good ideas in the architecture.

Individual AI calls are one-shot schema fills. No caching of AI results between attempts — if a revision backtracks to metrics, insight ranking, story, and slides are all regenerated from scratch even if the revision feedback only affects metrics.

### 1.4 The Safety Net That Kills Intelligence

Every AI output has a **deterministic override**:

- **Metric planning** (`metrics.ts` L158-206): `sanitizeMetricPlan()` aggressively filters any AI-planned metric referencing non-existent files, columns, joins, or relationships. If all metrics are dropped, `buildFallbackMetricPlan()` (L208-382) takes over with templated aggregations (row counts, distinct counts, sums, averages, deltas, ranks, shares, ratios based on column roles).

- **Insight ranking** (`insights.ts` L115-152): Validates evidence refs, drops insights citing invalid evidence, **overrides AI confidence scores** with a deterministic `scoreEvidence()` calculation.

- **Slide architecture** (`slides.ts` L163-179): Validates section/insight references. Layout binding (L383-522) uses a deterministic scoring system that overrides AI layout choices — each template layout is scored against the block composition of each slide to find the "best fit."

- **Retail hardcoding** (`metrics.ts` L384-598, `insights.ts` L216-456): **~455 lines of Italian-language, pet-care-market-specific hardcoded analysis.** Brand names ("AFFINITY", "ULTIMA", "TRAINER", "ONE"), market segments (MERCATO_ECR4, COMPARTO_ECR2, FORNITORE, MARCA), and Italian business narratives are all hardcoded. The function `isRetailMarketDataset()` detects this data shape and routes to a completely separate code path that builds ~30 metrics and 11 specific insights. This creates a two-tier quality system: retail pet care packages get curated domain intelligence; everything else gets generic fallbacks that are notably weaker.

**Inference:** The system was designed with zero trust in AI output. Every AI decision is validated and can be silently replaced. The user never knows when they're seeing AI-generated analysis vs. template fallback. This is why the output feels lifeless — often, it *is* the fallback.

### 1.5 Context Window Pressure

The insight ranking and story architecture stages receive `JSON.stringify(analyticsResult, null, 2)` — the entire analytics output including all metrics, derived tables, and evidence refs as serialized JSON. For large workbooks, this can consume a significant portion of the context window, leaving less room for the model to reason. The model never gets to query for specific slices — it gets the entire dump.

**Source:** `intelligence/src/insights.ts` L82-113, `intelligence/src/story.ts` L64-101

### 1.6 The Execution Tangle

Job creation fires Inngest, schedules a 15-second fallback execute dispatch, and polling can later trigger additional recovery dispatches. Execution can also run inside a request route with `maxDuration = 300`. This is an operationally incoherent launch model with overlapping kickoff/recovery paths.

**Source:** `apps/web/src/app/api/generate/route.ts:19,72`, `apps/web/src/app/api/jobs/[jobId]/execute/route.ts:10,61`, `apps/web/src/app/api/jobs/[jobId]/route.ts:33`, `packages/workflows/src/persistence.ts:104`

---

## 2. Failure Analysis Tied to Code

### Failure: "Initial execution can hang and time out for 300s before stale recovery"

**Root cause:** The pipeline is synchronous and sequential. If any single `generateObject()` call stalls, the entire pipeline blocks. Stale detection in `run-status.ts` (L146-147) only triggers after 45 seconds of no checkpoints. But the deeper issue is the execution tangle: job creation can fire Inngest, schedule a fallback, and execution can run inside a request route with `maxDuration = 300`. Recovery dispatches compete with live runs.

**Source:** `workflows/src/index.ts` — Inngest `step.run()` wrapping, `apps/web/src/app/api/generate/route.ts:72`, `apps/web/src/app/api/jobs/[jobId]/execute/route.ts:61`

### Failure: "Revision-loop recompute has stalled in metric planning / deterministic analytics"

**Root cause:** Metric replanning and deterministic analytics rerun inside the bounded revision loop rather than via resumable task boundaries. When the revision loop backtracks, it re-runs everything from the backtrack point monolithically. `packages/workflows/src/index.ts:327,349`

### Failure: "Artifacts persisted while run still marked failed"

**Root cause:** Artifacts are persisted *before* post-render QA, and the artifact route serves them based on durable existence rather than terminal job status. `packages/workflows/src/index.ts:731,760,799`, `apps/web/src/app/api/artifacts/[jobId]/[kind]/route.ts:27`

### Failure: "PDF QA failed with 'Expected 12 pages and resolved 28'"

**Root cause (confirmed locally):** The PDF has 28 pages and the PPTX has 12 slides. The PDF renderer is not a slide-faithful renderer — it builds free-flow HTML sections with `min-height`, grid content, and `page-break-after`, so text overflow spills into additional pages. The AI plans in abstract slide units; the PDF renderer works in physical page units; no feedback loop exists to reconcile them.

**Source:** `packages/render-pdf/src/index.ts:35,64,117`, `packages/workflows/src/index.ts:950`

**Design bug:** PPTX is slide-like and PDF is document-like. They share a plan but consume it through fundamentally different rendering models. This split is a rendering design bug, not just a QA check issue.

### Failure: "UI progress has been incoherent and misleading"

**Root cause:** Progress is partly synthetic. `run-status.ts` (L318-358) computes from stage weights — running stages get 55% credit, failed stages get 90%. Steps can be synthesized from stale summaries (L397-418), and fallback progress can show 96% even when the live run is gone. Combined with the 45-second stale detection threshold, the user sees contradictory indicators.

**Source:** `apps/web/src/lib/run-status.ts:122,263,268,284,397`

---

## 3. Why Claude Code Chat Outperforms Basquio

### 3.1 Iterative Reasoning vs. One-Shot Schema Filling

In a Claude Code chat, the model:
1. Reads the input files directly
2. Explores the data structure, asks itself questions
3. Decides what analysis to do — tries things, backtracks
4. Executes analysis (using code execution tools)
5. Reviews its own results, sees numbers
6. Decides what story to tell based on what it found
7. Writes narrative content with full creative control
8. Critiques and revises — multiple passes

In Basquio, the model:
1. Receives a serialized dataset profile → outputs a metric plan schema → **done**
2. Receives precomputed analytics results → outputs an insight ranking schema → **done**
3. Receives insights → outputs a story arc schema → **done**
4. Receives story → outputs slide blueprints → **done**

Each step is a single `generateObject()` call. The model cannot ask follow-up questions, request more data, try a different analytical approach, or iterate on its own output within a stage. It mostly sees summarized JSON and returns schemas. `packages/intelligence/src/model.ts:49`, `intelligence/src/insights.ts:93`, `intelligence/src/story.ts:72`, `intelligence/src/slides.ts:96`

### 3.2 Over-Constraining the Model

Basquio's Zod schemas dictate exactly what the model can output. The product doctrine explicitly suppresses direct AI authorship: `docs/vision.md:64`. The model cannot:
- Add an insight category the schema doesn't define
- Suggest a visualization type the template doesn't support
- Write prose that doesn't fit into a `body` or `bullets` block
- Express uncertainty or recommend additional analysis
- See the actual data — only serialized profiles and precomputed summaries

The strict schemas + temperature 0.2 + deterministic overrides create a system where the AI's role is reduced to **choosing from pre-defined options**, not generating original analysis.

### 3.3 Silent Fallback to Templates

When AI output is sanitized away, the system falls through to deterministic fallbacks that produce generic, templated content. The user never knows this happened. The retail hardcoding path produces Italian-language content that may be technically correct but lacks analytical depth. The generic fallback produces English text that reads like data labels rather than business insights.

### 3.4 The Non-Negotiable Design Rule (What Should Change)

**The model should decide:**
- what to inspect
- what to compute
- what matters
- what the headline is
- how slides should argue the case
- how to revise after seeing previews

**Tools should decide:**
- what numbers are true
- what joins are valid
- what chart data is valid
- what the template actually supports
- whether the export passed QA

That keeps determinism where it helps and removes it from where it kills quality. Right now Basquio does the opposite: determinism in the middle, intelligence at the edges.

---

## 4. Redesign Options Comparison

### Option A: OpenAI Responses API + Basquio-Owned Loop

**What it is:** OpenAI's successor to Chat Completions, positioned as the agentic API. `POST /v1/responses` with tool use, MCP, state, and background mode for long-running tasks. — [Source: Responses vs Chat Completions](https://developers.openai.com/api/docs/guides/migrate-to-responses), [Responses API](https://developers.openai.com/api/docs/guides/responses)

**Key capabilities:**
- **Agentic by default:** Model can call multiple tools within a single API request, executing built-in tools (web_search, file_search, code_interpreter, shell) and continuing reasoning before returning.
- **Native file ingestion:** Pass Excel/CSV/PDF directly as `input_file` items (up to 50MB per file, 50MB total). Spreadsheets parsed up to 1,000 rows/sheet with model-generated summary. — [Source: File Inputs Guide](https://developers.openai.com/api/docs/guides/file-inputs)
- **Stateful context:** `store: true` + `previous_response_id` for lightweight server-managed chaining. Or `conversation_id` for named server-side conversations.
- **Structured outputs:** `text.format` with JSON Schema, guaranteed schema adherence. — [Source: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- **MCP support:** First-class `{"type": "mcp", "server_url": "..."}` in tools array. — [Source: ibid]
- **Background mode:** For long-running agent tasks.
- **40-80% better prompt cache utilization** vs. Chat Completions.
- **3% better on SWE-bench** vs. Chat Completions (same prompt).

**For custom function tools**, you still run a manual loop: call API → check for `function_call` items → execute locally → append `function_call_output` → call again.

**Verdict:** Best reliability/control choice for the inference layer. You own checkpoints, replay, deck state, failure semantics, and eval instrumentation. More engineering than an SDK wrapper but fewer hidden opinions.

### Option B: OpenAI Agents SDK

**What it is:** `openai-agents` — a higher-level framework on top of Responses API with multi-agent orchestration, sessions, tracing, and guardrails. — [Source: Agents SDK docs](https://openai.github.io/openai-agents-python/)

**Key capabilities:**
- **Runner loop:** Call LLM → if tool calls, execute and loop → if handoff, switch agent → if final output, done. `max_turns` cap.
- **Multi-agent orchestration:** Handoffs (decentralized, model picks which agent to delegate to) and agents-as-tools (centralized, manager retains control). — [Source: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- **Built-in tracing:** Auto-traces agent runs, LLM generations, tool calls, handoffs. Sends to OpenAI Traces dashboard + 20+ integrations (Langfuse, Datadog, W&B). — [Source: Tracing](https://openai.github.io/openai-agents-python/tracing/)
- **Guardrails:** Input/output validation that runs in parallel with agent execution.
- **Session management:** SQLite, SQLAlchemy, Redis, or server-managed.
- **Non-OpenAI models** via `LitellmModel`.
- **Durable execution** via Temporal, Restate, DBOS.

**Weaknesses:**
- **Python-first.** JS/TS SDK exists but less mature. Basquio is TypeScript/Next.js.
- Locked into OpenAI's orchestration opinions.
- Overlaps with Inngest (which Basquio already uses for durable execution).

**Verdict:** Good inner runtime if you want faster agent ergonomics. Should not become the durable product control plane — Basquio still needs its own persisted state machine. Use it only if it speeds up implementation of sessions/tracing.

### Option C: Vercel AI SDK v6 `ToolLoopAgent`

**What it is:** Vercel's TypeScript-native AI framework. **v6 is stable** (current: v6.0.97, went through 169 beta releases before stable). The `ToolLoopAgent` class provides agent loops with multi-step tool use. — [Source: AI SDK Agents](https://ai-sdk.dev/docs/agents/building-agents), [AI SDK Core](https://ai-sdk.dev/docs/ai-sdk-core/overview)

**Key capabilities:**
- **`ToolLoopAgent` class:** Model + tools + loop. `agent.generate()` (full result) or `agent.stream()` (streaming). Default `stopWhen: stepCountIs(20)`.
- **Multi-provider:** 24 official providers including `@ai-sdk/openai` and `@ai-sdk/anthropic`. `LanguageModelV3` spec. `wrapProvider()` for middleware. `createProviderRegistry()` for multi-provider setups. — [Source: Providers](https://ai-sdk.dev/docs/foundations/providers-and-models)
- **Structured output (v6):** `generateObject`/`streamObject` are **deprecated**. New API: `generateText({ output: Output.object({ schema }) })`. Also `Output.array()`, `Output.choice()`, `Output.json()`. — [Source: Structured Data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- **Tool use:** `tool()` helper with Zod schemas and async `execute`. Multi-step via `stopWhen`. `prepareStep` callback for dynamic per-step model/tool swapping. `needsApproval` for human-in-the-loop.
- **Streaming:** `agent.stream()` + `createAgentUIStreamResponse()` for Next.js route handlers.
- **Lifecycle callbacks:** `onStepFinish`, `onFinish`, `experimental_onStart`, `experimental_onToolCallStart/Finish`.
- **MCP:** Via `@ai-sdk/mcp` package (experimental, `experimental_createMCPClient`).

**Key v6 breaking changes from v5:**
- `maxSteps` → `stopWhen: stepCountIs(N)`
- `generateObject` → `generateText({ output: Output.object() })`
- `system` → `instructions` (agent constructor)
- `Agent` → `BasicAgent` → `ToolLoopAgent` (renamed during beta)
- Zod peer dependency: `^3.25.76 || ^4.1.8`
- Provider spec v2 → v3

**Weaknesses:**
- Single-agent loop only — no multi-agent handoffs (compose yourself)
- Many APIs still `experimental_` prefixed
- No built-in tracing dashboard
- MCP support experimental

**Verdict:** Best TypeScript fit for Basquio. Same language, same framework ecosystem (Next.js), multi-provider, compatible with Inngest. The `ToolLoopAgent` is exactly the primitive Basquio needs.

### Option D: Anthropic Claude Tool Use (Direct)

**What it is:** Claude Messages API with tool use, extended thinking, prompt caching, and structured outputs. — [Source: Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview), [Extended Thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)

**Key capabilities:**
- **Extended thinking with interleaved tool use:** Claude can reason deeply *between* each tool call. Opus 4.6: automatic with adaptive thinking. Up to 128k output tokens. This is the closest to "how Claude Code chat works." — [Source: ibid]
- **1M token context** (Opus 4.6) — ingest entire document corpora.
- **Prompt caching:** Explicit `cache_control` with 5m (default) or 1h TTL. Cache hits = 0.1x base input price = **90% cost reduction**. Hierarchical invalidation: tools → system → messages. Minimum 4096 tokens for Opus 4.6. — [Source: Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- **Structured outputs:** `strict: true` on tools + `output_config.format` with JSON Schema. Constrained decoding guarantees valid JSON. Limited schema subset (no `anyOf`, `$ref`, `minimum`/`maximum`). — [Source: Structured Outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs)
- **Parallel tool use:** Multiple `tool_use` blocks in one response.
- **Server tools:** `web_search_20250305`, `web_fetch_20250305` execute on Anthropic infrastructure.

**Key constraints:**
- Extended thinking incompatible with forced tool use (`tool_choice: "any"`) — must use `"auto"`.
- Thinking blocks include cryptographic `signature` that must be preserved across tool-call turns.
- Summarized thinking on Claude 4+ (you're billed for full, shown the summary).

**Verdict:** Best model quality for analysis and prose. Worth benchmarking because your Claude Code result was demonstrably better. But not worth making the primary system architecture unless you intentionally choose Anthropic as the sole platform. Better to access Claude through AI SDK v6's `@ai-sdk/anthropic` provider — get the model quality without building your own orchestration. Provider choice should be decided by evals, not ideology.

### Comparison Table

| Criterion | A: OpenAI Responses | B: OpenAI Agents SDK | C: AI SDK v6 | D: Claude Direct |
|-----------|:-------------------:|:--------------------:|:------------:|:----------------:|
| Language fit (TS) | Medium | **Poor** (Python-first) | **Excellent** | Medium |
| Multi-provider | No | Via LiteLLM | **Yes** (24 providers) | No |
| Agent loop | Manual (custom only) | **Built-in** | **Built-in** (`ToolLoopAgent`) | Manual |
| Multi-agent | No | **Yes** (handoffs) | No (compose yourself) | No |
| Structured output | Yes (`text.format`) | Yes (`output_type`) | **Yes** (v6 `Output`) | Yes (`output_config`) |
| File ingestion | **Native** (`input_file` 50MB) | Via Responses API | Via message parts | Via content blocks |
| Tracing | External | **Built-in** (20+ integrations) | External | External |
| Streaming | Yes | Yes | **Yes** (Next.js helpers) | Yes |
| MCP | **Native** (hosted + remote) | **Native** (4 transports) | Experimental (`@ai-sdk/mcp`) | **Native** (MCP creator) |
| Extended thinking | No (reasoning models separate) | No | Via provider | **Yes** (interleaved with tools) |
| Prompt caching | Automatic (50% savings) | Via Responses | Via provider | **Explicit** (90% savings, user-controlled) |
| Background mode | **Yes** | Via durable integrations | Via Inngest | No |
| Inngest compat | Medium | Low (overlaps) | **High** | Medium |
| Migration effort | High | **Very high** | **Medium** | High |

---

## 5. Recommended Architecture

### The Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Orchestration** | Vercel AI SDK v6 `ToolLoopAgent` | TypeScript-native, multi-provider, `stopWhen` loop control, lifecycle callbacks, Next.js streaming |
| **Durable execution** | Inngest | Already in the codebase, checkpoint/recovery, step-level retries |
| **Primary inference (analysis)** | OpenAI `gpt-5` via `@ai-sdk/openai` | Strong tabular reasoning, native file ingestion via Responses API |
| **Primary inference (authoring)** | Claude `claude-opus-4-6` via `@ai-sdk/anthropic` | Superior prose, extended thinking with interleaved tool use, 1M context |
| **Cross-model critique** | Opposite provider from author | Adversarial quality check — keep the current architecture's best idea |
| **Tracing** | Langfuse + Inngest dashboard + OpenTelemetry | LLM call tracing, durable function monitoring, distributed tracing |
| **State** | Supabase (existing) | Canonical state objects persisted per job |

### 5.1 Canonical State Objects

Replace the current planner chain (`planMetrics` → `computeAnalytics` → `rankInsights` → `planStory` → `planSlides`) with persistent state objects that the agent builds incrementally:

| Object | Purpose | Replaces |
|--------|---------|----------|
| **DeckRun** | One durable job record with checkpoints, retries, replay, and event history. The state machine. | Current job row + synthetic run-status |
| **EvidenceWorkspace** | Normalized uploaded files + extracted text/tables + brand/template assets + support docs | Current intake/profiling stage output |
| **AnalysisNotebook** | Every tool call, query result, evidence ref, chart dataset, and reasoning checkpoint — persisted with stable IDs | Current analytics result blob |
| **DeckSpecV2** | Working deck state, slide by slide: claims, evidence refs, chart intents, copy, layout constraints, preview refs, QA status | Current slide blueprints + materialized slides |
| **ArtifactManifest** | Only published after export + QA pass | Current artifact persistence (which races with status) |

**Source for replacement:** `packages/workflows/src/index.ts` L254-760

### 5.2 Target Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Inngest Durable Function (DeckRun state machine)        │
│                                                           │
│  Step 1: NORMALIZE                                        │
│  ├─ Parse files into EvidenceWorkspace (deterministic)    │
│  ├─ Extract tables, text, images                          │
│  └─ Parse template + brand tokens                         │
│                                                           │
│  Step 2: UNDERSTAND                                       │
│  ├─ ToolLoopAgent("analyst")                              │
│  ├─ Model: gpt-5 via @ai-sdk/openai                      │
│  ├─ Tools:                                                │
│  │   - list_files() → file inventory                      │
│  │   - describe_table(file, sheet) → column metadata      │
│  │   - sample_rows(file, sheet, n) → sample data          │
│  │   - query_data(file, columns, filter, groupBy, agg)    │
│  │   - compute_metric(spec) → value + evidence ref        │
│  │   - read_support_doc(path) → extracted text            │
│  ├─ stopWhen: stepCountIs(30)                             │
│  ├─ All tool results persisted to AnalysisNotebook        │
│  └─ Output: AnalysisReport (structured via Output.object) │
│                                                           │
│  Step 3: AUTHOR                                           │
│  ├─ ToolLoopAgent("author")                               │
│  ├─ Model: claude-opus-4-6 via @ai-sdk/anthropic          │
│  ├─ Tools:                                                │
│  │   - lookup_evidence(id) → evidence detail              │
│  │   - query_data(...) → validate claims against data     │
│  │   - inspect_template() → available layouts + regions   │
│  │   - inspect_brand_tokens() → colors, fonts, logos      │
│  │   - build_chart(type, data, axes, style) → chart ID    │
│  │   - write_slide(pos, layout, content) → slide preview  │
│  │   - render_deck_preview() → full deck thumbnail strip  │
│  ├─ stopWhen: stepCountIs(50)                             │
│  ├─ Agent builds DeckSpecV2 incrementally                 │
│  └─ Output: DeckSpecV2 (structured)                       │
│                                                           │
│  Step 4: CRITIQUE                                         │
│  ├─ ToolLoopAgent("critic")                               │
│  ├─ Model: opposite provider from Step 3                  │
│  ├─ Tools:                                                │
│  │   - verify_claim(text, evidence_id) → accuracy         │
│  │   - check_numeric(slide_text) → correctness            │
│  │   - compare_to_brief(deck_summary, brief) → gaps       │
│  │   - review_narrative(slide_text) → quality feedback     │
│  │   - render_slide_preview(slide_id) → visual check      │
│  ├─ stopWhen: stepCountIs(20)                             │
│  └─ Output: CritiqueReport (structured)                   │
│                                                           │
│  Step 5: REVISE (conditional, max 2 iterations)           │
│  ├─ If critique has material issues → back to Step 3      │
│  │   with CritiqueReport as additional context             │
│  └─ Agent sees what the critic found, fixes it             │
│                                                           │
│  Step 6: EXPORT (deterministic)                           │
│  ├─ Final template binding from DeckSpecV2                │
│  ├─ PPTX generation (unified slide scene graph)           │
│  ├─ PDF generation (same scene graph, not free-flow HTML) │
│  ├─ Artifact QA (checksums, page/slide count match)       │
│  ├─ ArtifactManifest created only after QA passes         │
│  └─ Artifacts published to Supabase Storage               │
│                                                           │
│  Event-sourced progress from real tool calls, not stages   │
└─────────────────────────────────────────────────────────┘
```

### 5.3 Key Design Decisions

**a) Tools, not schemas.** Instead of asking the model to produce a complete metric plan in one shot, give it a `compute_metric` tool and let it decide what to compute iteratively. It can try a metric, see the result, decide what to compute next. This is how a human analyst works.

**b) The model writes the slides.** Instead of producing a "slide blueprint" that deterministic code materializes, the model calls `write_slide()` and gets back a preview image. It can adjust, reorder, rewrite. The deterministic layer handles rendering, not content decisions.

**c) Structured output at boundaries only.** Use `Output.object()` for final deliverables that downstream code must consume (DeckSpecV2 for the renderer, chart configs for the chart engine). Do **not** use structured output for intermediate reasoning — let the model think freely.

**d) Cross-model critique stays.** The semantic critique using a different provider is one of the best ideas in the current architecture. Make the critic an agent with tools to verify claims against actual data, not just a one-shot structured review.

**e) Data access via query tools.** Instead of serializing the entire analytics result as JSON in the prompt, give the model tools that return specific slices. This keeps context windows clean and lets the model ask for exactly what it needs. **Do not stream giant tables into context.**

**f) Unified slide scene graph.** Replace the current rendering split (PPTX is slide-like, PDF is document-like free-flow HTML) with a fixed-size slide scene graph that both PPTX and PDF renderers consume. This eliminates the 12-slide → 28-page divergence bug.

**g) Every tool output must be typed, bounded, replayable, and persisted with stable IDs.** Tool results go into AnalysisNotebook. This makes runs debuggable, replayable, and eval-ready.

**h) Event-sourced progress.** Replace synthetic run-status derived from stage weights and stale summaries with real-time progress from actual tool calls and agent checkpoints. No more 96% progress on a dead run.

**i) No silent fallbacks.** When the model cannot produce good output, surface the issue to the user. If you need fallback behavior, make it explicit — not a silent swap that produces template garbage pretending to be AI analysis.

### 5.4 Tool Schemas

```typescript
import { tool } from 'ai';
import { z } from 'zod';

// ─── DATA EXPLORATION ────────────────────────────────
const listFiles = tool({
  description: 'List all files in the evidence workspace with metadata.',
  inputSchema: z.object({}),
  async execute() {
    // Return: [{name, type, sheets?, rowCount?, columnCount?}]
  },
});

const describeTable = tool({
  description: 'Get column metadata for a table: names, types, sample values, nulls, uniques.',
  inputSchema: z.object({
    file: z.string(),
    sheet: z.string().optional(),
  }),
  async execute({ file, sheet }) {
    // Return: [{column, type, sampleValues, nullPct, uniqueCount, role}]
  },
});

const sampleRows = tool({
  description: 'Get a sample of rows from a table. Use to understand data shape before querying.',
  inputSchema: z.object({
    file: z.string(),
    sheet: z.string().optional(),
    n: z.number().default(10).describe('Number of rows to sample'),
  }),
  async execute({ file, sheet, n }) {
    // Return: first N rows as objects
  },
});

const queryData = tool({
  description: 'Query the dataset. Supports filtering, grouping, aggregation, ordering. Returns max 100 rows.',
  inputSchema: z.object({
    file: z.string(),
    sheet: z.string().optional(),
    columns: z.array(z.string()),
    filter: z.string().optional().describe('e.g., "region = North AND year > 2024"'),
    groupBy: z.array(z.string()).optional(),
    aggregate: z.object({
      column: z.string(),
      fn: z.enum(['sum', 'avg', 'count', 'count_distinct', 'min', 'max', 'ratio', 'share']),
    }).optional(),
    orderBy: z.string().optional().describe('e.g., "value DESC"'),
    limit: z.number().optional().default(100),
  }),
  async execute(params) {
    // Backed by existing analytics engine
    // Return: { rows, rowCount, truncated, queryId }
    // queryId persisted to AnalysisNotebook
  },
});

const computeMetric = tool({
  description: 'Compute a named metric and register it as an evidence ref with a stable ID.',
  inputSchema: z.object({
    name: z.string(),
    description: z.string(),
    file: z.string(),
    sheet: z.string().optional(),
    column: z.string(),
    aggregation: z.enum(['sum', 'avg', 'count', 'count_distinct', 'min', 'max']),
    groupBy: z.array(z.string()).optional(),
    filter: z.string().optional(),
  }),
  async execute(spec) {
    // Backed by existing computeGroupValue() from analytics.ts
    // Return: { metricId, value, breakdown?, evidenceRef }
  },
});

const readSupportDoc = tool({
  description: 'Read text content from a support document (PDF, DOCX, etc.).',
  inputSchema: z.object({
    file: z.string(),
    pages: z.string().optional().describe('e.g., "1-5" for PDFs'),
  }),
  async execute({ file, pages }) {
    // Return: extracted text
  },
});

// ─── TEMPLATE & BRAND ────────────────────────────────
const inspectTemplate = tool({
  description: 'Get available slide layouts with their regions, placeholder types, and capacities.',
  inputSchema: z.object({}),
  async execute() {
    // Return: [{layoutId, name, regions: [{type, capacity, position}]}]
  },
});

const inspectBrandTokens = tool({
  description: 'Get brand guidelines: colors, fonts, logos, spacing rules.',
  inputSchema: z.object({}),
  async execute() {
    // Return: { primaryColor, accentColors, fontFamily, logoUrl, ... }
  },
});

// ─── CHART & SLIDE AUTHORING ─────────────────────────
const buildChart = tool({
  description: 'Create a chart from data. Returns a chart ID and thumbnail for preview.',
  inputSchema: z.object({
    type: z.enum(['bar', 'line', 'pie', 'scatter', 'waterfall', 'heatmap', 'stacked_bar', 'table']),
    title: z.string(),
    data: z.array(z.record(z.unknown())),
    xAxis: z.string().optional(),
    yAxis: z.string().optional(),
    series: z.array(z.string()).optional(),
    style: z.object({
      colors: z.array(z.string()).optional(),
      showLegend: z.boolean().optional(),
      showValues: z.boolean().optional(),
    }).optional(),
  }),
  async execute(spec) {
    // Backed by existing chart rendering
    // Return: { chartId, thumbnailUrl, width, height }
  },
});

const writeSlide = tool({
  description: 'Create or update a slide. Returns a rendered preview image.',
  inputSchema: z.object({
    position: z.number().describe('Slide position (1-indexed)'),
    layout: z.string().describe('Template layout ID from inspect_template'),
    title: z.string(),
    subtitle: z.string().optional(),
    body: z.string().optional().describe('Main text content'),
    bullets: z.array(z.string()).optional(),
    chartId: z.string().optional().describe('Chart ID from build_chart'),
    metrics: z.array(z.object({
      label: z.string(),
      value: z.string(),
      delta: z.string().optional(),
    })).optional(),
    evidenceIds: z.array(z.string()).optional().describe('Evidence refs supporting this slide'),
    speakerNotes: z.string().optional(),
    transition: z.string().optional().describe('Narrative transition to next slide'),
  }),
  async execute(spec) {
    // Render slide via unified scene graph
    // Return: { slideId, previewUrl, warnings? }
    // Persisted to DeckSpecV2
  },
});

const renderDeckPreview = tool({
  description: 'Render a thumbnail strip of the full deck so far for visual review.',
  inputSchema: z.object({}),
  async execute() {
    // Return: { slideCount, thumbnails: [{slideId, previewUrl, position}] }
  },
});

// ─── CRITIQUE & QA ───────────────────────────────────
const verifyClaim = tool({
  description: 'Verify a factual claim against the dataset. Returns evidence.',
  inputSchema: z.object({
    claim: z.string(),
    expectedValue: z.string().optional(),
    evidenceId: z.string().optional(),
    sourceFile: z.string().optional(),
  }),
  async execute(params) {
    // Query data to verify
    // Return: { verified, actualValue, evidence, confidence, discrepancy? }
  },
});

const checkNumeric = tool({
  description: 'Cross-check all numeric assertions in slide text against evidence.',
  inputSchema: z.object({
    slideId: z.string(),
  }),
  async execute({ slideId }) {
    // Extract numbers from slide text, match against cited evidence
    // Return: { assertions: [{text, citedValue, actualValue, correct}] }
  },
});

const compareToBrief = tool({
  description: 'Check how well the deck addresses the brief objectives.',
  inputSchema: z.object({
    deckSummary: z.string(),
    brief: z.string(),
  }),
  async execute({ deckSummary, brief }) {
    // Return: { coveredObjectives, missedObjectives, gaps, score }
  },
});

// ─── EXPORT ──────────────────────────────────────────
const exportArtifacts = tool({
  description: 'Export the deck to PPTX and PDF. Deterministic, from DeckSpecV2.',
  inputSchema: z.object({
    format: z.enum(['pptx', 'pdf', 'both']).default('both'),
  }),
  async execute({ format }) {
    // Render from unified slide scene graph
    // Return: { pptxUrl?, pdfUrl?, slideCount, pageCount }
  },
});

const qaArtifacts = tool({
  description: 'Run QA checks on exported artifacts: checksums, page counts, evidence coverage.',
  inputSchema: z.object({
    pptxUrl: z.string().optional(),
    pdfUrl: z.string().optional(),
  }),
  async execute(params) {
    // Return: { passed, checks: [{name, passed, detail}] }
  },
});
```

### 5.5 Model Choices

| Phase | Recommended Model | Why |
|-------|------------------|-----|
| Understand (data analysis) | `gpt-5` via `@ai-sdk/openai` | Strong structured reasoning over tabular data; fast; good at SQL-like thinking |
| Author (deck writing) | `claude-opus-4-6` via `@ai-sdk/anthropic` | Superior prose quality; extended thinking for narrative depth; 1M context |
| Critique | Opposite provider from Author | Cross-model adversarial review catches blind spots |
| Revision | Same as Author | Maintains voice consistency |

**Model choice should be decided by evals, not ideology.** The architecture is provider-agnostic by design. If evals show GPT-5.4 writes better decks, use it. If Claude Sonnet is good enough and cheaper, use that. The AI SDK v6 multi-provider design makes swapping trivial.

```typescript
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { ToolLoopAgent, stepCountIs } from 'ai';

const analyst = new ToolLoopAgent({
  model: openai('gpt-5'),
  tools: { listFiles, describeTable, sampleRows, queryData, computeMetric, readSupportDoc },
  stopWhen: stepCountIs(30),
  onStepFinish: async (event) => {
    await persistToNotebook(jobId, event);
    await emitProgress(jobId, 'understand', event);
  },
});

const author = new ToolLoopAgent({
  model: anthropic('claude-opus-4-6'),
  tools: { lookupEvidence: queryData, buildChart, inspectTemplate, inspectBrandTokens, writeSlide, renderDeckPreview },
  stopWhen: stepCountIs(50),
  onStepFinish: async (event) => {
    await persistToNotebook(jobId, event);
    await emitProgress(jobId, 'author', event);
  },
});

const critic = new ToolLoopAgent({
  model: openai('gpt-5'), // opposite of author
  tools: { verifyClaim, checkNumeric, compareToBrief, renderDeckPreview },
  stopWhen: stepCountIs(20),
});
```

### 5.6 Orchestration Pattern

```typescript
const basquioGeneration = inngest.createFunction(
  { id: 'basquio-v2-generation', retries: 2 },
  { event: 'basquio/generation.requested' },
  async ({ event, step }) => {
    const { jobId, files, brief, templateId, brandId } = event.data;

    // Step 1: Normalize (deterministic)
    const workspace = await step.run('normalize', async () => {
      return buildEvidenceWorkspace(files, templateId, brandId);
    });

    // Step 2: Understand (agentic)
    const analysis = await step.run('understand', async () => {
      const result = await analyst.generate({
        prompt: `You are a senior data analyst. Analyze the evidence workspace
                 and produce a comprehensive analysis for this brief:

                 ${brief}

                 Available files: ${workspace.fileInventory}

                 Start by listing files and describing tables. Sample rows to
                 understand the data. Then compute metrics systematically —
                 explore from multiple angles before concluding. Register every
                 finding as an evidence ref.

                 Be thorough. An executive will make decisions based on your analysis.`,
      });
      return result.output;
    });

    // Step 3: Author (agentic)
    let deck = await step.run('author', async () => {
      const result = await author.generate({
        prompt: `You are an executive presentation author. Using this analysis,
                 create a compelling deck.

                 Analysis summary: ${analysis.summary}
                 Key findings: ${analysis.topFindings}
                 Brief: ${brief}

                 First inspect_template and inspect_brand_tokens. Then build the
                 deck slide by slide using write_slide. Use build_chart for
                 visualizations. Ground every claim in evidence.

                 After building all slides, call render_deck_preview to review
                 the full deck. Revise any slides that don't meet executive quality.`,
      });
      return result.output;
    });

    // Step 4: Critique (agentic, cross-model)
    const critique = await step.run('critique', async () => {
      const result = await critic.generate({
        prompt: `You are a senior QA reviewer. Audit this deck for factual accuracy,
                 narrative coherence, and brief alignment.

                 Deck: ${deck.summary}
                 Brief: ${brief}

                 Use verify_claim to check every factual assertion. Use check_numeric
                 to audit numbers on each slide. Use compare_to_brief to identify gaps.
                 Be adversarial — find what's wrong, not what's right.`,
      });
      return result.output;
    });

    // Step 5: Revise if needed (max 2 iterations)
    if (critique.hasIssues) {
      deck = await step.run('revise', async () => {
        const result = await author.generate({
          prompt: `A reviewer found these issues with your deck. Fix them.

                   Issues: ${critique.issues}

                   Use write_slide to update affected slides. Use verify_claim
                   to confirm your fixes are accurate.`,
        });
        return result.output;
      });
    }

    // Step 6: Export (deterministic)
    const artifacts = await step.run('export', async () => {
      const exported = await exportFromDeckSpec(deck);
      const qa = await runArtifactQA(exported);
      if (!qa.passed) throw new Error(`QA failed: ${qa.failures}`);
      return publishArtifactManifest(jobId, exported);
    });

    return { jobId, artifacts };
  }
);
```

### 5.7 Tracing / Observability

| What | Tool | Why |
|------|------|-----|
| LLM calls (prompt, completion, latency, cost, tokens) | **Langfuse** | Best open-source LLM tracing; self-hostable |
| Durable function execution (step status, retry history) | **Inngest dashboard** | Already in the stack |
| Tool calls and intermediate results | **AnalysisNotebook** (Supabase) | Custom persistence via `onStepFinish` callbacks |
| Distributed tracing | **OpenTelemetry** via AI SDK `experimental_telemetry` | Correlate LLM calls with tool executions |
| UI progress | **Event-sourced from real tool calls** | Replace synthetic progress with actual checkpoints |

```typescript
const agent = new ToolLoopAgent({
  model: openai('gpt-5'),
  tools: { queryData, computeMetric },
  onStepFinish: async ({ step, toolCalls, toolResults, usage }) => {
    // Persist to AnalysisNotebook
    await db.insert(notebookEntries).values(
      toolCalls.map((call, i) => ({
        jobId,
        phase: 'understand',
        step: step.number,
        toolName: call.toolName,
        input: call.args,
        output: toolResults[i],
        timestamp: new Date(),
      }))
    );
    // Emit real-time progress
    await emitProgress(jobId, {
      phase: 'understand',
      step: step.number,
      lastTool: toolCalls[0]?.toolName,
      usage,
    });
  },
  experimental_telemetry: { isEnabled: true, functionId: 'basquio-analyst' },
});
```

### 5.8 Failure Recovery

| Failure Mode | Current Behavior | New Behavior |
|--------------|-----------------|--------------|
| AI call timeout | Pipeline blocks, stale recovery after 300s, overlapping recovery dispatches | `ToolLoopAgent` has `timeout` per call; Inngest step retries on failure; single durable execution path (no request-route tangle) |
| Model produces garbage | Silent fallback to template | Agent sees tool results and self-corrects within its loop; critic agent catches remaining issues; no silent fallbacks |
| Analytics computation stalls | Heartbeat yields but no timeout | `query_data` tool has per-call timeout; agent can retry with simpler query or different approach |
| Artifact size mismatch (12→28 pages) | QA fails post-render, no recourse | Unified slide scene graph eliminates PPTX/PDF divergence; author sees previews during creation |
| Provider outage | Cross-provider fallback in `model.ts` | AI SDK v6's `prepareStep` can switch providers mid-run; Inngest retries with different provider |
| Artifacts published before QA | Race between persistence and status | ArtifactManifest only created after QA passes; artifacts invisible until manifest exists |
| Overlapping executions | Execution lease + recovery dispatches compete | Single Inngest function, no request-route execution, no recovery tangle |

### 5.9 Evals

**Golden set:** Real Basquio jobs + Claude Code baseline deck + human reference decks. Must include the Affinity pet care dataset.

| Eval | Method | Automated? |
|------|--------|-----------|
| **Factual accuracy** | Extract all numeric claims from deck → verify each against source data → accuracy % | Yes |
| **Brief alignment** | LLM-as-judge: does the deck address the brief's stated objectives? Rubric scoring. | Yes |
| **Narrative quality** | LLM-as-judge: blind comparison of old vs. new on executive summary, key messages, transitions | Yes |
| **Analytical depth** | Count unique analytical dimensions explored, comparisons made, non-obvious insights surfaced | Semi |
| **Completeness** | Check that all relevant dimensions in the data are covered | Yes |
| **Visual quality** | Chart type appropriateness, data-ink ratio, label clarity, layout usage | Manual |
| **Latency** | End-to-end time from upload to artifact delivery | Yes |
| **Cost** | Total token usage and API cost per generation | Yes |
| **Determinism** | Run same inputs 3x, measure output variance | Yes |

Run evals on every PR. Compare v1 vs. v2 on the same frozen test datasets. v2 must **match or beat v1 on retail datasets** (where hardcoded fallbacks currently produce acceptable output) before rollout.

---

## 6. Migration Plan

### Phase 0: Foundation (Week 1)
**Build:**
- DeckRun, EvidenceWorkspace, AnalysisNotebook, DeckSpecV2, ArtifactManifest — DB schema + TypeScript types
- Install AI SDK v6 (`ai@^6.0.97`, `@ai-sdk/openai`, `@ai-sdk/anthropic`)
- Build the tool layer: `listFiles`, `describeTable`, `sampleRows`, `queryData`, `computeMetric` — wrapping existing analytics engine
- Set up Langfuse tracing
- Set up eval harness with 3 golden-set jobs

**Keep:** The entire `analytics.ts` computation engine (becomes tool implementations), PPTX renderer, Supabase storage, Inngest.

### Phase 1: Replace Understand Phase (Week 2)
**Build:**
- `ToolLoopAgent("analyst")` with data exploration tools
- Wire into new Inngest function alongside old pipeline
- Run both in parallel, compare with evals

**Delete:** `metrics.ts` (metric planning stage), retail-specific metric fallback (`metrics.ts` L384-598). Analytics engine stays — it becomes the `computeMetric` and `queryData` tool implementations.

### Phase 2: Replace Author Phase (Weeks 3-4)
**Build:**
- Template/brand inspection tools: `inspectTemplate`, `inspectBrandTokens`
- Chart and slide tools: `buildChart`, `writeSlide`, `renderDeckPreview`
- Unified slide scene graph renderer (fixes PPTX/PDF divergence)
- `ToolLoopAgent("author")` with authoring tools

**Delete:** `insights.ts`, `story.ts`, `slides.ts`, and all retail-specific hardcoding in them. Outline/design deterministic logic absorbed into `writeSlide` tool's layout scoring.

### Phase 3: Replace Critique Phase (Week 4)
**Build:**
- Verification tools: `verifyClaim`, `checkNumeric`, `compareToBrief`
- `ToolLoopAgent("critic")` with verification tools
- Revision loop (author receives critique, fixes issues)

**Delete:** `validate.ts`. Referential integrity checks become tool implementations.

### Phase 4: Clean Up Execution Model (Week 5)
**Delete:**
- `model.ts` (`generateStructuredStage` wrapper) — replaced by AI SDK v6 ToolLoopAgent
- All inline prompts in intelligence package files
- The revision loop in `workflows/src/index.ts` L325-629
- Retail-specific fallbacks (all of them)
- Fallback metric/insight/story generators
- Request-route execution paths: `apps/web/src/app/api/generate/route.ts:72`, `apps/web/src/app/api/jobs/[jobId]/execute/route.ts:61`, `apps/web/src/app/api/jobs/[jobId]/route.ts:33`
- Synthetic run-status logic — replace with event-sourced progress from AnalysisNotebook

**Keep:**
- Analytics computation engine (core logic, now behind tools)
- PPTX renderer (refactored to use unified scene graph)
- Supabase storage and artifact persistence
- Inngest durable functions (restructured: 1 function with 6 steps instead of 13 stages)
- Template/layout scoring (moved into `writeSlide` tool)

### Phase 5: Evals + Shadow Rollout (Week 6)
**Do:**
- Run evals on 20+ real jobs against current Basquio and Claude Code baseline
- Shadow mode: both pipelines run on every job for 2 weeks
- Feature flag: `BASQUIO_PIPELINE_VERSION=v1|v2`
- Human review for first 50 v2 jobs

### De-risking Strategy

1. **Shadow mode**: Both pipelines produce output; only v1 is shown to users initially.
2. **Feature flag**: Route jobs to v1 or v2. Start with non-retail datasets (where v1 is weakest). Retail last (where hardcoded fallbacks produce acceptable output).
3. **Kill switch**: If v2 quality regresses, route all traffic back to v1 instantly.
4. **Cost budgets**: Per-phase token limits via `stopWhen` + cost tracking in Langfuse. Alert if a job exceeds 2x the median cost.
5. **Human review**: First 50 v2 jobs reviewed by a human before delivery.

---

## 7. Risks and Unknowns

| Risk | Severity | Mitigation |
|------|----------|------------|
| Agent loops are unpredictable in duration/cost | **High** | `stopWhen: stepCountIs(N)` hard caps; per-phase cost budgets; Inngest step timeouts; cost alerts |
| Model quality regression on retail datasets | **High** | Retail hardcoding currently produces acceptable output; v2 must match/beat in evals before switchover; retail last in rollout |
| Template fidelity — agent can't see layout failures | **High** | `render_slide_preview` and `render_deck_preview` tools give visual feedback; model can iterate on layout |
| AI SDK v6 `ToolLoopAgent` is new; APIs may change | **Medium** | Pin version; abstract behind `runPhase()` wrapper; many APIs still `experimental_` |
| Tool execution errors during agent loop | **Medium** | Tools return errors as tool results, not exceptions; model retries or works around |
| Prompt caching less effective with dynamic tool results | **Medium** | Cache static parts (instructions, schema descriptions) with Anthropic `cache_control`; dynamic data in later messages; OpenAI automatic caching helps too |
| Extended thinking + tool use constraints | **Low** | Claude `tool_choice` must be `"auto"` with extended thinking; design tools so model wants to call them naturally |
| Streaming to UI harder with tool loops | **Low** | AI SDK v6 `agent.stream()` + `createAgentUIStreamResponse()`; show tool call names as progress |
| Losing the "JSON vending machine" predictability | **Medium** | AnalysisNotebook gives full replay; evals catch regressions; structured output at boundaries keeps downstream code stable |

---

## 8. Brutal Verdict

### What is fundamentally wrong today

**Basquio doesn't use AI to do analysis or write decks. It uses AI to fill out forms.**

Every AI call is a one-shot `generateObject()` that produces a schema-constrained JSON blob. The model never sees the data directly — it sees a serialized profile. It never iterates on its own work — it gets one chance to produce a plan, and deterministic code decides whether to keep or discard it. It never writes prose freely — it fills `body` and `bullets` fields in a Zod schema.

This is not a bug. It is the stated product doctrine: *"The AI does not generate final slides directly"* (`docs/vision.md:64`), *"LLMs produce contracts, not final document syntax"* (`rules/canonical-rules.md:13`). The architecture faithfully implements a philosophy that is now wrong. Models in 2026 are not the models of 2024. The safety-net-first approach was justified when models hallucinated column names and produced incoherent prose. It is now the primary bottleneck.

The retail-specific hardcoding is the smoking gun. ~455 lines of Italian-language domain logic that bypasses AI entirely for the product's flagship use case. This means the team already knows the AI path doesn't produce good enough output for the most important customers — so they wrote the analysis by hand and pretended the AI did it.

The deterministic override system (sanitize → validate → fallback) caps AI capability at the quality of the schema design, not the quality of the model. When GPT-5 or Claude Opus 4.6 could produce executive-grade analysis with iterative reasoning and tool use, Basquio asks them to pick from a menu of predefined metric types and narrative arc categories.

### What would make Basquio feel AI-native

1. **The model reads your data.** Not a serialized profile. The actual rows, queried through tools, iteratively.
2. **The model decides what to analyze.** Not from a menu of metric types. It explores, hypothesizes, computes, and iterates — like a human analyst with a spreadsheet.
3. **The model writes the story.** Not by filling `narrativeArcType: "opportunity"` in a schema. By writing prose, critiquing it, and rewriting it.
4. **The model builds the deck.** Slide by slide, seeing previews, adjusting layout and content based on what it sees.
5. **The model checks its own work.** Not a one-shot structured critique. An adversarial agent with tools to verify every claim against the source data.
6. **Deterministic code serves the model.** Data access, chart rendering, template binding, PPTX generation — these are tools for the AI to use, not cages to contain it.
7. **When AI fails, the user knows.** No silent fallbacks to templates. Surface the issue. Let the user guide it — like a Claude Code chat does.
8. **Every tool call is persisted.** The AnalysisNotebook makes runs debuggable, replayable, and eval-ready. You can see exactly what the model did, not just what schema it filled.

### The One-Sentence Version

The gap between "Claude Code chat" quality and "Basquio" quality is not a model gap — it's an architecture gap. The model is the same. The difference is that one system lets it think and the other doesn't. Build the system that lets it think.
