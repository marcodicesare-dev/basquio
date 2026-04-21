import { after, NextResponse } from "next/server";
import { z } from "zod";

import { isTeamBetaEmail } from "@/lib/team-beta";
import {
  getStorageObjectInfo,
  removeStorageObjects,
} from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import {
  KNOWLEDGE_BUCKET,
  MAX_UPLOAD_BYTES,
  SUPPORTED_UPLOAD_EXTENSIONS,
} from "@/lib/workspace/constants";
import {
  createWorkspaceDocument,
  findWorkspaceDocumentByHash,
} from "@/lib/workspace/db";
import { processWorkspaceDocument } from "@/lib/workspace/process";

export const runtime = "nodejs";
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

    const payload = confirmSchema.parse(await readJsonBody(request));
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

    const existing = await findWorkspaceDocumentByHash(payload.contentHash);
    if (existing) {
      await cleanupDuplicateObject(supabaseUrl, serviceKey, payload.storagePath, existing.storage_path);
      return NextResponse.json({
        id: existing.id,
        status: existing.status,
        deduplicated: true,
        fileName: existing.filename,
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
        return NextResponse.json({
          id: raceWinner.id,
          status: raceWinner.status,
          deduplicated: true,
          fileName: raceWinner.filename,
        });
      }
      throw error;
    }

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
      fileName: filename,
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
