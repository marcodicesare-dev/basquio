import "server-only";

import type { WorkspaceContextPack } from "@basquio/types";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";
import type { ViewerState } from "@/lib/supabase/auth";
import { listMemoryEntries } from "@/lib/workspace/memory";
import { getScope } from "@/lib/workspace/scopes";
import { listWorkspacePeople } from "@/lib/workspace/people";
import { listConversationAttachments } from "@/lib/workspace/conversation-attachments";

export type { WorkspaceContextPack };

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

function kindForFile(
  filename: string,
  fileType?: string,
): "workbook" | "pptx" | "pdf" | "document" | "unknown" {
  const lower = (filename ?? "").toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv") || fileType === "xlsx")
    return "workbook";
  if (lower.endsWith(".pptx") || fileType === "pptx") return "pptx";
  if (lower.endsWith(".pdf") || fileType === "pdf") return "pdf";
  return "document";
}

function oneLine(content: string): string {
  const firstMeaningful = content
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").replace(/^-\s*/, "").trim())
    .find((line) => line.length > 0);
  const clean = firstMeaningful ?? content.trim();
  return clean.length > 260 ? `${clean.slice(0, 260)}…` : clean;
}

function renderPrelude(pack: Omit<WorkspaceContextPack, "renderedBriefPrelude">): string {
  const sections: string[] = [];

  if (pack.scope.name) {
    const kindLabel =
      pack.scope.kind === "client"
        ? "Client"
        : pack.scope.kind === "category"
          ? "Category"
          : pack.scope.kind === "function"
            ? "Function"
            : "Scope";
    sections.push(`## Working scope\n${kindLabel}: **${pack.scope.name}**`);
  }

  if (pack.stakeholders.length > 0) {
    const lines = pack.stakeholders.map((p) => {
      const structured = (p.preferences?.structured ?? {}) as Record<string, unknown>;
      const free = p.preferences?.free_text as string | undefined;
      const details: string[] = [];
      if (structured.chart_preference) details.push(`chart: ${structured.chart_preference}`);
      if (structured.language) details.push(`language: ${structured.language}`);
      if (structured.tone) details.push(`tone: ${structured.tone}`);
      if (structured.deck_length) details.push(`length: ${structured.deck_length}`);
      if (structured.review_day) details.push(`cadence: ${structured.review_day}`);
      if (free) details.push(free);
      const detailStr = details.length > 0 ? ` — ${details.join(". ")}` : "";
      return `- **${p.name}**${p.role ? ` (${p.role})` : ""}${detailStr}`;
    });
    sections.push(`## Stakeholders\n${lines.join("\n")}`);
  }

  const ruleLines: string[] = [];
  for (const r of pack.rules.scoped) ruleLines.push(`- ${r}`);
  for (const r of pack.rules.workspace) ruleLines.push(`- ${r}`);
  for (const r of pack.rules.analyst) ruleLines.push(`- ${r}`);
  if (ruleLines.length > 0) {
    sections.push(
      `## Workspace rules\nThese preferences apply to every deliverable in this workspace. Follow them without restating them.\n\n${ruleLines.join("\n")}`,
    );
  }

  if (pack.sourceFiles.length > 0) {
    sections.push(
      `## Attached sources\n${pack.sourceFiles.map((s) => `- ${s.fileName}`).join("\n")}\n\nRead these files directly. They are the evidence the analyst referenced.`,
    );
  }

  if (pack.styleContract.chartPreferences.length > 0 || pack.styleContract.tone) {
    const style: string[] = [];
    if (pack.styleContract.tone) style.push(`tone: ${pack.styleContract.tone}`);
    if (pack.styleContract.language) style.push(`language: ${pack.styleContract.language}`);
    if (pack.styleContract.deckLength) style.push(`length: ${pack.styleContract.deckLength}`);
    if (pack.styleContract.chartPreferences.length > 0) {
      style.push(`chart preferences: ${pack.styleContract.chartPreferences.join("; ")}`);
    }
    sections.push(`## Style contract\n${style.map((s) => `- ${s}`).join("\n")}`);
  }

  if (sections.length === 0) return "";
  return `# Workspace context\n\n${sections.join("\n\n")}\n\n---\n\n`;
}

