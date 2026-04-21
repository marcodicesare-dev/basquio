import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import {
  buildResumableUploadUrl,
  createSignedUploadUrl,
} from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import {
  KNOWLEDGE_BUCKET,
  MAX_UPLOAD_BYTES,
  RESUMABLE_CHUNK_BYTES,
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  SUPPORTED_UPLOAD_EXTENSIONS,
} from "@/lib/workspace/constants";
import { findWorkspaceDocumentByHash } from "@/lib/workspace/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPPORTED = new Set<string>(SUPPORTED_UPLOAD_EXTENSIONS);

const prepareSchema = z.object({
  fileName: z.string().min(1),
  mediaType: z.string().default("application/octet-stream"),
  sizeBytes: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  note: z.string().max(2000).nullable().optional(),
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

    const payload = prepareSchema.parse(await readJsonBody(request));
    const filename = payload.fileName.trim();
    const extension = filename.split(".").pop()?.toLowerCase() ?? "";

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

    const existing = await findWorkspaceDocumentByHash(payload.contentHash);
    if (existing) {
      return NextResponse.json({
        deduplicated: true,
        id: existing.id,
        status: existing.status,
        fileName: existing.filename,
        contentHash: payload.contentHash,
      });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Supabase storage is not configured." }, { status: 500 });
    }

    const provisionalId = randomUUID();
    const storagePath = buildWorkspaceStoragePath(payload.contentHash, filename);
    const signedUpload = await createSignedUploadUrl({
      supabaseUrl,
      serviceKey,
      bucket: KNOWLEDGE_BUCKET,
      storagePath,
      upsert: true,
    });
    const uploadMode =
      payload.sizeBytes >= RESUMABLE_UPLOAD_THRESHOLD_BYTES ? "resumable" : "standard";

    return NextResponse.json({
      upload: {
        provisionalId,
        fileName: filename,
        mediaType: payload.mediaType || "application/octet-stream",
        storageBucket: KNOWLEDGE_BUCKET,
        storagePath,
        fileBytes: payload.sizeBytes,
        uploadMode,
        signedUrl: signedUpload.signedUrl,
        resumableUrl: uploadMode === "resumable" ? buildResumableUploadUrl(supabaseUrl) : undefined,
        chunkSizeBytes: uploadMode === "resumable" ? RESUMABLE_CHUNK_BYTES : undefined,
        token: signedUpload.token,
        contentHash: payload.contentHash,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid upload request." }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Upload request must be valid JSON." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to prepare upload.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildWorkspaceStoragePath(contentHash: string, fileName: string) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const safeFilename = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `workspace/${yyyy}/${mm}/${dd}/${contentHash.slice(0, 12)}-${safeFilename}`;
}

async function readJsonBody(request: Request) {
  return request.json();
}
