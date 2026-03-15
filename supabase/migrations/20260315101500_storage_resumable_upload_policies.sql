do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'basquio_jobs_upload_insert'
  ) then
    create policy basquio_jobs_upload_insert
      on storage.objects
      for insert
      to anon, authenticated
      with check (
        bucket_id in ('source-files', 'templates')
        and name like 'jobs/%'
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'basquio_jobs_upload_update'
  ) then
    create policy basquio_jobs_upload_update
      on storage.objects
      for update
      to anon, authenticated
      using (
        bucket_id in ('source-files', 'templates')
        and name like 'jobs/%'
      )
      with check (
        bucket_id in ('source-files', 'templates')
        and name like 'jobs/%'
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'basquio_jobs_upload_select'
  ) then
    create policy basquio_jobs_upload_select
      on storage.objects
      for select
      to anon, authenticated
      using (
        bucket_id in ('source-files', 'templates')
        and name like 'jobs/%'
      );
  end if;
end
$$;
