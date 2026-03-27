/**
 * Emergency rescue: publish artifacts from a checkpoint for a failed run.
 *
 * This script:
 * 1. Loads the highest checkpoint (revise > author) from working_papers
 * 2. Downloads the checkpoint PPTX and PDF from storage
 * 3. Builds DOCX from the checkpoint manifest + run analysis
 * 4. Publishes all artifacts to the final storage paths
 * 5. Creates the artifact_manifests_v2 row
 * 6. Marks the run as completed/salvaged
 *
 * Usage: tsx scripts/rescue-checkpoint.ts <run_id>
 */
import { createHash, randomUUID } from "node:crypto";
import { loadBasquioScriptEnv } from "./load-app-env";
import {
  fetchRestRows,
  patchRestRows,
  upsertRestRows,
  downloadFromStorage,
  uploadToStorage,
} from "../packages/workflows/src/supabase";
import { parseDeckManifest } from "../packages/workflows/src/deck-manifest";
import { buildNarrativeDocx } from "../packages/workflows/src/docx-report";

loadBasquioScriptEnv();

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: tsx scripts/rescue-checkpoint.ts <run_id>");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const config = { supabaseUrl, serviceKey };

type WorkingPaperRow = {
  paper_type: string;
  content: Record<string, unknown> | null;
  version: number;
};

type RunRow = {
  id: string;
  organization_id: string;
  project_id: string;
  requested_by: string | null;
  brief: Record<string, unknown> | null;
  business_context: string;
  client: string;
  audience: string;
  objective: string;
  thesis: string;
  stakes: string;
  source_file_ids: string[];
  template_profile_id: string | null;
  template_diagnostics: Record<string, unknown> | null;
  active_attempt_id: string | null;
  latest_attempt_id: string | null;
  latest_attempt_number: number;
  status: string;
  cost_telemetry: Record<string, unknown> | null;
};

