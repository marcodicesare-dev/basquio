import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject, generateText, Output } from "ai";
import { z } from "zod";
import { parseEvidencePackage, streamParseFile, checksumSha256, loadRowsFromBlob, extractPptxSlideImages, type SheetManifest, type PptxSlideImage } from "@basquio/data-ingest";
import { runAnalystAgent, runAuthorAgent, runCriticAgent, runStrategicCriticAgent, detectLanguage, buildDomainKnowledgeContext, enforceExhibit, inferQuestionType, evaluateSlideQuality, filterSlidesByQuality, mapColumns, type AnalystResult } from "@basquio/intelligence";
import { renderPdfArtifact, renderV2PdfArtifact } from "@basquio/render-pdf";
import { renderPptxArtifact } from "@basquio/render-pptx";
import { renderV2PptxArtifact, type V2ChartRow } from "@basquio/render-pptx/v2";
import { buildDeckSceneGraph, type DeckSceneGraph } from "@basquio/scene-graph";
import { createSystemTemplateProfile, interpretTemplateSource } from "@basquio/template-engine";
import {
  deckPlanSchema,
  v1DeckPlanSchema,
  v1SlideOutputSchema,
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
  type V1DeckPlan,
  type V1PlannedChart,
  type V1SlideOutput,
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
import { NonRetriableError } from "inngest";
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
      body: JSON.stringify({ delivery_status: deliveryStatus }),
    },
  );
  if (!response.ok) {
    console.error(`[updateDeliveryStatus] Failed for ${runId}: ${response.status} ${response.statusText}`);
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

async function deleteSlideByPosition(runId: string, position: number) {
  assertUuid(runId, "runId");
  await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_slides?run_id=eq.${runId}&position=eq.${position}`,
    {
      method: "DELETE",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        Prefer: "return=minimal",
      },
    },
  );
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
  const colCount = categoryCount > 0 && row.data[0] != null && typeof row.data[0] === "object" ? Object.keys(row.data[0]).length : 0;
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

/**
 * Deterministic data intelligence — $0 cost, pure pattern matching.
 * Detects: currency, period structure, dimension/measure roles, hierarchy, data grain.
 * Injected into analyst + plan prompts so LLM doesn't have to guess these basics.
 */
function buildDataIntelligence(workspace: EvidenceWorkspace | null): string | null {
  if (!workspace?.fileInventory?.length) return null;

  const lines: string[] = [];
  const allColumns: Array<{ name: string; inferredType: string; role: string; sampleValues?: string[]; uniqueCount?: number }> = [];

  for (const file of workspace.fileInventory) {
    for (const sheet of file.sheets ?? []) {
      if (!sheet?.columns) continue;
      for (const col of sheet.columns) {
        if (col) allColumns.push(col as typeof allColumns[0]);
      }
    }
  }

  if (allColumns.length === 0) return null;

  // 1. CURRENCY DETECTION — scan column names and sample values for currency symbols
  const currencyPatterns: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP", "CHF": "CHF", "¥": "JPY" };
  let detectedCurrency: string | null = null;
  for (const col of allColumns) {
    const name = col.name.toLowerCase();
    // Check column name for currency words
    if (name.includes("valore") || name.includes("value") || name.includes("revenue") || name.includes("sales")) {
      // Check sample values for currency prefix
      for (const sv of col.sampleValues ?? []) {
        const val = String(sv ?? "").trim();
        for (const [symbol, code] of Object.entries(currencyPatterns)) {
          if (val.startsWith(symbol) || val.includes(symbol)) {
            detectedCurrency = code;
            break;
          }
        }
        if (detectedCurrency) break;
      }
    }
    if (detectedCurrency) break;
  }
  if (detectedCurrency) {
    const symbol = Object.entries(currencyPatterns).find(([, code]) => code === detectedCurrency)?.[0] ?? detectedCurrency;
    lines.push(`- Currency: ${detectedCurrency} (${symbol}). Use "${symbol}" as unit for all monetary chart values.`);
  }

  // 2. PERIOD DETECTION — find CY/PY column pairs
  const periodPairs: Array<{ current: string; prior: string }> = [];
  const colNames = allColumns.map((c) => c.name);
  for (const name of colNames) {
    const lower = name.toLowerCase();
    // Pattern: "X Anno prec." vs "X" (Italian NielsenIQ)
    if (lower.includes("anno prec")) {
      const base = name.replace(/\s*Anno prec\.?/i, "").trim();
      const match = colNames.find((n) => n.trim() === base);
      if (match) periodPairs.push({ current: match, prior: name });
    }
    // Pattern: "X PY" vs "X CY" or "X Prior" vs "X Current"
    if (lower.endsWith(" py") || lower.endsWith(" prior") || lower.endsWith(" prior year")) {
      const base = name.replace(/\s*(PY|Prior|Prior Year)$/i, "").trim();
      const match = colNames.find((n) =>
        n.trim() === base ||
        n.trim() === `${base} CY` ||
        n.trim() === `${base} Current` ||
        n.trim() === `${base} Current Year`
      );
      if (match) periodPairs.push({ current: match, prior: name });
    }
  }
  if (periodPairs.length > 0) {
    lines.push(`- Period structure: TWO-PERIOD COMPARISON (current year vs prior year). This is NOT a time series — do NOT use line/area charts for period comparison. Use grouped bar or waterfall instead.`);
    lines.push(`  Paired columns: ${periodPairs.map((p) => `"${p.current}" (CY) ↔ "${p.prior}" (PY)`).join(", ")}`);
  }

  // 3. HIERARCHY DETECTION — columns with nesting cardinality patterns
  const dimensions = allColumns.filter((c) => c.role === "dimension" || c.inferredType === "string");
  const hierarchyCandidates = dimensions
    .filter((c) => {
      const name = c.name.toLowerCase();
      return name.includes("ecr") || name.includes("level") || name.includes("tier") ||
        name.includes("area") || name.includes("category") || name.includes("segment") ||
        name.includes("comparto") || name.includes("famiglia") || name.includes("mercato");
    })
    .sort((a, b) => (a.uniqueCount ?? 0) - (b.uniqueCount ?? 0)); // fewer distinct = higher in hierarchy

  if (hierarchyCandidates.length >= 2) {
    lines.push(`- Hierarchy detected: ${hierarchyCandidates.map((c) => `${c.name} (~${c.uniqueCount ?? "?"} values)`).join(" → ")} (from broadest to most granular)`);
  }

  // 4. DATA GRAIN — what does each row represent?
  const identifiers = allColumns.filter((c) => c.role === "identifier" || c.name.toLowerCase().includes("item") || c.name.toLowerCase().includes("sku") || c.name.toLowerCase().includes("upc") || c.name.toLowerCase().includes("code"));
  if (identifiers.length > 0) {
    lines.push(`- Data grain: one row per ${identifiers.map((c) => c.name).join(" / ")} (item/SKU level)`);
  }

  // 5. CHART TYPE CONSTRAINTS from detected structure
  if (periodPairs.length > 0) {
    lines.push(`- Chart constraint: For CY vs PY comparisons, use grouped_bar (side-by-side) or horizontal_bar (ranked by change). NEVER use line or area charts — there is no time series dimension.`);
  }

  // 6. ONTOLOGY MAPPING — translate raw column names to canonical English
  const columnNames = allColumns.map((c) => c.name);
  const sampleMap: Record<string, string[]> = {};
  for (const col of allColumns) {
    if (col.sampleValues?.length) sampleMap[col.name] = col.sampleValues;
  }
  const canonicalColumns = mapColumns(columnNames, sampleMap);
  const mappedColumns = canonicalColumns.filter((c) => c.canonicalName !== c.originalName);
  if (mappedColumns.length > 0) {
    lines.push(`- Column dictionary (use canonical names in chart labels and slide text):`);
    for (const c of mappedColumns.slice(0, 15)) {
      const unitInfo = c.unit?.type === "currency" && c.unit.currencySymbol ? ` [${c.unit.currencySymbol}]` : c.unit?.type === "percentage" ? " [%]" : "";
      lines.push(`  "${c.originalName}" → "${c.canonicalName}"${unitInfo} (${c.role})`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
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
    // Try exact match first
    let sheetRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspace_sheets?workspace_id=eq.${runId}&sheet_key=eq.${encodeURIComponent(sheetKey)}&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          Accept: "application/json",
        },
      },
    );
    let sheets: Array<{ blob_path: string; sheet_key: string }> = [];
    if (sheetRes.ok) sheets = await sheetRes.json();

    // If exact match fails, try fuzzy match: plan may use "fileId:SheetName"
    // but DB stores "fileId:FileName.xlsx · SheetName"
    if (!sheets[0]?.blob_path) {
      // Try suffix match using PostgREST like operator
      const suffixKey = sheetKey.includes(":") ? sheetKey.split(":").pop() ?? sheetKey : sheetKey;
      sheetRes = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/evidence_workspace_sheets?workspace_id=eq.${runId}&sheet_key=like.*${encodeURIComponent(suffixKey)}&limit=1`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            Accept: "application/json",
          },
        },
      );
      if (sheetRes.ok) sheets = await sheetRes.json();
    }

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

// ─── V1 PIPELINE: DETERMINISTIC DATA HELPERS ─────────────────────
// Replicates the filter/group/aggregate logic from data-exploration.ts
// so the chart builder can run without any LLM calls.

