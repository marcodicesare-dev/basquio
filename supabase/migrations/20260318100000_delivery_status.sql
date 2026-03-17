-- Add delivery status to deck_runs for dual delivery semantics
-- draft: authored, not yet critiqued
-- reviewed: critique passed with no major/critical issues
-- approved: human approval (future)
-- degraded: critique found unresolvable issues, deck delivered anyway
-- failed: pipeline failure

ALTER TABLE public.deck_runs ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'draft';
