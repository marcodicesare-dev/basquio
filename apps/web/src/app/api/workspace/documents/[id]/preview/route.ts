import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { KNOWLEDGE_BUCKET } from "@/lib/workspace/constants";
import { resolveWorkspaceDocumentAccess } from "@/lib/workspace/document-access";

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
  if (conversationId && !UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Conversation attachment required." }, { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase storage is not configured." }, { status: 500 });
  }

  const db = createServiceSupabaseClient(supabaseUrl, serviceKey);
  const doc = await resolveWorkspaceDocumentAccess({ db, documentId: id, conversationId });
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const storagePath = doc.storage_path;
  if (!storagePath) {
    return NextResponse.json({ error: "Document file is missing." }, { status: 404 });
  }

  const { data: blob, error: downloadError } = await db.storage
    .from(KNOWLEDGE_BUCKET)
    .download(storagePath);
  if (downloadError || !blob) {
    return NextResponse.json({ error: "Document file is missing." }, { status: 404 });
  }

  const filename = doc.filename ?? "workspace-file";
  const fileType = (doc.file_type ?? "").toLowerCase();
  const extension = fileType || filename.split(".").pop()?.toLowerCase() || "";

  if (extension === "csv") {
    const rows = parseCsvPreview(await blob.text());
    return NextResponse.json({
      kind: "spreadsheet",
      sheets: [{ name: filename, rows }],
    });
  }

  if (["txt", "md", "gsp", "json", "yaml", "yml"].includes(extension)) {
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

function parseCsvPreview(text: string): string[][] {
  const records = parseCsv(text, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: false,
    to_line: MAX_ROWS,
  }) as unknown[][];

  return records.map((row) =>
    row.slice(0, MAX_COLUMNS).map((cell) => formatCellValue(cell)),
  );
}
