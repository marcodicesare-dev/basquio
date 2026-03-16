import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { parseEvidencePackage, streamParseFile, checksumSha256, loadRowsFromBlob, type SheetManifest } from "@basquio/data-ingest";
import { runAnalystAgent, runAuthorAgent, runCriticAgent } from "@basquio/intelligence";
import { renderPdfArtifact } from "@basquio/render-pdf";
import { renderPptxArtifact } from "@basquio/render-pptx";
import { renderV2PptxArtifact, type V2ChartRow } from "@basquio/render-pptx/v2";
import { interpretTemplateSource } from "@basquio/template-engine";
import type {
  AnalysisReport,
  ChartSpec,
  CritiqueReport,
  DeckRunPhase,
  DeckSpecV2,
  EvidenceWorkspace,
  SlideSpec,
  TemplateProfile,
} from "@basquio/types";

import {
  downloadFromStorage,
  uploadToStorage,
} from "./supabase";

import { UsageTracker, checkCostBudget, logPhaseEvent } from "./observability";

// ─── SHARED CALLBACK TYPES ───────────────────────────────────────

type NotebookEntry = {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: Record<string, unknown>;
  evidenceRefId?: string;
};

type StepFinishEvent = {
  stepNumber: number;
  toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
  finishReason: string;
};

type SlideInput = {
  position: number;
  layoutId: string;
  title: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  chartId?: string;
  metrics?: { label: string; value: string; delta?: string }[];
  evidenceIds: string[];
  speakerNotes?: string;
  transition?: string;
};

type ChartInput = {
  chartType: string;
  title: string;
  data: Record<string, unknown>[];
  xAxis?: string;
  yAxis?: string;
  series?: string[];
  style?: { colors?: string[]; showLegend?: boolean; showValues?: boolean };
};

// Use the shared Inngest client (avoids circular import with ./index)
import { inngest } from "./inngest-client";

// ─── TEXT HELPERS ────────────────────────────────────────────────

// Fix literal \n sequences from LLM output into actual newlines
function cleanNewlines(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\\\n/g, "\n");
}

// ─── PERSISTENCE HELPERS ──────────────────────────────────────────

// Validate UUID to prevent PostgREST operator injection
function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid UUID for ${label}: ${value}`);
  }
}

async function updateRunStatus(runId: string, status: string, phase?: DeckRunPhase, extra?: Record<string, unknown>) {
  assertUuid(runId, "runId");
  const body: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
    ...extra,
  };
  if (phase) {
    body.current_phase = phase;
    body.phase_started_at = new Date().toISOString();
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_runs?id=eq.${runId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to update run ${runId}: ${response.statusText}`);
  }
}

async function emitRunEvent(
  runId: string,
  phase: DeckRunPhase,
  eventType: string,
  payload: Record<string, unknown> = {},
) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_run_events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        run_id: runId,
        phase,
        event_type: eventType,
        payload,
      }),
    },
  );

  if (!response.ok) {
    console.error(`Failed to emit event for run ${runId}: ${response.statusText}`);
  }
}

async function persistNotebookEntry(
  runId: string,
  phase: DeckRunPhase,
  stepNumber: number,
  entry: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolOutput: Record<string, unknown>;
    evidenceRefId?: string;
  },
): Promise<string> {
  const id = crypto.randomUUID();

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/analysis_notebook_entries`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id,
        run_id: runId,
        phase,
        step_number: stepNumber,
        tool_name: entry.toolName,
        tool_input: entry.toolInput,
        tool_output: entry.toolOutput,
        evidence_ref_id: entry.evidenceRefId,
      }),
    },
  );

  if (!response.ok) {
    console.error(`Failed to persist notebook entry: ${response.statusText}`);
  }

  return id;
}

async function deleteRunSlides(runId: string) {
  assertUuid(runId, "runId");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_slides?run_id=eq.${runId}`,
    {
      method: "DELETE",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=minimal",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to delete slides for run ${runId}: ${response.statusText}`);
  }
}

async function deleteRunCharts(runId: string) {
  assertUuid(runId, "runId");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_charts?run_id=eq.${runId}`,
    {
      method: "DELETE",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=minimal",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to delete charts for run ${runId}: ${response.statusText}`);
  }
}

async function persistSlide(runId: string, slide: {
  position: number;
  layoutId: string;
  title: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  chartId?: string;
  metrics?: { label: string; value: string; delta?: string }[];
  evidenceIds: string[];
  speakerNotes?: string;
  transition?: string;
}) {
  const id = crypto.randomUUID();

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_slides`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id,
        run_id: runId,
        position: slide.position,
        layout_id: slide.layoutId,
        title: cleanNewlines(slide.title),
        subtitle: slide.subtitle ? cleanNewlines(slide.subtitle) : undefined,
        body: slide.body ? cleanNewlines(slide.body) : undefined,
        bullets: slide.bullets?.map(cleanNewlines),
        chart_id: slide.chartId,
        metrics: slide.metrics,
        evidence_ids: slide.evidenceIds,
        speaker_notes: slide.speakerNotes ? cleanNewlines(slide.speakerNotes) : undefined,
        transition: slide.transition,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to persist slide ${id} for run ${runId}: ${response.statusText}`);
  }

  return { slideId: id, previewUrl: undefined, warnings: [] };
}

async function persistChart(runId: string, chart: {
  chartType: string;
  title: string;
  data: Record<string, unknown>[];
  xAxis?: string;
  yAxis?: string;
  series?: string[];
  style?: { colors?: string[]; showLegend?: boolean; showValues?: boolean; highlightCategories?: string[] };
}) {
  const id = crypto.randomUUID();

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_charts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id,
        run_id: runId,
        chart_type: chart.chartType,
        title: chart.title,
        data: chart.data,
        x_axis: chart.xAxis,
        y_axis: chart.yAxis,
        series: chart.series,
        style: chart.style,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to persist chart ${id} for run ${runId}: ${response.statusText}`);
  }

  return { chartId: id, thumbnailUrl: undefined, width: 800, height: 500 };
}

type SlideRow = {
  id: string;
  position: number;
  layoutId: string;
  title: string;
  subtitle: string | undefined;
  body: string | undefined;
  bullets: string[] | undefined;
  chartId: string | undefined;
  evidenceIds: string[];
  metrics: { label: string; value: string; delta?: string }[] | undefined;
  speakerNotes: string | undefined;
  transition: string | undefined;
};

async function getSlides(runId: string): Promise<SlideRow[]> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_slides?run_id=eq.${runId}&order=position`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );

  if (!response.ok) return [];

  const rows = await response.json();
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    position: r.position as number,
    layoutId: (r.layout_id as string) ?? "summary",
    title: r.title as string,
    subtitle: r.subtitle as string | undefined,
    body: r.body as string | undefined,
    bullets: r.bullets as string[] | undefined,
    chartId: r.chart_id as string | undefined,
    evidenceIds: (r.evidence_ids ?? []) as string[],
    metrics: r.metrics as { label: string; value: string; delta?: string }[] | undefined,
    speakerNotes: r.speaker_notes as string | undefined,
    transition: r.transition as string | undefined,
  }));
}

