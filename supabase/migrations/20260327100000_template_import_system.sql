-- Template import system: workspace-level template management
-- Adds columns to template_profiles, creates organization_template_settings,
-- and creates template_import_jobs for async import workflow.

-- 1. Add new columns to template_profiles
alter table public.template_profiles
  add column if not exists name text,
  add column if not exists status text not null default 'ready',
  add column if not exists failure_message text,
  add column if not exists imported_by uuid references auth.users(id) on delete set null,
  add column if not exists fingerprint text,
  add column if not exists layout_count integer,
  add column if not exists preview_payload jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill existing rows to 'ready' status (they were already successfully parsed)
update public.template_profiles set status = 'ready' where status is null or status = '';

-- 2. Organization template settings (single source of truth for workspace default)
create table if not exists public.organization_template_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_template_profile_id uuid references public.template_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 3. Template import jobs table
create table if not exists public.template_import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  source_file_id uuid not null references public.source_files(id) on delete cascade,
  template_profile_id uuid references public.template_profiles(id) on delete set null,
  status text not null default 'queued',
  current_phase text,
  failure_message text,
  set_as_default boolean not null default false,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_template_import_jobs_status
  on public.template_import_jobs (status, created_at)
  where status = 'queued';

create index if not exists idx_template_import_jobs_org
  on public.template_import_jobs (organization_id, created_at desc);

-- 4. RLS policies
alter table public.organization_template_settings enable row level security;
alter table public.template_import_jobs enable row level security;

-- organization_template_settings: members of the org can read; service role manages writes
create policy "org_template_settings_select"
  on public.organization_template_settings for select
  using (
    organization_id in (
      select organization_id from public.organization_memberships
      where user_id = auth.uid()
    )
  );

-- template_import_jobs: members of the org can read their import jobs
create policy "template_import_jobs_select"
  on public.template_import_jobs for select
  using (
    organization_id in (
      select organization_id from public.organization_memberships
      where user_id = auth.uid()
    )
  );
