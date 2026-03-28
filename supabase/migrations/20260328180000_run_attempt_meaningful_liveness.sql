alter table public.deck_run_attempts
  add column if not exists last_meaningful_event_at timestamptz;

-- Existing attempts without heartbeat-style meaningful event markers should fail-safe to prior update time,
-- so stale recovery remains compatible with legacy rows.
update public.deck_run_attempts
set last_meaningful_event_at = coalesce(last_meaningful_event_at, updated_at)
where last_meaningful_event_at is null;

create index if not exists deck_run_attempts_last_meaningful_event_idx
  on public.deck_run_attempts(run_id, last_meaningful_event_at)
  where status in ('queued', 'running') and last_meaningful_event_at is not null;
