-- Fixup: add RLS policies that failed in the initial migration
-- (original referenced organization_members, correct table is organization_memberships)

-- Ensure RLS is enabled (idempotent)
alter table public.organization_template_settings enable row level security;
alter table public.template_import_jobs enable row level security;

-- Drop if somehow partially created, then recreate
drop policy if exists "org_template_settings_select" on public.organization_template_settings;
create policy "org_template_settings_select"
  on public.organization_template_settings for select
  using (
    organization_id in (
      select organization_id from public.organization_memberships
      where user_id = auth.uid()
    )
  );

drop policy if exists "template_import_jobs_select" on public.template_import_jobs;
create policy "template_import_jobs_select"
  on public.template_import_jobs for select
  using (
    organization_id in (
      select organization_id from public.organization_memberships
      where user_id = auth.uid()
    )
  );
