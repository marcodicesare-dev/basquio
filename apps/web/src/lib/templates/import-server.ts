import { randomUUID } from "node:crypto";

import { inferSourceFileKind } from "@basquio/core";

import { deleteRestRows, getStorageObjectInfo, removeStorageObjects } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { ensureViewerWorkspace, type ViewerWorkspace } from "@/lib/viewer-workspace";

export const TEMPLATE_STORAGE_BUCKET = "source-files";
export const MAX_TEMPLATE_UPLOAD_BYTES = 50 * 1024 * 1024;
export const LEGACY_TEMPLATE_IMPORT_MAX_BYTES = 4 * 1024 * 1024;

export type TemplateImportContext = {
  serviceKey: string;
  supabaseUrl: string;
  viewer: NonNullable<Awaited<ReturnType<typeof getViewerState>>["user"]>;
  workspace: ViewerWorkspace;
};

export type CreateTemplateImportRecordsInput = {
  context: TemplateImportContext;
  fileBytes: number;
  fileName: string;
  kind: "pptx" | "brand-tokens" | "pdf";
  mediaType: string;
  removeStorageOnFailure?: boolean;
  setAsDefault: boolean;
  sourceFileId: string;
  storageBucket?: string;
  storagePath: string;
  templateName?: string;
};

export async function resolveTemplateImportContext() {
  const viewer = await getViewerState();

  if (!viewer.user) {
    return { error: "Authentication required.", status: 401 } as const;
  }

  const workspace = await ensureViewerWorkspace(viewer.user);
  if (!workspace) {
    return { error: "Unable to resolve workspace.", status: 500 } as const;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { error: "Server configuration error.", status: 500 } as const;
  }

  return {
    context: {
      viewer: viewer.user,
      workspace,
      supabaseUrl,
      serviceKey,
    },
  } as const;
}

export function validateTemplateUploadDescriptor(fileName: string, fileBytes: number) {
  if (!fileName) {
    throw new Error("Template upload is missing a file name.");
  }

  if (!Number.isFinite(fileBytes) || fileBytes <= 0) {
    throw new Error("Upload a non-empty PPTX, JSON, CSS, or PDF template file.");
  }

  if (fileBytes > MAX_TEMPLATE_UPLOAD_BYTES) {
    throw new Error(`This file is too large (${formatBytes(fileBytes)}). Templates must be under 50 MB.`);
  }

  const kind = inferSourceFileKind(fileName);
  if (!["pptx", "brand-tokens", "pdf"].includes(kind)) {
    throw new Error("Template files must be PPTX, JSON, CSS, or PDF.");
  }

  return kind as "pptx" | "brand-tokens" | "pdf";
}

export function buildTemplateStoragePath(
  workspace: ViewerWorkspace,
  sourceFileId: string,
  fileName: string,
) {
  return `${workspace.organizationId}/${workspace.projectId}/${sourceFileId}/${fileName}`;
}

export async function assertUploadedTemplateExists(input: {
  context: TemplateImportContext;
  storageBucket?: string;
  storagePath: string;
}) {
  return getStorageObjectInfo({
    supabaseUrl: input.context.supabaseUrl,
    serviceKey: input.context.serviceKey,
    bucket: input.storageBucket ?? TEMPLATE_STORAGE_BUCKET,
    storagePath: input.storagePath,
  });
}

