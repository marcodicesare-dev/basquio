-- V2 Canonical State Objects
-- Replaces: generation_jobs + generation_job_steps with event-sourced DeckRun model
-- New tables: deck_runs, evidence_workspaces, analysis_notebook_entries, deck_spec_v2_slides, artifact_manifests_v2

-- ─── ENUMS ─────────────────────────────────────────────────────────
create type public.deck_run_phase as enum (
  'normalize',
  'understand',
  'author',
  'critique',
  'revise',
  'export'
);

create type public.deck_run_status as enum (
  'queued',
  'running',
  'completed',
  'failed'
);

-- ─── DECK_RUNS ─────────────────────────────────────────────────────
-- One durable job record with checkpoints, retries, replay, and event history.
-- Replaces: generation_jobs + synthetic run-status
create table if not exists public.deck_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,

  -- Brief / request context
  brief jsonb not null default '{}'::jsonb,
  business_context text not null default '',
  client text not null default '',
  audience text not null default 'Executive stakeholder',
  objective text not null default '',
  thesis text not null default '',
  stakes text not null default '',

  -- Source files (array of {id, fileName, kind, storageBucket, storagePath})
  source_file_ids uuid[] not null default '{}',
  template_profile_id uuid references public.template_profiles(id) on delete set null,

  -- State machine
  status public.deck_run_status not null default 'queued',
  current_phase public.deck_run_phase,
  phase_started_at timestamptz,

  -- Error handling
  failure_message text,
  failure_phase public.deck_run_phase,
  retry_count integer not null default 0,

  -- Inngest correlation
  inngest_run_id text,

  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_deck_runs_status on public.deck_runs(status);
create index idx_deck_runs_project on public.deck_runs(project_id);
create index idx_deck_runs_org on public.deck_runs(organization_id);

-- ─── DECK_RUN_EVENTS ──────────────────────────────────────────────
-- Event-sourced progress from real tool calls, not synthetic stages.
-- Replaces: generation_job_steps + synthetic run-status
create table if not exists public.deck_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade,
  phase public.deck_run_phase not null,
  event_type text not null, -- 'phase_started', 'tool_call', 'tool_result', 'phase_completed', 'error', 'checkpoint'
  tool_name text,
  step_number integer,
  payload jsonb not null default '{}'::jsonb,
  usage jsonb, -- {inputTokens, outputTokens, totalTokens}
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index idx_deck_run_events_run on public.deck_run_events(run_id);
create index idx_deck_run_events_phase on public.deck_run_events(run_id, phase);

