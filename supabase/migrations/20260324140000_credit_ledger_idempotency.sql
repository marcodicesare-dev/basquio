-- Forward migration: add idempotency guarantees to credit_ledger
-- Safe to run on databases that already have the original 20260324100000 migration.

-- Unique partial index: one free_tier grant per user
create unique index if not exists idx_credit_ledger_free_tier_unique
  on public.credit_ledger(user_id) where reason = 'free_tier';

-- Unique partial index: one purchase per payment_intent
create unique index if not exists idx_credit_ledger_purchase_unique
  on public.credit_ledger(reference_id) where reason = 'purchase_pack';

-- Unique partial index: one refund per run (prevents double-refund)
create unique index if not exists idx_credit_ledger_refund_unique
  on public.credit_ledger(reference_id) where reason = 'refund';

-- Replace grant_free_tier_credit to use INSERT ON CONFLICT
-- instead of the original read-then-write pattern.
create or replace function public.grant_free_tier_credit(
  p_user_id uuid
) returns boolean
language plpgsql
security definer
as $$
begin
  insert into public.credit_ledger (user_id, amount, reason)
  values (p_user_id, 6, 'free_tier')
  on conflict (user_id) where reason = 'free_tier'
  do nothing;

  return found;
end;
$$;
