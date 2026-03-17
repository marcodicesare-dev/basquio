-- Add kicker and callout columns missing from deck_spec_v2_slides
-- These were added to code in cb32531 but no migration was created
-- Caused 97+ HTTP 400 errors on slide writes

ALTER TABLE public.deck_spec_v2_slides ADD COLUMN IF NOT EXISTS kicker text;
ALTER TABLE public.deck_spec_v2_slides ADD COLUMN IF NOT EXISTS callout jsonb;
