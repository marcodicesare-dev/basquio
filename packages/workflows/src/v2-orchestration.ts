import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { parseEvidencePackage, streamParseFile, checksumSha256, loadRowsFromBlob, type SheetManifest } from "@basquio/data-ingest";
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
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to persist chart ${id} for run ${runId}: ${response.status} ${response.statusText} — ${errorBody}`);
  }

  return { chartId: id, thumbnailUrl: undefined, width: 800, height: 500 };
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
    },
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
          } catch {
            // Vision extraction is best-effort — don't block normalize
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

        await persistEvidenceEntry(runId, {
          evidenceType,
          refId,
          label: f.fileName,
          description,
          value: f.textContent
            ? { text: f.textContent.slice(0, 5000), truncated: f.textContent.length > 5000, charCount: f.textContent.length }
            : isImage && description.startsWith("Image: ")
              ? { visionExtracted: true, description: description.slice(7), fileName: f.fileName }
              : { noTextExtracted: true, fileKind: f.kind, fileName: f.fileName },
        });

        // Register page-level evidence for PDFs and per-slide for PPTXs
        const pages = (f as Record<string, unknown>).pages as Array<{ num: number; text: string }> | undefined;
        if (pages && pages.length > 0) {
          for (const page of pages) {
            const pageRefId = `${refId}-page-${page.num}`;
            await persistEvidenceEntry(runId, {
              evidenceType: "document",
              refId: pageRefId,
              label: `${f.fileName} — page ${page.num}`,
              description: page.text.slice(0, 200),
              value: { text: page.text, pageNum: page.num, sourceFile: f.fileName },
            });
          }
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
    const analystResult = await step.run("understand", async () => {
      await updateRunStatus(runId, "running", "understand");
      await emitRunEvent(runId, "understand", "phase_started");

      tracker.startPhase("understand", "gpt-5.4", "openai");

      const result = await runAnalystAgent({
        workspace,
        runId,
        brief,
        loadRows: loadSheetRows,
        persistNotebookEntry: async (entry: NotebookEntry) => {
          const notebookId = await persistNotebookEntry(runId, "understand", 0, entry);
          if (entry.evidenceRefId) {
            await persistEvidenceEntry(runId, {
              evidenceType: entry.toolName === "compute_metric" ? "metric" : entry.toolName === "query_data" ? "table" : "document",
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
          await emitRunEvent(runId, "understand", "tool_call", {
            stepNumber: event.stepNumber,
            tools: event.toolCalls.map((tc: { toolName: string }) => tc.toolName),
            usage: event.usage,
          });
        },
      });

      tracker.endPhase();

      await emitRunEvent(runId, "understand", "phase_completed", {
        metricsComputed: result.analysis.metricsComputed,
        findingsCount: result.analysis.topFindings.length,
        hasStorylinePlan: result.storylinePlan !== null,
        hasClarifiedBrief: result.clarifiedBrief !== null,
      });

      // Persist durable working papers (best-effort — don't block pipeline on persistence failure)
      try {
        if (result.clarifiedBrief) {
          await persistWorkingPaper(runId, "clarified_brief", result.clarifiedBrief);
        }
        if (result.storylinePlan) {
          await persistWorkingPaper(runId, "storyline_plan", result.storylinePlan);
        }
      } catch (error) {
        console.error("[understand] Failed to persist working papers:", error);
        // Non-fatal: the pipeline can continue with in-memory data
      }

      // Return slim serializable result for Inngest step memoization
      return {
        analysis: result.analysis,
        clarifiedBrief: result.clarifiedBrief,
        storylinePlan: result.storylinePlan,
      };
    }) as AnalystResult;

    const analysis = analystResult.analysis;

    // ─── STEP 2.5: PLAN DECK (model-driven, storyline-aware) ────
    const deckPlan = await step.run("plan-deck", async () => {
      await emitRunEvent(runId, "author", "plan_started");

      // Use clarified brief's slide count if available, then regex from brief, then heuristic
      const clarifiedSlideCount = analystResult.clarifiedBrief?.requestedSlideCount ?? null;
      const requestedSlideMatch = brief.match(/(\d+)\s*slide/i);
      const requestedSlides = clarifiedSlideCount ?? (requestedSlideMatch ? parseInt(requestedSlideMatch[1], 10) : undefined);
      const targetSlides = requestedSlides ?? Math.min(Math.max(8, analysis.topFindings.length + 4), 20);

      const findingsSummary = analysis.topFindings
        .map((f, i) => `${i + 1}. ${f.title}: ${f.claim} (confidence: ${f.confidence})`)
        .join("\n");

      // Build storyline context if available
      const storylinePlan = analystResult.storylinePlan;
      let storylineContext = "";
      if (storylinePlan) {
        const branchSummary = storylinePlan.issueBranches
          .map((b, i) => `  Branch ${i + 1}: "${b.question}" → ${b.conclusion} (slide implication: ${b.slideImplication})`)
          .join("\n");
        const recoSummary = storylinePlan.recommendationShapes
          .map((r) => `  - [${r.confidence}] ${r.recommendation} (${r.quantification})`)
          .join("\n");
        const titleReadThrough = storylinePlan.titleReadThrough
          .map((t, i) => `  ${i + 1}. ${t}`)
          .join("\n");
        storylineContext = `
STORYLINE PLAN (from issue tree analysis):
Governing question: "${storylinePlan.governingQuestion}"

Issue branches:
${branchSummary}

Recommendation shapes:
${recoSummary}

Proposed title read-through:
${titleReadThrough}

IMPORTANT: Map each section to an issue branch. The deck must answer the governing question through its narrative arc. Use the title read-through as a starting point for slide titles.`;
      }

      const planResult = await generateText({
        model: openai("gpt-5.4"),
        output: Output.object({ schema: deckPlanSchema }),
        prompt: `You are a senior strategy deck architect. Plan a ${targetSlides}-slide executive presentation structured around an issue tree.

