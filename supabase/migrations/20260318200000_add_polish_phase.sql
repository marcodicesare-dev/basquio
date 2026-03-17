-- Add 'polish' to deck_run_phase enum
-- The polish phase writes notebook entries but the enum was missing this value,
-- causing 104 silent failures per run on every notebook persist during polish.
ALTER TYPE deck_run_phase ADD VALUE IF NOT EXISTS 'polish' AFTER 'author';
