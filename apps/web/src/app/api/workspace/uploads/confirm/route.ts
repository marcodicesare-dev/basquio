import { after, NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import {
  getStorageObjectInfo,
  removeStorageObjects,
} from "@/lib/supabase/admin";
import { createServiceSupabaseClient } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import {
  KNOWLEDGE_BUCKET,
  MAX_UPLOAD_BYTES,
  SUPPORTED_UPLOAD_EXTENSIONS,
} from "@/lib/workspace/constants";
import {
  createWorkspaceDocument,
  findWorkspaceDocumentByHash,
  setDocumentAnthropicFileId,
  setDocumentInlineExcerpt,
} from "@/lib/workspace/db";
import { recordConversationAttachment } from "@/lib/workspace/conversation-attachments";
import { ensureConversationRow } from "@/lib/workspace/conversations";
import { getCurrentWorkspace } from "@/lib/workspace/workspaces";
import { getScope } from "@/lib/workspace/scopes";
import { extractInlineExcerpt } from "@/lib/workspace/inline-excerpt";
import { uploadFileToAnthropic } from "@/lib/workspace/anthropic-files";
import { enqueueFileIngestRun } from "@/lib/workspace/ingest-queue";
import { markDocumentIndexingFailed } from "@/lib/workspace/retry";

export const runtime = "nodejs";
// Confirm owns the fast lane only: validate the object, create the document,
// attach it to the chat, enqueue memory indexing, and return. Heavy chunking
// lives in the Railway file-ingest worker. Anthropic Files + inline excerpt
// enrichment are best-effort after() work and never block the upload response.
export const maxDuration = 120;

const SUPPORTED = new Set<string>(SUPPORTED_UPLOAD_EXTENSIONS);

const confirmSchema = z.object({
  provisionalId: z.string().min(1),
  fileName: z.string().min(1),
  mediaType: z.string().default("application/octet-stream"),
  sizeBytes: z.number().int().positive(),
  storageBucket: z.string(),
  storagePath: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  note: z.string().max(2000).nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  scopeId: z.string().uuid().nullable().optional(),
});

/**
 * Dedup-attach path. When the prepare step returned `deduplicated: true` we
 * never uploaded a new blob, but the chat drawer still wants the file attached
 * to this conversation. The client calls confirm with just
 * {deduplicatedDocumentId, contentHash, conversationId, scopeId}.
 */
const dedupAttachSchema = z.object({
  deduplicatedDocumentId: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  conversationId: z.string().uuid().nullable().optional(),
  scopeId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const viewer = await getViewerState();

    if (!viewer.user) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    if (!isTeamBetaEmail(viewer.user.email)) {
      return NextResponse.json({ error: "Workspace beta is team only." }, { status: 404 });
    }

    const rawBody = await readJsonBody(request);

    // Two request shapes: a full confirm after a fresh upload, or a
    // dedup-attach for a file we already have. Route by a string-typed
    // `deduplicatedDocumentId` so an accidental `null` on a regular confirm
    // doesn't fall into the dedup branch and surface a confusing 400.
    const rawRecord =
      typeof rawBody === "object" && rawBody ? (rawBody as Record<string, unknown>) : null;
    if (rawRecord && typeof rawRecord.deduplicatedDocumentId === "string") {
      return handleDedupAttach(rawBody, viewer.user.id);
    }

    const payload = confirmSchema.parse(rawBody);
    const filename = payload.fileName.trim();
    const extension = filename.split(".").pop()?.toLowerCase() ?? "";

    if (payload.storageBucket !== KNOWLEDGE_BUCKET) {
      return NextResponse.json({ error: "Unexpected storage target." }, { status: 400 });
    }

    if (!isValidWorkspaceStoragePath(payload.storagePath, payload.contentHash, filename)) {
      return NextResponse.json({ error: "Upload confirmation did not match the prepared storage path." }, { status: 400 });
    }

    if (!extension || !SUPPORTED.has(extension)) {
      return NextResponse.json(
        { error: `Files of type .${extension || "?"} are not supported yet.` },
        { status: 415 },
      );
    }

    if (payload.sizeBytes > MAX_UPLOAD_BYTES) {
      const limitMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
      return NextResponse.json(
        { error: `Files cap at ${limitMb} MB. Split the file or contact Marco.` },
        { status: 413 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Supabase storage is not configured." }, { status: 500 });
    }

    // Dual-lane: resolve workspace + scope ownership up front so every
    // attachment write below is safe.
    const workspace = await getCurrentWorkspace();
    const resolvedScopeId = await resolveScopeOwnership({
      workspaceId: workspace.id,
      scopeId: payload.scopeId ?? null,
    });
    const conversationAttachable = await ensureConversationAttachable({
      conversationId: payload.conversationId ?? null,
      workspaceId: workspace.id,
      scopeId: resolvedScopeId,
      createdBy: viewer.user.id,
    });

    const existing = await findWorkspaceDocumentByHash(payload.contentHash);
    if (existing) {
      await cleanupDuplicateObject(supabaseUrl, serviceKey, payload.storagePath, existing.storage_path);
      let attachedToConversation = false;
      if (payload.conversationId && conversationAttachable) {
        attachedToConversation = await recordAttachmentSafely({
          conversationId: payload.conversationId,
          documentId: existing.id,
          workspaceId: workspace.id,
          workspaceScopeId: resolvedScopeId,
          uploadedBy: viewer.user.id,
        });
      }

      // Backfill enrichment for existing rows that pre-date Layer A. A dedup
      // hit used to skip the Anthropic Files API upload, which meant files
      // uploaded before Layer A shipped never got an anthropic_file_id and
      // the analyzeAttachedFile tool had nothing to work with. Only run when
      // the column is still null — don't re-upload on every dedup hit.
      if (!existing.anthropic_file_id && existing.storage_path) {
        after(async () => {
          await enrichDocumentFromStorage({
            supabaseUrl,
            serviceKey,
            bucket: payload.storageBucket,
            storagePath: existing.storage_path,
            extension: (existing.file_type ?? filename.split(".").pop() ?? "").toLowerCase(),
            mediaType: payload.mediaType,
            documentId: existing.id,
            filename: existing.filename ?? filename,
          }).catch((error) => {
            console.error(
              `[workspace/uploads/confirm] dedup-hit backfill failed for ${existing.id}`,
              error,
            );
          });
        });
      }

      return NextResponse.json({
        id: existing.id,
        status: existing.status,
        deduplicated: true,
        fileName: existing.filename,
        attachedToConversation,
      });
    }

    const objectInfo = await getStorageObjectInfo({
      supabaseUrl,
      serviceKey,
      bucket: payload.storageBucket,
      storagePath: payload.storagePath,
    });
    const storedSizeBytes = extractStorageObjectSize(objectInfo);
    if (typeof storedSizeBytes === "number" && storedSizeBytes !== payload.sizeBytes) {
      return NextResponse.json(
        { error: "Uploaded object size did not match the prepared upload." },
        { status: 400 },
      );
    }
    const persistedSizeBytes = storedSizeBytes ?? payload.sizeBytes;

    let documentId: string;
    try {
      documentId = await createWorkspaceDocument({
        filename,
        fileType: extension,
        fileSizeBytes: persistedSizeBytes,
        storagePath: payload.storagePath,
        contentHash: payload.contentHash,
        uploadedByEmail: viewer.user.email ?? "unknown",
        uploadedByUserId: viewer.user.id,
        uploadContext: payload.note ?? null,
      });
    } catch (error) {
      const raceWinner = await findWorkspaceDocumentByHash(payload.contentHash);
      if (raceWinner) {
        await cleanupDuplicateObject(supabaseUrl, serviceKey, payload.storagePath, raceWinner.storage_path);
        let attachedToConversation = false;
        if (payload.conversationId && conversationAttachable) {
          attachedToConversation = await recordAttachmentSafely({
            conversationId: payload.conversationId,
            documentId: raceWinner.id,
            workspaceId: workspace.id,
            workspaceScopeId: resolvedScopeId,
            uploadedBy: viewer.user.id,
          });
        }
        return NextResponse.json({
          id: raceWinner.id,
          status: raceWinner.status,
          deduplicated: true,
          fileName: raceWinner.filename,
          attachedToConversation,
        });
      }
      throw error;
    }

    let attachedToConversation = false;
    if (payload.conversationId && conversationAttachable) {
      attachedToConversation = await recordAttachmentSafely({
        conversationId: payload.conversationId,
        documentId,
        workspaceId: workspace.id,
        workspaceScopeId: resolvedScopeId,
        uploadedBy: viewer.user.id,
      });
    }

    // Lane A enrichment is intentionally off the critical path. The chat
    // attachment row above makes the file usable immediately; if this best-
    // effort cache is missing on the first question, analyzeAttachedFile can
    // re-upload from Supabase Storage.
    after(async () => {
      await enrichDocumentFromStorage({
        supabaseUrl,
        serviceKey,
        bucket: payload.storageBucket,
        storagePath: payload.storagePath,
        extension,
        mediaType: payload.mediaType,
        documentId,
        filename,
      }).catch((error) => {
        console.error(
          `[workspace/uploads/confirm] enrichDocumentFromStorage failed for ${documentId}`,
          error,
        );
      });
    });

    // Lane B runs in the Railway worker. The upload response must not wait for
    // chunking, embeddings, entity extraction, or vector inserts.
    const queuedForIndexing = await enqueueFileIngestRun({
      documentId,
      workspaceId: workspace.id,
      metadata: { source: "upload_confirm", filename },
    })
      .then(() => true)
      .catch(async (error) => {
        const message =
          error instanceof Error ? error.message : "memory indexing queue failed";
        console.error(
          `[workspace/uploads/confirm] enqueueFileIngestRun failed for ${documentId}`,
          error,
        );
        await markDocumentIndexingFailed(
          documentId,
          `Memory indexing queue failed: ${message}`,
        ).catch((markError) => {
          console.error(
            `[workspace/uploads/confirm] markDocumentIndexingFailed failed for ${documentId}`,
            markError,
          );
        });
        return false;
      });

    return NextResponse.json({
      id: documentId,
      status: queuedForIndexing ? "processing" : "failed",
      deduplicated: false,
      fileName: filename,
      attachedToConversation,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid upload confirmation." }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Upload confirmation must be valid JSON." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to confirm upload.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function cleanupDuplicateObject(
  supabaseUrl: string,
  serviceKey: string,
  storagePath: string,
  canonicalStoragePath?: string | null,
) {
  if (canonicalStoragePath && canonicalStoragePath === storagePath) {
    return;
  }
  await removeStorageObjects({
    supabaseUrl,
    serviceKey,
    bucket: KNOWLEDGE_BUCKET,
    paths: [storagePath],
  }).catch(() => {});
}

function isValidWorkspaceStoragePath(storagePath: string, contentHash: string, fileName: string) {
  const safeFilename = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const expectedSuffix = `${contentHash.slice(0, 12)}-${safeFilename}`;
  return /^workspace\/\d{4}\/\d{2}\/\d{2}\//.test(storagePath) && storagePath.endsWith(expectedSuffix);
}

async function readJsonBody(request: Request) {
  return request.json();
}

function extractStorageObjectSize(objectInfo: {
  metadata?: Record<string, unknown>;
}) {
  const metadata = objectInfo.metadata ?? {};
  const directCandidates = [
    metadata.size,
    metadata.fileSize,
    metadata.file_size,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  const nestedCandidates = [
    metadata.httpMetadata,
    metadata.http_metadata,
  ];
  for (const nested of nestedCandidates) {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      continue;
    }
    const size = (nested as Record<string, unknown>).size;
    if (typeof size === "number" && Number.isFinite(size)) {
      return size;
    }
    if (typeof size === "string" && size.trim().length > 0) {
      const parsed = Number(size);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dual-lane helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveScopeOwnership(input: {
  workspaceId: string;
  scopeId: string | null;
}): Promise<string | null> {
  if (!input.scopeId) return null;
  const scope = await getScope(input.scopeId).catch(() => null);
  if (!scope || scope.workspace_id !== input.workspaceId) return null;
  return scope.id;
}

async function ensureConversationAttachable(input: {
  conversationId: string | null;
  workspaceId: string;
  scopeId: string | null;
  createdBy: string;
}): Promise<boolean> {
  if (!input.conversationId) return false;
  try {
    const convo = await ensureConversationRow({
      id: input.conversationId,
      workspaceId: input.workspaceId,
      scopeId: input.scopeId,
      createdBy: input.createdBy,
    });
    if (convo.workspace_id === input.workspaceId) return true;
    console.warn(
      `[workspace/uploads/confirm] refusing to attach to conversation ${input.conversationId}: foreign workspace`,
    );
    return false;
  } catch (error) {
    console.error("[workspace/uploads/confirm] ensureConversationRow failed", error);
    return false;
  }
}

async function recordAttachmentSafely(input: {
  conversationId: string;
  documentId: string;
  workspaceId: string;
  workspaceScopeId: string | null;
  uploadedBy: string;
}): Promise<boolean> {
  try {
    await recordConversationAttachment({
      conversationId: input.conversationId,
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      workspaceScopeId: input.workspaceScopeId,
      uploadedBy: input.uploadedBy,
      origin: "chat-drop",
    });
    return true;
  } catch (error) {
    console.error(
      `[workspace/uploads/confirm] recordConversationAttachment failed for ${input.documentId}`,
      error,
    );
    return false;
  }
}

const dedupAttachFields = dedupAttachSchema;

async function handleDedupAttach(rawBody: unknown, viewerId: string) {
  const parsed = dedupAttachFields.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid dedup-attach body." },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const existing = await findWorkspaceDocumentByHash(body.contentHash);
  if (!existing || existing.id !== body.deduplicatedDocumentId) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const workspace = await getCurrentWorkspace();
  const resolvedScopeId = await resolveScopeOwnership({
    workspaceId: workspace.id,
    scopeId: body.scopeId ?? null,
  });
  const conversationAttachable = await ensureConversationAttachable({
    conversationId: body.conversationId ?? null,
    workspaceId: workspace.id,
    scopeId: resolvedScopeId,
    createdBy: viewerId,
  });

  let attachedToConversation = false;
  if (body.conversationId && conversationAttachable) {
    attachedToConversation = await recordAttachmentSafely({
      conversationId: body.conversationId,
      documentId: existing.id,
      workspaceId: workspace.id,
      workspaceScopeId: resolvedScopeId,
      uploadedBy: viewerId,
    });
  }

  return NextResponse.json({
    id: existing.id,
    status: existing.status,
    deduplicated: true,
    fileName: existing.filename,
    attachedToConversation,
  });
}

async function enrichDocumentFromStorage(input: {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  storagePath: string;
  extension: string;
  mediaType: string;
  documentId: string;
  filename: string;
}) {
  const db = createServiceSupabaseClient(input.supabaseUrl, input.serviceKey);
  const { data: blob, error } = await db.storage.from(input.bucket).download(input.storagePath);
  if (error || !blob) {
    return;
  }
  const buffer = Buffer.from(await blob.arrayBuffer());

  // Run both enrichments in parallel. Neither is critical to the upload's
  // success; both write to knowledge_documents best-effort.
  await Promise.all([
    extractInlineExcerpt(buffer, input.extension, input.mediaType)
      .then(async (excerpt) => {
        if (excerpt) {
          await setDocumentInlineExcerpt(input.documentId, excerpt).catch(() => {});
        }
      })
      .catch(() => {}),
    uploadFileToAnthropic({
      buffer,
      filename: input.filename,
      contentType: input.mediaType,
    })
      .then(async (fileId) => {
        if (fileId) {
          await setDocumentAnthropicFileId(input.documentId, fileId).catch(() => {});
        }
      })
      .catch(() => {}),
  ]);
}
