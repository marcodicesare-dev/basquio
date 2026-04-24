import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { KNOWLEDGE_BUCKET } from "@/lib/workspace/constants";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
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
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!conversationId || !UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Conversation attachment required." }, { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase storage is not configured." }, { status: 500 });
  }

  const workspace = await getCurrentWorkspace();
  const db = createServiceSupabaseClient(supabaseUrl, serviceKey);
  const { data: attachment, error } = await db
    .from("conversation_attachments")
    .select(`
      id,
      workspace_id,
      conversation_id,
      document_id,
      knowledge_documents (
        id,
        filename,
        file_type,
        storage_path,
        status
      )
    `)
    .eq("conversation_id", conversationId)
    .eq("document_id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  const doc = Array.isArray(attachment?.knowledge_documents)
    ? attachment.knowledge_documents[0]
    : attachment?.knowledge_documents;
  if (error || !attachment || !doc || doc.status === "deleted") {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const storagePath = (doc as { storage_path: string | null }).storage_path;
  if (!storagePath) {
    return NextResponse.json({ error: "Document file is missing." }, { status: 404 });
  }

  const { data: blob, error: downloadError } = await db.storage
    .from(KNOWLEDGE_BUCKET)
    .download(storagePath);
  if (downloadError || !blob) {
    return NextResponse.json({ error: "Document file is missing." }, { status: 404 });
  }

  const filename = (doc as { filename: string | null }).filename ?? "workspace-file";
  const fileType = (doc as { file_type: string | null }).file_type ?? "";
  return new Response(blob.stream(), {
    headers: {
      "content-type": blob.type || getContentType(fileType),
      "content-disposition": `inline; filename*=UTF-8''${encodeRFC5987(filename)}`,
      "cache-control": "private, max-age=60",
    },
  });
}

function getContentType(extension: string): string {
  const lower = extension.toLowerCase();
  if (lower === "pdf") return "application/pdf";
  if (lower === "png") return "image/png";
  if (lower === "jpg" || lower === "jpeg") return "image/jpeg";
  if (lower === "webp") return "image/webp";
  if (lower === "gif") return "image/gif";
  if (lower === "txt" || lower === "md" || lower === "gsp") return "text/plain";
  if (lower === "csv") return "text/csv";
  if (lower === "json") return "application/json";
  if (lower === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}
