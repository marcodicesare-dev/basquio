create extension if not exists pgcrypto;

create type public.basquio_file_kind as enum ('workbook', 'pptx', 'pdf', 'unknown');
create type public.basquio_job_status as enum ('queued', 'running', 'completed', 'failed', 'needs_input');
create type public.basquio_step_status as enum ('queued', 'running', 'completed', 'failed', 'needs_input');
create type public.basquio_artifact_kind as enum ('pptx', 'pdf');
create type public.basquio_membership_role as enum ('owner', 'admin', 'editor', 'viewer');

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.basquio_membership_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  objective text,
  audience text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.source_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  kind public.basquio_file_kind not null,
  file_name text not null,
  storage_bucket text not null default 'source-files',
  storage_path text not null,
  file_bytes bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_file_id uuid not null references public.source_files(id) on delete cascade,
  dataset_profile jsonb not null default '{}'::jsonb,
  deterministic_analysis jsonb not null default '{}'::jsonb,
  status public.basquio_job_status not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_file_id)
);

create table if not exists public.template_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_file_id uuid references public.source_files(id) on delete set null,
  source_type text not null,
  template_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  dataset_id uuid references public.datasets(id) on delete set null,
  template_profile_id uuid references public.template_profiles(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  status public.basquio_job_status not null default 'queued',
  business_context text,
  audience text,
  objective text,
  story_spec jsonb not null default '{}'::jsonb,
  slide_plan jsonb not null default '[]'::jsonb,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.generation_job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  stage text not null,
  status public.basquio_step_status not null default 'queued',
  detail text not null default '',
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  kind public.basquio_artifact_kind not null,
  storage_bucket text not null default 'artifacts',
  storage_path text not null,
  mime_type text not null,
  file_bytes bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values
  ('source-files', 'source-files', false),
  ('templates', 'templates', false),
  ('artifacts', 'artifacts', false)
on conflict (id) do nothing;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.projects enable row level security;
alter table public.source_files enable row level security;
alter table public.datasets enable row level security;
alter table public.template_profiles enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generation_job_steps enable row level security;
alter table public.artifacts enable row level security;
