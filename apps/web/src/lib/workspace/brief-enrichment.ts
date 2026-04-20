import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";
import type { ViewerState } from "@/lib/supabase/auth";
import { listMemoryEntries } from "@/lib/workspace/memory";
import { getScope } from "@/lib/workspace/scopes";
import { listWorkspacePeople } from "@/lib/workspace/people";

export type EnrichedBrief = {
  bodyMarkdown: string;
  client: string;
  objective: string;
  audience: string;
  thesis: string;
  stakes: string;
  sourceFiles: Array<{
    id: string;
    kind: string;
    fileName: string;
    storageBucket: string;
    storagePath: string;
    fileBytes: number;
  }>;
};

type Citation = {
  label?: string;
  source_type?: string;
  source_id?: string;
  filename?: string | null;
  excerpt?: string;
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createServiceSupabaseClient(url, key);
}

function kindForFile(filename: string, fileType?: string): "workbook" | "pptx" | "pdf" | "document" | "unknown" {
  const lower = (filename ?? "").toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv") || fileType === "xlsx")
    return "workbook";
  if (lower.endsWith(".pptx") || fileType === "pptx") return "pptx";
  if (lower.endsWith(".pdf") || fileType === "pdf") return "pdf";
  return "document";
}

/**
 * Assemble the full workspace context that should travel with a deck run
 * when the user clicks "Generate deck" on a chat answer or memo.
 *
 * Returns both the enriched brief (memory + stakeholders + house style
 * prepended to the memo body) and the list of source_files rows that
 * reference the knowledge_documents cited in that memo. The source_files
 * are upserted into the viewer's project by external_id, so downstream
 * the V6 deck pipeline can download them exactly like user-uploaded
 * workbooks.
 */
