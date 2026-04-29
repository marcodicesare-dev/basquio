import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { getActiveBrandGuideline } from "@/lib/workspace/brand-guidelines";
import { BASQUIO_TEAM_ORG_ID } from "@/lib/workspace/constants";
import { assembleWorkspaceContext } from "@/lib/workspace/context";
import { getScope } from "@/lib/workspace/scopes";
import type { AgentCallContext } from "@/lib/workspace/agent-tools";
import type { BrandGuideline, WorkspaceRule } from "@/lib/workspace/types";

/**
 * Memory v1 Brief 2 typed tools. Each tool has:
 *   - a Zod input schema with at most 3 fields,
 *   - a tightly-scoped retrieval (one specific table or one specific RPC),
 *   - a typed `{ items, sources, asOf }` output shape.
 *
 * Tools are gated by the router (apps/web/src/lib/workspace/router.ts).
 * The legacy `retrieveContextTool` from agent-tools.ts stays callable as a
 * 30-day deprecation fallback, gated off when any of these typed tools is
 * active for the turn.
 *
 * Spec: docs/research/2026-04-25-sota-implementation-specs.md §6.
 */

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

type SourceRef = {
  kind: "document" | "transcript" | "fact" | "rule" | "brand_guideline";
  id: string;
  label: string;
  excerpt?: string;
};

/* ────────────────────────────────────────────────────────────
 * 1. queryStructuredMetricTool
 * ────────────────────────────────────────────────────────────
 * Pulls structured metric rows. Until typed metric tables ship in a later
 * brief (Brief 4 onwards), this falls back to workspace_hybrid_search filtered
 * to chunks whose metadata.kind = 'metric_table' or whose content reads as a
 * tabular metric. The fallback is intentional: the router gates this tool when
 * the user wants a number, and even a hybrid-search hit on a metric table is
 * better than no answer.
 */
export function queryStructuredMetricTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Retrieve a structured metric (share, ADR, count, %, trend) for a brand or scope. Prefer this over searchEvidence when the user asks for an exact number. Returns typed metric rows when available; otherwise falls back to indexed metric tables.",
    inputSchema: z.object({
      query: z
        .string()
        .min(3)
        .max(300)
        .describe("Concise restatement of the metric the user wants."),
      entities: z
        .array(z.string().max(120))
        .max(8)
        .optional()
        .describe(
          "Named brands, retailers, categories the metric must cover (verbatim from the user).",
        ),
      as_of: z
        .string()
        .optional()
        .describe(
          "ISO date (YYYY-MM-DD) if the user wants the metric at a specific point in time.",
        ),
    }),
    execute: async ({ query, entities, as_of }) => {
      const ctxResult = await assembleWorkspaceContext({
        prompt: query,
        scope: ctx.currentScopeId ? undefined : "workspace",
        conversationId: ctx.conversationId,
        workspaceScopeId: ctx.currentScopeId ?? null,
        chunkLimit: 8,
        factLimit: 12,
        entityLimit: 12,
        organizationId: ctx.organizationId,
      }).catch(() => null);

      if (!ctxResult) {
        return {
          items: [] as Array<Record<string, unknown>>,
          sources: [] as SourceRef[],
          asOf: as_of ?? null,
          note: "structured metric retrieval unavailable",
        };
      }

      const items: Array<Record<string, unknown>> = [];
      const sources: SourceRef[] = [];

      const entityFilter = entities?.map((e) => e.toLowerCase()) ?? [];
      for (const fact of ctxResult.facts) {
        const subject = fact.subject_canonical_name.toLowerCase();
        if (
          entityFilter.length > 0 &&
          !entityFilter.some((e) => subject.includes(e) || e.includes(subject))
        ) {
          continue;
        }
        items.push({
          subject: fact.subject_canonical_name,
          predicate: fact.predicate,
          value: fact.object_value,
          valid_from: fact.valid_from,
          valid_to: fact.valid_to,
          evidence: fact.evidence,
        });
        sources.push({
          kind: "fact",
          id: fact.id,
          label: `${fact.subject_canonical_name} | ${fact.predicate}`,
          excerpt: fact.evidence ?? undefined,
        });
      }

      ctxResult.chunks.slice(0, 5).forEach((chunk, idx) => {
        sources.push({
          kind: chunk.sourceType === "transcript" ? "transcript" : "document",
          id: chunk.sourceId,
          label: `s${idx + 1} ${chunk.filename ?? chunk.sourceType}`,
          excerpt: chunk.content.slice(0, 240),
        });
      });

      return {
        items,
        sources,
        asOf: as_of ?? null,
      };
    },
  });
}

