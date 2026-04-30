import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { tool } from "ai";
import { z } from "zod";

import { loadNiqServicesCatalog, NiqServicesCatalogNotFoundError } from "@basquio/research";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { BASQUIO_TEAM_WORKSPACE_ID } from "@/lib/workspace/constants";
import {
  archiveMemoryEntry,
  createMemoryEntry,
  deleteMemoryEntry,
  getMemoryEntry,
  togglePinMemoryEntry,
  updateMemoryEntry,
} from "@/lib/workspace/memory";
import { createScope, getScope, getScopeByKindSlug, listScopes } from "@/lib/workspace/scopes";
import type { WorkspaceScope } from "@/lib/workspace/types";
import { listWorkspacePeople } from "@/lib/workspace/people";
import type { AgentCallContext } from "@/lib/workspace/agent-tools";

/**
 * Editorial tools per spec §6.5 to §6.7 and §6.11.
 *
 * editRule: create/update/archive/unarchive/pin/unpin/delete for memory
 * entries. Supersets the existing teachRule (which stays registered for
 * backward compatibility).
 *
 * draftBrief: pre-fills a deck brief from the chat turn. This version
 * returns structured brief fields plus workspace-context counts so the
 * chat card can render without calling synthesizeBrief. Full Haiku
 * synthesis is wired in B2c once the synthesizeBrief upgrade lands.
 *
 * explainBasquio: live workspace introspection keyed by topic. Returns
 * counts plus actionable copy so the chat never falls back to generic
 * AI-assistant prose.
 *
 * suggestServices: loads the NIQ services catalog and calls Haiku with
 * scope + stakeholder context to produce 3-5 ranked recommendations.
 * Returns catalog_review_pending derived from the parser's sentinel
 * detection so the approval card can surface the pending-sign-off note.
 */

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
    // System scopes are an invariant: every workspace must have them.
    // Migration 20260520200000 backfills + a trigger maintains the
    // invariant going forward, but we still self-heal here in case a
    // workspace landed before the trigger shipped or a race deleted the
    // row. SOTA pattern (Harvey, Legora): firm-wide scope is never
    // surfaced to the user as a precondition failure.
    const existing = await getScopeByKindSlug(workspaceId, "system", trimmed);
    if (existing) return existing;
    try {
      return await createScope({
        workspaceId,
        kind: "system",
        name: trimmed === "workspace" ? "Workspace" : "Analyst",
        slug: trimmed,
        metadata: { seeded: true, builtin: true, via: "agent-tools-editorial:auto-heal" },
      });
    } catch (err) {
      // Race lost to another writer (23505); read it back.
      return getScopeByKindSlug(workspaceId, "system", trimmed);
    }
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

