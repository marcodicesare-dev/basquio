import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { inferSourceFileKind } from "@basquio/core";

import { uploadToStorage } from "@/lib/supabase/admin";
import { getViewerState } from "@/lib/supabase/auth";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const viewer = await getViewerState();
  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const workspace = await ensureViewerWorkspace(viewer.user);
  if (!workspace) {
    return NextResponse.json({ error: "Unable to resolve workspace." }, { status: 500 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  let fileName: string;
  let fileBuffer: Buffer;
  let mediaType: string;
  let templateName: string | undefined;
  let setAsDefault = false;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Upload a PPTX, JSON, or CSS template file." }, { status: 400 });
    }
    fileName = file.name;
    fileBuffer = Buffer.from(await file.arrayBuffer());
    mediaType = file.type || "application/octet-stream";
    templateName = String(formData.get("name") ?? "") || undefined;
    setAsDefault = formData.get("setAsDefault") === "true";
  } else {
    const body = (await request.json()) as {
      fileName: string;
      base64: string;
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

  const kind = inferSourceFileKind(fileName);
  if (!["pptx", "brand-tokens", "pdf"].includes(kind)) {
    return NextResponse.json({
      error: "Template files must be PPTX, JSON, CSS, or PDF.",
    }, { status: 400 });
  }

  const sourceFileId = randomUUID();
  const templateProfileId = randomUUID();
  const importJobId = randomUUID();
  const storageBucket = "source-files";
  const storagePath = `${workspace.organizationId}/${workspace.projectId}/${sourceFileId}/${fileName}`;
  const createdResources: string[] = []; // track for cleanup

  try {
    // 1. Upload file to storage
    await uploadToStorage({
      supabaseUrl,
      serviceKey,
      bucket: storageBucket,
      storagePath,
      body: fileBuffer,
      contentType: mediaType,
    });
    createdResources.push("storage");

    // 2. Create source_files row
    const sfResponse = await fetch(`${supabaseUrl}/rest/v1/source_files`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id: sourceFileId,
        organization_id: workspace.organizationRowId,
        project_id: workspace.projectRowId,
        uploaded_by: viewer.user.id,
        kind,
        file_name: fileName,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        file_bytes: fileBuffer.length,
      }),
    });
    if (!sfResponse.ok) throw new Error("Failed to create source file record.");
    createdResources.push("source_file");

    // 3. Create placeholder template_profiles row (status = 'processing')
    const tpResponse = await fetch(`${supabaseUrl}/rest/v1/template_profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id: templateProfileId,
        organization_id: workspace.organizationRowId,
        source_file_id: sourceFileId,
        source_type: kind,
        template_profile: {},
        name: templateName ?? fileName.replace(/\.[^.]+$/, ""),
        status: "processing",
        imported_by: viewer.user.id,
      }),
    });
    if (!tpResponse.ok) throw new Error("Failed to create template profile.");
    createdResources.push("template_profile");

    // 4. Create template_import_jobs row (queued for worker)
    const ijResponse = await fetch(`${supabaseUrl}/rest/v1/template_import_jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id: importJobId,
        organization_id: workspace.organizationRowId,
        requested_by: viewer.user.id,
        source_file_id: sourceFileId,
        template_profile_id: templateProfileId,
        status: "queued",
        set_as_default: setAsDefault,
        name: templateName ?? fileName.replace(/\.[^.]+$/, ""),
      }),
    });
    if (!ijResponse.ok) throw new Error("Failed to create import job.");

    return NextResponse.json({
      importJobId,
      templateProfileId,
      status: "queued",
      message: "Template import started. It will be ready in a few seconds.",
    }, { status: 202 });
  } catch (error) {
    // Cleanup on partial failure
    const headers = { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    if (createdResources.includes("template_profile")) {
      await fetch(`${supabaseUrl}/rest/v1/template_profiles?id=eq.${templateProfileId}`, { method: "DELETE", headers }).catch(() => {});
    }
    if (createdResources.includes("source_file")) {
      await fetch(`${supabaseUrl}/rest/v1/source_files?id=eq.${sourceFileId}`, { method: "DELETE", headers }).catch(() => {});
    }
    if (createdResources.includes("storage")) {
      await fetch(`${supabaseUrl}/storage/v1/object/${storageBucket}`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [storagePath] }),
      }).catch(() => {});
    }

    const message = error instanceof Error ? error.message : "Template import setup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
