import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";
import { normalizeEntityName } from "@/lib/workspace/extraction";
import type {
  PersonDeliverable,
  PersonFact,
  PersonMention,
  PersonProfile,
  PersonRow,
  StakeholderPreferences,
} from "@/lib/workspace/people-types";

export type {
  PersonDeliverable,
  PersonFact,
  PersonMention,
  PersonProfile,
  PersonRow,
  StakeholderPreferences,
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

export async function listWorkspacePeople(
  workspaceId: string = BASQUIO_TEAM_WORKSPACE_ID,
): Promise<PersonRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from("entities")
    .select(
      "id, workspace_id, type, canonical_name, normalized_name, aliases, metadata, created_at, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("type", "person")
    .order("canonical_name", { ascending: true })
    .limit(500);
  if (error) throw new Error(`listWorkspacePeople failed: ${error.message}`);
  return (data ?? []) as PersonRow[];
}

export async function createWorkspacePerson(input: {
  workspaceId?: string;
  canonicalName: string;
  aliases?: string[];
  role?: string;
  company?: string;
  preferences?: StakeholderPreferences;
  notes?: string;
  linkedScopeId?: string | null;
  createdBy?: string | null;
}): Promise<PersonRow> {
  const workspaceId = input.workspaceId ?? BASQUIO_TEAM_WORKSPACE_ID;
  const canonical = input.canonicalName.trim();
  if (!canonical) throw new Error("Person canonical_name is required.");
  const normalized = normalizeEntityName(canonical);
  const metadata: PersonRow["metadata"] = {};
  if (input.role) metadata.role = input.role;
  if (input.company) metadata.company = input.company;
  if (input.preferences) metadata.preferences = input.preferences;
  if (input.notes) metadata.notes = input.notes;
  if (input.linkedScopeId) metadata.linked_scope_id = input.linkedScopeId;
  if (input.createdBy) metadata.created_by = input.createdBy;

  const db = getDb();
  const { data, error } = await db
    .from("entities")
    .upsert(
      {
        workspace_id: workspaceId,
        organization_id: workspaceId,
        is_team_beta: true,
        type: "person",
        canonical_name: canonical,
        normalized_name: normalized,
        aliases: input.aliases ?? [],
        metadata,
      },
      { onConflict: "organization_id,type,normalized_name" },
    )
    .select(
      "id, workspace_id, type, canonical_name, normalized_name, aliases, metadata, created_at, updated_at",
    )
    .single();
  if (error) throw new Error(`createWorkspacePerson failed: ${error.message}`);
  return data as PersonRow;
}

export async function getWorkspacePerson(personId: string): Promise<PersonRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("entities")
    .select(
      "id, workspace_id, type, canonical_name, normalized_name, aliases, metadata, created_at, updated_at",
    )
    .eq("id", personId)
    .eq("type", "person")
    .maybeSingle();
  if (error) throw new Error(`getWorkspacePerson failed: ${error.message}`);
  return data ? (data as PersonRow) : null;
}

export async function updateWorkspacePerson(
  personId: string,
  patch: {
    canonical_name?: string;
    aliases?: string[];
    role?: string;
    company?: string;
    preferences?: StakeholderPreferences;
    notes?: string;
    linked_scope_id?: string | null;
  },
): Promise<PersonRow> {
  const db = getDb();
  const existing = await getWorkspacePerson(personId);
  if (!existing) throw new Error("Person not found.");

  const metadata: PersonRow["metadata"] = { ...existing.metadata };
  if (patch.role !== undefined) metadata.role = patch.role;
  if (patch.company !== undefined) metadata.company = patch.company;
  if (patch.preferences !== undefined) metadata.preferences = patch.preferences;
  if (patch.notes !== undefined) metadata.notes = patch.notes;
  if (patch.linked_scope_id !== undefined) metadata.linked_scope_id = patch.linked_scope_id ?? undefined;

  const update: Record<string, unknown> = {
    metadata,
    updated_at: new Date().toISOString(),
  };
  if (patch.canonical_name !== undefined) update.canonical_name = patch.canonical_name;
  if (patch.aliases !== undefined) update.aliases = patch.aliases;

  const { data, error } = await db
    .from("entities")
    .update(update)
    .eq("id", personId)
    .eq("type", "person")
    .select(
      "id, workspace_id, type, canonical_name, normalized_name, aliases, metadata, created_at, updated_at",
    )
    .single();
  if (error) throw new Error(`updateWorkspacePerson failed: ${error.message}`);
  return data as PersonRow;
}

