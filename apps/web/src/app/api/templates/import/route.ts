import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { uploadToStorage } from "@/lib/supabase/admin";
import {
  buildTemplateStoragePath,
  createTemplateImportRecords,
  LEGACY_TEMPLATE_IMPORT_MAX_BYTES,
  resolveTemplateImportContext,
  TEMPLATE_STORAGE_BUCKET,
  validateTemplateUploadDescriptor,
} from "@/lib/templates/import-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const contextResult = await resolveTemplateImportContext();
  if ("error" in contextResult) {
    return NextResponse.json({ error: contextResult.error }, { status: contextResult.status });
  }

  const contentType = request.headers.get("content-type") ?? "";

  let fileName: string;
  let fileBuffer: Buffer;
  let mediaType: string;
  let templateName: string | undefined;
  let setAsDefault = false;

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json(
          { error: "Upload a PPTX, JSON, CSS, or PDF template file." },
          { status: 400 },
        );
      }

      fileName = file.name;
      fileBuffer = Buffer.from(await file.arrayBuffer());
      mediaType = file.type || "application/octet-stream";
      templateName = String(formData.get("name") ?? "") || undefined;
      setAsDefault = formData.get("setAsDefault") === "true";
    } else {
      const body = (await request.json()) as {
        base64?: string;
        fileName?: string;
        mediaType?: string;
        name?: string;
        setAsDefault?: boolean;
      };

      if (!body.fileName || !body.base64) {
        return NextResponse.json({ error: "Missing fileName or base64." }, { status: 400 });
      }

      fileName = body.fileName;
      fileBuffer = Buffer.from(body.base64, "base64");
      mediaType = body.mediaType ?? "application/octet-stream";
      templateName = body.name;
      setAsDefault = body.setAsDefault === true;
    }

    const kind = validateTemplateUploadDescriptor(fileName, fileBuffer.length);
    if (fileBuffer.length > LEGACY_TEMPLATE_IMPORT_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `This template is ${formatBytes(fileBuffer.length)}. Large files upload directly to storage now, so retry from the template library and Basquio will bypass the Vercel body limit automatically.`,
        },
        { status: 413 },
      );
    }

    const sourceFileId = randomUUID();
    const storagePath = buildTemplateStoragePath(
      contextResult.context.workspace,
      sourceFileId,
      fileName,
    );

    await uploadToStorage({
      supabaseUrl: contextResult.context.supabaseUrl,
      serviceKey: contextResult.context.serviceKey,
      bucket: TEMPLATE_STORAGE_BUCKET,
      storagePath,
      body: fileBuffer,
      contentType: mediaType,
      upsert: true,
    });

    const result = await createTemplateImportRecords({
      context: contextResult.context,
      sourceFileId,
      storageBucket: TEMPLATE_STORAGE_BUCKET,
      storagePath,
      fileName,
      fileBytes: fileBuffer.length,
      mediaType,
      kind,
      templateName,
      setAsDefault,
      removeStorageOnFailure: true,
    });

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template import setup failed.";
    return NextResponse.json(
      { error: message },
      { status: isTemplateImportClientError(message) ? 400 : 500 },
    );
  }
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

function isTemplateImportClientError(message: string) {
  return (
    message.includes("too large")
    || message.includes("PPTX, JSON, CSS, or PDF")
    || message.includes("non-empty")
    || message.includes("missing a file name")
  );
}
