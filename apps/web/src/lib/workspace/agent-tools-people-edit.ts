import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";
import { normalizeEntityName } from "@/lib/workspace/extraction";
import {
  createWorkspacePerson,
  getWorkspacePerson,
  listWorkspacePeople,
  updateWorkspacePerson,
  type PersonRow,
  type StakeholderPreferences,
} from "@/lib/workspace/people";
import type { AgentCallContext } from "@/lib/workspace/agent-tools";

/**
 * Stakeholder edit/create tools per spec §6.3 and §6.4.
 *
 * editStakeholder:
 *  - Resolve by person_id or by canonical_name ilike scoped to workspace.
 *  - If not found: return { status: "not_found", suggestions: [top 3] }
 *    so the chat can prompt the user to clarify or call createStakeholder.
 *  - If found and dry_run: return before/after diff for the approval card.
 *  - If found and dry_run: false: apply the patch via updateWorkspacePerson.
 *
 * createStakeholder:
 *  - Dry-run returns the assembled profile preview.
 *  - Persist calls createWorkspacePerson with the full payload.
 *
 * Both tools operate on the `entities` table via people.ts helpers. No
 * direct SQL from the tool body keeps the privilege surface tight.
 */

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

const stakeholderStructuredSchema = z
  .object({
    chart_preference: z.string().max(200).optional(),
    deck_length: z.string().max(200).optional(),
    language: z.string().max(50).optional(),
    tone: z.string().max(200).optional(),
    review_day: z.string().max(50).optional(),
  })
  .partial();

const stakeholderPreferencesSchema = z
  .object({
    free_text: z.string().max(2000).optional(),
    structured: stakeholderStructuredSchema.optional(),
  })
  .partial();

