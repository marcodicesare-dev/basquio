create or replace function public.recover_deck_run_attempt(
  p_run_id uuid,
  p_old_attempt_id uuid,
  p_new_attempt_id uuid,
  p_new_attempt_number integer,
  p_recovery_reason text,
  p_now timestamptz,
  p_expected_old_status text default null,
  p_old_status_override text default null,
  p_failure_phase text default null,
  p_failure_message text default null
) returns table (
  attempt_id uuid,
  attempt_number integer
)
language plpgsql
security definer
as $$
begin
  perform 1
  from public.deck_runs
  where id = p_run_id
  for update;

  update public.deck_run_attempts
  set
    status = coalesce(
      p_old_status_override,
      case
        when status in ('queued', 'running') then 'failed'
        else status
      end
    ),
    failure_phase = coalesce(p_failure_phase, failure_phase),
    failure_message = coalesce(p_failure_message, failure_message),
    updated_at = p_now
  where id = p_old_attempt_id
    and run_id = p_run_id
    and superseded_by_attempt_id is null
    and (p_expected_old_status is null or status = p_expected_old_status);

  if not found then
    return;
  end if;

  insert into public.deck_run_attempts (
    id,
    run_id,
    attempt_number,
    status,
    recovery_reason,
    created_at,
    updated_at,
    supersedes_attempt_id
  ) values (
    p_new_attempt_id,
    p_run_id,
    p_new_attempt_number,
    'queued',
    p_recovery_reason,
    p_now,
    p_now,
    p_old_attempt_id
  );

  update public.deck_run_attempts
  set
    superseded_by_attempt_id = p_new_attempt_id,
    updated_at = p_now
  where id = p_old_attempt_id
    and run_id = p_run_id
    and superseded_by_attempt_id is null;

  update public.deck_runs
  set
    status = 'queued',
    failure_message = null,
    failure_phase = null,
    delivery_status = 'draft',
    updated_at = p_now,
    active_attempt_id = p_new_attempt_id,
    latest_attempt_id = p_new_attempt_id,
    latest_attempt_number = p_new_attempt_number
  where id = p_run_id;

  return query
  select p_new_attempt_id, p_new_attempt_number;
end;
$$;
