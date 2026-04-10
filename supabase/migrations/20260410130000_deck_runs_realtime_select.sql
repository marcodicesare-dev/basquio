alter table public.deck_runs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'deck_runs'
      and policyname = 'deck_runs_select_owner'
  ) then
    create policy deck_runs_select_owner
      on public.deck_runs
      for select
      to authenticated
      using (requested_by = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'deck_runs'
  ) then
    alter publication supabase_realtime add table public.deck_runs;
  end if;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication is not present in this environment; skipping deck_runs publication update';
end $$;
