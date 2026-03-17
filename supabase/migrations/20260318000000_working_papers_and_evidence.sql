-- Working Papers + Evidence Entries + Slide enrichment columns
-- Adds durable intermediate artifacts, typed evidence registry, and rich slide contract fields.

-- ─── WORKING_PAPERS ─────────────────────────────────────────────────
-- Durable intermediate artifacts per run (clarified brief, storyline plan, etc.)
create table if not exists public.working_papers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade,
  paper_type text not null, -- 'clarified_brief', 'storyline_plan', 'deck_plan', 'execution_brief'
  content jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, paper_type, version)
);

create index idx_working_papers_run on public.working_papers(run_id);
create index idx_working_papers_type on public.working_papers(run_id, paper_type);

-- ─── EVIDENCE_ENTRIES ───────────────────────────────────────────────
-- Typed evidence registry — structured view of notebook entries.
create table if not exists public.evidence_entries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade,
  evidence_type text not null, -- 'metric', 'table', 'derived_table', 'document', 'claim'
  ref_id text not null, -- the ev-xxx string
  label text not null default '',
  description text,
  value jsonb, -- type-dependent payload (number for metric, rows for table, text for document/claim)
  source_sheet_key text,
  source_notebook_entry_id uuid references public.analysis_notebook_entries(id) on delete set null,
  confidence numeric(3,2),
  created_at timestamptz not null default now(),
  unique (run_id, ref_id)
);

create index idx_evidence_entries_run on public.evidence_entries(run_id);
create index idx_evidence_entries_ref on public.evidence_entries(ref_id);
create index idx_evidence_entries_type on public.evidence_entries(run_id, evidence_type);

-- ─── DECK_SPEC_V2_SLIDES — ENRICHMENT COLUMNS ──────────────────────
-- Rich slide contract fields for consulting-grade output.
alter table public.deck_spec_v2_slides add column if not exists page_intent text;
alter table public.deck_spec_v2_slides add column if not exists governing_thought text;
alter table public.deck_spec_v2_slides add column if not exists chart_intent text;
alter table public.deck_spec_v2_slides add column if not exists focal_object text;
alter table public.deck_spec_v2_slides add column if not exists decision_ask text;
alter table public.deck_spec_v2_slides add column if not exists risk_note text;
alter table public.deck_spec_v2_slides add column if not exists highlight_categories jsonb;
alter table public.deck_spec_v2_slides add column if not exists recommendation_block jsonb;

-- ─── RLS ──────────────────────────────────────────────────────────
alter table public.working_papers enable row level security;
alter table public.evidence_entries enable row level security;
