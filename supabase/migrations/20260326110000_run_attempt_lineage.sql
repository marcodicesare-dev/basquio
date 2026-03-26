create table if not exists public.deck_run_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled', 'superseded')),
  recovery_reason text,
  failure_phase text,
  failure_message text,
  cost_telemetry jsonb,
  anthropic_request_ids jsonb not null default '[]'::jsonb,
  worker_deployment_id text,
  started_at timestamptz,
  completed_at timestamptz,
  superseded_by_attempt_id uuid references public.deck_run_attempts(id) on delete set null,
  supersedes_attempt_id uuid references public.deck_run_attempts(id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (run_id, attempt_number)
);

create index if not exists deck_run_attempts_run_idx
  on public.deck_run_attempts(run_id, created_at desc);

create unique index if not exists deck_run_attempts_one_active_idx
  on public.deck_run_attempts(run_id)
  where status in ('queued', 'running')
    and superseded_by_attempt_id is null;

alter table public.deck_runs
  add column if not exists active_attempt_id uuid references public.deck_run_attempts(id) on delete set null,
  add column if not exists latest_attempt_id uuid references public.deck_run_attempts(id) on delete set null,
  add column if not exists successful_attempt_id uuid references public.deck_run_attempts(id) on delete set null,
  add column if not exists latest_attempt_number integer not null default 1;

alter table public.deck_run_events
  add column if not exists attempt_id uuid references public.deck_run_attempts(id) on delete cascade,
  add column if not exists attempt_number integer;

create index if not exists deck_run_events_run_attempt_idx
  on public.deck_run_events(run_id, attempt_id, created_at asc);

create table if not exists public.deck_run_request_usage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade,
  attempt_id uuid not null references public.deck_run_attempts(id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),
  phase text not null,
  request_kind text not null,
  provider text not null default 'anthropic',
  model text not null,
  anthropic_request_id text,
  usage jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists deck_run_request_usage_run_attempt_idx
  on public.deck_run_request_usage(run_id, attempt_id, created_at asc);

with inserted_attempts as (
  insert into public.deck_run_attempts (
    run_id,
    attempt_number,
    status,
    failure_phase,
    failure_message,
    cost_telemetry,
    started_at,
    completed_at,
    created_at,
    updated_at
  )
  select
    runs.id,
    1,
    case
      when runs.status = 'queued' then 'queued'
      when runs.status = 'running' then 'running'
      when runs.status = 'completed' then 'completed'
      else 'failed'
    end,
    runs.failure_phase,
    runs.failure_message,
    runs.cost_telemetry,
    runs.created_at,
    case when runs.status in ('completed', 'failed') then coalesce(runs.completed_at, runs.updated_at, runs.created_at) else null end,
    runs.created_at,
    coalesce(runs.updated_at, runs.created_at)
  from public.deck_runs runs
  where not exists (
    select 1
    from public.deck_run_attempts attempts
    where attempts.run_id = runs.id
  )
  returning id, run_id, attempt_number, status
)
update public.deck_runs runs
set
  latest_attempt_id = attempts.id,
  active_attempt_id = case when attempts.status in ('queued', 'running') then attempts.id else runs.active_attempt_id end,
  successful_attempt_id = case when attempts.status = 'completed' then attempts.id else runs.successful_attempt_id end,
  latest_attempt_number = attempts.attempt_number
from public.deck_run_attempts attempts
where attempts.run_id = runs.id
  and (runs.latest_attempt_id is null or attempts.id = runs.latest_attempt_id or attempts.attempt_number >= runs.latest_attempt_number);

update public.deck_run_events events
set
  attempt_id = attempts.id,
  attempt_number = attempts.attempt_number
from public.deck_run_attempts attempts
where attempts.run_id = events.run_id
  and attempts.attempt_number = 1
  and events.attempt_id is null;
