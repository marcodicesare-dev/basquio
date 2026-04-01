-- Corrective migration: fix grant remaining values for migrated users.
--
-- Problem: 20260401100000 subtracted ALL run_debit rows from the free_tier grant,
-- even debits that should logically come from purchased credits. Then the original
-- corrective migration subtracted those same debits from purchase grants too.
-- This double-counts historical usage.
--
-- Fix: recompute from the old ledger's net balance per user, add the free-tier
-- upgrade bonus ONLY if the user actually had a free_tier row (6 → 40 = +34),
-- then distribute across grants: free tier first (up to 40), then purchases FIFO.

DO $$
DECLARE
  user_rec RECORD;
  grant_rec RECORD;
  old_net_balance numeric;
  target_balance numeric;
  old_free_amount numeric;
  has_free_tier boolean;
  has_free_tier_grant boolean;
  budget numeric;
  alloc numeric;
BEGIN
  FOR user_rec IN
    SELECT DISTINCT cg.user_id
    FROM public.credit_grants cg
    WHERE cg.created_at < '2026-04-01T11:00:00Z'
  LOOP
    -- Old ledger net balance = sum of ALL entries (positives + negatives)
    SELECT coalesce(sum(cl.amount), 0)
    INTO old_net_balance
    FROM public.credit_ledger cl
    WHERE cl.user_id = user_rec.user_id;

    -- Did this user actually have a free_tier row in the old ledger?
    SELECT EXISTS(
      SELECT 1 FROM public.credit_ledger cl
      WHERE cl.user_id = user_rec.user_id AND cl.reason = 'free_tier'
    ) INTO has_free_tier;

    -- Does this user have a migrated free_tier grant?
    SELECT EXISTS(
      SELECT 1 FROM public.credit_grants cg
      WHERE cg.user_id = user_rec.user_id
        AND cg.source = 'free_tier'
        AND cg.created_at < '2026-04-01T11:00:00Z'
    ) INTO has_free_tier_grant;

    IF has_free_tier THEN
      SELECT coalesce(cl.amount, 0)
      INTO old_free_amount
      FROM public.credit_ledger cl
      WHERE cl.user_id = user_rec.user_id AND cl.reason = 'free_tier'
      LIMIT 1;
    ELSE
      old_free_amount := 0;
    END IF;

    -- Target balance = old net + upgrade bonus (ONLY if user had free tier)
    -- No free tier row → no bonus. They'll get a fresh 40 at runtime.
    IF has_free_tier THEN
      target_balance := old_net_balance + greatest(0, 40 - old_free_amount);
    ELSE
      target_balance := old_net_balance;
    END IF;

    IF target_balance < 0 THEN
      target_balance := 0;
    END IF;

    budget := target_balance;

    -- 1) Allocate to free_tier grant first (up to 40), only if one exists
    IF has_free_tier_grant THEN
      UPDATE public.credit_grants
      SET remaining = least(40, greatest(0, budget))::integer
      WHERE user_id = user_rec.user_id
        AND source = 'free_tier'
        AND created_at < '2026-04-01T11:00:00Z';

      budget := greatest(0, budget - 40);
    END IF;

    -- 2) Allocate remainder to purchase grants in FIFO order
    FOR grant_rec IN
      SELECT cg.id, cg.original_amount
      FROM public.credit_grants cg
      WHERE cg.user_id = user_rec.user_id
        AND cg.source = 'purchase'
        AND cg.created_at < '2026-04-01T11:00:00Z'
      ORDER BY cg.created_at ASC
    LOOP
      alloc := least(budget, grant_rec.original_amount);
      UPDATE public.credit_grants
      SET remaining = greatest(0, alloc)::integer
      WHERE id = grant_rec.id;
      budget := greatest(0, budget - grant_rec.original_amount);
    END LOOP;
  END LOOP;
END $$;
