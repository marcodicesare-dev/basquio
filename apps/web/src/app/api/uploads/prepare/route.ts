import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { inferSourceFileKind } from "@basquio/core";

import { getViewerState } from "@/lib/supabase/auth";
import { buildResumableUploadUrl, createSignedUploadUrl } from "@/lib/supabase/admin";
import { buildOrganizationSlug, DEFAULT_PROJECT_SLUG } from "@/lib/viewer-workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 6 * 1024 * 1024;
const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;

const uploadDescriptorSchema = z.object({
  fileName: z.string().min(1),
  mediaType: z.string().default("application/octet-stream"),
  sizeBytes: z.number().int().nonnegative().default(0),
});

const prepareUploadsRequestSchema = z.object({
  organizationId: z.string().optional(),
  projectId: z.string().optional(),
  evidenceFiles: z.array(uploadDescriptorSchema).min(1),
  brandFile: uploadDescriptorSchema.optional(),
});

type UploadDescriptor = z.infer<typeof uploadDescriptorSchema>;

export async function POST(request: Request) {
  try {
    const viewer = await getViewerState();

    if (!viewer.user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Supabase storage is not configured for hosted uploads." },
        { status: 500 },
      );
    }

    const serviceKeyError = describeServiceKeyError(serviceKey, publishableKey);

    if (serviceKeyError) {
      return NextResponse.json({ error: serviceKeyError }, { status: 500 });
    }

    const payload = prepareUploadsRequestSchema.parse(await request.json());
    const unsupportedEvidenceFile = payload.evidenceFiles.find((file) => inferSourceFileKind(file.fileName) === "unknown");

    if (unsupportedEvidenceFile) {
      return NextResponse.json(
        {
          error: `Unsupported file type for ${unsupportedEvidenceFile.fileName}. Basquio accepts CSV, XLSX, PPTX, PDF, images, text, and document files.`,
        },
        { status: 400 },
      );
    }

    if (payload.brandFile) {
      const brandKind = inferSourceFileKind(payload.brandFile.fileName);

      if (!["brand-tokens", "pptx", "pdf"].includes(brandKind)) {
        return NextResponse.json(
          { error: "Brand input must be a JSON/CSS token file, a PPTX template, or a PDF style reference." },
          { status: 400 },
        );
      }
    }

    const jobId = createJobId();
    const evidenceUploads = await Promise.all(
      payload.evidenceFiles.map((file, index) =>
        createPreparedUpload({
          supabaseUrl,
          serviceKey,
          bucket: "source-files",
          externalId: `${jobId}-upload-${index + 1}`,
          file,
          jobId,
          order: index + 1,
        }),
      ),
    );

    const brandUpload = payload.brandFile
      ? await createPreparedUpload({
          supabaseUrl,
          serviceKey,
          bucket: "templates",
          externalId: `${jobId}-style`,
          file: payload.brandFile,
          jobId,
          order: payload.evidenceFiles.length + 1,
          prefix: "style",
        })
      : null;

    return NextResponse.json({
      jobId,
      organizationId: buildOrganizationSlug(viewer.user.id),
      projectId: DEFAULT_PROJECT_SLUG,
      evidenceUploads,
      brandUpload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare uploads.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function createPreparedUpload(input: {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  externalId: string;
  file: UploadDescriptor;
  jobId: string;
  order: number;
  prefix?: string;
}) {
  const storagePath = `jobs/${input.jobId}/inputs/${formatUploadLabel(input.order, input.prefix, input.file.fileName)}`;
  let signedUpload;

  try {
    signedUpload = await createSignedUploadUrl({
      supabaseUrl: input.supabaseUrl,
      serviceKey: input.serviceKey,
      bucket: input.bucket,
      storagePath,
      upsert: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to prepare ${input.bucket}/${storagePath} for ${input.file.fileName}: ${message}`);
  }

  const kind = inferSourceFileKind(input.file.fileName);
  const uploadMode =
    input.file.sizeBytes >= RESUMABLE_UPLOAD_THRESHOLD_BYTES ? "resumable" : "standard";

  return {
    id: input.externalId,
    fileName: input.file.fileName,
    mediaType: input.file.mediaType || "application/octet-stream",
    kind,
    storageBucket: input.bucket,
    storagePath,
    fileBytes: input.file.sizeBytes,
    uploadMode,
    signedUrl: signedUpload.signedUrl,
    resumableUrl: uploadMode === "resumable" ? buildResumableUploadUrl(input.supabaseUrl) : undefined,
    chunkSizeBytes: uploadMode === "resumable" ? RESUMABLE_CHUNK_BYTES : undefined,
    token: signedUpload.token,
  };
}

function createJobId() {
  return `job-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function formatUploadLabel(order: number, prefix = "evidence", fileName: string) {
  return `${prefix}-${String(order).padStart(2, "0")}-${sanitizeStorageSegment(fileName)}`;
}

function sanitizeStorageSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function describeServiceKeyError(serviceKey: string, publishableKey?: string) {
  if (serviceKey === publishableKey || serviceKey.startsWith("sb_publishable_")) {
    return "SUPABASE_SERVICE_ROLE_KEY is set to a publishable/anon key. Basquio signed uploads require the server-side service-role JWT or sb_secret key, not the public API key.";
  }

  if (!serviceKey.startsWith("sb_secret_") && serviceKey.split(".").length !== 3) {
    return "SUPABASE_SERVICE_ROLE_KEY is not a valid Supabase service key. Use the service-role JWT or the sb_secret server key.";
  }

  return null;
}
