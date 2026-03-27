-- Add "salvaged" to the delivery_status domain.
-- salvaged: run completed from a checkpoint after a late export-stage failure.
-- The published artifact set came from a durable pre-export checkpoint, not
-- from the final generation candidate. Manual review recommended.
--
-- Also add a CHECK constraint to document the allowed domain and prevent
-- unknown values from being written.
ALTER TABLE public.deck_runs
  ADD CONSTRAINT deck_runs_delivery_status_check
  CHECK (delivery_status IN ('draft', 'reviewed', 'approved', 'degraded', 'salvaged', 'failed'));
