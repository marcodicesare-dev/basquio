import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { parseEvidencePackage, streamParseFile, checksumSha256, loadRowsFromBlob, extractPptxSlideImages, type SheetManifest, type PptxSlideImage } from "@basquio/data-ingest";
import { runAnalystAgent, runAuthorAgent, runCriticAgent, runStrategicCriticAgent, type AnalystResult } from "@basquio/intelligence";
import { renderPdfArtifact } from "@basquio/render-pdf";
import { renderPptxArtifact } from "@basquio/render-pptx";
import { renderV2PptxArtifact, type V2ChartRow } from "@basquio/render-pptx/v2";
import { buildDeckSceneGraph, type DeckSceneGraph } from "@basquio/scene-graph";
import { createSystemTemplateProfile, interpretTemplateSource } from "@basquio/template-engine";
import {
  deckPlanSchema,
  type AnalysisReport,
  type ClarifiedBrief,
  type ChartSpec,
  type CritiqueReport,
  type DeckPlan,
  type DeckPlanSection,
  type DeckRunPhase,
  type DeckSpecV2,
  type EvidenceWorkspace,
  type SlideSpec,
  type StorylinePlan,
  type TemplateProfile,
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
  kicker?: string;
  body?: string;
  bullets?: string[];
  chartId?: string;
  metrics?: { label: string; value: string; delta?: string }[];
  callout?: { text: string; tone?: "accent" | "green" | "orange" };
  evidenceIds: string[];
  speakerNotes?: string;
  transition?: string;
  pageIntent?: string;
  governingThought?: string;
  chartIntent?: string;
  focalObject?: string;
  decisionAsk?: string;
  riskNote?: string;
  highlightCategories?: string[];
  recommendationBlock?: { condition: string; recommendation: string; quantification: string };
};

type ChartInput = {
  chartType: string;
  title: string;
  data: Record<string, unknown>[];
  xAxis?: string;
  yAxis?: string;
  series?: string[];
  style?: { colors?: string[]; showLegend?: boolean; showValues?: boolean; highlightCategories?: string[] };
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

async function updateDeliveryStatus(runId: string, deliveryStatus: string) {
  assertUuid(runId, "runId");
  await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_runs?id=eq.${runId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ delivery_status: deliveryStatus }),
    },
  );
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
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to persist notebook entry: ${response.status} ${response.statusText} — ${errorBody}`);
  }

  return id;
}

async function persistEvidenceEntry(runId: string, entry: {
  evidenceType: string;
  refId: string;
  label: string;
  description?: string;
  value?: unknown;
  sourceSheetKey?: string;
  sourceNotebookEntryId?: string;
  confidence?: number;
}) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_entries?on_conflict=run_id,ref_id`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=minimal,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        run_id: runId,
        evidence_type: entry.evidenceType,
        ref_id: entry.refId,
        label: entry.label,
        description: entry.description ?? null,
        value: entry.value ?? null,
        source_sheet_key: entry.sourceSheetKey ?? null,
        source_notebook_entry_id: entry.sourceNotebookEntryId ?? null,
        confidence: entry.confidence ?? null,
      }),
    },
  );
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to persist evidence entry ${entry.refId}: ${response.status} ${response.statusText} — ${errorBody}`);
  }
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
  kicker?: string;
  body?: string;
  bullets?: string[];
  chartId?: string;
  metrics?: { label: string; value: string; delta?: string }[];
  callout?: { text: string; tone?: "accent" | "green" | "orange" };
  evidenceIds: string[];
  speakerNotes?: string;
  transition?: string;
  pageIntent?: string;
  governingThought?: string;
  chartIntent?: string;
  focalObject?: string;
  decisionAsk?: string;
  riskNote?: string;
  highlightCategories?: string[];
  recommendationBlock?: { condition: string; recommendation: string; quantification: string };
}) {
  // Upsert on (run_id, position, revision) unique constraint.
  // on_conflict tells PostgREST which constraint to use for merge-duplicates.
  // Without it, PostgREST defaults to the PK which won't match on retries.
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_slides?on_conflict=run_id,position,revision`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=representation,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        run_id: runId,
        position: slide.position,
        revision: 1,
        layout_id: slide.layoutId,
        title: cleanNewlines(slide.title),
        subtitle: slide.subtitle ? cleanNewlines(slide.subtitle) : undefined,
        kicker: slide.kicker ? cleanNewlines(slide.kicker) : undefined,
        body: slide.body ? cleanNewlines(slide.body) : undefined,
        bullets: slide.bullets?.map(cleanNewlines),
        chart_id: slide.chartId,
        metrics: slide.metrics,
        callout: slide.callout,
        evidence_ids: slide.evidenceIds,
        speaker_notes: slide.speakerNotes ? cleanNewlines(slide.speakerNotes) : undefined,
        transition: slide.transition,
        page_intent: slide.pageIntent,
        governing_thought: slide.governingThought,
        chart_intent: slide.chartIntent,
        focal_object: slide.focalObject,
        decision_ask: slide.decisionAsk,
        risk_note: slide.riskNote,
        highlight_categories: slide.highlightCategories,
        recommendation_block: slide.recommendationBlock,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to persist slide (pos ${slide.position}) for run ${runId}: ${response.status} ${response.statusText} — ${errorBody}`);
  }

  // Extract the id from the response (either newly generated or existing)
  const rows = await response.json();
  const slideId = Array.isArray(rows) && rows.length > 0 ? rows[0].id : crypto.randomUUID();

  return { slideId, previewUrl: undefined, warnings: [] };
}

async function persistChart(runId: string, chart: {
  chartType: string;
  title: string;
  data: Record<string, unknown>[];
  xAxis?: string;
  yAxis?: string;
  series?: string[];
  style?: { colors?: string[]; showLegend?: boolean; showValues?: boolean; highlightCategories?: string[] };
  // Semantic fields from chart design system
  intent?: string;
  unit?: string;
  benchmarkLabel?: string;
  benchmarkValue?: number;
  sourceNote?: string;
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
        intent: chart.intent ?? null,
        unit: chart.unit ?? null,
        benchmark_label: chart.benchmarkLabel ?? null,
        benchmark_value: chart.benchmarkValue ?? null,
        source_note: chart.sourceNote ?? null,
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to persist chart ${id} for run ${runId}: ${response.status} ${response.statusText} — ${errorBody}`);
  }

  return { chartId: id, thumbnailUrl: undefined, width: 800, height: 500 };
}

async function getChartMeta(chartId: string): Promise<{ chartType: string; categoryCount: number; seriesCount: number; rowCount?: number; colCount?: number } | null> {
  assertUuid(chartId, "chartId");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_charts?id=eq.${chartId}&select=chart_type,data,series`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ chart_type: string; data: Record<string, unknown>[]; series: string[] | null }>;
  if (rows.length === 0) return null;
  const row = rows[0];
  const categoryCount = Array.isArray(row.data) ? row.data.length : 0;
  const seriesCount = Array.isArray(row.series) ? row.series.length : 1;
  // For table-type charts, estimate columns from first row
  const colCount = categoryCount > 0 && typeof row.data[0] === "object" ? Object.keys(row.data[0]).length : 0;
  return {
    chartType: row.chart_type,
    categoryCount,
    seriesCount,
    rowCount: row.chart_type === "table" ? categoryCount : undefined,
    colCount: row.chart_type === "table" ? colCount : undefined,
  };
}

type SlideRow = {
  id: string;
  position: number;
  layoutId: string;
  title: string;
  subtitle: string | undefined;
  kicker: string | undefined;
  body: string | undefined;
  bullets: string[] | undefined;
  chartId: string | undefined;
  evidenceIds: string[];
  metrics: { label: string; value: string; delta?: string }[] | undefined;
  callout: { text: string; tone?: "accent" | "green" | "orange" } | undefined;
  speakerNotes: string | undefined;
  transition: string | undefined;
  pageIntent: string | undefined;
  governingThought: string | undefined;
  chartIntent: string | undefined;
  focalObject: string | undefined;
  highlightCategories: string[] | undefined;
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
    kicker: r.kicker as string | undefined,
    body: r.body as string | undefined,
    bullets: r.bullets as string[] | undefined,
    chartId: r.chart_id as string | undefined,
    evidenceIds: (r.evidence_ids ?? []) as string[],
    metrics: r.metrics as { label: string; value: string; delta?: string }[] | undefined,
    callout: r.callout as { text: string; tone?: "accent" | "green" | "orange" } | undefined,
    speakerNotes: r.speaker_notes as string | undefined,
    transition: r.transition as string | undefined,
    pageIntent: r.page_intent as string | undefined,
    governingThought: r.governing_thought as string | undefined,
    chartIntent: r.chart_intent as string | undefined,
    focalObject: r.focal_object as string | undefined,
    highlightCategories: r.highlight_categories as string[] | undefined,
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
      highlightCategories: (r.style as Record<string, unknown> | null)?.highlightCategories as string[] | undefined,
    },
    // Semantic fields from DB
    intent: (r.intent as string) ?? undefined,
    unit: (r.unit as string) ?? undefined,
    benchmarkLabel: (r.benchmark_label as string) ?? undefined,
    benchmarkValue: r.benchmark_value != null ? Number(r.benchmark_value) : undefined,
    sourceNote: (r.source_note as string) ?? undefined,
  }));
}

async function listEvidenceForRun(runId: string): Promise<Array<{
  evidenceRefId: string;
  toolName: string;
  summary: string;
}>> {
  // Try evidence_entries first (typed registry), fall back to notebook entries
  const typedResponse = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_entries?run_id=eq.${runId}&select=ref_id,evidence_type,label,description,value,confidence`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );

  if (typedResponse.ok) {
    const typedRows = await typedResponse.json();
    if (typedRows.length > 0) {
      return typedRows.map((r: Record<string, unknown>) => ({
        evidenceRefId: r.ref_id as string,
        toolName: r.evidence_type as string,
        summary: (r.description as string) || (r.label as string) || "",
        label: (r.label as string) || "",
        value: r.value,
        confidence: r.confidence as number | null,
      }));
    }
  }

  // Fall back to old notebook query
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/analysis_notebook_entries?run_id=eq.${runId}&evidence_ref_id=not.is.null&select=evidence_ref_id,tool_name,tool_input,tool_output`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );

  if (!response.ok) return [];

  const rows = await response.json();
  return rows.map((r: Record<string, unknown>) => {
    const output = r.tool_output as Record<string, unknown>;
    const input = r.tool_input as Record<string, unknown>;
    return {
      evidenceRefId: r.evidence_ref_id as string,
      toolName: r.tool_name as string,
      label: (input?.name as string) || "",
      summary: typeof output?.summary === "string"
        ? output.summary as string
        : JSON.stringify(output).slice(0, 300),
      value: output?.value ?? output?.breakdown ?? null,
      confidence: null,
    };
  });
}

async function getNotebookEntry(evidenceRefId: string) {
  // Primary: query evidence_entries (typed registry, single source of truth)
  const evidenceResponse = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_entries?ref_id=eq.${encodeURIComponent(evidenceRefId)}&limit=1`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );

  if (evidenceResponse.ok) {
    const evidenceRows = await evidenceResponse.json();
    if (evidenceRows.length > 0) {
      const row = evidenceRows[0];
      return {
        toolName: row.evidence_type as string,
        toolOutput: {
          value: row.value,
          label: row.label,
          description: row.description,
          confidence: row.confidence,
          evidenceType: row.evidence_type,
        } as Record<string, unknown>,
      };
    }
  }

  // Fallback: query notebook entries (for backward compat with older runs)
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

