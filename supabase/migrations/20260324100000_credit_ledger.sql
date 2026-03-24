-- Credit ledger for per-deck billing
-- Design: append-only ledger with a materialized balance view.
-- Every credit change is a row: grants (purchase, free tier, refund) and debits (run started).
-- Balance = SUM(amount) grouped by user.
-- Atomic debit: use a function with SELECT ... FOR UPDATE to prevent double-spend.

-- ─── CREDIT LEDGER TABLE ─────────────────────────────────────────
create table if not exists public.credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  amount        integer not null,
  -- positive = grant (purchase, free, refund), negative = debit (run)
  reason        text not null,
  -- 'free_tier', 'purchase_standard', 'purchase_pro', 'refund', 'run_debit'
  reference_id  text,
  -- stripe payment_intent id, deck_run id, or null
  created_at    timestamptz not null default now()
);

create index if not exists idx_credit_ledger_user
  on public.credit_ledger(user_id, created_at desc);

-- ─── BALANCE VIEW ────────────────────────────────────────────────
-- Fast balance check: SELECT balance FROM credit_balances WHERE user_id = $1
create or replace view public.credit_balances as
  select
    user_id,
    coalesce(sum(amount), 0)::integer as balance,
    count(*) filter (where reason = 'free_tier') as free_grants_count,
    count(*) filter (where reason = 'run_debit') as total_runs
  from public.credit_ledger
  group by user_id;

-- ─── ATOMIC DEBIT FUNCTION ───────────────────────────────────────
-- Returns true if debit succeeded, false if insufficient balance.
-- Uses advisory lock on user_id to prevent race conditions.
create or replace function public.debit_credit(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_reference_id text default null
) returns boolean
language plpgsql
security definer
as $$
declare
  v_balance integer;
begin
  -- Advisory lock on user to serialize concurrent debits
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Check current balance
  select coalesce(sum(amount), 0) into v_balance
  from public.credit_ledger
  where user_id = p_user_id;

  if v_balance < p_amount then
    return false;
  end if;

  -- Insert debit record (negative amount)
  insert into public.credit_ledger (user_id, amount, reason, reference_id)
  values (p_user_id, -p_amount, p_reason, p_reference_id);

  return true;
end;
$$;

-- ─── GRANT FREE TIER CREDIT ─────────────────────────────────────
-- Grants 1 free credit only if the user has never received one.
-- Returns true if granted, false if already used.
create or replace function public.grant_free_tier_credit(
  p_user_id uuid
) returns boolean
language plpgsql
security definer
as $$
declare
  v_existing integer;
begin
  select count(*) into v_existing
  from public.credit_ledger
  where user_id = p_user_id and reason = 'free_tier';

  if v_existing > 0 then
    return false;
  end if;

  insert into public.credit_ledger (user_id, amount, reason)
  values (p_user_id, 1, 'free_tier');

  return true;
end;
$$;

-- ─── RLS ─────────────────────────────────────────────────────────
alter table public.credit_ledger enable row level security;

-- Users can read their own ledger entries
create policy "Users can read own credits"
  on public.credit_ledger
  for select
  using (auth.uid() = user_id);

-- Only service role can insert (via functions or API routes)
-- No direct insert policy for authenticated users.