export type BuildContextPackInput = {
  viewer: ViewerState;
  workspaceId: string;
  conversationId?: string | null;
  deliverableId?: string | null;
  scopeId?: string | null;
  /** Optional list of citations harvested from chat tool outputs. */
  citations?: Array<{
    source_type?: string;
    source_id?: string;
    filename?: string | null;
  }>;
  /** Initial prompt the user asked, for lineage. */
  prompt?: string | null;
  /** Last assistant message id that triggered the generation (if any). */
  messageId?: string | null;
  deliverableTitle?: string | null;
  launchSource: WorkspaceContextPack["lineage"]["launchSource"];
};

/**
 * Assemble the full workspace context pack that travels with a deck run.
 * Resolves the scope, pulls scope-scoped and workspace-scoped memory, the
 * linked stakeholders, the cited knowledge_documents, and mints source_files
 * rows for any document that doesn't already have one.
 *
 * Returns a pack canonicalized against server truth (source_files real-id only,
 * dedup, string-rules dedup) so callers never emit client-supplied garbage.
 */
export async function buildWorkspaceContextPack(
  input: BuildContextPackInput,
): Promise<WorkspaceContextPack | null> {
  if (!input.viewer.user) return null;
  const db = getDb();
  const viewerWorkspace = await ensureViewerWorkspace(input.viewer.user);
  if (!viewerWorkspace) return null;

  const workspaceId = input.workspaceId;
  const scopeId = input.scopeId ?? null;

  const scope = scopeId ? await getScope(scopeId).catch(() => null) : null;

  const [scopedMemory, allMemory] = await Promise.all([
    scopeId
      ? listMemoryEntries({ workspaceId, scopeId, limit: 8 }).catch(() => [])
      : Promise.resolve([]),
    listMemoryEntries({ workspaceId, limit: 30 }).catch(() => []),
  ]);

  const workspaceRules = allMemory
    .filter((m) => m.scope === "workspace")
    .slice(0, 6)
    .map((m) => oneLine(m.content));
  const analystRules = allMemory
    .filter((m) => m.scope === "analyst")
    .slice(0, 6)
    .map((m) => oneLine(m.content));
  const scopedRules = scopedMemory.slice(0, 8).map((m) => oneLine(m.content));

  const allPeople = await listWorkspacePeople(workspaceId).catch(() => []);
  const stakeholders = allPeople
    .filter((p) => {
      if (scopeId && p.metadata?.linked_scope_id === scopeId) return true;
      if (scope?.name) {
        const needle = scope.name.toLowerCase();
        const role = String(p.metadata?.role ?? "").toLowerCase();
        const company = String(p.metadata?.company ?? "").toLowerCase();
        return company.includes(needle) || role.includes(needle);
      }
      return false;
    })
    .slice(0, 4)
    .map((p) => ({
      id: p.id,
      name: p.canonical_name,
      role: (p.metadata?.role as string | undefined) ?? null,
      preferences: (p.metadata?.preferences as Record<string, unknown> | undefined) ?? {},
    }));

  // Style contract: fold the first stakeholder's structured preferences and
  // fall back to workspace-wide defaults. Chart preferences aggregate across
  // stakeholders.
  const chartPreferences = new Set<string>();
  let language: string | null = null;
  let tone: string | null = null;
  let deckLength: string | null = null;
  for (const s of stakeholders) {
    const structured = (s.preferences?.structured ?? {}) as Record<string, unknown>;
    if (typeof structured.chart_preference === "string") chartPreferences.add(structured.chart_preference);
    if (!language && typeof structured.language === "string") language = structured.language;
    if (!tone && typeof structured.tone === "string") tone = structured.tone;
    if (!deckLength && typeof structured.deck_length === "string") deckLength = structured.deck_length;
  }

  // Resolve citations → documents → source_files (upsert by external_id so
  // repeated pack builds are idempotent).
  const citations = input.citations ?? [];
  const citedDocumentIds = new Set<string>();
  const citedChunkIds = new Set<string>();
  const citedTranscriptIds = new Set<string>();
  for (const c of citations) {
    if (!c.source_id) continue;
    switch (c.source_type) {
      case "document":
        citedDocumentIds.add(c.source_id);
        break;
      case "chunk":
        citedChunkIds.add(c.source_id);
        break;
      case "transcript":
        citedTranscriptIds.add(c.source_id);
        break;
      default:
        citedDocumentIds.add(c.source_id);
    }
  }

  // Dual-lane: every file the user attached to this conversation MUST land in
  // the deck pack, regardless of whether the assistant cited it. This is the
  // invariant from the 2026-04-21 spec §3.6: "if the chat had 3 files visible,
  // the deck starts with 3 files." Attachments that are still indexing are
  // allowed — the runtime worker reads the blob from source_files, it doesn't
  // need our chunks.
  const conversationAttachmentDocumentIds = new Set<string>();
  if (input.conversationId) {
    try {
      const attachments = await listConversationAttachments(input.conversationId);
      for (const a of attachments) {
        if (a.status === "deleted") continue;
        citedDocumentIds.add(a.document_id);
        conversationAttachmentDocumentIds.add(a.document_id);
      }
    } catch (err) {
      console.error("[build-context-pack] conversation attachments resolve failed", err);
    }
  }

  if (citedChunkIds.size > 0) {
    try {
      const { data } = await db
        .from("knowledge_chunks")
        .select("document_id")
        .in("id", Array.from(citedChunkIds));
      for (const row of ((data ?? []) as Array<{ document_id: string | null }>)) {
        if (row.document_id) citedDocumentIds.add(row.document_id);
      }
    } catch (err) {
      console.error("[build-context-pack] chunk resolve failed", err);
    }
  }

  if (citedTranscriptIds.size > 0) {
    try {
      const { data } = await db
        .from("transcript_chunks")
        .select("source_id")
        .in("id", Array.from(citedTranscriptIds));
      for (const row of ((data ?? []) as Array<{ source_id: string | null }>)) {
        if (row.source_id) citedDocumentIds.add(row.source_id);
      }
    } catch (err) {
      console.error("[build-context-pack] transcript resolve failed", err);
    }
  }

  const citedDocs = citedDocumentIds.size > 0
    ? await (async () => {
        try {
          const { data } = await db
            .from("knowledge_documents")
            .select("id, filename, file_type, file_size_bytes, storage_path, status")
            .in("id", Array.from(citedDocumentIds));
          return (data ?? []) as Array<{
            id: string;
            filename: string;
            file_type: string;
            file_size_bytes: number;
            storage_path: string;
            status: string;
          }>;
        } catch (err) {
          console.error("[build-context-pack] documents fetch failed", err);
          return [];
        }
      })()
    : [];

  const sourceFiles: WorkspaceContextPack["sourceFiles"] = [];
  const citedSources: WorkspaceContextPack["citedSources"] = [];
  for (const doc of citedDocs) {
    // Upsert source_files for attached docs even if Lane B indexing hasn't
    // finished yet — the runtime only needs the file identity to download the
    // blob. Skip only the terminal failure state. Retrieval-only citations
    // that aren't attached stay locked to indexed-only to match prior
    // behavior (we don't want to drag broken documents into someone else's
    // deck just because a retrieval tool cited them).
    const isAttached = conversationAttachmentDocumentIds.has(doc.id);
    if (doc.status === "failed" || (!isAttached && doc.status !== "indexed")) {
      citedSources.push({ documentId: doc.id, fileName: doc.filename, sourceFileId: null });
      continue;
    }
    try {
      const externalId = `workspace-doc:${doc.id}:${viewerWorkspace.projectRowId}`;
      const kind = kindForFile(doc.filename, doc.file_type);
      const { data: upserted, error: upsertErr } = await db
        .from("source_files")
        .upsert(
          {
            organization_id: viewerWorkspace.organizationRowId,
            project_id: viewerWorkspace.projectRowId,
            uploaded_by: input.viewer.user.id,
            kind,
            file_name: doc.filename,
            storage_bucket: "knowledge-base",
            storage_path: doc.storage_path,
            file_bytes: doc.file_size_bytes ?? 0,
            external_id: externalId,
          },
          { onConflict: "external_id" },
        )
        .select("id, kind, file_name, storage_bucket, storage_path")
        .single();
      if (upsertErr || !upserted) {
        console.error(
          `[build-context-pack] source_files upsert failed for ${doc.filename}: ${upsertErr?.message ?? "no row"}`,
        );
        citedSources.push({ documentId: doc.id, fileName: doc.filename, sourceFileId: null });
        continue;
      }
      sourceFiles.push({
        id: upserted.id as string,
        kind: upserted.kind as string,
        fileName: upserted.file_name as string,
        storageBucket: upserted.storage_bucket as string,
        storagePath: upserted.storage_path as string,
      });
      citedSources.push({
        documentId: doc.id,
        fileName: doc.filename,
        sourceFileId: upserted.id as string,
      });
    } catch (err) {
      console.error(
        `[build-context-pack] source_files upsert threw for ${doc.filename}`,
        err,
      );
      citedSources.push({ documentId: doc.id, fileName: doc.filename, sourceFileId: null });
    }
  }

  // Dedup source_files by id (safety — the upsert should guarantee this).
  const seenSourceFileIds = new Set<string>();
  const dedupedSourceFiles = sourceFiles.filter((sf) => {
    if (seenSourceFileIds.has(sf.id)) return false;
    seenSourceFileIds.add(sf.id);
    return true;
  });

  const partial: Omit<WorkspaceContextPack, "renderedBriefPrelude"> = {
    workspaceId,
    workspaceScopeId: scopeId,
    deliverableId: input.deliverableId ?? null,
    scope: {
      id: scope?.id ?? null,
      kind: scope?.kind ?? null,
      name: scope?.name ?? null,
    },
    stakeholders,
    rules: {
      workspace: Array.from(new Set(workspaceRules)),
      analyst: Array.from(new Set(analystRules)),
      scoped: Array.from(new Set(scopedRules)),
    },
    citedSources,
    sourceFiles: dedupedSourceFiles,
    lineage: {
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      deliverableTitle: input.deliverableTitle ?? null,
      prompt: input.prompt ?? null,
      launchSource: input.launchSource,
    },
    styleContract: {
      language,
      tone,
      deckLength,
      chartPreferences: Array.from(chartPreferences),
    },
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
  };

  return {
    ...partial,
    renderedBriefPrelude: renderPrelude(partial),
  };
}