// ─── WORKING PAPERS PERSISTENCE ──────────────────────────────────

async function persistWorkingPaper(runId: string, paperType: string, content: unknown, version = 1) {
  assertUuid(runId, "runId");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/working_papers?on_conflict=run_id,paper_type,version`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=minimal,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        run_id: runId,
        paper_type: paperType,
        content,
        version,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to persist working paper ${paperType}: ${response.status} ${response.statusText} — ${errorBody}`);
  }
}

async function loadWorkingPaper<T = unknown>(runId: string, paperType: string): Promise<T | null> {
  assertUuid(runId, "runId");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/working_papers?run_id=eq.${runId}&paper_type=eq.${paperType}&order=version.desc&limit=1`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ content: T }>;
  return rows[0]?.content ?? null;
}

async function loadWorkspaceFromDb(runId: string): Promise<EvidenceWorkspace | null> {
  assertUuid(runId, "runId");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspaces?run_id=eq.${runId}&limit=1`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) return null;
  const rows = await response.json() as Array<{
    id: string;
    run_id: string;
    file_inventory: unknown;
    dataset_profile: unknown;
    package_semantics: unknown;
    template_profile: unknown;
    blob_manifest: unknown;
  }>;
  if (!rows[0]) return null;
  // Reconstruct EvidenceWorkspace from the individual columns
  const row = rows[0];
  return {
    fileInventory: row.file_inventory as EvidenceWorkspace["fileInventory"],
    datasetProfile: row.dataset_profile as EvidenceWorkspace["datasetProfile"],
    packageSemantics: row.package_semantics as EvidenceWorkspace["packageSemantics"],
    templateProfile: row.template_profile as EvidenceWorkspace["templateProfile"],
    sheetData: {},
  } as EvidenceWorkspace;
}

function createLoadSheetRows(runId: string) {
  return async (sheetKey: string): Promise<Record<string, unknown>[]> => {
    const sheetRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspace_sheets?workspace_id=eq.${runId}&sheet_key=eq.${encodeURIComponent(sheetKey)}&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          Accept: "application/json",
        },
      },
    );
    if (!sheetRes.ok) return [];
    const sheets = await sheetRes.json() as Array<{ blob_path: string }>;
    if (!sheets[0]?.blob_path) return [];
    const blobBuffer = await downloadFromStorage({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      bucket: "evidence-workspace-blobs",
      storagePath: sheets[0].blob_path,
    });
    return loadRowsFromBlob(blobBuffer);
  };
}

// ─── CONTACT SHEET RENDERER ──────────────────────────────────────

async function renderContactSheetForRun(runId: string): Promise<{
  available: boolean;
  slideCount: number;
  thumbnailDescriptions: string[];
  deckLevelIssues: string[];
} | null> {
  const browserlessToken = process.env.BROWSERLESS_TOKEN;
  const browserlessUrl = process.env.BROWSERLESS_URL ?? "https://production-sfo.browserless.io";
  if (!browserlessToken) return null;

  try {
    const slides = await getSlides(runId);
    const chartRows = await getV2ChartRows(runId);
    if (slides.length === 0) return null;

    // Generate per-slide HTML thumbnails description
    // Instead of actual pixel rendering (which costs ~3-5s), provide a structured
    // visual description computed from the slide data + scene graph layout regions
    const descriptions: string[] = [];
    const deckIssues: string[] = [];

    // Track layout sequence for rhythm analysis
    const layouts: string[] = [];
    let consecutiveSameLayout = 0;
    let maxConsecutive = 0;

    for (const slide of slides) {
      const layout = slide.layoutId ?? "title-body";
      layouts.push(layout);

      // Track consecutive same layout
      if (layouts.length > 1 && layout === layouts[layouts.length - 2]) {
        consecutiveSameLayout++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveSameLayout);
      } else {
        consecutiveSameLayout = 0;
      }

      const hasChart = Boolean(slide.chartId);
      const chart = hasChart ? chartRows.find(c => c.id === slide.chartId) : undefined;
      const hasBody = Boolean(slide.body && slide.body.trim().length > 10);
      const hasMetrics = Boolean(slide.metrics && slide.metrics.length > 0);
      const hasBullets = Boolean(slide.bullets && slide.bullets.length > 0);
      const hasCallout = Boolean(slide.callout);
      const hasKicker = Boolean(slide.kicker);

      // Build visual description
      const parts: string[] = [`Slide ${slide.position} [${layout}]`];
      parts.push(`Title: "${slide.title.slice(0, 50)}"`);
      if (hasKicker) parts.push(`Kicker: ${slide.kicker}`);
      if (hasMetrics) parts.push(`${slide.metrics!.length} KPI cards`);
      if (hasChart && chart) {
        const catCount = (chart as { data: unknown[] }).data?.length ?? 0;
        parts.push(`Chart: ${(chart as { chartType: string }).chartType} (${catCount} categories)`);
        if (catCount > 12) parts.push("⚠ Chart has >12 categories — may be unreadable");
      }
      if (hasBody) parts.push(`Body: ${slide.body!.split(/\s+/).length}w`);
      if (hasBullets) parts.push(`${slide.bullets!.length} bullets`);
      if (hasCallout) parts.push(`Callout [${slide.callout!.tone ?? "accent"}]`);
      if (!hasCallout && layout !== "cover") parts.push("⚠ No callout");

      descriptions.push(parts.join(" | "));
    }

    // Deck-level visual issues
    const uniqueLayouts = new Set(layouts).size;
    if (uniqueLayouts < 3 && slides.length > 5) {
      deckIssues.push(`Only ${uniqueLayouts} unique layouts — need 4+ for visual variety`);
    }
    if (maxConsecutive >= 2) {
      deckIssues.push(`${maxConsecutive + 1} consecutive slides with same layout — breaks visual rhythm`);
    }

    // Check if cover and summary bookend the deck
    if (slides[0]?.layoutId !== "cover") {
      deckIssues.push("First slide is not a cover");
    }
    const lastSlide = slides[slides.length - 1];
    if (lastSlide?.layoutId !== "summary" && slides.length > 5) {
      deckIssues.push("Last slide is not a summary/recommendation");
    }

    return {
      available: true,
      slideCount: slides.length,
      thumbnailDescriptions: descriptions,
      deckLevelIssues: deckIssues,
    };
  } catch (error) {
    console.error("[renderContactSheet] Failed:", error);
    return null;
  }
}

// ─── SECTION BRIEF BUILDER ────────────────────────────────────────

