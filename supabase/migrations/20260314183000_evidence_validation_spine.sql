do $$
begin
  if not exists (
    select 1
    from pg_enum
    where enumlabel = 'document'
      and enumtypid = 'public.basquio_file_kind'::regtype
  ) then
    alter type public.basquio_file_kind add value 'document';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_enum
    where enumlabel = 'brand-tokens'
      and enumtypid = 'public.basquio_file_kind'::regtype
  ) then
    alter type public.basquio_file_kind add value 'brand-tokens';
  end if;
end $$;

alter table public.source_files
  add column if not exists external_id text,
  add column if not exists media_type text default 'application/octet-stream';

create unique index if not exists source_files_external_id_key on public.source_files (external_id) where external_id is not null;

alter table public.datasets
  alter column source_file_id drop not null;

drop index if exists public.datasets_source_file_id_key;

alter table public.datasets
  add column if not exists external_id text,
  add column if not exists manifest jsonb not null default '{}'::jsonb;

create unique index if not exists datasets_external_id_key on public.datasets (external_id) where external_id is not null;

create table if not exists public.dataset_source_files (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  source_file_id uuid not null references public.source_files(id) on delete cascade,
  file_role text not null default 'unknown-support',
  parsed_sheet_count integer not null default 0,
  is_primary boolean not null default false,
  is_brand boolean not null default false,
  notes jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists dataset_source_files_dataset_id_source_file_id_key
  on public.dataset_source_files (dataset_id, source_file_id);

alter table public.generation_jobs
  add column if not exists job_key text,
  add column if not exists brief jsonb not null default '{}'::jsonb,
  add column if not exists report_outline jsonb not null default '{}'::jsonb,
  add column if not exists validation_report jsonb not null default '{}'::jsonb,
  add column if not exists quality_report jsonb not null default '{}'::jsonb,
  add column if not exists artifact_manifest jsonb not null default '{}'::jsonb,
  add column if not exists summary jsonb;

create unique index if not exists generation_jobs_job_key_key on public.generation_jobs (job_key) where job_key is not null;

create unique index if not exists generation_job_steps_job_id_stage_key
  on public.generation_job_steps (job_id, stage);

create unique index if not exists artifacts_job_id_kind_key
  on public.artifacts (job_id, kind);

alter table public.dataset_source_files enable row level security;