export function editRuleTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Create, update, archive, pin, or delete a saved workspace knowledge item (instruction, knowledge, or example). Use for any of: 'create' (prefer teachRule for simple explicit saves; 'scope' accepts a single string OR an array of scope refs to save the same item under multiple clients/categories at once), 'update' (patch content/memory_type/scope on an existing rule_id), 'archive' or 'unarchive', 'pin' or 'unpin', 'delete'. Destructive actions (archive, delete) always require approval.",
    inputSchema: z
      .object({
        action: z.enum(["create", "update", "archive", "unarchive", "pin", "unpin", "delete"]),
        rule_id: z.string().uuid().optional(),
        scope: z.union([z.string(), z.array(z.string()).min(1).max(20)]).optional(),
        memory_type: z.enum(["procedural", "semantic", "episodic"]).optional(),
        content: z.string().min(3).max(4000).optional(),
        reason: z.string().max(400).optional(),
      })
      .refine((d) => d.action === "create" || d.rule_id, {
        message: "Non-create actions require rule_id",
      }),
    execute: async (input) => {
      try {
        if (input.action === "create") {
          if (!input.scope || !input.memory_type || !input.content) {
            return {
              ok: false,
              error: "create requires scope, memory_type, and content",
            };
          }
          // Multi-scope save: when the user says "fai valere per Carrefour
          // ed Esselunga" we want one row per scope. Schema (memory_entries)
          // stores one scope per row, so we loop.
          const scopeRefs = Array.isArray(input.scope) ? input.scope : [input.scope];
          const resolved: Array<{ ref: string; row: WorkspaceScope | null }> = [];
          for (const ref of scopeRefs) {
            const row = await resolveScopeRef(ctx.workspaceId, ref);
            resolved.push({ ref, row });
          }
          const missing = resolved.filter((r) => !r.row).map((r) => r.ref);
          if (missing.length > 0) {
            return {
              ok: false,
              error:
                missing.length === 1
                  ? `Cannot find a scope called '${missing[0]}'. Pass 'workspace' for firm-wide, or pick from the existing clients/categories in the sidebar.`
                  : `Cannot find scopes: ${missing.join(", ")}. Pick from the existing clients/categories.`,
            };
          }

          const created: Array<{
            entry_id: string;
            scope: { id: string; kind: string; name: string };
            content: string;
            memory_type: typeof input.memory_type;
          }> = [];
          for (const { row } of resolved) {
            if (!row) continue;
            const entry = await createMemoryEntry({
              workspaceId: ctx.workspaceId,
              workspaceScopeId: row.id,
              memoryType: input.memory_type,
              content: input.content.trim(),
              metadata: {
                taught_by: ctx.userEmail,
                taught_at: new Date().toISOString(),
                via: "chat",
                reason: input.reason ?? null,
                multi_scope_save: scopeRefs.length > 1,
              },
              scope:
                row.kind === "system"
                  ? row.slug
                  : `${row.kind}:${row.name}`,
            });
            created.push({
              entry_id: entry.id,
              scope: { id: row.id, kind: row.kind, name: row.name },
              content: entry.content,
              memory_type: entry.memory_type,
            });
          }
          if (created.length === 1) {
            const only = created[0];
            return {
              ok: true,
              action: "create" as const,
              entry_id: only.entry_id,
              scope: only.scope,
              memory_type: only.memory_type,
              content: only.content,
            };
          }
          return {
            ok: true,
            action: "create" as const,
            entries: created,
            scopes_saved: created.map((c) => c.scope),
            content: created[0]?.content ?? input.content.trim(),
            memory_type: input.memory_type,
          };
        }

        // Non-create actions: rule_id required, must exist + belong to workspace.
        const existing = await getMemoryEntry(input.rule_id!);
        if (!existing || existing.workspace_id !== ctx.workspaceId) {
          return { ok: false, error: "Saved knowledge item not found in this workspace." };
        }

        if (input.action === "update") {
          const patch: {
            content?: string;
            memoryType?: typeof input.memory_type;
            workspaceScopeId?: string | null;
          } = {};
          if (input.content !== undefined) patch.content = input.content.trim();
          if (input.memory_type !== undefined) patch.memoryType = input.memory_type;
          if (input.scope !== undefined) {
            // For update we still take the first scope only. To relocate
            // a single rule to multiple scopes, the agent should issue
            // create calls for the new scopes and archive the old.
            const scopeRef = Array.isArray(input.scope) ? input.scope[0] : input.scope;
            const scopeRow = await resolveScopeRef(ctx.workspaceId, scopeRef);
            if (!scopeRow) {
              return { ok: false, error: `Cannot find a scope called '${scopeRef}'.` };
            }
            patch.workspaceScopeId = scopeRow.id;
          }
          const updated = await updateMemoryEntry(existing.id, patch);
          return {
            ok: true,
            action: "update" as const,
            entry_id: updated.id,
            content: updated.content,
            memory_type: updated.memory_type,
          };
        }
        if (input.action === "archive") {
          const row = await archiveMemoryEntry(existing.id);
          return { ok: true, action: "archive" as const, entry_id: row.id };
        }
        if (input.action === "unarchive") {
          const row = await updateMemoryEntry(existing.id, {
            metadata: { ...(existing.metadata ?? {}), archived_at: undefined },
          });
          return { ok: true, action: "unarchive" as const, entry_id: row.id };
        }
        if (input.action === "pin") {
          const row = await togglePinMemoryEntry(existing.id, true);
          return { ok: true, action: "pin" as const, entry_id: row.id };
        }
        if (input.action === "unpin") {
          const row = await togglePinMemoryEntry(existing.id, false);
          return { ok: true, action: "unpin" as const, entry_id: row.id };
        }
        if (input.action === "delete") {
          await deleteMemoryEntry(existing.id);
          return { ok: true, action: "delete" as const, entry_id: existing.id };
        }
        return { ok: false, error: `Unsupported action: ${input.action}` };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

export function draftBriefTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Pre-fill a deck brief from the current chat thread. Use when the user says 'draft me a brief', 'let's turn this into a deck', or 'prepare the Kellanova Q1 review'. Returns an editable BriefDraftCard with the synthesized title, objective, narrative, and audience plus a preview of the workspace context that will drive the deck.",
    inputSchema: z.object({
      topic: z.string().min(3).max(500),
      audience_hint: z.string().max(200).optional(),
      scope_id: z.string().uuid().optional(),
      extra_instructions: z.string().max(1000).optional(),
      include_research: z.boolean().default(true),
    }),
    execute: async (input) => {
      const scopeId = input.scope_id ?? ctx.currentScopeId ?? null;
      const scope = scopeId ? await getScope(scopeId).catch(() => null) : null;
      const db = getDb();

      const [stakeholders, memoryCount, fileCount] = await Promise.all([
        listWorkspacePeople(ctx.workspaceId).catch(() => []),
        db
          .from("memory_entries")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", ctx.workspaceId)
          .then((r) => r.count ?? 0),
        db
          .from("knowledge_documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.organizationId)
          .in("status", ["indexed", "processing"])
          .then((r) => r.count ?? 0),
      ]);

      const scopedStakeholders = stakeholders
        .filter((p) => {
          if (scope?.id && p.metadata?.linked_scope_id === scope.id) return true;
          if (scope?.name) {
            const needle = scope.name.toLowerCase();
            const company = String(p.metadata?.company ?? "").toLowerCase();
            return company.includes(needle);
          }
          return false;
        })
        .slice(0, 4);

      const topStakeholder = scopedStakeholders[0];
      const preferredLanguage =
        topStakeholder?.metadata?.preferences?.structured?.language ?? null;
      const preferredDeckLength =
        topStakeholder?.metadata?.preferences?.structured?.deck_length ?? null;

      const briefTitle = input.topic.slice(0, 120);
      const audience =
        input.audience_hint ??
        topStakeholder?.metadata?.role ??
        "Executive stakeholder";

      return {
        ok: true,
        brief: {
          title: briefTitle,
          objective: input.topic,
          audience,
          language: preferredLanguage,
          deck_length: preferredDeckLength,
          thesis: "",
          stakes: "",
          extra_instructions: input.extra_instructions ?? null,
        },
        scope: scope ? { id: scope.id, kind: scope.kind, name: scope.name } : null,
        context_preview: {
          scoped_stakeholder_count: scopedStakeholders.length,
          scoped_stakeholders: scopedStakeholders.map((p) => ({
            id: p.id,
            name: p.canonical_name,
            role: p.metadata?.role ?? null,
          })),
          workspace_memory_count: memoryCount,
          workspace_file_count: fileCount,
        },
        include_research: input.include_research,
      };
    },
  });
}

