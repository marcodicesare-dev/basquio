create or replace function public.complete_deck_run_attempt(
  p_run_id uuid,
  p_attempt_id uuid,
  p_attempt_number integer,
  p_completed_at timestamptz,
  p_delivery_status text,
  p_attempt_cost_telemetry jsonb,
  p_run_cost_telemetry jsonb,
  p_anthropic_request_ids jsonb,
  p_slide_count integer,
  p_page_count integer,
  p_qa_passed boolean,
  p_qa_report jsonb,
  p_artifacts jsonb,
  p_published_at timestamptz
) returns table (
  published boolean
)
language plpgsql
security definer
as $$
declare
  v_run public.deck_runs%rowtype;
  v_attempt public.deck_run_attempts%rowtype;
begin
  select *
  into v_run
  from public.deck_runs
  where id = p_run_id
  for update;

  if not found then
    return query
    select false;
    return;
  end if;

  select *
  into v_attempt
  from public.deck_run_attempts
  where id = p_attempt_id
  for update;

  if not found
    or v_attempt.run_id is distinct from p_run_id
    or v_attempt.superseded_by_attempt_id is not null
    or v_run.active_attempt_id is distinct from p_attempt_id then
    return query
    select false;
    return;
  end if;

  insert into public.artifact_manifests_v2 (
    run_id,
    slide_count,
    page_count,
    qa_passed,
    qa_report,
    artifacts,
    published_at
  ) values (
    p_run_id,
    p_slide_count,
    p_page_count,
    p_qa_passed,
    p_qa_report,
    p_artifacts,
    p_published_at
  )
  on conflict (run_id) do update
  set
    slide_count = excluded.slide_count,
    page_count = excluded.page_count,
    qa_passed = excluded.qa_passed,
    qa_report = excluded.qa_report,
    artifacts = excluded.artifacts,
    published_at = excluded.published_at;

  update public.deck_run_attempts
  set
    status = 'completed',
    updated_at = p_completed_at,
    completed_at = p_completed_at,
    cost_telemetry = p_attempt_cost_telemetry,
    anthropic_request_ids = coalesce(p_anthropic_request_ids, '[]'::jsonb)
  where id = p_attempt_id
    and superseded_by_attempt_id is null;

  if not found then
    return query
    select false;
    return;
  end if;

  update public.deck_runs
  set
    status = 'completed',
    current_phase = 'export',
    updated_at = p_completed_at,
    completed_at = p_completed_at,
    delivery_status = p_delivery_status,
    cost_telemetry = p_run_cost_telemetry,
    active_attempt_id = null,
    latest_attempt_id = p_attempt_id,
    latest_attempt_number = p_attempt_number,
    successful_attempt_id = p_attempt_id
  where id = p_run_id
    and active_attempt_id = p_attempt_id;

  if not found then
    return query
    select false;
    return;
  end if;

  return query
  select true;
end;
$$;

create or replace function public.refund_run_credit(
  p_run_id uuid
) returns table (
  refunded boolean,
  amount integer
)
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_debit_amount integer;
begin
  select requested_by
  into v_user_id
  from public.deck_runs
  where id = p_run_id;

  if v_user_id is null then
    return query
    select false, 0;
    return;
  end if;

  select abs(amount)
  into v_debit_amount
  from public.credit_ledger
  where reference_id = p_run_id::text
    and reason = 'run_debit'
  order by created_at desc
  limit 1;

  if v_debit_amount is null or v_debit_amount <= 0 then
    return query
    select false, 0;
    return;
  end if;

  insert into public.credit_ledger (user_id, amount, reason, reference_id)
  values (v_user_id, v_debit_amount, 'refund', p_run_id::text)
  on conflict do nothing;

  return query
  select found, case when found then v_debit_amount else 0 end;
end;
$$;