BRIEF:
${brief}

ANALYSIS DOMAIN: ${analysis.domain}
ANALYSIS SUMMARY: ${analysis.summary}

KEY FINDINGS:
${findingsSummary}
${storylineContext}

AVAILABLE LAYOUTS: cover, exec-summary (metrics), title-chart, chart-split, title-body, title-bullets, evidence-grid, table, summary

CHART INTENTS: rank, trend, composition, bridge, correlation, comparison, kpi, table, none

RULES:
1. First slide MUST be "cover" layout — role "cover"
2. If >5 slides, slide 2 should be exec-summary with 3-4 KPI metrics — role "exec-summary"
3. Evidence slides use title-chart or chart-split — pick chart intent based on the analytical story
4. Last slide should be "summary" layout — role "recommendation" or "synthesis"
5. Use at least 3 different layouts — no layout >50% of slides
6. Every governingThought must be an action title (full sentence stating the takeaway, with a number)
7. Exactly ${targetSlides} slides
8. Each section must reference which issue branch it addresses (use "overview" for cover/exec-summary, "synthesis" for closing)
9. Each slide must specify evidenceRequired — the evidence ref IDs it must cite

Return a structured DeckPlan with sections containing slide specs.`,
      });

      if (!planResult.output) {
        // Fallback: deterministic plan if model fails (backward compatible flat plan)
        const fallbackSections = [{
          sectionId: "main",
          title: analysis.domain,
          issueBranch: "overview",
          slides: Array.from({ length: targetSlides }, (_, i) => ({
            position: i + 1,
            role: i === 0 ? "cover" : i === 1 ? "exec-summary" : i === targetSlides - 1 ? "summary" : "evidence",
            layout: i === 0 ? "cover" : i === 1 ? "exec-summary" : i === targetSlides - 1 ? "summary" : i % 2 === 0 ? "title-chart" : "chart-split",
            governingThought: i === 0 ? `${analysis.domain} Analysis` : analysis.topFindings[i - 2]?.claim ?? `Slide ${i + 1}`,
            chartIntent: i === 0 || i === 1 || i === targetSlides - 1 ? "none" : "rank",
            evidenceRequired: [] as string[],
            focalObject: analysis.domain,
          })),
        }];
        const fallbackPlan: DeckPlan = {
          targetSlideCount: targetSlides,
          sections: fallbackSections,
          appendixStrategy: "No appendix",
        };

        // Persist fallback plan as working paper
        try { await persistWorkingPaper(runId, "deck_plan", fallbackPlan); } catch {}

        return { targetSlides, requestedSlides, structuredPlan: fallbackPlan };
      }

      const structuredPlan = planResult.output;

      // Persist structured deck plan as working paper
      try { await persistWorkingPaper(runId, "deck_plan", structuredPlan); } catch {}

      return { targetSlides, requestedSlides, structuredPlan };
    }) as { targetSlides: number; requestedSlides?: number; structuredPlan: DeckPlan };

    // ─── STEP 3: AUTHOR (section-by-section) ──────────────────────
    await updateRunStatus(runId, "running", "author");
    await emitRunEvent(runId, "author", "phase_started");

    const deckPlanSections = deckPlan.structuredPlan.sections ?? [];
    let deckSummary = "";

    // Helper: build getSlides callback (shared between section + monolithic paths)
    const makeGetSlides = () => async () => {
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
        callout: r.callout,
        kicker: r.kicker,
        pageIntent: r.pageIntent,
        governingThought: r.governingThought,
        chartIntent: r.chartIntent,
        focalObject: r.focalObject,
        highlightCategories: r.highlightCategories,
      }));
    };

    if (deckPlanSections.length > 0) {
      // Section-by-section authoring — each section is its own Inngest step
      for (const section of deckPlanSections) {
        // Sanitize sectionId for Inngest step naming (alphanumeric + hyphens only)
        const safeSectionId = section.sectionId
          .replace(/[^a-zA-Z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase();

        await step.run(`author-section-${safeSectionId}`, async () => {
          await emitRunEvent(runId, "author", "section_started", {
            sectionId: section.sectionId,
            slideCount: section.slides.length,
          });

          tracker.startPhase("author", "claude-opus-4-6", "anthropic");

          // Build section-scoped brief
          const sectionBrief = buildSectionBrief(brief, section, analystResult, deckPlan.structuredPlan);

          // Step limit proportional to section size
          const sectionStepLimit = Math.min(5 + section.slides.length * 6, 30);

          const result = await runAuthorAgent({
            workspace,
            runId,
            analysis: analystResult.analysis,
            brief: sectionBrief,
            maxSteps: sectionStepLimit,
            loadRows: loadSheetRows,
            persistNotebookEntry: async (entry: NotebookEntry) => {
              const notebookId = await persistNotebookEntry(runId, "author", 0, entry);
              if (entry.evidenceRefId) {
                await persistEvidenceEntry(runId, {
                  evidenceType: entry.toolName === "compute_metric" ? "metric" : entry.toolName === "query_data" ? "table" : "document",
                  refId: entry.evidenceRefId,
                  label: (entry.toolInput as Record<string, unknown>)?.name as string ?? entry.toolName,
                  description: (entry.toolOutput as Record<string, unknown>)?.summary as string ?? undefined,
                  value: entry.toolOutput,
                  sourceNotebookEntryId: notebookId,
                });
              }
              return notebookId;
            },
            persistSlide: async (slide: SlideInput) => persistSlide(runId, slide),
            persistChart: async (chart: ChartInput) => persistChart(runId, chart),
            getTemplateProfile: () => workspace.templateProfile ?? null,
            listEvidence: () => listEvidenceForRun(runId),
            getNotebookEntries: async (evidenceRefId: string) => getNotebookEntry(evidenceRefId),
            getSlides: makeGetSlides(),
            renderContactSheet: () => renderContactSheetForRun(runId),
            onStepFinish: async (event: StepFinishEvent) => {
              tracker.recordStep(event.usage, event.toolCalls.length);
              await emitRunEvent(runId, "author", "tool_call", {
                sectionId: section.sectionId,
                stepNumber: event.stepNumber,
                tools: event.toolCalls.map((tc: { toolName: string }) => tc.toolName),
                usage: event.usage,
              });
            },
          });

          tracker.endPhase();
          return result.summary;
        });
      }

      deckSummary = `${deckPlanSections.length} sections authored: ${deckPlanSections.map((s) => s.title).join(", ")}`;

      // Emit phase completion for section-by-section path
      await step.run("author-finalize", async () => {
        const slides = await getSlides(runId);
        await emitRunEvent(runId, "author", "phase_completed", {
          slideCount: slides.length,
          sections: deckPlanSections.length,
        });
        return { slideCount: slides.length };
      });
    } else {
      // Fallback: monolithic author (backward compatible if deck plan has no sections)
      deckSummary = await step.run("author", async () => {
        tracker.startPhase("author", "claude-opus-4-6", "anthropic");

        const { structuredPlan } = deckPlan;
        const deckPlanBrief = structuredPlan.sections
          .map((sec) => {
            const slideSpecs = sec.slides
              .map((slide) => `  Slide ${slide.position}: [${slide.role}] ${slide.layout} — "${slide.governingThought}" (chart: ${slide.chartIntent}, evidence: [${slide.evidenceRequired.join(", ")}], focal: ${slide.focalObject})`)
              .join("\n");
            return `Section: "${sec.title}" (${sec.slides.length} slides, addresses: "${sec.issueBranch}")\n${slideSpecs}`;
          })
          .join("\n\n");

        const governingQuestionNote = analystResult.storylinePlan
          ? `\nGOVERNING QUESTION: "${analystResult.storylinePlan.governingQuestion}"\n`
          : "";

        const result = await runAuthorAgent({
          workspace,
          runId,
          analysis,
          brief: `${brief}
