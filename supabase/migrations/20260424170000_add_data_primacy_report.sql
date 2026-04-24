alter table public.deck_runs
  add column if not exists data_primacy_report jsonb;

alter table public.deck_runs
  add column if not exists advisory_issues jsonb default '[]'::jsonb;

alter table public.deck_runs
  add column if not exists scope_adjustment text;

alter table public.deck_runs
  add column if not exists fetched_urls jsonb default '[]'::jsonb;

alter table public.deck_run_request_usage
  add column if not exists web_fetch_count int default 0;

create table if not exists public.cost_anomaly_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.deck_runs(id),
  phase text not null,
  model text not null,
  projected_usd numeric,
  soft_cap_usd numeric,
  spent_usd numeric,
  created_at timestamptz default now()
);

create index if not exists idx_cost_anomaly_events_run_id on public.cost_anomaly_events(run_id);
