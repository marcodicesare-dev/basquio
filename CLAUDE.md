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

After pushing to main, Vercel auto-deploys. Railway worker deploys must be done manually from a clean `HEAD` snapshot.

## Key rules

### Token costs (CRITICAL)
- `container_upload` files cost 0 input tokens. NEVER put data summaries in the message text.
- Each `pause_turn` continuation re-sends FULL message history. Minimize continuations.
- Include `web_fetch_20260209` in tools for free code execution compute.
- Expected cost: $0.50-1.70/deck. If > $3.50, the prompt or continuation pattern is wrong.

### PPTX skill
The Anthropic PPTX skill uses PptxGenJS (Node.js). Do NOT instruct Claude to use python-pptx when the skill is loaded. Charts should be rendered as PNG images in Python (matplotlib/seaborn) and embedded in the deck.

### Streaming for long requests
Use `.stream()` + `.finalMessage()` for Claude API calls that may take > 10 minutes. Non-streaming requests get 502'd by Cloudflare.

### Railway worker
The worker (`scripts/worker.ts`) polls Supabase every 5s for `status="queued"` runs. It claims atomically, heartbeats via `updated_at`, and recovers stale runs stuck > 30 minutes. No Inngest needed.

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

## Supabase project
Project ID: `fxvbvkpzzvrkwvqmecmi`
Migrations: `supabase/migrations/`

## Hard-won rules (March 27-28, 2026) — DO NOT VIOLATE

### Anthropic execution contract
- Tool type: `code_execution_20250825` — DO NOT upgrade without smoke test
- Beta header: `code-execution-2025-08-25` — DO NOT change
- Canonical config lives in `packages/workflows/src/anthropic-execution-contract.ts`
- `code_execution_20260120` does NOT exist server-side as of March 28. The SDK has forward types.

### Phase timeouts
- Current production truth: local `author` and `revise` watchdog timeouts are disabled.
- The Anthropic client timeout is currently `60m`.
- Stale recovery must look at active in-flight requests plus meaningful progress, not raw wall-clock age of the phase.
- Before setting ANY local watchdog again: query recent successful runs and prove the watchdog does not kill healthy long code-execution turns.

### Visual QA alignment
- The judge that blocks publish must also shape revise.
- Current production truth: critique and final export both use `claude-sonnet-4-6`.
- Do not reintroduce a weaker critique judge followed by a stricter export-only judge.

### Schema parsing
- Claude's output shape varies. Use `.passthrough()` on Zod objects for LLM output.
- Normalize/coerce fields instead of rejecting. A run that spent $1+ MUST NOT die on parseable-but-differently-shaped JSON.

### SQL functions
- Always qualify column references in PL/pgSQL (use `table.column`, not bare `column`)
- FK ordering: INSERT new row BEFORE updating old row's FK reference to it

### Commit discipline
- Max 3 pipeline commits per day
- Each commit validated with 1 production run before next commit
- No "fix" commit without identifying which prior commit introduced the regression

## Memory & learnings
Read `memory/MEMORY.md` for the current index. Critical files:
- `memory/canonical-memory.md` — canonical product, runtime, and process truth
- `memory/march28-48h-forensic-learnings.md` — March 27-28 forensic truth source for what actually failed and what is now canonical
- `rules/canonical-rules.md` — execution contract and anti-drift rules
- `packages/workflows/src/anthropic-execution-contract.ts` — canonical Anthropic tool/beta/skill contract