async function main() {
  console.log(`\nRescuing run ${runId}...\n`);

  // 1. Load run
  const runs = await fetchRestRows<RunRow>({
    supabaseUrl,
    serviceKey,
    table: "deck_runs",
    query: {
      select: "id,organization_id,project_id,requested_by,brief,business_context,client,audience,objective,thesis,stakes,source_file_ids,template_profile_id,template_diagnostics,active_attempt_id,latest_attempt_id,latest_attempt_number,status,cost_telemetry",
      id: `eq.${runId}`,
      limit: "1",
    },
  });

  if (!runs[0]) {
    console.error(`Run ${runId} not found.`);
    process.exit(1);
  }

  const run = runs[0];
  console.log(`Run status: ${run.status}`);

  // 2. Load checkpoint
  const checkpointRows = await fetchRestRows<WorkingPaperRow>({
    supabaseUrl,
    serviceKey,
    table: "working_papers",
    query: {
      select: "paper_type,content,version",
      run_id: `eq.${runId}`,
      paper_type: "eq.artifact_checkpoint",
      order: "version.desc",
      limit: "1",
    },
  });

  const checkpoint = checkpointRows[0]?.content;
  if (!checkpoint || !checkpoint.pptxStoragePath || !checkpoint.pdfStoragePath) {
    console.error("No valid checkpoint found for this run.");
    process.exit(1);
  }

  console.log(`Checkpoint found: phase=${checkpoint.phase}, saved=${checkpoint.savedAt}`);
  console.log(`  PPTX: ${checkpoint.pptxStoragePath}`);
  console.log(`  PDF:  ${checkpoint.pdfStoragePath}`);

  // 3. Download checkpoint artifacts
  console.log("\nDownloading checkpoint artifacts...");
  const pptxBuffer = await downloadFromStorage({
    supabaseUrl,
    serviceKey,
    bucket: "artifacts",
    storagePath: checkpoint.pptxStoragePath as string,
  });
  console.log(`  PPTX: ${pptxBuffer.length} bytes`);

  const pdfBuffer = await downloadFromStorage({
    supabaseUrl,
    serviceKey,
    bucket: "artifacts",
    storagePath: checkpoint.pdfStoragePath as string,
  });
  console.log(`  PDF:  ${pdfBuffer.length} bytes`);

  // 4. Parse manifest
  const manifest = parseDeckManifest(checkpoint.manifestJson as Record<string, unknown>);
  console.log(`  Manifest: ${manifest.slideCount} slides, ${manifest.charts.length} charts`);

  // 5. Load analysis for DOCX
  const analysisRows = await fetchRestRows<WorkingPaperRow>({
    supabaseUrl,
    serviceKey,
    table: "working_papers",
    query: {
      select: "paper_type,content,version",
      run_id: `eq.${runId}`,
      paper_type: "eq.analysis_result",
      order: "version.desc",
      limit: "1",
    },
  });

  const analysis = analysisRows[0]?.content ?? { language: "English", thesis: "", executiveSummary: "", slidePlan: [] };

  // 6. Build DOCX
  console.log("\nBuilding DOCX...");
  const docx = await buildNarrativeDocx({
    run: run as Parameters<typeof buildNarrativeDocx>[0]["run"],
    analysis: analysis as Parameters<typeof buildNarrativeDocx>[0]["analysis"],
    manifest,
  });
  console.log(`  DOCX: ${docx.buffer.length} bytes`);

  // 7. Upload final artifacts
  console.log("\nUploading final artifacts...");
  const items = [
    { kind: "pptx", fileName: "deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: pptxBuffer },
    { kind: "pdf", fileName: "deck.pdf", mimeType: "application/pdf", buffer: pdfBuffer },
    { kind: "docx", fileName: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx.buffer },
  ] as const;

  const artifacts = [];
  for (const item of items) {
    const storagePath = `${runId}/${item.fileName}`;
    await uploadToStorage({
      supabaseUrl,
      serviceKey,
      bucket: "artifacts",
      storagePath,
      body: item.buffer,
      contentType: item.mimeType,
      upsert: true,
    });
    console.log(`  Uploaded ${item.kind}: ${item.buffer.length} bytes`);

    artifacts.push({
      id: randomUUID(),
      kind: item.kind,
      fileName: item.fileName,
      mimeType: item.mimeType,
      storageBucket: "artifacts",
      storagePath,
      fileBytes: item.buffer.length,
      checksumSha256: createHash("sha256").update(item.buffer).digest("hex"),
    });
  }

  // 8. Publish artifact manifest
  console.log("\nPublishing artifact manifest...");
  await upsertRestRows({
    supabaseUrl,
    serviceKey,
    table: "artifact_manifests_v2",
    onConflict: "run_id",
    rows: [{
      run_id: runId,
      slide_count: manifest.slideCount,
      page_count: manifest.pageCount ?? manifest.slideCount,
      qa_passed: false,
      qa_report: {
        tier: "red",
        passed: false,
        checks: [],
        failed: [],
        rescuedFromCheckpoint: true,
        checkpointPhase: checkpoint.phase,
      },
      artifacts,
      published_at: new Date().toISOString(),
    }],
  });

  // 9. Mark run as completed (salvaged)
  console.log("\nMarking run as completed (salvaged)...");
  const now = new Date().toISOString();
  await patchRestRows({
    supabaseUrl,
    serviceKey,
    table: "deck_runs",
    query: { id: `eq.${runId}` },
    payload: {
      status: "completed",
      delivery_status: "salvaged",
      completed_at: now,
      updated_at: now,
      failure_message: null,
      failure_phase: null,
      active_attempt_id: null,
      cost_telemetry: {
        ...run.cost_telemetry ?? {},
        rescuedFromCheckpoint: true,
        checkpointPhase: checkpoint.phase,
        salvaged: true,
      },
    },
  });

  // Mark the latest attempt as completed too
  if (run.latest_attempt_id) {
    await patchRestRows({
      supabaseUrl,
      serviceKey,
      table: "deck_run_attempts",
      query: { id: `eq.${run.latest_attempt_id}` },
      payload: {
        status: "completed",
        completed_at: now,
        updated_at: now,
        failure_message: null,
        failure_phase: null,
      },
    });
  }

  console.log(`\nDone. Run ${runId} is now completed (salvaged from ${checkpoint.phase} checkpoint).`);
  console.log(`Artifacts: ${artifacts.map((a) => `${a.kind} (${a.fileBytes} bytes)`).join(", ")}`);
}

void main().catch((error) => {
  console.error(`\nFatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
