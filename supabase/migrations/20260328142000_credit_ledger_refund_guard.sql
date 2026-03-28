-- Guard migration: re-assert refund idempotency for environments that may
-- have missed the earlier credit-ledger idempotency rollout.
-- Safe to run repeatedly.

-- Keep only the earliest refund row per reference_id before re-asserting the
-- partial unique index. This makes the migration safe on dirty data.
delete from public.credit_ledger
where reason = 'refund'
  and reference_id is not null
  and id not in (
    select distinct on (reference_id) id
    from public.credit_ledger
    where reason = 'refund'
      and reference_id is not null
    order by reference_id, created_at asc, id asc
  );

create unique index if not exists idx_credit_ledger_refund_unique
  on public.credit_ledger(reference_id)
  where reason = 'refund';
