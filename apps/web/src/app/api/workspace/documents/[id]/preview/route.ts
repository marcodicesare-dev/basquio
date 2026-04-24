import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { KNOWLEDGE_BUCKET } from "@/lib/workspace/constants";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_CHARS = 80_000;
const MAX_ROWS = 20;
const MAX_COLUMNS = 12;

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
  const fileType = ((doc as { file_type: string | null }).file_type ?? "").toLowerCase();
  const extension = fileType || filename.split(".").pop()?.toLowerCase() || "";

  if (["txt", "md", "gsp", "json", "yaml", "yml", "csv"].includes(extension)) {
    return NextResponse.json({
      kind: "text",
      text: (await blob.text()).slice(0, MAX_TEXT_CHARS),
    });
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return NextResponse.json({
      kind: "text",
      text: result.value.slice(0, MAX_TEXT_CHARS),
    });
  }

  if (extension === "xlsx" || extension === "xls") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return NextResponse.json({ kind: "spreadsheet", sheets: [] });
    }
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS) return;
      const values: string[] = [];
      for (let column = 1; column <= Math.min(MAX_COLUMNS, sheet.columnCount); column += 1) {
        const cell = row.getCell(column);
        values.push(formatCellValue(cell.text || cell.value));
      }
      rows.push(values);
    });
    return NextResponse.json({
      kind: "spreadsheet",
      sheets: [{ name: sheet.name, rows }],
    });
  }

  return NextResponse.json({
    kind: "unsupported",
    message: "Preview not supported. Open original to inspect the file.",
  });
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return formatCellValue(value.result);
    return JSON.stringify(value);
  }
  return String(value);
}
