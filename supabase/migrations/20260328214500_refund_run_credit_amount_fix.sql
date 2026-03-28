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

  select abs(credit_ledger.amount)
  into v_debit_amount
  from public.credit_ledger as credit_ledger
  where credit_ledger.reference_id = p_run_id::text
    and credit_ledger.reason = 'run_debit'
  order by credit_ledger.created_at desc
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
