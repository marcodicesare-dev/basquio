alter table public.deck_runs
  add column if not exists workspace_id text,
  add column if not exists workspace_scope_id text,
  add column if not exists conversation_id text,
  add column if not exists from_message_id text,
  add column if not exists launch_source text not null default 'jobs-new',
  add column if not exists workspace_context_pack jsonb,
  add column if not exists workspace_context_pack_hash text;

create index if not exists deck_runs_workspace_id_idx
  on public.deck_runs(workspace_id)
  where workspace_id is not null;

create index if not exists deck_runs_workspace_scope_id_idx
  on public.deck_runs(workspace_scope_id)
  where workspace_scope_id is not null;

create or replace function public.enqueue_deck_run(
  p_run_id uuid,
  p_attempt_id uuid,
  p_organization_id uuid,
  p_project_id uuid,
  p_requested_by uuid,
  p_brief jsonb,
  p_business_context text,
  p_client text,
  p_audience text,
  p_objective text,
  p_thesis text,
  p_stakes text,
  p_source_file_ids uuid[],
  p_target_slide_count integer default 10,
  p_author_model text default 'claude-sonnet-4-6',
  p_template_profile_id uuid default null,
  p_recipe_id uuid default null,
  p_notify_on_complete boolean default true,
  p_charge_credits boolean default false,
  p_credit_amount integer default null,
  p_workspace_id text default null,
  p_workspace_scope_id text default null,
  p_conversation_id text default null,
  p_from_message_id text default null,
  p_launch_source text default 'jobs-new',
  p_workspace_context_pack jsonb default null,
  p_workspace_context_pack_hash text default null
) returns table (
  run_id uuid,
  attempt_id uuid,
  insufficient_credits boolean
)
language plpgsql
security definer
as $$
declare
  v_debit_result record;
  v_existing_requested_by uuid;
  v_existing_attempt_id uuid;
begin
  if p_target_slide_count is null or p_target_slide_count < 1 or p_target_slide_count > 100 then
    raise exception 'target slide count must be between 1 and 100';
  end if;

  if p_author_model not in ('claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-haiku-4-5') then
    raise exception 'author_model must be claude-sonnet-4-6, claude-opus-4-6, claude-opus-4-7, or claude-haiku-4-5';
  end if;

  if p_charge_credits and (p_credit_amount is null or p_credit_amount <= 0) then
    raise exception 'credit amount must be positive when charging credits';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_run_id::text, 0));

  select requested_by, coalesce(active_attempt_id, latest_attempt_id)
  into v_existing_requested_by, v_existing_attempt_id
  from public.deck_runs
  where id = p_run_id
  limit 1;

  if found then
    if v_existing_requested_by <> p_requested_by then
      raise exception 'run id already exists for a different user';
    end if;

    return query
    select p_run_id, v_existing_attempt_id, false;
    return;
  end if;

  if p_charge_credits then
    select * into v_debit_result
    from public.debit_credits_fifo(
      p_requested_by,
      p_credit_amount,
      'run_debit',
      p_run_id::text
    );

    if not v_debit_result.success then
      return query
      select null::uuid, null::uuid, true;
      return;
    end if;
  end if;

  insert into public.deck_runs (
    id,
    organization_id,
    project_id,
    requested_by,
    brief,
    business_context,
    client,
    audience,
    objective,
    thesis,
    stakes,
    source_file_ids,
    target_slide_count,
    author_model,
    template_profile_id,
    recipe_id,
    notify_on_complete,
    workspace_id,
    workspace_scope_id,
    conversation_id,
    from_message_id,
    launch_source,
    workspace_context_pack,
    workspace_context_pack_hash,
    status,
    active_attempt_id,
    latest_attempt_id,
    latest_attempt_number
  ) values (
    p_run_id,
    p_organization_id,
    p_project_id,
    p_requested_by,
    coalesce(p_brief, '{}'::jsonb),
    coalesce(p_business_context, ''),
    coalesce(p_client, ''),
    coalesce(p_audience, 'Executive stakeholder'),
    coalesce(p_objective, ''),
    coalesce(p_thesis, ''),
    coalesce(p_stakes, ''),
    coalesce(p_source_file_ids, '{}'::uuid[]),
    p_target_slide_count,
    p_author_model,
    p_template_profile_id,
    p_recipe_id,
    coalesce(p_notify_on_complete, true),
    p_workspace_id,
    p_workspace_scope_id,
    p_conversation_id,
    p_from_message_id,
    coalesce(nullif(p_launch_source, ''), 'jobs-new'),
    p_workspace_context_pack,
    p_workspace_context_pack_hash,
    'queued',
    null,
    null,
    1
  );

  insert into public.deck_run_attempts (
    id,
    run_id,
    attempt_number,
    status
  ) values (
    p_attempt_id,
    p_run_id,
    1,
    'queued'
  );

  update public.deck_runs
  set
    active_attempt_id = p_attempt_id,
    latest_attempt_id = p_attempt_id
  where id = p_run_id;

  return query
  select p_run_id, p_attempt_id, false;
end;
$$;