async function getCharts(runId: string): Promise<ChartSpec[]> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_charts?run_id=eq.${runId}`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );

  if (!response.ok) return [];

  const rows = await response.json();
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    title: (r.title as string) ?? "",
    family: (r.chart_type as ChartSpec["family"]) ?? "bar",
    editableInPptx: false,
    categories: [],
    series: ((r.series as string[]) ?? []).map((name: string) => ({
      name,
      dataKey: "value",
      values: [],
    })),
    xAxis: r.x_axis as string | undefined,
    yAxis: r.y_axis as string | undefined,
    data: (r.data as Record<string, unknown>[]) ?? [],
    style: r.style as Record<string, unknown> | undefined,
  })) as ChartSpec[];
}

async function getV2ChartRows(runId: string): Promise<V2ChartRow[]> {
  assertUuid(runId, "runId");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_charts?run_id=eq.${runId}`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );

  if (!response.ok) return [];

  const rows = await response.json();
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    chartType: (r.chart_type as string) ?? "bar",
    title: (r.title as string) ?? "",
    data: (r.data as Record<string, unknown>[]) ?? [],
    xAxis: (r.x_axis as string) ?? "",
    yAxis: (r.y_axis as string) ?? "",
    series: (r.series as string[]) ?? [],
    style: {
      colors: (r.style as Record<string, unknown> | null)?.colors as string[] | undefined,
      showLegend: (r.style as Record<string, unknown> | null)?.showLegend as boolean | undefined,
      showValues: (r.style as Record<string, unknown> | null)?.showValues as boolean | undefined,
    },
  }));
}