function buildSectionBrief(
  originalBrief: string,
  section: DeckPlanSection,
  analystResult: { analysis: AnalysisReport; clarifiedBrief: ClarifiedBrief | null; storylinePlan: StorylinePlan | null },
  deckPlan: DeckPlan,
): string {
  const focalEntity = analystResult.clarifiedBrief?.focalEntity ?? "";
  const language = analystResult.clarifiedBrief?.language ?? "en";

  const slideSpecs = section.slides
    .map((s) => `  Slide ${s.position}: [${s.role}] ${s.layout} — "${s.governingThought}" (chart: ${s.chartIntent}, focal: ${s.focalObject}, evidence: [${s.evidenceRequired.join(", ")}])`)
    .join("\n");

  return `${originalBrief}

SECTION: "${section.title}" (${section.slides.length} slides)
This section addresses: ${section.issueBranch}

FOCAL ENTITY: ${focalEntity}
LANGUAGE: ${language}

SLIDES TO BUILD:
${slideSpecs}

CONTEXT: This is section "${section.title}" of a ${deckPlan.targetSlideCount}-slide deck. Only build the ${section.slides.length} slides listed above. Do NOT build slides for other sections.

IMPORTANT: Follow the governing thought for each slide — it states the ONE claim that slide must communicate. Build a chart matching the chart intent, then write the slide with that chart.`;
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
      templateFileId,
    } = event.data as {
      runId: string;
      organizationId: string;
      projectId: string;
      sourceFileIds: string[];
      brief: string;
      templateProfileId?: string;
      templateFileId?: string;
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
          pages: supportFile?.pages,
          pageCount: supportFile?.pageCount,
          warnings: supportFile?.warnings ?? [],
        };
      });

      // Parse template — from saved profile, uploaded file, or system default
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
      // If no saved profile, try interpreting from uploaded template file
      if (!templateProfile && templateFileId) {
        try {
          const templateFileResponse = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/source_files?id=eq.${templateFileId}&limit=1`,
            {
              headers: {
                apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
              },
            },
          );
          const templateFiles = await templateFileResponse.json();
          if (templateFiles.length > 0) {
            const tf = templateFiles[0];
            const templateBlobResponse = await fetch(
              `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${tf.storage_bucket}/${tf.storage_path}`,
              {
                headers: {
                  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
                  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
                },
              },
            );
            if (templateBlobResponse.ok) {
              const templateBuffer = Buffer.from(await templateBlobResponse.arrayBuffer());
              templateProfile = await interpretTemplateSource({
                id: templateFileId,
                fileName: tf.file_name,
                sourceFile: {
                  fileName: tf.file_name,
                  mediaType: tf.media_type ?? "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  base64: templateBuffer.toString("base64"),
                },
              });
            }
          }
        } catch (e) {
          console.warn("Failed to interpret template file, falling back to default:", e);
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
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspaces?on_conflict=run_id`,
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
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspace_sheets?on_conflict=workspace_id,sheet_key`,
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

      // Register ALL non-workbook files as evidence entries
      // so the analyst and author can cite them by evidence ref ID.
      // Even files without extractable text get entries — they serve as
      // placeholders the model can reference ("per [fileName]").
      for (const f of fileInventory) {
        if (f.kind === "workbook") continue; // workbook evidence comes from sheet registration + compute_metric

        const refId = `doc-${f.id.slice(0, 8)}`;
        const isImage = /\.(png|jpg|jpeg|gif|svg|webp|bmp|tiff?)$/i.test(f.fileName);
        const isPdf = /\.pdf$/i.test(f.fileName);
        const isPptx = /\.pptx?$/i.test(f.fileName);

        let evidenceType: string;
        let description: string;

        if (isImage) {
          evidenceType = "visual";
          // Try vision extraction for images — best effort, don't block pipeline
          let visionDescription: string | undefined;
          try {
            const imageBuffer = fileBuffers.find((fb) => fb.id === f.id)?.buffer;
            if (imageBuffer && process.env.OPENAI_API_KEY) {
              const base64 = imageBuffer.toString("base64");
              const ext = f.fileName.split(".").pop()?.toLowerCase() ?? "png";
              const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/png";

              const visionResp = await fetch("https://api.openai.com/v1/responses", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                  model: "gpt-5.4",
                  input: [{
                    role: "user",
                    content: [
                      { type: "input_text", text: "Describe this image for a business analyst. If it contains a chart, table, or data visualization, extract the key data points, labels, values, and trends. If it contains text, extract it. Be specific and quantitative." },
                      { type: "input_image", image_url: `data:${mimeType};base64,${base64}`, detail: "high" },
                    ],
                  }],
                }),
              });

              if (visionResp.ok) {
                const visionData = await visionResp.json();
                visionDescription = visionData.output_text;
              }
            }
          } catch (visionErr) {
            // Vision extraction is best-effort — don't block normalize, but log
            logPhaseEvent(runId, "normalize", "vision_extraction_error", {
              fileName: f.fileName,
              error: visionErr instanceof Error ? visionErr.message : "unknown",
            });
          }

          description = visionDescription
            ? `Image: ${f.fileName} — ${visionDescription.slice(0, 300)}`
            : `Image file: ${f.fileName} — visual evidence (cite by file name)`;
        } else if (f.textContent) {
          evidenceType = "document";
          description = `${f.kind} document: ${f.fileName} (${f.textContent.length} chars extracted)`;
        } else if (isPdf) {
          evidenceType = "document";
          description = `PDF file: ${f.fileName} — text extraction may be incomplete (scanned/image-based PDF)`;
        } else if (isPptx) {
          evidenceType = "document";
          description = `PPTX file: ${f.fileName} — slide text extracted`;
        } else {
          evidenceType = "document";
          description = `${f.kind} file: ${f.fileName}`;
        }

        // Confidence scoring by source quality
        const confidence = isImage ? 0.30
          : f.kind === "pptx" ? 0.70
          : f.kind === "pdf" ? 0.65
          : f.textContent ? 0.70
          : 0.30;

        await persistEvidenceEntry(runId, {
          evidenceType,
          refId,
          label: f.fileName,
          description,
          confidence,
          value: f.textContent
            ? { text: f.textContent.slice(0, 20000), truncated: f.textContent.length > 20000, charCount: f.textContent.length }
            : isImage && description.startsWith("Image: ")
              ? { visionExtracted: true, description: description.slice(7), fileName: f.fileName }
              : { noTextExtracted: true, fileKind: f.kind, fileName: f.fileName },
        });

        // Register page-level evidence for PDFs and per-slide for PPTXs
        const pages = (f as Record<string, unknown>).pages as Array<{ num: number; text: string }> | undefined;
        if (pages && pages.length > 0) {
          for (const page of pages) {
            const pageRefId = `${refId}-page-${page.num}`;
            // Check if page has table data (higher confidence for structured content)
            const hasTable = page.text.includes("[Table data]");
            const hasChart = page.text.includes("[Chart data]");
            const pageConfidence = hasTable ? 0.85 : hasChart ? 0.80 : f.kind === "pdf" ? 0.65 : 0.70;

            await persistEvidenceEntry(runId, {
              evidenceType: hasTable ? "table" : "document",
              refId: pageRefId,
              label: `${f.fileName} — page ${page.num}`,
              description: page.text.slice(0, 200),
              confidence: pageConfidence,
              value: { text: page.text, pageNum: page.num, sourceFile: f.fileName, hasTable, hasChart },
            });
          }
        }
      }

      // ─── PPTX VISION EXTRACTION ─────────────────────────────────────
      // For PPTX files: run GPT-5.4 vision on slides that have visual content
      // the OOXML XML parser can't read (shapes, SmartArt, grouped objects, images).
      //
      // Strategy:
      // 1. Slides WITH embedded images → send the image(s) to vision
      // 2. Slides WITHOUT images but with shapes/SmartArt → send ALL embedded
      //    images from the entire PPTX as context (the model can identify which
      //    images belong to which visual). This is a fallback; full-slide rendering
      //    via LibreOffice/Browserless would be better but adds infra complexity.
      // 3. Request STRUCTURED JSON, not prose, for downstream evidence quality.
      for (const f of fileInventory) {
        if (!/\.pptx?$/i.test(f.fileName)) continue;

        const fileBuffer = fileBuffers.find((fb) => fb.id === f.id)?.buffer;
        if (!fileBuffer || !process.env.OPENAI_API_KEY) continue;

        try {
          const slideImages = await extractPptxSlideImages(fileBuffer);
          // Process ALL slides that need vision — not just those with embedded images
          const slidesNeedingVision = slideImages.filter((s) => s.needsVision);

          if (slidesNeedingVision.length > 0) {
            logPhaseEvent(runId, "normalize", "pptx_vision_extraction_started", {
              fileName: f.fileName,
              totalSlides: slideImages.length,
              slidesNeedingVision: slidesNeedingVision.length,
              withImages: slidesNeedingVision.filter((s) => s.images.length > 0).length,
              withoutImages: slidesNeedingVision.filter((s) => s.images.length === 0).length,
            });

            // Collect ALL images from the PPTX for slides that have no embedded images
            // (these slides have shapes/SmartArt drawn programmatically)
            const allPptxImages = slideImages.flatMap((s) => s.images);

            // Process up to 30 slides (vision is cheap: ~$0.02/slide)
            for (const slide of slidesNeedingVision.slice(0, 10)) {
              // Determine which images to send
              const slideHasOwnImages = slide.images.length > 0;
              const imagesToSend = slideHasOwnImages
                ? slide.images.slice(0, 4) // up to 4 images per slide
                : allPptxImages.slice(0, 2); // fallback: send first 2 PPTX images as context

              // Also include the slide's XML-extracted text as context
              const existingPage = (f as Record<string, unknown>).pages as Array<{ num: number; text: string }> | undefined;
              const slideText = existingPage?.find((p) => p.num === slide.slideNum)?.text ?? "";

              try {
                // Build the vision request with structured extraction prompt
                const contentParts: Array<Record<string, unknown>> = [
                  {
                    type: "input_text",
                    text: `You are extracting structured data from slide ${slide.slideNum} of "${f.fileName}" for a business intelligence system.

CONTEXT FROM XML PARSING (may be incomplete):
${slideText.slice(0, 1000) || "(no text extracted from XML)"}

SLIDE METADATA:
- Has shapes: ${slide.hasShapes}
- Has SmartArt: ${slide.hasSmartArt}
- Has grouped shapes: ${slide.hasGroupedShapes}
- Has native chart (already extracted): ${slide.hasNativeChart}

YOUR TASK: Extract ALL quantitative data visible in the image(s) below.

Return a JSON object with this structure:
{
  "slideTitle": "...",
  "charts": [{ "chartType": "bar|line|pie|stacked|scatter|waterfall|other", "title": "...", "categories": ["..."], "series": [{ "name": "...", "values": [number, ...] }], "unit": "€|%|units|..." }],
  "tables": [{ "title": "...", "headers": ["..."], "rows": [["...", ...]] }],
  "keyMetrics": [{ "label": "...", "value": "...", "unit": "..." }],
  "textContent": "...",
  "visualDescription": "..."
}

Be exhaustive. Every number matters. If a value is approximate, note it. If you can't read a value, say "unreadable".`,
                  },
                ];

                // Add images
                for (const img of imagesToSend) {
                  contentParts.push({
                    type: "input_image",
                    image_url: `data:${img.mimeType};base64,${img.base64}`,
                    detail: "high",
                  });
                }

                // If no images at all, add the text context and skip vision
                if (imagesToSend.length === 0 && !slideText) continue;
                if (imagesToSend.length === 0) {
                  // No images available — can't do vision, but we have text context
                  // Skip this slide for vision extraction
                  continue;
                }

                const visionResp = await fetch("https://api.openai.com/v1/responses", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                  },
                  body: JSON.stringify({
                    model: "gpt-5.4",
                    input: [{ role: "user", content: contentParts }],
                    text: { format: { type: "json_object" } },
                  }),
                });

                if (visionResp.ok) {
                  const visionData = await visionResp.json();
                  const rawOutput = visionData.output_text ?? "";

                  // Try to parse as JSON
                  let structured: Record<string, unknown> | null = null;
                  try {
                    // Extract JSON from potential markdown code block
                    const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)```/) ?? rawOutput.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                      structured = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
                    }
                  } catch { /* fall back to raw text */ }

                  const extractedText = structured
                    ? JSON.stringify(structured)
                    : rawOutput;

                  if (extractedText && extractedText.length > 30) {
                    const refId = `doc-${f.id.slice(0, 8)}-slide-${slide.slideNum}-vision`;

                    // Build rich description from structured data
                    let description = "";
                    if (structured) {
                      const charts = (structured.charts as Array<Record<string, unknown>>) ?? [];
                      const tables = (structured.tables as Array<Record<string, unknown>>) ?? [];
                      const metrics = (structured.keyMetrics as Array<Record<string, unknown>>) ?? [];
                      const parts: string[] = [];
                      if (charts.length > 0) parts.push(`${charts.length} chart(s): ${charts.map((c) => `${c.chartType} "${c.title}"`).join(", ")}`);
                      if (tables.length > 0) parts.push(`${tables.length} table(s)`);
                      if (metrics.length > 0) parts.push(`${metrics.length} metric(s): ${metrics.map((m) => `${m.label}=${m.value}`).join(", ")}`);
                      description = parts.join("; ") || ((structured.visualDescription as string) ?? "");
                    } else {
                      description = rawOutput.slice(0, 300);
                    }

                    await persistEvidenceEntry(runId, {
                      evidenceType: "visual",
                      refId,
                      label: `${f.fileName} — slide ${slide.slideNum} (vision extracted)`,
                      description: description.slice(0, 300),
                      confidence: 0.50, // Vision extraction — uncertain
                      value: structured
                        ? {
                            ...structured,
                            slideNum: slide.slideNum,
                            sourceFile: f.fileName,
                            extractionMethod: "gpt-5.4-vision-structured",
                          }
                        : {
                            text: rawOutput,
                            slideNum: slide.slideNum,
                            sourceFile: f.fileName,
                            extractionMethod: "gpt-5.4-vision-text",
                          },
                    });

                    // Enrich existing page evidence
                    const existingPageRef = `doc-${f.id.slice(0, 8)}-page-${slide.slideNum}`;
                    await persistEvidenceEntry(runId, {
                      evidenceType: "document",
                      refId: existingPageRef,
                      label: `${f.fileName} — slide ${slide.slideNum}`,
                      description: `[Vision-enriched] ${description.slice(0, 200)}`,
                      value: {
                        text: structured ? JSON.stringify(structured) : rawOutput,
                        pageNum: slide.slideNum,
                        sourceFile: f.fileName,
                        visionEnriched: true,
                      },
                    });
                  }
                }
              } catch (slideVisionErr) {
                // Vision extraction is best-effort per slide — don't block normalize, but log
                logPhaseEvent(runId, "normalize", "slide_vision_error", {
                  fileName: f.fileName,
                  error: slideVisionErr instanceof Error ? slideVisionErr.message : "unknown",
                });
              }
            }

            logPhaseEvent(runId, "normalize", "pptx_vision_extraction_completed", {
              fileName: f.fileName,
              slidesProcessed: Math.min(slidesNeedingVision.length, 30),
            });
          }
        } catch {
          logPhaseEvent(runId, "normalize", "pptx_vision_extraction_skipped", {
            fileName: f.fileName,
            reason: "extractPptxSlideImages failed",
          });
        }
      }

      // Register workbook sheets as evidence entries (metadata only, actual data via tools)
      // Use a short hash of the sheetKey to avoid ref_id collisions from UUID truncation
      for (const manifest of allSheetManifests) {
        // Deterministic short hash: take last 8 of fileId + sanitized sheet name
        const fileIdShort = manifest.sourceFileId.slice(-8);
        const sheetNameSafe = manifest.sheetName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 20);
        const refId = `sheet-${fileIdShort}-${sheetNameSafe}`;
        await persistEvidenceEntry(runId, {
          evidenceType: "table",
          refId,
          label: `${manifest.sourceFileName} → ${manifest.sheetName}`,
          description: `${manifest.rowCount} rows × ${manifest.columnCount} columns`,
          value: {
            rowCount: manifest.rowCount,
            columnCount: manifest.columnCount,
            columns: manifest.columns.map((c: { name: string; inferredType: string; role: string }) => ({
              name: c.name,
              type: c.inferredType,
              role: c.role,
            })),
          },
          sourceSheetKey: manifest.sheetKey,
          confidence: 1.0, // Fully structured tabular data
        });
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
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspace_sheets?workspace_id=eq.${runId}&sheet_key=eq.${encodeURIComponent(sheetKey)}&select=blob_bucket,blob_path,sample_rows&limit=1`,
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
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspace_sheets?workspace_id=eq.${runId}&select=sheet_key,blob_bucket,blob_path,sample_rows`,
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

    // ─── STEP 2: UNDERSTAND (invoked as child function) ────────
    const analystResult = await step.invoke("understand", {
      function: basquioUnderstand,
      data: { runId, brief },
      timeout: "20m",
    }) as AnalystResult;

    // ─── STEP 2.5+3+4: PLAN + AUTHOR + POLISH (child function) ────
    // Entire plan → author → polish block runs in a child function with
    // its own 25min timeout. Isolates the most token-heavy phase.
    const authorResult = await step.invoke("author-polish", {
      function: basquioAuthor,
      data: { runId, brief },
      timeout: "25m",
    }) as { deckSummary: string; slideCount: number; chartCount: number };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const deckSummary = authorResult.deckSummary;

    // Plan+Author+Polish code has been moved to basquioAuthor child function.
    // Dead code removed — see basquioAuthor for the implementation.

    // ─── STEP 4+5: CRITIQUE + REVISE (invoked as child function) ───
    const critiqueReviseResult = await step.invoke("critique-revise", {
      function: basquioCritiqueRevise,
      data: { runId, brief, sourceFileIds },
      timeout: "25m",
    }) as { hasCriticalOrMajor: boolean; degradedDelivery: boolean; degradedIssues: Array<{ severity: string; claim: string }> };

    const { hasCriticalOrMajor, degradedDelivery, degradedIssues } = critiqueReviseResult;

    // OLD INLINE CRITIQUE+REVISE CODE — replaced by step.invoke(basquioCritiqueRevise)
    // Kept as dead code reference for the child function implementation.

    // ─── STEP 6: EXPORT (invoked as separate Inngest function) ─────
    // Export runs as a child function with its own 15min timeout and retries.
    // This eliminates replay overhead from the 20+ steps in the parent.
    const artifacts = await step.invoke("export", {
      function: basquioExport,
      data: {
        runId,
        exportMode: (event.data as Record<string, unknown>).exportMode as string | undefined,
        hasCriticalOrMajor,
        degradedDelivery,
        degradedIssues,
        deckTitle: brief.slice(0, 100),
        sourceFileIds,
      },
      timeout: "15m",
    });

    // Export child function handles: source coverage, PPTX render, QA, manifest, status update.

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
      await updateDeliveryStatus(runId, "failed").catch(() => {});
      await updateRunStatus(runId, "failed", undefined, {
        failure_message: message.slice(0, 1000),
      }).catch(() => {}); // best-effort — don't mask the original error
      throw error; // re-throw so Inngest knows the function failed
    }
  },
);

// ─── CHILD FUNCTIONS (invoked via step.invoke for resilience) ─────

/**
 * basquioUnderstand: Analyst agent exploration as independent function.
 * Runs GPT-5.4 with up to 30 tool loop iterations.
 */
export const basquioUnderstand = inngest.createFunction(
  { id: "basquio-understand", retries: 2, timeouts: { finish: "20m" } },
  { event: "basquio/understand.requested" },
  async ({ event, step }) => {
    const { runId, brief } = event.data as { runId: string; brief: string };

    return step.run("run-analyst", async () => {
      await updateRunStatus(runId, "running", "understand");
      await emitRunEvent(runId, "understand", "phase_started");

      const workspace = await loadWorkspaceFromDb(runId);
      if (!workspace) throw new Error(`Workspace not found for run ${runId}`);
      const loadRows = createLoadSheetRows(runId);

      const tracker = new UsageTracker();
      tracker.startPhase("understand", "gpt-5.4", "openai");

      const result = await runAnalystAgent({
        workspace,
        runId,
        brief,
        loadRows,
        persistNotebookEntry: async (entry: NotebookEntry) => {
          const notebookId = await persistNotebookEntry(runId, "understand", 0, entry);
          if (entry.evidenceRefId) {
            await persistEvidenceEntry(runId, {
              evidenceType: entry.toolName === "compute_metric" ? "metric" : entry.toolName === "compute_statistical" ? "statistical" : entry.toolName === "query_data" ? "table" : "document",
              refId: entry.evidenceRefId,
              label: (entry.toolInput as Record<string, unknown>)?.name as string ?? entry.toolName,
              description: (entry.toolInput as Record<string, unknown>)?.description as string
                ?? (entry.toolOutput as Record<string, unknown>)?.summary as string
                ?? undefined,
              value: entry.toolOutput,
              sourceSheetKey: (entry.toolInput as Record<string, unknown>)?.file as string ?? undefined,
              sourceNotebookEntryId: notebookId,
            });
          }
          return notebookId;
        },
        onStepFinish: async (event: StepFinishEvent) => {
          tracker.recordStep(event.usage, event.toolCalls.length);
        },
      });

      tracker.endPhase();

      // Persist working papers
      try {
        if (result.clarifiedBrief) await persistWorkingPaper(runId, "clarified_brief", result.clarifiedBrief);
        if (result.storylinePlan) await persistWorkingPaper(runId, "storyline_plan", result.storylinePlan);
        await persistWorkingPaper(runId, "analysis_result", {
          analysis: result.analysis,
          clarifiedBrief: result.clarifiedBrief,
          storylinePlan: result.storylinePlan,
        });

        // Persist RunIntent — the single source of truth for "what are we building"
        const runIntent = {
          analysisMode: "deep_analysis" as const,
          requestedSlideCount: result.clarifiedBrief?.requestedSlideCount ?? null,
          audience: result.clarifiedBrief?.audience ?? "Executive stakeholder",
          focalEntity: result.clarifiedBrief?.focalEntity ?? "",
          coreQuestion: result.clarifiedBrief?.objective ?? brief,
          exportMode: ((event.data as Record<string, unknown>).exportMode as string) ?? "powerpoint-native",
          costTier: "standard" as const,
          language: result.clarifiedBrief?.language ?? "en",
          evidenceConfidence: result.analysis?.topFindings?.length > 0 ? 0.7 : 0.3,
          sourceManifest: (workspace.fileInventory ?? []).map((f: { fileId?: string; fileName?: string; kind?: string }) => ({
            fileId: f.fileId ?? "",
            fileName: f.fileName ?? "",
            kind: f.kind ?? "unknown",
            hasTabularData: f.kind === "workbook",
            hasVisualContent: ["pptx", "image"].includes(f.kind ?? ""),
          })),
        };
        await persistWorkingPaper(runId, "run_intent", runIntent);
      } catch (error) {
        console.error("[understand] Failed to persist working papers:", error);
      }

      return {
        analysis: result.analysis,
        clarifiedBrief: result.clarifiedBrief,
        storylinePlan: result.storylinePlan,
        costSummary: tracker.getSummary(runId),
      };
    });
  },
);

/**
 * basquioAuthor: Plan + Author + Polish as independent function.
 * Reads analyst output from working papers, plans deck, authors sections
 * in parallel, then polishes weak slides.
 */
export const basquioAuthor = inngest.createFunction(
  { id: "basquio-author", retries: 1, timeouts: { finish: "25m" } },
  { event: "basquio/author.requested" },
  async ({ event, step }) => {
    const { runId, brief } = event.data as { runId: string; brief: string };

    // Step 1: Plan the deck
    const deckPlan = await step.run("plan-deck", async () => {
      await updateRunStatus(runId, "running", "author");
      await emitRunEvent(runId, "author", "plan_started");

      // Load analyst result from working papers
      const analysisResult = await loadWorkingPaper<{
        analysis: { domain: string; summary: string; topFindings: Array<{ confidence: number; title: string; claim: string; evidenceRefIds: string[]; businessImplication: string }>; metricsComputed: number; queriesExecuted: number; filesAnalyzed: number; keyDimensions: string[]; recommendedChartTypes: Array<{ chartType: string; reason: string }> };
        clarifiedBrief?: { audience: string; objective: string; stakes: string; governingQuestion: string; focalEntity: string; focalBrands: string[]; language: string; requestedSlideCount: number | null; hypotheses: string[] };
        storylinePlan?: { issueBranches: Array<{ question: string; conclusion: string; hypotheses: Array<{ claim: string }> }> };
      }>(runId, "analysis_result");
      if (!analysisResult) throw new Error(`Analysis result not found for run ${runId}`);

      const analysis = analysisResult.analysis;
      const clarifiedSlideCount = analysisResult.clarifiedBrief?.requestedSlideCount ?? null;
      const requestedSlideMatch = brief.match(/(\d+)\s*slide/i)
        ?? brief.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*slide/i);
      const wordToNum: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
      const parsedCount = requestedSlideMatch
        ? (parseInt(requestedSlideMatch[1], 10) || wordToNum[requestedSlideMatch[1].toLowerCase()] || undefined)
        : undefined;
      const requestedSlides = clarifiedSlideCount ?? parsedCount;
      const targetSlides = requestedSlides ?? Math.min(Math.max(8, analysis.topFindings.length + 4), 20);

      const findingsSummary = analysis.topFindings
        .map((f: { title: string; claim: string; confidence: number }, i: number) => `${i + 1}. ${f.title}: ${f.claim} (confidence: ${f.confidence})`)
        .join("\n");

      const storylinePlan = analysisResult.storylinePlan;
      let storylineContext = "";
      if (storylinePlan) {
        storylineContext = `\n\n## Storyline (issue tree)\n${storylinePlan.issueBranches.map(
          (b: { question: string; conclusion: string; hypotheses: Array<{ claim: string }> }) =>
            `Q: ${b.question}\nConclusion: ${b.conclusion}\nHypotheses: ${b.hypotheses.map((h: { claim: string }) => h.claim).join("; ")}`,
        ).join("\n\n")}`;
      }

      // Generate plan via GPT-5.4
      const { generateObject } = await import("ai");
      const { openai } = await import("@ai-sdk/openai");

      try {
        const planResult = await generateObject({
          model: openai("gpt-5.4"),
          schema: deckPlanSchema,
          prompt: `You are a senior strategy deck architect. Plan a ${targetSlides}-slide executive presentation structured around an issue tree.

