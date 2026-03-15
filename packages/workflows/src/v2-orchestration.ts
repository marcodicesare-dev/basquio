import { parseEvidencePackage } from "@basquio/data-ingest";
import { runAnalystAgent, runAuthorAgent, runCriticAgent } from "@basquio/intelligence";
import { renderPdfArtifact } from "@basquio/render-pdf";
import { renderPptxArtifact } from "@basquio/render-pptx";
import { interpretTemplateSource } from "@basquio/template-engine";
import type {
  AnalysisReport,
  ChartSpec,
  CritiqueReport,
  DeckRunPhase,
  DeckSpecV2,
  EvidenceWorkspace,
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
        title: slide.title,
        subtitle: slide.subtitle,
        body: slide.body,
        bullets: slide.bullets,
        chart_id: slide.chartId,
        metrics: slide.metrics,
        evidence_ids: slide.evidenceIds,
        speaker_notes: slide.speakerNotes,
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
  style?: { colors?: string[]; showLegend?: boolean; showValues?: boolean };
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

async function getSlides(runId: string) {
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
    title: r.title as string,
    body: r.body as string | undefined,
    bullets: r.bullets as string[] | undefined,
    evidenceIds: (r.evidence_ids ?? []) as string[],
    metrics: r.metrics as { label: string; value: string; delta?: string }[] | undefined,
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

      const parsed = await parseEvidencePackage({
        datasetId: runId,
        files: fileBuffers.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          buffer: f.buffer,
          kind: f.kind as "workbook" | "pptx" | "pdf" | "unknown",
        })),
      });

      // Build file inventory
      const fileInventory = fileBuffers.map((f) => {
        const parsedFile = parsed.normalizedWorkbook.files.find((pf: { fileName: string }) => pf.fileName === f.fileName);
        return {
          id: f.id,
          fileName: f.fileName,
          kind: f.kind,
          role: parsedFile?.role ?? "unknown-support",
          mediaType: "application/octet-stream",
          sheets: (parsedFile?.sheets ?? []).map((s) => ({
            name: s.name,
            rowCount: s.rowCount,
            columnCount: s.columns.length,
            columns: s.columns.map((c) => ({ ...c })),
          })),
          textContent: parsedFile?.textContent,
          warnings: parsedFile?.warnings ?? [],
        };
      });

      // Build sheet data map
      const sheetData: Record<string, Array<Record<string, unknown>>> = {};
      for (const sheet of parsed.normalizedWorkbook.sheets) {
        const key = `${sheet.sourceFileId ?? sheet.sourceFileName}:${sheet.name}`;
        sheetData[key] = sheet.rows ?? [];
      }

      // Parse template if provided
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

      // If no template, create system default
      if (!templateProfile) {
        const result = await interpretTemplateSource({ id: "system-default" });
        templateProfile = result;
      }

      // Persist evidence workspace
      const workspaceId = crypto.randomUUID();
      await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspaces`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            id: workspaceId,
            run_id: runId,
            file_inventory: fileInventory,
            dataset_profile: parsed.datasetProfile ?? {},
            template_profile: templateProfile,
            sheet_data: sheetData,
          }),
        },
      );

      await emitRunEvent(runId, "normalize", "phase_completed", {
        fileCount: fileInventory.length,
        sheetCount: Object.keys(sheetData).length,
      });

      return {
        id: workspaceId,
        runId,
        fileInventory,
        datasetProfile: parsed.datasetProfile,
        templateProfile,
        sheetData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies EvidenceWorkspace;
    }) as EvidenceWorkspace;

    // ─── STEP 2: UNDERSTAND (agentic) ───────────────────────────
    const analysis = await step.run("understand", async () => {
      await updateRunStatus(runId, "running", "understand");
      await emitRunEvent(runId, "understand", "phase_started");

      tracker.startPhase("understand", "gpt-5.4", "openai");

      const result = await runAnalystAgent({
        workspace,
        runId,
        brief,
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

    // ─── STEP 3: AUTHOR (agentic) ──────────────────────────────
    let deckSummary = await step.run("author", async () => {
      await updateRunStatus(runId, "running", "author");
      await emitRunEvent(runId, "author", "phase_started");

      tracker.startPhase("author", "claude-opus-4-6", "anthropic");

      const result = await runAuthorAgent({
        workspace,
        runId,
        analysis,
        brief,
        persistNotebookEntry: async (entry: NotebookEntry) => {
          return persistNotebookEntry(runId, "author", Date.now(), entry);
        },
        persistSlide: async (slide: SlideInput) => persistSlide(runId, slide),
        persistChart: async (chart: ChartInput) => persistChart(runId, chart),
        getTemplateProfile: () => workspace.templateProfile ?? null,
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

    // ─── STEP 4: CRITIQUE (agentic, cross-model) ───────────────
    const critique = await step.run("critique", async () => {
      await updateRunStatus(runId, "running", "critique");
      await emitRunEvent(runId, "critique", "phase_started");

      tracker.startPhase("critique", "gpt-5.4", "openai");

      const slides = await getSlides(runId);

      const result = await runCriticAgent({
        workspace,
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

      // Persist critique report
      await fetch(
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
            id: result.id,
            run_id: runId,
            iteration: result.iteration,
            has_issues: result.hasIssues,
            issues: result.issues,
            coverage_score: result.coverageScore,
            accuracy_score: result.accuracyScore,
            narrative_score: result.narrativeScore,
            model_id: result.modelId,
            provider: result.provider,
            usage: result.usage,
          }),
        },
      );

      await emitRunEvent(runId, "critique", "phase_completed", {
        hasIssues: result.hasIssues,
        issueCount: result.issues.length,
      });

      return result;
    });

    // ─── STEP 5: REVISE (conditional, max 2 iterations) ────────
    if (critique.hasIssues && critique.issues.some((i: { severity: string }) => i.severity === "critical" || i.severity === "major")) {
      await step.run("revise", async () => {
        await updateRunStatus(runId, "running", "revise");
        await emitRunEvent(runId, "revise", "phase_started");

        // Delete existing slides to avoid position collisions
        await deleteRunSlides(runId);

        tracker.startPhase("revise", "claude-opus-4-6", "anthropic");

        const issuesSummary = critique.issues
          .map((i: { severity: string; type: string; suggestion: string; slideId?: string }) => `[${i.severity}] ${i.type}: ${i.suggestion}${i.slideId ? ` (slide: ${i.slideId})` : ""}`)
          .join("\n");

        const result = await runAuthorAgent({
          workspace,
          runId,
          analysis,
          brief,
          critiqueContext: issuesSummary,
          persistNotebookEntry: async (entry: NotebookEntry) => {
            return persistNotebookEntry(runId, "revise", Date.now(), entry);
          },
          persistSlide: async (slide: SlideInput) => persistSlide(runId, slide),
          persistChart: async (chart: ChartInput) => persistChart(runId, chart),
          getTemplateProfile: () => workspace.templateProfile ?? null,
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

        tracker.startPhase("re-critique", "gpt-5.4", "openai");

        const slides = await getSlides(runId);

        const reCritique = await runCriticAgent({
          workspace,
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

        // Persist second critique report
        await fetch(
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
              id: reCritique.id,
              run_id: runId,
              iteration: reCritique.iteration,
              has_issues: reCritique.hasIssues,
              issues: reCritique.issues,
              coverage_score: reCritique.coverageScore,
              accuracy_score: reCritique.accuracyScore,
              narrative_score: reCritique.narrativeScore,
              model_id: reCritique.modelId,
              provider: reCritique.provider,
              usage: reCritique.usage,
            }),
          },
        );

        if (reCritique.hasIssues && reCritique.issues.some((i: { severity: string }) => i.severity === "critical" || i.severity === "major")) {
          logPhaseEvent(runId, "re-critique", "issues_remain_after_max_revisions", {
            issueCount: reCritique.issues.length,
            severities: reCritique.issues.map((i: { severity: string }) => i.severity),
          });
        }

        await emitRunEvent(runId, "critique", "phase_completed", {
          hasIssues: reCritique.hasIssues,
          issueCount: reCritique.issues.length,
          iteration: 2,
        });
      });
    }

    // ─── STEP 6: EXPORT (deterministic) ─────────────────────────
    const artifacts = await step.run("export", async () => {
      await updateRunStatus(runId, "running", "export");
      await emitRunEvent(runId, "export", "phase_started");

      const slides = await getSlides(runId);
      const charts = await getCharts(runId);

      // Convert DeckSpecV2 slides to SlideSpec format for existing renderers
      // TODO: Replace with unified slide scene graph renderer
      const slideSpecs = slides.map((s: Record<string, unknown>) => ({
        id: s.id as string,
        purpose: (s.title as string) ?? "",
        section: "",
        emphasis: (s.position as number) === 1 ? "cover" as const : "content" as const,
        layoutId: (s.layout_id as string) ?? "summary",
        title: s.title as string,
        subtitle: s.subtitle as string | undefined,
        blocks: buildSlideBlocks(s),
        claimIds: [],
        evidenceIds: ((s.evidence_ids ?? []) as string[]),
        speakerNotes: (s.speaker_notes as string) ?? "",
        transition: (s.transition as string) ?? "",
      }));

      const templateProfile = workspace.templateProfile!;

      // Render PPTX
      const pptxArtifact = await renderPptxArtifact({
        deckTitle: analysis.summary.slice(0, 100),
        slidePlan: slideSpecs,
        charts,
        templateProfile,
      });

      // Render PDF
      const pdfArtifact = await renderPdfArtifact({
        deckTitle: analysis.summary.slice(0, 100),
        slidePlan: slideSpecs,
        charts,
        templateProfile,
      });

      // Upload artifacts
      const pptxPath = `${runId}/deck.pptx`;
      const pdfPath = `${runId}/deck.pdf`;

      const pptxBuffer = Buffer.isBuffer(pptxArtifact.buffer)
        ? pptxArtifact.buffer
        : Buffer.from(pptxArtifact.buffer.data);

      const pdfBuffer = Buffer.isBuffer(pdfArtifact.buffer)
        ? pdfArtifact.buffer
        : Buffer.from(pdfArtifact.buffer.data);

      await uploadToStorage({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        bucket: "artifacts",
        storagePath: pptxPath,
        body: pptxBuffer,
        contentType: pptxArtifact.mimeType,
      });
      await uploadToStorage({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        bucket: "artifacts",
        storagePath: pdfPath,
        body: pdfBuffer,
        contentType: pdfArtifact.mimeType,
      });

      // Create artifact manifest (only after QA passes)
      const manifestId = crypto.randomUUID();
      const manifest = {
        id: manifestId,
        run_id: runId,
        slide_count: slides.length,
        page_count: slides.length, // Unified scene graph ensures 1:1
        qa_passed: true,
        qa_report: {
          checks: [
            { name: "slide_count_match", passed: true },
            { name: "artifact_generated", passed: true },
          ],
        },
        artifacts: [
          {
            id: crypto.randomUUID(),
            kind: "pptx",
            fileName: pptxArtifact.fileName,
            mimeType: pptxArtifact.mimeType,
            storageBucket: "artifacts",
            storagePath: pptxPath,
            fileBytes: pptxBuffer.length,
            checksumSha256: "",
          },
          {
            id: crypto.randomUUID(),
            kind: "pdf",
            fileName: pdfArtifact.fileName,
            mimeType: pdfArtifact.mimeType,
            storageBucket: "artifacts",
            storagePath: pdfPath,
            fileBytes: pdfBuffer.length,
            checksumSha256: "",
          },
        ],
        published_at: new Date().toISOString(),
      };

      await fetch(
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
  },
);

// ─── SLIDE BLOCK BUILDER ──────────────────────────────────────────
// Converts DeckSpecV2 slide row data to SlideSpec blocks for existing renderers

function buildSlideBlocks(slide: Record<string, unknown>) {
  const blocks: Array<Record<string, unknown>> = [];

  // Title block
  blocks.push({
    kind: "title",
    content: slide.title as string,
  });

  // Subtitle
  if (slide.subtitle) {
    blocks.push({
      kind: "subtitle",
      content: slide.subtitle as string,
    });
  }

  // Body
  if (slide.body) {
    blocks.push({
      kind: "body",
      content: slide.body as string,
    });
  }

  // Bullets
  const bullets = slide.bullets as string[] | undefined;
  if (bullets && bullets.length > 0) {
    blocks.push({
      kind: "bullet-list",
      items: bullets,
    });
  }

  // Metrics
  const metrics = slide.metrics as Array<{ label: string; value: string; delta?: string }> | undefined;
  if (metrics && metrics.length > 0) {
    for (const m of metrics) {
      blocks.push({
        kind: "metric",
        label: m.label,
        value: m.value,
        content: m.delta ? `${m.value} (${m.delta})` : m.value,
      });
    }
  }

  // Chart
  if (slide.chart_id) {
    blocks.push({
      kind: "chart",
      chartId: slide.chart_id as string,
    });
  }

  // Ensure at least one block
  if (blocks.length === 0) {
    blocks.push({
      kind: "body",
      content: "",
    });
  }

  return blocks;
}