${governingQuestionNote}
DECK PLAN (structured from issue tree — follow this structure):
Target: ${deckPlan.targetSlides} slides
Appendix strategy: ${structuredPlan.appendixStrategy}

${deckPlanBrief}

IMPORTANT: This plan was designed by a deck architect model from the issue tree analysis. Follow the section structure, slide sequence, layouts, and chart intents. Each slide's governingThought is the action title — use it as-is or refine with real numbers. Respect the plan's narrative arc and slide count.`,
          loadRows: loadSheetRows,
          persistNotebookEntry: async (entry: NotebookEntry) => {
            const notebookId = await persistNotebookEntry(runId, "author", 0, entry);
            if (entry.evidenceRefId) {
              await persistEvidenceEntry(runId, {
                evidenceType: entry.toolName === "compute_metric" ? "metric" : entry.toolName === "query_data" ? "table" : "document",
                refId: entry.evidenceRefId,
                label: (entry.toolInput as Record<string, unknown>)?.name as string ?? entry.toolName,
                description: (entry.toolOutput as Record<string, unknown>)?.summary as string ?? undefined,
                value: entry.toolOutput,
                sourceNotebookEntryId: notebookId,
              });
            }
            return notebookId;
          },
          persistSlide: async (slide: SlideInput) => persistSlide(runId, slide),
          persistChart: async (chart: ChartInput) => persistChart(runId, chart),
          getTemplateProfile: () => workspace.templateProfile ?? null,
          listEvidence: () => listEvidenceForRun(runId),
          getNotebookEntries: async (evidenceRefId: string) => getNotebookEntry(evidenceRefId),
          getSlides: makeGetSlides(),
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
    }

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
          return persistNotebookEntry(runId, "polish", 0, entry);
        },
        persistSlide: async (slide: SlideInput) => persistSlide(runId, slide),
        persistChart: async (chart: ChartInput) => persistChart(runId, chart),
        getTemplateProfile: () => workspace.templateProfile ?? null,
        getNotebookEntries: async (evidenceRefId: string) => getNotebookEntry(evidenceRefId),
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
            callout: r.callout,
            kicker: r.kicker,
            pageIntent: r.pageIntent,
            governingThought: r.governingThought,
            chartIntent: r.chartIntent,
            focalObject: r.focalObject,
            highlightCategories: r.highlightCategories,
          }));
        },
        renderContactSheet: () => renderContactSheetForRun(runId),
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

    // Mark delivery as "draft" — authored but not yet critiqued
    await updateDeliveryStatus(runId, "draft");

    // ─── STEP 4a: FACTUAL CRITIQUE (agentic, cross-model) ──────
    const factualCritique = await step.run("critique-factual", async () => {
      await updateRunStatus(runId, "running", "critique");
      await emitRunEvent(runId, "critique", "phase_started", { critic: "factual" });

      tracker.startPhase("critique-factual", "gpt-5.4", "openai");

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
          return persistNotebookEntry(runId, "critique", 0, entry);
        },
        onStepFinish: async (event: StepFinishEvent) => {
          tracker.recordStep(event.usage, event.toolCalls.length);
          await emitRunEvent(runId, "critique", "tool_call", {
            critic: "factual",
            stepNumber: event.stepNumber,
            tools: event.toolCalls.map((tc: { toolName: string }) => tc.toolName),
            usage: event.usage,
          });
        },
        authorProvider: "anthropic",
      });

      tracker.endPhase();

      await emitRunEvent(runId, "critique", "factual_completed", {
        hasIssues: result.hasIssues,
        issueCount: result.issues.length,
      });

      return result;
    });

    // ─── STEP 4b: STRATEGIC CRITIQUE (Claude Opus, no tools) ────
    const strategicCritique = await step.run("critique-strategic", async () => {
      await emitRunEvent(runId, "critique", "phase_started", { critic: "strategic" });

      tracker.startPhase("critique-strategic", "claude-opus-4-6", "anthropic");

      const slides = await getSlides(runId);

      const result = await runStrategicCriticAgent({
        runId,
        brief,
        deckSummary,
        slideCount: slides.length,
        slides: slides.map((s) => ({
          position: s.position,
          layoutId: s.layoutId ?? "title-body",
          title: s.title ?? "",
          body: s.body,
          bullets: s.bullets,
          chartId: s.chartId,
          metrics: s.metrics,
          speakerNotes: s.speakerNotes,
          callout: s.callout,
          kicker: s.kicker,
          pageIntent: s.pageIntent,
          governingThought: s.governingThought,
          evidenceIds: s.evidenceIds ?? [],
        })),
        storylinePlan: analystResult.storylinePlan ?? null,
      });

      tracker.endPhase();

      await emitRunEvent(runId, "critique", "strategic_completed", {
        hasIssues: result.hasIssues,
        issueCount: result.issues.length,
      });

      return result;
    });

    // ─── Merge both critiques into unified report ─────────────
    const critique = await step.run("critique-merge", async () => {
      const mergedIssues = [...factualCritique.issues, ...strategicCritique.issues];
      const hasIssues = factualCritique.hasIssues || strategicCritique.hasIssues;

      const critiqueId = crypto.randomUUID();
      const fullCritique: CritiqueReport = {
        id: critiqueId,
        runId,
        iteration: factualCritique.iteration,
        hasIssues,
        issues: mergedIssues,
        coverageScore: factualCritique.coverageScore,
        accuracyScore: factualCritique.accuracyScore,
        narrativeScore: strategicCritique.narrativeScore,
        modelId: "gpt-5.4+claude-opus-4-6",
        provider: "multi",
        usage: tracker.getCurrentPhaseUsage(),
        createdAt: new Date().toISOString(),
      };

      // Persist merged critique report — durable checkpoint
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
        throw new Error(`Failed to persist merged critique report: ${errorText}`);
      }

      await emitRunEvent(runId, "critique", "phase_completed", {
        hasIssues: fullCritique.hasIssues,
        issueCount: fullCritique.issues.length,
        factualIssues: factualCritique.issues.length,
        strategicIssues: strategicCritique.issues.length,
      });

      return fullCritique;
    });

    // ─── STEP 5: REVISE (conditional, max 2 iterations) ────────
    // Track degraded delivery state — threaded to artifact manifest
    let degradedDelivery = false;
    let degradedIssues: Array<{ severity: string; claim: string }> = [];

    const hasCriticalOrMajor = critique.hasIssues && critique.issues.some((i: { severity: string }) => i.severity === "critical" || i.severity === "major");

    // If critique passed clean, mark as reviewed; otherwise leave as draft pending revise
    if (!hasCriticalOrMajor) {
      await updateDeliveryStatus(runId, "reviewed");
    }

    if (hasCriticalOrMajor) {
      // ─── STEP 5: REVISE (section-level targeted repair) ──────
      // Map flagged slides to sections, then re-run only flagged sections
      await step.run("revise-prepare", async () => {
        await updateRunStatus(runId, "running", "revise");
        await emitRunEvent(runId, "revise", "phase_started");

        // Targeted revision: only delete slides with issues, preserve good ones
        // Normalize slideIds: strategic critic emits position strings, factual critic emits UUIDs
        const allSlides = await getSlides(runId);
        const flaggedSlideIds = new Set<string>();
        for (const issue of critique.issues) {
          if (!issue.slideId || issue.slideId === "deck-level") continue;

          // Try as UUID first (direct match)
          const directMatch = allSlides.find(s => s.id === issue.slideId);
          if (directMatch) {
            flaggedSlideIds.add(directMatch.id);
            continue;
          }

          // Try as position string
          const position = parseInt(issue.slideId, 10);
          if (!isNaN(position)) {
            const posMatch = allSlides.find(s => s.position === position);
            if (posMatch) {
              flaggedSlideIds.add(posMatch.id);
            }
          }
        }

        if (flaggedSlideIds.size > 0) {

          // Collect chart IDs from flagged vs preserved slides
          const flaggedChartIds = new Set<string>();
          const preservedChartIds = new Set<string>();

          for (const slide of allSlides) {
            if (flaggedSlideIds.has(slide.id)) {
              if (slide.chartId) flaggedChartIds.add(slide.chartId);
            } else {
              if (slide.chartId) preservedChartIds.add(slide.chartId);
            }
          }

          // Only delete charts NOT referenced by any preserved slide
          const chartIdsToDelete = new Set<string>();
          for (const cid of flaggedChartIds) {
            if (!preservedChartIds.has(cid)) {
              chartIdsToDelete.add(cid);
            }
          }

          // Delete the flagged slides
          for (const slideId of flaggedSlideIds) {
            await fetch(
              `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_slides?id=eq.${slideId}`,
              {
                method: "DELETE",
                headers: {
                  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
                  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
                },
              },
            );
          }

          // Delete orphaned charts
          for (const chartId of chartIdsToDelete) {
            await fetch(
              `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/deck_spec_v2_charts?id=eq.${chartId}`,
              {
                method: "DELETE",
                headers: {
                  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
                  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
                },
              },
            );
          }

          // Map flagged slides back to sections for targeted section repair
          const flaggedSectionIds = new Set<string>();
          const allSections = deckPlan.structuredPlan.sections ?? [];

          for (const section of allSections) {
            for (const slideSpec of section.slides) {
              // Match by position: critique slideId can be a UUID or position string
              const matchingSlide = allSlides.find((s) =>
                flaggedSlideIds.has(s.id) && s.position === slideSpec.position
              );
              if (matchingSlide) {
                flaggedSectionIds.add(section.sectionId);
              }
            }
          }

          // Also catch deck-level issues (no specific slideId) — flag all sections
          const deckLevelIssues = critique.issues.filter(
            (i: { slideId?: string; severity: string }) =>
              (!i.slideId || i.slideId === "deck-level") &&
              (i.severity === "critical" || i.severity === "major")
          );
          if (deckLevelIssues.length > 0 && flaggedSectionIds.size === 0) {
            // Deck-level issues with no specific slides — flag all sections
            for (const section of allSections) {
              flaggedSectionIds.add(section.sectionId);
            }
          }

          return {
            flaggedSlideCount: flaggedSlideIds.size,
            flaggedSectionIds: Array.from(flaggedSectionIds),
            totalSections: allSections.length,
            useSectionRepair: flaggedSectionIds.size > 0 && flaggedSectionIds.size < allSections.length,
          };
        } else {
          // Fallback: if no specific slides flagged, delete all (legacy behavior)
          await deleteRunSlides(runId);
          await deleteRunCharts(runId);
          return {
            flaggedSlideCount: 0,
            flaggedSectionIds: [] as string[],
            totalSections: (deckPlan.structuredPlan.sections ?? []).length,
            useSectionRepair: false,
          };
        }
      });

      // Build critique context for the revise step
      const issuesSummary = critique.issues
        .map((i: { severity: string; type: string; suggestion: string; slideId?: string }) => `[${i.severity}] ${i.type}: ${i.suggestion}${i.slideId ? ` (slide: ${i.slideId})` : ""}`)
        .join("\n");

      // Pre-map available evidence for the revise agent — structural convergence
      // Instead of just saying "fix evidence", give the revise agent the actual evidence inventory
      const availableEvidence = await step.run("revise-load-evidence", async () => {
        return listEvidenceForRun(runId);
      });

      const evidenceInventory = availableEvidence.length > 0
        ? `\n\nAVAILABLE EVIDENCE (use these EXACT ref IDs in write_slide):\n${availableEvidence.map(
            (e: { evidenceRefId: string; label?: string; summary: string }) =>
              `  ${e.evidenceRefId}: ${e.label || ""} — ${e.summary.slice(0, 120)}`
          ).join("\n")}`
        : "";

      // Determine which sections to re-author
      const allSections = deckPlan.structuredPlan.sections ?? [];
      const allSlides = await step.run("revise-load-slides", async () => {
        return getSlides(runId);
      });

      // Normalize slideIds: strategic critic emits position strings, factual critic emits UUIDs
      const flaggedSlideIds = new Set<string>();
      for (const issue of critique.issues) {
        if (!issue.slideId || issue.slideId === "deck-level") continue;

        // Try as UUID first (direct match)
        const directMatch = allSlides.find((s: { id: string }) => s.id === issue.slideId);
        if (directMatch) {
          flaggedSlideIds.add(directMatch.id);
          continue;
        }

        // Try as position string
        const position = parseInt(issue.slideId, 10);
        if (!isNaN(position)) {
          const posMatch = allSlides.find((s: { position: number }) => s.position === position);
          if (posMatch) {
            flaggedSlideIds.add(posMatch.id);
          }
        }
      }

      const flaggedSectionIds = new Set<string>();
      for (const section of allSections) {
        for (const slideSpec of section.slides) {
          const matchingSlide = allSlides.find((s: { id: string; position: number }) =>
            flaggedSlideIds.has(s.id) && s.position === slideSpec.position
          );
          if (matchingSlide) {
            flaggedSectionIds.add(section.sectionId);
          }
        }
      }

      // Deck-level issues with no specific slides — flag all sections
      const deckLevelIssues = critique.issues.filter(
        (i: { slideId?: string; severity: string }) =>
          (!i.slideId || i.slideId === "deck-level") &&
          (i.severity === "critical" || i.severity === "major")
      );
      if (deckLevelIssues.length > 0 && flaggedSectionIds.size === 0) {
        for (const section of allSections) {
          flaggedSectionIds.add(section.sectionId);
        }
      }

      // Section-level targeted repair: re-run only flagged sections
      const sectionsToRevise = flaggedSectionIds.size > 0 && flaggedSectionIds.size < allSections.length
        ? allSections.filter((s) => flaggedSectionIds.has(s.sectionId))
        : allSections; // Fall back to all sections if all flagged or none mapped

      if (sectionsToRevise.length > 0 && sectionsToRevise.length < allSections.length) {
        // Section-level targeted repair — re-run only flagged sections
        for (const section of sectionsToRevise) {
          const safeSectionId = section.sectionId
            .replace(/[^a-zA-Z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase();

          await step.run(`revise-section-${safeSectionId}`, async () => {
            await emitRunEvent(runId, "revise", "section_started", {
              sectionId: section.sectionId,
              slideCount: section.slides.length,
            });

            tracker.startPhase("revise", "claude-opus-4-6", "anthropic");

            // Build section-scoped brief with critique context
            const sectionBrief = buildSectionBrief(brief, section, analystResult, deckPlan.structuredPlan);

            // Filter issues relevant to this section's slides
            const sectionPositions = new Set(section.slides.map((s) => s.position));
            const sectionIssues = critique.issues.filter((i: { slideId?: string }) => {
              if (!i.slideId || i.slideId === "deck-level") return true; // deck-level issues apply to all

              // Try UUID match first
              const uuidMatch = allSlides.find((s: { id: string }) => s.id === i.slideId);
              if (uuidMatch) return sectionPositions.has((uuidMatch as { position: number }).position);

              // Try position string match (strategic critic emits "3" not a UUID)
              const position = parseInt(i.slideId, 10);
              if (!isNaN(position)) return sectionPositions.has(position);

              return false;
            });

            const sectionIssuesSummary = sectionIssues
              .map((i: { severity: string; type: string; suggestion: string; slideId?: string }) => `[${i.severity}] ${i.type}: ${i.suggestion}${i.slideId ? ` (slide: ${i.slideId})` : ""}`)
              .join("\n");

            const sectionStepLimit = Math.min(5 + section.slides.length * 6, 30);

            const result = await runAuthorAgent({
              workspace,
              runId,
              analysis,
              brief: sectionBrief,
              maxSteps: sectionStepLimit,
              loadRows: loadSheetRows,
              critiqueContext: sectionIssuesSummary + evidenceInventory + `\n\nTARGETED SECTION REPAIR: Re-author only the slides in section "${section.title}". Fix the issues listed above. Use the AVAILABLE EVIDENCE ref IDs listed above — do NOT invent evidence IDs. Preserved slides from other sections are untouched.`,
              persistNotebookEntry: async (entry: NotebookEntry) => {
                const notebookId = await persistNotebookEntry(runId, "revise", 0, entry);
                if (entry.evidenceRefId) {
                  await persistEvidenceEntry(runId, {
                    evidenceType: entry.toolName === "compute_metric" ? "metric" : entry.toolName === "query_data" ? "table" : "document",
                    refId: entry.evidenceRefId,
                    label: (entry.toolInput as Record<string, unknown>)?.name as string ?? entry.toolName,
                    description: (entry.toolOutput as Record<string, unknown>)?.summary as string ?? undefined,
                    value: entry.toolOutput,
                    sourceNotebookEntryId: notebookId,
                  });
                }
                return notebookId;
              },
              persistSlide: async (slide: SlideInput) => persistSlide(runId, slide),
              persistChart: async (chart: ChartInput) => persistChart(runId, chart),
              getTemplateProfile: () => workspace.templateProfile ?? null,
              listEvidence: () => listEvidenceForRun(runId),
              getNotebookEntries: async (evidenceRefId: string) => getNotebookEntry(evidenceRefId),
              getSlides: makeGetSlides(),
              onStepFinish: async (event: StepFinishEvent) => {
                tracker.recordStep(event.usage, event.toolCalls.length);
                await emitRunEvent(runId, "revise", "tool_call", {
                  sectionId: section.sectionId,
                  stepNumber: event.stepNumber,
                  tools: event.toolCalls.map((tc: { toolName: string }) => tc.toolName),
                  usage: event.usage,
                });
              },
            });

            tracker.endPhase();
            return result.summary;
          });
        }

        deckSummary = `${sectionsToRevise.length}/${allSections.length} sections revised: ${sectionsToRevise.map((s) => s.title).join(", ")}`;
        await emitRunEvent(runId, "revise", "phase_completed", {
          revisedSections: sectionsToRevise.length,
          totalSections: allSections.length,
        });
      } else {
        // Fallback: monolithic revise (all sections flagged or no section mapping available)
        await step.run("revise", async () => {
          tracker.startPhase("revise", "claude-opus-4-6", "anthropic");

          const preservedInfo = flaggedSlideIds.size > 0
            ? `\n\nTARGETED REVISION: Only re-author slides with issues (${flaggedSlideIds.size} slides). The other slides are preserved — do NOT rewrite them. Only create slides for the positions that were removed.`
            : "";

          const result = await runAuthorAgent({
            workspace,
            runId,
            analysis,
            brief,
            loadRows: loadSheetRows,
            critiqueContext: issuesSummary + evidenceInventory + preservedInfo,
            persistNotebookEntry: async (entry: NotebookEntry) => {
              const notebookId = await persistNotebookEntry(runId, "revise", 0, entry);
              if (entry.evidenceRefId) {
                await persistEvidenceEntry(runId, {
                  evidenceType: entry.toolName === "compute_metric" ? "metric" : entry.toolName === "query_data" ? "table" : "document",
                  refId: entry.evidenceRefId,
                  label: (entry.toolInput as Record<string, unknown>)?.name as string ?? entry.toolName,
                  description: (entry.toolOutput as Record<string, unknown>)?.summary as string ?? undefined,
                  value: entry.toolOutput,
                  sourceNotebookEntryId: notebookId,
                });
              }
              return notebookId;
            },
            persistSlide: async (slide: SlideInput) => persistSlide(runId, slide),
            persistChart: async (chart: ChartInput) => persistChart(runId, chart),
            getTemplateProfile: () => workspace.templateProfile ?? null,
            listEvidence: () => listEvidenceForRun(runId),
            getNotebookEntries: async (evidenceRefId: string) => getNotebookEntry(evidenceRefId),
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
                callout: r.callout,
                kicker: r.kicker,
                pageIntent: r.pageIntent,
                governingThought: r.governingThought,
                chartIntent: r.chartIntent,
                focalObject: r.focalObject,
                highlightCategories: r.highlightCategories,
              }));
            },
            renderContactSheet: () => renderContactSheetForRun(runId),
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
      }

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
            return persistNotebookEntry(runId, "critique", 0, entry);
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

        // Also run strategic re-critique
        tracker.startPhase("re-critique-strategic", "claude-opus-4-6", "anthropic");

        const strategicReCritique = await runStrategicCriticAgent({
          runId,
          brief,
          deckSummary,
          slideCount: slides.length,
          slides: slides.map((s) => ({
            position: s.position,
            layoutId: s.layoutId ?? "title-body",
            title: s.title ?? "",
            body: s.body,
            bullets: s.bullets,
            chartId: s.chartId,
            metrics: s.metrics,
            speakerNotes: s.speakerNotes,
            callout: s.callout,
            kicker: s.kicker,
            pageIntent: s.pageIntent,
            governingThought: s.governingThought,
            evidenceIds: s.evidenceIds ?? [],
          })),
          storylinePlan: analystResult.storylinePlan ?? null,
        });

        tracker.endPhase();

        // Merge factual + strategic re-critique
        const mergedReCritique = {
          ...reCritique,
          issues: [...reCritique.issues, ...strategicReCritique.issues],
          hasIssues: reCritique.hasIssues || strategicReCritique.hasIssues,
          narrativeScore: strategicReCritique.narrativeScore,
        };

        // Assemble full re-critique report
        const reCritiqueId = crypto.randomUUID();
        const fullReCritique: CritiqueReport = {
          id: reCritiqueId,
          runId,
          iteration: mergedReCritique.iteration,
          hasIssues: mergedReCritique.hasIssues,
          issues: mergedReCritique.issues,
          coverageScore: mergedReCritique.coverageScore,
          accuracyScore: mergedReCritique.accuracyScore,
          narrativeScore: mergedReCritique.narrativeScore,
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

        // Convergence detection: compare issue types between critique rounds
        // If the same issue types recur, the revise loop is not converging — structural problem
        const firstRoundTypes = new Set(critique.issues.map((i: { type: string }) => i.type));
        const secondRoundTypes = new Set(fullReCritique.issues.map((i) => i.type));
        const recurringTypes = [...secondRoundTypes].filter((t) => firstRoundTypes.has(t));
        const convergenceRatio = recurringTypes.length / Math.max(secondRoundTypes.size, 1);

        if (blockingIssuesRemain) {
          logPhaseEvent(runId, "re-critique", "issues_remain_after_max_revisions", {
            issueCount: fullReCritique.issues.length,
            severities: fullReCritique.issues.map((i) => i.severity),
            convergenceRatio,
            recurringIssueTypes: recurringTypes,
            note: convergenceRatio > 0.5
              ? "Low convergence: >50% of issue types recurred. This is a structural problem, not a revision problem."
              : "Good convergence: most original issue types were resolved.",
          });
        }

        await emitRunEvent(runId, "critique", "phase_completed", {
          hasIssues: fullReCritique.hasIssues,
          issueCount: fullReCritique.issues.length,
          iteration: 2,
        });

        // Degraded delivery: always proceed to export, but track state durably.
        if (blockingIssuesRemain) {
          degradedDelivery = true;
          degradedIssues = fullReCritique.issues
            .filter((i) => i.severity === "critical" || i.severity === "major")
            .map((i) => ({ severity: i.severity, claim: i.claim }));

          await updateDeliveryStatus(runId, "degraded");

          const criticalCount = fullReCritique.issues.filter((i) => i.severity === "critical").length;
          if (criticalCount > 0) {
            logPhaseEvent(runId, "re-critique", "proceeding_with_critical_issues_degraded", {
              criticalCount,
              issues: degradedIssues.filter((i) => i.severity === "critical").map((i) => i.claim),
              note: "Degraded delivery: rendering deck despite critical issues.",
            });
          }
          logPhaseEvent(runId, "re-critique", "proceeding_with_major_issues", {
            issueCount: fullReCritique.issues.length,
            severities: fullReCritique.issues.map((i) => i.severity),
            note: "Major issues remain but proceeding to export — degraded delivery",
          });
        } else {
          // Revise resolved all critical/major issues — mark as reviewed
          await updateDeliveryStatus(runId, "reviewed");
        }
      });
    }

    // ─── STEP 5.5: BUILD SCENE GRAPH ─────────────────────────────
    const sceneGraphResult = await step.run("build-scene-graph", async () => {
      const slides = await getSlides(runId);
      const chartRows = await getV2ChartRows(runId);

      const templateProfile = workspace.templateProfile ?? createSystemTemplateProfile();
      const sceneGraph = buildDeckSceneGraph(
        slides.map(s => ({
          id: s.id,
          runId,
          position: s.position,
          layoutId: s.layoutId ?? "title-body",
          title: s.title ?? "",
          subtitle: s.subtitle,
          kicker: s.kicker,
          body: s.body,
          bullets: s.bullets,
          chartId: s.chartId,
          metrics: s.metrics,
          callout: s.callout,
          evidenceIds: s.evidenceIds ?? [],
          speakerNotes: s.speakerNotes,
          qaStatus: "pending" as const,
          revision: 1,
        })),
        templateProfile,
        chartRows.map(c => ({ id: c.id, chartType: c.chartType, title: c.title })),
      );

      // Persist scene graph as JSON blob
      const sceneGraphJson = JSON.stringify(sceneGraph);
      const sceneGraphBuffer = Buffer.from(sceneGraphJson, "utf-8");
      await uploadToStorage({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        bucket: "artifacts",
        storagePath: `${runId}/scene-graph.json`,
        body: sceneGraphBuffer,
        contentType: "application/json",
      });

      return {
        slideCount: sceneGraph.slides.length,
        totalNodes: sceneGraph.slides.reduce((acc, s) => acc + s.nodes.length, 0),
      };
    });

    // ─── STEP 6a: RENDER PPTX ────────────────────────────────────
    const pptxResult = await step.run("render-pptx", async () => {
      await updateRunStatus(runId, "running", "export");
      await emitRunEvent(runId, "export", "phase_started");

      const slides = await getSlides(runId);
      const v2ChartRows = await getV2ChartRows(runId);
      const deckTitle = analysis.summary?.slice(0, 100) ?? slides[0]?.title ?? "Basquio Report";

      // Map template brand tokens to renderer format
      const tp = workspace.templateProfile;
      const strip = (c?: string) => c?.replace("#", "");
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

      const { createHash } = await import("node:crypto");
      const pptxSha256 = createHash("sha256").update(pptxBuffer).digest("hex");

      return {
        pptxPath,
        pptxSha256,
        pptxBytes: pptxBuffer.length,
        pptxFileName: pptxArtifact.fileName,
        pptxMimeType: pptxArtifact.mimeType,
        slideCount: slides.length,
        deckTitle,
      };
    });

    // ─── STEP 6b: RENDER PDF (scene-graph-based) ───────────────────
    const pdfResult = await step.run("render-pdf", async () => {
      const browserlessToken = process.env.BROWSERLESS_TOKEN;
      const browserlessUrl = process.env.BROWSERLESS_URL ?? "https://production-sfo.browserless.io";
      if (!browserlessToken) return null;

      try {
        // Load the persisted scene graph from Storage
        const sceneGraphBuf = await downloadFromStorage({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          bucket: "artifacts",
          storagePath: `${runId}/scene-graph.json`,
        });

        let html: string;
        if (sceneGraphBuf && sceneGraphBuf.length > 0) {
          const sceneGraph: DeckSceneGraph = JSON.parse(sceneGraphBuf.toString("utf-8"));
          const v2ChartRows = await getV2ChartRows(runId);
          html = renderSceneGraphToHtml(sceneGraph, v2ChartRows, pptxResult.deckTitle);
        } else {
          // Fallback to old renderer if scene graph is missing
          const slides = await getSlides(runId);
          const v2ChartRows = await getV2ChartRows(runId);
          html = renderSlidesToHtml(slides, v2ChartRows, pptxResult.deckTitle);
        }

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

        if (!pdfResp.ok) return null;

        const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
        const pdfPath = `${runId}/deck.pdf`;
        const pdfFileName = `${pptxResult.deckTitle.replace(/[^a-zA-Z0-9 -]/g, "").slice(0, 50)}.pdf`;

        await uploadToStorage({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          bucket: "artifacts",
          storagePath: pdfPath,
          body: pdfBuffer,
          contentType: "application/pdf",
        });

        const { createHash } = await import("node:crypto");
        const pdfSha256 = createHash("sha256").update(pdfBuffer).digest("hex");

        // Count PDF pages
        const pdfText = pdfBuffer.toString("latin1");
        const pageMatches = pdfText.match(/\/Type\s*\/Page(?!s)/g);
        const pageCount = pageMatches ? pageMatches.length : 0;

        return { pdfPath, pdfSha256, pdfBytes: pdfBuffer.length, pdfFileName, pageCount };
      } catch {
        // PDF rendering is best-effort; PPTX is the primary artifact
        return null;
      }
    });

    // ─── STEP 6c: ARTIFACT QA ─────────────────────────────────────
    const qaResult = await step.run("artifact-qa", async () => {
      const qaChecks: Array<{ name: string; passed: boolean; detail?: string }> = [];

      qaChecks.push({
        name: "pptx_non_empty",
        passed: pptxResult.pptxBytes > 0,
        detail: `${pptxResult.pptxBytes} bytes`,
      });
      qaChecks.push({
        name: "slide_count_positive",
        passed: pptxResult.slideCount > 0,
        detail: `${pptxResult.slideCount} slides`,
      });

      // Download PPTX header to validate ZIP signature
      const pptxHeaderBuf = await downloadFromStorage({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        bucket: "artifacts",
        storagePath: pptxResult.pptxPath,
      });
      const hasValidPptxHeader = pptxHeaderBuf && pptxHeaderBuf.length >= 4 &&
        pptxHeaderBuf[0] === 0x50 && pptxHeaderBuf[1] === 0x4B &&
        pptxHeaderBuf[2] === 0x03 && pptxHeaderBuf[3] === 0x04;
      qaChecks.push({ name: "pptx_valid_zip", passed: Boolean(hasValidPptxHeader) });

      if (pdfResult) {
        qaChecks.push({ name: "pdf_non_empty", passed: pdfResult.pdfBytes > 0, detail: `${pdfResult.pdfBytes} bytes` });
      }

      const criticalChecks = qaChecks.filter((c) => c.name.startsWith("pptx_") || c.name === "slide_count_positive");
      const qaPassed = criticalChecks.every((c) => c.passed);

      if (!qaPassed) {
        const failedChecks = criticalChecks.filter((c) => !c.passed).map((c) => c.name).join(", ");
        await updateDeliveryStatus(runId, "failed");
        await updateRunStatus(runId, "failed", "export", { failure_message: `QA failed: ${failedChecks}` });
        throw new Error(`Artifact QA failed: ${failedChecks}`);
      }

      return { qaChecks, qaPassed };
    });

    // ─── STEP 6d: PUBLISH MANIFEST ────────────────────────────────
    const artifacts = await step.run("publish-manifest", async () => {
      const manifestArtifacts: Array<Record<string, unknown>> = [
        {
          id: crypto.randomUUID(),
          kind: "pptx",
          fileName: pptxResult.pptxFileName,
          mimeType: pptxResult.pptxMimeType,
          storageBucket: "artifacts",
          storagePath: pptxResult.pptxPath,
          fileBytes: pptxResult.pptxBytes,
          checksumSha256: pptxResult.pptxSha256,
        },
      ];
      if (pdfResult) {
        manifestArtifacts.push({
          id: crypto.randomUUID(),
          kind: "pdf",
          fileName: pdfResult.pdfFileName,
          mimeType: "application/pdf",
          storageBucket: "artifacts",
          storagePath: pdfResult.pdfPath,
          fileBytes: pdfResult.pdfBytes,
          checksumSha256: pdfResult.pdfSha256,
        });
      }

      const manifestId = crypto.randomUUID();
      const manifest = {
        id: manifestId,
        run_id: runId,
        slide_count: pptxResult.slideCount,
        page_count: pdfResult ? pdfResult.pageCount : pptxResult.slideCount,
        qa_passed: !degradedDelivery,
        qa_report: {
          checks: qaResult.qaChecks,
          delivery_status: degradedDelivery ? "degraded" : "reviewed",
          ...(degradedDelivery ? {
            degraded: true,
            unresolvedIssues: degradedIssues,
            degradedNote: "Deck rendered with unresolved critique issues. Review flagged claims before presenting.",
          } : {}),
        },
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
        slideCount: pptxResult.slideCount,
        artifactCount: manifestArtifacts.length,
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
      await updateDeliveryStatus(runId, "failed").catch(() => {});
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
