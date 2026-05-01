# Quick-Slide Tool: Spec

**Status:** Draft. Not implemented yet. This file is the gate before code lands.
**Author:** Claude (handing off to Marco for review)
**Date:** 2026-05-01
**Branch target:** dedicated `feat/quick-slide-tool` (not `feat/chat-crud-and-quick-slide`)

## Why we are not building this in the chat-CRUD branch

Working-rules §4 says spec before build. The quick-slide tool is a real piece
of architecture (lightweight Anthropic call + PPTX skill + storage upload +
chat-side polling chip), not a 50-line addition. Shipping a half-baked version
in the same commit as chat CRUD would either burn a context revert, leak a
broken capability into production, or both. So this file exists. The actual
build happens on its own branch with this spec as the contract.

## Problem the tool solves

Today the only way to produce a slide artifact in Basquio is the full V6 deck
pipeline: 8-15 slides, 15-25 minutes via Railway worker, ~$3-5 per run. That is
correct for a real client deliverable. It is wrong for the conversational
moment when an analyst says "show me one slide on Mulino Bianco crackers Q1
share trend" or "fai una slide su questo trend per Lavazza".

The user wants a slide in 30-60 seconds, in the chat, looking production-grade,
and ingesting the workspace brand pack + scope context + attached evidence the
same way the full deck does.

## Out of scope

- Multi-slide quick decks (use the existing pipeline).
- Bypassing the workspace brand pack or scope context (that is the moat).
- Editing the slide after generation in-chat. V1 is "produce, download, iterate
  via a follow-up turn".
- Generating without a scope. V1 requires `currentScopeId` so the brand pack
  resolves; chat-without-scope falls back to the system "workspace" scope.

## Architecture

### Tool definition

`quickSlideTool(ctx: AgentCallContext)` lives in
`apps/web/src/lib/workspace/agent-tools-quick-slide.ts`.

Invoked by the agent when the user asks for a single slide. Trigger phrases:
"one slide", "una slide", "quick slide", "fai una slide", "show me a slide",
"slide on", "slide su". Trigger MUST be tighter than draftBrief so the agent
does not collide.

Tool inputs:
```ts
z.object({
  topic: z.string().min(8).max(400),
  audience_hint: z.string().max(200).optional(),
  data_focus: z.string().max(400).optional(),    // "value share Q1 2026"
  language: z.enum(["it", "en"]).default("it"),
  evidence_doc_ids: z.array(z.string().uuid()).max(4).optional(),
})
```

Tool output (returned synchronously, well under streamText budget):
```ts
{
  ok: true,
  run_id: string,         // quick_slide_runs.id (uuid)
  status: "queued",
  brief: { topic, audience, data_focus, language },
  scope: { id, name, kind } | null,
  evidence_count: number,
}
```

### Backing job

Two new tables. Migrations under `supabase/migrations/2026-05-XX-quick-slide.sql`.

```sql
create table quick_slide_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workspace_scope_id uuid references workspace_scopes(id) on delete set null,
  conversation_id uuid references workspace_conversations(id) on delete set null,
  created_by uuid not null references auth.users(id),
  brief jsonb not null,           -- topic, audience, data_focus, language
  evidence_doc_ids uuid[] not null default '{}',
  status text not null default 'queued',  -- queued, running, ready, error
  pptx_storage_path text,         -- supabase storage key
  png_thumbnail_path text,        -- rendered preview
  cost_usd numeric,
  duration_ms integer,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table quick_slide_events (
  id bigserial primary key,
  run_id uuid not null references quick_slide_runs(id) on delete cascade,
  phase text not null,            -- queued, briefing, ingesting, generating, rendering, ready, error
  message text,
  cost_delta_usd numeric,
  created_at timestamptz not null default now()
);
```

RLS: viewer must be a member of the workspace. Service role inserts events.

### API endpoints

- `POST /api/workspace/quick-slide`: creates a `quick_slide_runs` row, kicks
  off the worker job (or runs inline if duration permits), returns `{ id,
  status }`.
- `GET /api/workspace/quick-slide/[id]`: returns current row + last 10 events.
  Polled by the chat chip at 1-2s intervals. Response cached with
  `Cache-Control: no-store`.
- `GET /api/workspace/quick-slide/[id]/download`: signed URL to the PPTX in
  storage. 5-minute expiry. Tenancy-checked.

### Worker pipeline

Lightweight, NOT the V6 worker. New file:
`packages/workflows/src/quick-slide/generate.ts`.

One Anthropic streamed call with these tools:
- `code_execution_20250825` (PPTX skill loaded via `container.skills` for
  Sonnet/Opus, or `npm install pptxgenjs` fallback for Haiku per the existing
  Haiku contract).
