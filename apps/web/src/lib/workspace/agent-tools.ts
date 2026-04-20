import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { assembleWorkspaceContext } from "@/lib/workspace/context";
import { BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";
import { createMemoryEntry, listMemoryEntries } from "@/lib/workspace/memory";
import { getScope, getScopeByKindSlug, listScopes } from "@/lib/workspace/scopes";
import type { WorkspaceScope } from "@/lib/workspace/types";

export type AgentCallContext = {
  workspaceId: string;
  currentScopeId: string | null;
  userEmail: string;
  userId: string;
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

async function resolveScopeRef(
  workspaceId: string,
  ref: string | null | undefined,
): Promise<WorkspaceScope | null> {
  if (!ref) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
    const found = await getScope(ref);
    return found && found.workspace_id === workspaceId ? found : null;
  }
  const trimmed = ref.trim();
  if (trimmed === "workspace" || trimmed === "analyst") {
    return getScopeByKindSlug(workspaceId, "system", trimmed);
  }
  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    const kindRaw = trimmed.slice(0, colon).trim();
    const name = trimmed.slice(colon + 1).trim();
    if (kindRaw === "client" || kindRaw === "category" || kindRaw === "function") {
      const slug = name
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return getScopeByKindSlug(workspaceId, kindRaw, slug);
    }
  }
  const all = await listScopes(workspaceId);
  return (
    all.find(
      (s) =>
        s.name.toLowerCase() === trimmed.toLowerCase() ||
        s.slug.toLowerCase() === trimmed.toLowerCase(),
    ) ?? null
  );
}

/**
 * readMemory: agent-initiated memory consultation. Rendered in the chat UI as a
 * subtle system chip "Reading workspace memory" (per Marco 7c rendering contract).
 */
export function readMemoryTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Read memory entries for the current workspace. Use this to find rules, facts, and wins Basquio has been taught. Pass an optional scope hint ('client:Lavazza', 'workspace', 'analyst') or scope UUID.",
    inputSchema: z.object({
      scope: z
        .string()
        .optional()
        .describe("Scope hint or UUID. If omitted, uses the current scope or all scopes."),
      memory_type: z.enum(["procedural", "semantic", "episodic"]).optional(),
      query: z.string().max(200).optional().describe("Free-text filter applied to entry content."),
      limit: z.number().int().min(1).max(40).default(12),
    }),
    execute: async ({ scope, memory_type, query, limit }) => {
      const scopeRow = scope
        ? await resolveScopeRef(ctx.workspaceId, scope)
        : ctx.currentScopeId
          ? await getScope(ctx.currentScopeId)
          : null;
      const entries = await listMemoryEntries({
        workspaceId: ctx.workspaceId,
        scopeId: scopeRow?.id,
        memoryType: memory_type,
        limit,
      });
      const filtered = query
        ? entries.filter((e) => e.content.toLowerCase().includes(query.toLowerCase()))
        : entries;
      return {
        resolved_scope: scopeRow
          ? { id: scopeRow.id, kind: scopeRow.kind, name: scopeRow.name, slug: scopeRow.slug }
          : null,
        count: filtered.length,
        entries: filtered.map((e) => ({
          id: e.id,
          memory_type: e.memory_type,
          scope_id: e.workspace_scope_id,
          scope: e.scope,
          path: e.path,
          content: e.content,
          updated_at: e.updated_at,
          pinned: typeof e.metadata?.pinned_at === "string",
        })),
      };
    },
  });
}

/**
 * teachRule: user-initiated explicit rule save. Rendered in the chat UI as a bold
 * affirmative card "Rule saved to Lavazza workspace" per Marco 7c.
 * Only fires when the user explicitly asks Basquio to remember or save.
 */
export function teachRuleTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Save a new rule, fact, or win for the workspace. Call this ONLY when the user explicitly asks you to 'remember', 'save', 'always do', or equivalent. Do NOT call proactively or silently.",
    inputSchema: z.object({
      scope: z.string().describe("Scope to save the rule under. Use 'workspace' for firm-wide, 'analyst' for analyst preferences, 'client:{name}' or 'category:{name}' for scoped rules."),
      memory_type: z
        .enum(["procedural", "semantic", "episodic"])
        .describe("procedural for rules Basquio should follow, semantic for facts, episodic for past wins."),
      content: z.string().min(3).max(4000).describe("The rule in plain prose, 1-3 sentences max."),
    }),
    execute: async ({ scope, memory_type, content }) => {
      const scopeRow = await resolveScopeRef(ctx.workspaceId, scope);
      if (!scopeRow) {
        return {
          ok: false,
          error: `Scope '${scope}' does not exist yet. Ask the user if they want to create it, or pick an existing scope.`,
        };
      }
      const entry = await createMemoryEntry({
        workspaceId: ctx.workspaceId,
        workspaceScopeId: scopeRow.id,
        memoryType: memory_type,
        content: content.trim(),
        metadata: {
          taught_by: ctx.userEmail,
          taught_at: new Date().toISOString(),
          via: "chat",
        },
        scope: scopeRow.kind === "system" ? scopeRow.slug : `${scopeRow.kind}:${scopeRow.name}`,
      });
      return {
        ok: true,
        entry_id: entry.id,
        scope: { id: scopeRow.id, kind: scopeRow.kind, name: scopeRow.name },
        memory_type: entry.memory_type,
        content: entry.content,
        path: entry.path,
      };
    },
  });
}

