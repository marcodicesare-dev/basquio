-- Add 'render' to deck_run_phase enum for the split deck artifact flow.
-- The direct Claude worker now separates PPTX authoring from PDF rendering
-- so the long-running artifact step can complete within API time limits.
ALTER TYPE deck_run_phase ADD VALUE IF NOT EXISTS 'render' AFTER 'author';