- No web fetch. Quick slide does not research; it consumes workspace evidence
  and brief. If the user asked for fresh trade-press, they should use the full
  deck or webSearch separately.

System prompt:
- Static block: PPTX skill quick-reference + 3 few-shot single-slide examples
  (one chart slide, one SCQA slide, one comparison-table slide). Cached 1h.
- Workspace brand pack block. Cached 5m.
- Scope context block. Cached 5m.

User message:
- Brief (topic, audience, data_focus, language).
- Attached evidence as `container_upload` blocks (CSV/XLSX/PDF for the four
  evidence_doc_ids).
- Required output files: `slide.pptx`, `slide_thumbnail.png`,
  `slide_manifest.json`.

Hard cap: 90 seconds wall, $0.50 budget. If exceeded the run errors out with
`error_message: "quick_slide_exceeded_budget"`.

After the model finishes:
- Validate `slide.pptx` is a real PPTX (zip header check + slide1.xml present).
- Validate `slide_thumbnail.png` is a non-empty PNG.
- Upload both to `quick-slides/{workspace_id}/{run_id}/`.
- Update row to `status: "ready"`.

### Chat-side rendering

New chip type in `ToolChips.tsx`: `QuickSlideCard`.

States:
- `queued`: neutral chip "Drafting your slide…" with the brief title.
- `running`: same chip plus a phase line ("Reading the workbook" /
  "Generating chart" / "Rendering slide"), animated dot, no progress bar.
- `ready`: chip flips to a horizontal preview card: PNG thumbnail on the
  left, title and download button on the right. Click thumbnail to preview
  full-size in a modal.
- `error`: soft red, plain-language message, retry button that POSTs the
  same brief.

Polling: 1.5s interval, exponential backoff to 5s after 30s. Stops on
`ready` or `error`. Max 90s of polling, then the chip surfaces "still
working, refresh to check" so the tab is never stuck.

### Cost & telemetry

- Each run writes a row to `chat_tool_telemetry` with tool name
  `quickSlide` and the cost from the Anthropic usage object.
- Daily roll-up Discord ping if quick-slide median cost > $0.40 or median
  duration > 75s.
- Soft per-user cap: 12 quick slides per hour. Past 12, the tool returns
  `ok: false, error: "rate_limited"` and the agent says "you have used your
  hourly quick-slide budget; the next slot opens at HH:MM".

## Risks and decisions

- **Why not reuse the V6 deck pipeline with `slideCount: 1`?** Because that
  pipeline reserves cover/structural slides, runs the full understand→author→
  critique→export sequence, and takes 15+ minutes. None of that fits "quick".
- **Why a dedicated worker and not inline in the chat route?** Chat route
  runs on Vercel which has a 60s function timeout in production. The quick
  slide cap is 90s. Either: (a) use a dedicated Vercel fluid-compute route
  with extended timeout, or (b) push the job onto the existing Railway worker
  with a `quick: true` flag. (a) is simpler, ship that first.
- **Why no web fetch?** The user can call webSearch separately and then ask
  for a quick slide. Bundling research into the quick slide doubles the
  duration and the failure surface.
- **Why thumbnail PNG?** Without it, the chat chip has nothing to show
  while the user decides whether to download. The PNG is rendered by Claude
  in the same Anthropic call (matplotlib for chart slides, pillow for
  layout-only slides) and adds about 5-8s but the UX win is large.

## Definition of done

A real-feeling slide ships in median 45s, costs median $0.25, ingests the
workspace brand pack + scope context + attached evidence the same way the
full deck does, and the user can download a PPTX that opens cleanly in
PowerPoint, Keynote, and Google Slides.

When 5 consecutive runs hit those numbers in production telemetry, the
feature is GA. Until then it stays behind a flag (`QUICK_SLIDE_ENABLED=true`)
gated to @basquio.com emails.

## Out-of-scope but related (do not bundle)

- "Quick memo" or same idea, but produces a Word doc. Reuse most of this spec
  with the existing DOCX export path.
- Slide editing in chat ("change the chart title", "make the source line
  smaller"). V2 work.
- Multi-language deck packs. The full V6 pipeline already handles language;
  quick slide stays single-language per run.

## Estimated effort

- Migrations + DAL: half a day.
- Worker pipeline + few-shot examples: 1-2 days.
- Chat chip + polling + thumbnail preview: half a day.
- Production telemetry + budget guard: half a day.
- E2E smoke + visual QA against the 5-run definition-of-done: a day.

Total: 3-4 working days. NOT bundleable with a same-day chat-CRUD ship.
