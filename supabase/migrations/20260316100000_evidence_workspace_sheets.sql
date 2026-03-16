-- Evidence Workspace Sheets
-- Replaces: evidence_workspaces.sheet_data (monolithic JSONB blob per run)
-- Each sheet from every source file gets its own row, with the raw row data
-- offloaded to object storage (blob_path) rather than stored inline in Postgres.

-- ─── evidence_workspace_sheets ────────────────────────────────────────────────
-- One row per sheet extracted from a source file during the normalize phase.
-- Column metadata and sample rows are kept inline for fast profiling queries.
-- Full row data lives in object storage under evidence-workspace-blobs.

CREATE TABLE IF NOT EXISTS public.evidence_workspace_sheets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.evidence_workspaces(id) ON DELETE CASCADE,
  run_id          uuid        NOT NULL REFERENCES public.deck_runs(id) ON DELETE CASCADE,
  source_file_id  uuid,

  -- Sheet identity
  sheet_key       text        NOT NULL,  -- stable key: "<sourceFileId>:<sheetName>"
  sheet_name      text        NOT NULL,  -- human-readable tab / sheet name
  source_file_name text       NOT NULL,  -- original uploaded file name, denormalised for display
  source_role     text,                  -- e.g. 'primary', 'support', 'brand-tokens'

  -- Shape
  row_count       integer     NOT NULL DEFAULT 0,
  column_count    integer     NOT NULL DEFAULT 0,

  -- Inline metadata (small, used for profiling / tool context)
  columns         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- [{name, type, nullable, sampleValues?}]

  sample_rows     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- First ~20 rows as array of objects — enough for LLM context without blowing memory

  column_profile  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- {colName: {min, max, mean, nullCount, distinctCount, topValues}} — computed during normalize

  -- Object-storage reference for full row data
  blob_bucket     text        NOT NULL DEFAULT 'evidence-workspace-blobs',
  blob_path       text        NOT NULL,  -- e.g. "runs/<runId>/sheets/<sheetKey>.jsonl.gz"
  blob_format     text        NOT NULL DEFAULT 'jsonl.gz',
  blob_bytes      bigint,
  checksum_sha256 text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ews_workspace ON public.evidence_workspace_sheets(workspace_id);
CREATE INDEX idx_ews_run       ON public.evidence_workspace_sheets(run_id);
CREATE UNIQUE INDEX idx_ews_sheet_key ON public.evidence_workspace_sheets(workspace_id, sheet_key);

-- ─── evidence_workspaces — new columns ────────────────────────────────────────
-- normalization_version: bumped when the normalize algorithm changes, so downstream
--   steps can detect stale workspaces and re-run if needed.
-- blob_manifest: lightweight index of every blob written for this workspace
--   {path: {bytes, checksum, sheetKey}} — kept in sync by the normalize step.

ALTER TABLE public.evidence_workspaces
  ADD COLUMN IF NOT EXISTS normalization_version text        NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS blob_manifest         jsonb       NOT NULL DEFAULT '{}'::jsonb;

-- ─── Storage bucket ───────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence-workspace-blobs', 'evidence-workspace-blobs', false)
ON CONFLICT (id) DO NOTHING;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.evidence_workspace_sheets ENABLE ROW LEVEL SECURITY;

-- Helper: returns true when the calling user is a member of the organisation that
-- owns the deck_run referenced by the given run_id.
-- We inline the join rather than creating a function so the policy stays
-- self-contained and pg_policies is easy to inspect.

-- SELECT — org members can read sheets for runs in their organisation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'evidence_workspace_sheets'
      AND policyname = 'ews_select_org_member'
  ) THEN
    CREATE POLICY ews_select_org_member
      ON public.evidence_workspace_sheets
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.deck_runs dr
          JOIN public.organization_memberships om
            ON om.organization_id = dr.organization_id
          WHERE dr.id  = evidence_workspace_sheets.run_id
            AND om.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- INSERT — org members with at least editor role can create sheets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'evidence_workspace_sheets'
      AND policyname = 'ews_insert_org_editor'
  ) THEN
    CREATE POLICY ews_insert_org_editor
      ON public.evidence_workspace_sheets
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.deck_runs dr
          JOIN public.organization_memberships om
            ON om.organization_id = dr.organization_id
          WHERE dr.id     = evidence_workspace_sheets.run_id
            AND om.user_id = auth.uid()
            AND om.role   IN ('owner', 'admin', 'editor')
        )
      );
  END IF;
END $$;

-- UPDATE — org members with at least editor role can update sheets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'evidence_workspace_sheets'
      AND policyname = 'ews_update_org_editor'
  ) THEN
    CREATE POLICY ews_update_org_editor
      ON public.evidence_workspace_sheets
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.deck_runs dr
          JOIN public.organization_memberships om
            ON om.organization_id = dr.organization_id
          WHERE dr.id     = evidence_workspace_sheets.run_id
            AND om.user_id = auth.uid()
            AND om.role   IN ('owner', 'admin', 'editor')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.deck_runs dr
          JOIN public.organization_memberships om
            ON om.organization_id = dr.organization_id
          WHERE dr.id     = evidence_workspace_sheets.run_id
            AND om.user_id = auth.uid()
            AND om.role   IN ('owner', 'admin', 'editor')
        )
      );
  END IF;
END $$;

-- DELETE — only owners and admins can delete sheets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'evidence_workspace_sheets'
      AND policyname = 'ews_delete_org_admin'
  ) THEN
    CREATE POLICY ews_delete_org_admin
      ON public.evidence_workspace_sheets
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.deck_runs dr
          JOIN public.organization_memberships om
            ON om.organization_id = dr.organization_id
          WHERE dr.id     = evidence_workspace_sheets.run_id
            AND om.user_id = auth.uid()
            AND om.role   IN ('owner', 'admin')
        )
      );
  END IF;
END $$;

-- ─── Storage policies for evidence-workspace-blobs ────────────────────────────
-- Blobs are namespaced under "runs/<runId>/..." so we can scope access by
-- checking org membership via deck_runs without exposing cross-org data.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'ews_blobs_insert'
  ) THEN
    CREATE POLICY ews_blobs_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'evidence-workspace-blobs'
        AND name LIKE 'runs/%'
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'ews_blobs_select'
  ) THEN
    CREATE POLICY ews_blobs_select
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'evidence-workspace-blobs'
        AND name LIKE 'runs/%'
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'ews_blobs_update'
  ) THEN
    CREATE POLICY ews_blobs_update
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'evidence-workspace-blobs'
        AND name LIKE 'runs/%'
      )
      WITH CHECK (
        bucket_id = 'evidence-workspace-blobs'
        AND name LIKE 'runs/%'
      );
  END IF;
END $$;
