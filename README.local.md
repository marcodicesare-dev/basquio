# Basquio Workspace Notes

This workspace is the first implementation skeleton for Basquio's intelligence-first presentation pipeline.

## Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm qa:basquio
pnpm test:code-exec
pnpm test:run --run-id <uuid>
pnpm supabase:start
pnpm supabase:reset
```

## First Usable Test Flow

The app now exposes a real internal generation path:

1. Run `pnpm dev`
2. Open `/jobs/new`
3. Upload a `.csv` dataset
4. Add business context, audience, and objective
5. Generate the coupled `.pptx` and `.pdf`
6. Download them from `/artifacts`

## Environment

Copy `.env.example` to `.env.local` and fill in the secrets. The scaffold is designed to boot without live secrets, but auth, durable job delivery, Browserless PDF rendering, and Supabase storage all stay in placeholder mode until the environment is configured.

## Current Defaults

- GitHub repo: `marco-dicesare-dev/Basquio`
- Supabase project id: `fxvbvkpzzvrkwvqmecmi`
- Supabase URL: `https://fxvbvkpzzvrkwvqmecmi.supabase.co`
- Workflow runtime: direct Claude code-execution worker
- Progress persistence: database-backed run state plus internal dispatch

## Supabase CLI

For local migration validation:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:lint
```

For the hosted project:

```bash
supabase link --project-ref fxvbvkpzzvrkwvqmecmi
supabase db push
```

This first pass keeps RLS enabled but intentionally expects server-side service-role access until tenant-aware membership policies are implemented.

## Retired Path

`/api/inngest` is intentionally retired and returns `410`. The current generation path is the direct Claude code-execution worker behind `/api/generate` and `/api/jobs/[jobId]/execute`.
