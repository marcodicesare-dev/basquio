alter table public.generation_jobs
  add column if not exists execution_owner text,
  add column if not exists execution_started_at timestamptz,
  add column if not exists execution_heartbeat_at timestamptz;