## Analysis findings
${findingsSummary}
${storylineContext}

## Brief
${brief}

## Rules
1. Every slide must exist because it resolves one branch of the issue tree
2. Cover slide is always position 1
3. Exec summary is position 2
4. Recommendation/summary is the final position
5. Each section maps to one issue branch
6. Assign chartIntent based on the analytical question
7. Exactly ${targetSlides} slides

Return a structured DeckPlan with sections containing slide specs.`,
        });

        const structuredPlan = planResult.object;
        try { await persistWorkingPaper(runId, "deck_plan", structuredPlan); } catch {}
        return { targetSlides, requestedSlides, structuredPlan };
      } catch {
        // Fallback plan
        const fallbackSections = [{ sectionId: "sec-0", title: "Analysis", issueBranch: "overview", slides: Array.from({ length: targetSlides }, (_, i) => ({ position: i + 1, role: i === 0 ? "cover" : i === 1 ? "exec-summary" : i === targetSlides - 1 ? "summary" : "evidence", layout: i === 0 ? "cover" : i === 1 ? "exec-summary" : i === targetSlides - 1 ? "summary" : i % 2 === 0 ? "title-chart" : "chart-split", governingThought: "", chartIntent: i === 0 || i === 1 || i === targetSlides - 1 ? "none" : "rank", focalObject: analysis.domain, evidenceRequired: [] as string[] })) }];
        const fallbackPlan: DeckPlan = { targetSlideCount: targetSlides, sections: fallbackSections, appendixStrategy: "No appendix" };
        try { await persistWorkingPaper(runId, "deck_plan", fallbackPlan); } catch {}
        return { targetSlides, requestedSlides, structuredPlan: fallbackPlan };
      }
    }) as { targetSlides: number; requestedSlides?: number; structuredPlan: DeckPlan };

    // Step 2: Author all sections in parallel
    const deckPlanSections = deckPlan.structuredPlan.sections ?? [];
    const workspace = await loadWorkspaceFromDb(runId);
    const loadRows = createLoadSheetRows(runId);
    const analysisForAuthor = await loadWorkingPaper<{
      analysis: { domain: string; summary: string; topFindings: Array<{ title: string; claim: string; confidence: number; evidenceRefIds: string[]; businessImplication: string }>; keyDimensions: string[]; recommendedChartTypes: Array<{ chartType: string; reason: string }> };
      clarifiedBrief?: { focalEntity: string; focalBrands: string[]; language: string };
    }>(runId, "analysis_result");
    const analysis = analysisForAuthor?.analysis;

    let deckSummary = "";

    if (deckPlanSections.length > 0) {
      // Each section is its own step.run() for Inngest memoization.
      // Sequential (not parallel) to stay within Vercel's 800s timeout per step.
      // For a 20-slide deck with 6 sections, each section takes 2-4 min.
      for (const section of deckPlanSections) {
        const safeSectionId = (section.sectionId ?? section.title ?? "sec")
          .replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 30);

        await step.run(`author-${safeSectionId}`, async () => {
          const isSacredSection = ["cover", "exec-summary", "summary", "recommendation"].some(
            (role) => section.slides.some((s: { role?: string }) => s.role === role),
          );
          const sectionModel = isSacredSection ? "claude-opus-4-6" : "claude-sonnet-4-6";

          const sectionBrief = `## Section: ${section.title}
