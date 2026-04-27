-- =====================================================
-- CHAT TOOL TELEMETRY: cache + router stats columns
-- Spec: docs/research/2026-04-25-sota-implementation-specs.md §5, §6
-- Brief: docs/research/2026-04-25-codex-handoff-briefs.md (Brief 2)
-- Substrate audit: docs/research/2026-04-27-brief-2-substrate-audit.md
--
-- Brief 2 emits one row per chat turn with tool_name = '__chat_turn__'
-- carrying the per-turn aggregate: cache stats from the Anthropic Messages
-- API (cache_creation_input_tokens, cache_read_input_tokens), total token
-- usage, computed cost, and the router output (intents, active_tools,
-- entities, as_of, needs_web). Existing per-tool-call rows leave these
-- columns NULL. Migration is idempotent with ADD COLUMN IF NOT EXISTS.
-- =====================================================

BEGIN;

ALTER TABLE public.chat_tool_telemetry
  ADD COLUMN IF NOT EXISTS cache_creation_input_tokens INT,
  ADD COLUMN IF NOT EXISTS cache_read_input_tokens INT,
  ADD COLUMN IF NOT EXISTS total_input_tokens INT,
  ADD COLUMN IF NOT EXISTS total_output_tokens INT,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS intents TEXT[],
  ADD COLUMN IF NOT EXISTS active_tools TEXT[],
  ADD COLUMN IF NOT EXISTS classifier_entities TEXT[],
  ADD COLUMN IF NOT EXISTS classifier_as_of TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS classifier_needs_web BOOLEAN;

-- Lookup index for the per-turn rows: queries that scan recent turn aggregate
-- rows for cost/cache analysis filter on tool_name + created_at.
CREATE INDEX IF NOT EXISTS idx_chat_tool_telemetry_turn_aggregate
  ON public.chat_tool_telemetry (tool_name, created_at DESC)
  WHERE tool_name = '__chat_turn__';

COMMIT;
