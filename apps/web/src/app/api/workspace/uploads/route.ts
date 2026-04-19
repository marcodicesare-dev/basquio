import { createHash } from "node:crypto";

import { after, NextResponse } from "next/server";

import { isTeamBetaEmail } from "@/lib/team-beta";
import { getViewerState } from "@/lib/supabase/auth";
import {
  createWorkspaceDocument,
  findWorkspaceDocumentByHash,
  uploadWorkspaceFileToStorage,
} from "@/lib/workspace/db";
import {
  MAX_UPLOAD_BYTES,
  SUPPORTED_UPLOAD_EXTENSIONS,
} from "@/lib/workspace/constants";
import { processWorkspaceDocument } from "@/lib/workspace/process";

export const runtime = "nodejs";
export const maxDuration = 300;

const SUPPORTED = new Set<string>(SUPPORTED_UPLOAD_EXTENSIONS);

export async function POST(request: Request) {
  const viewer = await getViewerState();

  if (!viewer.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  if (!isTeamBetaEmail(viewer.user.email)) {
    return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as multipart/form-data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a file to the field named file." }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    return NextResponse.json(
      { error: `Files cap at ${limitMb} MB. Split the file or contact Marco.` },
      { status: 413 },
    );
  }

  const filename = file.name?.trim();
  if (!filename) {
    return NextResponse.json({ error: "The file has no name." }, { status: 400 });
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ext || !SUPPORTED.has(ext)) {
    return NextResponse.json(
      { error: `Files of type .${ext || "?"} are not supported yet.` },
      { status: 415 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  const existing = await findWorkspaceDocumentByHash(contentHash);
  if (existing) {
    return NextResponse.json({ id: existing.id, status: existing.status, deduplicated: true });
  }

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `workspace/${yyyy}/${mm}/${dd}/${contentHash.slice(0, 12)}-${safeFilename}`;

  await uploadWorkspaceFileToStorage(buffer, storagePath, file.type || "application/octet-stream");

  const uploadContextRaw = formData.get("note");
  const uploadContext = typeof uploadContextRaw === "string" && uploadContextRaw.trim().length > 0
    ? uploadContextRaw.trim()
    : null;

  const documentId = await createWorkspaceDocument({
    filename,
    fileType: ext,
    fileSizeBytes: buffer.length,
    storagePath,
    contentHash,
    uploadedByEmail: viewer.user.email ?? "unknown",
    uploadedByUserId: viewer.user.id,
    uploadContext,
  });

  after(async () => {
    try {
      await processWorkspaceDocument(documentId);
    } catch (error) {
      console.error(`[workspace] background processing failed for ${documentId}`, error);
    }
  });

  return NextResponse.json({ id: documentId, status: "processing", deduplicated: false });
}