export function editStakeholderTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Update a stakeholder's role, company, preferences, or notes. Resolves by person_id or by name. Dry-run (default) returns a before/after diff so the user can approve; pass dry_run: false only after the approval card has been confirmed.",
    inputSchema: z
      .object({
        person_id: z.string().uuid().optional(),
        name: z.string().min(1).max(120).optional(),
        company: z.string().max(120).optional(),
        patch: z.object({
          role: z.string().max(120).optional(),
          company: z.string().max(120).optional(),
          description: z.string().max(1000).optional(),
          linked_scope_id: z.string().uuid().optional(),
          preferences: stakeholderPreferencesSchema.optional(),
          notes: z.string().max(4000).optional(),
          aliases_to_add: z.array(z.string().max(120)).max(10).optional(),
        }),
        dry_run: z.boolean().default(true),
      })
      .refine((d) => d.person_id || d.name, {
        message: "Provide person_id or name to resolve the stakeholder",
      }),
    execute: async (input) => {
      const resolved = await resolveStakeholder(ctx.workspaceId, {
        personId: input.person_id,
        name: input.name ?? null,
        company: input.company ?? null,
      });
      if (resolved.status === "not_found") {
        return {
          ok: false,
          status: "not_found" as const,
          suggestions: resolved.suggestions,
          message:
            "No matching stakeholder. Ask the user to clarify, or call createStakeholder to add a new profile.",
        };
      }
      const person = resolved.person;
      const nextMetadata = mergeMetadata(person.metadata, input.patch);
      const nextAliases = input.patch.aliases_to_add
        ? Array.from(new Set([...(person.aliases ?? []), ...input.patch.aliases_to_add]))
        : undefined;

      if (input.dry_run !== false) {
        return {
          ok: true,
          status: "preview" as const,
          person_id: person.id,
          canonical_name: person.canonical_name,
          before: {
            role: person.metadata?.role ?? null,
            company: person.metadata?.company ?? null,
            description: person.metadata?.description ?? null,
            linked_scope_id: person.metadata?.linked_scope_id ?? null,
            preferences: person.metadata?.preferences ?? null,
            notes: person.metadata?.notes ?? null,
            aliases: person.aliases ?? [],
          },
          after: {
            role: nextMetadata.role ?? null,
            company: nextMetadata.company ?? null,
            description: nextMetadata.description ?? null,
            linked_scope_id: nextMetadata.linked_scope_id ?? null,
            preferences: nextMetadata.preferences ?? null,
            notes: nextMetadata.notes ?? null,
            aliases: nextAliases ?? person.aliases ?? [],
          },
        };
      }

      try {
        const updated = await updateWorkspacePerson(person.id, {
          role: input.patch.role,
          company: input.patch.company,
          preferences: nextMetadata.preferences as StakeholderPreferences | undefined,
          notes: input.patch.notes,
          linked_scope_id: input.patch.linked_scope_id,
          aliases: nextAliases,
        });
        return {
          ok: true,
          status: "updated" as const,
          person_id: updated.id,
          canonical_name: updated.canonical_name,
          metadata: updated.metadata,
        };
      } catch (err) {
        return {
          ok: false,
          status: "error" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

export function createStakeholderTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Create a new stakeholder profile. Call after editStakeholder returns status: not_found, or when the user explicitly asks to add a new person. Dry-run returns the assembled profile preview; dry_run: false persists.",
    inputSchema: z.object({
      canonicalName: z.string().min(1).max(120),
      role: z.string().max(120).optional(),
      company: z.string().max(120).optional(),
      description: z.string().max(1000).optional(),
      linked_scope_id: z.string().uuid().optional(),
      preferences: stakeholderPreferencesSchema.optional(),
      aliases: z.array(z.string().max(120)).max(10).optional(),
      notes: z.string().max(4000).optional(),
      dry_run: z.boolean().default(true),
    }),
    execute: async (input) => {
      const preview = {
        canonical_name: input.canonicalName.trim(),
        role: input.role ?? null,
        company: input.company ?? null,
        description: input.description ?? null,
        linked_scope_id: input.linked_scope_id ?? null,
        preferences: input.preferences ?? null,
        aliases: input.aliases ?? [],
        notes: input.notes ?? null,
      };
      if (input.dry_run !== false) {
        return { ok: true, status: "preview" as const, ...preview };
      }
      try {
        const created = await createWorkspacePerson({
          workspaceId: ctx.workspaceId ?? BASQUIO_TEAM_WORKSPACE_ID,
          canonicalName: input.canonicalName.trim(),
          role: input.role,
          company: input.company,
          preferences: input.preferences as StakeholderPreferences | undefined,
          aliases: input.aliases,
          notes: input.notes,
          linkedScopeId: input.linked_scope_id ?? null,
          createdBy: ctx.userEmail,
        });
        return {
          ok: true,
          status: "created" as const,
          person_id: created.id,
          canonical_name: created.canonical_name,
          metadata: created.metadata,
        };
      } catch (err) {
        return {
          ok: false,
          status: "error" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

type ResolveResult =
  | { status: "found"; person: PersonRow }
  | { status: "not_found"; suggestions: Array<{ person_id: string; name: string; role: string | null }> };

async function resolveStakeholder(
  workspaceId: string,
  query: { personId?: string; name: string | null; company: string | null },
): Promise<ResolveResult> {
  if (query.personId) {
    const person = await getWorkspacePerson(query.personId);
    if (person && person.workspace_id === workspaceId) {
      return { status: "found", person };
    }
  }
  if (!query.name) {
    return { status: "not_found", suggestions: [] };
  }

  // Look up by exact normalized name first.
  const normalized = normalizeEntityName(query.name);
  const db = getDb();
  const { data: exact } = await db
    .from("entities")
    .select("id, workspace_id, type, canonical_name, normalized_name, aliases, metadata, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("type", "person")
    .eq("normalized_name", normalized)
    .maybeSingle();
  if (exact) {
    const person = exact as PersonRow;
    if (!query.company) return { status: "found", person };
    const sameCompany =
      (person.metadata?.company ?? "").toLowerCase() === query.company.toLowerCase();
    if (sameCompany) return { status: "found", person };
  }

  // Fuzzy suggestions: list all people + rank by simple substring score.
  const people = await listWorkspacePeople(workspaceId);
  const lowered = query.name.toLowerCase();
  const scored = people
    .map((p) => ({
      person: p,
      score:
        p.canonical_name.toLowerCase().includes(lowered) ||
        (p.aliases ?? []).some((a) => a.toLowerCase().includes(lowered))
          ? 2
          : lowered.includes(p.canonical_name.toLowerCase())
            ? 1
            : 0,
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return {
    status: "not_found",
    suggestions: scored.map((s) => ({
      person_id: s.person.id,
      name: s.person.canonical_name,
      role: s.person.metadata?.role ?? null,
    })),
  };
}

type PatchShape = {
  role?: string;
  company?: string;
  description?: string;
  linked_scope_id?: string;
  preferences?: z.infer<typeof stakeholderPreferencesSchema>;
  notes?: string;
};

function mergeMetadata(
  existing: PersonRow["metadata"] | null | undefined,
  patch: PatchShape,
): PersonRow["metadata"] {
  const merged: PersonRow["metadata"] = { ...(existing ?? {}) };
  if (patch.role !== undefined) merged.role = patch.role;
  if (patch.company !== undefined) merged.company = patch.company;
  if (patch.description !== undefined) merged.description = patch.description;
  if (patch.linked_scope_id !== undefined) merged.linked_scope_id = patch.linked_scope_id;
  if (patch.notes !== undefined) merged.notes = patch.notes;
  if (patch.preferences !== undefined) {
    const existingPrefs = (existing?.preferences as StakeholderPreferences | undefined) ?? {};
    const structuredPatch = patch.preferences.structured ?? {};
    const existingStructured = existingPrefs.structured ?? {};
    merged.preferences = {
      ...existingPrefs,
      ...patch.preferences,
      structured: {
        ...existingStructured,
        ...structuredPatch,
      },
    } as StakeholderPreferences;
  }
  return merged;
}