/**
 * retrieveContext: pulls chunks + entities + facts relevant to the user's prompt.
 * Rendered as a subtle system chip "Searching workspace" during streaming.
 */
export function retrieveContextTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Search the workspace knowledge base for chunks, entities, and facts relevant to a prompt. Use at the start of any analytical question.",
    inputSchema: z.object({
      query: z.string().min(3).max(500).describe("The user's question or a concise rephrasing."),
      scope: z.string().optional().describe("Optional scope hint. Defaults to the current scope."),
    }),
    execute: async ({ query, scope }) => {
      const scopeRow = scope
        ? await resolveScopeRef(ctx.workspaceId, scope)
        : ctx.currentScopeId
          ? await getScope(ctx.currentScopeId)
          : null;
      const legacyScope = scopeRow
        ? scopeRow.kind === "system"
          ? scopeRow.slug
          : `${scopeRow.kind}:${scopeRow.name}`
        : undefined;
      const context = await assembleWorkspaceContext({ prompt: query, scope: legacyScope });
      return {
        scope: scopeRow ? { id: scopeRow.id, name: scopeRow.name, kind: scopeRow.kind } : null,
        chunk_count: context.chunks.length,
        entity_count: context.entities.length,
        fact_count: context.facts.length,
        chunks: context.chunks.slice(0, 8).map((c, i) => ({
          label: `s${i + 1}`,
          source_type: c.sourceType,
          source_id: c.sourceId,
          filename: c.filename,
          content: c.content.slice(0, 600),
          score: c.score,
        })),
        facts: context.facts.slice(0, 12).map((f) => ({
          id: f.id,
          subject: f.subject_canonical_name,
          predicate: f.predicate,
          object_value: f.object_value,
          valid_from: f.valid_from,
          evidence: f.evidence,
        })),
        entities: context.entities.slice(0, 12).map((e) => ({
          id: e.id,
          type: e.type,
          name: e.canonical_name,
        })),
      };
    },
  });
}

/**
 * showMetricCard: generative UI tool. Renders a metric card inline for a single
 * KPI (value share, ROS, distribution, etc.) with a scope + period. Pure render
 * so the call context is not read.
 */
export function showMetricCardTool(_ctx: AgentCallContext) {
  return tool({
    description:
      "Render a metric card component inline in the chat. Call this when the user's answer centers on a single KPI number.",
    inputSchema: z.object({
      subject: z.string().min(1).max(120).describe("Brand or subject the metric describes, e.g. 'Mulino Bianco Crackers'."),
      metric: z.string().min(1).max(80).describe("KPI name, e.g. 'Value Share' or 'Rate of Sale'."),
      value: z.union([z.string(), z.number()]).describe("The numeric value, e.g. 18.4."),
      unit: z.string().max(16).optional().describe("Unit, e.g. '%', 'pts', 'EUR'."),
      period: z.string().max(40).optional().describe("Time window, e.g. 'Q4 2025' or '52w to 2025-12-28'."),
      delta: z.string().max(40).optional().describe("Change vs prior period, e.g. '-1.2 pts YoY'."),
      retailer: z.string().max(80).optional().describe("Retailer if the metric is retailer-scoped."),
      source_label: z.string().max(40).optional().describe("Citation label to attribute the number, e.g. 's1'."),
    }),
    execute: async (input) => {
      return { rendered: true, card: input };
    },
  });
}

/**
 * showStakeholderCard: generative UI tool. Renders a stakeholder card inline
 * with name / role / preferences so the user sees the linked profile.
 */
export function showStakeholderCardTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Render a stakeholder card component for a person the user just asked about or who appears in the answer.",
    inputSchema: z.object({
      person_id: z.string().uuid().optional(),
      name: z.string().min(1).max(120),
      role: z.string().max(120).optional(),
      company: z.string().max(120).optional(),
      preferences: z.array(z.string().max(200)).max(5).optional(),
    }),
    execute: async (input) => {
      let personId = input.person_id;
      if (!personId && input.name) {
        const db = getDb();
        const { data } = await db
          .from("entities")
          .select("id")
          .eq("workspace_id", ctx.workspaceId)
          .eq("type", "person")
          .ilike("canonical_name", input.name)
          .maybeSingle();
        if (data) personId = (data as { id: string }).id;
      }
      return { rendered: true, card: { ...input, person_id: personId ?? null } };
    },
  });
}

export function getAllTools(ctx: AgentCallContext) {
  return {
    memory: readMemoryTool(ctx),
    teachRule: teachRuleTool(ctx),
    retrieveContext: retrieveContextTool(ctx),
    showMetricCard: showMetricCardTool(ctx),
    showStakeholderCard: showStakeholderCardTool(ctx),
  } as const;
}
