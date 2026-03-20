-- Add cost_telemetry JSONB column to deck_runs for per-run cost tracking
-- Stores: totalTokens, promptTokens, completionTokens, estimatedCostUsd, durationMs, phases, budgetExceeded
alter table public.deck_runs
  add column if not exists cost_telemetry jsonb;