export async function buildEnrichedBrief(
  deliverableId: string,
  viewer: ViewerState,
): Promise<EnrichedBrief | null> {
  if (!viewer.user) return null;

  const db = getDb();
  const viewerWorkspace = await ensureViewerWorkspace(viewer.user);
  if (!viewerWorkspace) return null;

  const { data: deliverable, error: delError } = await db
    .from("workspace_deliverables")
    .select(
      "id, title, body_markdown, prompt, scope, workspace_id, workspace_scope_id, citations",
    )
    .eq("id", deliverableId)
    .maybeSingle();

  if (delError || !deliverable || !deliverable.body_markdown) return null;

  const workspaceId = deliverable.workspace_id as string;
  const scopeId = deliverable.workspace_scope_id as string | null;
  const citations = (Array.isArray(deliverable.citations) ? deliverable.citations : []) as Citation[];

  const scope = scopeId ? await getScope(scopeId).catch(() => null) : null;
  const scopeName = scope?.name ?? (deliverable.scope as string | null) ?? null;
  const scopeKind = scope?.kind ?? null;

  // Scope-specific memory + workspace-wide house style, most recent first.
  const [scopedMemory, workspaceMemory] = await Promise.all([
    scopeId
      ? listMemoryEntries({ workspaceId, scopeId, limit: 8 }).catch(() => [])
      : Promise.resolve([]),
    listMemoryEntries({ workspaceId, limit: 20 })
      .then((all) =>
        all
          .filter((m) => m.scope === "workspace" || m.scope === "analyst")
          .slice(0, 6),
      )
      .catch(() => [] as Awaited<ReturnType<typeof listMemoryEntries>>),
  ]);

  // Linked stakeholders for the scope (or any with scope name in metadata).
  const allPeople = await listWorkspacePeople(workspaceId).catch(() => []);
  const stakeholders = allPeople
    .filter((p) => {
      if (scopeId && p.metadata?.linked_scope_id === scopeId) return true;
      if (!scopeName) return false;
      const role = String(p.metadata?.role ?? "").toLowerCase();
      const company = String(p.metadata?.company ?? "").toLowerCase();
      return (
        company.includes(scopeName.toLowerCase()) ||
        role.includes(scopeName.toLowerCase())
      );
    })
    .slice(0, 4);

  // Resolve cited knowledge_documents → source_files (upsert by external_id
  // so repeated prefills don't duplicate rows).
  const citedDocumentIds = new Set<string>();
  for (const c of citations) {
    if (c.source_type === "document" && c.source_id) {
      citedDocumentIds.add(c.source_id);
    }
  }

  const citedDocs = citedDocumentIds.size > 0
    ? await (async () => {
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
      })()
    : [];

  const sourceFiles: EnrichedBrief["sourceFiles"] = [];
  for (const doc of citedDocs) {
    if (doc.status !== "indexed") continue;
    const externalId = `workspace-doc:${doc.id}:${viewerWorkspace.projectRowId}`;
    const kind = kindForFile(doc.filename, doc.file_type);
    const { data: upserted, error: upsertErr } = await db
      .from("source_files")
      .upsert(
        {
          organization_id: viewerWorkspace.organizationRowId,
          project_id: viewerWorkspace.projectRowId,
          uploaded_by: viewer.user.id,
          kind,
          file_name: doc.filename,
          storage_bucket: "knowledge-base",
          storage_path: doc.storage_path,
          file_bytes: doc.file_size_bytes ?? 0,
          external_id: externalId,
        },
        { onConflict: "external_id" },
      )
      .select("id, kind, file_name, storage_bucket, storage_path, file_bytes")
      .single();
    if (upsertErr || !upserted) continue;
    sourceFiles.push({
      id: upserted.id as string,
      kind: upserted.kind as string,
      fileName: upserted.file_name as string,
      storageBucket: upserted.storage_bucket as string,
      storagePath: upserted.storage_path as string,
      fileBytes: Number(upserted.file_bytes ?? 0),
    });
  }

  // Compose the enriched brief body. The pipeline's system prompt reads
  // businessContext as the primary narrative instruction; anything we put
  // here travels all the way into the Claude code-execution turn.
  const sections: string[] = [];

  if (scopeName) {
    const kindLabel =
      scopeKind === "client" ? "Client" : scopeKind === "category" ? "Category" : "Scope";
    sections.push(`## Working scope\n${kindLabel}: **${scopeName}**`);
  }

  if (stakeholders.length > 0) {
    const lines = stakeholders.map((p) => {
      const meta = p.metadata ?? {};
      const role = (meta.role as string | undefined) ?? "";
      const prefs = (meta.preferences as { free_text?: string; structured?: Record<string, unknown> } | undefined) ?? {};
      const structured = prefs.structured ?? {};
      const details: string[] = [];
      if (structured.chart_preference) details.push(`chart: ${structured.chart_preference}`);
      if (structured.language) details.push(`language: ${structured.language}`);
      if (structured.tone) details.push(`tone: ${structured.tone}`);
      if (structured.deck_length) details.push(`length: ${structured.deck_length}`);
      if (structured.review_day) details.push(`cadence: ${structured.review_day}`);
      if (prefs.free_text) details.push(prefs.free_text);
      const detailStr = details.length > 0 ? ` — ${details.join(". ")}` : "";
      return `- **${p.canonical_name}**${role ? ` (${role})` : ""}${detailStr}`;
    });
    sections.push(`## Stakeholders\n${lines.join("\n")}`);
  }

  const memoryLines: string[] = [];
  for (const m of scopedMemory) memoryLines.push(`- ${oneLine(m.content)}`);
  for (const m of workspaceMemory) memoryLines.push(`- ${oneLine(m.content)}`);
  if (memoryLines.length > 0) {
    sections.push(
      `## Workspace rules\nThese preferences and rules apply to every deliverable in this workspace. Follow them without restating them.\n\n${memoryLines.join("\n")}`,
    );
  }

  if (sourceFiles.length > 0) {
    sections.push(
      `## Cited sources\n${sourceFiles.map((s) => `- ${s.fileName}`).join("\n")}\n\nThese files are attached to this run. Read them directly.`,
    );
  }

  const contextPrelude = sections.length > 0 ? `# Workspace context\n\n${sections.join("\n\n")}\n\n---\n\n` : "";

  const bodyMarkdown = `${contextPrelude}# Brief\n\n${(deliverable.body_markdown as string).trim()}`;

  return {
    bodyMarkdown,
    client: scopeName ?? "",
    objective: ((deliverable.prompt as string) ?? "").slice(0, 400),
    audience: "Executive stakeholder",
    thesis: "",
    stakes: "",
    sourceFiles,
  };
}

function oneLine(content: string): string {
  const firstMeaningful = content
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").replace(/^-\s*/, "").trim())
    .find((line) => line.length > 0);
  const clean = firstMeaningful ?? content.trim();
  return clean.length > 260 ? `${clean.slice(0, 260)}…` : clean;
}