/* ────────────────────────────────────────────────────────────
 * Memory v1 Brief 2: split context packs for prompt caching
 *
 * The chat agent (when CHAT_ROUTER_V2_ENABLED=true) caches three system
 * blocks: a static persona (1h TTL), a workspace brand pack (5m TTL), and a
 * scope context pack (5m TTL). The two pack-builders below MUST be pure
 * functions of stable workspace and scope state. They cannot read per-turn
 * data, conversation attachments, or citations, otherwise the cache breaks
 * every turn and the cost target is missed.
 *
 * Spec: docs/research/2026-04-25-sota-implementation-specs.md §5.
 * ──────────────────────────────────────────────────────────── */

const EMPTY_WORKSPACE_BRAND_PACK = `# Workspace brand pack

(No firm-wide brand rules or analyst preferences saved yet. Suggest \`teachRule\` or \`editRule\` when the user states a preference, instruction, or fact they want remembered.)`;

const EMPTY_SCOPE_CONTEXT_PACK = `# Scope context

(No scope is active for this turn, or the active scope has no stakeholders or saved knowledge yet. Use \`retrieveContext\` for cross-workspace search.)`;

/**
 * Build the workspace brand pack (the second cache tier for chat). Stable per
 * workspace, ~6K tokens. Contains: workspace-wide rules, analyst preferences,
 * default style contract derived from workspace-wide stakeholder defaults.
 *
 * Pulls only from `memory_entries` filtered to `scope IN ('workspace',
 * 'analyst')` and the workspace-wide style defaults. Does NOT touch
 * conversation attachments, citations, or any per-turn data.
 */
