alter table public.artifact_manifests_v2
  add column if not exists preview_assets jsonb not null default '[]'::jsonb;

create table if not exists public.artifact_download_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.deck_runs(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  artifact_kind text not null,
  disposition text not null default 'attachment',
  created_at timestamptz not null default now()
);

create index if not exists idx_artifact_download_events_run_created
  on public.artifact_download_events(run_id, created_at desc);

create index if not exists idx_artifact_download_events_user_created
  on public.artifact_download_events(requested_by, created_at desc);

alter table public.artifact_download_events enable row level security;

create policy "Users can read own artifact download events"
  on public.artifact_download_events
  for select
  using (
    exists (
      select 1
      from public.deck_runs runs
      where runs.id = artifact_download_events.run_id
        and runs.requested_by = auth.uid()
    )
  );

create table if not exists public.user_engagement_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  notification_key text not null unique,
  notification_type text not null,
  run_id uuid references public.deck_runs(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now()
);

create index if not exists idx_user_engagement_notifications_user_sent
  on public.user_engagement_notifications(user_id, sent_at desc);

create index if not exists idx_user_engagement_notifications_run_sent
  on public.user_engagement_notifications(run_id, sent_at desc);

alter table public.user_engagement_notifications enable row level security;

create policy "Users can read own engagement notifications"
  on public.user_engagement_notifications
  for select
  using (auth.uid() = user_id);