/* ────────────────────────────────────────────────────────────
 * 2. queryBrandRuleTool
 * ────────────────────────────────────────────────────────────
 * Reads brand_guideline (extracted brand book facets) plus active workspace_rule
 * rows ordered by priority. Brief 1 created both tables. Brief 3 will populate
 * brand_guideline; today it is typically empty and this tool returns null
 * gracefully.
 */
export function queryBrandRuleTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Retrieve typed brand rules (typography, tone, colour, imagery, forbidden) and workspace-wide editorial rules. Use when the user asks how to write, format, or style a deliverable for a brand.",
    inputSchema: z.object({
      brand: z
        .string()
        .max(120)
        .optional()
        .describe("Brand name (e.g. 'Lavazza'). Omit for workspace-wide rules."),
      surface: z
        .enum(["deck", "memo", "chart", "all"])
        .default("all")
        .describe("Which surface the rule applies to."),
    }),
    execute: async ({ brand, surface }) => {
      const db = getDb();
      let brandGuideline: BrandGuideline | null = null;
      const sources: SourceRef[] = [];

      if (brand) {
        try {
          brandGuideline = await getActiveBrandGuideline(ctx.workspaceId, brand);
          if (brandGuideline) {
            sources.push({
              kind: "brand_guideline",
              id: brandGuideline.id,
              label: `${brandGuideline.brand} v${brandGuideline.version}`,
            });
          }
        } catch (err) {
          console.error("[queryBrandRuleTool] brand_guideline read failed", err);
        }
      }

      let workspaceRules: WorkspaceRule[] = [];
      try {
        let q = db
          .from("workspace_rule")
          .select(
            "id, workspace_id, scope_id, rule_type, rule_text, applies_to, forbidden, origin, origin_evidence, priority, active, valid_from, valid_to, expired_at, confidence, approved_by, approved_at, last_applied_at, metadata, created_at, updated_at",
          )
          .eq("workspace_id", ctx.workspaceId)
          .eq("active", true)
          .is("expired_at", null)
          .order("priority", { ascending: false })
          .limit(20);
        if (ctx.currentScopeId) {
          q = q.or(`scope_id.eq.${ctx.currentScopeId},scope_id.is.null`);
        }
        const { data } = await q;
        workspaceRules = (data ?? []) as WorkspaceRule[];
        if (surface !== "all") {
          workspaceRules = workspaceRules.filter(
            (r) => r.applies_to.length === 0 || r.applies_to.includes(surface),
          );
        }
        for (const r of workspaceRules) {
          sources.push({
            kind: "rule",
            id: r.id,
            label: `${r.rule_type}: ${r.rule_text.slice(0, 60)}`,
          });
        }
      } catch (err) {
        console.error("[queryBrandRuleTool] workspace_rule read failed", err);
      }

      return {
        brandGuideline,
        workspaceRules,
        sources,
        asOf: null as string | null,
      };
    },
  });
}

/* ────────────────────────────────────────────────────────────
 * 3. queryEntityFactTool
 * ────────────────────────────────────────────────────────────
 * Bi-temporal lookup over `facts` joined to `entities`. Brief 1 added
 * `expired_at` and a partial active index; this tool filters on
 * `superseded_by IS NULL AND expired_at IS NULL` plus the requested
 * `as_of` window.
 *
 * Facts/entities are scoped via `organization_id` (single team org today via
 * BASQUIO_TEAM_ORG_ID), not `workspace_id`. The Brief 1 substrate audit
 * documents this bridge.
 */