async function getNotebookEntry(evidenceRefId: string) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/analysis_notebook_entries?evidence_ref_id=eq.${evidenceRefId}&limit=1`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );

  if (!response.ok) return null;

  const rows = await response.json();
  if (rows.length === 0) return null;

  return {
    toolName: rows[0].tool_name as string,
    toolOutput: rows[0].tool_output as Record<string, unknown>,
  };
}

// ─── MAIN ORCHESTRATION FUNCTION ──────────────────────────────────

export const basquioV2Generation = inngest.createFunction(
  { id: "basquio-v2-generation", retries: 2 },
  { event: "basquio/v2.generation.requested" },
  async ({ event, step }) => {
    const {
      runId,
      organizationId,
      projectId,
      sourceFileIds,
      brief,
      templateProfileId,
    } = event.data as {
      runId: string;
      organizationId: string;
      projectId: string;
      sourceFileIds: string[];
      brief: string;
      templateProfileId?: string;
    };

    const tracker = new UsageTracker();

    try {
    // ─── STEP 1: NORMALIZE (deterministic) ──────────────────────
    const workspace = await step.run("normalize", async () => {
      await updateRunStatus(runId, "running", "normalize");
      await emitRunEvent(runId, "normalize", "phase_started");

      // Download source files
      const filesResponse = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/source_files?id=in.(${sourceFileIds.join(",")})`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
        },
      );

      const sourceFiles = (await filesResponse.json()) as Array<{
        id: string;
        file_name: string;
        kind: string;
        storage_bucket: string;
        storage_path: string;
      }>;

      // Parse evidence package
      const fileBuffers = await Promise.all(
        sourceFiles.map(async (f) => ({
          id: f.id,
          fileName: f.file_name,
          kind: f.kind,
          buffer: await downloadFromStorage({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
            serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            bucket: f.storage_bucket,
            storagePath: f.storage_path,
          }),
        })),
      );

      // ── Stream-parse workbook files → jsonl.gz blobs + manifests ──
      const workbookFiles = fileBuffers.filter((f) => f.kind === "workbook");
      const supportFiles = fileBuffers.filter((f) => f.kind !== "workbook");

      const allSheetManifests: SheetManifest[] = [];
      const fileRoles: Record<string, string> = {};

      for (const f of workbookFiles) {
        const result = await streamParseFile({
          id: f.id,
          fileName: f.fileName,
          buffer: f.buffer,
          kind: f.kind,
        });
        fileRoles[f.id] = result.role;
        allSheetManifests.push(...result.sheets);
      }

      // Parse support files for text extraction only (legacy path, bounded)
      let supportParsed: Awaited<ReturnType<typeof parseEvidencePackage>> | undefined;
      if (supportFiles.length > 0) {
        supportParsed = await parseEvidencePackage({
          datasetId: runId,
          files: supportFiles.map((f) => ({
            id: f.id,
            fileName: f.fileName,
            buffer: f.buffer,
            kind: f.kind as "workbook" | "pptx" | "pdf" | "unknown",
          })),
        });
      }

      // Build file inventory from both paths
      const fileInventory = fileBuffers.map((f) => {
        const sheetsForFile = allSheetManifests.filter((s) => s.sourceFileId === f.id);
        const supportFile = supportParsed?.normalizedWorkbook.files.find(
          (pf: { fileName: string }) => pf.fileName === f.fileName,
        );
        return {
          id: f.id,
          fileName: f.fileName,
          kind: f.kind,
          role: fileRoles[f.id] ?? supportFile?.role ?? "unknown-support",
          mediaType: "application/octet-stream",
          sheets: sheetsForFile.map((s) => ({
            name: s.sheetName,
            rowCount: s.rowCount,
            columnCount: s.columnCount,
            columns: s.columns.map((c) => ({ ...c })),
          })),
          textContent: supportFile?.textContent,
          warnings: supportFile?.warnings ?? [],
        };
      });

      // Parse template
      let templateProfile: TemplateProfile | undefined;
      if (templateProfileId) {
        const tpResponse = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/template_profiles?id=eq.${templateProfileId}&limit=1`,
          {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            },
          },
        );
        const tpRows = await tpResponse.json();
        if (tpRows.length > 0) {
          templateProfile = tpRows[0].template_profile as TemplateProfile;
        }
      }
      if (!templateProfile) {
        templateProfile = await interpretTemplateSource({ id: "system-default" });
      }

      // Persist evidence workspace (no sheet_data — data lives in Storage blobs)
      // Use runId as workspaceId for 1:1 relationship + idempotent retries
      const workspaceId = runId;
      const blobManifest: Record<string, { bytes: number; checksum: string; sheetKey: string }> = {};

      const wsInsertResponse = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspaces`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            Prefer: "return=minimal,resolution=merge-duplicates",
          },
          body: JSON.stringify({
            id: workspaceId,
            run_id: runId,
            file_inventory: fileInventory,
            dataset_profile: supportParsed?.datasetProfile ?? {},
            template_profile: templateProfile,
            sheet_data: {},
            normalization_version: "v2",
            blob_manifest: {},
          }),
        },
      );

      if (!wsInsertResponse.ok) {
        const errorText = await wsInsertResponse.text().catch(() => "Unknown error");
        throw new Error(`Failed to create evidence workspace: ${errorText}`);
      }

      // Upload blobs to Storage + persist sheet manifests
      for (const manifest of allSheetManifests) {
        const blobPath = `runs/${runId}/sheets/${manifest.sheetKey.replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonl.gz`;
        const checksum = checksumSha256(manifest.blobBuffer);

        const uploadResp = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/evidence-workspace-blobs/${blobPath}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
              "Content-Type": "application/gzip",
              "x-upsert": "true", // overwrite on retry
            },
            body: new Uint8Array(manifest.blobBuffer),
          },
        );
        if (!uploadResp.ok) {
          throw new Error(`Blob upload failed for ${manifest.sheetKey}: ${await uploadResp.text().catch(() => "unknown")}`);
        }

        blobManifest[blobPath] = { bytes: manifest.blobBuffer.length, checksum, sheetKey: manifest.sheetKey };

        const sheetResp = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspace_sheets`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
              Prefer: "return=minimal,resolution=merge-duplicates",
            },
            body: JSON.stringify({
              workspace_id: workspaceId,
              run_id: runId,
              source_file_id: manifest.sourceFileId,
              sheet_key: manifest.sheetKey,
              sheet_name: manifest.sheetName,
              source_file_name: manifest.sourceFileName,
              source_role: manifest.sourceRole,
              row_count: manifest.rowCount,
              column_count: manifest.columnCount,
              columns: manifest.columns,
              sample_rows: manifest.sampleRows,
              column_profile: manifest.columnProfile,
              blob_bucket: "evidence-workspace-blobs",
              blob_path: blobPath,
              blob_bytes: manifest.blobBuffer.length,
              checksum_sha256: checksum,
            }),
          },
        );
        if (!sheetResp.ok) {
          throw new Error(`Sheet manifest persist failed for ${manifest.sheetKey}: ${await sheetResp.text().catch(() => "unknown")}`);
        }
      }

      // Update blob_manifest on workspace
      if (Object.keys(blobManifest).length > 0) {
        await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspaces?id=eq.${workspaceId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            },
            body: JSON.stringify({ blob_manifest: blobManifest }),
          },
        );
      }

      await emitRunEvent(runId, "normalize", "phase_completed", {
        fileCount: fileInventory.length,
        sheetCount: allSheetManifests.length,
      });

      // Return slim reference only — no sheetData, no blobs.
      const emptyDatasetProfile = {
        datasetId: runId,
        sourceFileName: fileBuffers[0]?.fileName ?? "evidence-package",
        sourceFiles: [],
        sheets: [],
        warnings: [],
      };

      return {
        id: workspaceId,
        runId,
        fileInventory: fileInventory as EvidenceWorkspace["fileInventory"],
        datasetProfile: supportParsed?.datasetProfile ?? emptyDatasetProfile,
        templateProfile,
        sheetData: {} as Record<string, Array<Record<string, unknown>>>,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as EvidenceWorkspace;
    }) as EvidenceWorkspace;

    // ── Lazy row loader: fetches from Storage blobs on demand ──
    // Replaces loadHydratedWorkspace() — loads only the sheets requested,
    // not the entire workspace's row data.
    async function loadSheetRows(sheetKey: string): Promise<Record<string, unknown>[]> {
      const sheetResp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspace_sheets?run_id=eq.${runId}&sheet_key=eq.${encodeURIComponent(sheetKey)}&select=blob_bucket,blob_path,sample_rows&limit=1`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
        },
      );
      const sheets = (await sheetResp.json()) as Array<{ blob_bucket: string; blob_path: string; sample_rows: Record<string, unknown>[] }>;
      if (sheets.length === 0) return [];

      const { blob_bucket, blob_path } = sheets[0];
      const blobResp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${blob_bucket}/${blob_path}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
        },
      );

      if (!blobResp.ok) {
        // Fallback to sample_rows with warning — metrics may be inaccurate
        const sampleRows = sheets[0].sample_rows ?? [];
        console.warn(`[loadSheetRows] Blob download failed for ${sheetKey}, falling back to ${sampleRows.length} sample rows`);
        // Inject a warning marker so tools can surface this to the model
        if (sampleRows.length > 0) {
          (sampleRows as unknown as Record<string, unknown>[]).push({
            __basquio_warning: `PARTIAL DATA: Only ${sampleRows.length} sample rows available. Full dataset blob download failed. Metrics may be inaccurate.`,
          });
        }
        return sampleRows;
      }

      const blobBuffer = Buffer.from(await blobResp.arrayBuffer());
      return loadRowsFromBlob(blobBuffer);
    }

    // Build a hydrated workspace with lazy sheetData loading
    async function loadHydratedWorkspace(): Promise<EvidenceWorkspace> {
      // Load all sheet manifests for this run
      const sheetsResp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspace_sheets?run_id=eq.${runId}&select=sheet_key,blob_bucket,blob_path,sample_rows`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
        },
      );
      const sheetManifests = (await sheetsResp.json()) as Array<{ sheet_key: string; blob_bucket: string; blob_path: string; sample_rows: Record<string, unknown>[] }>;

      // Load all sheet data from blobs
      const sheetData: Record<string, Array<Record<string, unknown>>> = {};
      for (const s of sheetManifests) {
        try {
          sheetData[s.sheet_key] = await loadSheetRows(s.sheet_key);
        } catch {
          // Fallback to samples
          sheetData[s.sheet_key] = s.sample_rows ?? [];
        }
      }

      return { ...workspace, sheetData };
    }

    // ─── STEP 2: UNDERSTAND (agentic) ───────────────────────────
    const analysis = await step.run("understand", async () => {
      await updateRunStatus(runId, "running", "understand");
      await emitRunEvent(runId, "understand", "phase_started");

      tracker.startPhase("understand", "gpt-5.4", "openai");

      const result = await runAnalystAgent({
        workspace,
        runId,
        brief,
        loadRows: loadSheetRows,
        persistNotebookEntry: async (entry: NotebookEntry) => {
          return persistNotebookEntry(runId, "understand", Date.now(), entry);
        },
        onStepFinish: async (event: StepFinishEvent) => {
          tracker.recordStep(event.usage, event.toolCalls.length);
          await emitRunEvent(runId, "understand", "tool_call", {
            stepNumber: event.stepNumber,
            tools: event.toolCalls.map((tc: { toolName: string }) => tc.toolName),
            usage: event.usage,
          });
        },
      });

      tracker.endPhase();

      await emitRunEvent(runId, "understand", "phase_completed", {
        metricsComputed: result.metricsComputed,
        findingsCount: result.topFindings.length,
      });

      return result;
    });

    // ─── STEP 2.5: PLAN DECK (model-driven) ────────────────────
    type DeckPlanSlide = { position: number; role: string; layout: string; title: string; chartType: string; requiredContent: string[] };
    const deckPlan = await step.run("plan-deck", async () => {
      await emitRunEvent(runId, "author", "plan_started");

      // Determine slide count from brief or default
      const requestedSlideMatch = brief.match(/(\d+)\s*slide/i);
      const requestedSlides = requestedSlideMatch ? parseInt(requestedSlideMatch[1], 10) : undefined;
      const targetSlides = requestedSlides ?? Math.min(Math.max(8, analysis.topFindings.length + 4), 20);

      const findingsSummary = analysis.topFindings
        .map((f, i) => `${i + 1}. ${f.title}: ${f.claim} (confidence: ${f.confidence})`)
        .join("\n");

      // Schema for model-driven deck plan — all fields required for OpenAI strict mode
      const deckPlanSchema = z.object({
        slides: z.array(z.object({
          position: z.number(),
          role: z.string(),
          layout: z.string(),
          title: z.string(),
          chartType: z.string(),
          requiredContent: z.array(z.string()),
        })),
      });

      const planResult = await generateText({
        model: openai("gpt-5.4"),
        output: Output.object({ schema: deckPlanSchema }),
        prompt: `You are a senior strategy deck architect. Plan a ${targetSlides}-slide executive presentation.

BRIEF:
${brief}

ANALYSIS DOMAIN: ${analysis.domain}
ANALYSIS SUMMARY: ${analysis.summary}

KEY FINDINGS:
${findingsSummary}

AVAILABLE LAYOUTS: cover, exec-summary (metrics), title-chart, chart-split, title-body, title-bullets, evidence-grid, table, summary

CHART TYPES: bar (horizontal sorted for rankings), line (trends), pie (composition, max 5 slices), scatter (correlations), waterfall (bridges), stacked_bar (part-to-whole), table (exact numbers)

RULES:
1. First slide MUST be "cover" layout
2. If >5 slides, slide 2 should be exec-summary with 3-4 KPI metrics
3. Evidence slides use title-chart or chart-split — pick chart type based on the analytical story
4. Last slide should be "summary" layout
5. Use at least 3 different layouts — no layout >50% of slides
6. Every title must be an action title (full sentence stating the takeaway, with a number)
7. Exactly ${targetSlides} slides

Return the deck plan.`,
      });

      if (!planResult.output) {
        // Fallback: deterministic plan if model fails
        const fallbackPlan = Array.from({ length: targetSlides }, (_, i) => ({
          position: i + 1,
          role: i === 0 ? "cover" : i === 1 ? "exec-summary" : i === targetSlides - 1 ? "summary" : "evidence",
          layout: i === 0 ? "cover" : i === 1 ? "metrics" : i === targetSlides - 1 ? "summary" : i % 2 === 0 ? "title-chart" : "chart-split",
          title: i === 0 ? `${analysis.domain} Analysis` : analysis.topFindings[i - 2]?.claim ?? `Slide ${i + 1}`,
          chartType: "bar",
          requiredContent: i === 0 ? ["title"] : ["chart", "body", "evidenceIds"],
        }));
        return { targetSlides, requestedSlides, slideCount: fallbackPlan.length, plan: fallbackPlan as DeckPlanSlide[] };
      }

      return {
        targetSlides,
        requestedSlides,
        slideCount: planResult.output.slides.length,
        plan: planResult.output.slides as DeckPlanSlide[],
      };
    }) as { targetSlides: number; requestedSlides?: number; slideCount: number; plan: DeckPlanSlide[] };

    // ─── STEP 3: AUTHOR (agentic) ──────────────────────────────
    let deckSummary = await step.run("author", async () => {
      await updateRunStatus(runId, "running", "author");
      await emitRunEvent(runId, "author", "phase_started");

      tracker.startPhase("author", "claude-opus-4-6", "anthropic");

      const result = await runAuthorAgent({
        workspace,
        runId,
        analysis,
        brief: `${brief}\n\nDECK PLAN (AI-planned based on the analysis — follow this structure):\nTarget: ${deckPlan.targetSlides} slides\n${deckPlan.plan.map((s) => `Slide ${s.position}: [${s.role}] ${s.layout} — "${s.title}" (chart: ${s.chartType}, requires: ${s.requiredContent.join(", ")})`).join("\n")}\n\nIMPORTANT: This plan was designed by a deck architect model. Follow the slide sequence, layouts, and chart types. You may refine titles and add content, but respect the plan's narrative arc and slide count.`,
        loadRows: loadSheetRows,
        persistNotebookEntry: async (entry: NotebookEntry) => {
          return persistNotebookEntry(runId, "author", Date.now(), entry);
        },
        persistSlide: async (slide: SlideInput) => persistSlide(runId, slide),
        persistChart: async (chart: ChartInput) => persistChart(runId, chart),
        getTemplateProfile: () => workspace.templateProfile ?? null,
        getSlides: async () => {
          const rows = await getSlides(runId);
          return rows.map((r) => ({
            id: r.id,
            position: r.position,
            layoutId: r.layoutId ?? "title-body",
            title: r.title ?? "",
            chartId: r.chartId,
            body: r.body,
            bullets: r.bullets,
            metrics: r.metrics,
            speakerNotes: r.speakerNotes,
          }));
        },
        onStepFinish: async (event: StepFinishEvent) => {
          tracker.recordStep(event.usage, event.toolCalls.length);
          await emitRunEvent(runId, "author", "tool_call", {
            stepNumber: event.stepNumber,
            tools: event.toolCalls.map((tc: { toolName: string }) => tc.toolName),
            usage: event.usage,
          });
        },
      });

      tracker.endPhase();

      const slides = await getSlides(runId);

      await emitRunEvent(runId, "author", "phase_completed", {
        slideCount: slides.length,
      });

      return result.summary;
    });

    // ─── STEP 3.5: POLISH (density check + targeted agent rewrite) ──
    await step.run("polish", async () => {
      const slides = await getSlides(runId);
      const weakSlideDetails: Array<{ position: number; title: string; layout: string; score: number; missing: string[] }> = [];

      for (const s of slides) {
        if (s.layoutId === "cover") continue;
        const hasChart = Boolean(s.chartId);
        const hasBody = Boolean(s.body && s.body.trim().length > 10);
        const hasBullets = Boolean(s.bullets && s.bullets.length > 0);
        const hasMetrics = Boolean(s.metrics && s.metrics.length > 0);
        const hasNotes = Boolean(s.speakerNotes && s.speakerNotes.trim().length > 10);

        let contentScore = 0;
        if (hasChart) contentScore += 2;
        if (hasBody) contentScore += 1;
        if (hasBullets) contentScore += 1;
        if (hasMetrics) contentScore += 2;
        if (hasNotes) contentScore += 1;

        if (contentScore < 3) {
          weakSlideDetails.push({
            position: s.position,
            title: s.title ?? "",
            layout: s.layoutId ?? "",
            score: contentScore,
            missing: [
              !hasChart ? "chart (build_chart then update slide)" : "",
              !hasBody ? "body text (executive prose)" : "",
              !hasBullets ? "bullet points" : "",
              !hasMetrics ? "metric cards" : "",
              !hasNotes ? "speaker notes" : "",
            ].filter(Boolean),
          });
        }
      }

      if (weakSlideDetails.length === 0) {
        await emitRunEvent(runId, "author", "polish_skipped", { reason: "All slides meet density threshold" });
        return { polished: 0, total: slides.length };
      }

      // Run a targeted polish agent on the weak slides
      const hydratedWorkspace = await loadHydratedWorkspace();
      tracker.startPhase("polish", "claude-opus-4-6", "anthropic");

      const weakSlidesPrompt = weakSlideDetails.map((s) =>
        `Slide ${s.position} (${s.layout}): "${s.title}" — score ${s.score}/7. Missing: ${s.missing.join(", ")}`,
      ).join("\n");

      await runAuthorAgent({
        workspace: hydratedWorkspace,
        runId,
        analysis,
        brief: `POLISH PASS: The following slides are below consulting quality. Fix each one by adding the missing content. Use query_data to pull real numbers. Build charts where needed. Do NOT rewrite slides that aren't listed — only fix the weak ones.\n\nWEAK SLIDES:\n${weakSlidesPrompt}`,
        loadRows: loadSheetRows,
        persistNotebookEntry: async (entry: NotebookEntry) => {
          return persistNotebookEntry(runId, "polish", Date.now(), entry);
        },
        persistSlide: async (slide: SlideInput) => persistSlide(runId, slide),
        persistChart: async (chart: ChartInput) => persistChart(runId, chart),
        getTemplateProfile: () => workspace.templateProfile ?? null,
        getSlides: async () => {
          const rows = await getSlides(runId);
          return rows.map((r) => ({
            id: r.id,
            position: r.position,
            layoutId: r.layoutId ?? "title-body",
            title: r.title ?? "",
            chartId: r.chartId,
            body: r.body,
            bullets: r.bullets,
            metrics: r.metrics,
            speakerNotes: r.speakerNotes,
          }));
        },
        onStepFinish: async (event: StepFinishEvent) => {
          tracker.recordStep(event.usage, event.toolCalls.length);
          await emitRunEvent(runId, "author", "tool_call", {
            stepNumber: event.stepNumber,
            tools: event.toolCalls.map((tc: { toolName: string }) => tc.toolName),
            phase: "polish",
          });
        },
      });

      tracker.endPhase();

      await emitRunEvent(runId, "author", "polish_completed", {
        weakSlideCount: weakSlideDetails.length,
        totalSlides: slides.length,
      });

      return { polished: weakSlideDetails.length, total: slides.length };
    });

    // ─── STEP 4: CRITIQUE (agentic, cross-model) ───────────────
    const critique = await step.run("critique", async () => {
      await updateRunStatus(runId, "running", "critique");
      await emitRunEvent(runId, "critique", "phase_started");

      // workspace has metadata; tools use loadSheetRows for on-demand data access
      tracker.startPhase("critique", "gpt-5.4", "openai");

      const slides = await getSlides(runId);

      const result = await runCriticAgent({
        workspace: workspace,
        runId,
        deckSummary,
        brief,
        slideCount: slides.length,
        getSlides: async () => slides,
        getNotebookEntries: async (evidenceRefId: string) => getNotebookEntry(evidenceRefId),
        persistNotebookEntry: async (entry: NotebookEntry) => {
          return persistNotebookEntry(runId, "critique", Date.now(), entry);
        },
        onStepFinish: async (event: StepFinishEvent) => {
          tracker.recordStep(event.usage, event.toolCalls.length);
          await emitRunEvent(runId, "critique", "tool_call", {
            stepNumber: event.stepNumber,
            tools: event.toolCalls.map((tc: { toolName: string }) => tc.toolName),
            usage: event.usage,
          });
        },
        authorProvider: "anthropic", // Author uses Anthropic, so critic uses OpenAI
      });

      tracker.endPhase();

      // Assemble full critique report from model output + orchestration metadata
      const critiqueId = crypto.randomUUID();
      const fullCritique: CritiqueReport = {
        id: critiqueId,
        runId,
        iteration: result.iteration,
        hasIssues: result.hasIssues,
        issues: result.issues,
        coverageScore: result.coverageScore,
        accuracyScore: result.accuracyScore,
        narrativeScore: result.narrativeScore,
        modelId: tracker.getCurrentModelId() ?? "gpt-5.4",
        provider: tracker.getCurrentProvider() ?? "openai",
        usage: tracker.getCurrentPhaseUsage(),
        createdAt: new Date().toISOString(),
      };

      // Persist critique report — durable checkpoint
      const critiqueInsert = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/critique_reports`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            id: fullCritique.id,
            run_id: runId,
            iteration: fullCritique.iteration,
            has_issues: fullCritique.hasIssues,
            issues: fullCritique.issues,
            coverage_score: fullCritique.coverageScore,
            accuracy_score: fullCritique.accuracyScore,
            narrative_score: fullCritique.narrativeScore,
            model_id: fullCritique.modelId,
            provider: fullCritique.provider,
            usage: fullCritique.usage,
          }),
        },
      );

      if (!critiqueInsert.ok) {
        const errorText = await critiqueInsert.text().catch(() => "Unknown error");
        throw new Error(`Failed to persist critique report (iteration ${fullCritique.iteration}): ${errorText}`);
      }

      await emitRunEvent(runId, "critique", "phase_completed", {
        hasIssues: fullCritique.hasIssues,
        issueCount: fullCritique.issues.length,
      });

      return fullCritique;
    });

    // ─── STEP 5: REVISE (conditional, max 2 iterations) ────────
    if (critique.hasIssues && critique.issues.some((i: { severity: string }) => i.severity === "critical" || i.severity === "major")) {
      await step.run("revise", async () => {
        await updateRunStatus(runId, "running", "revise");
        await emitRunEvent(runId, "revise", "phase_started");

        // Delete existing slides to avoid position collisions
        await deleteRunSlides(runId);
        await deleteRunCharts(runId);

        // workspace has metadata; tools use loadSheetRows for on-demand data access
        tracker.startPhase("revise", "claude-opus-4-6", "anthropic");

        const issuesSummary = critique.issues
          .map((i: { severity: string; type: string; suggestion: string; slideId?: string }) => `[${i.severity}] ${i.type}: ${i.suggestion}${i.slideId ? ` (slide: ${i.slideId})` : ""}`)
          .join("\n");

        const result = await runAuthorAgent({
          workspace,
          runId,
          analysis,
          brief,
          loadRows: loadSheetRows,
          critiqueContext: issuesSummary,
          persistNotebookEntry: async (entry: NotebookEntry) => {
            return persistNotebookEntry(runId, "revise", Date.now(), entry);
          },
          persistSlide: async (slide: SlideInput) => persistSlide(runId, slide),
          persistChart: async (chart: ChartInput) => persistChart(runId, chart),
          getTemplateProfile: () => workspace.templateProfile ?? null,
          getSlides: async () => {
            const rows = await getSlides(runId);
            return rows.map((r) => ({
              id: r.id,
              position: r.position,
              layoutId: r.layoutId ?? "title-body",
              title: r.title ?? "",
              chartId: r.chartId,
              body: r.body,
              bullets: r.bullets,
              metrics: r.metrics,
              speakerNotes: r.speakerNotes,
            }));
          },
          onStepFinish: async (event: StepFinishEvent) => {
            tracker.recordStep(event.usage, event.toolCalls.length);
            await emitRunEvent(runId, "revise", "tool_call", {
              stepNumber: event.stepNumber,
              tools: event.toolCalls.map((tc: { toolName: string }) => tc.toolName),
              usage: event.usage,
            });
          },
        });

        tracker.endPhase();

        deckSummary = result.summary;

        await emitRunEvent(runId, "revise", "phase_completed");
      });

      // ─── STEP 5b: RE-CRITIQUE (second pass, max 2 total) ──────
      await step.run("re-critique", async () => {
        await updateRunStatus(runId, "running", "critique");
        await emitRunEvent(runId, "critique", "phase_started");

        // workspace has metadata; tools use loadSheetRows for on-demand data access
        tracker.startPhase("re-critique", "gpt-5.4", "openai");

        const slides = await getSlides(runId);

        const reCritique = await runCriticAgent({
          workspace: workspace,
          runId,
          deckSummary,
          brief,
          slideCount: slides.length,
          getSlides: async () => slides,
          getNotebookEntries: async (evidenceRefId: string) => getNotebookEntry(evidenceRefId),
          persistNotebookEntry: async (entry: NotebookEntry) => {
            return persistNotebookEntry(runId, "critique", Date.now(), entry);
          },
          onStepFinish: async (event: StepFinishEvent) => {
            tracker.recordStep(event.usage, event.toolCalls.length);
            await emitRunEvent(runId, "critique", "tool_call", {
              stepNumber: event.stepNumber,
              tools: event.toolCalls.map((tc: { toolName: string }) => tc.toolName),
              usage: event.usage,
            });
          },
          authorProvider: "anthropic",
        });

        tracker.endPhase();

        // Assemble full re-critique report
        const reCritiqueId = crypto.randomUUID();
        const fullReCritique: CritiqueReport = {
          id: reCritiqueId,
          runId,
          iteration: reCritique.iteration,
          hasIssues: reCritique.hasIssues,
          issues: reCritique.issues,
          coverageScore: reCritique.coverageScore,
          accuracyScore: reCritique.accuracyScore,
          narrativeScore: reCritique.narrativeScore,
          modelId: tracker.getCurrentModelId() ?? "gpt-5.4",
          provider: tracker.getCurrentProvider() ?? "openai",
          usage: tracker.getCurrentPhaseUsage(),
          createdAt: new Date().toISOString(),
        };

        // Persist second critique report — durable checkpoint
        const reCritiqueInsert = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/critique_reports`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              id: fullReCritique.id,
              run_id: runId,
              iteration: fullReCritique.iteration,
              has_issues: fullReCritique.hasIssues,
              issues: fullReCritique.issues,
              coverage_score: fullReCritique.coverageScore,
              accuracy_score: fullReCritique.accuracyScore,
              narrative_score: fullReCritique.narrativeScore,
              model_id: fullReCritique.modelId,
              provider: fullReCritique.provider,
              usage: fullReCritique.usage,
            }),
          },
        );

        if (!reCritiqueInsert.ok) {
          const errorText = await reCritiqueInsert.text().catch(() => "Unknown error");
          throw new Error(`Failed to persist re-critique report (iteration ${fullReCritique.iteration}): ${errorText}`);
        }

        const blockingIssuesRemain = fullReCritique.hasIssues &&
          fullReCritique.issues.some((i) => i.severity === "critical" || i.severity === "major");

        if (blockingIssuesRemain) {
          logPhaseEvent(runId, "re-critique", "issues_remain_after_max_revisions", {
            issueCount: fullReCritique.issues.length,
            severities: fullReCritique.issues.map((i) => i.severity),
          });
        }

        await emitRunEvent(runId, "critique", "phase_completed", {
          hasIssues: fullReCritique.hasIssues,
          issueCount: fullReCritique.issues.length,
          iteration: 2,
        });

        // Hard gate: do NOT ship decks with critical issues remaining.
        // Major issues are allowed through after max revisions (degraded but usable).
        // Critical issues mean the deck has factually wrong numbers — never ship.
        if (blockingIssuesRemain) {
          const criticalCount = fullReCritique.issues.filter((i) => i.severity === "critical").length;
          if (criticalCount > 0) {
            throw new Error(
              `Export blocked: ${criticalCount} critical issue(s) remain after 2 revision cycles. ` +
              `The deck contains factually wrong data that would embarrass the firm. ` +
              `Issues: ${fullReCritique.issues.filter((i) => i.severity === "critical").map((i) => i.claim).join("; ")}`,
            );
          }
          logPhaseEvent(runId, "re-critique", "proceeding_with_major_issues", {
            issueCount: fullReCritique.issues.length,
            severities: fullReCritique.issues.map((i) => i.severity),
            note: "Major issues remain but no critical factual errors — proceeding to export",
          });
        }
      });
    }

    // ─── STEP 6: EXPORT (deterministic) ─────────────────────────
    const artifacts = await step.run("export", async () => {
      await updateRunStatus(runId, "running", "export");
      await emitRunEvent(runId, "export", "phase_started");

      // workspace has metadata; tools use loadSheetRows for on-demand data access
      const slides = await getSlides(runId);
      const charts = await getCharts(runId);

      // Build v2 chart rows for the native v2 renderer
      const v2ChartRows = await getV2ChartRows(runId);

      // Render PPTX via native v2 renderer (direct from DeckSpecV2 schema)
      const deckTitle = analysis.summary?.slice(0, 100) ?? slides[0]?.title ?? "Basquio Report";
      // Map template brand tokens to renderer format if available
      const tp = workspace.templateProfile;
      const strip = (c?: string) => c?.replace("#", "");
      // Map template brand tokens to renderer palette — use generic record access
      // since template palette may have extended keys beyond the typed interface
      const brandTokenOverrides: Record<string, unknown> | undefined = (() => {
        if (!tp?.brandTokens) return undefined;
        const pal = (tp.brandTokens.palette ?? {}) as Record<string, string | undefined>;
        const typo = tp.brandTokens.typography;
        const rendererPalette: Record<string, string> = {};
        const map: Record<string, string | string[]> = {
          accent: "accent", ink: "text", bg: "background", surface: "surface",
          muted: ["muted", "accentMuted"], border: "border",
          accentLight: ["accentLight", "highlight"],
          positive: "positive", negative: "negative",
          coverBg: "coverBg", calloutGreen: "calloutGreen", calloutOrange: "calloutOrange",
        };
        for (const [rendererKey, sourceKeys] of Object.entries(map)) {
          const keys = Array.isArray(sourceKeys) ? sourceKeys : [sourceKeys];
          for (const k of keys) {
            const v = strip(pal[k]);
            if (v) { rendererPalette[rendererKey] = v; break; }
          }
        }
        return {
          palette: rendererPalette,
          typography: {
            ...(typo?.headingFont ? { headingFont: typo.headingFont } : {}),
            ...(typo?.bodyFont ? { bodyFont: typo.bodyFont } : {}),
          },
        };
      })();

      const pptxArtifact = await renderV2PptxArtifact({
        deckTitle,
        slides,
        charts: v2ChartRows,
        brandTokens: brandTokenOverrides as Record<string, unknown> | undefined,
      });

      // Unified PDF rendering via Browserless — same slide data as PPTX
      let pdfArtifact: { fileName: string; mimeType: string; buffer: Buffer | { data: number[] } } | null = null;
      const browserlessToken = process.env.BROWSERLESS_TOKEN;
      const browserlessUrl = process.env.BROWSERLESS_URL ?? "https://production-sfo.browserless.io";
      if (browserlessToken) {
        try {
          const html = renderSlidesToHtml(slides, v2ChartRows, deckTitle);
          const pdfResp = await fetch(`${browserlessUrl}/pdf?token=${browserlessToken}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              html,
              options: {
                printBackground: true,
                landscape: true,
                width: "960px",
                height: "540px",
                margin: { top: "0", right: "0", bottom: "0", left: "0" },
              },
              gotoOptions: { waitUntil: "networkidle2", timeout: 30000 },
            }),
          });
          if (pdfResp.ok) {
            const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
            pdfArtifact = {
              fileName: `${deckTitle.replace(/[^a-zA-Z0-9 -]/g, "").slice(0, 50)}.pdf`,
              mimeType: "application/pdf",
              buffer: pdfBuffer,
            };
          }
        } catch {
          // PDF rendering is best-effort; PPTX is the primary artifact
        }
      }

      // Upload artifacts
      const pptxPath = `${runId}/deck.pptx`;
      const pdfPath = `${runId}/deck.pdf`;

      const pptxBuffer = Buffer.isBuffer(pptxArtifact.buffer)
        ? pptxArtifact.buffer
        : Buffer.from((pptxArtifact.buffer as { data: number[] }).data);

      await uploadToStorage({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        bucket: "artifacts",
        storagePath: pptxPath,
        body: pptxBuffer,
        contentType: pptxArtifact.mimeType,
      });

      let pdfBuffer: Buffer | null = null;
      if (pdfArtifact) {
        pdfBuffer = Buffer.isBuffer(pdfArtifact.buffer)
          ? pdfArtifact.buffer
          : Buffer.from((pdfArtifact.buffer as { data: number[] }).data);

        await uploadToStorage({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          bucket: "artifacts",
          storagePath: pdfPath,
          body: pdfBuffer,
          contentType: pdfArtifact.mimeType,
        });
      }

      // ── QA: validate artifacts before publishing manifest ──
      const { createHash } = await import("node:crypto");
      const pptxSha256 = createHash("sha256").update(pptxBuffer).digest("hex");
      const pdfSha256 = pdfBuffer ? createHash("sha256").update(pdfBuffer).digest("hex") : "";

      const qaChecks: Array<{ name: string; passed: boolean; detail?: string }> = [];

      // Check: PPTX artifact is valid
      qaChecks.push({
        name: "pptx_non_empty",
        passed: pptxBuffer.length > 0,
        detail: `${pptxBuffer.length} bytes`,
      });
      qaChecks.push({
        name: "slide_count_positive",
        passed: slides.length > 0,
        detail: `${slides.length} slides`,
      });

      const hasValidPptxHeader = pptxBuffer.length >= 4 &&
        pptxBuffer[0] === 0x50 && pptxBuffer[1] === 0x4B &&
        pptxBuffer[2] === 0x03 && pptxBuffer[3] === 0x04;
      qaChecks.push({ name: "pptx_valid_zip", passed: hasValidPptxHeader });

      // PDF checks (only if PDF was generated)
      let actualPdfPageCount = 0;
      if (pdfBuffer) {
        qaChecks.push({ name: "pdf_non_empty", passed: pdfBuffer.length > 0, detail: `${pdfBuffer.length} bytes` });
        const hasValidPdfHeader = pdfBuffer.length >= 4 &&
          pdfBuffer[0] === 0x25 && pdfBuffer[1] === 0x50 &&
          pdfBuffer[2] === 0x44 && pdfBuffer[3] === 0x46;
        qaChecks.push({ name: "pdf_valid_header", passed: hasValidPdfHeader });
        const pdfText = pdfBuffer.toString("latin1");
        const pageMatches = pdfText.match(/\/Type\s*\/Page(?!s)/g);
        actualPdfPageCount = pageMatches ? pageMatches.length : 0;
      }

      // PPTX is the primary artifact — QA gates on PPTX only
      const criticalChecks = qaChecks.filter((c) => c.name.startsWith("pptx_") || c.name === "slide_count_positive");
      const qaPassed = criticalChecks.every((c) => c.passed);

      if (!qaPassed) {
        const failedChecks = criticalChecks.filter((c) => !c.passed).map((c) => c.name).join(", ");
        await updateRunStatus(runId, "failed", "export", { failure_message: `QA failed: ${failedChecks}` });
        throw new Error(`Artifact QA failed: ${failedChecks}`);
      }

      const manifestArtifacts: Array<Record<string, unknown>> = [
        {
          id: crypto.randomUUID(),
          kind: "pptx",
          fileName: pptxArtifact.fileName,
          mimeType: pptxArtifact.mimeType,
          storageBucket: "artifacts",
          storagePath: pptxPath,
          fileBytes: pptxBuffer.length,
          checksumSha256: pptxSha256,
        },
      ];
      if (pdfBuffer && pdfArtifact) {
        manifestArtifacts.push({
          id: crypto.randomUUID(),
          kind: "pdf",
          fileName: pdfArtifact.fileName,
          mimeType: pdfArtifact.mimeType,
          storageBucket: "artifacts",
          storagePath: pdfPath,
          fileBytes: pdfBuffer.length,
          checksumSha256: pdfSha256,
        });
      }

      const manifestId = crypto.randomUUID();
      const manifest = {
        id: manifestId,
        run_id: runId,
        slide_count: slides.length,
        page_count: pdfBuffer ? actualPdfPageCount : slides.length,
        qa_passed: true,
        qa_report: { checks: qaChecks },
        artifacts: manifestArtifacts,
        published_at: new Date().toISOString(),
      };

      const manifestResponse = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/artifact_manifests_v2`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify(manifest),
        },
      );

      if (!manifestResponse.ok) {
        const errorText = await manifestResponse.text().catch(() => "Unknown error");
        await updateRunStatus(runId, "failed", "export", {
          failure_message: `Failed to persist artifact manifest: ${errorText}`,
        });
        throw new Error(`Failed to persist artifact manifest: ${errorText}`);
      }

      await updateRunStatus(runId, "completed", "export", {
        completed_at: new Date().toISOString(),
      });

      await emitRunEvent(runId, "export", "phase_completed", {
        slideCount: slides.length,
        artifactCount: 2,
      });

      return manifest;
    });

    // ─── COST SUMMARY ──────────────────────────────────────────
    const costSummary = tracker.getSummary(runId);
    const budgetCheck = checkCostBudget(costSummary);

    logPhaseEvent(runId, "complete", "job_finished", {
      totalTokens: costSummary.totalUsage.totalTokens,
      estimatedCostUsd: costSummary.estimatedCostUsd,
      durationMs: costSummary.durationMs,
      budgetExceeded: budgetCheck.exceeded,
    });

    if (budgetCheck.message) {
      console.warn(budgetCheck.message);
    }

    return { runId, artifacts, costSummary };

    } catch (error) {
      // Mark run as failed so the UI reflects the real state
      const message = error instanceof Error ? error.message : "Unknown orchestration error";
      console.error(`[basquio-v2] Run ${runId} failed:`, message);
      await updateRunStatus(runId, "failed", undefined, {
        failure_message: message.slice(0, 1000),
      }).catch(() => {}); // best-effort — don't mask the original error
      throw error; // re-throw so Inngest knows the function failed
    }
  },
);