Issue branch: ${section.issueBranch ?? "N/A"}
Slides: ${section.slides.map((s: { position: number; role?: string; governingThought?: string }) => `${s.position}. [${s.role}] ${s.governingThought ?? ""}`).join("\n")}

## Full brief
${brief}

## Analysis summary
${analysis?.summary ?? ""}

## Key findings
${analysis?.topFindings?.map((f: { title: string; claim: string }) => `- ${f.title}: ${f.claim}`).join("\n") ?? ""}`;

          const tracker = new UsageTracker();
          tracker.startPhase("author", sectionModel, "anthropic");

          const result = await runAuthorAgent({
            workspace: workspace!,
            runId,
            analysis: analysis as unknown as AnalysisReport,
            brief: sectionBrief,
            loadRows,
            modelOverride: sectionModel,
            maxSteps: 30,
            persistNotebookEntry: async (entry: NotebookEntry) => persistNotebookEntry(runId, "author", 0, entry),
            getTemplateProfile: (async () => undefined) as never,
            persistSlide: (slide) => persistSlide(runId, slide),
            persistChart: (chart) => persistChart(runId, chart),
            getSlides: () => getSlides(runId),
            listEvidence: () => listEvidenceForRun(runId),
            onStepFinish: async (event: StepFinishEvent) => {
              tracker.recordStep(event.usage, event.toolCalls.length);
            },
          });

          tracker.endPhase();
          return result.summary;
        }); // end step.run per section
      } // end for loop

      deckSummary = `${deckPlanSections.length} sections authored`;
    }

    // Step 3: Polish — SKIPPED for resilience.
    // Polish runs a full author agent on weak slides which can exceed 800s for large decks.
    // The critique-revise loop handles quality issues instead.
    // TODO: Re-enable with per-slide polish steps when time allows.
    await step.run("polish", async () => {
      // Skip polish — go straight to critique
      return { polished: 0, total: 0, skipped: true };
      await updateRunStatus(runId, "running", "polish");
      const slides = await getSlides(runId);
      if (slides.length === 0) return { polished: 0, total: 0 };

      const weakSlides = slides.filter((s: { body?: string; title?: string }) => {
        const bodyLen = (s.body ?? "").split(/\s+/).length;
        const titleLen = (s.title ?? "").length;
        return bodyLen < 20 || titleLen < 15;
      });

      if (weakSlides.length === 0) {
        return { polished: 0, total: slides.length };
      }

      const tracker = new UsageTracker();
      tracker.startPhase("polish", "claude-sonnet-4-6", "anthropic");

      const weakSlideDetails = weakSlides.map((s: { position: number; title?: string; body?: string; layoutId?: string }) =>
        `Slide ${s.position} (${s.layoutId ?? "unknown"}): title="${s.title ?? ""}", body="${(s.body ?? "").slice(0, 100)}..."`,
      ).join("\n");

      await runAuthorAgent({
        workspace: workspace!,
        runId,
        analysis: analysis as unknown as AnalysisReport,
        brief: `## Polish task\nReview and strengthen these weak slides:\n${weakSlideDetails}\n\nFull brief: ${brief}`,
        loadRows,
        modelOverride: "claude-sonnet-4-6",
        maxSteps: 15,
        persistNotebookEntry: async (entry: NotebookEntry) => persistNotebookEntry(runId, "polish", 0, entry),
        getTemplateProfile: (async () => undefined) as never,
        persistSlide: (slide) => persistSlide(runId, slide),
        persistChart: (chart) => persistChart(runId, chart),
        getSlides: () => getSlides(runId),
        listEvidence: () => listEvidenceForRun(runId),
        onStepFinish: async (event: StepFinishEvent) => {
          tracker.recordStep(event.usage, event.toolCalls.length);
        },
      });

      tracker.endPhase();
      return { polished: weakSlides.length, total: slides.length };
    });

    // Return summary for parent
    const finalSlides = await getSlides(runId);
    const finalCharts = await getV2ChartRows(runId);
    return {
      deckSummary,
      slideCount: finalSlides.length,
      chartCount: finalCharts.length,
    };
  },
);

/**
 * basquioExport: Separate Inngest function for the export phase.
 * Runs independently with its own timeout and retries.
 * This is the heaviest non-agent step (PPTX generation + upload).
 */
/**
 * basquioCritiqueRevise: Critique + revise loop as independent function.
 * Runs factual + strategic critique, then targeted revise, then re-critique.
 * Returns the quality gate decision.
 */
