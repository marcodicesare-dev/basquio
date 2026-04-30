import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import { getWorkspaceDeliverable } from "@/lib/workspace/db";
import { exportDeliverableToDocx, type ExportCitation } from "@/lib/workspace/export-docx";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Streams a deliverable as a .docx file. Backed by the `docx` npm library
 * (Anthropic's docx skill uses the same library) and a markdown→AST walker
 * that maps every token to docx primitives. Tables, headings, lists, bold,
 * italic, links, and inline `[s1]` citations all carry through.
 *
 * Citations become Word footnotes (FootnoteReferenceRun) plus a Sources
 * appendix at the end of the document. Word, Pages, and Google Docs render
 * footnotes natively, so handing the file to a stakeholder keeps every
 * citation linked to its source excerpt.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid deliverable id." }, { status: 400 });
  }

  const workspace = await getCurrentWorkspace(viewer);
  const deliverable = await getWorkspaceDeliverable(id, workspace.id);
  if (!deliverable) {
    return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
  }
  const bodyMarkdown = deliverable.body_markdown ?? "";
  if (!bodyMarkdown.trim()) {
    return NextResponse.json(
      { error: "This deliverable has no body to export. Generate or edit it first." },
      { status: 422 },
    );
  }

  const citations = Array.isArray(deliverable.citations)
    ? (deliverable.citations as ExportCitation[])
    : [];

  let buffer: Buffer;
  try {
    buffer = await exportDeliverableToDocx({
      title: deliverable.title || "Basquio deliverable",
      bodyMarkdown,
      citations,
      subtitle: deliverable.prompt ? truncate(deliverable.prompt, 200) : null,
      exportedBy: viewer.user.email ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build the Word file.";
    console.error(`[deliverables/export] docx build failed for ${id}:`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const filename = sanitizeFilename(deliverable.title || "basquio-deliverable") + ".docx";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(
        filename,
      )}`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function sanitizeFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "deliverable";
}
