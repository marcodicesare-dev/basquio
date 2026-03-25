alter table public.deck_runs
  add column if not exists template_diagnostics jsonb not null default '{}'::jsonb;