export const basquioCritiqueRevise = inngest.createFunction(
  { id: "basquio-critique-revise", retries: 2, timeouts: { finish: "25m" } },
  { event: "basquio/critique-revise.requested" },
  async ({ event, step }) => {
    const { runId, brief, sourceFileIds } = event.data as {
      runId: string;
      brief: string;
      sourceFileIds: string[];
    };

    // Load dependencies from DB
    const workspace = await loadWorkspaceFromDb(runId);
    if (!workspace) throw new Error(`Workspace not found for run ${runId}`);

    const analysisResult = await loadWorkingPaper<AnalystResult>(runId, "analysis_result");
    const analysis = analysisResult?.analysis ?? { topFindings: [], metricsComputed: 0, dataSummary: "" };
    const deckPlanWp = await loadWorkingPaper<DeckPlan>(runId, "deck_plan");
    const loadRows = createLoadSheetRows(runId);

    // ─── PARALLEL CRITIQUE (factual + strategic run concurrently) ──
    // Both critiques are independent evaluations — running them in parallel saves 1.5-2.5 min.
    const critiqueResults = await step.run("critique-parallel", async () => {
      await updateDeliveryStatus(runId, "draft");
      await updateRunStatus(runId, "running", "critique");
      await emitRunEvent(runId, "critique", "phase_started");

      const slides = await getSlides(runId);

      const slideData = slides.map((s) => ({
        id: s.id,
        position: s.position,
        layoutId: s.layoutId ?? "title-body",
        title: s.title ?? "",
        body: s.body,
        bullets: s.bullets,
        metrics: s.metrics ? (typeof s.metrics === "string" ? JSON.parse(s.metrics) : s.metrics) : undefined,
        chartId: s.chartId,
        evidenceIds: s.evidenceIds ?? [],
      }));

      // Run factual + strategic in parallel
      const [factual, strategic] = await Promise.all([
        runCriticAgent({
          workspace,
          runId,
          deckSummary: "",
          brief,
          slideCount: slides.length,
          getSlides: async () => slideData,
          getNotebookEntries: (evidenceRefId: string) => getNotebookEntry(evidenceRefId),
          persistNotebookEntry: (entry: NotebookEntry) => persistNotebookEntry(runId, "critique", 0, entry),
        }),
        runStrategicCriticAgent({
          runId,
          brief,
          deckSummary: "",
          slideCount: slides.length,
          slides: slideData,
        }),
      ]);

      return { factual, strategic };
    });

    const factualCritique = critiqueResults.factual;
    const strategicCritique = critiqueResults.strategic;

    // ─── MERGE + GATE DECISION ─────────────────────────────────
    const gateResult = await step.run("critique-merge-gate", async () => {
      const allIssues = [...factualCritique.issues, ...strategicCritique.issues];
      const hasIssues = allIssues.length > 0;
      const hasCriticalOrMajor = allIssues.some((i) => i.severity === "critical" || i.severity === "major");
      const criticalCount = allIssues.filter((i) => i.severity === "critical").length;
      const majorCount = allIssues.filter((i) => i.severity === "major").length;

      // Persist critique report
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/critique_reports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          run_id: runId,
          iteration: 1,
          has_issues: hasIssues,
          issue_count: allIssues.length,
          issues: allIssues,
        }),
      });

      if (!hasCriticalOrMajor) {
        await updateDeliveryStatus(runId, "reviewed");
        return { hasCriticalOrMajor: false, needsRevise: false, issues: allIssues };
      }

      return { hasCriticalOrMajor: true, needsRevise: true, issues: allIssues, criticalCount, majorCount };
    });

    // ─── REVISE (targeted section-level repair) ────────────────────
    if (gateResult.needsRevise) {
      await step.run("revise", async () => {
        await updateRunStatus(runId, "running", "revise");
        await emitRunEvent(runId, "revise", "phase_started");

        const slides = await getSlides(runId);
        const issues = gateResult.issues as Array<{ severity: string; claim: string; slideId?: string }>;

        // Build evidence inventory for the revise agent
        const evidenceList = await listEvidenceForRun(runId);
        const evidenceContext = evidenceList.length > 0
          ? `\n\n## Available evidence (${evidenceList.length} items)\n${evidenceList.slice(0, 30).map((e) => `- ${(e as Record<string, unknown>).ref_id ?? (e as Record<string, unknown>).evidenceRefId ?? "?"}: ${(e as Record<string, unknown>).label ?? (e as Record<string, unknown>).summary ?? ""}`).join("\n")}`
          : "";

        // Build critique context for the revise agent
        const issuesSummary = issues
          .map((i: { severity: string; claim: string; slideId?: string }) => `[${i.severity}] ${i.slideId ? `Slide ${i.slideId}: ` : ""}${i.claim}`)
          .join("\n");

        const tracker = new UsageTracker();
        tracker.startPhase("revise", "claude-sonnet-4-6", "anthropic");

        await runAuthorAgent({
          workspace,
          runId,
          analysis: analysis as unknown as AnalysisReport,
          brief: `## REVISION TASK — fix these critique issues\n${issuesSummary}\n\n## Original brief\n${brief}${evidenceContext}`,
          critiqueContext: issuesSummary,
          loadRows,
          modelOverride: "claude-sonnet-4-6",
          maxSteps: 25,
          persistNotebookEntry: async (entry: NotebookEntry) => persistNotebookEntry(runId, "revise", 0, entry),
          getTemplateProfile: (async () => undefined) as never,
          persistSlide: (slide) => persistSlide(runId, slide),
          persistChart: (chart) => persistChart(runId, chart),
          getSlides: () => getSlides(runId),
          listEvidence: () => listEvidenceForRun(runId),
          onStepFinish: async (event: StepFinishEvent) => {
            tracker.recordStep(event.usage, event.toolCalls.length);
          },
        });

        tracker.endPhase();
        await emitRunEvent(runId, "revise", "phase_completed");
      });

      // ─── RE-CRITIQUE (verify revisions fixed the issues) ──────
      const reGateResult = await step.run("re-critique-gate", async () => {
        await updateRunStatus(runId, "running", "critique");

        const slides = await getSlides(runId);
        const slideData = slides.map((s) => ({
          id: s.id,
          position: s.position,
          layoutId: s.layoutId ?? "title-body",
          title: s.title ?? "",
          body: s.body,
          bullets: s.bullets,
          metrics: s.metrics ? (typeof s.metrics === "string" ? JSON.parse(s.metrics) : s.metrics) : undefined,
          chartId: s.chartId,
          evidenceIds: s.evidenceIds ?? [],
        }));

        // Only re-run factual critic (cheaper, faster)
        const reFactual = await runCriticAgent({
          workspace,
          runId,
          deckSummary: "",
          brief,
          slideCount: slides.length,
          getSlides: async () => slideData,
          getNotebookEntries: (evidenceRefId: string) => getNotebookEntry(evidenceRefId),
          persistNotebookEntry: (entry: NotebookEntry) => persistNotebookEntry(runId, "critique", 1, entry),
        });

        const reIssues = reFactual.issues ?? [];
        const reCritical = reIssues.filter((i: { severity: string }) => i.severity === "critical").length;
        const reMajor = reIssues.filter((i: { severity: string }) => i.severity === "major").length;

        if (reCritical > 0) {
          await updateDeliveryStatus(runId, "failed");
          await updateRunStatus(runId, "failed", "critique", {
            failure_message: `Export blocked after revision: ${reCritical} critical issue(s) remain`,
          });
          throw new Error(`Export blocked after revision: ${reCritical} critical issue(s)`);
        }

        if (reMajor > 0) {
          await updateDeliveryStatus(runId, "failed");
          await updateRunStatus(runId, "failed", "critique", {
            failure_message: `Export blocked after revision: ${reMajor} major issue(s) remain`,
          });
          throw new Error(`Export blocked after revision: ${reMajor} major issue(s)`);
        }

        await updateDeliveryStatus(runId, "reviewed");
        return { hasCriticalOrMajor: false, degradedDelivery: false, degradedIssues: [] as Array<{ severity: string; claim: string }> };
      });

      return reGateResult;
    }

    return { hasCriticalOrMajor: false, degradedDelivery: false, degradedIssues: [] as Array<{ severity: string; claim: string }> };
  },
);

