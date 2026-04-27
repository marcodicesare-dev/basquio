import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";

/**
 * Memory v1 Brief 5 PART B: data loaders for the Memory Inspector v2 tabs.
 *
 * Reads only. All audited mutations route through SECURITY DEFINER
 * RPCs in rules.ts / candidates.ts (existing) / future entity-action
 * RPCs (Brief 5 PUSH 3 if needed). The inspector page assembles these
 * loaders on the server and hands typed rows to the client component.
 */

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export type InspectorEntity = {
  id: string;
  type: string;
  canonical_name: string;
  aliases: string[];
  created_at: string;
  updated_at: string;
};

export async function listInspectorEntities(
  workspaceId: string,
  limit = 200,
): Promise<InspectorEntity[]> {
  const db = getDb();
  const { data, error } = await db
    .from("entities")
    .select("id, type, canonical_name, aliases, created_at, updated_at")
    .eq("organization_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`entities list failed: ${error.message}`);
  return (data ?? []) as InspectorEntity[];
}

export type InspectorFact = {
  id: string;
  subject_entity: string;
  predicate: string;
  object_value: unknown;
  object_entity: string | null;
  valid_from: string | null;
  valid_to: string | null;
  expired_at: string | null;
  superseded_by: string | null;
  confidence: number;
  source_id: string | null;
  source_type: string | null;
  ingested_at: string;
};

export type ListInspectorFactsOptions = {
  subjectEntityId?: string;
  asOf?: string;
  includeSuperseded?: boolean;
  limit?: number;
};

export async function listInspectorFacts(
  workspaceId: string,
  options: ListInspectorFactsOptions = {},
): Promise<InspectorFact[]> {
  const db = getDb();
  let q = db
    .from("facts")
    .select(
      "id, subject_entity, predicate, object_value, object_entity, valid_from, valid_to, expired_at, superseded_by, confidence, source_id, source_type, ingested_at",
    )
    .eq("organization_id", workspaceId)
    .order("ingested_at", { ascending: false })
    .limit(options.limit ?? 200);
  if (options.subjectEntityId) {
    q = q.eq("subject_entity", options.subjectEntityId);
  }
  if (!options.includeSuperseded) {
    q = q.is("superseded_by", null).is("expired_at", null);
  }
  if (options.asOf) {
    q = q.lte("valid_from", options.asOf);
  }
  const { data, error } = await q;
  if (error) throw new Error(`facts list failed: ${error.message}`);
  return (data ?? []) as InspectorFact[];
}

export type InspectorEntityCount = {
  entity_id: string;
  fact_count: number;
};

/**
 * Best-effort fact count per entity for the Entities tab. Single
 * round-trip: pulls all facts and aggregates client-side. For workspaces
 * with > 5000 facts a server-side aggregation RPC would be cleaner;
 * Brief 5 ships the simpler loader and Brief 6 admin console can add
 * the aggregation if production load justifies it.
 */
export async function countFactsByEntity(
  workspaceId: string,
): Promise<Map<string, number>> {
  const db = getDb();
  const { data, error } = await db
    .from("facts")
    .select("subject_entity")
    .eq("organization_id", workspaceId)
    .is("superseded_by", null)
    .is("expired_at", null)
    .limit(5000);
  if (error) throw new Error(`facts count failed: ${error.message}`);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ subject_entity: string }>) {
    counts.set(row.subject_entity, (counts.get(row.subject_entity) ?? 0) + 1);
  }
  return counts;
}

export function isMemoryInspectorV2Enabled(): boolean {
  return process.env.MEMORY_INSPECTOR_V2 === "true";
}

export type MemoryCounts = {
  entities: number;
  facts: number;
  activeRules: number;
  pendingCandidates: number;
};

/**
 * Compact counts shown on the workspace home "Your workspace remembers"
 * card and on the Memory Inspector v2 page header. All four queries run
 * in parallel; failure on any one returns zero for that bucket so the
 * card degrades gracefully when a table is empty or unreachable.
 */
export async function getWorkspaceMemoryCounts(workspaceId: string): Promise<MemoryCounts> {
  const db = getDb();
  const [entitiesResult, factsResult, rulesResult, candidatesResult] = await Promise.all([
    db
      .from("entities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", workspaceId)
      .then(({ count, error }) => {
        if (error) {
          console.error("[memory counts] entities count failed", error);
          return 0;
        }
        return count ?? 0;
      }),
    db
      .from("facts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", workspaceId)
      .is("superseded_by", null)
      .is("expired_at", null)
      .then(({ count, error }) => {
        if (error) {
          console.error("[memory counts] facts count failed", error);
          return 0;
        }
        return count ?? 0;
      }),
    db
      .from("workspace_rule")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .is("expired_at", null)
      .then(({ count, error }) => {
        if (error) {
          console.error("[memory counts] rules count failed", error);
          return 0;
        }
        return count ?? 0;
      }),
    db
      .from("memory_candidates")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .then(({ count, error }) => {
        if (error) {
          console.error("[memory counts] candidates count failed", error);
          return 0;
        }
        return count ?? 0;
      }),
  ]);
  return {
    entities: entitiesResult,
    facts: factsResult,
    activeRules: rulesResult,
    pendingCandidates: candidatesResult,
  };
}
