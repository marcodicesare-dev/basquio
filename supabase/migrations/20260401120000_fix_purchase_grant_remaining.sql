-- Fix over-credited purchase grants from the initial migration.
-- The original migration set remaining = original_amount for all purchase grants,
-- ignoring that users had already spent some purchased credits under the old ledger.
-- This corrects remaining by subtracting run_debit amounts that occurred AFTER
-- each purchase was granted (by comparing timestamps).

update public.credit_grants cg
set remaining = greatest(0, cg.original_amount - coalesce((
  select abs(sum(cl.amount))
  from public.credit_ledger cl
  where cl.user_id = cg.user_id
    and cl.reason = 'run_debit'
    and cl.amount < 0
    -- Only count debits that happened after this purchase was originally granted in the old ledger
    and cl.created_at >= (
      select cl2.created_at
      from public.credit_ledger cl2
      where cl2.reference_id = cg.stripe_event_id
        and cl2.reason = 'purchase_pack'
      limit 1
    )
), 0))
where cg.source = 'purchase'
  -- Only fix grants that were created by the migration (not new purchases)
  and cg.created_at < '2026-04-01T11:00:00Z';
