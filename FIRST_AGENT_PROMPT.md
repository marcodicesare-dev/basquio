# First Agent Prompt

You are the first implementation agent for Basquio.

You are working directly inside the `Basquio/` folder of the current workspace.

The GitHub repo for this product is:

- `marco.dicesare-dev/Basquio`

The Supabase project for this product is:

- project id: `fxvbvkpzzvrkwvqmecmi`
- project URL: `https://fxvbvkpzzvrkwvqmecmi.supabase.co`

Your job is to scaffold the product foundation end to end, following the canonical Basquio context already present in this folder.

## Non-Negotiable Context

Read these first and treat them as the source of truth:

1. `Basquio/docs/vision.md`
2. `Basquio/docs/architecture.md`
3. `Basquio/docs/research-synthesis.md`
4. `Basquio/docs/decision-log.md`
5. `Basquio/memory/canonical-memory.md`
6. `Basquio/rules/canonical-rules.md`
7. `Basquio/rules/prompt-contracts.md`
8. `Basquio/code/contracts.ts`
9. `Basquio/agents/agents.yaml`
10. `Basquio/CODEX_RULES.md`

Do not improvise a different architecture unless you also update the decision log, memory, rules, and contracts in the same change.

## Product Thesis

Basquio is not a generic AI deck generator.

Basquio is an intelligence-first system that:

- ingests business datasets
- computes deterministic analytical summaries
- extracts evidence-backed insights
- plans an executive narrative from general to specific
- renders editable PowerPoint and polished PDF from the same canonical slide plan

The moat is:

- dataset understanding
- insight ranking
- narrative planning

The renderer is implementation, not moat.

## Hard Constraints

- `.pptx` is the only first-class editable template input in v1
- `.pdf` is style-reference-only in v1
- PPTX and PDF must derive from the same `SlideSpec[]`
- LLMs must output structured contracts, not freestyle final slides
- deterministic analytics must run before narrative generation
- `ChartSpec` must stay independent from preview UI libraries

## Required Technical Direction

Use this as the default scaffold direction unless blocked by a real implementation issue:

- app framework: Next.js 15 App Router
- monorepo layout inside `Basquio/`
- database/auth/storage: Supabase
- workflow runtime: Inngest
- inherited fallback workflow pattern: QStash checkpoint-resume
- pptx generation: `pptxgenjs`
- pptx template-preserving support: `pptx-automizer`
- pdf generation: HTML to Browserless
- pdf post-processing only: `pdf-lib`
- workbook ingestion: `xlsx` / SheetJS
- advanced chart export: ECharts SSR SVG
- standard editable charts for PPT: native PptxGenJS charts where possible
- schema validation: Zod

Do not choose Recharts, Tremor, or Nivo as the canonical export architecture.
They may exist later as preview-layer options only.

## What You Need To Scaffold

Build the first real implementation skeleton for Basquio inside the `Basquio/` folder.

### 1. Repo and workspace foundation

Create a clean monorepo-style structure under `Basquio/`:

- `apps/web`
- `packages/core`
- `packages/types`
- `packages/data-ingest`
- `packages/intelligence`
- `packages/template-engine`
- `packages/render-pptx`
- `packages/render-pdf`
- `packages/render-charts`
- `packages/workflows`
- `supabase`

If you need a slightly different naming scheme, keep the separation of concerns intact.

### 2. App scaffold

Scaffold the web app with:

- App Router
- TypeScript
- basic landing shell for internal product use
- authenticated application shell
- placeholder pages for:
  - dashboard
  - new generation job
  - templates
  - artifacts

The UI can be minimal. Do not waste time on visual polish yet.

### 3. Environment and config

Create:

- `.env.example`
- Basquio-local README notes if needed
- Supabase client wiring using the supplied project id
- placeholders for:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `INNGEST_EVENT_KEY`
  - `INNGEST_SIGNING_KEY`
  - `BROWSERLESS_TOKEN`

Do not invent secrets. Use placeholders.

### 4. Supabase scaffold

Inside `Basquio/supabase`, scaffold the initial schema and migration plan for:

- organizations
- users or memberships
- projects
- source_files
- datasets
- template_profiles
- generation_jobs
- generation_job_steps
- artifacts

You do not need a perfect production schema, but it must match the product architecture.

### 5. Core contracts

Use `Basquio/code/contracts.ts` as the baseline and evolve it if necessary.

Add package-level type sharing so the app and worker/workflow code consume the same contracts cleanly.

### 6. Data ingest scaffold

Create initial ingestion code for:

- workbook upload
- SheetJS parsing
- normalization into a `DatasetProfile`

You do not need full analytics yet, but you must provide:

- parsing entrypoint
- typed normalization layer
- placeholder deterministic analysis module

### 7. Intelligence scaffold

Create the first architecture skeleton for:

- dataset profiler
- deterministic analytics stage
- insight generation stage
- story planning stage
- slide planning stage

These can return mocked or placeholder outputs initially, but the module boundaries and contracts must be real.

### 8. Rendering scaffold

Create initial boundaries for:

- PPTX rendering package
- PDF rendering package
- chart rendering package

At minimum:

- PptxGenJS integration stub
- Browserless PDF integration stub
- ECharts SSR chart render stub

### 9. Inngest workflow scaffold

Create the first durable job skeleton with steps for:

1. parse input
2. analyze
3. generate insights
4. plan story
5. plan slides
6. render pptx
7. render pdf
8. store artifacts

The first pass may use placeholders for some internals, but the workflow shape must be real and typed.

### 10. QA and developer workflow

Integrate Basquio with:

- `pnpm qa:basquio`
- package-level typecheck if needed
- root or local scripts for:
  - dev
  - typecheck
  - lint
  - workflow dev if applicable

Do not remove the existing Basquio QA rule. Extend it if you add required files.

## Implementation Priorities

Prioritize in this order:

1. architecture-correct structure
2. shared contracts
3. Supabase and workflow wiring
4. ingest and intelligence boundaries
5. render boundaries
6. minimal UI

If there is a tradeoff between "more features" and "cleaner architecture", choose cleaner architecture.

## Deliverables

By the end of the task, you should have:

- a real Basquio monorepo skeleton inside `Basquio/`
- initial app scaffold
- initial packages scaffold
- Supabase scaffold and migrations
- Inngest scaffold
- typed contracts wired through the repo
- initial ingestion and rendering boundaries
- updated docs if you had to change any structural decision

## Acceptance Criteria

The work is acceptable only if all of these are true:

- `pnpm qa:basquio` passes
- the scaffold clearly reflects the intelligence-first architecture
- the workflow and package boundaries are real, not just markdown notes
- the app can boot in development with placeholders where secrets are needed
- no core architectural decision silently drifts from the Basquio docs

## Reporting Back

When finished, report:

1. what was scaffolded
2. what is real vs placeholder
3. what commands pass
4. what remains for the next agent

## Important Behavior Rules

- do not downgrade the architecture into a generic single-app prototype
- do not hardwire renderer details into intelligence contracts
- do not skip Supabase and workflow scaffolding
- do not replace Basquio docs with looser ad hoc notes
- do not stop at planning; actually scaffold the codebase
