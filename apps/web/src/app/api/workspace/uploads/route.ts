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
  LEGACY_DIRECT_UPLOAD_MAX_BYTES,
  MAX_UPLOAD_BYTES,
  SUPPORTED_UPLOAD_EXTENSIONS,
} from "@/lib/workspace/constants";
import { recordConversationAttachment } from "@/lib/workspace/conversation-attachments";
import { ensureConversationRow } from "@/lib/workspace/conversations";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";
import { getScope } from "@/lib/workspace/scopes";
import { extractInlineExcerpt } from "@/lib/workspace/inline-excerpt";
import { setDocumentAnthropicFileId, setDocumentInlineExcerpt } from "@/lib/workspace/db";
import { uploadFileToAnthropic } from "@/lib/workspace/anthropic-files";
import { enqueueFileIngestRun } from "@/lib/workspace/ingest-queue";
import { processWorkspaceDocument } from "@/lib/workspace/process";

export const runtime = "nodejs";
// Legacy direct-upload path for tiny files. Keeps after() driving
// processWorkspaceDocument until the Railway worker loop ships; ALSO enqueues
// on file_ingest_runs so the worker can pick up once it's live.
export const maxDuration = 800;

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

  if (file.size > LEGACY_DIRECT_UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      {
        error: "This legacy upload path only supports very small files. Refresh the page and retry so the direct-to-storage uploader can handle the file.",
      },
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

  const conversationIdRaw = formData.get("conversation_id");
  const conversationId =
    typeof conversationIdRaw === "string" && UUID_RE.test(conversationIdRaw.trim())
      ? conversationIdRaw.trim()
      : null;

  const scopeIdRaw = formData.get("scope_id");
  const scopeIdCandidate =
    typeof scopeIdRaw === "string" && UUID_RE.test(scopeIdRaw.trim()) ? scopeIdRaw.trim() : null;

  // Validate scope belongs to the current workspace before trusting it.
  // A client could only send a UUID that looks valid; we still need to own it.
  const workspace = await getCurrentWorkspace(viewer);
  let resolvedScopeId: string | null = null;
  if (scopeIdCandidate) {
    const scope = await getScope(scopeIdCandidate).catch(() => null);
    if (scope && scope.workspace_id === workspace.id) {
      resolvedScopeId = scope.id;
    }
  }

  // Ensure the conversation row exists so the attachment FK is satisfied. This
  // is idempotent — if the row was already minted by a prior upload or by chat
  // finish, it's a no-op. If the row exists but belongs to a different
  // workspace, we refuse to attach (trust-boundary check: the upload route
  // trusts the client conversation_id only after confirming ownership).
  let conversationAttachable = false;
  if (conversationId) {
    try {
      const convo = await ensureConversationRow({
        id: conversationId,
        workspaceId: workspace.id,
        scopeId: resolvedScopeId,
        createdBy: viewer.user.id,
      });
      if (convo.workspace_id === workspace.id) {
        conversationAttachable = true;
      } else {
        console.warn(
          `[workspace/uploads] refusing to attach to conversation ${conversationId}: foreign workspace`,
        );
      }
    } catch (error) {
      // Non-fatal: we prefer to still persist the document even if the conversation
      // row could not be materialized. The attachment write below is guarded separately.
      console.error(`[workspace/uploads] ensureConversationRow failed`, error);
    }
  }

  const existing = await findWorkspaceDocumentByHash(contentHash, workspace.organization_id);
  if (existing) {
    if (conversationId && conversationAttachable) {
      await recordConversationAttachment({
        conversationId,
        documentId: existing.id,
        workspaceId: workspace.id,
        workspaceScopeId: resolvedScopeId,
        uploadedBy: viewer.user.id,
        origin: "chat-drop",
      }).catch((error) => {
        console.error(
          `[workspace/uploads] recordConversationAttachment failed for dedup hit ${existing.id}`,
          error,
        );
      });
    }
    return NextResponse.json({
      id: existing.id,
      status: existing.status,
      deduplicated: true,
      filename: existing.filename,
      fileSizeBytes: existing.file_size_bytes,
      attachedToConversation: Boolean(conversationId && conversationAttachable),
    });
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
    workspaceId: workspace.id,
    organizationId: workspace.organization_id,
  });

  // Execution-first enrichment: inline excerpt + Anthropic Files API id run
  // in parallel. Either may fail; both fail silently. The upload still
  // succeeds and Lane B (Railway worker) does the durable ingest.
  const inlineExcerptPromise = extractInlineExcerpt(buffer, ext, file.type).catch((error) => {
    console.error(`[workspace/uploads] inline excerpt extraction failed for ${documentId}`, error);
    return null;
  });
  const anthropicFileIdPromise = uploadFileToAnthropic({
    buffer,
    filename,
    contentType: file.type,
  }).catch((error) => {
    console.error(`[workspace/uploads] Anthropic Files upload failed for ${documentId}`, error);
    return null;
  });

  const [inlineExcerpt, anthropicFileId] = await Promise.all([
    inlineExcerptPromise,
    anthropicFileIdPromise,
  ]);

  if (inlineExcerpt) {
    await setDocumentInlineExcerpt(documentId, inlineExcerpt).catch((error) => {
      console.error(`[workspace/uploads] setDocumentInlineExcerpt failed for ${documentId}`, error);
    });
  }
  if (anthropicFileId) {
    await setDocumentAnthropicFileId(documentId, anthropicFileId).catch((error) => {
      console.error(
        `[workspace/uploads] setDocumentAnthropicFileId failed for ${documentId}`,
        error,
      );
    });
  }

  if (conversationId && conversationAttachable) {
    await recordConversationAttachment({
      conversationId,
      documentId,
      workspaceId: workspace.id,
      workspaceScopeId: resolvedScopeId,
      uploadedBy: viewer.user.id,
      origin: "chat-drop",
    }).catch((error) => {
      console.error(
        `[workspace/uploads] recordConversationAttachment failed for new doc ${documentId}`,
        error,
      );
    });
  }

  // Dual-write: enqueue on file_ingest_runs for the future Railway worker,
  // and still run processWorkspaceDocument in after() for current prod.
  await enqueueFileIngestRun({
    documentId,
    workspaceId: workspace.id,
    metadata: { source: "upload_legacy", filename },
  }).catch((error) => {
    console.error(
      `[workspace/uploads] enqueueFileIngestRun failed for ${documentId}`,
      error,
    );
  });

  after(async () => {
    try {
      await processWorkspaceDocument(documentId);
    } catch (error) {
      console.error(`[workspace] background processing failed for ${documentId}`, error);
    }
  });

  return NextResponse.json({
    id: documentId,
    status: "processing",
    deduplicated: false,
    filename,
    fileSizeBytes: buffer.length,
    hasInlineExcerpt: Boolean(inlineExcerpt),
    attachedToConversation: Boolean(conversationId),
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