export const basquioExport = inngest.createFunction(
  {
    id: "basquio-export",
    retries: 2,
    timeouts: { finish: "15m" },
  },
  { event: "basquio/export.requested" },
  async ({ event, step }) => {
    const {
      runId,
      exportMode: rawExportMode,
      hasCriticalOrMajor,
      degradedDelivery,
      degradedIssues,
      deckTitle,
      sourceFileIds,
    } = event.data as {
      runId: string;
      exportMode?: string;
      hasCriticalOrMajor: boolean;
      degradedDelivery: boolean;
      degradedIssues: Array<{ severity: string; claim: string }>;
      deckTitle: string;
      sourceFileIds: string[];
    };

    const exportMode = rawExportMode === "universal-compatible"
      ? ("universal-compatible" as const)
      : ("powerpoint-native" as const);

    // Source coverage check
    await step.run("source-coverage-check", async () => {
      const evidenceRows = await listEvidenceForRun(runId);
      const slides = await getSlides(runId);

      const usedFileIds = new Set<string>();
      for (const ev of evidenceRows) {
        const refMatch = ev.evidenceRefId.match(/^(?:sheet|doc|img)-([a-f0-9]{8})/);
        if (refMatch) usedFileIds.add(refMatch[1]);
      }

      const unusedFiles: string[] = [];
      for (const fileId of sourceFileIds) {
        const fileIdShort = fileId.slice(0, 8);
        if (!usedFileIds.has(fileIdShort)) unusedFiles.push(fileId);
      }

      const citedEvidenceIds = new Set<string>();
      for (const slide of slides) {
        if (slide.evidenceIds) {
          for (const eid of slide.evidenceIds) citedEvidenceIds.add(eid);
        }
      }

      const totalEvidence = evidenceRows.length;
      const citedEvidence = evidenceRows.filter((e) => citedEvidenceIds.has(e.evidenceRefId)).length;
      const coverageRatio = totalEvidence > 0 ? citedEvidence / totalEvidence : 0;

      logPhaseEvent(runId, "export", "source_coverage_report", {
        totalSourceFiles: sourceFileIds.length,
        unusedFileCount: unusedFiles.length,
        totalEvidence,
        citedEvidence,
        coverageRatio: Math.round(coverageRatio * 100),
      });

      // Hard gate: if ANY evidence file was unused, block export.
      // Every file the user uploaded must contribute to the analysis.
      if (unusedFiles.length > 0 && sourceFileIds.length > 0) {
        await updateRunStatus(runId, "failed", "export", {
          failure_message: `Export blocked: ${unusedFiles.length} of ${sourceFileIds.length} uploaded file(s) were not used in the analysis. All sources must contribute evidence.`,
        });
        throw new Error(`Export blocked: ${unusedFiles.length} source file(s) unused`);
      }

      return { unusedFiles: unusedFiles.length, coverageRatio };
    });

    // Render + publish
    const artifacts = await step.run("render-and-publish", async () => {
      await updateRunStatus(runId, "running", "export");
      await emitRunEvent(runId, "export", "phase_started");

      if (!hasCriticalOrMajor) {
        await updateDeliveryStatus(runId, "reviewed");
      }

      const slides = await getSlides(runId);
      const v2ChartRows = await getV2ChartRows(runId);

      // Load template profile via raw fetch
      let templateProfile: Record<string, unknown> | null = null;
      try {
        const runRes = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_runs?id=eq.${runId}&select=template_profile_id`,
          { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}` } },
        );
        const runRows = await runRes.json() as Array<{ template_profile_id: string | null }>;
        if (runRows[0]?.template_profile_id) {
          const profRes = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/template_profiles?id=eq.${runRows[0].template_profile_id}&select=profile`,
            { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}` } },
          );
          const profRows = await profRes.json() as Array<{ profile: Record<string, unknown> }>;
          if (profRows[0]?.profile) templateProfile = profRows[0].profile;
        }
      } catch { /* use default */ }

      // Render PPTX
      const pptxArtifact = await renderV2PptxArtifact({
        slides: slides.map((s) => ({
          id: s.id,
          position: s.position,
          layoutId: s.layoutId ?? "title-body",
          title: s.title ?? "",
          body: s.body,
          bullets: s.bullets,
          chartId: s.chartId,
          kicker: s.kicker,
          callout: s.callout ? (typeof s.callout === "string" ? JSON.parse(s.callout) : s.callout) : undefined,
          metrics: s.metrics ? (typeof s.metrics === "string" ? JSON.parse(s.metrics) : s.metrics) : undefined,
          highlightCategories: s.highlightCategories,
          evidenceIds: s.evidenceIds,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })) as any,
        charts: v2ChartRows,
        deckTitle: deckTitle || "Basquio Analysis",
        brandTokens: templateProfile?.brandTokens as Record<string, unknown> | undefined,
        exportMode,
      });

      // Upload PPTX
      const pptxPath = `${runId}/deck.pptx`;
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

      // QA checks
      const hasValidPptxHeader = pptxBuffer.length >= 4 &&
        pptxBuffer[0] === 0x50 && pptxBuffer[1] === 0x4B &&
        pptxBuffer[2] === 0x03 && pptxBuffer[3] === 0x04;

      const qaChecks = [
        { name: "pptx_non_empty", passed: pptxBuffer.length > 0, detail: `${pptxBuffer.length} bytes` },
        { name: "slide_count_positive", passed: slides.length > 0, detail: `${slides.length} slides` },
        { name: "pptx_valid_zip", passed: hasValidPptxHeader },
      ];

      const qaPassed = qaChecks.every((c) => c.passed);

      // Publish manifest
      const artifactId = crypto.randomUUID();
      const manifest = {
        id: crypto.randomUUID(),
        run_id: runId,
        slide_count: slides.length,
        page_count: slides.length,
        qa_passed: qaPassed,
        qa_report: {
          checks: qaChecks,
          delivery_status: degradedDelivery ? "degraded" : "reviewed",
          ...(degradedDelivery ? { unresolvedIssues: degradedIssues } : {}),
        },
        artifacts: [{
          id: artifactId,
          kind: "pptx" as const,
          fileName: "basquio-deck.pptx",
          mimeType: pptxArtifact.mimeType,
          fileBytes: pptxBuffer.length,
          storagePath: pptxPath,
          storageBucket: "artifacts",
          checksumSha256: checksumSha256(pptxBuffer),
        }],
        published_at: new Date().toISOString(),
      };

      const manifestRes = await fetch(
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
      if (!manifestRes.ok) {
        console.warn(`Failed to persist artifact manifest: ${manifestRes.statusText}`);
      }

      // Mark complete
      await updateRunStatus(runId, "completed", "export", {
        completed_at: new Date().toISOString(),
      });

      return {
        pptxBytes: pptxBuffer.length,
        slideCount: slides.length,
        qaPassed,
        exportMode,
      };
    });

    return artifacts;
  },
);

// ─── HTML RENDERER FOR UNIFIED PDF ────────────────────────────────

type V2ChartRowForPdf = {
  id: string;
  chartType: string;
  title: string;
  data: Record<string, unknown>[];
  xAxis: string;
  series: string[];
  // Semantic fields from chart design system
  intent?: string;
  unit?: string;
  benchmarkLabel?: string;
  benchmarkValue?: number;
  sourceNote?: string;
};

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
        // Render chart via QuickChart — use design system intent for type mapping
        const pal = ["#0F4C81", "#D1D5DB", "#1F7A4D", "#B42318", "#C97A00", "#6B21A8"];
        const typeMap: Record<string, string> = {
          bar: "bar", horizontal_bar: "bar", grouped_bar: "bar",
          stacked_bar: "bar", stacked_bar_100: "bar", waterfall: "bar",
          line: "line", area: "line", pie: "pie", doughnut: "doughnut",
          scatter: "scatter",
        };
        const type = typeMap[chart.chartType] ?? "bar";
        const isHoriz = chart.chartType === "bar" || chart.chartType === "horizontal_bar";
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
        // Chart image + source note
        const sourceHtml = chart.sourceNote ? `<div style="font-size:7px;color:#4B5563;font-style:italic;margin-top:2px;">Source: ${esc(chart.sourceNote)}</div>` : "";
        chartHtml = `<img src="${qcUrl}" style="max-width:100%;max-height:260px;" onerror="this.style.display='none'"/>${sourceHtml}`;
      }
    }

    // Body + bullets (executive prose: bold first sentence)
    let bodyHtml = "";
    if (s.body) {
      const sentences = s.body.split(/(?<=[.!?;—:])\s+/);
      if (sentences.length >= 2) {
        bodyHtml = `<div style="font-size:9px;color:#111827;line-height:1.5;"><strong>${esc(sentences[0])}</strong> ${esc(sentences.slice(1).join(" "))}</div>`;
      } else {
        bodyHtml = `<div style="font-size:9px;color:#111827;line-height:1.5;">${esc(s.body)}</div>`;
      }
    }
    const bulletsHtml = s.bullets?.length ? `<ul style="font-size:9px;color:#111827;line-height:1.4;padding-left:14px;margin:4px 0;">${s.bullets.slice(0, 5).map((b) => `<li style="margin-bottom:3px;">${esc(b)}</li>`).join("")}</ul>` : "";

    // Callout banner
    const calloutHtml = s.callout ? `<div style="background:${s.callout.tone === "green" ? "#16A34A" : s.callout.tone === "orange" ? "#EA580C" : "#0F4C81"};color:#fff;font-weight:700;font-size:9px;padding:6px 12px;border-radius:4px;margin-top:6px;">${esc(s.callout.text)}</div>` : "";

    // Layout-dependent content
    let content = "";
    const layout = s.layoutId ?? "title-body";
    if (isCover) {
      content = "";
    } else if (layout === "chart-split" || layout === "two-column") {
      content = `${metricsHtml}<div style="display:flex;gap:12px;flex:1;min-height:0;"><div style="flex:0 0 55%;">${chartHtml}</div><div style="flex:1;">${bulletsHtml || bodyHtml}${calloutHtml}</div></div>`;
    } else if (layout === "evidence-grid") {
      content = `${metricsHtml}<div style="display:flex;gap:12px;flex:1;min-height:0;"><div style="flex:0 0 55%;">${chartHtml}</div><div style="flex:1;">${bulletsHtml || bodyHtml}</div></div>${calloutHtml}`;
    } else if (layout === "title-chart") {
      content = `${chartHtml}${calloutHtml}`;
    } else if (layout === "summary") {
      content = `${bodyHtml}${calloutHtml || (bulletsHtml ? `<div style="background:#DCEAF7;border-left:3px solid #0F4C81;padding:8px 12px;margin-top:8px;">${bulletsHtml}</div>` : "")}`;
    } else {
      content = `${metricsHtml}${bodyHtml}${bulletsHtml}${chartHtml}${calloutHtml}`;
    }

    return `<div style="width:960px;height:540px;background:${isCover ? "#1B2541" : "#fff"};box-sizing:border-box;position:relative;page-break-after:always;font-family:Arial,sans-serif;display:flex;flex-direction:column;${isCover ? "padding:100px 52px;justify-content:center;" : "padding:16px 45px 32px 45px;"}">
      ${!isCover ? '<div style="position:absolute;top:0;left:0;right:0;height:4px;background:#0F4C81;"></div>' : ""}
      ${!isCover && s.kicker ? `<div style="font-size:8px;font-weight:700;color:#0F4C81;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;flex-shrink:0;">${esc(s.kicker)}</div>` : ""}
      <div style="font-size:${isCover ? "28px" : "20px"};font-weight:700;color:${isCover ? "#fff" : "#111827"};line-height:1.2;margin-bottom:${isCover ? "12px" : "4px"};flex-shrink:0;">${esc(s.title ?? "")}</div>
      ${s.subtitle ? `<div style="font-size:12px;color:${isCover ? "rgba(255,255,255,0.7)" : "#4B5563"};margin-bottom:8px;flex-shrink:0;">${esc(s.subtitle)}</div>` : ""}
      ${!isCover ? '<div style="border-top:1px solid #D1D5DB;margin-bottom:6px;flex-shrink:0;"></div>' : ""}
      <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;">${content}</div>
      ${!isCover ? `<div style="position:absolute;bottom:0;left:0;right:0;height:26px;background:#1B2541;display:flex;align-items:center;padding:0 45px;"><div style="font-size:7px;color:#fff;font-style:italic;flex:1;">Source: ${esc(deckTitle)} | Basquio</div><div style="font-size:7px;color:#9CA3AF;">${s.position} / ${slides.length}</div></div>` : ""}
    </div>`;
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:960px 540px;margin:0}body{margin:0;padding:0}img{display:block}</style></head><body>${pages.join("\n")}</body></html>`;
}

// ─── SCENE-GRAPH HTML RENDERER FOR PDF ───────────────────────────
// Converts a DeckSceneGraph into fixed-size HTML pages where each slide
// is an absolutely-positioned container. This eliminates the 12-slide → 28-page
// divergence bug caused by the old free-flow HTML approach.

