# Vercel Environment Variables

## First Build

The current Basquio scaffold can complete a Vercel build with no environment variables because the app guards missing Supabase configuration at runtime.

That said, a useful first deployment should set the following immediately.

## Set These In Vercel Now

```env
NEXT_PUBLIC_SUPABASE_URL=https://fxvbvkpzzvrkwvqmecmi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
BASQUIO_ALLOW_LOCAL_ARTIFACT_FALLBACK=false
```

## Set These Before Enabling Workflows And Rendering

```env
INNGEST_EVENT_KEY=your-inngest-event-key
INNGEST_SIGNING_KEY=your-inngest-signing-key
BROWSERLESS_TOKEN=your-browserless-token
```

## Optional Right Now

```env
SUPABASE_PROJECT_ID=fxvbvkpzzvrkwvqmecmi
BROWSERLESS_URL=https://production-sfo.browserless.io
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

## Why

- `NEXT_PUBLIC_SUPABASE_URL`: used by browser and server Supabase clients
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: used by browser and SSR auth clients
- `SUPABASE_SERVICE_ROLE_KEY`: required by server-side artifact persistence
- `BASQUIO_ALLOW_LOCAL_ARTIFACT_FALLBACK=false`: prevents silent local-disk fallback in production
- `INNGEST_EVENT_KEY`: required when Basquio starts emitting workflow events
- `INNGEST_SIGNING_KEY`: required when Inngest calls the Vercel route
- `BROWSERLESS_TOKEN`: required for real PDF rendering instead of placeholder behavior
- `BROWSERLESS_URL`: optional because the code already defaults to Browserless production SFO
- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`: not used by the current scaffold yet, but they belong in the production environment once LLM-backed insight and narrative steps are wired in

## Recommended Vercel Setup

Set the variables above for:

- Production
- Preview
- Development

If you want previews to avoid real artifact generation, you can set:

```env
BASQUIO_ALLOW_LOCAL_ARTIFACT_FALLBACK=true
```

for Preview only, but Production should stay `false`.
