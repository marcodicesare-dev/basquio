-- Corrective migration: fix purchase grant remaining values.
-- The previous migration (20260401120000) double-counted debits across multiple
-- purchase grants. This migration recalculates correctly using FIFO consumption:
-- total debits are distributed across grants ordered by created_at (earliest first).

DO $$
DECLARE
  user_rec RECORD;
  grant_rec RECORD;
  user_total_debits numeric;
  remaining_debits numeric;
  debit_for_grant numeric;
BEGIN
  -- For each user who has purchase grants from the initial migration
  FOR user_rec IN
    SELECT DISTINCT cg.user_id
    FROM public.credit_grants cg
    WHERE cg.source = 'purchase'
      AND cg.created_at < '2026-04-01T11:00:00Z'
  LOOP
    -- Get total debits for this user from the old ledger (absolute value)
    SELECT coalesce(abs(sum(cl.amount)), 0)
    INTO user_total_debits
    FROM public.credit_ledger cl
    WHERE cl.user_id = user_rec.user_id
      AND cl.reason = 'run_debit'
      AND cl.amount < 0;

    remaining_debits := user_total_debits;

    -- Walk through this user's purchase grants in FIFO order and consume debits
    FOR grant_rec IN
      SELECT cg.id, cg.original_amount
      FROM public.credit_grants cg
      WHERE cg.user_id = user_rec.user_id
        AND cg.source = 'purchase'
        AND cg.created_at < '2026-04-01T11:00:00Z'
      ORDER BY cg.created_at ASC
    LOOP
      IF remaining_debits <= 0 THEN
        -- No more debits to consume — this grant keeps full remaining
        UPDATE public.credit_grants
        SET remaining = original_amount
        WHERE id = grant_rec.id;
      ELSE
        -- Consume as much as possible from this grant
        debit_for_grant := least(remaining_debits, grant_rec.original_amount);
        UPDATE public.credit_grants
        SET remaining = greatest(0, grant_rec.original_amount - debit_for_grant)
        WHERE id = grant_rec.id;
        remaining_debits := remaining_debits - debit_for_grant;
      END IF;
    END LOOP;
  END LOOP;
END $$;
