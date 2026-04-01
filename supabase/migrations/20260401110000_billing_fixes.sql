-- Fix credit_balances view: total_runs as integer (not bigint) to prevent PostgREST string serialization.
-- Fix refund_run_credit: specify proper ON CONFLICT target.
-- Enable RLS on stripe_webhook_events.

-- ─── FIX credit_balances view (drop+create to change column type) ──
drop view if exists public.credit_balances;
create view public.credit_balances as
  select
    credit_grants.user_id,
    coalesce(sum(credit_grants.remaining) filter (
      where credit_grants.remaining > 0 and credit_grants.expires_at > now()
    ), 0)::integer as balance,
    count(*) filter (where credit_grants.source = 'free_tier') as free_grants_count,
    coalesce((
      select count(*) from public.credit_ledger
      where credit_ledger.user_id = credit_grants.user_id and credit_ledger.reason = 'run_debit'
    ), 0)::integer as total_runs
  from public.credit_grants
  group by credit_grants.user_id;

-- ─── FIX refund_run_credit ON CONFLICT target ──────────────
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

  -- Audit trail in credit_ledger (with proper conflict target)
  insert into public.credit_ledger (user_id, amount, reason, reference_id)
  values (v_user_id, v_debit_amount, 'refund', p_run_id::text)
  on conflict (reference_id) where reason = 'refund'
  do nothing;

  -- Restore credits in credit_grants (new system, never expires)
  if found then
    insert into public.credit_grants (user_id, source, original_amount, remaining, expires_at, stripe_event_id)
    values (v_user_id, 'promotional', v_debit_amount, v_debit_amount, '2099-12-31'::timestamptz, 'refund_' || p_run_id::text)
    on conflict (stripe_event_id) where stripe_event_id is not null
    do nothing;
  end if;

  return query
  select found, case when found then v_debit_amount else 0 end;
end;
$$;

-- ─── Enable RLS on stripe_webhook_events ────────────────────
alter table public.stripe_webhook_events enable row level security;
-- No user-facing policies — only accessible via service role key.