-- ─── EVIDENCE_WORKSPACES ──────────────────────────────────────────
-- Normalized uploaded files + extracted text/tables + brand/template assets + support docs.
-- Replaces: current intake/profiling stage output scattered across datasets + generation_jobs
create table if not exists public.evidence_workspaces (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade unique,

  -- Parsed file inventory
  file_inventory jsonb not null default '[]'::jsonb,
  -- [{id, fileName, kind, role, mediaType, sheets: [{name, rowCount, columns: [...]}], textContent?, warnings}]

  -- Dataset profile (preserved from v1 for compatibility)
  dataset_profile jsonb not null default '{}'::jsonb,

  -- Package semantics (if computed during normalize)
  package_semantics jsonb,

  -- Template profile snapshot
  template_profile jsonb,

  -- Row data stored as JSONB arrays per sheet
  -- Key: "fileId:sheetName", Value: array of row objects
  sheet_data jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── ANALYSIS_NOTEBOOK_ENTRIES ────────────────────────────────────
-- Every tool call, query result, evidence ref, chart dataset, and reasoning checkpoint.
-- Persisted with stable IDs. Makes runs debuggable, replayable, eval-ready.
-- Replaces: current analytics result blob
create table if not exists public.analysis_notebook_entries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade,
  phase public.deck_run_phase not null,
  step_number integer not null,
  tool_name text not null,
  tool_input jsonb not null default '{}'::jsonb,
  tool_output jsonb not null default '{}'::jsonb,
  evidence_ref_id text, -- stable evidence ID if this entry created an evidence ref
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index idx_notebook_entries_run on public.analysis_notebook_entries(run_id);
create index idx_notebook_entries_phase on public.analysis_notebook_entries(run_id, phase);
create index idx_notebook_entries_evidence on public.analysis_notebook_entries(evidence_ref_id) where evidence_ref_id is not null;

-- ─── DECK_SPEC_V2_SLIDES ─────────────────────────────────────────
-- Working deck state, slide by slide. Built incrementally by the author agent.
-- Replaces: current slide_plan jsonb blob on generation_jobs
create table if not exists public.deck_spec_v2_slides (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade,
  position integer not null,
  layout_id text not null,
  title text not null default '',
  subtitle text,
  body text,
  bullets jsonb, -- string[]
  chart_id text, -- reference to a chart built via build_chart tool
  metrics jsonb, -- [{label, value, delta?}]
  evidence_ids jsonb not null default '[]'::jsonb, -- string[]
  speaker_notes text,
  transition text,
  scene_graph jsonb, -- unified scene graph for rendering (both PPTX and PDF)
  preview_url text, -- rendered preview thumbnail
  qa_status text, -- 'pending' | 'passed' | 'failed'
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, position, revision)
);

create index idx_deck_spec_slides_run on public.deck_spec_v2_slides(run_id);

-- ─── DECK_SPEC_V2_CHARTS ─────────────────────────────────────────
-- Charts built by the author agent via build_chart tool.
create table if not exists public.deck_spec_v2_charts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade,
  chart_type text not null,
  title text not null default '',
  data jsonb not null default '[]'::jsonb,
  x_axis text,
  y_axis text,
  series jsonb, -- string[]
  style jsonb, -- {colors, showLegend, showValues}
  thumbnail_url text,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);

create index idx_deck_spec_charts_run on public.deck_spec_v2_charts(run_id);

-- ─── ARTIFACT_MANIFESTS_V2 ───────────────────────────────────────
-- Only published after export + QA pass. Replaces current artifact persistence (which races with status).
create table if not exists public.artifact_manifests_v2 (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade unique,
  slide_count integer not null,
  page_count integer,
  qa_passed boolean not null default false,
  qa_report jsonb not null default '{}'::jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  -- [{id, kind, fileName, mimeType, storageBucket, storagePath, fileBytes, checksumSha256}]
  published_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─── CRITIQUE_REPORTS ─────────────────────────────────────────────
-- Persisted critique results for audit trail
create table if not exists public.critique_reports (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade,
  iteration integer not null default 1,
  has_issues boolean not null default false,
  issues jsonb not null default '[]'::jsonb,
  -- [{type, severity, slideId?, claim?, expectedValue?, actualValue?, evidence?, suggestion}]
  coverage_score numeric(3,2),
  accuracy_score numeric(3,2),
  narrative_score numeric(3,2),
  model_id text,
  provider text,
  usage jsonb,
  created_at timestamptz not null default now()
);

create index idx_critique_reports_run on public.critique_reports(run_id);

-- ─── RLS ──────────────────────────────────────────────────────────
alter table public.deck_runs enable row level security;
alter table public.deck_run_events enable row level security;
alter table public.evidence_workspaces enable row level security;
alter table public.analysis_notebook_entries enable row level security;
alter table public.deck_spec_v2_slides enable row level security;
alter table public.deck_spec_v2_charts enable row level security;
alter table public.artifact_manifests_v2 enable row level security;
alter table public.critique_reports enable row level security;

-- ─── STORAGE BUCKET FOR PREVIEWS ──────────────────────────────────
insert into storage.buckets (id, name, public)
values ('deck-previews', 'deck-previews', false)
on conflict (id) do nothing;