export function explainBasquioTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Answer questions about what Basquio is, what it knows, and what the user can do in this workspace. Call this instead of generating generic AI-assistant copy when the user asks 'what can you do', 'how does this work', 'what do you know about me', or 'how do I save/edit/pin an instruction'.",
    inputSchema: z.object({
      topic: z.enum([
        "overview",
        "memory",
        "stakeholders",
        "instructions",
        "rules",
        "decks",
        "briefs",
        "sources",
        "scopes",
        "what_you_know_about_me",
        "what_i_can_edit",
      ]),
    }),
    execute: async ({ topic }) => {
      const db = getDb();
      switch (topic) {
        case "memory":
        case "instructions":
        case "rules": {
          const { count } = await db
            .from("memory_entries")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", ctx.workspaceId);
          return {
            topic,
            headline: `${count ?? 0} saved knowledge items across your contexts.`,
            body:
              "Ask Basquio to remember context ('remember: for Despar, Marca del Distributore means private label'), or to edit an existing instruction ('update the source callout instruction to say top-right'). Pin an item to keep it sticky, or archive it when it is outdated.",
          };
        }
        case "stakeholders": {
          const people = await listWorkspacePeople(ctx.workspaceId).catch(() => []);
          return {
            topic,
            headline: `${people.length} stakeholder profiles in this workspace.`,
            body:
              "Ask 'show Maria at Kellanova' to see a profile, 'update Giulia to prefer 52-week reads' to edit preferences, or 'add Giulia Bianchi, Head of Marketing at Amadori' to create a new one. editStakeholder returns a before/after diff on approval.",
          };
        }
        case "decks":
        case "briefs": {
          const { count } = await db
            .from("deck_runs")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", ctx.workspaceId);
          return {
            topic,
            headline: `${count ?? 0} decks generated from this workspace.`,
            body:
              "Drop a brief in chat or click 'Generate deck' in the scope rail. Basquio pulls stakeholder preferences, saved knowledge, and scope files, then researches trade press to ground the narrative. The brief preview shows exactly what context travels with the deck.",
          };
        }
        case "sources": {
          const [workspaceFiles, externalSources] = await Promise.all([
            db
              .from("knowledge_documents")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", ctx.organizationId)
              .in("kind", ["uploaded_file", "chat_paste", "chat_url"])
              .neq("status", "deleted"),
            db
              .from("source_catalog")
              .select("id", { count: "exact", head: true })
              .eq("workspace_id", ctx.workspaceId)
              .eq("status", "active"),
          ]);
          return {
            topic,
            headline: `${workspaceFiles.count ?? 0} internal files and ${
              externalSources.count ?? 0
            } active web sources.`,
            body:
              "Open /workspace/sources to upload reusable files for workspace retrieval, see indexed repository files, " +
              "and review the curated web catalog used when internal context is not enough. When Basquio retrieves " +
              "from a file, answers should cite the source label and filename.",
            actions: [{ label: "Open sources", href: "/workspace/sources" }],
          };
        }
        case "scopes": {
          const scopes = await listScopes(ctx.workspaceId).catch(() => []);
          return {
            topic,
            headline: `${scopes.length} scopes in this workspace.`,
            body:
              "Contexts are clients, categories, or internal functions. Each has its own stakeholders, knowledge, instructions, and files. Switch context in the sidebar or by saying 'inside Kellanova' or 'in the Snack Salati category' in chat.",
          };
        }
        case "what_you_know_about_me": {
          const [memoryRows, scopes] = await Promise.all([
            db
              .from("memory_entries")
              .select("id", { count: "exact", head: true })
              .eq("workspace_id", ctx.workspaceId),
            listScopes(ctx.workspaceId).catch(() => []),
          ]);
          return {
            topic,
            headline: "Here is what this workspace carries about you and your work.",
            body: `You have ${memoryRows.count ?? 0} saved knowledge items covering context, instructions, and examples across ${scopes.length} contexts. Ask explainBasquio with topic: 'stakeholders' or 'instructions' to drill in, or say 'show me everything saved about Kellanova' to list them.`,
            actions: [
              { label: "Open knowledge", href: "/workspace/memory" },
              { label: "Open people", href: "/workspace/people" },
            ],
          };
        }
        case "what_i_can_edit":
          return {
            topic,
            headline: "What you can edit from chat.",
            body:
              "Save pastes, scrape a URL, edit stakeholders, add or archive saved knowledge, draft briefs, or ask for NIQ service ideas. Every edit runs through an approval card so nothing writes until you confirm.",
          };
        case "overview":
        default:
          return {
            topic: "overview" as const,
            headline: "Basquio is a workspace-native CPG analyst.",
            body:
              "It remembers stakeholder preferences, KPI conventions, and past deliverables. It researches external trade press to ground new work. It produces consulting-grade decks on demand. You never have to re-explain context across sessions.",
          };
      }
    },
  });
}

