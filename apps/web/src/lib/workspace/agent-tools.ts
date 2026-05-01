import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { assembleWorkspaceContext } from "@/lib/workspace/context";
import { createMemoryEntry, listMemoryEntries } from "@/lib/workspace/memory";
import { createScope, getScope, getScopeByKindSlug, listScopes } from "@/lib/workspace/scopes";
import type { WorkspaceScope } from "@/lib/workspace/types";
import { analyzeAttachedFile } from "@/lib/workspace/analyze-attached-file";
import { listConversationAttachments } from "@/lib/workspace/conversation-attachments";
import { recordConversationAttachment } from "@/lib/workspace/conversation-attachments";
import { saveFromPasteTool, scrapeUrlTool } from "@/lib/workspace/agent-tools-ingest";
import {
  createStakeholderTool,
  editStakeholderTool,
} from "@/lib/workspace/agent-tools-people-edit";
import {
  draftBriefTool,
  editRuleTool,
  explainBasquioTool,
  suggestServicesTool,
} from "@/lib/workspace/agent-tools-editorial";
import { analystCommentaryTool } from "@/lib/workspace/agent-tools-analyst-commentary";
import { webSearchTool } from "@/lib/workspace/agent-tools-web-search";
import { wrapChatTool } from "@/lib/workspace/chat-tool-telemetry";