// ─── HTML RENDERER FOR UNIFIED PDF ────────────────────────────────

type V2ChartRowForPdf = { id: string; chartType: string; title: string; data: Record<string, unknown>[]; xAxis: string; series: string[] };

function renderSlidesToHtml(slides: SlideRow[], charts: V2ChartRowForPdf[], deckTitle: string): string {
  const chartMap = new Map<string, V2ChartRowForPdf>();
  for (const c of charts) chartMap.set(c.id, c);

  function esc(t: string): string {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\\n/g, "\n").replace(/\n/g, "<br/>");
  }

  const pages = slides.map((s) => {
    const isCover = s.layoutId === "cover";
    const chart = s.chartId ? chartMap.get(s.chartId) : null;

    // Metrics
    let metricsHtml = "";
    if (s.metrics?.length) {
      metricsHtml = `<div style="display:flex;gap:10px;margin-bottom:10px;">${s.metrics.map((m) => `
        <div style="flex:1;background:#F8FAFC;border:1px solid #D1D5DB;border-left:4px solid #0F4C81;border-radius:4px;padding:8px 12px;">
          <div style="font-size:8px;color:#4B5563;text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">${esc(m.label)}</div>
          <div style="font-size:26px;font-weight:700;color:#111827;margin:4px 0;">${esc(m.value)}</div>
          ${m.delta ? `<div style="font-size:8px;font-weight:700;color:${m.delta.startsWith("+") || m.delta.includes("↑") ? "#1F7A4D" : "#B42318"};">${esc(m.delta)}</div>` : ""}
        </div>`).join("")}</div>`;
    }

    // Chart or table rendering for PDF
    let chartHtml = "";
    if (chart && chart.data?.length > 0) {
      if (chart.chartType === "table") {
        // Render table as HTML
        const headers = [chart.xAxis, ...(chart.series ?? [])].filter(Boolean);
        const rows = chart.data.slice(0, 10);
        chartHtml = `<table style="width:100%;border-collapse:collapse;font-size:8px;font-family:Arial;">
          <tr>${headers.map((h, i) => `<th style="background:#1B2541;color:#fff;font-weight:700;padding:3px 6px;text-align:${i === 0 ? "left" : "right"};font-size:8px;">${esc(h)}</th>`).join("")}</tr>
          ${rows.map((row) => `<tr>${headers.map((h, i) => {
            const v = row[h];
            const fv = typeof v === "number" ? (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(v)) : String(v ?? "");
            return `<td style="padding:3px 6px;border-bottom:0.5px solid #E5E7EB;color:#111827;text-align:${i === 0 ? "left" : "right"};font-size:8px;">${esc(fv)}</td>`;
          }).join("")}</tr>`).join("")}
        </table>`;
      } else if (chart.series?.length > 0) {
        // Render chart via QuickChart with inline SVG fallback
        const pal = ["#0F4C81", "#D1D5DB", "#1F7A4D", "#B42318", "#C97A00", "#6B21A8"];
        const type = chart.chartType === "stacked_bar" || chart.chartType === "waterfall" ? "bar" : chart.chartType;
        const isHoriz = chart.chartType === "bar";
        const labels = chart.data.map((r) => String(r[chart.xAxis] ?? "").substring(0, 20));
        const datasets = chart.series.map((ser, i) => ({
          label: ser,
          data: chart.data.map((r) => Number(r[ser]) || 0),
          backgroundColor: type === "pie" || type === "doughnut" ? pal : pal[i % 6],
          borderWidth: type === "line" ? 2 : 0,
          fill: false,
        }));
        const cfg = JSON.stringify({
          type,
          data: { labels, datasets },
          options: {
            indexAxis: isHoriz ? "y" : "x",
            plugins: { legend: { display: chart.series.length > 1, position: "bottom" }, title: { display: false } },
            scales: type === "pie" || type === "doughnut" ? undefined : {
              x: { grid: { display: !isHoriz, color: "#E5E7EB" }, ticks: { font: { size: 8 } } },
              y: { grid: { display: isHoriz, color: "#E5E7EB" }, ticks: { font: { size: 8 } } },
            },
          },
        });
        const qcUrl = `https://quickchart.io/chart?c=${encodeURIComponent(cfg)}&w=440&h=260&bkg=white&f=png`;
        // Primary: QuickChart image. If it fails to load in the PDF, the img tag just shows blank.
        // Also render a simple HTML table fallback below the chart for data accessibility.
        const fallbackTable = `<table style="width:100%;border-collapse:collapse;font-size:7px;margin-top:4px;">
          <tr><th style="text-align:left;border-bottom:1px solid #D1D5DB;padding:2px 4px;">${esc(chart.xAxis)}</th>${chart.series.map((s) => `<th style="text-align:right;border-bottom:1px solid #D1D5DB;padding:2px 4px;">${esc(s)}</th>`).join("")}</tr>
          ${chart.data.slice(0, 6).map((row) => `<tr><td style="padding:2px 4px;border-bottom:0.5px solid #E5E7EB;">${esc(String(row[chart.xAxis] ?? ""))}</td>${chart.series.map((s) => `<td style="text-align:right;padding:2px 4px;border-bottom:0.5px solid #E5E7EB;">${esc(String(row[s] ?? ""))}</td>`).join("")}</tr>`).join("")}
        </table>`;
        // Chart image only — no fallback table below (clutters the slide)
        chartHtml = `<img src="${qcUrl}" style="max-width:100%;max-height:260px;" onerror="this.style.display='none'"/>`;
      }
    }

    // Body + bullets
    const bodyHtml = s.body ? `<div style="font-size:9px;color:#111827;line-height:1.4;">${esc(s.body)}</div>` : "";
    const bulletsHtml = s.bullets?.length ? `<ul style="font-size:9px;color:#111827;line-height:1.4;padding-left:14px;margin:4px 0;">${s.bullets.slice(0, 5).map((b) => `<li style="margin-bottom:3px;">${esc(b)}</li>`).join("")}</ul>` : "";

    // Layout-dependent content
    let content = "";
    const layout = s.layoutId ?? "title-body";
    if (isCover) {
      content = "";
    } else if (layout === "chart-split" || layout === "two-column") {
      content = `${metricsHtml}<div style="display:flex;gap:12px;flex:1;min-height:0;"><div style="flex:0 0 55%;">${chartHtml}</div><div style="flex:1;">${bulletsHtml || bodyHtml}</div></div>`;
    } else if (layout === "evidence-grid") {
      content = `${metricsHtml}<div style="display:flex;gap:12px;flex:1;min-height:0;"><div style="flex:0 0 55%;">${chartHtml}</div><div style="flex:1;">${bulletsHtml || bodyHtml}</div></div>`;
    } else if (layout === "title-chart") {
      content = chartHtml;
    } else if (layout === "summary") {
      content = `${bodyHtml}${bulletsHtml ? `<div style="background:#DCEAF7;border-left:3px solid #0F4C81;padding:8px 12px;margin-top:8px;">${bulletsHtml}</div>` : ""}`;
    } else {
      content = `${metricsHtml}${bodyHtml}${bulletsHtml}${chartHtml}`;
    }

    return `<div style="width:960px;height:540px;background:${isCover ? "#1B2541" : "#fff"};box-sizing:border-box;position:relative;page-break-after:always;font-family:Arial,sans-serif;display:flex;flex-direction:column;${isCover ? "padding:100px 52px;justify-content:center;" : "padding:16px 45px 32px 45px;"}">
      ${!isCover ? '<div style="position:absolute;top:0;left:0;right:0;height:4px;background:#0F4C81;"></div>' : ""}
      <div style="font-size:${isCover ? "28px" : "18px"};font-weight:700;color:${isCover ? "#fff" : "#111827"};line-height:1.2;margin-bottom:${isCover ? "12px" : "4px"};flex-shrink:0;">${esc(s.title ?? "")}</div>
      ${s.subtitle ? `<div style="font-size:12px;color:${isCover ? "rgba(255,255,255,0.7)" : "#4B5563"};margin-bottom:8px;flex-shrink:0;">${esc(s.subtitle)}</div>` : ""}
      ${!isCover ? '<div style="border-top:1px solid #D1D5DB;margin-bottom:6px;flex-shrink:0;"></div>' : ""}
      <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;">${content}</div>
      ${!isCover ? `<div style="position:absolute;bottom:0;left:0;right:0;height:26px;background:#1B2541;display:flex;align-items:center;padding:0 45px;"><div style="font-size:7px;color:#fff;font-style:italic;flex:1;">Source: ${esc(deckTitle)} | Basquio</div><div style="font-size:7px;color:#9CA3AF;">${s.position} / ${slides.length}</div></div>` : ""}
    </div>`;
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:960px 540px;margin:0}body{margin:0;padding:0}img{display:block}</style></head><body>${pages.join("\n")}</body></html>`;
}

// ─── SLIDE BLOCK BUILDER ──────────────────────────────────────────
// Converts DeckSpecV2 slide row data to SlideSpec blocks for existing renderers

function buildSlideBlocks(slide: SlideRow): SlideSpec["blocks"] {
  const block = (kind: string, overrides: Record<string, unknown> = {}): SlideSpec["blocks"][number] => ({
    kind: kind as SlideSpec["blocks"][number]["kind"],
    content: "",
    chartId: "",
    items: [],
    label: "",
    value: "",
    tone: "default",
    evidenceIds: [],
    templateBinding: undefined,
    ...overrides,
  });

  const blocks: SlideSpec["blocks"] = [];

  // Note: title and subtitle are NOT added as blocks because the PPTX renderer
  // already draws slideSpec.title and slideSpec.subtitle in the header region.
  // Adding them as blocks would duplicate the content in the body area.

  if (slide.body) {
    blocks.push(block("body", { content: slide.body }));
  }

  if (slide.bullets && slide.bullets.length > 0) {
    blocks.push(block("bullet-list", { items: slide.bullets }));
  }

  if (slide.metrics && slide.metrics.length > 0) {
    for (const m of slide.metrics) {
      blocks.push(block("metric", {
        label: m.label,
        value: m.value,
        content: m.delta ? `${m.value} (${m.delta})` : m.value,
      }));
    }
  }

  if (slide.chartId) {
    blocks.push(block("chart", { chartId: slide.chartId }));
  }

  if (blocks.length === 0) {
    blocks.push(block("body"));
  }

  return blocks;
}