export async function buildWorkspaceBrandPack(workspaceId: string): Promise<string> {
  const memory = await listMemoryEntries({ workspaceId, limit: 60 }).catch(() => []);
  const workspaceRules = memory
    .filter((m) => m.scope === "workspace")
    .slice(0, 12)
    .map((m) => oneLine(m.content));
  const analystRules = memory
    .filter((m) => m.scope === "analyst")
    .slice(0, 12)
    .map((m) => oneLine(m.content));

  if (workspaceRules.length === 0 && analystRules.length === 0) {
    return EMPTY_WORKSPACE_BRAND_PACK;
  }

  const sections: string[] = [];
  if (workspaceRules.length > 0) {
    sections.push(
      `## Workspace rules\nFirm-wide preferences that apply to every deliverable. Follow without restating.\n\n${workspaceRules.map((r) => `- ${r}`).join("\n")}`,
    );
  }
  if (analystRules.length > 0) {
    sections.push(
      `## Analyst preferences\nHow this analyst prefers Basquio to write, reason, and cite.\n\n${analystRules.map((r) => `- ${r}`).join("\n")}`,
    );
  }
  return `# Workspace brand pack\n\n${sections.join("\n\n")}`;
}

/**
 * Build the scope context pack (the third cache tier for chat). Stable per
 * scope, ~6K tokens. Contains: the active scope's name and kind, scope-scoped
 * stakeholders, scope-scoped rules.
 *
 * Pulls from `workspace_scopes`, `memory_entries` filtered by scope id, and
 * `entities` of type person linked to the scope. Does NOT touch conversation
 * attachments or per-turn data.
 */
