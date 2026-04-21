-- Informational: streams a full security-advisor-equivalent audit via
-- RAISE NOTICE. Makes no schema changes. Safe to re-apply. Intentionally
-- registered as a migration so it's traceable in supabase_migrations.
--
-- Checks performed (parity with Supabase Security Advisor + Performance hints):
--   1. RLS disabled on public tables
--   2. RLS enabled but zero policies (table is locked, can be intentional)
--   3. Policies exist but RLS disabled (inconsistent)
--   4. SECURITY DEFINER views
--   5. Functions with mutable search_path (injection risk)
--   6. Extensions installed in public schema
--   7. auth.users exposed via public views or columns
--   8. SECURITY DEFINER functions in public (trusted escape hatches)
--   9. Foreign keys missing a supporting index (perf)
--  10. Storage buckets without at least one access policy

DO $$
DECLARE
  rec RECORD;
  n_issues INT := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════ BASQUIO SECURITY AUDIT ════════════════';
  RAISE NOTICE 'Timestamp: %', now();
  RAISE NOTICE '';

  -- 1. RLS disabled on public tables
  RAISE NOTICE '── 1. Tables in public with RLS DISABLED ──';
  FOR rec IN
    SELECT n.nspname AS schema, c.relname AS table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
    ORDER BY c.relname
  LOOP
    RAISE NOTICE '  ✗ %.% — RLS is OFF', rec.schema, rec.table;
    n_issues := n_issues + 1;
  END LOOP;
  IF n_issues = 0 THEN RAISE NOTICE '  ✓ (none)'; END IF;

  -- 2. RLS enabled but no policies
  n_issues := 0;
  RAISE NOTICE '';
  RAISE NOTICE '── 2. Tables in public with RLS enabled but ZERO policies ──';
  FOR rec IN
    SELECT n.nspname AS schema, c.relname AS table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
      )
    ORDER BY c.relname
  LOOP
    RAISE NOTICE '  ⚠ %.% — RLS on, no policies (locked from anon/authenticated)', rec.schema, rec.table;
    n_issues := n_issues + 1;
  END LOOP;
  IF n_issues = 0 THEN RAISE NOTICE '  ✓ (none)'; END IF;

  -- 3. Policies exist but RLS is disabled on the table
  n_issues := 0;
  RAISE NOTICE '';
  RAISE NOTICE '── 3. Tables with policies but RLS DISABLED (policies are dead) ──';
  FOR rec IN
    SELECT DISTINCT n.nspname AS schema, c.relname AS table
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT c.relrowsecurity
    ORDER BY c.relname
  LOOP
    RAISE NOTICE '  ✗ %.% — has policies but RLS is OFF', rec.schema, rec.table;
    n_issues := n_issues + 1;
  END LOOP;
  IF n_issues = 0 THEN RAISE NOTICE '  ✓ (none)'; END IF;

  -- 4. SECURITY DEFINER views (any view at all qualifies if owner is superuser)
  n_issues := 0;
  RAISE NOTICE '';
  RAISE NOTICE '── 4. SECURITY DEFINER views in public ──';
  FOR rec IN
    SELECT n.nspname AS schema, c.relname AS view, r.rolname AS owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_authid r ON r.oid = c.relowner
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
      AND r.rolsuper
    ORDER BY c.relname
  LOOP
    RAISE NOTICE '  ⚠ view %.% is owned by superuser % (runs as definer)', rec.schema, rec.view, rec.owner;
    n_issues := n_issues + 1;
  END LOOP;
  IF n_issues = 0 THEN RAISE NOTICE '  ✓ (none)'; END IF;

  -- 5. Functions in public with mutable search_path
  n_issues := 0;
  RAISE NOTICE '';
  RAISE NOTICE '── 5. Functions in public with mutable search_path (SQL injection vector) ──';
  FOR rec IN
    SELECT n.nspname AS schema, p.proname AS func, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        WHERE cfg LIKE 'search_path=%'
      )
    ORDER BY p.proname
  LOOP
    RAISE NOTICE '  ⚠ %.%(%) — no SET search_path lock', rec.schema, rec.func, rec.args;
    n_issues := n_issues + 1;
  END LOOP;
  IF n_issues = 0 THEN RAISE NOTICE '  ✓ (none)'; END IF;

  -- 6. Extensions installed in public schema
  n_issues := 0;
  RAISE NOTICE '';
  RAISE NOTICE '── 6. Extensions installed in PUBLIC schema (should live in "extensions") ──';
  FOR rec IN
    SELECT e.extname, n.nspname AS schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE n.nspname = 'public'
    ORDER BY e.extname
  LOOP
    RAISE NOTICE '  ⚠ extension % lives in public', rec.extname;
    n_issues := n_issues + 1;
  END LOOP;
  IF n_issues = 0 THEN RAISE NOTICE '  ✓ (none)'; END IF;

  -- 7. auth.users exposure via public views/columns
  n_issues := 0;
  RAISE NOTICE '';
  RAISE NOTICE '── 7. Views / columns in public that reference auth.users ──';
  FOR rec IN
    SELECT v.schemaname AS schema, v.viewname AS view
    FROM pg_views v
    WHERE v.schemaname = 'public'
      AND v.definition ILIKE '%auth.users%'
    ORDER BY v.viewname
  LOOP
    RAISE NOTICE '  ⚠ view %.% selects from auth.users — verify intended exposure', rec.schema, rec.view;
    n_issues := n_issues + 1;
  END LOOP;
  IF n_issues = 0 THEN RAISE NOTICE '  ✓ (none)'; END IF;

  -- 8. SECURITY DEFINER functions in public
  n_issues := 0;
  RAISE NOTICE '';
  RAISE NOTICE '── 8. SECURITY DEFINER functions in public (elevated escape hatches) ──';
  FOR rec IN
    SELECT n.nspname AS schema, p.proname AS func, r.rolname AS owner
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_authid r ON r.oid = p.proowner
    WHERE n.nspname = 'public'
      AND p.prosecdef
    ORDER BY p.proname
  LOOP
    RAISE NOTICE '  ℹ %.% (SECURITY DEFINER, owner: %) — verify it only exposes what it should', rec.schema, rec.func, rec.owner;
    n_issues := n_issues + 1;
  END LOOP;
  IF n_issues = 0 THEN RAISE NOTICE '  ✓ (none)'; END IF;

  -- 9. Foreign keys missing a supporting index
  n_issues := 0;
  RAISE NOTICE '';
  RAISE NOTICE '── 9. Foreign keys WITHOUT a supporting index (perf) ──';
  FOR rec IN
    WITH fks AS (
      SELECT
        con.conrelid AS rel,
        con.conname AS name,
        (SELECT array_agg(attname ORDER BY k.ord)
         FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype = 'f' AND n.nspname = 'public'
    )
    SELECT (f.rel::regclass)::text AS rel, f.name, f.cols
    FROM fks f
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = f.rel
        AND (
          SELECT array_agg(attname ORDER BY k.ord)
          FROM unnest(i.indkey::int[]) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        ) @> f.cols
    )
    ORDER BY f.rel, f.name
  LOOP
    RAISE NOTICE '  ℹ % — FK % on cols % has no index', rec.rel, rec.name, rec.cols;
    n_issues := n_issues + 1;
  END LOOP;
  IF n_issues = 0 THEN RAISE NOTICE '  ✓ (none)'; END IF;

  -- 10. Storage buckets visibility + policies
  n_issues := 0;
  RAISE NOTICE '';
  RAISE NOTICE '── 10. Storage buckets — public flag + policy count ──';
  FOR rec IN
    SELECT b.id AS bucket_id, b.name AS bucket_name, b.public AS is_public,
      (SELECT count(*) FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relname = 'objects' AND c.relnamespace = 'storage'::regnamespace) AS total_storage_policies
    FROM storage.buckets b
    ORDER BY b.id
  LOOP
    RAISE NOTICE '  bucket=% public=% (total policies on storage.objects: %)',
      rec.bucket_id, rec.is_public, rec.total_storage_policies;
  END LOOP;

  -- 11. Anon role grants on public tables (what unauthenticated clients can reach)
  n_issues := 0;
  RAISE NOTICE '';
  RAISE NOTICE '── 11. Tables in public with GRANTs to anon role ──';
  FOR rec IN
    SELECT table_schema, table_name, string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type) AS privs
    FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema = 'public'
    GROUP BY table_schema, table_name
    ORDER BY table_name
  LOOP
    RAISE NOTICE '  ℹ %.% — anon has: %', rec.table_schema, rec.table_name, rec.privs;
    n_issues := n_issues + 1;
  END LOOP;
  IF n_issues = 0 THEN RAISE NOTICE '  ✓ (none — anon is locked out of public)'; END IF;

  -- 12. Counts summary
  RAISE NOTICE '';
  RAISE NOTICE '── Summary ──';
  SELECT count(*) INTO STRICT n_issues FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r';
  RAISE NOTICE '  total tables in public: %', n_issues;
  SELECT count(*) INTO STRICT n_issues FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public';
  RAISE NOTICE '  total functions in public: %', n_issues;
  SELECT count(*) INTO STRICT n_issues FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public';
  RAISE NOTICE '  total RLS policies on public: %', n_issues;
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════ END AUDIT ═══════════════════════';
END $$;
