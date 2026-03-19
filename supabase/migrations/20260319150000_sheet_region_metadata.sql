-- Add region metadata columns to evidence_workspace_sheets.
-- Regions are sub-sheet table blocks detected by the dense XLSX parser.
-- These fields are NULL for simple CSV/streaming-parsed sheets.

alter table public.evidence_workspace_sheets
  add column if not exists region_id text,
  add column if not exists region_index integer,
  add column if not exists region_type text,
  add column if not exists region_confidence numeric,
  add column if not exists region_bounds jsonb,
  add column if not exists source_sheet_key text,
  add column if not exists formula_columns jsonb;

comment on column public.evidence_workspace_sheets.region_id is 'Unique region identifier within the sheet (null for single-region sheets)';
comment on column public.evidence_workspace_sheets.region_type is 'structured_table | financial_model_block | kpi_grid | narrative_sheet | unsafe';
comment on column public.evidence_workspace_sheets.region_confidence is 'Parse confidence 0-1';
comment on column public.evidence_workspace_sheets.region_bounds is '{"startRow","endRow","startCol","endCol","headerStartRow","headerEndRow","dataStartRow"}';
comment on column public.evidence_workspace_sheets.formula_columns is 'Array of column names that contain formula-driven values';