const serviceRecommendationSchema = z.object({
  service_name: z.string().min(1).max(160),
  rationale: z.string().min(1).max(800),
  evidence_hooks: z.array(z.string().max(240)).max(8).default([]),
  typical_deliverable: z.string().max(400),
  priority: z.enum(["high", "medium", "low"]),
});
const suggestServicesOutputSchema = z.object({
  recommendations: z.array(serviceRecommendationSchema).min(0).max(8),
});

const SUGGEST_SERVICES_SYSTEM = `You are Basquio's service-pitch advisor for NIQ analysts.

Given a scope (a client, category, or internal function), its stakeholders' stated preferences, a short data summary, and the NIQ services catalog, produce 3-5 concrete service recommendations ranked by fit.

Anchor every rationale in the scope or the data. Never invent numbers. Never repeat a service outside the catalog. If nothing in the catalog fits, return fewer recommendations.

Output JSON only:

{
  "recommendations": [
    {
      "service_name": "must match a row from the provided catalog",
      "rationale": "1-2 sentences grounded in the scope context or data summary",
      "evidence_hooks": ["short phrases pointing to the fact or file that backs this"],
      "typical_deliverable": "one short sentence",
      "priority": "high" | "medium" | "low"
    }
  ]
}

Rules:
- No em dashes. No marketing filler ("leverage", "unlock", "seamless").
- Italian or English, match the stakeholder preferences if given, else English.
- priority=high when the data clearly shows a gap the service fixes.
- priority=medium when the service would inform an ongoing question.
- priority=low when the service is adjacent but useful next year.`;