export async function getWorkspacePersonProfile(personId: string): Promise<PersonProfile | null> {
  const person = await getWorkspacePerson(personId);
  if (!person) return null;

  const db = getDb();
  const [{ data: mentions }, { data: facts }] = await Promise.all([
    db
      .from("entity_mentions")
      .select("id, source_type, source_id, excerpt, created_at")
      .eq("workspace_id", person.workspace_id)
      .eq("entity_id", personId)
      .order("created_at", { ascending: false })
      .limit(30),
    db
      .from("facts")
      .select(
        "id, predicate, object_value, valid_from, valid_to, confidence, metadata, source_id, source_type",
      )
      .eq("workspace_id", person.workspace_id)
      .eq("subject_entity", personId)
      .is("superseded_by", null)
      .order("ingested_at", { ascending: false })
      .limit(30),
  ]);

  const documentIds = new Set<string>();
  for (const m of (mentions ?? []) as Array<{ source_type: string; source_id: string }>) {
    if (m.source_type === "document") documentIds.add(m.source_id);
  }
  for (const f of (facts ?? []) as Array<{ source_type: string | null; source_id: string | null }>) {
    if (f.source_type === "document" && f.source_id) documentIds.add(f.source_id);
  }

  const filenameById = new Map<string, string>();
  if (documentIds.size > 0) {
    const { data: docs } = await db
      .from("knowledge_documents")
      .select("id, filename")
      .in("id", Array.from(documentIds));
    for (const d of (docs ?? []) as Array<{ id: string; filename: string }>) {
      filenameById.set(d.id, d.filename);
    }
  }

  const excerptKeywords = new Set<string>();
  excerptKeywords.add(person.canonical_name.toLowerCase());
  for (const a of person.aliases ?? []) excerptKeywords.add(a.toLowerCase());

  // Gather deliverables that cited this person (via citations metadata or prompt mention).
  const { data: deliverables } = await db
    .from("workspace_deliverables")
    .select("id, title, kind, status, scope, prompt, created_at")
    .eq("workspace_id", person.workspace_id)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(40);
  const linkedDeliverables = ((deliverables ?? []) as Array<{
    id: string;
    title: string;
    kind: string;
    status: string;
    scope: string | null;
    prompt: string;
    created_at: string;
  }>)
    .filter((d) => {
      const hay = `${d.title}\n${d.prompt}`.toLowerCase();
      for (const kw of excerptKeywords) {
        if (hay.includes(kw)) return true;
      }
      return false;
    })
    .slice(0, 10)
    .map((d) => ({
      id: d.id,
      title: d.title,
      kind: d.kind,
      status: d.status,
      scope: d.scope,
      created_at: d.created_at,
    }));

  return {
    ...person,
    mentions: ((mentions ?? []) as Array<{
      id: string;
      source_type: string;
      source_id: string;
      excerpt: string | null;
      created_at: string;
    }>).map((m) => ({
      id: m.id,
      source_type: m.source_type as PersonMention["source_type"],
      source_id: m.source_id,
      excerpt: m.excerpt,
      created_at: m.created_at,
      document_filename:
        m.source_type === "document" ? filenameById.get(m.source_id) ?? null : null,
    })),
    facts: ((facts ?? []) as Array<{
      id: string;
      predicate: string;
      object_value: unknown;
      valid_from: string | null;
      valid_to: string | null;
      confidence: number;
      metadata: Record<string, unknown> | null;
      source_id: string | null;
      source_type: string | null;
    }>).map((f) => ({
      id: f.id,
      predicate: f.predicate,
      object_value: f.object_value,
      valid_from: f.valid_from,
      valid_to: f.valid_to,
      confidence: f.confidence,
      evidence: typeof f.metadata?.evidence === "string" ? (f.metadata.evidence as string) : null,
      source_id: f.source_id,
      document_filename:
        f.source_type === "document" && f.source_id
          ? filenameById.get(f.source_id) ?? null
          : null,
    })),
    deliverables: linkedDeliverables,
  };
}