export async function createTemplateImportRecords(input: CreateTemplateImportRecordsInput) {
  const storageBucket = input.storageBucket ?? TEMPLATE_STORAGE_BUCKET;
  const templateProfileId = randomUUID();
  const importJobId = randomUUID();
  const createdResources: Array<"source_file" | "template_profile" | "template_import_job"> = [];

  try {
    await insertRow({
      supabaseUrl: input.context.supabaseUrl,
      serviceKey: input.context.serviceKey,
      table: "source_files",
      payload: {
        id: input.sourceFileId,
        organization_id: input.context.workspace.organizationRowId,
        project_id: input.context.workspace.projectRowId,
        uploaded_by: input.context.viewer.id,
        kind: input.kind,
        file_name: input.fileName,
        media_type: input.mediaType,
        storage_bucket: storageBucket,
        storage_path: input.storagePath,
        file_bytes: input.fileBytes,
      },
    });
    createdResources.push("source_file");

    await insertRow({
      supabaseUrl: input.context.supabaseUrl,
      serviceKey: input.context.serviceKey,
      table: "template_profiles",
      payload: {
        id: templateProfileId,
        organization_id: input.context.workspace.organizationRowId,
        source_file_id: input.sourceFileId,
        source_type: input.kind,
        template_profile: {},
        name: input.templateName ?? stripFileExtension(input.fileName),
        status: "processing",
        imported_by: input.context.viewer.id,
      },
    });
    createdResources.push("template_profile");

    await insertRow({
      supabaseUrl: input.context.supabaseUrl,
      serviceKey: input.context.serviceKey,
      table: "template_import_jobs",
      payload: {
        id: importJobId,
        organization_id: input.context.workspace.organizationRowId,
        requested_by: input.context.viewer.id,
        source_file_id: input.sourceFileId,
        template_profile_id: templateProfileId,
        status: "queued",
        set_as_default: input.setAsDefault,
        name: input.templateName ?? stripFileExtension(input.fileName),
      },
    });
    createdResources.push("template_import_job");

    return {
      importJobId,
      templateProfileId,
      status: "queued" as const,
      message: "Template import started. It will be ready in a few seconds.",
    };
  } catch (error) {
    await cleanupTemplateImportFailure({
      context: input.context,
      createdResources,
      removeStorageOnFailure: input.removeStorageOnFailure ?? false,
      sourceFileId: input.sourceFileId,
      storageBucket,
      storagePath: input.storagePath,
      templateProfileId,
      importJobId,
    });

    throw error;
  }
}

async function cleanupTemplateImportFailure(input: {
  context: TemplateImportContext;
  createdResources: Array<"source_file" | "template_profile" | "template_import_job">;
  importJobId: string;
  removeStorageOnFailure: boolean;
  sourceFileId: string;
  storageBucket: string;
  storagePath: string;
  templateProfileId: string;
}) {
  if (input.createdResources.includes("template_import_job")) {
    await deleteRestRows({
      supabaseUrl: input.context.supabaseUrl,
      serviceKey: input.context.serviceKey,
      table: "template_import_jobs",
      query: { id: `eq.${input.importJobId}` },
    }).catch(() => {});
  }

  if (input.createdResources.includes("template_profile")) {
    await deleteRestRows({
      supabaseUrl: input.context.supabaseUrl,
      serviceKey: input.context.serviceKey,
      table: "template_profiles",
      query: { id: `eq.${input.templateProfileId}` },
    }).catch(() => {});
  }

  if (input.createdResources.includes("source_file")) {
    await deleteRestRows({
      supabaseUrl: input.context.supabaseUrl,
      serviceKey: input.context.serviceKey,
      table: "source_files",
      query: { id: `eq.${input.sourceFileId}` },
    }).catch(() => {});
  }

  if (input.removeStorageOnFailure) {
    await removeStorageObjects({
      supabaseUrl: input.context.supabaseUrl,
      serviceKey: input.context.serviceKey,
      bucket: input.storageBucket,
      paths: [input.storagePath],
    }).catch(() => {});
  }
}

async function insertRow(input: {
  payload: Record<string, unknown>;
  serviceKey: string;
  supabaseUrl: string;
  table: string;
}) {
  const response = await fetch(`${input.supabaseUrl}/rest/v1/${input.table}`, {
    method: "POST",
    headers: buildRestHeaders(input.serviceKey),
    body: JSON.stringify(input.payload),
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? readJsonError(await response.json())
      : (await response.text()).trim();
    throw new Error(body || `Failed to create ${input.table} row.`);
  }
}

function buildRestHeaders(serviceKey: string) {
  const headers = new Headers({
    "Content-Type": "application/json",
    apikey: serviceKey,
    Prefer: "return=minimal",
  });

  if (serviceKey.split(".").length === 3 && !serviceKey.startsWith("sb_secret_")) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }

  return headers;
}

function readJsonError(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const typedPayload = payload as { error?: string; message?: string };
  return typedPayload.message ?? typedPayload.error ?? "";
}

function stripFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
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
