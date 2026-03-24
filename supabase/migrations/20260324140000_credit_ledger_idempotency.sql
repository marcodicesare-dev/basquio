-- Forward migration: add idempotency guarantees to credit_ledger
-- Safe to run on databases that already have the original 20260324100000 migration.
-- Cleans up any duplicate rows from the pre-idempotency bug window before
-- adding unique indexes, so this migration never fails on dirty data.

-- ─── CLEANUP: deduplicate free_tier grants ──────────────────────
-- Keep only the earliest free_tier row per user, delete the rest.
delete from public.credit_ledger
where reason = 'free_tier'
  and id not in (
    select distinct on (user_id) id
    from public.credit_ledger
    where reason = 'free_tier'
    order by user_id, created_at asc
  );

-- ─── CLEANUP: deduplicate purchase_pack grants ──────────────────
-- Keep only the earliest purchase_pack row per reference_id, delete the rest.
delete from public.credit_ledger
where reason = 'purchase_pack'
  and reference_id is not null
  and id not in (
    select distinct on (reference_id) id
    from public.credit_ledger
    where reason = 'purchase_pack' and reference_id is not null
    order by reference_id, created_at asc
  );

-- ─── CLEANUP: deduplicate refund grants ─────────────────────────
-- Keep only the earliest refund row per reference_id, delete the rest.
delete from public.credit_ledger
where reason = 'refund'
  and reference_id is not null
  and id not in (
    select distinct on (reference_id) id
    from public.credit_ledger
    where reason = 'refund' and reference_id is not null
    order by reference_id, created_at asc
  );

-- ─── UNIQUE INDEXES ─────────────────────────────────────────────
-- Now safe to create — no duplicates remain.

-- One free_tier grant per user
create unique index if not exists idx_credit_ledger_free_tier_unique
  on public.credit_ledger(user_id) where reason = 'free_tier';

-- One purchase per payment_intent
create unique index if not exists idx_credit_ledger_purchase_unique
  on public.credit_ledger(reference_id) where reason = 'purchase_pack';

-- One refund per run
create unique index if not exists idx_credit_ledger_refund_unique
  on public.credit_ledger(reference_id) where reason = 'refund';

-- ─── ATOMIC FREE TIER GRANT ─────────────────────────────────────
-- Uses INSERT ON CONFLICT instead of read-then-write.
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
