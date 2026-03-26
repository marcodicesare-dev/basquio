alter table public.deck_runs
  add column if not exists notify_on_complete boolean not null default false;