export function suggestServicesTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Suggest 3-5 NIQ services to propose into the current scope (or a commissioning list for a brand). Pulls scope context + stakeholder preferences + the NIQ services catalog and calls Haiku for ranked recommendations. Use when the user asks 'what should I pitch to Maria?', 'which NIQ services fit this client?', or 'which research should this brand commission next?'.",
    inputSchema: z.object({
      scope_id: z.string().uuid().optional(),
      data_summary_hint: z.string().max(500).optional(),
      audience: z
        .enum(["niq_analyst_selling", "brand_side_commissioning"])
        .default("niq_analyst_selling"),
    }),
    execute: async (input) => {
      let catalog;
      try {
        catalog = await loadNiqServicesCatalog();
      } catch (err) {
        if (err instanceof NiqServicesCatalogNotFoundError) {
          return {
            ok: false,
            error:
              "NIQ services catalog file is missing. See spec §6.12: create docs/domain-knowledge/niq-services-catalog.md with the canonical columns.",
          };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      if (catalog.entries.length === 0) {
        return {
          ok: false,
          error:
            "NIQ services catalog is empty. Add rows to docs/domain-knowledge/niq-services-catalog.md.",
        };
      }

      const scopeId = input.scope_id ?? ctx.currentScopeId ?? null;
      const scope = scopeId ? await getScope(scopeId).catch(() => null) : null;
      const people = await listWorkspacePeople(ctx.workspaceId).catch(() => []);
      const scopedStakeholders = scope
        ? people
            .filter((p) => {
              if (p.metadata?.linked_scope_id === scope.id) return true;
              const needle = scope.name.toLowerCase();
              const company = String(p.metadata?.company ?? "").toLowerCase();
              return company.includes(needle);
            })
            .slice(0, 5)
        : [];

      if (scopedStakeholders.length === 0 && !input.data_summary_hint) {
        return {
          ok: true,
          recommendations: [],
          catalog_review_pending: catalog.reviewPending,
          message:
            "Not enough scope context to recommend services. Drop a file, add a stakeholder, or share a short data summary first.",
        };
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return {
          ok: false,
          error: "ANTHROPIC_API_KEY is not set on this deployment.",
        };
      }

      const userMessage = buildSuggestServicesUserMessage({
        scope,
        audience: input.audience,
        stakeholders: scopedStakeholders,
        dataSummaryHint: input.data_summary_hint ?? null,
        catalogEntries: catalog.entries,
      });

      try {
        const client = new Anthropic({ apiKey });
        const response = await client.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 1800,
          system: SUGGEST_SERVICES_SYSTEM,
          messages: [{ role: "user", content: userMessage }],
        });
        const textBlock = response.content.find((b) => b.type === "text");
        const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
        const json = rawText.match(/\{[\s\S]*\}/);
        if (!json) {
          return {
            ok: true,
            recommendations: [],
            catalog_review_pending: catalog.reviewPending,
            message: "Haiku returned no JSON. Try again with a richer data summary hint.",
          };
        }
        const parsed = suggestServicesOutputSchema.safeParse(JSON.parse(json[0]));
        if (!parsed.success) {
          return {
            ok: true,
            recommendations: [],
            catalog_review_pending: catalog.reviewPending,
            message: "Haiku output did not match the expected recommendation schema.",
          };
        }

        // Anchor each recommendation back to a real catalog entry. If
        // Haiku hallucinated a service name, drop it.
        const catalogNames = new Set(catalog.entries.map((e) => e.serviceName.toLowerCase()));
        const grounded = parsed.data.recommendations.filter((r) =>
          catalogNames.has(r.service_name.toLowerCase()),
        );

        return {
          ok: true,
          recommendations: grounded,
          catalog_review_pending: catalog.reviewPending,
          scope: scope
            ? { id: scope.id, kind: scope.kind, name: scope.name }
            : null,
          audience: input.audience,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

function buildSuggestServicesUserMessage(input: {
  scope: WorkspaceScope | null;
  audience: "niq_analyst_selling" | "brand_side_commissioning";
  stakeholders: ReturnType<typeof listWorkspacePeople> extends Promise<infer T> ? T : never;
  dataSummaryHint: string | null;
  catalogEntries: Array<{
    serviceName: string;
    description: string;
    typicalDataInputs: string;
    typicalAnalystQuestion: string;
    typicalDeliverable: string;
  }>;
}): string {
  const lines: string[] = [];
  lines.push(
    input.audience === "brand_side_commissioning"
      ? "Audience framing: brand-side analyst considering which research to commission."
      : "Audience framing: NIQ analyst considering which services to pitch into this client.",
  );
  lines.push("");
  if (input.scope) {
    lines.push(`Scope: ${input.scope.kind}:${input.scope.name}`);
  } else {
    lines.push("Scope: none (workspace-wide)");
  }
  if (input.stakeholders.length > 0) {
    lines.push("Stakeholders:");
    for (const p of input.stakeholders) {
      const role = p.metadata?.role ?? "role unknown";
      const structured = p.metadata?.preferences?.structured ?? {};
      const prefs = [
        structured.chart_preference ? `chart: ${structured.chart_preference}` : null,
        structured.deck_length ? `deck length: ${structured.deck_length}` : null,
        structured.language ? `language: ${structured.language}` : null,
        structured.tone ? `tone: ${structured.tone}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      lines.push(`  - ${p.canonical_name} (${role})${prefs ? " | " + prefs : ""}`);
    }
  }
  if (input.dataSummaryHint) {
    lines.push("");
    lines.push(`Data summary hint: ${input.dataSummaryHint}`);
  }
  lines.push("");
  lines.push("NIQ services catalog:");
  for (const row of input.catalogEntries) {
    lines.push(`- ${row.serviceName}: ${row.description}`);
    lines.push(`  inputs: ${row.typicalDataInputs}`);
    lines.push(`  typical question: ${row.typicalAnalystQuestion}`);
    lines.push(`  deliverable: ${row.typicalDeliverable}`);
  }
  lines.push("");
  lines.push("Return the JSON now.");
  return lines.join("\n");
}

// Re-export ensures apps importing from "@basquio/research" via server-only
// environments do not accidentally tree-shake it. Noop at runtime.
export { BASQUIO_TEAM_WORKSPACE_ID };