function v1EvaluateCondition(row: Record<string, unknown>, condition: string): boolean {
  const match = condition.trim().match(/^"?(.+?)"?\s*(=|!=|<>|>|>=|<|<=|LIKE|IN)\s*(.+)$/i);
  if (!match) return false;
  const [, col, op, rawVal] = match;
  const rowVal = row[col.trim()];
  const val = rawVal.trim().replace(/^['"]|['"]$/g, "");
  // Case-insensitive string comparison — "AFFINITY" matches "Affinity"
  const rowStr = String(rowVal ?? "").toLowerCase();
  const valLower = val.toLowerCase();
  switch (op.toUpperCase()) {
    case "=": return rowStr === valLower;
    case "!=": case "<>": return rowStr !== valLower;
    case ">": return Number(rowVal) > Number(val);
    case ">=": return Number(rowVal) >= Number(val);
    case "<": return Number(rowVal) < Number(val);
    case "<=": return Number(rowVal) <= Number(val);
    case "LIKE": return rowStr.includes(valLower.replace(/%/g, ""));
    case "IN": {
      const inVals = val.replace(/^\(|\)$/g, "").split(",").map((v) => v.trim().replace(/^['"]|['"]$/g, "").toLowerCase());
      return inVals.some((iv) => rowStr === iv);
    }
    default: return true;
  }
}

function v1ApplyFilter(rows: Record<string, unknown>[], filterExpr: string): Record<string, unknown>[] {
  if (!filterExpr || filterExpr === "none") return rows;
  const orBranches = filterExpr.split(/\s+OR\s+/i);
  return rows.filter((row) =>
    orBranches.some((branch) => {
      const andConditions = branch.split(/\s+AND\s+/i);
      return andConditions.every((condition) => v1EvaluateCondition(row, condition));
    }),
  );
}

function v1Round(value: number, decimals = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function v1GroupAndAggregate(
  rows: Record<string, unknown>[],
  dataSpec: {
    dimensions: string[];
    measures: string[];
    aggregation: string;
    sort: string;
    limit: number;
    highlightCategory: string;
  },
): { categories: string[]; series: Array<{ name: string; values: number[] }>; xAxis: string; data: Record<string, unknown>[] } {
  const { dimensions, measures, aggregation, sort, limit } = dataSpec;

  // Group by dimensions
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = dimensions.map((d) => String(row[d] ?? "")).join(" | ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Aggregate measures per group
  const aggregated: Array<{ categoryKey: string; values: Record<string, number> }> = [];
  for (const [key, groupRows] of groups) {
    const values: Record<string, number> = {};
    for (const measure of measures) {
      const nums = groupRows.map((r) => {
        const v = r[measure];
        return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
      }).filter((n) => !isNaN(n));

      switch (aggregation) {
        case "sum": values[measure] = nums.reduce((a, b) => a + b, 0); break;
        case "avg": values[measure] = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; break;
        case "count": values[measure] = groupRows.length; break;
        case "min": values[measure] = nums.length > 0 ? Math.min(...nums) : 0; break;
        case "max": values[measure] = nums.length > 0 ? Math.max(...nums) : 0; break;
        default: values[measure] = nums.reduce((a, b) => a + b, 0); break;
      }
      values[measure] = v1Round(values[measure]);
    }
    aggregated.push({ categoryKey: key, values });
  }

  // Sort
  if (sort === "desc" && measures.length > 0) {
    aggregated.sort((a, b) => (b.values[measures[0]] ?? 0) - (a.values[measures[0]] ?? 0));
  } else if (sort === "asc" && measures.length > 0) {
    aggregated.sort((a, b) => (a.values[measures[0]] ?? 0) - (b.values[measures[0]] ?? 0));
  }

  // Limit
  const limited = limit > 0 ? aggregated.slice(0, limit) : aggregated;

  // Build output
  const categories = limited.map((a) => a.categoryKey);
  const series = measures.map((measure) => ({
    name: measure,
    values: limited.map((a) => a.values[measure] ?? 0),
  }));

  // Build data array (row-oriented for PPTX renderer)
  const xAxis = dimensions[0] ?? "category";
  const data = limited.map((a) => {
    const row: Record<string, unknown> = { [xAxis]: a.categoryKey };
    for (const measure of measures) {
      row[measure] = a.values[measure] ?? 0;
    }
    return row;
  });

  return { categories, series, xAxis, data };
}

// ─── V1 PIPELINE: SLIDE AUTHOR SYSTEM PROMPT ─────────────────────

const V1_SLIDE_AUTHOR_SYSTEM_PROMPT = `You are a senior strategy consultant writing ONE slide. You are a VISUAL STORYTELLER.

## TITLE (non-negotiable)
Full sentence with at least one number. Max 14 words. Must pass "so what?" test.
NEVER: "Category Overview", "Market Analysis", "Summary"
ALWAYS: "Cat wet is the largest pool at 781M but Ultima captures only 0.8%"

## CALLOUT (required on every slide except cover)
Max 20 words. Says what to DO or WORRY ABOUT. tone: green=opportunity, orange=risk, accent=finding.

## LANGUAGE
Write in the specified language. Never default to English.

## LAYOUT-SPECIFIC TEXT BUDGETS (HARD LIMITS — violating these is a failure)

cover:
  title + subtitle only. NO body, NO bullets, NO metrics, NO callout.

exec-summary:
  metrics: exactly 3 KPI cards. Delta MUST be numeric (+4.2%, -0.8 pts, flat).
  body: 1 sentence max (the SCQA answer). 25 words max.
  bullets: NONE.

chart-split / title-chart:
  body: 1 sentence. 30 words max. Explains WHY, not WHAT.
  bullets: max 2 bullets, max 12 words each.
  The CHART is the content. Text is minimal support.

title-body:
  body: max 2 sentences. 50 words max.
  bullets: max 3 bullets, max 12 words each.
  RARE: max 1 per deck. If you're writing prose, you're probably wrong.

summary / recommendation:
  body: 1 sentence framing the action.
  bullets: 3-4 specific, quantified actions. Each max 15 words.
  NOT a memo. NOT an agenda. Specific retailer/SKU/channel actions.

table:
  NO body text. The table IS the content.

## EVIDENCE
Only cite evidence IDs from your context. Never invent.

## LABELS
Never raw column names. "V. Valore" → "Sales Value". Internal codes → product names.`;

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
  { id: "basquio-v2-generation", retries: 0 },
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
    const runStartMs = Date.now();

    try {
    // ─── STEP 1: NORMALIZE (deterministic) ──────────────────────
    const workspace = await step.run("normalize", async () => {
      await updateRunStatus(runId, "running", "normalize");
      await emitRunEvent(runId, "normalize", "phase_started");

      // Download source files
      for (const id of sourceFileIds) { assertUuid(id, "sourceFileId"); }
      const filesResponse = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/source_files?id=in.(${sourceFileIds.join(",")})`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
        },
      );

      if (!filesResponse.ok) {
        throw new NonRetriableError(`Failed to fetch source files: ${filesResponse.status} ${filesResponse.statusText}`);
      }

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
              // Region metadata (null for simple CSV/streaming-parsed sheets)
              ...(manifest.regionId ? {
                region_id: manifest.regionId,
                region_index: manifest.regionIndex,
                region_type: manifest.regionType,
                region_confidence: manifest.regionConfidence,
                region_bounds: manifest.regionBounds,
                source_sheet_key: manifest.sourceSheetKey,
                formula_columns: manifest.formulaColumns,
              } : {}),
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

        const refId = `doc-${f.id.slice(-8)}`;
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

            // Process up to 10 slides (vision is cheap: ~$0.02/slide)
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
  "charts": [{ "chartType": "bar|line|pie|stacked|scatter|waterfall|other", "title": "...", "categories": ["..."], "series": [{ "name": "...", "values": [number, ...] }], "unit": "currency|%|units|..." }],
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
                    const refId = `doc-${f.id.slice(-8)}-slide-${slide.slideNum}-vision`;

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
                    const existingPageRef = `doc-${f.id.slice(-8)}-page-${slide.slideNum}`;
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
    let analystResult: AnalystResult;
    try {
      analystResult = await step.invoke("understand", {
        function: basquioUnderstand,
        data: { runId, brief },
        timeout: "20m",
      }) as AnalystResult;
    } catch (error) {
      console.error(`[basquio-v2] Understand phase failed, using minimal analysis:`, error);
      analystResult = {
        analysis: { domain: "general", summary: "Analysis could not be completed — proceeding with available evidence", analysisMode: "deep_analysis", topFindings: [], keyDimensions: [], recommendedChartTypes: [], metricsComputed: 0, queriesExecuted: 0, filesAnalyzed: 0 },
        storylinePlan: null,
        clarifiedBrief: null,
      };
    }

    // ─── STEP 2.5+3+4: PLAN + AUTHOR + POLISH (child function) ────
    // Entire plan → author → polish block runs in a child function with
    // its own 25min timeout. Isolates the most token-heavy phase.
    let authorResult: { deckSummary: string; slideCount: number; chartCount: number; estimatedCostUsd?: number };
    try {
      authorResult = await step.invoke("author-polish", {
        function: basquioAuthor,
        data: { runId, brief },
        timeout: "25m",
      }) as typeof authorResult;
    } catch (error) {
      console.error(`[basquio-v2] Author phase failed, checking for partial slides:`, error);
      const partialSlides = await getSlides(runId);
      const partialCharts = await getV2ChartRows(runId);
      if (partialSlides.length === 0) throw error; // No slides at all — cannot recover
      authorResult = { deckSummary: `Partial: ${partialSlides.length} slides recovered`, slideCount: partialSlides.length, chartCount: partialCharts.length };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const deckSummary = authorResult.deckSummary;

    // Plan+Author+Polish code has been moved to basquioAuthor child function.
    // Dead code removed — see basquioAuthor for the implementation.

    // ─── STEP 4+5: CRITIQUE + REVISE (invoked as child function) ───
    let critiqueReviseResult: { hasCriticalOrMajor: boolean; degradedDelivery: boolean; degradedIssues: Array<{ severity: string; claim: string }> };
    try {
      critiqueReviseResult = await step.invoke("critique-revise", {
        function: basquioCritiqueRevise,
        data: { runId, brief, sourceFileIds },
        timeout: "25m",
      }) as typeof critiqueReviseResult;
    } catch (error) {
      console.error(`[basquio-v2] Critique-revise failed, skipping:`, error);
      critiqueReviseResult = { hasCriticalOrMajor: false, degradedDelivery: true, degradedIssues: [{ severity: "major", claim: "Quality review skipped due to error" }] };
    }

    let { hasCriticalOrMajor, degradedDelivery, degradedIssues } = critiqueReviseResult;

    // OLD INLINE CRITIQUE+REVISE CODE — replaced by step.invoke(basquioCritiqueRevise)
    // Kept as dead code reference for the child function implementation.

    // ─── STEP 6: EXPORT (invoked as separate Inngest function) ─────
    // Export runs as a child function with its own 15min timeout and retries.
    // This eliminates replay overhead from the 20+ steps in the parent.
    const artifacts = await step.invoke("export", {
      function: basquioExport,
      data: {
        runId,
        exportMode: "universal-compatible", // V1 pipeline: always universal-compatible
        hasCriticalOrMajor,
        degradedDelivery,
        degradedIssues,
        deckTitle: brief.slice(0, 100),
        sourceFileIds,
      },
      timeout: "15m",
    });

    // Export child function handles: source coverage, PPTX render, QA, manifest, status update.

    // ─── COST SUMMARY (from child function returns) ─────────────
    const costSummary = tracker.getSummary(runId);
    // Understand returns costSummary with totalUsage from analyst agent (GPT-5.4: $2.50/$15 per MTok)
    const understandReturn = analystResult as Record<string, unknown>;
    const understandSummary = understandReturn?.costSummary as { estimatedCostUsd?: number; totalUsage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number } } | undefined;
    const understandCost = understandSummary?.estimatedCostUsd ?? 0;
    const understandTokens = understandSummary?.totalUsage ?? {};
    // Author returns estimatedCostUsd + tokenUsage from actual generateObject calls
    const authorReturn = authorResult as Record<string, unknown>;
    const authorCost = (authorReturn?.estimatedCostUsd as number) ?? 0;
    const authorTokens = (authorReturn?.tokenUsage as { inputTokens?: number; outputTokens?: number; totalTokens?: number }) ?? {};
    // Critique-revise returns estimatedCostUsd (from LLM critic agents)
    const critiqueReturn = critiqueReviseResult as Record<string, unknown>;
    const critiqueCost = (critiqueReturn?.estimatedCostUsd as number) ?? 0;
    // Aggregate: understand + author + critique/revise
    costSummary.estimatedCostUsd = Math.round((understandCost + authorCost + critiqueCost) * 1000) / 1000;
    costSummary.durationMs = Date.now() - runStartMs;
    costSummary.totalUsage = {
      totalTokens: (understandTokens.totalTokens ?? 0) + (authorTokens.totalTokens ?? 0),
      inputTokens: (understandTokens.inputTokens ?? 0) + (authorTokens.inputTokens ?? 0),
      outputTokens: (understandTokens.outputTokens ?? 0) + (authorTokens.outputTokens ?? 0),
    };
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

    // Persist cost telemetry to deck_runs (best-effort — don't crash if column missing)
    try {
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
          body: JSON.stringify({
            cost_telemetry: {
              totalTokens: costSummary.totalUsage.totalTokens,
              inputTokens: costSummary.totalUsage.inputTokens,
              outputTokens: costSummary.totalUsage.outputTokens,
              estimatedCostUsd: costSummary.estimatedCostUsd,
              durationMs: costSummary.durationMs,
              phases: costSummary.phases,
              budgetExceeded: budgetCheck.exceeded,
            },
          }),
        },
      );
    } catch (e) {
      console.warn("Failed to persist cost telemetry:", e);
    }

    return { runId, artifacts, costSummary };

    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown orchestration error";
      console.error(`[basquio-v2] Run ${runId} failed:`, message);

      // Attempt best-effort export with whatever slides exist
      try {
        const existingSlides = await getSlides(runId);

        // If zero slides, create a minimal error slide so the user always gets SOMETHING
        if (existingSlides.length === 0) {
          console.warn(`[basquio-v2] Zero slides found — creating error slide`);
          await persistSlide(runId, {
            position: 1,
            layoutId: "title-body",
            title: "Analysis could not be completed",
            body: `We encountered an error while generating your deck: ${message.slice(0, 300)}. Please try again or contact support.`,
            evidenceIds: [],
          });
        }

        console.warn(`[basquio-v2] Attempting best-effort export with ${existingSlides.length || 1} slides`);
        await step.invoke("best-effort-export", {
          function: basquioExport,
          data: {
            runId,
            exportMode: "universal-compatible", // V1 pipeline: always universal-compatible
            hasCriticalOrMajor: true,
            degradedDelivery: true,
            degradedIssues: [{ severity: "critical", claim: `Pipeline error: ${message.slice(0, 200)}` }],
            deckTitle: brief.slice(0, 100),
            sourceFileIds,
            skipSourceCoverage: true,
          },
          timeout: "10m",
        });
        await updateRunStatus(runId, "completed", "export", {
          failure_message: `Completed with degraded delivery: ${message.slice(0, 500)}`,
        });
        await updateDeliveryStatus(runId, "degraded");
        return { runId, artifacts: null, costSummary: null, degraded: true };
      } catch (bestEffortError) {
        console.error(`[basquio-v2] Best-effort export also failed:`, bestEffortError);
      }

      // Absolute last resort: render a minimal error PPTX directly (no child function)
      try {
        const { renderV2PptxArtifact } = await import("@basquio/render-pptx/v2");
        const errorSlides = await getSlides(runId).catch(() => []);
        const slidesForRender = errorSlides.length > 0
          ? errorSlides.map((s) => ({
              id: s.id, position: s.position, layoutId: s.layoutId ?? "title-body",
              title: s.title ?? "", body: s.body, bullets: s.bullets,
              chartId: s.chartId, kicker: s.kicker, evidenceIds: s.evidenceIds ?? [],
              callout: s.callout ? (typeof s.callout === "string" ? JSON.parse(s.callout) : s.callout) : undefined,
              metrics: s.metrics ? (typeof s.metrics === "string" ? JSON.parse(s.metrics) : s.metrics) : undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            })) as any
          : [{ id: "error", position: 1, layoutId: "title-body",
               title: "Analysis could not be completed",
               body: `Error: ${message.slice(0, 300)}. Please try again.`,
               evidenceIds: [] }];
        const pptx = await renderV2PptxArtifact({
          slides: slidesForRender, charts: [], deckTitle: brief.slice(0, 100),
          exportMode: "universal-compatible",
        });
        const buf = Buffer.isBuffer(pptx.buffer) ? pptx.buffer : Buffer.from((pptx.buffer as { data: number[] }).data);
        await uploadToStorage({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          bucket: "artifacts", storagePath: `${runId}/deck.pptx`, body: buf, contentType: pptx.mimeType,
        });
        await updateRunStatus(runId, "completed", "export", {
          failure_message: `Last-resort export: ${message.slice(0, 500)}`,
        });
        await updateDeliveryStatus(runId, "degraded");
        return { runId, artifacts: null, costSummary: null, degraded: true, lastResort: true };
      } catch (lastResortError) {
        console.error(`[basquio-v2] Last-resort PPTX render also failed:`, lastResortError);
      }

      // If even the last-resort PPTX render fails, mark as failed
      await updateDeliveryStatus(runId, "failed").catch(() => {});
      await updateRunStatus(runId, "failed", undefined, {
        failure_message: message.slice(0, 1000),
      }).catch(() => {});
      return { runId, artifacts: null, costSummary: null, failed: true, error: message.slice(0, 500) };
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
      if (!workspace) throw new NonRetriableError(`Workspace not found for run ${runId}`);
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
          analysisMode: result.analysis?.analysisMode ?? "deep_analysis",
          requestedSlideCount: result.clarifiedBrief?.requestedSlideCount ?? null,
          audience: result.clarifiedBrief?.audience ?? "Executive stakeholder",
          focalEntity: result.clarifiedBrief?.focalEntity ?? "",
          coreQuestion: result.clarifiedBrief?.objective ?? brief,
          exportMode: ((event.data as Record<string, unknown>).exportMode as string) ?? "powerpoint-native",
          costTier: "standard" as const,
          language: result.clarifiedBrief?.language ?? "en",
          evidenceConfidence: result.analysis?.topFindings?.length > 0 ? 0.7 : 0.3,
          sourceManifest: (workspace.fileInventory ?? []).map((f: { id?: string; fileName?: string; kind?: string }) => ({
            fileId: f.id ?? "",
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
 * Deterministic plan validation — $0 cost, runs after LLM plan generation.
 * Enforces structural rules that the LLM doesn't reliably follow.
 */
function validateAndFixPlan(plan: V1DeckPlan, analysisFindings?: Array<{ title: string; claim: string; evidenceRefIds: string[]; businessImplication: string }>, recommendedChartTypes?: Array<{ findingIndex: number; chartType: string; rationale: string }>): V1DeckPlan {
  const slides = [...plan.slides].sort((a, b) => a.position - b.position);
  const charts = [...plan.charts];
  const chartIds = new Set(charts.map(c => c.chartId));

  // ── Rule 1: Max 1 memo slide (title-body or title-bullets without chart) ──
  const memoLayouts = new Set(["title-body", "title-bullets"]);
  const memoSlides = slides.filter(s =>
    memoLayouts.has(s.layout) && !s.chartId
  );
  if (memoSlides.length > 1) {
    // Keep first memo, convert rest to chart-split
    for (const memo of memoSlides.slice(1)) {
      memo.layout = "chart-split";
    }
  }

  // ── Rule 2: Every chart-layout slide must have a valid chart; chartless analytical slides get upgraded ──
  const chartLayoutSet = new Set(["chart-split", "title-chart", "evidence-grid", "comparison", "two-column"]);
  const analyticalSlides = slides.filter(s =>
    s.position > 2 && s.position < slides.length && !["cover", "exec-summary"].includes(s.role)
  );

  for (const s of slides) {
    if (s.chartId && !chartIds.has(s.chartId)) {
      s.chartId = ""; // Clear broken reference
    }
  }

  // Force charts on ALL analytical slides (positions 3 to N-1)
  for (const s of analyticalSlides) {
    if (s.chartId && chartIds.has(s.chartId)) continue; // Already has valid chart

    // Try to find an unassigned chart
    const assignedChartIds = new Set(slides.filter(sl => sl.chartId).map(sl => sl.chartId));
    const unassigned = charts.find(c => !assignedChartIds.has(c.chartId));
    if (unassigned) {
      s.chartId = unassigned.chartId;
      if (!chartLayoutSet.has(s.layout)) s.layout = "chart-split";
      continue;
    }

    // No unassigned charts — generate one from analysis findings
    const slideIndex = slides.indexOf(s);
    const findingIndex = slideIndex - 2; // offset for cover + exec-summary
    const finding = analysisFindings?.[findingIndex];
    const chartRec = recommendedChartTypes?.find(r => r.findingIndex === findingIndex);
    if (finding) {
      const newChartId = `chart-gen-${charts.length + 1}`;
      charts.push({
        chartId: newChartId,
        chartType: chartRec?.chartType ?? "horizontal_bar",
        title: finding.title,
        sourceNote: "",
        intent: "rank",
        unit: "",
        evidenceRefIds: finding.evidenceRefIds ?? [],
        dataSpec: {
          sheetKey: "",
          dimensions: [] as string[],
          measures: [] as string[],
          filter: "none",
          aggregation: "sum",
          sort: "desc",
          limit: 10,
          highlightCategory: plan.focalEntity ?? "",
        },
      } as typeof charts[0]);
      s.chartId = newChartId;
      if (!chartLayoutSet.has(s.layout)) s.layout = "chart-split";
    }
    // If no finding available either, leave as-is (will be title-body)
  }

  // Also fix any chart-layout slide that still has no chart
  for (const s of slides) {
    if (chartLayoutSet.has(s.layout) && !s.chartId) {
      s.layout = "title-body";
    }
  }

  // ── Rule 3: Verify SCQA structure ──
  // Slide 1 must be cover
  if (slides.length > 0 && slides[0].layout !== "cover") {
    slides[0].layout = "cover";
    slides[0].role = "cover";
    slides[0].chartId = "";
  }
  // Slide 2 must be exec-summary
  if (slides.length > 1 && slides[1].layout !== "exec-summary") {
    slides[1].layout = "exec-summary";
    slides[1].role = "exec-summary";
  }
  // Last slide must be recommendation or summary
  const last = slides[slides.length - 1];
  if (last && !["summary", "recommendation"].includes(last.role)) {
    last.role = "recommendation";
    last.layout = "summary";
  }

  // ── Rule 4: Cap at 12 slides ──
  if (slides.length > 12) {
    // Keep cover, exec-summary, last (recommendation). Remove weakest middle slides.
    const protected_ = new Set([1, 2, slides.length]); // positions to keep
    const removable = slides.filter(s => !protected_.has(s.position));
    // Sort: slides without charts first (least valuable)
    removable.sort((a, b) => {
      const aHasChart = a.chartId ? 1 : 0;
      const bHasChart = b.chartId ? 1 : 0;
      return aHasChart - bHasChart; // no-chart slides first
    });
    const toRemove = removable.slice(0, slides.length - 12);
    const removePositions = new Set(toRemove.map(s => s.position));
    const kept = slides.filter(s => !removePositions.has(s.position));
    // Re-number positions
    kept.forEach((s, i) => { s.position = i + 1; });
    // Remove orphaned charts
    const keptChartIds = new Set(kept.filter(s => s.chartId).map(s => s.chartId));
    const keptCharts = charts.filter(c => keptChartIds.has(c.chartId));
    return { ...plan, slides: kept, charts: keptCharts, targetSlideCount: kept.length };
  }

  // ── Rule 5: Deduplicate governing thoughts (weak similarity check) ──
  const seen = new Map<string, number>(); // normalized thought → position
  for (const s of slides) {
    if (!s.governingThought) continue;
    const normalized = s.governingThought.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const words = normalized.split(/\s+/).slice(0, 5).join(" "); // First 5 words
    if (seen.has(words) && s.role !== "cover" && s.role !== "exec-summary") {
      // Duplicate — keep the one with a chart
      const existing = slides.find(sl => sl.position === seen.get(words));
      if (existing && !existing.chartId && s.chartId) {
        existing.governingThought = s.governingThought;
        existing.chartId = s.chartId;
        existing.layout = s.layout;
      }
    } else {
      seen.set(words, s.position);
    }
  }

  return { ...plan, slides, charts, targetSlideCount: slides.length };
}

/**
 * basquioAuthor: V1 Pipeline — Plan + Build Charts (deterministic) + Author Slides (parallel) + Critique + Repair
 *
 * Architecture:
 * 1. plan-deck: GPT-5.4-mini structured output → V1DeckPlan with chart grammar per chart
 * 1.5. validate-plan: Deterministic structural validation ($0 cost)
 * 2. build-charts: Deterministic step, ZERO LLM — executes chart grammar against data
 * 3. author-slides: Parallel batches of 4 — each slide is ONE generateObject call with ~15K context
 * 4. critique-deterministic: Referential integrity + structural checks (no LLM)
 * 5. critique-narrative: ONE Sonnet call for quality review
 * 6. repair: Critical-only, max 3 slides, fresh context, Haiku
 *
 * Constraints:
 * - No Opus anywhere
 * - No section-level tool loops
 * - Max 12 slides, max 10 charts, max 1 chart per slide
 */
export const basquioAuthor = inngest.createFunction(
  { id: "basquio-author", retries: 0, timeouts: { finish: "25m" } },
  { event: "basquio/author.requested" },
  async ({ event, step }) => {
    const { runId, brief } = event.data as { runId: string; brief: string };

    // Token accumulator for real cost telemetry (shared across plan/author/critique/repair steps)
    const tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, callCount: 0 };

    // Domain knowledge for V1 slide authoring (FMCG lens if detected, computed once)
    const v1AuthorDomainContext = buildDomainKnowledgeContext({
      workspace: undefined, // workspace loaded later, but brief is enough for initial detection
      brief,
      stage: "author",
    });
    const v1SlideSystemPrompt = v1AuthorDomainContext
      ? `${V1_SLIDE_AUTHOR_SYSTEM_PROMPT}\n\n${v1AuthorDomainContext}`
      : V1_SLIDE_AUTHOR_SYSTEM_PROMPT;
    // Per-model cost accumulator (exact pricing, not blended)
    let exactCostUsd = 0;
    // Model pricing per million tokens (March 2026 verified)
    const MODEL_PRICES: Record<string, { input: number; output: number }> = {
      "gpt-5.4-mini": { input: 0.75, output: 4.50 },
      "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
      "claude-haiku-4-5": { input: 1.00, output: 5.00 },
    };
    function addUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined, modelId: string) {
      if (!usage) return;
      const inp = usage.inputTokens ?? 0;
      const out = usage.outputTokens ?? 0;
      tokenUsage.inputTokens += inp;
      tokenUsage.outputTokens += out;
      tokenUsage.totalTokens += (usage.totalTokens ?? inp + out);
      tokenUsage.callCount += 1;
      const prices = MODEL_PRICES[modelId] ?? MODEL_PRICES["claude-haiku-4-5"];
      exactCostUsd += (inp * prices.input + out * prices.output) / 1_000_000;
    }

    const HARD_BUDGET_USD = 1.0;
    function isOverBudget(): boolean { return exactCostUsd >= HARD_BUDGET_USD; }
    function remainingBudget(): number { return Math.max(0, HARD_BUDGET_USD - exactCostUsd); }

    // Clear stale slides/charts from any previous execution
    await step.run("clear-stale-data", async () => {
      await deleteRunSlides(runId);
      await deleteRunCharts(runId);
    });

    // ─── STEP 1: PLAN (GPT-5.4-mini, structured output with chart grammar) ───
    const v1Plan = await step.run("plan-deck", async () => {
      await updateRunStatus(runId, "running", "author"); // "plan" is part of author phase (no separate DB enum)
      await emitRunEvent(runId, "author", "phase_started");

      const analysisResult = await loadWorkingPaper<{
        analysis: {
          domain: string; summary: string; analysisMode?: string;
          topFindings: Array<{ confidence: number; title: string; claim: string; evidenceRefIds: string[]; businessImplication: string }>;
          metricsComputed: number; queriesExecuted: number; filesAnalyzed: number;
          keyDimensions: string[];
          recommendedChartTypes: Array<{ findingIndex: number; chartType: string; rationale: string }>;
        };
        clarifiedBrief?: {
          audience: string; objective: string; stakes: string;
          governingQuestion: string; focalEntity: string; focalBrands: string[];
          language: string; requestedSlideCount: number | null; hypotheses: string[];
        };
        storylinePlan?: {
          governingQuestion?: string;
          issueBranches: Array<{ question: string; conclusion: string; hypotheses: Array<{ claim: string }> }>;
          titleReadThrough?: string[];
        };
      }>(runId, "analysis_result");
      if (!analysisResult) throw new NonRetriableError(`Analysis result not found for run ${runId}`);

      const analysis = analysisResult.analysis;
      const clarifiedBrief = analysisResult.clarifiedBrief;
      const storylinePlan = analysisResult.storylinePlan;

      // Determine target slide count (capped at 12)
      const clarifiedSlideCount = clarifiedBrief?.requestedSlideCount ?? null;
      const requestedSlideMatch = brief.match(/(\d+)\s*slide/i)
        ?? brief.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*slide/i);
      const wordToNum: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
      const parsedCount = requestedSlideMatch
        ? (parseInt(requestedSlideMatch[1], 10) || wordToNum[requestedSlideMatch[1].toLowerCase()] || undefined)
        : undefined;
      const requestedSlides = clarifiedSlideCount ?? parsedCount;
      const targetSlides = Math.min(requestedSlides ?? Math.min(Math.max(8, analysis.topFindings.length + 4), 12), 12);

      // Build workspace sheet inventory for the planner to reference
      const workspace = await loadWorkspaceFromDb(runId);
      const sheetInventory = workspace?.fileInventory?.flatMap((f) =>
        (f.sheets ?? []).filter(Boolean).map((s) => ({
          sheetKey: `${f.id}:${s?.name ?? "unknown"}`,
          fileName: f.fileName ?? "unknown",
          sheetName: s?.name ?? "unknown",
          rowCount: s?.rowCount ?? 0,
          columns: (s?.columns ?? []).filter(Boolean).map((c) => `${c?.name ?? "?"} (${c?.inferredType ?? "?"}, ${c?.role ?? "?"})`).join(", "),
        })),
      ) ?? [];

      const findingsSummary = analysis.topFindings
        .map((f, i) => `${i + 1}. [${f.title}] ${f.claim} (confidence: ${f.confidence}, evidence: [${f.evidenceRefIds.join(", ")}]) → ${f.businessImplication}`)
        .join("\n");

      const chartTypesSummary = analysis.recommendedChartTypes
        .map((c) => `Finding ${c.findingIndex + 1}: ${c.chartType} — ${c.rationale}`)
        .join("\n");

      let storylineContext = "";
      if (storylinePlan) {
        storylineContext = `\n\n## Storyline (issue tree)\nGoverning question: ${storylinePlan.governingQuestion ?? ""}\n${storylinePlan.issueBranches.map(
          (b) => `Q: ${b.question}\nConclusion: ${b.conclusion}\nHypotheses: ${b.hypotheses.map((h) => h.claim).join("; ")}`,
        ).join("\n\n")}`;
        if (storylinePlan.titleReadThrough?.length) {
          storylineContext += `\n\nProposed title sequence:\n${storylinePlan.titleReadThrough.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
        }
      }

      const sheetInventoryText = sheetInventory.length > 0
        ? `\n\n## Available data sheets\n${sheetInventory.map((s) => `- ${s.sheetKey} (${s.fileName} → ${s.sheetName}, ${s.rowCount} rows): ${s.columns}`).join("\n")}`
        : "";

      // ─── DETERMINISTIC DATA INTELLIGENCE ($0 cost) ─────────────
      // Detect: currency, period structure, dimension/measure roles, hierarchy
      const dataIntelligence = buildDataIntelligence(workspace);
      const dataIntelligenceText = dataIntelligence
        ? `\n\n## Data Intelligence (auto-detected, use this for chart design)\n${dataIntelligence}`
        : "";

      // ─── FMCG DOMAIN KNOWLEDGE (conditional, ~$0.005) ─────────
      const planDomainContext = buildDomainKnowledgeContext({
        workspace: workspace ?? undefined,
        brief,
        stage: "storyline",
      });
      const planDomainText = planDomainContext ? `\n\n${planDomainContext}` : "";

      try {
        const planGenResult = await generateObject({
          model: openai("gpt-5.4-mini"),
          schema: v1DeckPlanSchema,
          prompt: `You are a top-tier strategy consultant deck architect (McKinsey/BCG-level). Plan a ${targetSlides}-slide VISUAL presentation — not a text report.

## EXHIBIT PLANNER RULES (non-negotiable)
Every analytical content slide (positions 3 through N-1) MUST have a chart with a valid chartId. ZERO text-only analytical slides allowed. The ONLY slides without charts are: cover (position 1), exec-summary (position 2, but SHOULD have a chart), and the final summary/recommendation slide.

Choose chart types by ANALYTICAL QUESTION, not data availability:
- "How big is each segment?" → horizontal_bar (ranked by size, largest on top)
- "How does mix compare?" → stacked_bar_100 (category mix vs brand mix side-by-side)
- "Current vs prior period?" → grouped_bar or waterfall (NEVER line chart for 2-period data)
- "What's growing/declining?" → horizontal_bar (sorted by growth rate, green/red coding)
- "Who dominates?" → doughnut or pareto (concentration chart)
- "What are the top N items?" → horizontal_bar with humanized labels
- "How does performance vary?" → heatmap or scatter
- "What changed and why?" → waterfall (bridge chart)

NEVER use a line chart unless there are 4+ time periods in sequence.
NEVER use a line chart for categorical comparisons.

## STORY COMPRESSION RULES
- Each slide answers exactly ONE strategic question
- No slide repeats a point already made earlier
- The deck should ESCALATE: context → tension → evidence → action
- Max 8-10 content slides. Fewer is better.
- Kill any slide that only restates what another slide already proved
- Recommendation slide must have specific, quantified actions — not topic labels

## Brief
${brief}

## Analysis findings
${findingsSummary}

## Recommended chart types
${chartTypesSummary}
${storylineContext}
${sheetInventoryText}${dataIntelligenceText}${planDomainText}

## Focal entity
${clarifiedBrief?.focalEntity ?? "(detect from brief)"}
Focal brands: ${clarifiedBrief?.focalBrands?.join(", ") ?? "(detect from data)"}

## Language
${clarifiedBrief?.language ?? "en"}

## CRITICAL RULES
1. Exactly ${targetSlides} slides. Max 10 charts. Max 1 chart per slide.
2. Cover (position 1), exec-summary (position 2), recommendation/summary (last position).
3. Each chart MUST have a complete dataSpec with a valid sheetKey from the available sheets list.
4. Chart IDs: use "chart-1", "chart-2", etc. Slides reference these IDs.
5. Filter expressions use: "column = value AND column2 > 100" syntax. Use "none" if no filter.
6. Every analytical slide (positions 3 to N-1) MUST have a chartId. Only cover and final summary may have chartId="".
7. Prefer horizontal_bar for rankings, line for trends, stacked_bar for composition, pie only for ≤5 categories.
8. Set highlightCategory to the focal entity name for emphasis on every chart.
9. Sort "desc" for rankings, "asc" for smallest-first, "none" for time series.
10. Limit: 8-12 for bar charts, 0 (no limit) for line/time series.

Return a V1DeckPlan with slides and charts.`,
        });

        const plan = planGenResult.object as V1DeckPlan;
        addUsage(planGenResult.usage, "gpt-5.4-mini");
        try { await persistWorkingPaper(runId, "v1_deck_plan", plan); } catch {}
        return plan;
      } catch (planError) {
        console.error("[basquio-author] Plan generation failed:", planError);
        // Fallback: minimal plan with no charts
        const fallbackPlan: V1DeckPlan = {
          targetSlideCount: targetSlides,
          slides: Array.from({ length: targetSlides }, (_, i) => ({
            position: i + 1,
            role: i === 0 ? "cover" : i === 1 ? "exec-summary" : i === targetSlides - 1 ? "summary" : "evidence",
            layout: i === 0 ? "cover" : i === 1 ? "exec-summary" : i === targetSlides - 1 ? "summary" : "title-body",
            governingThought: analysis.topFindings[i - 2]?.claim ?? "",
            chartId: "",
            evidenceRequired: analysis.topFindings[i - 2]?.evidenceRefIds ?? [],
            focalObject: clarifiedBrief?.focalEntity ?? "",
          })),
          charts: [],
          appendixStrategy: "No appendix",
          focalEntity: clarifiedBrief?.focalEntity ?? "",
          language: clarifiedBrief?.language ?? "en",
        };
        try { await persistWorkingPaper(runId, "v1_deck_plan", fallbackPlan); } catch {}
        return fallbackPlan;
      }
    }) as V1DeckPlan;

    // ─── STEP 1.5: VALIDATE PLAN (deterministic, $0) ────────────────
    // Load analysis findings for plan validation (analysis was loaded inside plan-deck step)
    const analysisForValidation = await loadWorkingPaper<{
      analysis: {
        topFindings: Array<{ title: string; claim: string; evidenceRefIds: string[]; businessImplication: string }>;
        recommendedChartTypes: Array<{ findingIndex: number; chartType: string; rationale: string }>;
      };
    }>(runId, "analysis_result");
    const validatedPlan = validateAndFixPlan(
      v1Plan,
      analysisForValidation?.analysis?.topFindings,
      analysisForValidation?.analysis?.recommendedChartTypes,
    );

    // ─── STEP 2: BUILD CHARTS (deterministic, ZERO LLM) ──────────────
    const chartBuildResult = await step.run("build-charts", async () => {
      await emitRunEvent(runId, "author", "charts_build_started");
      const loadRows = createLoadSheetRows(runId);
      const chartResults: Array<{ chartId: string; plannedId: string; success: boolean; error?: string }> = [];

      // Cap at 10 charts
      const chartsToProcess = validatedPlan.charts.slice(0, 10);

      for (const planned of chartsToProcess) {
        try {
          // Skip generated charts with no data spec (from validateAndFixPlan auto-generation)
          if (!planned.dataSpec.sheetKey) {
            console.warn(`[basquio-author] Chart ${planned.chartId} has no sheetKey (auto-generated), skipping`);
            chartResults.push({ chartId: "", plannedId: planned.chartId, success: false, error: "No sheetKey — auto-generated chart without data binding" });
            continue;
          }

          // Load rows from the specified sheet
          const rows = await loadRows(planned.dataSpec.sheetKey);
          if (rows.length === 0) {
            chartResults.push({ chartId: "", plannedId: planned.chartId, success: false, error: `No rows in sheet ${planned.dataSpec.sheetKey}` });
            continue;
          }

          // Apply filter
          const filtered = v1ApplyFilter(rows, planned.dataSpec.filter);
          if (filtered.length === 0) {
            chartResults.push({ chartId: "", plannedId: planned.chartId, success: false, error: `No rows after filter: ${planned.dataSpec.filter}` });
            continue;
          }

          // Group by dimensions, aggregate measures
          const grouped = v1GroupAndAggregate(filtered, planned.dataSpec);

          // ─── EXHIBIT ENFORCEMENT (deterministic, $0) ───
          // Override chart type if it's wrong for the analytical question
          const questionType = inferQuestionType(planned.title || planned.intent || "");
          // Detect period count from plan's data intelligence (check if CY/PY columns exist)
          const hasPeriodPairs = validatedPlan.charts.some((c) =>
            c.dataSpec?.measures?.some((m: string) => /anno\s*prec|prior|py$/i.test(m))
          );
          const periodCount = hasPeriodPairs ? 2 : 1;
          const exhibitResult = enforceExhibit(questionType, planned.chartType, periodCount);
          if (exhibitResult.wasOverridden) {
            console.warn(`[basquio-author] Chart type overridden: ${planned.chartType} → ${exhibitResult.chartType} (${exhibitResult.reason})`);
          }

          // ─── EXHIBIT PREFLIGHT (deterministic validation, $0) ───
          // Prevent broken charts from reaching the renderer
          const allValues = grouped.series.flatMap((s) => s.values);
          const maxValue = Math.max(...allValues.map(Math.abs), 0);

          // 1. All-zero data → broken aggregation
          if (maxValue < 0.001 || allValues.every((v) => v === 0)) {
            console.warn(`[basquio-author] Chart ${planned.chartId} PREFLIGHT FAIL: all-zero data`);
            chartResults.push({ chartId: "", plannedId: planned.chartId, success: false, error: "All values are zero — data aggregation produced empty results" });
            continue;
          }

          // 2. Too many categories for the chart type (unreadable)
          const catCount = grouped.categories.length;
          if (catCount > 20 && !["table", "heatmap"].includes(exhibitResult.chartType)) {
            // Truncate to top 12 by first measure value
            const pairs = grouped.categories.map((c, i) => ({ cat: c, val: grouped.series[0]?.values[i] ?? 0 }));
            pairs.sort((a, b) => Math.abs(b.val) - Math.abs(a.val));
            const kept = new Set(pairs.slice(0, 12).map((p) => p.cat));
            const keptIndices = grouped.categories.map((c, i) => kept.has(c) ? i : -1).filter((i) => i >= 0);
            grouped.categories = keptIndices.map((i) => grouped.categories[i]);
            for (const s of grouped.series) {
              s.values = keptIndices.map((i) => s.values[i]);
            }
            grouped.data = keptIndices.map((i) => grouped.data[i]);
            console.warn(`[basquio-author] Chart ${planned.chartId} PREFLIGHT: truncated ${catCount} → ${grouped.categories.length} categories`);
          }

          // 3. Single-value chart (meaningless)
          if (catCount <= 1 && !["kpi_card", "table"].includes(exhibitResult.chartType)) {
            console.warn(`[basquio-author] Chart ${planned.chartId} PREFLIGHT FAIL: only ${catCount} category`);
            chartResults.push({ chartId: "", plannedId: planned.chartId, success: false, error: `Only ${catCount} category — not enough data for a chart` });
            continue;
          }

          // ─── ONTOLOGY MAPPER (deterministic label replacement, $0) ───
          // Replace raw Italian column names with canonical English in chart data
          const allColNames = [grouped.xAxis, ...grouped.series.map((s) => s.name)];
          const canonicalMap = mapColumns(allColNames);
          const colNameMap: Record<string, string> = {};
          for (const c of canonicalMap) {
            if (c.canonicalName !== c.originalName) colNameMap[c.originalName] = c.canonicalName;
          }
          // Apply to data rows
          const cleanedData = grouped.data.map((row) => {
            const clean: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(row)) {
              clean[colNameMap[key] ?? key] = val;
            }
            return clean;
          });
          const cleanXAxis = colNameMap[grouped.xAxis] ?? grouped.xAxis;
          const cleanSeries = grouped.series.map((s) => colNameMap[s.name] ?? s.name);

          // Infer currency unit from column data if not set
          const inferredUnit = planned.unit || (() => {
            const measureCol = canonicalMap.find((c) => c.role === "measure" && c.unit?.type === "currency");
            return measureCol?.unit?.currencySymbol ?? undefined;
          })();

          // Build chart data structure and persist
          const highlightCategories = planned.dataSpec.highlightCategory
            ? [planned.dataSpec.highlightCategory]
            : [];

          const chartResult = await persistChart(runId, {
            chartType: exhibitResult.chartType, // Enforced chart type
            title: planned.title,
            data: cleanedData,
            xAxis: cleanXAxis,
            series: cleanSeries,
            style: {
              highlightCategories,
              showLegend: grouped.series.length > 1,
              showValues: true,
            },
            intent: planned.intent,
            unit: inferredUnit,
            sourceNote: planned.sourceNote,
          });

          chartResults.push({ chartId: chartResult.chartId, plannedId: planned.chartId, success: true });
        } catch (chartError) {
          console.error(`[basquio-author] Chart ${planned.chartId} build failed:`, chartError);
          chartResults.push({
            chartId: "",
            plannedId: planned.chartId,
            success: false,
            error: chartError instanceof Error ? chartError.message : String(chartError),
          });
        }
      }

      // Build mapping from planned IDs to real DB IDs
      const chartIdMap: Record<string, string> = {};
      for (const r of chartResults) {
        if (r.success && r.chartId) {
          chartIdMap[r.plannedId] = r.chartId;
        }
      }

      const chartSucceeded = chartResults.filter((r) => r.success).length;
      const chartFailed = chartResults.filter((r) => !r.success).length;
      const chartErrors = chartResults.filter((r) => !r.success).map((r) => `${r.plannedId}: ${r.error}`);

      await emitRunEvent(runId, "author", "charts_build_completed", {
        total: chartsToProcess.length,
        succeeded: chartSucceeded,
        failed: chartFailed,
        errors: chartErrors.length > 0 ? chartErrors : undefined,
      });

      if (chartSucceeded === 0 && chartsToProcess.length > 0) {
        console.warn(`[basquio-author] ALL ${chartsToProcess.length} charts failed to build. Errors: ${chartErrors.join(" | ")}`);
      }

      return { chartIdMap, chartResults };
    }) as { chartIdMap: Record<string, string>; chartResults: Array<{ chartId: string; plannedId: string; success: boolean; error?: string }> };

    // ─── STEP 3: AUTHOR SLIDES (parallel batches, generateObject, fresh context) ─
    await step.run("author-slides", async () => {
      await updateRunStatus(runId, "running", "author");
      await emitRunEvent(runId, "author", "slides_author_started");

      // Load context once
      const analysisResult = await loadWorkingPaper<{
        analysis: {
          domain: string; summary: string;
          topFindings: Array<{ title: string; claim: string; evidenceRefIds: string[]; confidence: number; businessImplication: string }>;
          keyDimensions: string[];
        };
        clarifiedBrief?: { focalEntity: string; focalBrands: string[]; language: string };
      }>(runId, "analysis_result");
      const analysis = analysisResult?.analysis;
      const clarifiedBrief = analysisResult?.clarifiedBrief;

      // Build evidence index for quick lookup
      const evidenceList = await listEvidenceForRun(runId);
      const evidenceMap = new Map<string, string>();
      for (const e of evidenceList) {
        evidenceMap.set(e.evidenceRefId, e.summary);
      }

      const { chartIdMap } = chartBuildResult;

      // Build context builder for each slide
      function buildSlideContext(slideSpec: V1DeckPlan["slides"][number]): string {
        const parts: string[] = [];

        // Brief context (abbreviated)
        parts.push(`## Brief (abbreviated)\n${brief.slice(0, 500)}`);

        // Focal entity
        parts.push(`\n## Focal entity: ${validatedPlan.focalEntity}`);
        parts.push(`Language: ${validatedPlan.language}`);

        // Slide spec
        parts.push(`\n## YOUR SLIDE (position ${slideSpec.position} of ${validatedPlan.targetSlideCount})`);
        parts.push(`Role: ${slideSpec.role}`);
        parts.push(`Layout: ${slideSpec.layout}`);
        parts.push(`Governing thought: ${slideSpec.governingThought}`);
        parts.push(`Focal object: ${slideSpec.focalObject}`);

        // Chart context (if this slide has a chart)
        const realChartId = slideSpec.chartId ? chartIdMap[slideSpec.chartId] : undefined;
        if (realChartId) {
          const plannedChart = validatedPlan.charts.find((c) => c.chartId === slideSpec.chartId);
          if (plannedChart) {
            parts.push(`\n## Chart on this slide\nType: ${plannedChart.chartType} | Title: "${plannedChart.title}" | Unit: ${plannedChart.unit}`);
            parts.push(`The chart data has been built and persisted. Reference it in your narrative.`);
          }
        } else if (slideSpec.chartId) {
          parts.push(`\n## Note: planned chart "${slideSpec.chartId}" could not be built. Write a text-focused argument slide instead. Use metrics, bullets, and a callout to convey the data story.`);
        }

        // Evidence context (only what this slide needs)
        if (slideSpec.evidenceRequired.length > 0) {
          parts.push(`\n## Evidence for this slide`);
          for (const refId of slideSpec.evidenceRequired) {
            const summary = evidenceMap.get(refId);
            if (summary) {
              parts.push(`- ${refId}: ${summary.slice(0, 200)}`);
            }
          }
        }

        // Relevant findings
        const relevantFindings = analysis?.topFindings?.filter((f) =>
          f.evidenceRefIds.some((id) => slideSpec.evidenceRequired.includes(id)),
        ) ?? [];
        if (relevantFindings.length > 0) {
          parts.push(`\n## Relevant findings`);
          for (const f of relevantFindings) {
            parts.push(`- ${f.title}: ${f.claim} → ${f.businessImplication}`);
          }
        } else if (analysis?.topFindings?.length) {
          // For slides without specific evidence, provide the summary
          parts.push(`\n## Analysis summary\n${analysis.summary.slice(0, 500)}`);
        }

        // Title read-through context for narrative coherence
        const nearbySlides = validatedPlan.slides.filter((s) =>
          Math.abs(s.position - slideSpec.position) <= 2 && s.position !== slideSpec.position,
        );
        if (nearbySlides.length > 0) {
          parts.push(`\n## Neighboring slides (for narrative flow)`);
          for (const ns of nearbySlides) {
            parts.push(`- Slide ${ns.position} [${ns.role}]: ${ns.governingThought}`);
          }
        }

        return parts.join("\n");
      }

      // Author in parallel batches of 4
      const BATCH_SIZE = 4;
      const slides = validatedPlan.slides;

      for (let i = 0; i < slides.length; i += BATCH_SIZE) {
        const batch = slides.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (slideSpec) => {
          try {
            const isSacred = ["cover", "exec-summary", "summary", "recommendation"].includes(slideSpec.role);
            // Budget enforcement: tiered model selection
            const budgetPct = 1 - (remainingBudget() / HARD_BUDGET_USD);
            const forceHaiku = budgetPct >= 0.70; // 70%+ budget used → all Haiku
            const canAffordSonnet = !forceHaiku && remainingBudget() > 0.30;
            const model = (isSacred && canAffordSonnet) ? anthropic("claude-sonnet-4-6") : anthropic("claude-haiku-4-5");
            const modelId = (isSacred && canAffordSonnet) ? "claude-sonnet-4-6" : "claude-haiku-4-5";

            const slideContext = buildSlideContext(slideSpec);

            // Retry once on transient network errors
            const generateSlide = () => generateObject({
              model,
              schema: v1SlideOutputSchema,
              system: v1SlideSystemPrompt,
              prompt: slideContext,
            });
            let slideGenResult: Awaited<ReturnType<typeof generateSlide>>;
            try {
              slideGenResult = await generateSlide();
            } catch (firstErr) {
              const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
              if (/ECONNRESET|ETIMEDOUT|429|500|502|503|504|overloaded/i.test(msg)) {
                console.warn(`[basquio-author] Slide ${slideSpec.position} transient error, retrying: ${msg.slice(0, 80)}`);
                slideGenResult = await generateSlide(); // Retry once
              } else {
                throw firstErr;
              }
            }
            let slideOutput = slideGenResult.object;
            addUsage(slideGenResult.usage, modelId);

            // ─── Language consistency check (deterministic, post-generation) ───
            const expectedLang = validatedPlan.language || "en";
            const slideText = [slideOutput.title, slideOutput.body, ...(slideOutput.bullets ?? [])].filter(Boolean).join(" ");
            const detectedLang = detectLanguage(slideText);
            // Retry if: (a) non-English brief but English output, (b) wrong non-English language, (c) mixed language
            const langMismatch = slideText.length > 30 && detectedLang !== expectedLang && (
              // Case 1: non-English brief, fully English output
              (expectedLang !== "en" && detectedLang === "en") ||
              // Case 2: wrong non-English language (e.g., brief is Italian but slide is French)
              (expectedLang !== "en" && detectedLang !== "en" && detectedLang !== expectedLang) ||
              // Case 3: English brief but output is non-English
              (expectedLang === "en" && detectedLang !== "en")
            );
            if (langMismatch) {
              console.warn(`[basquio-author] Slide ${slideSpec.position} language mismatch: expected ${expectedLang}, got ${detectedLang}. Retrying.`);
              try {
                const retryResult = await generateObject({
                  model,
                  schema: v1SlideOutputSchema,
                  system: v1SlideSystemPrompt,
                  prompt: `CRITICAL: Write ENTIRELY in ${expectedLang}. No English except proper nouns and industry terms.\n\n${slideContext}`,
                });
                slideOutput = retryResult.object;
                addUsage(retryResult.usage, modelId);
              } catch { /* keep original if retry fails */ }
            }

            // Resolve the real chart ID
            const realChartId = slideSpec.chartId ? chartIdMap[slideSpec.chartId] : undefined;

            // If slide expects a chart but none was built, downgrade layout to text-only
            const chartLayouts = ["chart-split", "title-chart", "evidence-grid", "comparison"];
            const effectiveLayout = (!realChartId && chartLayouts.includes(slideSpec.layout))
              ? "title-body"  // Downgrade: text-only layout instead of chartless chart-layout
              : slideSpec.layout;

            // Persist the slide
            await persistSlide(runId, {
              position: slideSpec.position,
              layoutId: effectiveLayout,
              title: slideOutput.title,
              subtitle: slideOutput.subtitle || undefined,
              kicker: slideOutput.kicker || undefined,
              body: slideOutput.body || undefined,
              bullets: slideOutput.bullets.length > 0 ? slideOutput.bullets : undefined,
              chartId: realChartId || undefined,
              metrics: slideOutput.metrics.length > 0
                ? slideOutput.metrics.map((m) => ({
                    label: m.label,
                    value: m.value,
                    delta: m.delta || undefined,
                  }))
                : undefined,
              callout: slideOutput.callout.text
                ? {
                    text: slideOutput.callout.text,
                    tone: (slideOutput.callout.tone === "green" || slideOutput.callout.tone === "orange" || slideOutput.callout.tone === "accent")
                      ? slideOutput.callout.tone as "accent" | "green" | "orange"
                      : "accent",
                  }
                : undefined,
              evidenceIds: slideOutput.evidenceIds,
              speakerNotes: slideOutput.speakerNotes || undefined,
              pageIntent: slideSpec.role,
              governingThought: slideSpec.governingThought,
              focalObject: slideSpec.focalObject,
              highlightCategories: validatedPlan.focalEntity ? [validatedPlan.focalEntity] : undefined,
            });
          } catch (slideError) {
            console.error(`[basquio-author] Slide ${slideSpec.position} authoring failed:`, slideError);
            // Persist a dignified fallback slide — no error text visible to user
            await persistSlide(runId, {
              position: slideSpec.position,
              layoutId: slideSpec.layout === "cover" ? "cover" : "title-body",
              title: slideSpec.governingThought || `Analysis — ${slideSpec.role}`,
              body: "",
              bullets: [],
              speakerNotes: `Slide authoring failed: ${slideError instanceof Error ? slideError.message : String(slideError)}`,
              evidenceIds: [],
              pageIntent: slideSpec.role,
              governingThought: slideSpec.governingThought,
            });
          }
        }));
      }

      await emitRunEvent(runId, "author", "slides_author_completed", {
        slideCount: slides.length,
      });
    });

    // ─── STEP 4: DETERMINISTIC CRITIQUE (no LLM) ─────────────────────
    const deterministicIssues = await step.run("critique-deterministic", async () => {
      const slides = await getSlides(runId);
      const charts = await getV2ChartRows(runId);
      const issues: Array<{ severity: "critical" | "major" | "minor"; claim: string; slidePosition?: number }> = [];

      // Check slide count
      if (slides.length === 0) {
        issues.push({ severity: "critical", claim: "No slides generated" });
      }

      // Check chart referential integrity
      const chartIds = new Set(charts.map((c) => c.id));
      for (const slide of slides) {
        if (slide.chartId && !chartIds.has(slide.chartId)) {
          issues.push({
            severity: "critical",
            claim: `Slide ${slide.position}: references chart ${slide.chartId} which does not exist`,
            slidePosition: slide.position,
          });
          // Remove broken chart reference
          await persistSlide(runId, {
            ...slide,
            layoutId: slide.layoutId ?? "title-body",
            chartId: undefined,
            evidenceIds: slide.evidenceIds ?? [],
          });
        }
      }

      // Check titles exist
      for (const slide of slides) {
        if (!slide.title || slide.title.trim().length < 5) {
          issues.push({ severity: "major", claim: `Slide ${slide.position}: missing or too-short title`, slidePosition: slide.position });
        }
      }

      // Check cover and summary bookends
      if (slides.length > 0 && slides[0]?.layoutId !== "cover") {
        issues.push({ severity: "major", claim: "First slide is not a cover" });
      }

      // Check for duplicate positions
      const positions = new Set<number>();
      for (const slide of slides) {
        if (positions.has(slide.position)) {
          issues.push({ severity: "major", claim: `Duplicate slide position: ${slide.position}` });
        }
        positions.add(slide.position);
      }

      return issues;
    }) as Array<{ severity: "critical" | "major" | "minor"; claim: string; slidePosition?: number }>;

    // ─── STEP 5: REPAIR (critical issues only, max 3 slides) ─────────
    const criticalIssues = deterministicIssues.filter((i) => i.severity === "critical");
    if (criticalIssues.length > 0 && remainingBudget() > 0.05) {
      await step.run("repair-critical", async () => {
        await emitRunEvent(runId, "author", "repair_started");

        // Only repair slides that have critical issues, max 3
        const slidesToRepair = criticalIssues
          .filter((i) => i.slidePosition != null)
          .map((i) => i.slidePosition!)
          .filter((v, i, a) => a.indexOf(v) === i) // dedupe
          .slice(0, 3);

        if (slidesToRepair.length === 0) return;

        const analysisResult = await loadWorkingPaper<{
          analysis: { summary: string; topFindings: Array<{ title: string; claim: string; evidenceRefIds: string[]; businessImplication: string }> };
          clarifiedBrief?: { focalEntity: string; language: string };
        }>(runId, "analysis_result");

        for (const position of slidesToRepair) {
          const slideSpec = validatedPlan.slides.find((s) => s.position === position);
          if (!slideSpec) continue;

          const issuesForSlide = criticalIssues
            .filter((i) => i.slidePosition === position)
            .map((i) => i.claim)
            .join("; ");

          try {
            const repairResult = await generateObject({
              model: anthropic("claude-haiku-4-5"),
              schema: v1SlideOutputSchema,
              system: v1SlideSystemPrompt,
              prompt: `REPAIR this slide. The following critical issues were found:
${issuesForSlide}

Slide position: ${position}, Role: ${slideSpec.role}, Layout: ${slideSpec.layout}
Governing thought: ${slideSpec.governingThought}
Focal entity: ${validatedPlan.focalEntity}
Language: ${validatedPlan.language}

Analysis summary: ${analysisResult?.analysis?.summary?.slice(0, 500) ?? ""}

Fix the issues while maintaining the governing thought.`,
            });
            const repaired = repairResult.object;
            addUsage(repairResult.usage, "claude-haiku-4-5");

            await persistSlide(runId, {
              position,
              layoutId: slideSpec.layout,
              title: repaired.title,
              subtitle: repaired.subtitle || undefined,
              kicker: repaired.kicker || undefined,
              body: repaired.body || undefined,
              bullets: repaired.bullets.length > 0 ? repaired.bullets : undefined,
              metrics: repaired.metrics.length > 0
                ? repaired.metrics.map((m) => ({ label: m.label, value: m.value, delta: m.delta || undefined }))
                : undefined,
              callout: repaired.callout.text
                ? { text: repaired.callout.text, tone: (repaired.callout.tone as "accent" | "green" | "orange") || "accent" }
                : undefined,
              evidenceIds: repaired.evidenceIds,
              speakerNotes: repaired.speakerNotes || undefined,
              pageIntent: slideSpec.role,
              governingThought: slideSpec.governingThought,
            });
          } catch (repairError) {
            console.error(`[basquio-author] Repair failed for slide ${position}:`, repairError);
          }
        }

        await emitRunEvent(runId, "author", "repair_completed");
      });
    }

    // ─── SLIDE QUALITY LOG (advisory only — no deletion) ───────────
    // Log quality issues for telemetry but do NOT delete slides.
    // Slide-kill QA was causing regressions by gutting decks without rebuilding.
    // Critique step handles quality gating instead.
    const allSlides = await getSlides(runId);
    const qualityResults = allSlides.map((s: Record<string, unknown>) => evaluateSlideQuality({
      position: s.position as number,
      layoutId: (s.layoutId ?? s.layout_id ?? "title-body") as string,
      title: (s.title ?? "") as string,
      body: s.body as string | undefined,
      bullets: s.bullets as string[] | undefined,
      chartId: (s.chartId ?? s.chart_id ?? null) as string | null,
      callout: s.callout as { text: string } | null | undefined,
      metrics: s.metrics as Array<{ label: string; value: string; delta?: string }> | null | undefined,
    }));
    const issueSlides = qualityResults.filter((r) => !r.pass);
    if (issueSlides.length > 0) {
      console.warn(`[basquio-author] Quality issues (advisory, not deleting): ${issueSlides.length} slides have issues`);
      for (const k of issueSlides) {
        console.warn(`  Slide ${k.position}: ${k.issues.join("; ")}`);
      }
    }

    // Return summary for parent (including cost estimate)
    const finalSlides = await getSlides(runId);
    const finalCharts = await getV2ChartRows(runId);
    const deckSummary = `V1 pipeline: ${finalSlides.length} slides (${allSlides.length - finalSlides.length} killed by QA), ${finalCharts.length} charts (${chartBuildResult.chartResults.filter((r) => r.success).length} deterministic, ${criticalIssues.length} critical issues ${criticalIssues.length > 0 ? "repaired" : ""})`;

    // Exact cost from per-model token accumulation (not blended estimates)
    const estimatedCostUsd = exactCostUsd > 0 ? exactCostUsd : 0.05; // fallback if usage not captured

    return {
      deckSummary,
      slideCount: finalSlides.length,
      chartCount: finalCharts.length,
      estimatedCostUsd: Math.round(estimatedCostUsd * 1000) / 1000,
      tokenUsage, // Pass real tokens to parent for telemetry
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
  { id: "basquio-critique-revise", retries: 0, timeouts: { finish: "25m" } },
  { event: "basquio/critique-revise.requested" },
  async ({ event, step }) => {
    const { runId, brief, sourceFileIds } = event.data as {
      runId: string;
      brief: string;
      sourceFileIds: string[];
    };

    // Load dependencies from DB
    const workspace = await loadWorkspaceFromDb(runId);
    if (!workspace) throw new NonRetriableError(`Workspace not found for run ${runId}`);

    const analysisResult = await loadWorkingPaper<AnalystResult>(runId, "analysis_result");
    const analysis = analysisResult?.analysis ?? { topFindings: [], metricsComputed: 0, dataSummary: "" };
    const deckPlanWp = await loadWorkingPaper<DeckPlan>(runId, "deck_plan");
    const loadRows = createLoadSheetRows(runId);

    // ─── Token-based cost tracking ──────────────────────────────
    // Prices per 1M tokens (USD). Each step.run returns its stepCostUsd so
    // the total survives Inngest memoisation on replay.
    const CRITIQUE_PRICES: Record<string, { input: number; output: number }> = {
      "gpt-5.4":           { input: 2.50, output: 10.00 },
      "claude-opus-4-6":   { input: 15.00, output: 75.00 },
      "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
      "claude-haiku-4-5":  { input: 1.00, output: 5.00 },
    };
    function computeStepCost(tokens: { inputTokens: number; outputTokens: number }, modelId: string): number {
      const prices = CRITIQUE_PRICES[modelId] ?? CRITIQUE_PRICES["claude-haiku-4-5"];
      return (tokens.inputTokens * prices.input + tokens.outputTokens * prices.output) / 1_000_000;
    }

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

      // Accumulate token usage from both critics
      let factualTokens = { inputTokens: 0, outputTokens: 0 };
      let strategicTokens = { inputTokens: 0, outputTokens: 0 };

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
          onStepFinish: async (ev) => {
            factualTokens.inputTokens += ev.usage?.inputTokens ?? 0;
            factualTokens.outputTokens += ev.usage?.outputTokens ?? 0;
          },
        }),
        runStrategicCriticAgent({
          runId,
          brief,
          deckSummary: "",
          slideCount: slides.length,
          slides: slideData,
          onStepFinish: async (ev) => {
            strategicTokens.inputTokens += ev.usage?.inputTokens ?? 0;
            strategicTokens.outputTokens += ev.usage?.outputTokens ?? 0;
          },
        }),
      ]);

      // Factual critic defaults to gpt-5.4 (cross-model), strategic uses claude-opus-4-6
      const stepCostUsd =
        computeStepCost(factualTokens, "gpt-5.4") +
        computeStepCost(strategicTokens, "claude-opus-4-6");

      return { factual, strategic, stepCostUsd };
    });

    const factualCritique = critiqueResults.factual;
    const strategicCritique = critiqueResults.strategic;
    let runningCostUsd = critiqueResults.stepCostUsd ?? 0;

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
          issues: allIssues,
          coverage_score: factualCritique.coverageScore ?? null,
          accuracy_score: factualCritique.accuracyScore ?? null,
          narrative_score: strategicCritique.narrativeScore ?? null,
          provider: "anthropic",
          model_id: "claude-sonnet-4-6",
          usage: null,
        }),
      });

      const critiqueCostUsd = Math.round(runningCostUsd * 1000) / 1000 || 0.01;

      if (!hasCriticalOrMajor) {
        await updateDeliveryStatus(runId, "reviewed");
        return { hasCriticalOrMajor: false, needsRevise: false, issues: allIssues, estimatedCostUsd: critiqueCostUsd };
      }

      // Only revise for critical issues — major issues are acceptable for delivery
      if (criticalCount === 0) {
        await updateDeliveryStatus(runId, "reviewed");
        return { hasCriticalOrMajor: true, needsRevise: false, issues: allIssues, criticalCount, majorCount, estimatedCostUsd: critiqueCostUsd };
      }

      return { hasCriticalOrMajor: true, needsRevise: true, issues: allIssues, criticalCount, majorCount, estimatedCostUsd: critiqueCostUsd };
    });

    // ─── REVISE (targeted section-level repair) ────────────────────
    if (gateResult.needsRevise) {
      const reviseResult = await step.run("revise", async () => {
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
        let reviseTokens = { inputTokens: 0, outputTokens: 0 };

        await runAuthorAgent({
          workspace,
          runId,
          analysis: analysis as unknown as AnalysisReport,
          brief: `## REVISION TASK — fix these critique issues\n${issuesSummary}\n\n## Original brief\n${brief}${evidenceContext}`,
          critiqueContext: issuesSummary,
          loadRows,
          modelOverride: "claude-sonnet-4-6",
          maxSteps: 15,
          persistNotebookEntry: async (entry: NotebookEntry) => persistNotebookEntry(runId, "revise", 0, entry),
          getTemplateProfile: (async () => undefined) as never,
          persistSlide: (slide) => persistSlide(runId, slide),
          persistChart: (chart) => persistChart(runId, chart),
          getSlides: () => getSlides(runId),
          listEvidence: () => listEvidenceForRun(runId),
          onStepFinish: async (event: StepFinishEvent) => {
            tracker.recordStep(event.usage, event.toolCalls.length);
            reviseTokens.inputTokens += event.usage?.inputTokens ?? 0;
            reviseTokens.outputTokens += event.usage?.outputTokens ?? 0;
          },
        });

        tracker.endPhase();
        await emitRunEvent(runId, "revise", "phase_completed");
        return { stepCostUsd: computeStepCost(reviseTokens, "claude-sonnet-4-6") };
      });
      runningCostUsd += reviseResult.stepCostUsd ?? 0;

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

        // Accumulate re-critique token usage
        let reFactualTokens = { inputTokens: 0, outputTokens: 0 };
        let reStrategicTokens = { inputTokens: 0, outputTokens: 0 };

        // Re-run BOTH factual + strategic critics (strategic must independently gate)
        const [reFactual, reStrategic] = await Promise.all([
          runCriticAgent({
            workspace,
            runId,
            deckSummary: "",
            brief,
            slideCount: slides.length,
            getSlides: async () => slideData,
            getNotebookEntries: (evidenceRefId: string) => getNotebookEntry(evidenceRefId),
            persistNotebookEntry: (entry: NotebookEntry) => persistNotebookEntry(runId, "critique", 1, entry),
            onStepFinish: async (ev) => {
              reFactualTokens.inputTokens += ev.usage?.inputTokens ?? 0;
              reFactualTokens.outputTokens += ev.usage?.outputTokens ?? 0;
            },
          }),
          runStrategicCriticAgent({
            runId,
            brief,
            deckSummary: "",
            slideCount: slides.length,
            slides: slideData,
            onStepFinish: async (ev) => {
              reStrategicTokens.inputTokens += ev.usage?.inputTokens ?? 0;
              reStrategicTokens.outputTokens += ev.usage?.outputTokens ?? 0;
            },
          }),
        ]);

        const reCritiqueCostUsd =
          computeStepCost(reFactualTokens, "gpt-5.4") +
          computeStepCost(reStrategicTokens, "claude-opus-4-6");
        const totalCostUsd = Math.round((runningCostUsd + reCritiqueCostUsd) * 1000) / 1000 || 0.01;

        const reIssues = [...(reFactual.issues ?? []), ...(reStrategic.issues ?? [])];
        const reCritical = reIssues.filter((i: { severity: string }) => i.severity === "critical").length;
        const reMajor = reIssues.filter((i: { severity: string }) => i.severity === "major").length;

        if (reCritical > 0 || reMajor > 0) {
          console.warn(`[basquio-critique] ${reCritical} critical, ${reMajor} major issues remain after revision — proceeding with degraded delivery`);
          await updateDeliveryStatus(runId, "degraded");
          return {
            hasCriticalOrMajor: true,
            degradedDelivery: true,
            degradedIssues: reIssues
              .filter((i: { severity: string }) => i.severity === "critical" || i.severity === "major")
              .map((i: { severity: string; claim: string }) => ({ severity: i.severity, claim: i.claim })),
            estimatedCostUsd: totalCostUsd,
          };
        }

        await updateDeliveryStatus(runId, "reviewed");
        return { hasCriticalOrMajor: false, degradedDelivery: false, degradedIssues: [] as Array<{ severity: string; claim: string }>, estimatedCostUsd: totalCostUsd };
      });

      return reGateResult;
    }

    return { hasCriticalOrMajor: false, degradedDelivery: false, degradedIssues: [] as Array<{ severity: string; claim: string }>, estimatedCostUsd: Math.round(runningCostUsd * 1000) / 1000 || 0.01 };
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
      skipSourceCoverage,
    } = event.data as {
      runId: string;
      exportMode?: string;
      hasCriticalOrMajor: boolean;
      degradedDelivery: boolean;
      degradedIssues: Array<{ severity: string; claim: string }>;
      deckTitle: string;
      sourceFileIds: string[];
      skipSourceCoverage?: boolean;
    };

    const exportMode = rawExportMode === "powerpoint-native"
      ? ("powerpoint-native" as const)
      : ("universal-compatible" as const);

    // Source coverage check
    await step.run("source-coverage-check", async () => {
      const evidenceRows = await listEvidenceForRun(runId);
      const slides = await getSlides(runId);

      // Build set of evidence IDs actually cited by authored slides
      const citedEvidenceIds = new Set<string>();
      for (const slide of slides) {
        if (slide.evidenceIds) {
          for (const eid of slide.evidenceIds) citedEvidenceIds.add(eid);
        }
      }

      // Extract file IDs from CITED evidence only (not all registered evidence)
      // A file is "used" if at least one of its evidence refs appears in a slide.
      // Evidence refs use 8-char hex from the file ID. We match against BOTH
      // first-8 and last-8 of the UUID to handle both ref conventions.
      const usedFileIdFragments = new Set<string>();
      for (const ev of evidenceRows) {
        if (citedEvidenceIds.has(ev.evidenceRefId)) {
          const refMatch = ev.evidenceRefId.match(/^(?:sheet|doc|img)-([a-f0-9]{8})/);
          if (refMatch) usedFileIdFragments.add(refMatch[1]);
        }
      }

      // Fallback: if no cited evidence matched but we have evidence rows at all,
      // consider the file "used" — the analyst explored it even if the author
      // didn't cite specific refs. This fixes single-file runs.
      const hasAnyEvidence = evidenceRows.length > 0;

      const unusedFiles: string[] = [];
      for (const fileId of sourceFileIds) {
        const first8 = fileId.replace(/-/g, "").slice(0, 8);
        const last8 = fileId.slice(-8);
        const matched = usedFileIdFragments.has(first8) || usedFileIdFragments.has(last8);
        // Single-file runs: if there's evidence from any source, the file was used
        if (!matched && !(sourceFileIds.length === 1 && hasAnyEvidence)) {
          unusedFiles.push(fileId);
        }
      }

      const totalEvidence = evidenceRows.length;
      const citedEvidence = citedEvidenceIds.size;
      const coverageRatio = totalEvidence > 0 ? citedEvidence / totalEvidence : 0;

      logPhaseEvent(runId, "export", "source_coverage_report", {
        totalSourceFiles: sourceFileIds.length,
        unusedFileCount: unusedFiles.length,
        totalEvidence,
        citedEvidence,
        coverageRatio: Math.round(coverageRatio * 100),
      });

      // Source coverage: warn but NEVER block export.
      // The user's authored slides are more valuable than a ref-matching technicality.
      if (unusedFiles.length > 0 && sourceFileIds.length > 0) {
        console.warn(`[basquio-export] ${unusedFiles.length} of ${sourceFileIds.length} source file(s) not cited in slides — proceeding with export`);
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

      // Chart referential integrity check — drop broken refs before rendering
      const chartIdSet = new Set(v2ChartRows.map((c) => c.id));
      let hasBrokenChartRefs = false;
      for (const slide of slides) {
        if (slide.chartId && !chartIdSet.has(slide.chartId)) {
          console.warn(`[basquio-export] Slide ${slide.position}: dropping broken chart ref ${slide.chartId}`);
          slide.chartId = undefined;
          hasBrokenChartRefs = true;
        }
      }
      // Filter out empty content slides before rendering
      const contentLayoutsCheck = ["title-chart", "chart-split", "title-body", "title-bullets", "exec-summary", "metrics", "table", "comparison", "evidence-grid", "two-column"];
      const validSlides = slides.filter((s) => {
        const lid = s.layoutId;
        if (!lid || !contentLayoutsCheck.includes(lid)) return true; // Keep cover, summary, section-divider
        const hasContent = s.body || (Array.isArray(s.bullets) && s.bullets.length > 0) ||
          (Array.isArray(s.metrics) && s.metrics.length > 0) || s.callout || s.chartId;
        if (!hasContent) {
          console.warn(`[basquio-export] Filtering out empty slide ${s.position} (${lid})`);
          return false;
        }
        return true;
      });
      // Re-number positions
      validSlides.forEach((s, i) => { s.position = i + 1; });
      const filteredSlides = validSlides;

      if (hasBrokenChartRefs && !degradedDelivery) {
        await updateDeliveryStatus(runId, "degraded");
      }

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
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/template_profiles?id=eq.${runRows[0].template_profile_id}&select=template_profile`,
            { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}` } },
          );
          const profRows = await profRes.json() as Array<{ template_profile: Record<string, unknown> }>;
          if (profRows[0]?.template_profile) templateProfile = profRows[0].template_profile;
        }
      } catch { /* use default */ }

      // Render PPTX (using filteredSlides — empty slides already removed)
      const pptxArtifact = await renderV2PptxArtifact({
        slides: filteredSlides.map((s) => ({
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

      // Prepare PPTX buffer for QA + upload
      const pptxPath = `${runId}/deck.pptx`;
      const pptxBuffer = Buffer.isBuffer(pptxArtifact.buffer)
        ? pptxArtifact.buffer
        : Buffer.from((pptxArtifact.buffer as { data: number[] }).data);

      // ── PRE-UPLOAD QA ─────────────────────────────────────────
      // Run QA BEFORE uploading so broken artifacts never reach storage
      const hasValidPptxHeader = pptxBuffer.length >= 4 &&
        pptxBuffer[0] === 0x50 && pptxBuffer[1] === 0x4B &&
        pptxBuffer[2] === 0x03 && pptxBuffer[3] === 0x04;

      // QA uses filteredSlides (empty slides already removed)
      const chartLayouts = ["chart-split", "title-chart", "evidence-grid", "comparison"];
      const chartLayoutSlides = filteredSlides.filter((s: any) => chartLayouts.includes(s.layoutId ?? s.layout_id));
      const chartlessSlides = chartLayoutSlides.filter((s: any) => {
        const cid = s.chartId ?? s.chart_id;
        if (!cid) return true;
        return !chartIdSet.has(cid);
      });
      const chartCoverageRatio = chartLayoutSlides.length > 0
        ? (chartLayoutSlides.length - chartlessSlides.length) / chartLayoutSlides.length
        : 1;
      const chartCoverageOk = chartCoverageRatio >= 0.7;

      // Empty slides should not exist after filtering, but verify
      const remainingEmptySlides = filteredSlides.filter((s: any) => {
        const lid = s.layoutId ?? s.layout_id;
        const contentLayoutsQA = ["title-chart", "chart-split", "title-body", "title-bullets", "exec-summary", "metrics", "table", "comparison", "evidence-grid", "two-column"];
        if (!contentLayoutsQA.includes(lid)) return false;
        return !(s.body) && !(Array.isArray(s.bullets) && s.bullets.length > 0) && !(Array.isArray(s.metrics) && s.metrics.length > 0) && !(s.callout) && !(s.chartId ?? s.chart_id);
      });
      const noEmptySlides = remainingEmptySlides.length === 0;

      const qaChecks = [
        { name: "pptx_non_empty", passed: pptxBuffer.length > 0, detail: `${pptxBuffer.length} bytes` },
        { name: "slide_count_positive", passed: filteredSlides.length > 0, detail: `${filteredSlides.length} slides` },
        { name: "pptx_valid_zip", passed: hasValidPptxHeader },
        { name: "chart_coverage", passed: chartCoverageOk, detail: `${chartLayoutSlides.length - chartlessSlides.length}/${chartLayoutSlides.length} chart-layout slides have valid charts (${Math.round(chartCoverageRatio * 100)}%)` },
        { name: "no_empty_slides", passed: noEmptySlides, detail: remainingEmptySlides.length > 0 ? `${remainingEmptySlides.length} empty content slide(s)` : "all slides have content" },
      ];

      const qaStructuralPassed = qaChecks.every((c) => c.passed);
      const qaPassed = qaStructuralPassed && !degradedDelivery;

      if (!qaPassed) {
        const failedChecks = qaChecks.filter((c) => !c.passed).map((c) => c.name);
        console.warn(`[basquio-export] PRE-UPLOAD QA: passed=${qaPassed}, degraded=${degradedDelivery}, failed=[${failedChecks.join(", ")}], chartCoverage=${Math.round(chartCoverageRatio * 100)}%`);
        await updateDeliveryStatus(runId, "degraded");
      }
      // ── END PRE-UPLOAD QA ─────────────────────────────────────
      const finalDegraded = degradedDelivery || !qaPassed;

      // Upload PPTX (always — even degraded, user should still get something)
      await uploadToStorage({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        bucket: "artifacts",
        storagePath: pptxPath,
        body: pptxBuffer,
        contentType: pptxArtifact.mimeType,
      });

      // Render PDF (best-effort — null if Browserless unavailable)
      let pdfArtifactEntry: { id: string; kind: "pdf"; fileName: string; mimeType: string; fileBytes: number; storagePath: string; storageBucket: string; checksumSha256: string } | null = null;
      try {
        // Build chart lookup map for PDF (same data as PPTX charts)
        const chartsMap = new Map<string, Record<string, unknown>>();
        for (const c of v2ChartRows) {
          chartsMap.set(c.id, c as unknown as Record<string, unknown>);
        }

        // Extract brand tokens for PDF visual parity with PPTX
        const brandTokens = templateProfile?.brandTokens as Record<string, unknown> | undefined;
        const pdfPalette = brandTokens?.palette as Record<string, string> | undefined;
        const pdfTypo = brandTokens?.typography as Record<string, string> | undefined;

        const pdfResult = await renderV2PdfArtifact({
          slides: filteredSlides.map((s) => {
            // Resolve chart for this slide (same logic as PPTX)
            const chartId = s.chartId;
            const chartRow = chartId ? chartsMap.get(chartId) : undefined;
            const pdfChart = chartRow ? {
              chartType: String((chartRow as Record<string, unknown>).chartType ?? (chartRow as Record<string, unknown>).chart_type ?? "bar"),
              title: String((chartRow as Record<string, unknown>).title ?? ""),
              data: Array.isArray((chartRow as Record<string, unknown>).data) ? (chartRow as Record<string, unknown>).data as Record<string, unknown>[] : [],
              xAxis: String((chartRow as Record<string, unknown>).xAxis ?? (chartRow as Record<string, unknown>).x_axis ?? ""),
              yAxis: String((chartRow as Record<string, unknown>).yAxis ?? (chartRow as Record<string, unknown>).y_axis ?? ""),
              series: Array.isArray((chartRow as Record<string, unknown>).series) ? (chartRow as Record<string, unknown>).series as string[] : [],
              unit: (chartRow as Record<string, unknown>).unit as string | undefined,
              sourceNote: ((chartRow as Record<string, unknown>).sourceNote ?? (chartRow as Record<string, unknown>).source_note) as string | undefined,
            } : undefined;
            return {
              position: s.position,
              layoutId: s.layoutId ?? "title-body",
              title: s.title ?? "",
              subtitle: s.subtitle,
              body: s.body,
              bullets: s.bullets,
              metrics: s.metrics ? (typeof s.metrics === "string" ? JSON.parse(s.metrics) : s.metrics) : undefined,
              callout: s.callout ? (typeof s.callout === "string" ? JSON.parse(s.callout) : s.callout) : undefined,
              kicker: s.kicker,
              chart: pdfChart,
            };
          }),
          deckTitle: deckTitle || "Basquio Analysis",
          accentColor: pdfPalette?.accent,
          coverBgColor: pdfPalette?.coverBg ?? pdfPalette?.background,
          headingFont: pdfTypo?.headingFont,
          bodyFont: pdfTypo?.bodyFont,
          // Full dark-mode palette for PDF/PPTX visual parity
          paletteBg: pdfPalette?.background,
          paletteSurface: pdfPalette?.surface,
          paletteText: pdfPalette?.text,
          paletteMuted: pdfPalette?.muted ?? pdfPalette?.accentMuted,
          paletteBorder: pdfPalette?.border,
          palettePositive: pdfPalette?.positive,
          paletteNegative: pdfPalette?.negative,
        });

        if (pdfResult) {
          const pdfPath = `${runId}/deck.pdf`;
          const pdfBuffer = Buffer.isBuffer(pdfResult.buffer)
            ? pdfResult.buffer
            : Buffer.from((pdfResult.buffer as { data: number[] }).data);

          await uploadToStorage({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
            serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            bucket: "artifacts",
            storagePath: pdfPath,
            body: pdfBuffer,
            contentType: pdfResult.mimeType,
          });

          pdfArtifactEntry = {
            id: crypto.randomUUID(),
            kind: "pdf" as const,
            fileName: "basquio-deck.pdf",
            mimeType: pdfResult.mimeType,
            fileBytes: pdfBuffer.length,
            storagePath: pdfPath,
            storageBucket: "artifacts",
            checksumSha256: checksumSha256(pdfBuffer),
          };
        }
      } catch (pdfError) {
        console.warn("[basquio-export] PDF generation failed (non-blocking):", pdfError);
      }

      // QA already computed before upload (see PRE-UPLOAD QA above)

      // Publish manifest
      const artifactId = crypto.randomUUID();
      const manifest = {
        id: crypto.randomUUID(),
        run_id: runId,
        slide_count: filteredSlides.length,
        page_count: filteredSlides.length,
        qa_passed: qaPassed,
        qa_report: {
          checks: qaChecks,
          delivery_status: qaPassed ? "reviewed" : "degraded",
          chartCoverage: { total: chartLayoutSlides.length, linked: chartLayoutSlides.length - chartlessSlides.length, ratio: chartCoverageRatio },
          ...(degradedDelivery ? { unresolvedIssues: degradedIssues } : {}),
          ...(!qaStructuralPassed ? { qaFailures: qaChecks.filter((c) => !c.passed).map((c) => c.name) } : {}),
        },
        artifacts: [
          {
            id: artifactId,
            kind: "pptx" as const,
            fileName: "basquio-deck.pptx",
            mimeType: pptxArtifact.mimeType,
            fileBytes: pptxBuffer.length,
            storagePath: pptxPath,
            storageBucket: "artifacts",
            checksumSha256: checksumSha256(pptxBuffer),
          },
          ...(pdfArtifactEntry ? [pdfArtifactEntry] : []),
        ],
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
        pdfBytes: pdfArtifactEntry?.fileBytes ?? 0,
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
