import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAdminActor,
  buildSystemActor,
  buildUserActor,
} from "./audit";

/**
 * Memory v1 RLS schema test.
 *
 * The full cross-workspace isolation test (member of A cannot read B) requires
 * an authenticated-client fixture that does not yet exist in the codebase
 * (see docs/research/2026-04-27-brief-1-substrate-audit.md). Brief 1 ships the
 * schema-shape verification here, plus pure unit tests on the actor builders.
 * The functional RLS isolation check is verified manually in Phase 7b of the
 * Brief 1 runbook against a live Supabase instance.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

function readMigration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
}

const FOUNDATION = readMigration("20260428100000_memory_architecture_foundation.sql");
const MEMBER_RLS = readMigration("20260428110000_member_scoped_rls.sql");
const AUDIT_LOG = readMigration("20260428120000_memory_audit_log.sql");

describe("Memory v1 foundation migration", () => {
  it.each([
    "public.workspace_rule",
    "public.brand_guideline",
    "public.anticipation_hints",
    "public.memory_workflows",
    "public.memory_workflow_runs",
  ])("creates %s", (table) => {
    expect(FOUNDATION).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
  });

  it("adds expired_at and fact_embedding columns to facts", () => {
    expect(FOUNDATION).toMatch(/ALTER TABLE public\.facts/);
    expect(FOUNDATION).toContain("ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ");
    expect(FOUNDATION).toContain("ADD COLUMN IF NOT EXISTS fact_embedding VECTOR(1536)");
  });

  it("creates the partial active fact index", () => {
    expect(FOUNDATION).toContain("CREATE INDEX IF NOT EXISTS idx_facts_active_v2");
    expect(FOUNDATION).toMatch(/WHERE\s+superseded_by IS NULL\s+AND\s+expired_at IS NULL/);
  });

  it("creates the HNSW partial index on fact_embedding", () => {
    expect(FOUNDATION).toContain("CREATE INDEX IF NOT EXISTS idx_facts_embedding_hnsw");
    expect(FOUNDATION).toContain("USING hnsw (fact_embedding vector_cosine_ops)");
    expect(FOUNDATION).toContain("WITH (m = 16, ef_construction = 200)");
    expect(FOUNDATION).toContain("WHERE fact_embedding IS NOT NULL");
  });

  it("declares hint_kind and hint_status enums", () => {
    expect(FOUNDATION).toContain(
      "CREATE TYPE hint_kind AS ENUM ('reactive', 'proactive', 'optimisation')",
    );
    expect(FOUNDATION).toContain("CREATE TYPE hint_status AS ENUM");
    for (const status of [
      "candidate",
      "shown",
      "accepted",
      "dismissed",
      "snoozed",
      "expired",
      "suppressed",
    ]) {
      expect(FOUNDATION).toContain(`'${status}'`);
    }
  });

  it.each([
    "public.workspace_rule",
    "public.brand_guideline",
    "public.anticipation_hints",
    "public.memory_workflows",
    "public.memory_workflow_runs",
  ])("enables RLS on %s", (table) => {
    expect(FOUNDATION).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  });
});

describe("Member-scoped RLS migration", () => {
  it("creates workspace_members with role check", () => {
    expect(MEMBER_RLS).toContain("CREATE TABLE IF NOT EXISTS public.workspace_members");
    expect(MEMBER_RLS).toContain(
      "role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer'))",
    );
    expect(MEMBER_RLS).toContain("UNIQUE (workspace_id, user_id)");
  });

  it("defines is_workspace_member as SECURITY DEFINER with locked search_path", () => {
    expect(MEMBER_RLS).toMatch(
      /CREATE OR REPLACE FUNCTION public\.is_workspace_member\(_workspace_id UUID\)/,
    );
    expect(MEMBER_RLS).toContain("SECURITY DEFINER");
    expect(MEMBER_RLS).toContain("SET search_path = ''");
    expect(MEMBER_RLS).toContain("STABLE");
    expect(MEMBER_RLS).toContain("auth.uid()");
  });

  it("drops the legacy service-only policies on memory tables", () => {
    for (const policy of [
      '"Service role manages entities"',
      '"Service role manages entity_mentions"',
      '"Service role manages facts"',
      '"Service role manages memory_entries"',
      '"Service role manages workspace_deliverables"',
    ]) {
      expect(MEMBER_RLS).toContain(`DROP POLICY IF EXISTS ${policy}`);
    }
  });

  it("creates service-role write policies on every memory table", () => {
    for (const table of [
      "public.entities",
      "public.entity_mentions",
      "public.facts",
      "public.memory_entries",
      "public.workspace_deliverables",
      "public.workspace_rule",
      "public.brand_guideline",
      "public.anticipation_hints",
      "public.memory_workflows",
      "public.memory_workflow_runs",
    ]) {
      expect(MEMBER_RLS).toContain(
        `CREATE POLICY "service writes" ON ${table}\n  FOR ALL TO service_role USING (TRUE)`,
      );
    }
  });

  it("scopes workspace_rule, brand_guideline reads via is_workspace_member(workspace_id)", () => {
    expect(MEMBER_RLS).toMatch(
      /CREATE POLICY "members read" ON public\.workspace_rule[\s\S]*?USING \(public\.is_workspace_member\(workspace_id\)\)/,
    );
    expect(MEMBER_RLS).toMatch(
      /CREATE POLICY "members read" ON public\.brand_guideline[\s\S]*?USING \(public\.is_workspace_member\(workspace_id\)\)/,
    );
  });

  it("applies per-user privacy on anticipation_hints", () => {
    expect(MEMBER_RLS).toMatch(
      /CREATE POLICY "members read own hints" ON public\.anticipation_hints[\s\S]*?user_id IS NULL OR user_id = auth\.uid\(\)/,
    );
  });

  it("bridges legacy memory tables through workspaces.organization_id", () => {
    for (const table of [
      "entities",
      "entity_mentions",
      "facts",
      "memory_entries",
      "workspace_deliverables",
    ]) {
      const pattern = new RegExp(
        `CREATE POLICY "members read ${table}" ON public\\.${table}[\\s\\S]*?` +
          `JOIN public\\.workspace_members wm ON wm\\.workspace_id = w\\.id[\\s\\S]*?` +
          `WHERE w\\.organization_id = ${table}\\.organization_id`,
      );
      expect(MEMBER_RLS).toMatch(pattern);
    }
  });

  it("sets pgvector 0.8 iterative-scan params for HNSW + RLS top-k correctness", () => {
    expect(MEMBER_RLS).toContain(
      "ALTER DATABASE postgres SET hnsw.iterative_scan = 'strict_order'",
    );
    expect(MEMBER_RLS).toContain("ALTER DATABASE postgres SET hnsw.max_scan_tuples = 20000");
  });
});

describe("Memory mutation audit log migration", () => {
  it("exposes a public.set_config wrapper with locked search_path", () => {
    expect(AUDIT_LOG).toMatch(
      /CREATE OR REPLACE FUNCTION public\.set_config\([\s\S]*?setting_name TEXT,[\s\S]*?new_value TEXT,[\s\S]*?is_local BOOLEAN/,
    );
    expect(AUDIT_LOG).toContain("SECURITY DEFINER");
    expect(AUDIT_LOG).toContain("SET search_path = ''");
    expect(AUDIT_LOG).toContain("pg_catalog.set_config(setting_name, new_value, is_local)");
  });

  it("creates memory_audit with the canonical action set", () => {
    expect(AUDIT_LOG).toContain("CREATE TABLE IF NOT EXISTS public.memory_audit");
    expect(AUDIT_LOG).toContain("id BIGSERIAL PRIMARY KEY");
    for (const action of [
      "'insert'",
      "'update'",
      "'delete'",
      "'supersede'",
      "'invalidate'",
      "'pin'",
      "'archive'",
    ]) {
      expect(AUDIT_LOG).toContain(action);
    }
  });

  it("creates the three canonical audit indices", () => {
    expect(AUDIT_LOG).toContain("idx_memory_audit_workspace_recent");
    expect(AUDIT_LOG).toContain("idx_memory_audit_table_row");
    expect(AUDIT_LOG).toContain("idx_memory_audit_actor");
  });

  it("scopes audit reads to workspace members only", () => {
    expect(AUDIT_LOG).toMatch(
      /CREATE POLICY "members read" ON public\.memory_audit[\s\S]*?workspace_id IS NOT NULL[\s\S]*?public\.is_workspace_member\(workspace_id\)/,
    );
  });

  it("defines audit_memory_change as SECURITY DEFINER reading session config", () => {
    expect(AUDIT_LOG).toContain(
      "CREATE OR REPLACE FUNCTION public.audit_memory_change()",
    );
    expect(AUDIT_LOG).toContain("LANGUAGE plpgsql");
    expect(AUDIT_LOG).toContain("SECURITY DEFINER");
    expect(AUDIT_LOG).toContain("SET search_path = ''");
    expect(AUDIT_LOG).toContain("current_setting('app.actor', TRUE)");
    expect(AUDIT_LOG).toContain("current_setting('app.workflow_run_id', TRUE)");
    expect(AUDIT_LOG).toContain("'system:unknown'");
  });

  it.each([
    ["workspace_rule", "trg_audit_workspace_rule"],
    ["brand_guideline", "trg_audit_brand_guideline"],
    ["anticipation_hints", "trg_audit_anticipation_hints"],
    ["facts", "trg_audit_facts"],
    ["memory_entries", "trg_audit_memory_entries"],
  ])("attaches the audit trigger to %s", (table, trigger) => {
    expect(AUDIT_LOG).toContain(
      `CREATE TRIGGER ${trigger}\n  AFTER INSERT OR UPDATE OR DELETE ON public.${table}`,
    );
    expect(AUDIT_LOG).toContain(
      "FOR EACH ROW EXECUTE FUNCTION public.audit_memory_change()",
    );
  });
});

describe("Audit actor builders", () => {
  it("formats user actors with the user: prefix", () => {
    expect(buildUserActor("11111111-2222-3333-4444-555555555555")).toBe(
      "user:11111111-2222-3333-4444-555555555555",
    );
  });

  it("formats system extractor actors when no workflow name is given", () => {
    expect(buildSystemActor()).toBe("system:extractor");
  });

  it("formats named workflow system actors", () => {
    expect(buildSystemActor("brand-extraction")).toBe(
      "system:workflow:brand-extraction",
    );
  });

  it("formats admin actors", () => {
    expect(buildAdminActor("00000000-0000-0000-0000-000000000099")).toBe(
      "admin:00000000-0000-0000-0000-000000000099",
    );
  });
});
