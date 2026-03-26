-- Account-level notification preference + idempotency guard
-- Extends the existing user_preferences pattern by adding a user_preferences table
-- and a completion_email_sent_at idempotency field on deck_runs.

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  notify_on_run_complete boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "Users can read own preferences"
  on public.user_preferences
  for select
  using (auth.uid() = user_id);

create policy "Users can update own preferences"
  on public.user_preferences
  for update
  using (auth.uid() = user_id);

create policy "Users can insert own preferences"
  on public.user_preferences
  for insert
  with check (auth.uid() = user_id);

-- Idempotency: track when completion email was sent so retries don't duplicate
alter table public.deck_runs
  add column if not exists completion_email_sent_at timestamptz;
