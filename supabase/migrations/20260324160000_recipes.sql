-- Report recipes: saved configurations for recurring deck generation.
-- A recipe snapshots the brief, template, and report type from a completed run.
-- Users rerun recipes monthly by uploading new data files.

create table if not exists public.recipes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  name          text not null,
  description   text,

  -- Saved configuration
  report_type   text,
  brief         jsonb not null default '{}',
  template_profile_id uuid references public.template_profiles(id) on delete set null,
  target_slide_count integer not null default 10,

  -- Provenance: which run was this recipe derived from?
  source_run_id uuid references public.deck_runs(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_recipes_user
  on public.recipes(user_id, created_at desc);

-- Link runs back to recipes
alter table public.deck_runs
  add column if not exists recipe_id uuid references public.recipes(id) on delete set null;

create index if not exists idx_deck_runs_recipe
  on public.deck_runs(recipe_id) where recipe_id is not null;

-- RLS
alter table public.recipes enable row level security;

create policy "Users can read own recipes"
  on public.recipes for select
  using (auth.uid() = user_id);

create policy "Users can insert own recipes"
  on public.recipes for insert
  with check (auth.uid() = user_id);

create policy "Users can update own recipes"
  on public.recipes for update
  using (auth.uid() = user_id);

create policy "Users can delete own recipes"
  on public.recipes for delete
  using (auth.uid() = user_id);