export async function buildScopeContextPack(
  workspaceId: string,
  scopeId: string | null,
): Promise<string> {
  if (!scopeId) return EMPTY_SCOPE_CONTEXT_PACK;
  const scope = await getScope(scopeId).catch(() => null);
  if (!scope) return EMPTY_SCOPE_CONTEXT_PACK;

  const [scopedMemory, allPeople] = await Promise.all([
    listMemoryEntries({ workspaceId, scopeId, limit: 16 }).catch(() => []),
    listWorkspacePeople(workspaceId).catch(() => []),
  ]);

  const scopedRules = scopedMemory.slice(0, 12).map((m) => oneLine(m.content));
  const stakeholders = allPeople
    .filter((p) => {
      if (p.metadata?.linked_scope_id === scopeId) return true;
      if (scope.name) {
        const needle = scope.name.toLowerCase();
        const role = String(p.metadata?.role ?? "").toLowerCase();
        const company = String(p.metadata?.company ?? "").toLowerCase();
        return company.includes(needle) || role.includes(needle);
      }
      return false;
    })
    .slice(0, 6);

  const sections: string[] = [];
  const kindLabel =
    scope.kind === "client"
      ? "Client"
      : scope.kind === "category"
        ? "Category"
        : scope.kind === "function"
          ? "Function"
          : "Scope";
  sections.push(`## Active scope\n${kindLabel}: **${scope.name}**`);

  if (stakeholders.length > 0) {
    const lines = stakeholders.map((p) => {
      const structured = (p.metadata?.preferences as Record<string, unknown> | undefined)?.structured ?? {};
      const free = (p.metadata?.preferences as Record<string, unknown> | undefined)?.free_text;
      const details: string[] = [];
      const s = structured as Record<string, unknown>;
      if (typeof s.chart_preference === "string") details.push(`chart: ${s.chart_preference}`);
      if (typeof s.language === "string") details.push(`language: ${s.language}`);
      if (typeof s.tone === "string") details.push(`tone: ${s.tone}`);
      if (typeof s.deck_length === "string") details.push(`length: ${s.deck_length}`);
      if (typeof s.review_day === "string") details.push(`cadence: ${s.review_day}`);
      if (typeof free === "string") details.push(free);
      const detailStr = details.length > 0 ? `. ${details.join(". ")}` : "";
      const role = (p.metadata?.role as string | undefined) ?? null;
      return `- **${p.canonical_name}**${role ? ` (${role})` : ""}${detailStr}`;
    });
    sections.push(`## Stakeholders\n${lines.join("\n")}`);
  }

  if (scopedRules.length > 0) {
    sections.push(
      `## Scope rules\nPreferences and saved knowledge specific to this scope.\n\n${scopedRules.map((r) => `- ${r}`).join("\n")}`,
    );
  }

  return `# Scope context\n\n${sections.join("\n\n")}`;
}
