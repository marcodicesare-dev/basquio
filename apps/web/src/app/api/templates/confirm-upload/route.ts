import { NextResponse } from "next/server";
import { z } from "zod";

import {
  assertUploadedTemplateExists,
  buildTemplateStoragePath,
  createTemplateImportRecords,
  resolveTemplateImportContext,
  TEMPLATE_STORAGE_BUCKET,
  validateTemplateUploadDescriptor,
} from "@/lib/templates/import-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  sourceFileId: z.string().uuid(),
  storageBucket: z.string().default(TEMPLATE_STORAGE_BUCKET),
  storagePath: z.string().min(1),
  fileName: z.string().min(1),
  fileSize: z.number().int().positive(),
  mediaType: z.string().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  setAsDefault: z.boolean().default(false),
});

export async function POST(request: Request) {
  const contextResult = await resolveTemplateImportContext();
  if ("error" in contextResult) {
    return NextResponse.json({ error: contextResult.error }, { status: contextResult.status });
  }

  try {
    const payload = requestSchema.parse(await request.json());
    const kind = validateTemplateUploadDescriptor(payload.fileName, payload.fileSize);

    const expectedStoragePath = buildTemplateStoragePath(
      contextResult.context.workspace,
      payload.sourceFileId,
      payload.fileName,
    );

    if (payload.storageBucket !== TEMPLATE_STORAGE_BUCKET || payload.storagePath !== expectedStoragePath) {
      return NextResponse.json(
        { error: "Template upload path mismatch. Prepare the upload again and retry." },
        { status: 400 },
      );
    }

    const objectInfo = await assertUploadedTemplateExists({
      context: contextResult.context,
      storageBucket: payload.storageBucket,
      storagePath: payload.storagePath,
    });
    const uploadedBytes = readUploadedSize(objectInfo?.metadata);

    if (uploadedBytes !== null && uploadedBytes !== payload.fileSize) {
      return NextResponse.json(
        {
          error: `Uploaded file size mismatch. Basquio received ${formatBytes(uploadedBytes)} but expected ${formatBytes(payload.fileSize)}.`,
        },
        { status: 400 },
      );
    }

    const result = await createTemplateImportRecords({
      context: contextResult.context,
      sourceFileId: payload.sourceFileId,
      storageBucket: payload.storageBucket,
      storagePath: payload.storagePath,
      fileName: payload.fileName,
      fileBytes: uploadedBytes ?? payload.fileSize,
      mediaType: payload.mediaType ?? "application/octet-stream",
      kind,
      templateName: payload.name,
      setAsDefault: payload.setAsDefault,
      removeStorageOnFailure: false,
    });

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to confirm the template upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function readUploadedSize(metadata: Record<string, unknown> | undefined) {
  const sizeCandidate = metadata?.size;
  const normalized = typeof sizeCandidate === "number"
    ? sizeCandidate
    : typeof sizeCandidate === "string"
      ? Number.parseInt(sizeCandidate, 10)
      : NaN;

  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}
