# Basquio — AI-native business intelligence deck generation

## North star
Basquio does the same level of analysis as a Claude Code chat. The model decides what to investigate and how to present it. Tools provide deterministic data access. No silent fallbacks, no hardcoded narrative structure.

## Architecture
6-step agentic pipeline orchestrated by Inngest, running on Vercel + Supabase:

1. **Normalize** — stream-parse CSV/XLSX/XLS → jsonl.gz blobs in Supabase Storage
2. **Understand** — GPT-5.4 analyst agent explores data with 6 tools, produces AnalysisReport
3. **Author** — Claude Opus 4.6 builds slides as scene graph with evidence-linked charts
4. **Critique** — cross-model verification of claims against source data
5. **Revise** — author re-runs with critique (max 2 cycles, gates on major+critical)
6. **Export** — PPTX + PDF from unified scene graph, QA, publish manifest

## Development

```bash
pnpm install
pnpm qa:basquio        # type-check + context QA
npx tsc --noEmit       # type-check only
```

After pushing to main, wait ~2.5min for Vercel deploy, then sync Inngest:
```bash
curl -s -X PUT "https://basquio.com/api/inngest"
```

## Key rules

### OpenAI structured output
All Zod schemas used as `Output.object()` MUST have every property required. No `.optional()` or `.default()`. OpenAI strict mode rejects schemas where `required` doesn't include every key.

### Inngest step output
Never return parsed rows, file buffers, or large JSON from `step.run()`. Inngest serializes step returns for memoization — limit is 4MB. Return only IDs, counts, and small manifests.

### Data access
Tools load rows on-demand via `loadRows(sheetKey)` which downloads per-sheet jsonl.gz blobs from Supabase Storage. Do NOT preload all sheets into memory. The `workspace.sheetData` field is deprecated and always `{}`.

### Streaming parsers
CSV uses `csv-parse` streaming. XLSX uses ExcelJS `WorkbookReader`. Rows flow through a gzip transform — no `rows[]` accumulation. Only samples (head 40 + reservoir 200 + tail 20) and running column stats are kept in memory.

### Security
Storage policies for `evidence-workspace-blobs` scope access by org membership via `deck_runs` join. All PostgREST queries use `assertUuid()` to prevent operator injection. API read endpoints verify auth + tenancy.

## Package structure
- `packages/intelligence/` — ToolLoopAgent wrappers + tool definitions
- `packages/workflows/` — Inngest orchestration + event emission
- `packages/data-ingest/` — streaming parsers + blob generation
- `packages/render-pptx/` + `packages/render-pdf/` — artifact renderers
- `packages/scene-graph/` — unified slide scene graph
- `packages/template-engine/` — template profile interpretation
- `packages/types/` — shared Zod schemas + TypeScript types
- `code/contracts.ts` — shared data schemas
- `code/v2-contracts.ts` — v2 canonical state object schemas
- `apps/web/` — Next.js frontend + API routes

## Environment variables
See `.env.example`. Critical: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## Supabase project
Project ID: `fxvbvkpzzvrkwvqmecmi`
Migrations: `supabase/migrations/`
