# Basquio Workspace Notes

This workspace is the first implementation skeleton for Basquio's intelligence-first presentation pipeline.

## Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm qa:basquio
pnpm workflow:dev
pnpm supabase:start
pnpm supabase:reset
```

## Environment

Copy `.env.example` to `.env.local` and fill in the secrets. The scaffold is designed to boot without live secrets, but auth, durable job delivery, Browserless PDF rendering, and Supabase storage all stay in placeholder mode until the environment is configured.

## Current Defaults

- GitHub repo: `marco-dicesare-dev/Basquio`
- Supabase project id: `fxvbvkpzzvrkwvqmecmi`
- Supabase URL: `https://fxvbvkpzzvrkwvqmecmi.supabase.co`
- Workflow runtime: Inngest
- Inherited long-job fallback: QStash checkpoint-resume

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
