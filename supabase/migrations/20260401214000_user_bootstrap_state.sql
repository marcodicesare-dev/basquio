create table if not exists public.user_bootstrap_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_authenticated_at timestamptz not null default now(),
  last_authenticated_at timestamptz not null default now(),
  workspace_initialized_at timestamptz,
  welcome_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_bootstrap_state enable row level security;

create policy "Users can read own bootstrap state"
  on public.user_bootstrap_state
  for select
  using (auth.uid() = user_id);

create policy "Users can update own bootstrap state"
  on public.user_bootstrap_state
  for update
  using (auth.uid() = user_id);

create policy "Users can insert own bootstrap state"
  on public.user_bootstrap_state
  for insert
  with check (auth.uid() = user_id);
