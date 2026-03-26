import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { normalizePersistedSourceFileKind } from "@/lib/source-file-kinds";
import { getViewerState } from "@/lib/supabase/auth";
import { resolveOwnedTemplateProfileId } from "@/lib/template-profiles";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Supabase credentials are required." }, { status: 500 });
    }

    const viewer = await getViewerState();
    if (!viewer.user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const workspace = await ensureViewerWorkspace(viewer.user);
    if (!workspace) {
      return NextResponse.json({ error: "Unable to resolve workspace." }, { status: 500 });
    }

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const brief = formData.get("brief") as string ?? "";
    const client = formData.get("client") as string ?? "";
    const audience = formData.get("audience") as string ?? "Executive stakeholder";
    const objective = formData.get("objective") as string ?? "";
    const thesis = formData.get("thesis") as string ?? "";
    const stakes = formData.get("stakes") as string ?? "";
    const templateProfileId = await resolveOwnedTemplateProfileId({
      supabaseUrl,
      serviceKey,
      organizationId: workspace.organizationRowId,
      templateProfileId: formData.get("templateProfileId") as string | null,
    });

    if (files.length === 0) {
      return NextResponse.json({ error: "At least one source file is required." }, { status: 400 });
    }

    const hasWorkbookEvidence = files.some((file) => {
      const kind = normalizePersistedSourceFileKind(null, file.name);
      return kind === "workbook";
    });

    if (!hasWorkbookEvidence) {
      return NextResponse.json(
        {
          error: "Basquio currently needs at least one CSV, XLSX, or XLS file as primary evidence. Use PPTX, PDF, images, and documents only as support material or template input.",
        },
        { status: 400 },
      );
    }

    const runId = randomUUID();

    // Upload source files to storage and create source_file records
    // Detect PPTX template files (user uploads their corporate template alongside data files)
    const sourceFileIds: string[] = [];
    for (const file of files) {
      const fileId = randomUUID();
      const kind = normalizePersistedSourceFileKind(null, file.name);
      const storagePath = `${workspace.organizationId}/${workspace.projectId}/${fileId}/${file.name}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      // Upload to storage
      const uploadResponse = await fetch(
        `${supabaseUrl}/storage/v1/object/source-files/${storagePath}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": file.type || "application/octet-stream",
          },
          body: buffer,
        },
      );

      if (!uploadResponse.ok) {
        return NextResponse.json({ error: `Failed to upload file: ${file.name}` }, { status: 500 });
      }

      // Create source_file record
      const sfResponse = await fetch(
        `${supabaseUrl}/rest/v1/source_files`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            id: fileId,
            organization_id: workspace.organizationRowId,
            project_id: workspace.projectRowId,
            uploaded_by: viewer.user.id,
            kind,
            file_name: file.name,
            storage_bucket: "source-files",
            storage_path: storagePath,
            file_bytes: buffer.length,
          }),
        },
      );

      if (!sfResponse.ok) {
        return NextResponse.json({ error: `Failed to register source file: ${file.name}` }, { status: 500 });
      }

      sourceFileIds.push(fileId);
    }

    // Create deck_run record
    const deckRunResponse = await fetch(
      `${supabaseUrl}/rest/v1/deck_runs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          id: runId,
          organization_id: workspace.organizationRowId,
          project_id: workspace.projectRowId,
          requested_by: viewer.user.id,
          brief: { businessContext: brief, client, audience, objective, thesis, stakes },
          business_context: brief,
          client,
          audience,
          objective,
          thesis,
          stakes,
          source_file_ids: sourceFileIds,
          template_profile_id: templateProfileId,
          status: "queued",
        }),
      },
    );

    if (!deckRunResponse.ok) {
      const errorText = await deckRunResponse.text().catch(() => "Unknown error");
      return NextResponse.json({ error: `Failed to create run record: ${errorText}` }, { status: 500 });
    }

    const attemptId = randomUUID();
    try {
      const attemptResponse = await fetch(
        `${supabaseUrl}/rest/v1/deck_run_attempts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            id: attemptId,
            run_id: runId,
            attempt_number: 1,
            status: "queued",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        },
      );

      if (!attemptResponse.ok) {
        const errorText = await attemptResponse.text().catch(() => "Unknown error");
        throw new Error(`Failed to create attempt record: ${errorText}`);
      }

      const pointerResponse = await fetch(
        `${supabaseUrl}/rest/v1/deck_runs?id=eq.${runId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            active_attempt_id: attemptId,
            latest_attempt_id: attemptId,
            latest_attempt_number: 1,
          }),
        },
      );

      if (!pointerResponse.ok) {
        const errorText = await pointerResponse.text().catch(() => "Unknown error");
        throw new Error(`Failed to attach attempt lineage: ${errorText}`);
      }
    } catch (error) {
      await fetch(
        `${supabaseUrl}/rest/v1/deck_run_attempts?id=eq.${attemptId}`,
        {
          method: "DELETE",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
        },
      ).catch(() => {});
      await fetch(
        `${supabaseUrl}/rest/v1/deck_runs?id=eq.${runId}`,
        {
          method: "DELETE",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
        },
      ).catch(() => {});
      const message = error instanceof Error ? error.message : "Failed to attach attempt lineage.";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json(
      {
        runId,
        status: "queued",
        statusUrl: `/api/v2/runs/${runId}`,
        progressUrl: `/jobs/${runId}`,
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
