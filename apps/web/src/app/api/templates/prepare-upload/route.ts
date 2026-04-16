import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createSignedUploadUrl } from "@/lib/supabase/admin";
import {
  buildTemplateStoragePath,
  resolveTemplateImportContext,
  TEMPLATE_STORAGE_BUCKET,
  validateTemplateUploadDescriptor,
} from "@/lib/templates/import-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
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
    validateTemplateUploadDescriptor(payload.fileName, payload.fileSize);

    const sourceFileId = randomUUID();
    const storagePath = buildTemplateStoragePath(
      contextResult.context.workspace,
      sourceFileId,
      payload.fileName,
    );

    const signedUpload = await createSignedUploadUrl({
      supabaseUrl: contextResult.context.supabaseUrl,
      serviceKey: contextResult.context.serviceKey,
      bucket: TEMPLATE_STORAGE_BUCKET,
      storagePath,
      upsert: true,
    });

    return NextResponse.json({
      sourceFileId,
      storageBucket: TEMPLATE_STORAGE_BUCKET,
      storagePath,
      uploadUrl: signedUpload.signedUrl,
      expiresAt: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare the template upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