function renderSceneGraphToHtml(
  sceneGraph: DeckSceneGraph,
  charts: V2ChartRowForPdf[],
  deckTitle: string,
): string {
  const chartMap = new Map<string, V2ChartRowForPdf>();
  for (const c of charts) chartMap.set(c.id, c);

  const DPI = 96; // CSS pixels per inch
  const pageW = Math.round(sceneGraph.slideWidth * DPI);
  const pageH = Math.round(sceneGraph.slideHeight * DPI);
  const { palette, typography } = sceneGraph.brandTokens;

  function esc(t: string): string {
    return t
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\\n/g, "\n")
      .replace(/\n/g, "<br/>");
  }

  function frameToStyle(frame: { x: number; y: number; w: number; h: number }): string {
    return `position:absolute;left:${Math.round(frame.x * DPI)}px;top:${Math.round(frame.y * DPI)}px;width:${Math.round(frame.w * DPI)}px;height:${Math.round(frame.h * DPI)}px;`;
  }

  function textStyleToCss(style?: DeckSceneGraph["brandTokens"]["typography"] extends infer T ? Record<string, unknown> : never): string {
    if (!style) return "";
    const s = style as Record<string, unknown>;
    const parts: string[] = [];
    if (s.fontFamily) parts.push(`font-family:${s.fontFamily},Arial,sans-serif`);
    if (s.fontSize) parts.push(`font-size:${s.fontSize}px`);
    if (s.fontWeight === "bold") parts.push("font-weight:700");
    if (s.fontStyle === "italic") parts.push("font-style:italic");
    if (s.color) parts.push(`color:${String(s.color).startsWith("#") ? s.color : `#${s.color}`}`);
    if (s.align) parts.push(`text-align:${s.align}`);
    if (s.lineHeight) parts.push(`line-height:${s.lineHeight}`);
    return parts.join(";");
  }

  function renderNode(node: DeckSceneGraph["slides"][number]["nodes"][number]): string {
    const base = frameToStyle(node.frame);
    const text = textStyleToCss(node.style as Record<string, unknown>);

    switch (node.kind) {
      case "kicker":
        return `<div style="${base}${text};text-transform:uppercase;letter-spacing:1px;overflow:hidden;">${esc(node.content ?? "")}</div>`;

      case "title":
        return `<div style="${base}${text};overflow:hidden;">${esc(node.content ?? "")}</div>`;

      case "subtitle":
        return `<div style="${base}${text};overflow:hidden;">${esc(node.content ?? "")}</div>`;

      case "body": {
        const bodyText = node.content ?? "";
        const sentences = bodyText.split(/(?<=[.!?;—:])\s+/);
        const html = sentences.length >= 2
          ? `<strong>${esc(sentences[0])}</strong> ${esc(sentences.slice(1).join(" "))}`
          : esc(bodyText);
        return `<div style="${base}${text};overflow:hidden;line-height:1.5;">${html}</div>`;
      }

      case "bullet_list": {
        const items = (node.items ?? []).slice(0, 5);
        const listHtml = items.map(b => `<li style="margin-bottom:3px;">${esc(b)}</li>`).join("");
        return `<div style="${base}${text};overflow:hidden;"><ul style="padding-left:14px;margin:0;">${listHtml}</ul></div>`;
      }

      case "metric_card": {
        if (!node.metrics?.length) return "";
        const cards = node.metrics.map(m => {
          const deltaColor = m.delta && (m.delta.startsWith("+") || m.delta.includes("\u2191"))
            ? "#1F7A4D" : "#B42318";
          return `<div style="flex:1;background:#F8FAFC;border:1px solid #D1D5DB;border-left:4px solid ${palette.accent ?? "#0F4C81"};border-radius:4px;padding:8px 12px;">
            <div style="font-size:8px;color:#4B5563;text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">${esc(m.label)}</div>
            <div style="font-size:26px;font-weight:700;color:#111827;margin:4px 0;">${esc(m.value)}</div>
            ${m.delta ? `<div style="font-size:8px;font-weight:700;color:${deltaColor};">${esc(m.delta)}</div>` : ""}
          </div>`;
        }).join("");
        return `<div style="${base}display:flex;gap:10px;">${cards}</div>`;
      }

      case "chart_placeholder": {
        const chart = node.chartId ? chartMap.get(node.chartId) : null;
        if (!chart || !chart.data?.length) {
          return `<div style="${base}display:flex;align-items:center;justify-content:center;color:#9CA3AF;font-size:10px;">Chart data unavailable</div>`;
        }

        if (chart.chartType === "table") {
          const headers = [chart.xAxis, ...(chart.series ?? [])].filter(Boolean);
          const rows = chart.data.slice(0, 10);
          const tableHtml = `<table style="width:100%;border-collapse:collapse;font-size:8px;font-family:Arial;">
            <tr>${headers.map((h, i) => `<th style="background:#1B2541;color:#fff;font-weight:700;padding:3px 6px;text-align:${i === 0 ? "left" : "right"};">${esc(h)}</th>`).join("")}</tr>
            ${rows.map(row => `<tr>${headers.map((h, i) => {
              const v = row[h];
              const fv = typeof v === "number" ? (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(v)) : String(v ?? "");
              return `<td style="padding:3px 6px;border-bottom:0.5px solid #E5E7EB;text-align:${i === 0 ? "left" : "right"};">${esc(fv)}</td>`;
            }).join("")}</tr>`).join("")}
          </table>`;
          return `<div style="${base}overflow:hidden;">${tableHtml}</div>`;
        }

        if (chart.series?.length > 0) {
          const pal = ["#0F4C81", "#D1D5DB", "#1F7A4D", "#B42318", "#C97A00", "#6B21A8"];
          const type = chart.chartType === "stacked_bar" || chart.chartType === "waterfall" ? "bar" : chart.chartType;
          const isHoriz = chart.chartType === "bar";
          const labels = chart.data.map(r => String(r[chart.xAxis] ?? "").substring(0, 20));
          const datasets = chart.series.map((ser, i) => ({
            label: ser,
            data: chart.data.map(r => Number(r[ser]) || 0),
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
          const chartW = Math.round(node.frame.w * DPI);
          const chartH = Math.round(node.frame.h * DPI);
          const qcUrl = `https://quickchart.io/chart?c=${encodeURIComponent(cfg)}&w=${chartW}&h=${chartH}&bkg=white&f=png`;
          return `<div style="${base}overflow:hidden;">
            <div style="font-size:9px;font-weight:700;color:#111827;margin-bottom:4px;">${esc(chart.title)}</div>
            <img src="${qcUrl}" style="max-width:100%;max-height:${chartH - 20}px;" onerror="this.style.display='none'"/>
          </div>`;
        }

        return "";
      }

      case "callout": {
        const bgColor = node.fill ?? palette.accent ?? "#0F4C81";
        return `<div style="${base}background:${bgColor};color:#fff;font-weight:700;font-size:10px;padding:6px 12px;border-radius:4px;overflow:hidden;display:flex;align-items:center;">${esc(node.content ?? "")}</div>`;
      }

      case "table": {
        if (!node.tableData) return "";
        const { headers, rows } = node.tableData;
        const tableHtml = `<table style="width:100%;border-collapse:collapse;font-size:8px;font-family:Arial;">
          <tr>${headers.map((h, i) => `<th style="background:#1B2541;color:#fff;font-weight:700;padding:3px 6px;text-align:${i === 0 ? "left" : "right"};">${esc(h)}</th>`).join("")}</tr>
          ${rows.map(row => `<tr>${row.map((cell, i) => `<td style="padding:3px 6px;border-bottom:0.5px solid #E5E7EB;text-align:${i === 0 ? "left" : "right"};">${esc(cell)}</td>`).join("")}</tr>`).join("")}
        </table>`;
        return `<div style="${base}overflow:hidden;">${tableHtml}</div>`;
      }

      case "recommendation": {
        if (!node.recommendation) return "";
        const r = node.recommendation;
        return `<div style="${base}background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;padding:10px;overflow:hidden;">
          <div style="font-size:8px;color:#4B5563;font-weight:700;text-transform:uppercase;">Recommendation</div>
          <div style="font-size:10px;color:#111827;font-weight:700;margin:4px 0;">${esc(r.recommendation)}</div>
          <div style="font-size:8px;color:#4B5563;">If: ${esc(r.condition)}</div>
          <div style="font-size:9px;color:#1F7A4D;font-weight:700;margin-top:2px;">${esc(r.quantification)}</div>
        </div>`;
      }

      case "divider":
        return `<div style="${base}border-top:1px solid ${palette.border ?? "#D1D5DB"};"></div>`;

      case "shape": {
        const fill = node.fill ? `background:${node.fill};` : "";
        const border = node.stroke ? `border:${node.strokeWidth ?? 1}px solid ${node.stroke};` : "";
        const radius = node.shapeType === "rounded_rectangle" ? "border-radius:6px;" : node.shapeType === "circle" ? "border-radius:50%;" : "";
        return `<div style="${base}${fill}${border}${radius}"></div>`;
      }

      case "image":
        return node.imageUrl
          ? `<img src="${node.imageUrl}" style="${base}object-fit:contain;"/>`
          : "";

      default:
        return node.content
          ? `<div style="${base}${text};overflow:hidden;">${esc(node.content)}</div>`
          : "";
    }
  }

  const pages = sceneGraph.slides.map((slide, idx) => {
    const bg = slide.background ?? "#FFFFFF";
    const isCover = idx === 0 && bg !== "#FFFFFF" && bg !== "#F8FAFC";
    const nodesHtml = slide.nodes.map(renderNode).join("\n");

    return `<div style="width:${pageW}px;height:${pageH}px;background:${bg};box-sizing:border-box;position:relative;page-break-after:always;font-family:${typography.bodyFont},Arial,sans-serif;overflow:hidden;">
      ${!isCover ? `<div style="position:absolute;top:0;left:0;right:0;height:4px;background:${palette.accent ?? "#0F4C81"};"></div>` : ""}
      ${nodesHtml}
      ${!isCover ? `<div style="position:absolute;bottom:0;left:0;right:0;height:26px;background:#1B2541;display:flex;align-items:center;padding:0 45px;"><div style="font-size:7px;color:#fff;font-style:italic;flex:1;">Source: ${esc(deckTitle)} | Basquio</div><div style="font-size:7px;color:#9CA3AF;">${slide.position} / ${sceneGraph.slides.length}</div></div>` : ""}
    </div>`;
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:${pageW}px ${pageH}px;margin:0}body{margin:0;padding:0}img{display:block}</style></head><body>${pages.join("\n")}</body></html>`;
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
