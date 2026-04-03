create table if not exists public.template_fee_checkout_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  template_profile_id uuid not null references public.template_profiles(id) on delete cascade,
  source_file_ids uuid[] not null default '{}',
  brief jsonb not null default '{}'::jsonb,
  target_slide_count integer not null,
  author_model text not null check (author_model in ('claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5')),
  recipe_id uuid references public.recipes(id) on delete set null,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'consumed', 'cancelled', 'expired')),
  stripe_checkout_session_id text unique,
  paid_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_template_fee_checkout_drafts_user_status
  on public.template_fee_checkout_drafts (user_id, status, created_at desc);

create index if not exists idx_template_fee_checkout_drafts_expires_at
  on public.template_fee_checkout_drafts (expires_at);

alter table public.template_fee_checkout_drafts enable row level security;

drop policy if exists "Users see own template fee checkout drafts" on public.template_fee_checkout_drafts;
create policy "Users see own template fee checkout drafts"
  on public.template_fee_checkout_drafts for select
  using (auth.uid() = user_id);
