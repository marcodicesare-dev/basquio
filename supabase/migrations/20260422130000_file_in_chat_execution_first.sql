-- File-in-chat execution-first architecture
-- (spec: docs/specs/2026-04-21-file-in-chat-execution-first-architecture.md)
--
-- Adds the primitives the new chat path needs:
--   1. knowledge_documents.anthropic_file_id — the Files API id for the
--      container_upload content block. When set, Claude's code_execution
--      tool can read the file via pandas/openpyxl and answer in seconds
--      without any pgvector round trip.
--   2. file_ingest_runs — queue table the Railway worker claims from to do
--      background chunking + embedding. Mirrors the deck_run_attempts lifecycle
--      already proven by the deck pipeline: queued → claimed → indexing →
--      indexed/failed. Unique per document_id so a single source of truth
--      survives even when the UI re-uploads.

BEGIN;

-- ── 1. anthropic_file_id on knowledge_documents ──

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS anthropic_file_id TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_anthropic_file_id
  ON public.knowledge_documents (anthropic_file_id)
  WHERE anthropic_file_id IS NOT NULL;

-- ── 2. file_ingest_runs queue ──

CREATE TABLE IF NOT EXISTS public.file_ingest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'claimed', 'indexing', 'indexed', 'failed')),
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  attempt_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id)
);

CREATE INDEX IF NOT EXISTS idx_file_ingest_runs_status_created
  ON public.file_ingest_runs (status, created_at)
  WHERE status IN ('queued', 'claimed', 'indexing');

CREATE INDEX IF NOT EXISTS idx_file_ingest_runs_workspace
  ON public.file_ingest_runs (workspace_id, created_at DESC);

ALTER TABLE public.file_ingest_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages file_ingest_runs" ON public.file_ingest_runs;
CREATE POLICY "Service role manages file_ingest_runs"
  ON public.file_ingest_runs FOR ALL TO service_role USING (true);

CREATE OR REPLACE FUNCTION public.touch_file_ingest_runs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_file_ingest_runs_touch ON public.file_ingest_runs;
CREATE TRIGGER trg_file_ingest_runs_touch
  BEFORE UPDATE ON public.file_ingest_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_file_ingest_runs_updated_at();

-- ── 3. Claim RPC — atomic single-worker claim on a queued run ──
-- Pattern mirrors the deck_run_attempts claim flow. Uses FOR UPDATE SKIP LOCKED
-- so multiple Railway replicas don't double-claim. The worker heartbeats by
-- writing indexing_at periodically via plain UPDATEs — the trigger above
-- bumps updated_at, which the stale-recovery sweep reads.

CREATE OR REPLACE FUNCTION public.claim_file_ingest_run(
  worker_id TEXT
)
RETURNS TABLE (
  run_id UUID,
  document_id UUID,
  workspace_id UUID,
  attempt_count INT
)
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  picked UUID;
BEGIN
  SELECT r.id INTO picked
  FROM public.file_ingest_runs r
  WHERE r.status = 'queued'
  ORDER BY r.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF picked IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.file_ingest_runs r
  SET
    status = 'claimed',
    claimed_by = worker_id,
    claimed_at = now(),
    attempt_count = r.attempt_count + 1
  WHERE r.id = picked;

  RETURN QUERY
  SELECT r.id, r.document_id, r.workspace_id, r.attempt_count
  FROM public.file_ingest_runs r
  WHERE r.id = picked;
END;
$$;

-- ── 4. Stale recovery — rescue claimed/indexing runs older than 30 min ──
--
-- If a worker dies or a deploy interrupts a run, the row stays stuck in
-- 'claimed' or 'indexing'. This RPC flips them back to 'queued' so another
-- worker can pick them up. Called periodically by the Railway worker itself.

CREATE OR REPLACE FUNCTION public.recover_stale_file_ingest_runs(
  stale_after_minutes INT DEFAULT 30
)
RETURNS INT
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  rescued INT := 0;
BEGIN
  UPDATE public.file_ingest_runs r
  SET
    status = 'queued',
    claimed_by = NULL,
    claimed_at = NULL,
    error_message = COALESCE(
      NULLIF(r.error_message || E'\n', E'\n') || 'recovered from stale ' || r.status || ' at ' || now(),
      'recovered from stale ' || r.status || ' at ' || now()
    )
  WHERE r.status IN ('claimed', 'indexing')
    AND r.updated_at < now() - make_interval(mins => stale_after_minutes);

  GET DIAGNOSTICS rescued = ROW_COUNT;
  RETURN rescued;
END;
$$;

-- ── 5. Backfill existing documents into the queue ──
--
-- Every document not yet indexed gets a file_ingest_runs row so the Railway
-- worker can pick up the work after deploy. Already-indexed documents get a
-- terminal 'indexed' row for parity. Failed documents stay failed until the
-- user clicks Retry.

-- Skip soft-deleted documents so the future worker does not try to re-ingest
-- them. Anything still in the primordial 'processing' state or unknown gets
-- queued so the worker can finish the job that after() may have been
-- interrupted on.
INSERT INTO public.file_ingest_runs (document_id, workspace_id, status, metadata)
SELECT
  d.id,
  COALESCE(d.workspace_id, '15cc947e-70cb-455a-b0df-d8c34b760d71'::uuid),
  CASE d.status
    WHEN 'indexed' THEN 'indexed'
    WHEN 'failed' THEN 'failed'
    ELSE 'queued'
  END,
  jsonb_build_object('backfilled_at', now()::text, 'seed_status', d.status)
FROM public.knowledge_documents d
WHERE d.status <> 'deleted'
  AND NOT EXISTS (
    SELECT 1 FROM public.file_ingest_runs existing
    WHERE existing.document_id = d.id
  );

COMMIT;