export function queryEntityFactTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Look up bi-temporal facts about entities (brands, retailers, people, products) at an optional point in time. Use when the user asks 'what was true on date X' or 'who is connected to whom'.",
    inputSchema: z.object({
      entity: z
        .string()
        .min(1)
        .max(160)
        .describe("Canonical name of the entity (e.g. 'Lavazza', 'Maria Rossi')."),
      predicate: z
        .string()
        .max(120)
        .optional()
        .describe(
          "Optional predicate filter (e.g. 'role_at', 'value_share', 'launched_in').",
        ),
      as_of: z
        .string()
        .optional()
        .describe(
          "ISO date (YYYY-MM-DD). If provided, only facts valid at that date are returned.",
        ),
      limit: z.number().int().min(1).max(40).default(15),
    }),
    execute: async ({ entity, predicate, as_of, limit }) => {
      const db = getDb();
      const sources: SourceRef[] = [];

      const { data: entRows } = await db
        .from("entities")
        .select("id, type, canonical_name, aliases")
        .eq("organization_id", ctx.organizationId)
        .ilike("canonical_name", `%${entity}%`)
        .limit(5);
      const entityRows = (entRows ?? []) as Array<{
        id: string;
        type: string;
        canonical_name: string;
        aliases: string[] | null;
      }>;
      if (entityRows.length === 0) {
        return {
          facts: [] as Array<Record<string, unknown>>,
          entities: [] as Array<Record<string, unknown>>,
          sources,
          asOf: as_of ?? null,
          note: "no matching entity in workspace",
        };
      }

      const entityIds = entityRows.map((e) => e.id);
      let q = db
        .from("facts")
        .select(
          "id, predicate, object_value, valid_from, valid_to, expired_at, source_id, source_type, metadata, subject_entity, object_entity",
        )
        .eq("organization_id", ctx.organizationId)
        .in("subject_entity", entityIds)
        .is("superseded_by", null)
        .is("expired_at", null)
        .order("ingested_at", { ascending: false })
        .limit(limit);
      if (predicate) q = q.eq("predicate", predicate);
      if (as_of) {
        q = q.or(`valid_from.is.null,valid_from.lte.${as_of}`);
        q = q.or(`valid_to.is.null,valid_to.gt.${as_of}`);
      }
      const { data: factRows } = await q;
      const facts = ((factRows ?? []) as Array<{
        id: string;
        predicate: string;
        object_value: unknown;
        valid_from: string | null;
        valid_to: string | null;
        expired_at: string | null;
        source_id: string | null;
        source_type: string | null;
        metadata: Record<string, unknown> | null;
        subject_entity: string;
        object_entity: string | null;
      }>).map((f) => {
        const subj = entityRows.find((e) => e.id === f.subject_entity);
        return {
          id: f.id,
          subject: subj?.canonical_name ?? f.subject_entity,
          predicate: f.predicate,
          object_value: f.object_value,
          valid_from: f.valid_from,
          valid_to: f.valid_to,
          source_id: f.source_id,
          evidence:
            typeof f.metadata?.evidence === "string" ? f.metadata.evidence : null,
        };
      });
      for (const f of facts) {
        sources.push({
          kind: "fact",
          id: f.id,
          label: `${f.subject} | ${f.predicate}`,
          excerpt: typeof f.evidence === "string" ? f.evidence : undefined,
        });
      }

      return {
        facts,
        entities: entityRows,
        sources,
        asOf: as_of ?? null,
      };
    },
  });
}

/* ────────────────────────────────────────────────────────────
 * 4. searchEvidenceTool
 * ────────────────────────────────────────────────────────────
 * Wraps the existing workspace_hybrid_search RRF function (via
 * `assembleWorkspaceContext` which already calls it through the dual-lane
 * `workspace_chat_retrieval` RPC when a conversation id is present). This is
 * the new home for the "give me a passage / a quote / a source" path that
 * `retrieveContextTool` previously served on every turn.
 */
export function searchEvidenceTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Find passages, quotes, or source excerpts in the workspace knowledge base. Use when the user asks for a citation, a paragraph, or evidence behind a claim. Returns chunks with citation labels [s1] [s2] ....",
    inputSchema: z.object({
      query: z
        .string()
        .min(3)
        .max(500)
        .describe("The user's question or a concise rephrasing."),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    execute: async ({ query, limit }) => {
      const scopeRow = ctx.currentScopeId
        ? await getScope(ctx.currentScopeId).catch(() => null)
        : null;
      const legacyScope = scopeRow
        ? scopeRow.kind === "system"
          ? scopeRow.slug
          : `${scopeRow.kind}:${scopeRow.name}`
        : undefined;
      const result = await assembleWorkspaceContext({
        prompt: query,
        scope: legacyScope,
        conversationId: ctx.conversationId,
        workspaceScopeId: scopeRow?.id ?? ctx.currentScopeId ?? null,
        chunkLimit: limit,
        organizationId: ctx.organizationId,
      });
      return {
        passages: result.chunks.slice(0, limit).map((c, i) => ({
          label: `s${i + 1}`,
          source_type: c.sourceType,
          source_id: c.sourceId,
          filename: c.filename,
          content: c.content.slice(0, 800),
          score: c.score,
          rank_source: c.rankSource,
        })),
        sources: result.chunks.slice(0, limit).map((c, i) => ({
          kind: c.sourceType === "transcript" ? "transcript" : "document",
          id: c.sourceId,
          label: `s${i + 1} ${c.filename ?? c.sourceType}`,
          excerpt: c.content.slice(0, 240),
        })) as SourceRef[],
        asOf: null as string | null,
      };
    },
  });
}

/**
 * Compose the four Brief 2 typed tools as a single object for the chat agent.
 * The keys here MUST match the strings emitted by router.activeToolsForIntents
 * so that prepareStep gating filters on identical names.
 */
export function getTypedRetrievalTools(ctx: AgentCallContext) {
  return {
    queryStructuredMetric: queryStructuredMetricTool(ctx),
    queryBrandRule: queryBrandRuleTool(ctx),
    queryEntityFact: queryEntityFactTool(ctx),
    searchEvidence: searchEvidenceTool(ctx),
  } as const;
}