export type AgentCallContext = {
  workspaceId: string;
  organizationId: string;
  currentScopeId: string | null;
  /**
   * Workspace conversation id for the chat that called the tool. Used by
   * retrieveContext to switch on the dual-lane RPC (workspace_chat_retrieval)
   * so attachments dropped in this conversation rank 1st automatically.
   */
  conversationId: string | null;
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
    // System scopes are an invariant. See agent-tools-editorial.ts for
    // the same self-healing pattern. Migration 20260520200000 backfills
    // + a trigger maintains the invariant; this branch covers races and
    // workspaces created before the trigger shipped.
    const existing = await getScopeByKindSlug(workspaceId, "system", trimmed);
    if (existing) return existing;
    try {
      return await createScope({
        workspaceId,
        kind: "system",
        name: trimmed === "workspace" ? "Workspace" : "Analyst",
        slug: trimmed,
        metadata: { seeded: true, builtin: true, via: "agent-tools:auto-heal" },
      });
    } catch {
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

/**
 * readMemory: agent-initiated memory consultation. Rendered in the chat UI as a
 * subtle system chip "Reading saved knowledge" (per Marco 7c rendering contract).
 */
export function readMemoryTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Read saved knowledge for the current workspace. Use this to find reusable knowledge, instructions, and examples Basquio has been taught. Pass an optional scope hint ('client:Lavazza', 'workspace', 'analyst') or scope UUID.",
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
 * teachRule: user-initiated explicit knowledge save. Rendered in the chat UI as a bold
 * affirmative card "Knowledge saved to Lavazza workspace" per Marco 7c.
 * Only fires when the user explicitly asks Basquio to remember or save.
 */
export function teachRuleTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Save a reusable instruction, knowledge item, or example for the workspace. Call this ONLY when the user explicitly asks you to 'remember', 'save', 'always do', or equivalent. Do NOT call proactively or silently.",
    inputSchema: z.object({
      scope: z.string().describe("Scope to save the item under. Use 'workspace' for firm-wide, 'analyst' for analyst preferences, 'client:{name}' or 'category:{name}' for scoped knowledge."),
      memory_type: z
        .enum(["procedural", "semantic", "episodic"])
        .describe("procedural for instructions Basquio should follow, semantic for stable knowledge, episodic for examples or past good outputs."),
      content: z.string().min(3).max(4000).describe("The saved item in plain prose, 1-3 sentences max."),
    }),
    execute: async ({ scope, memory_type, content }) => {
      const scopeRow = await resolveScopeRef(ctx.workspaceId, scope);
      if (!scopeRow) {
        return {
          ok: false,
          error: `Cannot find a client or category called '${scope}'. List existing scopes via the workspace sidebar or pass 'workspace' for firm-wide.`,
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
 *
 * SOTA recall pattern (April 2026): when retrieval surfaces chunks from a
 * workspace `knowledge_documents` row that is NOT yet attached to this
 * conversation, the tool transparently creates the conversation_attachment
 * behind the scenes. The user never sees "the file isn't attached" because
 * by the time the agent's next turn fires analyzeAttachedFile, the file is.
 *
 * This kills the failure mode where the agent finds a workspace file via
 * search but then refuses to read it because "no scope linked". This was
 * Francesco's Apr 30 demo blocker. The recall is implicit, deterministic, idempotent.
 */
export function retrieveContextTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Search the workspace knowledge base for chunks, entities, and facts relevant to a prompt. Use at the start of any analytical question. When this tool surfaces a workspace document that the user might want analyzed (CSV, XLSX, PDF, PPTX), the document is automatically attached to this conversation; you can immediately call analyzeAttachedFile or analystCommentary on the returned source_ids in the same turn without calling recallWorkspaceFile first.",
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
      const context = await assembleWorkspaceContext({
        prompt: query,
        scope: legacyScope,
        conversationId: ctx.conversationId,
        workspaceScopeId: scopeRow?.id ?? ctx.currentScopeId ?? null,
        organizationId: ctx.organizationId,
      });

      // Auto-attach surfaced workspace documents to the conversation so the
      // next analyzeAttachedFile call sees them without an explicit recall.
      // Idempotent on conversation_attachments (conversation_id, document_id).
      const autoAttachedDocIds = new Set<string>();
      if (ctx.conversationId) {
        const existingAttachments = await listConversationAttachments(ctx.conversationId).catch(
          () => [],
        );
        const alreadyAttached = new Set(existingAttachments.map((a) => a.document_id));
        const docIdsFromRetrieval = Array.from(
          new Set(
            context.chunks
              .filter((c) => c.sourceType === "document" && !alreadyAttached.has(c.sourceId))
              .map((c) => c.sourceId),
          ),
        ).slice(0, 6); // hard cap so a noisy match storm cannot attach 50 files

        for (const docId of docIdsFromRetrieval) {
          try {
            const attached = await recordConversationAttachment({
              conversationId: ctx.conversationId,
              documentId: docId,
              workspaceId: ctx.workspaceId,
              workspaceScopeId: scopeRow?.id ?? ctx.currentScopeId ?? null,
              uploadedBy: ctx.userEmail,
              origin: "referenced-from-workspace",
              metadata: {
                auto_attached: true,
                attached_via: "retrieveContext",
                query: query.slice(0, 200),
                attached_at: new Date().toISOString(),
              },
            });
            if (attached) autoAttachedDocIds.add(docId);
          } catch (err) {
            console.error("[retrieveContext] auto-attach failed", { docId, err });
          }
        }
      }

      return {
        scope: scopeRow ? { id: scopeRow.id, name: scopeRow.name, kind: scopeRow.kind } : null,
        chunk_count: context.chunks.length,
        entity_count: context.entities.length,
        fact_count: context.facts.length,
        auto_attached_count: autoAttachedDocIds.size,
        auto_attached_document_ids: Array.from(autoAttachedDocIds),
        chunks: context.chunks.slice(0, 8).map((c, i) => ({
          label: `s${i + 1}`,
          source_type: c.sourceType,
          source_id: c.sourceId,
          filename: c.filename,
          content: c.content.slice(0, 600),
          score: c.score,
          rank_source: c.rankSource,
          auto_attached: c.sourceType === "document" && autoAttachedDocIds.has(c.sourceId),
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
export function showMetricCardTool() {
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

/**
 * analyzeAttachedFile: Layer A of the execution-first architecture
 * (docs/specs/2026-04-21-file-in-chat-execution-first-architecture.md).
 *
 * Runs the user's question through Claude Sonnet with code_execution +
 * container_upload on every file attached to this conversation. The sub-call
 * reads the files with pandas/openpyxl and returns a cited markdown answer.
 * No pgvector round trip. Used for structured/tabular data where retrieval
 * would lose the structure.
 */
export function analyzeAttachedFileTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Analyze one or more files that the user attached to THIS conversation using pandas/openpyxl inside a secure code-execution container. Prefer this over retrieveContext when the answer depends on structured data (CSV, XLSX) the user just dropped. Returns a cited markdown answer. Do NOT use for cross-workspace questions or for files not attached to this conversation.",
    inputSchema: z.object({
      question: z
        .string()
        .min(3)
        .max(1500)
        .describe(
          "The user's specific question, phrased so pandas/openpyxl can produce the answer (e.g. 'quanti SKU per region', 'ROS trend per brand for Q4', 'correlation between price and sales').",
        ),
      document_ids: z
        .array(z.string().uuid())
        .max(10)
        .optional()
        .describe(
          "Optional subset of document ids to analyze. Omit to use every file attached to this conversation.",
        ),
    }),
    execute: async ({ question, document_ids }) => {
      if (!ctx.conversationId) {
        return {
          ok: false,
          answer: null,
          cited_files: [] as string[],
          reason: "no conversation id in context",
        };
      }
      const result = await analyzeAttachedFile({
        conversationId: ctx.conversationId,
        question,
        documentIds: document_ids,
      });
      return result;
    },
  });
}

/**
 * listConversationFiles: quick introspection tool so the agent can check
 * what's attached before deciding between analyzeAttachedFile vs
 * retrieveContext. Cheap (no LLM call, just a DB read).
 */
export function listConversationFilesTool(ctx: AgentCallContext) {
  return tool({
    description:
      "List the files attached to this conversation so you can decide whether to use analyzeAttachedFile (files are present) or retrieveContext (workspace-wide search). Returns filename, size, indexing status, and document id for each attachment.",
    inputSchema: z.object({}),
    execute: async () => {
      if (!ctx.conversationId) {
        return { count: 0, files: [] };
      }
      const rows = await listConversationAttachments(ctx.conversationId).catch(() => []);
      return {
        count: rows.length,
        files: rows.map((r) => ({
          document_id: r.document_id,
          filename: r.filename,
          file_type: r.file_type,
          file_size_bytes: r.file_size_bytes,
          status: r.status,
          attached_at: r.attached_at,
        })),
      };
    },
  });
}

/**
 * listWorkspaceSources: lists indexed knowledge_documents that live in the
 * current workspace (and, when set, the current scope). This is the bridge
 * that lets the agent KNOW what files Basquio has remembered for this
 * client / category before deciding to recall them. Without this surface,
 * Memory v1 collapses into ChatGPT-with-rules; the analyst would have to
 * re-paperclip every file every time.
 *
 * Pure read. Does not attach anything. Pair with recallWorkspaceFile
 * to pull a file into the conversation for analyzeAttachedFile.
 */
export function listWorkspaceSourcesTool(ctx: AgentCallContext) {
  return tool({
    description:
      "List the workspace's saved files (Sources). Use this when the user asks an analytical question and you want to know which files Basquio remembers for the current client / category before deciding whether to recall one. Returns filename, kind, size, and document id. Filter by current scope by default; pass scope='workspace' to see all.",
    inputSchema: z.object({
      scope: z
        .string()
        .optional()
        .describe(
          "Optional scope filter. Defaults to the current scope when present. Pass 'workspace' to widen.",
        ),
      query: z
        .string()
        .optional()
        .describe("Optional substring filter on filename or upload context."),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    execute: async ({ scope, query, limit }) => {
      const db = getDb();
      const scopeRow = scope
        ? scope === "workspace"
          ? null
          : await resolveScopeRef(ctx.workspaceId, scope)
        : ctx.currentScopeId
          ? await getScope(ctx.currentScopeId)
          : null;
      let q = db
        .from("knowledge_documents")
        .select(
          "id, filename, file_type, file_size_bytes, status, kind, upload_context, metadata, created_at",
        )
        .eq("organization_id", ctx.workspaceId)
        .neq("status", "deleted")
        .in("kind", ["uploaded_file", "brand_book", "chat_paste", "chat_url"])
        .order("created_at", { ascending: false })
        .limit(limit);
      if (scopeRow) {
        // Tagged via metadata.linked_scope_id on the demo seed; keep both
        // shapes (linked_scope_id OR scope_id) in case future seeders use
        // either form.
        q = q.or(
          `metadata->>linked_scope_id.eq.${scopeRow.id},metadata->>scope_id.eq.${scopeRow.id}`,
        );
      }
      if (query) {
        q = q.or(`filename.ilike.%${query}%,upload_context.ilike.%${query}%`);
      }
      const { data, error } = await q;
      if (error) {
        return { scope: scopeRow?.name ?? "workspace", count: 0, files: [], error: error.message };
      }
      return {
        scope: scopeRow?.name ?? "workspace",
        count: (data ?? []).length,
        files: (data ?? []).map((row) => ({
          document_id: row.id,
          filename: row.filename,
          file_type: row.file_type,
          file_size_bytes: row.file_size_bytes,
          status: row.status,
          kind: row.kind,
          upload_context: row.upload_context,
          created_at: row.created_at,
        })),
      };
    },
  });
}

/**
 * recallWorkspaceFile: attaches a workspace knowledge_document to THIS
 * conversation with origin "referenced-from-workspace". After this returns
 * the doc shows up in listConversationFiles and is analyzable via
 * analyzeAttachedFile / analystCommentary, without the user
 * re-paperclipping the file. This is what makes /workspace/sources a
 * working memory and not a static dump.
 *
 * Idempotent on the conversation_attachments unique key
 * (conversation_id, document_id).
 */
export function recallWorkspaceFileTool(ctx: AgentCallContext) {
  return tool({
    description:
      "Pull a saved workspace file into THIS conversation so it can be analyzed with analyzeAttachedFile or analystCommentary. Use when the user's question needs structured data (CSV, XLSX) or pages from a deck/PDF that already lives in /workspace/sources, instead of asking the user to re-attach. Returns the document so you can chain into analyzeAttachedFile in the same turn.",
    inputSchema: z.object({
      document_id: z
        .string()
        .uuid()
        .describe("The knowledge_documents.id from listWorkspaceSources or retrieveContext."),
      reason: z
        .string()
        .max(240)
        .optional()
        .describe(
          "One-line analyst-language reason. Surfaces in the audit log and the chip the user sees.",
        ),
    }),
    execute: async ({ document_id, reason }) => {
      if (!ctx.conversationId) {
        return {
          ok: false,
          error:
            "No conversation id on this call; recall only works inside an active chat. Open a chat in the relevant scope first.",
        };
      }
      // Must belong to this workspace + not be deleted.
      const db = getDb();
      const { data: doc, error: docErr } = await db
        .from("knowledge_documents")
        .select("id, filename, file_type, file_size_bytes, status, kind")
        .eq("id", document_id)
        .eq("organization_id", ctx.workspaceId)
        .neq("status", "deleted")
        .maybeSingle();
      if (docErr || !doc) {
        return {
          ok: false,
          error:
            docErr?.message ??
            "Document not found in this workspace (or has been removed). Use listWorkspaceSources to see available files.",
        };
      }
      const attached = await recordConversationAttachment({
        conversationId: ctx.conversationId,
        documentId: document_id,
        workspaceId: ctx.workspaceId,
        workspaceScopeId: ctx.currentScopeId ?? null,
        uploadedBy: ctx.userEmail,
        origin: "referenced-from-workspace",
        metadata: { reason: reason ?? null, recalled_at: new Date().toISOString() },
      });
      return {
        ok: true,
        document: {
          document_id: doc.id,
          filename: doc.filename,
          file_type: doc.file_type,
          file_size_bytes: doc.file_size_bytes,
          status: doc.status,
        },
        recalled_via: attached ? "conversation_attachments" : "skipped (conversation row not yet persisted)",
        next: "Call analyzeAttachedFile (for CSV/XLSX number-cuts) or analystCommentary (for PDF/PPTX/DOCX commentary) on this document_id in the same turn.",
      };
    },
  });
}

export function getAllTools(ctx: AgentCallContext) {
  const tools = {
    memory: readMemoryTool(ctx),
    teachRule: teachRuleTool(ctx),
    editRule: editRuleTool(ctx),
    retrieveContext: retrieveContextTool(ctx),
    analyzeAttachedFile: analyzeAttachedFileTool(ctx),
    analystCommentary: analystCommentaryTool(ctx),
    listConversationFiles: listConversationFilesTool(ctx),
    listWorkspaceSources: listWorkspaceSourcesTool(ctx),
    recallWorkspaceFile: recallWorkspaceFileTool(ctx),
    showMetricCard: showMetricCardTool(),
    showStakeholderCard: showStakeholderCardTool(ctx),
    editStakeholder: editStakeholderTool(ctx),
    createStakeholder: createStakeholderTool(ctx),
    saveFromPaste: saveFromPasteTool(ctx),
    scrapeUrl: scrapeUrlTool(ctx),
    webSearch: webSearchTool(ctx),
    draftBrief: draftBriefTool(ctx),
    explainBasquio: explainBasquioTool(ctx),
    suggestServices: suggestServicesTool(ctx),
  } as const;

  return Object.fromEntries(
    Object.entries(tools).map(([name, toolDef]) => [
      name,
      wrapChatTool(name, ctx, toolDef),
    ]),
  ) as typeof tools;
}
