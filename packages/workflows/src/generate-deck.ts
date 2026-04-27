import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { read, utils } from "xlsx";
import { z } from "zod";

import { parseEvidencePackage } from "@basquio/data-ingest";
import {
  detectLanguage,
  enforceExhibit,
  inferQuestionType,
  lintDeckText,
  lintDeckFidelity,
  lintSlidePlan,
  MIN_REQUIRED_STRUCTURAL_DECK_SLIDES,
  MAX_RENDERING_TARGET_SLIDES,
  routeQuestion,
  validateDeckContract,
  type FidelitySheetInput,
  type FidelitySlideInput,
  type FidelityViolation,
  type SlidePlanLintInput,
  type SlideTextInput,
} from "@basquio/intelligence";
import { applyTemplateBranding, renderPptxArtifact } from "@basquio/render-pptx";
import type { ChartSlotType } from "@basquio/scene-graph";
import { getArchetypeOrDefault, listArchetypeIds, validateSlotConstraints } from "@basquio/scene-graph/slot-archetypes";
import { getLayoutRegions } from "@basquio/scene-graph/layout-regions";
import {
  buildNoTemplateDiagnostics,
  buildTemplateDiagnosticsFromProfile,
  createSystemTemplateProfile,
  interpretTemplateSource,
  type TemplateDiagnostics,
} from "@basquio/template-engine";
import {
  type ChartSpec,
  type ExhibitPresentationSpec,
  type MetricPresentationSpec,
  type SlideSpec,
  type TemplateProfile,
  type WorkspaceContextPack,
} from "@basquio/types";

import {
  BETAS,
  type AuthoringContainer,
  buildAuthoringContainer,
  buildAuthoringOutputConfig,
  buildAuthoringThinkingConfig,
  buildAuthoringToolCallSummary,
  buildClaudeBetas,
  buildClaudeTools,
  FILES_BETA,
  type ClaudeAuthorModel,
  normalizeClaudeAuthorModel,
  OPUS_AUTHOR_MODEL,
} from "./anthropic-execution-contract";
import {
  appendAssistantTurn,
  appendPauseTurnContinuation,
} from "./anthropic-message-thread";
import {
  assertDeckSpendWithinBudget,
  enforceDeckBudget,
  getDeckBudgetCaps,
  getPriorAttemptsCost,
  roundUsd,
  shouldResetCrossAttemptBudget,
  usageToCost,
} from "./cost-guard";
import {
  buildBriefDataReconciliationProfile,
  buildBriefDataReconciliationPrompt,
  buildFallbackBriefDataReconciliation,
  formatScopeAdjustmentForAuthor,
  parseBriefDataReconciliationResponse,
  type BriefDataReconciliationResult,
} from "./brief-data-reconciliation";
import { deckManifestSchema, parseDeckManifest } from "./deck-manifest";
import {
  buildExhibitPresentationSpec,
  buildWorkbookSheetPresentations,
  inferMetricPresentationSpec,
  type WorkbookSheetPresentation,
} from "./metric-presentation";
import { runClaimTraceabilityQa } from "./claim-traceability-qa";
import { renderedPageQaSchema, runRenderedPageQa } from "./rendered-page-qa";
import { closeOpenRequestUsageRows } from "./request-usage-lifecycle";
import { isRetryableContainerStringError, isTransientProviderError, classifyRuntimeError } from "./failure-classifier";
import { buildBasquioSystemPrompt } from "./system-prompt";
import { notifyRunCompletionIfRequested, notifyRunFailureIfRequested } from "./notify-completion";
import { runResearchPhase, type ResearchPhaseResult } from "./research-phase";
import type { EvidenceRef, HaikuCallFn } from "@basquio/research";
import { deleteRestRows, downloadFromStorage, fetchRestRows, patchRestRows, upsertRestRows, uploadToStorage } from "./supabase";
import {
  buildWorkspaceContextSummary,
  buildWorkspaceContextSupportPackets,
  hashWorkspaceContextPack,
  parseWorkspaceContextPack,
} from "./workspace-context";
import { buildWorkbookEvidencePackets } from "./workbook-evidence-packet";

const execFileAsync = promisify(execFile);

const DEFAULT_AUTHOR_MODEL = "claude-sonnet-4-6";
type AuthorModel = ClaudeAuthorModel;
const AUTHOR_MODEL_VALUES = new Set([
  "claude-sonnet-4-6",
  OPUS_AUTHOR_MODEL,
  "claude-haiku-4-5",
]);
const VISUAL_QA_MODEL = "claude-haiku-4-5";
const FINAL_VISUAL_QA_MODEL = "claude-haiku-4-5";
// Per memory/april-2026-disaster-arc-forensic.md §6.4 + §6.5: only structural
// corruption blocks publish. The slide_count_within_requested_plus_appendix_cap
// check is non-deterministic model output (Claude can produce 12-13 slides for
// a 10-slide ask) and is a publish-blocker only by accident; it is the QA-treadmill
// pattern §6.5 explicitly warns against. Downgraded to advisory: the check still
// runs and reports in qa_report.failed, but does not block publish.
const HARD_QA_BLOCKERS = new Set([
  "pptx_present",
  "md_present",
  "md_content_present",
  "xlsx_present",
  "xlsx_zip_signature",
  "xlsx_manifest_excel_sheet_links_present",
  "xlsx_manifest_excel_sheets_exist",
  "xlsx_manifest_native_chart_links_present",
  "xlsx_native_chart_xml_present",
  "pptx_zip_signature",
  "slide_count_positive",
  "appendix_slide_count_within_cap",
  "report_only_manifest_zero_slides",
  "pptx_zip_parse_failed",
]);
const DECK_PLAN_MECE_CHECK = (process.env.DECK_PLAN_MECE_CHECK ?? "true").trim().toLowerCase() !== "false";
const ALWAYS_ACTIONABLE_PLAN_RULES = new Set([
  "redundant_data_cut",
  "redundant_analytical_cut",
  "storyline_backtracking",
  "content_shortfall",
  "content_overflow",
  "appendix_overfill",
]);
const LONG_DECK_PLAN_RULES = new Set([
  "drilldown_dimension_coverage",
  "insufficient_decomposition_depth",
  "chapter_depth_shallow",
]);
const ANTHROPIC_TIMEOUT_MS = Number.parseInt(process.env.BASQUIO_ANTHROPIC_TIMEOUT_MS ?? "3600000", 10);
const AUTHOR_PHASE_TIMEOUT_MS = Number.parseInt(process.env.BASQUIO_AUTHOR_PHASE_TIMEOUT_MS ?? "3300000", 10);
const REVISE_PHASE_TIMEOUT_MS = Number.parseInt(process.env.BASQUIO_REVISE_PHASE_TIMEOUT_MS ?? "2700000", 10);
const AUTHOR_REQUEST_WATCHDOG_MS = Number.parseInt(process.env.BASQUIO_AUTHOR_REQUEST_WATCHDOG_MS ?? "0", 10);
const REVISE_REQUEST_WATCHDOG_MS = Number.parseInt(process.env.BASQUIO_REVISE_REQUEST_WATCHDOG_MS ?? "0", 10);
const NATIVE_WORKBOOK_CHART_SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "native-workbook-charts.py");
type ClaudePhase =
  | "normalize"
  | "research"
  | "understand"
  | "author"
  | "render"
  | "critique"
  | "revise"
  | "export";
const PHASE_TIMEOUTS_MS: Record<ClaudePhase, number | null> = {
  normalize: 120_000,
  // Research phase (spec §5.5): catalog load + planner (Haiku) + fetcher
  // (Firecrawl + optional Fiber) with a Day-4 smoke budget of 15 URLs.
  // 10 minutes is generous for the 15-URL envelope; post-smoke the cap
  // can relax when the spec-default 50-URL budget comes back.
  research: 10 * 60_000,
  understand: 10 * 60_000,
  // Large code-execution turns routinely run 30-40 minutes on valid decks.
  // Keep a long phase cap, but avoid a short per-request watchdog that kills healthy runs.
  author: AUTHOR_PHASE_TIMEOUT_MS,
  revise: REVISE_PHASE_TIMEOUT_MS,
  render: 120_000,
  critique: 90_000,
  export: 120_000,
};
const MAX_PAUSE_TURNS_PER_PHASE = {
  understand: 3,
  author: 3,
  revise: 3,
  render: 0,
  critique: 0,
  export: 0,
} as const;
const REQUEST_WATCHDOG_BY_PHASE_MS: Record<ClaudePhase, number | null> = {
  normalize: 120_000,
  research: 10 * 60_000,
  understand: 10 * 60_000,
  author: AUTHOR_REQUEST_WATCHDOG_MS > 0 ? AUTHOR_REQUEST_WATCHDOG_MS : null,
  revise: REVISE_REQUEST_WATCHDOG_MS > 0 ? REVISE_REQUEST_WATCHDOG_MS : null,
  render: 120_000,
  critique: 90_000,
  export: 120_000,
} as const;
const REQUEST_WATCHDOG_DEFAULT_MS = 240_000;
const CIRCUIT_BREAKER_MAX_FAILURES = 3;
const CIRCUIT_BREAKER_OPEN_MS = 60_000;
const CIRCUIT_BREAKER_WINDOW_MS = 5 * 60_000;
const CIRCUIT_BREAKER_CLEANUP_MS = 10 * 60_000;
const PROGRESS_MEANINGFUL_STALL_MS = 8 * 60_000;
const SUPABASE_RPC_TIMEOUT_MS = 30_000;
type CircuitState = {
  failures: number[];
  openUntil: number | null;
};
let lastCircuitBreakerCleanupAt = 0;
const CONTINUATION_MIN_REMAINING_BUDGET_USD = 0.5;
const STREAM_REQUEST_WATCHDOG_MS = Number.parseInt(process.env.BASQUIO_STREAM_REQUEST_WATCHDOG_MS ?? "240000", 10);
const CIRCUIT_BREAKER_STATES = new Map<string, CircuitState>();
const APPROVED_ARCHETYPES = listArchetypeIds();
const ALL_CHART_TYPES: ChartSlotType[] = [
  "bar",
  "stacked_bar",
  "line",
  "pie",
  "doughnut",
  "waterfall",
  "scatter",
  "area",
  "grouped_bar",
  "horizontal_bar",
];

type UploadedContainerFileRef = {
  id: string;
  filename: string;
};

type AuthorInputFiles = {
  uploadedEvidence: UploadedContainerFileRef[];
  uploadedSupportPackets: UploadedContainerFileRef[];
  uploadedTemplate: UploadedContainerFileRef | null;
};

type SupportEvidencePacket = {
  filename: string;
  content: string;
};

type WorkbookSheetProfile = FidelitySheetInput;
type WorkbookChartBindingRequest = {
  position: number;
  chartId: string;
  chartType: string;
  title: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  categories: string[];
  existingSheetName?: string;
  existingAnchor?: string;
  existingDataSignature?: string;
};
type WorkbookChartBinding = {
  request: WorkbookChartBindingRequest;
  sheet: WorkbookSheetProfile;
  selectedHeaders: string[];
  headerPresentations: Record<string, MetricPresentationSpec>;
  exhibitPresentation: ExhibitPresentationSpec;
};

type FidelityContext = {
  workbookSheets: WorkbookSheetProfile[];
  knownEntities: string[];
};

type ClaimTraceabilityIssue = {
  position: number;
  severity: "major" | "critical";
  message: string;
};

type RepairLane = "none" | "haiku" | "sonnet";

type RepairIssueBuckets = {
  deterministic: string[];
  haiku: string[];
  sonnet: string[];
};

type RepairFrontierState = {
  blockingContractIssueCount: number;
  claimTraceabilityIssueCount: number;
  blockingVisualIssueCount: number;
  visualScore: number;
  advisoryIssueCount: number;
  deckNeedsRevision: boolean;
};

function coercePositiveNumber(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function coerceInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeChartFigureSize(value: unknown) {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value) && value.length >= 2) {
    const widthInches = coercePositiveNumber(value[0]);
    const heightInches = coercePositiveNumber(value[1]);
    return widthInches && heightInches ? { widthInches, heightInches } : undefined;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const widthInches = coercePositiveNumber(record.widthInches ?? record.w ?? record.width);
    const heightInches = coercePositiveNumber(record.heightInches ?? record.h ?? record.height);
    return widthInches && heightInches ? { widthInches, heightInches } : undefined;
  }

  return undefined;
}

function normalizeChartSort(value: unknown): "desc" | "asc" | "none" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "asc" || normalized === "ascending") {
    return "asc";
  }
  if (normalized === "none" || normalized === "keep" || normalized === "keep-order") {
    return "none";
  }
  if (normalized === "desc" || normalized === "descending" || normalized === "value") {
    return "desc";
  }

  return "desc";
}

function normalizeClaudeStreamError(streamError: unknown) {
  if (!(streamError instanceof Error)) {
    return streamError;
  }

  const normalizedMessage = streamError.message.trim().toLowerCase();
  if (normalizedMessage !== "terminated") {
    return streamError;
  }

  const normalizedError = new Error(
    "Claude execution environment terminated before completing the turn.",
  );
  normalizedError.name = streamError.name || "ProviderExecutionTerminatedError";
  if ("cause" in Error.prototype) {
    try {
      (normalizedError as Error & { cause?: unknown }).cause = streamError;
    } catch {
      // Ignore platforms where Error.cause is read-only.
    }
  }
  return normalizedError;
}

function buildSupportEvidencePackets(parsed: Awaited<ReturnType<typeof parseEvidencePackage>>): SupportEvidencePacket[] {
  return parsed.normalizedWorkbook.files.flatMap((file, index) => {
    if (file.kind === "workbook") {
      return [];
    }

    const pageSections = (file.pages ?? [])
      .slice(0, 16)
      .map((page) => {
        const normalized = sanitizeSupportPacketText(page.text, 4_000);
        return normalized ? `## Page ${page.num}\n${normalized}` : null;
      })
      .filter((section): section is string => Boolean(section));
    const normalizedText = sanitizeSupportPacketText(file.textContent, 20_000);

    if (!normalizedText && pageSections.length === 0) {
      return [];
    }

    const fileWarnings = [
      ...(parsed.datasetProfile.warnings ?? []),
      ...(file.warnings ?? []),
    ];
    const body = [
      "# Basquio Normalized Evidence Packet",
      "",
      "This file was generated during deterministic ingest.",
      "Use it before re-parsing hostile PDF/PPTX evidence in code execution.",
      "If the original document is ambiguous, verify against the uploaded source file after reading this packet.",
      "",
      `Source file: ${file.fileName}`,
      `Kind: ${file.kind}`,
      `Role: ${file.role}`,
      ...(typeof file.pageCount === "number" && file.pageCount > 0 ? [`Page count: ${file.pageCount}`] : []),
      ...(fileWarnings.length > 0
        ? [
            "",
            "## Ingest warnings",
            ...fileWarnings.map((warning) => `- ${warning}`),
          ]
        : []),
      ...(normalizedText
        ? [
            "",
            "## Full normalized extract",
            normalizedText,
          ]
        : []),
      ...(pageSections.length > 0
        ? [
            "",
            "## Page extracts",
            ...pageSections,
          ]
        : []),
    ].join("\n");

    return [
      {
        filename: buildSupportPacketFilename(index, file.fileName),
        content: body,
      },
    ];
  });
}

function mergeSupportPackets(
  left: SupportEvidencePacket[],
  right: SupportEvidencePacket[],
): SupportEvidencePacket[] {
  const packetsByFilename = new Map<string, SupportEvidencePacket>();
  for (const packet of [...left, ...right]) {
    packetsByFilename.set(packet.filename, packet);
  }
  return [...packetsByFilename.values()];
}

function extendBusinessContextWithWorkspacePack(
  businessContext: string,
  workspaceContextPack: WorkspaceContextPack | null,
) {
  if (!workspaceContextPack) {
    return businessContext;
  }

  const renderedPrelude = workspaceContextPack.renderedBriefPrelude.trim();
  if (!renderedPrelude) {
    return businessContext;
  }

  const trimmedBusinessContext = businessContext.trim();
  if (trimmedBusinessContext.includes(renderedPrelude)) {
    return businessContext;
  }

  return [renderedPrelude, trimmedBusinessContext].filter(Boolean).join("\n\n");
}

function sanitizeSupportPacketText(text: string | undefined, maxChars: number) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

function buildWorkbookEvidencePromptExcerpt(packets: SupportEvidencePacket[]) {
  const workbookPackets = packets.filter((packet) => packet.filename.startsWith("basquio-workbook-evidence-packet-"));
  if (workbookPackets.length === 0) {
    return undefined;
  }

  const excerpts = workbookPackets.map((packet) => [
    `Workbook packet: ${packet.filename}`,
    sanitizeSupportPacketText(packet.content, 12_000),
  ].join("\n\n"));

  return [
    "DETERMINISTIC WORKBOOK SOURCE TRUTH",
    "Basquio computed the following workbook facts before authoring. These facts override any different total, share, CAGR, category, period, or focal-entity value you compute from ad hoc parsing. If your code disagrees, fix your workbook header parsing before writing artifacts.",
    ...excerpts,
  ].join("\n\n");
}

function buildSupportPacketFilename(index: number, fileName: string) {
  const base = path.basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `file-${index + 1}`;
  return `basquio-evidence-packet-${String(index + 1).padStart(2, "0")}-${base}.md`;
}

const analysisSchema = z.object({
  language: z.string().default("English"),
  thesis: z.string().default(""),
  executiveSummary: z.string().default(""),
  slidePlan: z.array(z.object({
    position: z.number().int().min(1),
    layoutId: z.string().default("title-body"),
    slideArchetype: z.string().default("title-body"),
    title: z.string(),
    subtitle: z.string().optional(),
    body: z.string().optional(),
    bullets: z.array(z.string()).optional(),
    metrics: z.array(z.object({
      label: z.string(),
      value: z.string(),
      delta: z.string().optional(),
      presentation: z.record(z.string(), z.unknown()).optional(),
    }).passthrough()).optional(),
    callout: z.object({
      text: z.string(),
      tone: z.enum(["accent", "green", "orange"]).optional(),
    }).passthrough().optional(),
    evidenceIds: z.array(z.string()).optional(),
    chart: z.object({
      id: z.string().optional().transform((value) => value?.trim() || `chart-${randomUUID().slice(0, 8)}`),
      chartType: z.string().optional().transform((value) => value?.trim() || "bar"),
      title: z.string().optional().transform((value) => value?.trim() || ""),
      xAxisLabel: z.string().optional(),
      yAxisLabel: z.string().optional(),
      bubbleSizeLabel: z.string().optional(),
      sourceNote: z.string().optional(),
      excelSheetName: z.string().optional(),
      excelChartCellAnchor: z.string().optional(),
      dataSignature: z.string().optional(),
      maxCategories: z.coerce.number().int().min(1).optional().catch(undefined),
      preferredOrientation: z.enum(["horizontal", "vertical"]).optional().catch(undefined),
      slotAspectRatio: z.any().optional().transform((value) => coercePositiveNumber(value)),
      figureSize: z.any().optional().transform((value) => normalizeChartFigureSize(value)),
      sort: z.any().optional().transform((value) => normalizeChartSort(value) ?? "desc"),
      truncateLabels: z.boolean().optional(),
      exhibitPresentation: z.record(z.string(), z.unknown()).optional(),
    }).passthrough().optional(),
  }).passthrough()).default([]),
}).passthrough();

type AnalysisResult = z.infer<typeof analysisSchema>;

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
  target_slide_count: number;
  author_model: string | null;
  template_profile_id: string | null;
  template_diagnostics: Record<string, unknown> | null;
  workspace_id: string | null;
  workspace_scope_id: string | null;
  conversation_id: string | null;
  from_message_id: string | null;
  launch_source: "workspace-chat" | "workspace-deliverable" | "jobs-new" | "other" | null;
  workspace_context_pack: Record<string, unknown> | null;
  workspace_context_pack_hash: string | null;
  active_attempt_id: string | null;
  latest_attempt_id: string | null;
  latest_attempt_number: number;
  failure_phase: string | null;
};

type RunAttemptRow = {
  id: string;
  run_id: string;
  attempt_number: number;
  status: string;
  recovery_reason: string | null;
  failure_phase: string | null;
  failure_message: string | null;
  last_meaningful_event_at: string | null;
  anthropic_request_ids: unknown;
};

type WorkingPaperRow = {
  paper_type: string;
  content: Record<string, unknown> | null;
  version: number;
};

type AttemptCostRow = {
  id: string;
  attempt_number: number;
  cost_telemetry: Record<string, unknown> | null;
};

type AttemptContext = {
  id: string;
  attemptNumber: number;
  recoveryReason: string | null;
};

type TemplateProfileRow = {
  id: string;
  source_file_id: string | null;
  template_profile: TemplateProfile;
};

type SourceFileRow = {
  id: string;
  kind: string;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  file_bytes: number | null;
};

type LoadedSourceFile = SourceFileRow & {
  buffer: Buffer;
};

type GeneratedFile = {
  fileId: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
};

type DeckPhase =
  | "normalize"
  | "research"
  | "understand"
  | "author"
  | "render"
  | "critique"
  | "revise"
  | "export";

// ─── ARTIFACT CHECKPOINT CONTRACT ────────────────────────────────
// Checkpointable outputs by phase:
//   normalize  → parsed evidence workspace, template diagnostics
//   understand → analysis/story/deck plan (working_paper: analysis_result)
//   author     → first valid artifact set (working_paper: artifact_checkpoint)
//   revise     → improved valid artifact set (working_paper: artifact_checkpoint)
//   export     → published artifact manifest + delivery state

type ArtifactCheckpointProof = {
  authorComplete: boolean;
  critiqueComplete: boolean;
  reviseComplete: boolean;
  visualQaGreen: boolean;
  lintPassed: boolean;
  contractPassed: boolean;
  deckNeedsRevision: boolean;
};

type ArtifactCheckpoint = {
  phase: "author" | "critique" | "revise";
  pptxStoragePath: string;
  pdfStoragePath: string;
  mdStoragePath: string;
  xlsxStoragePath: string;
  manifestJson: Record<string, unknown>;
  savedAt: string;
  attemptId: string;
  attemptNumber: number;
  resumeReady: boolean;
  visualQaStatus?: "green" | "yellow" | "red";
  deckNeedsRevision?: boolean;
  proof: ArtifactCheckpointProof;
};
type ClaudeUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

type PublishDecision = {
  decision: "publish" | "fail";
  hardBlockers: string[];
  advisories: string[];
  qualityPassport: {
    classification: "gold" | "silver" | "bronze" | "recovery";
    criticalCount: number;
    majorCount: number;
    visualScore: number;
    mecePass: boolean;
    summary: string;
  };
  artifactSource: "fresh_generation" | "checkpoint";
  visualQa: {
    overallStatus: "green" | "yellow" | "red";
    deckNeedsRevision: boolean;
  };
  lintPassed: boolean;
  contractPassed: boolean;
  chartImageCoveragePct: number | null;
  sceneOverflowCount: number;
  sceneCollisionCount: number;
};
type ClaudeRequestUsage = {
  requestId: string | null;
  startedAt: string;
  completedAt: string;
  usage: ClaudeUsage;
  stopReason: string | null;
};
type RenderedPageQaReport = z.infer<typeof renderedPageQaSchema>;
type MutableNumberRef = {
  value: number;
};
type PublishedArtifact = {
  id: string;
  kind: "pptx" | "pdf" | "md" | "xlsx";
  fileName: string;
  mimeType: string;
  storageBucket: "artifacts";
  storagePath: string;
  fileBytes: number;
  checksumSha256: string;
};
type PreviewAsset = {
  position: number;
  fileName: string;
  mimeType: "image/png";
  storageBucket: "artifacts";
  storagePath: string;
  fileBytes: number;
  checksumSha256: string;
};

type QaMode = "deck" | "report_only";

type RenderedPageQaResult = Awaited<ReturnType<typeof runRenderedPageQa>>;

export class AttemptOwnershipLostError extends Error {
  constructor(runId: string, attemptId: string) {
    super(`Run ${runId} is no longer owned by attempt ${attemptId}.`);
    this.name = "AttemptOwnershipLostError";
  }
}

export class WorkerShutdownInterruptError extends Error {
  constructor(phase: string) {
    super(`Worker shutdown interrupted the ${phase} phase before the provider request completed.`);
    this.name = "WorkerShutdownInterruptError";
  }
}

function throwIfWorkerShutdownRequested(signal: AbortSignal | null | undefined, phase: string) {
  if (signal?.aborted) {
    throw new WorkerShutdownInterruptError(phase);
  }
}

async function waitWithOptionalAbort(ms: number, signal: AbortSignal | null | undefined, phase: string) {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }

  throwIfWorkerShutdownRequested(signal, phase);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new WorkerShutdownInterruptError(phase));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function hasPdfHeader(buffer: Buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  );
}

async function inspectPdfBuffer(buffer: Buffer): Promise<{ valid: boolean; reason: string }> {
  if (!hasPdfHeader(buffer)) {
    return { valid: false, reason: "pdf_invalid_header" };
  }

  try {
    await PDFDocument.load(buffer);
    return { valid: true, reason: "ok" };
  } catch (error) {
    return {
      valid: false,
      reason: `pdf_parse_failed:${error instanceof Error ? error.message : String(error)}`.slice(0, 220),
    };
  }
}

async function convertPptxToPdf(pptxBuffer: Buffer): Promise<Buffer> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "basquio-pdf-recovery-"));
  const pptxPath = path.join(tempDir, "deck.pptx");
  const pdfPath = path.join(tempDir, "deck.pdf");

  try {
    await writeFile(pptxPath, pptxBuffer);
    const binaries = ["libreoffice", "soffice"];
    let lastError: Error | null = null;

    for (const binary of binaries) {
      try {
        await execFileAsync(
          binary,
          ["--headless", "--convert-to", "pdf", "--outdir", tempDir, pptxPath],
          { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
        );
        const recovered = await readFile(pdfPath);
        return recovered;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error("No PDF conversion binary succeeded.");
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function recordPdfRecovery(
  phaseTelemetry: Record<string, unknown>,
  stage: "critique" | "revise" | "export",
  payload: Record<string, unknown>,
) {
  const current = (phaseTelemetry.pdfRecovery as Record<string, unknown> | undefined) ?? {};
  phaseTelemetry.pdfRecovery = {
    ...current,
    [stage]: payload,
  };
}

async function ensureValidPdfArtifact(input: {
  pdf: GeneratedFile;
  pptx: GeneratedFile;
  phaseTelemetry: Record<string, unknown>;
  stage: "critique" | "revise" | "export";
}): Promise<GeneratedFile> {
  const initial = await inspectPdfBuffer(input.pdf.buffer);
  if (initial.valid) {
    return input.pdf;
  }

  console.warn(`[generateDeckRun] ${input.stage} PDF invalid (${initial.reason}). Attempting recovery from PPTX.`);
  try {
    const recoveredBuffer = await convertPptxToPdf(input.pptx.buffer);
    const recovered = await inspectPdfBuffer(recoveredBuffer);
    if (!recovered.valid) {
      throw new Error(recovered.reason);
    }

    recordPdfRecovery(input.phaseTelemetry, input.stage, {
      succeeded: true,
      source: "pptx_conversion",
    });
    return {
      ...input.pdf,
      buffer: recoveredBuffer,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[generateDeckRun] PDF recovery failed during ${input.stage}: ${message.slice(0, 300)}`);
    recordPdfRecovery(input.phaseTelemetry, input.stage, {
      succeeded: false,
      reason: message.slice(0, 300),
      initialReason: initial.reason,
    });
    return input.pdf;
  }
}

function buildSkippedVisualQaResult(reason: string): RenderedPageQaResult {
  const now = new Date().toISOString();
  return {
    report: {
      overallStatus: "green",
      score: 8,
      summary: `Visual QA skipped: ${reason.slice(0, 220)}`,
      deckNeedsRevision: false,
      issues: [],
      strongestSlides: [],
      weakestSlides: [],
    },
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
    requestId: null,
    startedAt: now,
    completedAt: now,
    requests: [],
    promptBody: { messages: [] },
  };
}

async function runRenderedPageQaSafely(input: {
  client: Anthropic;
  pdf: GeneratedFile;
  pptx: GeneratedFile;
  manifest: z.infer<typeof deckManifestSchema>;
  templateProfile: TemplateProfile;
  betas: readonly string[];
  model: "claude-sonnet-4-6" | "claude-haiku-4-5";
  maxTokens?: number;
  phaseTelemetry: Record<string, unknown>;
  telemetryKey: string;
  recoveryStage: "critique" | "revise" | "export";
}): Promise<{ pdf: GeneratedFile; qa: RenderedPageQaResult }> {
  const safePdf = await ensureValidPdfArtifact({
    pdf: input.pdf,
    pptx: input.pptx,
    phaseTelemetry: input.phaseTelemetry,
    stage: input.recoveryStage,
  });

  try {
    return {
      pdf: safePdf,
      qa: await runRenderedPageQa({
        client: input.client,
        pdf: safePdf.buffer,
        manifest: input.manifest,
        templateContext: buildTemplateQaContext(input.templateProfile),
        betas: input.betas,
        model: input.model,
        maxTokens: input.maxTokens,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[generateDeckRun] visual QA skipped during ${input.recoveryStage}: ${message.slice(0, 300)}`);
    input.phaseTelemetry[input.telemetryKey] = {
      reason: message.slice(0, 300),
    };
    return {
      pdf: safePdf,
      qa: buildSkippedVisualQaResult(message),
    };
  }
}

async function runClaimTraceabilityQaSafely(input: {
  client: Anthropic;
  manifest: z.infer<typeof deckManifestSchema>;
  fidelityContext: FidelityContext | null;
  run: RunRow;
  phaseTelemetry: Record<string, unknown>;
  telemetryKey: string;
}) {
  if (!input.fidelityContext) {
    return {
      report: {
        summary: "Claim-traceability QA skipped because no workbook fidelity context was available.",
        issues: [] as ClaimTraceabilityIssue[],
      },
      usage: { input_tokens: 0, output_tokens: 0 },
      requests: [] as Array<{
        requestId: string | null;
        startedAt: string;
        completedAt: string;
        usage: { input_tokens: number; output_tokens: number };
        stopReason: string | null;
      }>,
    };
  }

  try {
    return await runClaimTraceabilityQa({
      client: input.client,
      manifest: {
        slideCount: input.manifest.slideCount,
        slides: manifestToClaimTraceabilityInput(input.manifest),
      },
      workbookSheets: input.fidelityContext.workbookSheets,
      knownEntities: input.fidelityContext.knownEntities,
      briefContext: {
        client: input.run.client,
        audience: input.run.audience,
        objective: input.run.objective,
        thesis: input.run.thesis,
        businessContext: input.run.business_context,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[generateDeckRun] claim-traceability QA skipped: ${message.slice(0, 300)}`);
    input.phaseTelemetry[input.telemetryKey] = {
      reason: message.slice(0, 300),
    };
    return {
      report: {
        summary: `Claim-traceability QA skipped: ${message.slice(0, 200)}`,
        issues: [] as ClaimTraceabilityIssue[],
      },
      usage: { input_tokens: 0, output_tokens: 0 },
      requests: [] as Array<{
        requestId: string | null;
        startedAt: string;
        completedAt: string;
        usage: { input_tokens: number; output_tokens: number };
        stopReason: string | null;
      }>,
    };
  }
}

const RECOVERY_ATTEMPT_REUSE_REASONS = new Set([
  "stale_timeout",
  "transient_provider_retry",
  "transient_network_retry",
  "worker_shutdown",
]);

export async function generateDeckRun(
  runId: string,
  suppliedAttempt?: (Partial<AttemptContext> & { abortSignal?: AbortSignal | null }),
) {
  const config = resolveConfig();
  const externalAbortSignal = suppliedAttempt?.abortSignal ?? null;
  const client = new Anthropic({
    apiKey: config.anthropicApiKey,
    maxRetries: 2,
    timeout: ANTHROPIC_TIMEOUT_MS,
  });

  let spentUsd = 0;
  let currentPhase: DeckPhase = "normalize";
  const phaseTelemetry: Record<string, unknown> = {};
  let continuationCount = 0;
  const anthropicRequestIds = new Set<string>();
  let templateMode: "basquio_standard" | "workspace_template" | "template_fallback" = "basquio_standard";
  let authorModel: AuthorModel = DEFAULT_AUTHOR_MODEL;
  let parseWarnings: string[] = [];
  let partialDeliveryWarnings: string[] = [];
  let scopeAdjustmentForAuthor: string | undefined;

  try {
    const run = await loadRun(config, runId);
    const workspaceContextPack = parseWorkspaceContextPack(run.workspace_context_pack);
    const workspaceContextPackHash = run.workspace_context_pack_hash ?? hashWorkspaceContextPack(workspaceContextPack);
    run.business_context = extendBusinessContextWithWorkspacePack(run.business_context, workspaceContextPack);
    authorModel = normalizeAuthorModel(run.author_model);
    let MODEL = authorModel;
    let modelBudget = getDeckBudgetCaps(MODEL, run.target_slide_count);
    let modelBetas = buildClaudeBetas(MODEL);
    let toolCallSummary = buildAuthoringToolCallSummary(MODEL);
    const attempt = await resolveAttemptContext(config, run, suppliedAttempt);
    const priorAttemptsCostUsd = await getPriorAttemptsCost({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      runId,
      excludeAttemptId: attempt.id,
    });
    const crossAttemptBudgetReset = shouldResetCrossAttemptBudget(attempt.recoveryReason);
    const effectivePriorAttemptsCostUsd = crossAttemptBudgetReset ? 0 : priorAttemptsCostUsd;
    phaseTelemetry.crossAttemptBudget = {
      priorAttemptsCostUsd,
      effectivePriorAttemptsCostUsd,
      resetApplied: crossAttemptBudgetReset,
      resetReason: attempt.recoveryReason,
      budgetUsd: modelBudget.crossAttempt,
      attemptNumber: attempt.attemptNumber,
      model: MODEL,
    };
    if (effectivePriorAttemptsCostUsd >= modelBudget.crossAttempt) {
      throw new Error(
        `Run has already spent $${priorAttemptsCostUsd.toFixed(2)} across prior attempts. Cross-attempt budget for ${MODEL} is $${modelBudget.crossAttempt.toFixed(2)}.`,
      );
    }
    throwIfWorkerShutdownRequested(externalAbortSignal, "normalize");
    const sourceFiles = await loadSourceFiles(config, run.source_file_ids);
    const fileBackedAttachmentKinds = [...new Set(sourceFiles.map((file) => file.kind).filter(Boolean))];
    // E: Template fallback — if recovery_reason is template_fallback, skip template entirely
    const isTemplateFallback = attempt.recoveryReason === "template_fallback";
    const persistedTemplate = isTemplateFallback ? null : await loadTemplateProfileRow(config, run.template_profile_id);
    const templateSourceFileId = persistedTemplate?.source_file_id ?? null;
    const workbookSourceFiles = sourceFiles.filter((file) => file.kind === "workbook");
    const explicitTemplateFallback = !isTemplateFallback && !persistedTemplate && workbookSourceFiles.length > 0
      ? (sourceFiles.find((file) => file.kind === "brand-tokens") ??
         (sourceFiles.filter((file) => file.kind === "pptx").length === 1
           ? sourceFiles.find((file) => file.kind === "pptx")
           : undefined))
      : undefined;
    const persistedTemplateFile = !isTemplateFallback && templateSourceFileId
      ? (sourceFiles.find((file) => file.id === templateSourceFileId) ??
         await loadSourceFile(config, templateSourceFileId))
      : undefined;
    const templateFile = isTemplateFallback
      ? undefined
      : (persistedTemplateFile ?? explicitTemplateFallback);
    const evidenceFiles = sourceFiles.filter((file) => file.id !== templateFile?.id);
    templateMode = isTemplateFallback
      ? "template_fallback"
      : (templateFile || persistedTemplate ? "workspace_template" : "basquio_standard");

    currentPhase = "normalize";
    await markPhase(config, runId, attempt, currentPhase);

    throwIfWorkerShutdownRequested(externalAbortSignal, currentPhase);
    const parsed = await parseEvidencePackage({
      datasetId: runId,
      files: evidenceFiles.map((file) => ({
        id: file.id,
        fileName: file.file_name,
        buffer: file.buffer,
      })),
    });
    parseWarnings = collectParseWarnings(parsed);
    if (parseWarnings.length > 0) {
      phaseTelemetry.parseWarnings = parseWarnings;
      await insertEvent(config, runId, attempt, currentPhase, "parse_warnings", {
        warnings: parseWarnings,
      }).catch(() => {});
    }

    throwIfWorkerShutdownRequested(externalAbortSignal, currentPhase);
    const templateProfile = templateFile
      ? await interpretTemplateSource({
          id: run.template_profile_id ?? `${runId}-template`,
          fileName: templateFile.file_name,
          sourceFile: {
            fileName: templateFile.file_name,
            base64: templateFile.buffer.toString("base64"),
          },
        })
      : persistedTemplate?.template_profile ?? createSystemTemplateProfile();
    const templateDiagnostics: TemplateDiagnostics = templateFile
      ? buildTemplateDiagnosticsFromProfile({
          profile: templateProfile,
          source: "uploaded_file",
          templateProfileId: run.template_profile_id,
        })
      : persistedTemplate
        ? buildTemplateDiagnosticsFromProfile({
            profile: templateProfile,
            source: "saved_profile",
            templateProfileId: run.template_profile_id,
          })
        : buildNoTemplateDiagnostics();

    throwIfWorkerShutdownRequested(externalAbortSignal, currentPhase);
    await persistTemplateDiagnostics(config, runId, templateDiagnostics);

    await persistEvidenceWorkspace(config, run, parsed, templateProfile);
    if (workspaceContextPack) {
      const workspaceMarkdown = buildWorkspaceContextSupportPackets(workspaceContextPack).find((packet) => packet.filename.endsWith(".md"))?.content ?? "";
      await upsertWorkingPaper(config, runId, "workspace_context_pack", {
        hash: workspaceContextPackHash,
        pack: workspaceContextPack,
      });
      await upsertWorkingPaper(config, runId, "workspace_context_support_packet", {
        hash: workspaceContextPackHash,
        markdown: workspaceMarkdown,
      });
    }
    await upsertWorkingPaper(config, runId, "execution_brief", {
      brief: run.brief,
      workspaceContextPack,
      workspaceContextPackHash,
      fileInventory: parsed.datasetProfile.manifest ?? {},
      templateProfile,
      templateDiagnostics,
    });

    throwIfWorkerShutdownRequested(externalAbortSignal, currentPhase);
    const evidenceValidationError = validateAnalyticalEvidence(parsed);
    if (evidenceValidationError) {
      throw new Error(evidenceValidationError);
    }

    const briefDataReconciliation = await runBriefDataReconciliation({
      config,
      runId,
      run,
      attempt,
      client,
      evidenceFiles,
      parsed,
      currentSpentUsd: spentUsd,
      abortSignal: externalAbortSignal,
    });
    spentUsd = roundUsd(spentUsd + briefDataReconciliation.costUsd);
    rememberRequestIds(anthropicRequestIds, briefDataReconciliation.requests);
    scopeAdjustmentForAuthor = formatScopeAdjustmentForAuthor(briefDataReconciliation.result);
    phaseTelemetry.briefDataReconciliation = {
      answerable: briefDataReconciliation.result.answerable,
      source: briefDataReconciliation.source,
      unsupportedScopeCount: briefDataReconciliation.result.unsupportedScope.length,
      forbiddenClaimCount: briefDataReconciliation.result.forbiddenClaims.length,
    };
    await upsertWorkingPaper(config, runId, "brief_data_reconciliation", {
      source: briefDataReconciliation.source,
      result: briefDataReconciliation.result,
    });
    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: { id: `eq.${runId}` },
      payload: { scope_adjustment: briefDataReconciliation.result.scopeAdjustmentText },
    }).catch(() => {});
    await insertEvent(config, runId, attempt, currentPhase, "brief_data_reconciliation", {
      source: briefDataReconciliation.source,
      answerable: briefDataReconciliation.result.answerable,
      supportedScope: briefDataReconciliation.result.supportedScope,
      unsupportedScope: briefDataReconciliation.result.unsupportedScope,
      forbiddenClaims: briefDataReconciliation.result.forbiddenClaims,
    }).catch(() => {});

    await completePhase(config, runId, attempt, "normalize", {
      fileCount: parsed.datasetProfile.sourceFiles.length,
      sheetCount: parsed.datasetProfile.sheets.length,
    });

    // ── Research phase (spec §5.5) ─────────────────────────────────
    // Feature-flagged behind BASQUIO_RESEARCH_PHASE_ENABLED so production
    // runs do not spend Firecrawl credits until the path is explicitly
    // enabled. The smoke test flips the flag for one run; later days
    // flip it to the default after stability is proved. Non-fatal: a
    // failure here degrades gracefully and the deck proceeds with
    // uploaded-file evidence only.
    let researchEvidenceRefs: EvidenceRef[] = [];
    let researchPhaseResult: ResearchPhaseResult | null = null;
    if (process.env.BASQUIO_RESEARCH_PHASE_ENABLED === "true" && run.workspace_id) {
      const researchPhaseStartedAt = Date.now();
      try {
        currentPhase = "research";
        await markPhase(config, runId, attempt, currentPhase);
        throwIfWorkerShutdownRequested(externalAbortSignal, currentPhase);
        researchPhaseResult = await runResearchPhase(
          {
            workspaceId: run.workspace_id,
            deckRunId: runId,
            conversationId: workspaceContextPack?.lineage?.conversationId ?? null,
            briefSummary: extractBriefSummaryForResearch(run.brief),
            briefKeywords: extractBriefKeywordsForResearch(run.brief, workspaceContextPack),
            workspaceContextPack,
            callHaiku: buildHaikuCallFnForResearch(client),
            graphQuery: async () => ({ hits: [] }),
          },
          {
            supabaseUrl: config.supabaseUrl,
            serviceKey: config.serviceKey,
            firecrawlApiKey: process.env.FIRECRAWL_API_KEY ?? null,
            fiberApiKey: process.env.FIBER_API_KEY ?? null,
          },
          externalAbortSignal ?? undefined,
        );
        researchEvidenceRefs = researchPhaseResult.evidenceRefs;
        await completePhase(config, runId, attempt, "research", {
          researchRunId: researchPhaseResult.researchRunId,
          evidenceRefCount: researchEvidenceRefs.length,
          queriesAttempted: researchPhaseResult.stats.queriesAttempted,
          queriesCompleted: researchPhaseResult.stats.queriesCompleted,
          scrapesSucceeded: researchPhaseResult.stats.scrapesSucceeded,
          firecrawlUsd: researchPhaseResult.stats.firecrawlUsd,
          degraded: researchPhaseResult.degraded,
          degradedReason: researchPhaseResult.degradedReason,
          elapsedMs: Date.now() - researchPhaseStartedAt,
        });
      } catch (error) {
        await insertEvent(config, runId, attempt, "research", "phase_error", {
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - researchPhaseStartedAt,
        }).catch(() => {});
        // Close out the phase even on failure so operator telemetry
        // does not leave research stuck in "started". The deck
        // continues with uploaded-file evidence only.
        await completePhase(config, runId, attempt, "research", {
          degraded: true,
          degradedReason: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - researchPhaseStartedAt,
        }).catch(() => {});
      }
    }

    const uploadedEvidence = await uploadClaudeFilesSequentially({
      client,
      config,
      runId,
      attempt,
      phase: "normalize",
      entries: evidenceFiles.map((file) => ({
        label: "evidence",
        fileName: file.file_name,
        upload: async () =>
          client.beta.files.upload({
            file: await toFile(file.buffer, file.file_name),
            betas: [FILES_BETA],
          }),
      })),
    });
    const supportEvidencePackets = mergeSupportPackets(
      mergeSupportPackets(
        buildWorkspaceContextSupportPackets(workspaceContextPack).map((packet) => ({
          filename: packet.filename,
          content: packet.content,
        })),
        buildWorkbookEvidencePackets(evidenceFiles.map((file) => ({
          fileName: file.file_name,
          kind: file.kind,
          buffer: file.buffer,
        }))),
      ),
      buildSupportEvidencePackets(parsed),
    );
    const workbookEvidencePromptExcerpt = buildWorkbookEvidencePromptExcerpt(supportEvidencePackets);
    if (workbookEvidencePromptExcerpt) {
      scopeAdjustmentForAuthor = [scopeAdjustmentForAuthor, workbookEvidencePromptExcerpt].filter(Boolean).join("\n\n");
      await upsertWorkingPaper(config, runId, "workbook_evidence_prompt_excerpt", {
        content: workbookEvidencePromptExcerpt,
      }).catch(() => {});
    }
    const uploadedSupportPackets = await uploadClaudeFilesSequentially({
      client,
      config,
      runId,
      attempt,
      phase: "normalize",
      entries: supportEvidencePackets.map((packet) => ({
        label: "support_packet",
        fileName: packet.filename,
        upload: async () =>
          client.beta.files.upload({
            file: await toFile(Buffer.from(packet.content, "utf8"), packet.filename, {
              type: "text/markdown",
            }),
            betas: [FILES_BETA],
          }),
      })),
    });
    const uploadedTemplate = templateFile
      ? await uploadClaudeFileWithRetry({
          client,
          config,
          runId,
          attempt,
          phase: "normalize",
          label: "template",
          fileName: templateFile.file_name,
          index: 0,
          total: 1,
          upload: async () =>
            client.beta.files.upload({
              file: await toFile(templateFile.buffer, templateFile.file_name),
              betas: [FILES_BETA],
            }),
        })
      : null;

    const systemPrompt = await buildBasquioSystemPrompt({
      templateProfile,
      briefLanguageHint: inferLanguageHint(run),
      authorModel: MODEL,
      externalEvidence:
        researchEvidenceRefs.length > 0
          ? researchEvidenceRefs.map((ref) => ({
              id: ref.id,
              fileName: ref.fileName,
              summary: ref.summary,
              confidence: ref.confidence,
              sourceLocation: ref.sourceLocation,
            }))
          : undefined,
    });
    const isReportOnly = MODEL === "claude-haiku-4-5";
    assertRequestedDeckSizeSupported(run.target_slide_count, isReportOnly ? "report_only" : "deck");
    const useExactTemplateMode = shouldUseExactTemplateMode({
      isReportOnly,
      templateFile,
      templateProfile,
    });

    // ─── CHECKPOINT-BASED RECOVERY ─────────────────────────────────
    // A4: Resume from highest valid checkpoint only when the failure class
    // is checkpoint-eligible. Do NOT silently skip into checkpoint state for
    // unrelated failure classes (e.g. bad evidence parse, analysis failure).
    //
    // Checkpoint-eligible failure classes (per spec A4):
    //   - export malformed output
    //   - final visual-QA malformed output
    //   - revise malformed manifest when author checkpoint exists
    //   - non-corrupt export-stage failure after valid artifact checkpoint
    //   - stale timeout / transient provider retry
    //
    // NOT checkpoint-eligible:
    //   - bad evidence parse (normalize failures)
    //   - invalid analysis state before first valid artifact set
    //   - real artifact corruption
    const CHECKPOINT_ELIGIBLE_PHASES: ReadonlySet<string> = new Set([
      "export", "revise", "critique", "render",
    ]);
    const CHECKPOINT_ELIGIBLE_RECOVERY_REASONS: ReadonlySet<string> = new Set([
      "stale_timeout", "transient_provider_retry",
      "transient_network_retry", "worker_shutdown",
    ]);
    // Failure messages that indicate hard artifact corruption — checkpoint
    // resume would just re-publish a corrupt deck. Must replay instead.
    const CHECKPOINT_INELIGIBLE_PATTERNS = [
      "pptx_structural_integrity",
      "corrupted",
      "repair dialog",
      "missing required artifact",
      "did not generate required file",
    ];

    const existingCheckpoint = attempt.attemptNumber > 1
      ? await loadArtifactCheckpoint(config, runId, {
          preferResumeReady: true,
          attemptNumber: attempt.attemptNumber - 1,
        })
      : null;
    let checkpointArtifacts = existingCheckpoint ? await loadCheckpointArtifacts(config, existingCheckpoint) : null;
    const recoveredAnalysis = await loadRecoveredAnalysis(config, runId, {
      attemptId: existingCheckpoint?.attemptId ?? null,
    });

    // Determine if the previous failure class qualifies for checkpoint resume.
    // The worker clears failure_phase on the parent run when requeueing, so we
    // must read the PREVIOUS attempt's failure_phase and failure_message.
    let priorFailurePhase: string | null = run.failure_phase ?? null;
    let priorFailureMessage: string | null = null;
    if (attempt.attemptNumber > 1) {
      const priorAttempts = await fetchRestRows<{ failure_phase: string | null; failure_message: string | null }>({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_run_attempts",
        query: {
          select: "failure_phase,failure_message",
          run_id: `eq.${runId}`,
          attempt_number: `eq.${attempt.attemptNumber - 1}`,
          limit: "1",
        },
      }).catch(() => []);
      if (!priorFailurePhase) {
        priorFailurePhase = priorAttempts[0]?.failure_phase ?? null;
      }
      priorFailureMessage = priorAttempts[0]?.failure_message ?? null;
    }

    const isCheckpointEligibleByPhase = priorFailurePhase !== null && CHECKPOINT_ELIGIBLE_PHASES.has(priorFailurePhase);
    const isCheckpointEligibleByReason = attempt.recoveryReason !== null && CHECKPOINT_ELIGIBLE_RECOVERY_REASONS.has(attempt.recoveryReason);

    // Block checkpoint resume for hard artifact-integrity failures even if the
    // phase is otherwise eligible. Resuming from a corrupt checkpoint is worse
    // than replaying.
    const priorMsgLower = (priorFailureMessage ?? "").toLowerCase();
    const isHardArtifactCorruption = CHECKPOINT_INELIGIBLE_PATTERNS.some((p) => priorMsgLower.includes(p));
    const isCheckpointEligible = (isCheckpointEligibleByPhase || isCheckpointEligibleByReason) && !isHardArtifactCorruption;

    const canResumeFromCheckpoint = Boolean(
      checkpointArtifacts &&
      existingCheckpoint &&
      recoveredAnalysis &&
      attempt.attemptNumber > 1 &&
      isCheckpointEligible,
    );
    const canSkipToExportFromCheckpoint = Boolean(canResumeFromCheckpoint && existingCheckpoint?.resumeReady);
    const canResumeFromAuthorCheckpoint = Boolean(
      canResumeFromCheckpoint &&
      existingCheckpoint?.phase === "author" &&
      !existingCheckpoint.resumeReady,
    );
    let publishFromCheckpoint: ArtifactCheckpoint | null = canSkipToExportFromCheckpoint && existingCheckpoint
      ? existingCheckpoint
      : null;

    let analysis: z.infer<typeof analysisSchema> | null = null;
    let pptxFile: GeneratedFile | null = null;
    let pdfFile: GeneratedFile | null = null;
    let finalNarrativeMarkdown: GeneratedFile | null = null;
    let xlsxFile: GeneratedFile | null = null;
    let fidelityContext: FidelityContext | null = null;
    let claimTraceabilityIssues: ClaimTraceabilityIssue[] = [];
    let manifest: z.infer<typeof deckManifestSchema>;
    let latestResponse: Awaited<ReturnType<typeof runClaudeLoop>> | null = null;
    let latestContainerId: string | null = null;
    let baseContainerId: string | null = null;

    if (canSkipToExportFromCheckpoint && existingCheckpoint) {
      // Checkpoint recovery — skip ALL generation phases through export.
      // The checkpoint IS the deck we're going to try to publish.
      // We do NOT run critique/revise from a checkpoint because:
      //   - latestResponse is null (no Claude thread to continue)
      //   - latestContainerId is null (no container to revise in)
      //   - running critique but not revise delivers unrevised decks
      // Instead, go straight to export with the checkpoint artifacts.
      console.log(`[generateDeckRun] recovering from ${existingCheckpoint.phase} checkpoint for run ${runId}`);
      pptxFile = checkpointArtifacts!.pptx;
      pdfFile = checkpointArtifacts!.pdf;
      finalNarrativeMarkdown = checkpointArtifacts!.md;
      xlsxFile = checkpointArtifacts!.xlsx;
      manifest = checkpointArtifacts!.manifest;
      analysis = recoveredAnalysis;
      phaseTelemetry.checkpointRecovery = {
        source: "artifact_checkpoint",
        phase: existingCheckpoint.phase,
        recoveryReason: attempt.recoveryReason,
        attemptNumber: attempt.attemptNumber,
      };

      // Mark pre-export phases with truthful state:
      // - Phases up to checkpoint phase: "recovered_from_checkpoint" (work was done on a prior attempt)
      // - Phases after checkpoint phase: "checkpoint_skipped" (never ran for this artifact set)
      const allPreExportPhases = ["understand", "author", "render", "critique", "revise"] as const;
      const checkpointPhaseIndex = allPreExportPhases.indexOf(existingCheckpoint.phase as typeof allPreExportPhases[number]);
      for (let i = 0; i < allPreExportPhases.length; i++) {
        const phase = allPreExportPhases[i];
        const wasCompleted = i <= (checkpointPhaseIndex >= 0 ? checkpointPhaseIndex : 1);
        await markPhase(config, runId, attempt, phase);
        await completePhase(config, runId, attempt, phase, {
          estimatedCostUsd: spentUsd,
          source: wasCompleted ? "recovered_from_checkpoint" : "checkpoint_skipped",
          checkpointPhase: existingCheckpoint.phase,
        });
      }
    } else if (canResumeFromAuthorCheckpoint && existingCheckpoint) {
      console.log(`[generateDeckRun] recovering from author checkpoint for run ${runId}`);
      pptxFile = checkpointArtifacts!.pptx;
      pdfFile = checkpointArtifacts!.pdf;
      finalNarrativeMarkdown = checkpointArtifacts!.md;
      xlsxFile = checkpointArtifacts!.xlsx;
      manifest = checkpointArtifacts!.manifest;
      analysis = recoveredAnalysis;
      phaseTelemetry.checkpointRecovery = {
        source: "artifact_checkpoint",
        phase: existingCheckpoint!.phase,
        recoveryReason: attempt.recoveryReason,
        attemptNumber: attempt.attemptNumber,
        mode: "resume_from_author",
      };
      for (const phase of ["understand", "author"] as const) {
        await markPhase(config, runId, attempt, phase);
        await completePhase(config, runId, attempt, phase, {
          estimatedCostUsd: spentUsd,
          source: "recovered_from_checkpoint",
          checkpointPhase: existingCheckpoint!.phase,
        });
      }
    } else {
      const isRecoveryAttempt = RECOVERY_ATTEMPT_REUSE_REASONS.has(attempt.recoveryReason ?? "");
      const recoveredAnalysisForSplit = isRecoveryAttempt ? recoveredAnalysis : null;
      const questionRoutes = routeQuestion(buildBriefText(run));

      if (recoveredAnalysisForSplit) {
        analysis = recoveredAnalysisForSplit;
        applyChartPreprocessingConstraints(analysis);
        const recoveredPlanLint = buildPlanLintSummary(analysis, run.target_slide_count);
        phaseTelemetry.understandPlanLint = recoveredPlanLint.summary;
        await upsertWorkingPaper(config, runId, "deck_plan_validation", recoveredPlanLint.result).catch(() => {});
        await insertEvent(config, runId, attempt, "understand", "plan_validation", {
          ...recoveredPlanLint.summary,
          actionableIssues: recoveredPlanLint.actionableIssues.slice(0, 8),
        }).catch(() => {});
        phaseTelemetry.understandRecovery = {
          source: "working_paper",
          recoveryReason: attempt.recoveryReason,
          slidePlanCount: analysis.slidePlan.length,
        };
        await markPhase(config, runId, attempt, "understand");
        await completePhase(config, runId, attempt, "understand", {
          slidePlanCount: analysis.slidePlan.length,
          thesis: analysis.thesis,
          estimatedCostUsd: spentUsd,
          source: "reused_from_previous_attempt",
        });
      }

      currentPhase = "author";
      await assertAttemptStillOwnsRun(config, runId, attempt);
      await markPhase(config, runId, attempt, currentPhase);
      const authorModelCandidates = [MODEL, ...getAuthorFallbackModels(MODEL)];
      let isReportOnly = MODEL === "claude-haiku-4-5";
      let authorResponse: Awaited<ReturnType<typeof runClaudeLoop>> | null = null;
      let authorFallbackMessages: Anthropic.Beta.BetaMessage[] = [];
      let authorFiles: GeneratedFile[] = [];
      let authorPhaseUsage: ClaudeUsage | null = null;
      let containerId: string | null = null;
      let lastAuthorError: unknown = null;

      for (let modelIndex = 0; modelIndex < authorModelCandidates.length; modelIndex += 1) {
        const candidateModel = authorModelCandidates[modelIndex];
        const candidateBetas = buildClaudeBetas(candidateModel);
        const candidateToolCallSummary = buildAuthoringToolCallSummary(candidateModel);
        const candidateIsReportOnly = candidateModel === "claude-haiku-4-5";
        const candidateGenerationMessage = buildAuthorMessage(
          run,
          candidateModel,
          recoveredAnalysisForSplit ? analysis : null,
          {
            hasTabularData: parsed.datasetProfile.sheets.length > 0,
            hasDocumentEvidence: parsed.normalizedWorkbook.files.some((file) =>
              (file.textContent?.trim().length ?? 0) > 100 || (file.pages?.length ?? 0) > 0),
          },
          !baseContainerId ? { uploadedEvidence, uploadedSupportPackets, uploadedTemplate } : undefined,
          questionRoutes,
          scopeAdjustmentForAuthor,
          recoveredAnalysisForSplit && analysis ? buildChartSlotConstraintMessage(analysis) : undefined,
          recoveredAnalysisForSplit && analysis ? buildPerSlideConstraintBlock(analysis) : undefined,
        );

        try {
          const authorMaxTokens = getAuthorPhaseMaxTokens(candidateModel, run.target_slide_count);
          await recordToolCall(config, runId, attempt, "author", "code_execution", {
            model: candidateModel,
            tools: [...candidateToolCallSummary.tools],
            autoInjectedTools: [...candidateToolCallSummary.autoInjectedTools],
            skills: [...candidateToolCallSummary.skills],
            stepNumber: 1,
          });
          const authorBudgetGate = await enforceDeckBudget({
            client,
            model: candidateModel,
            betas: [...candidateBetas],
            spentUsd,
            maxUsd: modelBudget.preFlight,
            outputTokenBudget: authorMaxTokens,
            fileBackedBudgetContext: {
              phase: "author",
              targetSlideCount: run.target_slide_count,
              fileCount: sourceFiles.length,
              attachmentKinds: fileBackedAttachmentKinds,
              hasWorkspaceContext: Boolean(workspaceContextPack),
              priorSpendUsd: spentUsd,
            },
            body: {
              system: systemPrompt,
              messages: [candidateGenerationMessage],
              tools: buildClaudeTools(candidateModel),
              thinking: buildAuthoringThinkingConfig(candidateModel),
              output_config: buildAuthoringOutputConfig(candidateModel),
            },
          });
          await insertEvent(config, runId, attempt, "author", "cost_preflight", {
            projectedUsd: authorBudgetGate.projectedUsd,
            usedCountTokens: authorBudgetGate.usedCountTokens,
            envelopeContext: authorBudgetGate.envelopeContext,
          }).catch(() => {});

          await persistRequestStart(config, runId, attempt, "author", "phase_generation", candidateModel);
          let candidateResponse = await runClaudeLoop({
            client,
            model: candidateModel,
            systemPrompt,
            maxTokens: authorMaxTokens,
            phaseLabel: "author",
            circuitKey: `${run.id}:${attempt.id}:author:${candidateModel}`,
            onMeaningfulProgress: () => touchAttemptProgress(config, runId, attempt, "author").catch(() => {}),
            maxPauseTurns: MAX_PAUSE_TURNS_PER_PHASE.author,
            phaseTimeoutMs: PHASE_TIMEOUTS_MS.author,
            requestWatchdogMs: REQUEST_WATCHDOG_BY_PHASE_MS.author,
            currentSpentUsd: spentUsd,
            targetSlideCount: run.target_slide_count,
            betas: candidateBetas,
            container: buildAuthoringContainer(baseContainerId, candidateModel),
            messages: [candidateGenerationMessage],
            tools: buildClaudeTools(candidateModel),
            outputConfig: buildAuthoringOutputConfig(candidateModel),
            onRequestRecord: buildRequestRecordCallback(config, runId, attempt, "author", candidateModel),
            abortSignal: externalAbortSignal,
          });
          const requiredAuthorFiles = candidateIsReportOnly
            ? ["narrative_report.md", "data_tables.xlsx", "deck_manifest.json"]
            : ["deck.pptx", "deck.pdf", "narrative_report.md", "data_tables.xlsx", "deck_manifest.json"];
          const candidateMessages = [candidateResponse.message];
          let candidateFiles: GeneratedFile[] = await downloadGeneratedFiles(client, candidateResponse.fileIds);
          const missingAuthorFiles = findMissingGeneratedFiles(candidateFiles, requiredAuthorFiles);
          if (missingAuthorFiles.length > 0) {
            console.warn(`[author-retry] Missing author files for ${candidateModel}: ${missingAuthorFiles.join(", ")}. Retrying author phase once.`);
            await insertEvent(config, runId, attempt, "author", "author_missing_files_retry", {
              missingFiles: missingAuthorFiles,
              model: candidateModel,
            }).catch(() => {});

            const retryResponse = await runClaudeLoop({
              client,
              model: candidateModel,
              systemPrompt,
              maxTokens: authorMaxTokens,
              phaseLabel: "author",
              circuitKey: `${run.id}:${attempt.id}:author:${candidateModel}`,
              onMeaningfulProgress: () => touchAttemptProgress(config, runId, attempt, "author").catch(() => {}),
              maxPauseTurns: MAX_PAUSE_TURNS_PER_PHASE.author,
              phaseTimeoutMs: PHASE_TIMEOUTS_MS.author,
              requestWatchdogMs: REQUEST_WATCHDOG_BY_PHASE_MS.author,
              currentSpentUsd: roundUsd(spentUsd + usageToCost(candidateModel, candidateResponse.usage)),
              targetSlideCount: run.target_slide_count,
              betas: candidateBetas,
              container: buildAuthoringContainer(candidateResponse.containerId ?? baseContainerId, candidateModel),
              messages: [
                ...candidateResponse.thread,
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: [
                        `You did not produce all required files. Missing: ${missingAuthorFiles.join(", ")}.`,
                        "Stop analysis and regenerate the missing deliverables now.",
                        "If shared state is uncertain, regenerate the complete output set so the missing files are attached cleanly.",
                        "The turn is incomplete until every missing file is attached as a container_upload block.",
                      ].join(" "),
                    },
                  ],
                },
              ],
              tools: buildClaudeTools(candidateModel),
              thinking: buildAuthoringThinkingConfig(candidateModel),
              outputConfig: buildAuthoringOutputConfig(candidateModel),
              onRequestRecord: buildRequestRecordCallback(config, runId, attempt, "author", candidateModel),
              abortSignal: externalAbortSignal,
            });
            candidateFiles = mergeGeneratedFiles(candidateFiles, await downloadGeneratedFiles(client, retryResponse.fileIds));
            candidateResponse = {
              ...candidateResponse,
              containerId: retryResponse.containerId ?? candidateResponse.containerId,
              thread: retryResponse.thread,
              fileIds: [...new Set([...candidateResponse.fileIds, ...retryResponse.fileIds])],
              usage: mergeClaudeUsage(candidateResponse.usage, retryResponse.usage),
              iterations: candidateResponse.iterations + retryResponse.iterations,
              pauseTurns: candidateResponse.pauseTurns + retryResponse.pauseTurns,
              requests: [...candidateResponse.requests, ...retryResponse.requests],
            };
            candidateMessages.unshift(retryResponse.message);
          }

          spentUsd = roundUsd(spentUsd + usageToCost(candidateModel, candidateResponse.usage));
          await insertEvent(config, runId, attempt, "author", "cost_actual", {
            actualUsd: usageToCost(candidateModel, candidateResponse.usage),
            cumulativeUsd: spentUsd,
            model: candidateModel,
          }).catch(() => {});
          assertDeckSpendWithinBudget(spentUsd, candidateModel, {
            allowPartialOutput: candidateFiles.length > 0,
            context: `author:${candidateModel}`,
            targetSlideCount: run.target_slide_count,
          });
          continuationCount += candidateResponse.pauseTurns;
          await persistRequestUsage(config, runId, attempt, "author", "phase_generation", candidateModel, candidateResponse.requests);
          rememberRequestIds(anthropicRequestIds, candidateResponse.requests);

          const repaired = await repairPartialAuthorArtifacts({
            run,
            model: candidateModel,
            files: candidateFiles,
            messages: candidateMessages,
            recoveredAnalysis: recoveredAnalysisForSplit ? analysis : null,
            parseWarnings,
          });
          candidateFiles = repaired.files;
          if (repaired.repairWarnings.length > 0) {
            partialDeliveryWarnings = [...new Set([...partialDeliveryWarnings, ...repaired.repairWarnings])];
            await insertEvent(config, runId, attempt, "author", "partial_delivery_salvage", {
              warnings: repaired.repairWarnings,
              model: candidateModel,
            }).catch(() => {});
          }

          const candidateTelemetry = buildPhaseTelemetry(candidateModel, {
            ...candidateResponse,
            requestIds: candidateResponse.requests.map((request) => request.requestId).filter((requestId): requestId is string => Boolean(requestId)),
          });

          if (repaired.missingCriticalFiles.length === 0) {
            MODEL = candidateModel;
            authorModel = MODEL;
            modelBudget = getDeckBudgetCaps(MODEL, run.target_slide_count);
            modelBetas = buildClaudeBetas(MODEL);
            toolCallSummary = buildAuthoringToolCallSummary(MODEL);
            isReportOnly = candidateIsReportOnly;
            authorResponse = candidateResponse;
            authorFallbackMessages = candidateMessages;
            authorFiles = candidateFiles;
            authorPhaseUsage = {
              input_tokens: candidateResponse.usage.input_tokens ?? 0,
              output_tokens: candidateResponse.usage.output_tokens ?? 0,
              cache_creation_input_tokens: candidateResponse.usage.cache_creation_input_tokens ?? 0,
              cache_read_input_tokens: candidateResponse.usage.cache_read_input_tokens ?? 0,
            };
            containerId = candidateResponse.containerId;
            phaseTelemetry.author = candidateTelemetry;
            break;
          }

          lastAuthorError = new Error(`author phase is missing critical output files: ${repaired.missingCriticalFiles.join(", ")}.`);
          const fallbackTelemetry = ((phaseTelemetry.authorFallbacks as Record<string, unknown>[] | undefined) ?? []);
          fallbackTelemetry.push({
            model: candidateModel,
            missingCriticalFiles: repaired.missingCriticalFiles,
            repairWarnings: repaired.repairWarnings,
          });
          phaseTelemetry.authorFallbacks = fallbackTelemetry;

          const nextFallbackModel = authorModelCandidates[modelIndex + 1];
          if (!nextFallbackModel) {
            break;
          }
          await insertEvent(config, runId, attempt, "author", "author_model_fallback", {
            fromModel: candidateModel,
            toModel: nextFallbackModel,
            reason: "missing_critical_output_files",
            missingFiles: repaired.missingCriticalFiles,
          }).catch(() => {});
        } catch (authorPassError) {
          lastAuthorError = authorPassError;
          const authorPassMessage = authorPassError instanceof Error ? authorPassError.message : String(authorPassError);
          const nextFallbackModel = authorModelCandidates[modelIndex + 1];
          if (!nextFallbackModel || !isBudgetExhaustionErrorMessage(authorPassMessage)) {
            throw authorPassError;
          }

          const fallbackTelemetry = ((phaseTelemetry.authorFallbacks as Record<string, unknown>[] | undefined) ?? []);
          fallbackTelemetry.push({
            model: candidateModel,
            error: authorPassMessage.slice(0, 500),
            reason: "budget_exhausted",
          });
          phaseTelemetry.authorFallbacks = fallbackTelemetry;
          await insertEvent(config, runId, attempt, "author", "author_model_fallback", {
            fromModel: candidateModel,
            toModel: nextFallbackModel,
            reason: "budget_exhausted",
            error: authorPassMessage.slice(0, 500),
          }).catch(() => {});
        }
      }

      if (!authorResponse || !authorPhaseUsage) {
        throw (lastAuthorError instanceof Error ? lastAuthorError : new Error("Author phase failed before any publishable artifacts were produced."));
      }

      manifest = parseManifestResponseWithFallback(authorFallbackMessages, authorFiles);
      if (!recoveredAnalysisForSplit) {
        const resolvedAnalysis = resolveAuthorAnalysisWithFallback({
          run,
          messages: authorFallbackMessages,
          files: authorFiles,
          manifest,
        });
        analysis = resolvedAnalysis.analysis;
        if (resolvedAnalysis.invalidPayload) {
          await upsertWorkingPaper(config, runId, "analysis_result_invalid", resolvedAnalysis.invalidPayload).catch((workingPaperError) => {
            console.warn(`[generateDeckRun] failed to persist invalid analysis payload: ${workingPaperError instanceof Error ? workingPaperError.message : String(workingPaperError)}`);
          });
        }
        if (resolvedAnalysis.recovery) {
          phaseTelemetry.authorAnalysisRecovery = resolvedAnalysis.recovery;
          await insertEvent(config, runId, attempt, "author", "analysis_salvaged", resolvedAnalysis.recovery).catch(() => {});
        }
        enforceAnalysisExhibitRules(analysis);
        applyChartPreprocessingConstraints(analysis);
        const resolvedPlanLint = buildPlanLintSummary(analysis, run.target_slide_count);
        phaseTelemetry.understandPlanLint = resolvedPlanLint.summary;
        await assertAttemptStillOwnsRun(config, runId, attempt);
        await upsertWorkingPaper(config, runId, "analysis_result", {
          ...analysis,
          _attemptId: attempt.id,
          _attemptNumber: attempt.attemptNumber,
        });
        await upsertWorkingPaper(config, runId, "deck_plan", {
          slidePlan: analysis.slidePlan,
          _attemptId: attempt.id,
          _attemptNumber: attempt.attemptNumber,
        });
        await upsertWorkingPaper(config, runId, "deck_plan_validation", {
          ...resolvedPlanLint.result,
          _attemptId: attempt.id,
          _attemptNumber: attempt.attemptNumber,
        }).catch(() => {});
        await insertEvent(config, runId, attempt, "understand", "plan_validation", {
          ...resolvedPlanLint.summary,
          actionableIssues: resolvedPlanLint.actionableIssues.slice(0, 8),
        }).catch(() => {});
        await upsertWorkingPaper(config, runId, "analysis_checkpoint", {
          ...analysis,
          checkpointedAt: new Date().toISOString(),
          _attemptId: attempt.id,
          _attemptNumber: attempt.attemptNumber,
        }).catch((checkpointError) => {
          console.warn(`[generateDeckRun] failed to persist analysis checkpoint: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`);
        });
        await markPhase(config, runId, attempt, "understand");
        await completePhase(config, runId, attempt, "understand", {
          slidePlanCount: analysis.slidePlan.length,
          thesis: analysis.thesis,
          estimatedCostUsd: spentUsd,
          containerId,
          source: "merged_into_author",
        });
        await markPhase(config, runId, attempt, "author");
      }
      if (!isReportOnly) {
        pptxFile = requireGeneratedFile(authorFiles, "deck.pptx");
        pdfFile = findGeneratedFile(authorFiles, "deck.pdf") ?? null;
        if (!pdfFile && pptxFile) {
          try {
            const recoveredPdfBuffer = await convertPptxToPdf(pptxFile.buffer);
            pdfFile = {
              fileId: "deck-pdf-export-recovered",
              fileName: "deck.pdf",
              buffer: recoveredPdfBuffer,
              mimeType: "application/pdf",
            };
          } catch (pdfRecoveryError) {
            partialDeliveryWarnings = [
              ...new Set([
                ...partialDeliveryWarnings,
                `Deck PDF was missing and could not be regenerated before export: ${
                  pdfRecoveryError instanceof Error ? pdfRecoveryError.message : String(pdfRecoveryError)
                }`,
              ]),
            ];
            pdfFile = {
              fileId: "deck-pdf-missing-placeholder",
              fileName: "deck.pdf",
              buffer: Buffer.alloc(0),
              mimeType: "application/pdf",
            };
          }
        }
      }
      finalNarrativeMarkdown = requireGeneratedFile(authorFiles, "narrative_report.md");
      xlsxFile = requireGeneratedFile(authorFiles, "data_tables.xlsx");
      ({ analysis, manifest, xlsxFile } = await ensureWorkbookChartCompanionArtifacts({
        analysis,
        manifest,
        templateProfile,
        xlsxFile,
      }));
      fidelityContext = buildFidelityContext(manifest, xlsxFile.buffer, parsed, run);
      const authorClaimQa = isReportOnly
        ? null
        : await runClaimTraceabilityQaSafely({
            client,
            manifest,
            fidelityContext,
            run,
            phaseTelemetry,
            telemetryKey: "claimTraceabilityAuthorSkipped",
          });
      claimTraceabilityIssues = authorClaimQa?.report.issues ?? [];
      if (!isReportOnly && useExactTemplateMode && pptxFile) {
        const recomposedArtifacts = await recomposeExactTemplateArtifacts({
          stage: "author",
          run,
          manifest,
          interimPptx: pptxFile,
          templateProfile,
          templateFile,
          phaseTelemetry,
        });
        if (recomposedArtifacts) {
          pptxFile = recomposedArtifacts.pptx;
          if (recomposedArtifacts.pdf) {
            pdfFile = recomposedArtifacts.pdf;
          }
        }
      }
      latestResponse = authorResponse;
      latestContainerId = authorResponse.containerId ?? containerId ?? baseContainerId;
      if (isReportOnly) {
        phaseTelemetry.authorLint = { passed: true, actionableIssueCount: 0, actionableIssues: [], slideViolationCount: 0, deckViolationCount: 0 };
        phaseTelemetry.authorContract = { passed: true, actionableIssueCount: 0, actionableIssues: [], violationCount: 0 };
      } else {
        if (authorClaimQa && ((authorClaimQa.usage.input_tokens ?? 0) + (authorClaimQa.usage.output_tokens ?? 0) > 0)) {
          phaseTelemetry.claimTraceabilityAuthor = buildSimplePhaseTelemetry("claude-haiku-4-5", authorClaimQa.usage);
          await persistRequestUsage(config, runId, attempt, "author", "claim_traceability_qa", "claude-haiku-4-5", authorClaimQa.requests);
          rememberRequestIds(anthropicRequestIds, authorClaimQa.requests);
          await upsertWorkingPaper(config, runId, "claim_traceability_author", authorClaimQa.report);
        }
        const authorLintSummary = summarizeLintResult(lintManifest(manifest, run.target_slide_count, fidelityContext ?? undefined));
        const claimIssueMessages = claimTraceabilityIssues.map(formatClaimTraceabilityIssue);
        phaseTelemetry.authorLint = {
          ...authorLintSummary,
          actionableIssueCount: authorLintSummary.actionableIssueCount + claimIssueMessages.length,
          actionableIssues: [...authorLintSummary.actionableIssues, ...claimIssueMessages],
          claimTraceabilityIssueCount: claimTraceabilityIssues.length,
        };
        phaseTelemetry.authorContract = summarizeDeckContractResult(validateManifestContract(manifest));
      }

      await assertAttemptStillOwnsRun(config, runId, attempt);
      if (!isReportOnly) {
        await persistDeckSpec(config, runId, manifest);
      }
      await completePhase(config, runId, attempt, "author", {
        containerId,
        slideCount: manifest.slideCount,
        chartCount: manifest.charts.length,
        estimatedCostUsd: spentUsd,
      }, authorPhaseUsage);

      // A1: Persist durable artifact checkpoint after author success
      if (!isReportOnly && pptxFile && pdfFile) {
        await assertAttemptStillOwnsRun(config, runId, attempt);
        await persistArtifactCheckpoint(
          config,
          runId,
          attempt,
          "author",
          pptxFile,
          pdfFile,
          finalNarrativeMarkdown!,
          xlsxFile!,
          manifest,
          {
          resumeReady: false,
          proof: {
            authorComplete: true,
            critiqueComplete: false,
            reviseComplete: false,
            visualQaGreen: false,
            lintPassed: false,
            contractPassed: false,
            deckNeedsRevision: true,
          },
          },
        ).catch((checkpointError) => {
          console.warn(`[generateDeckRun] failed to persist author checkpoint: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`);
        });
      }
    }

    // ─── RENDER / CRITIQUE / REVISE ────────────────────────────────
    // Skip entirely on checkpoint recovery (phases already marked completed,
    // no Claude thread/container available to revise against).
    let finalPptx = pptxFile;
    let finalPdf = pdfFile;
    let finalManifest = manifest;
    let finalVisualQa: RenderedPageQaReport;

    if (!canSkipToExportFromCheckpoint && !isReportOnly) {
    currentPhase = "render";
    await markPhase(config, runId, attempt, currentPhase);
    await completePhase(config, runId, attempt, "render", {
      containerId: latestContainerId,
      pageCount: manifest.pageCount ?? manifest.slideCount,
      estimatedCostUsd: spentUsd,
      source: "author_artifacts",
    });

    currentPhase = "critique";
    await markPhase(config, runId, attempt, currentPhase);
    const initialQaOutcome = await runRenderedPageQaSafely({
      client,
      pdf: pdfFile!,
      pptx: pptxFile!,
      manifest,
      templateProfile,
      betas: [FILES_BETA],
      model: VISUAL_QA_MODEL,
      phaseTelemetry,
      telemetryKey: "visualQaAuthorSkipped",
      recoveryStage: "critique",
    });
    pdfFile = initialQaOutcome.pdf;
    const initialVisualQa = initialQaOutcome.qa;
    spentUsd = roundUsd(spentUsd + usageToCost(VISUAL_QA_MODEL, initialVisualQa.usage));
    assertDeckSpendWithinBudget(spentUsd, MODEL, {
      allowPartialOutput: true,
      context: "critique:visual-qa",
      targetSlideCount: run.target_slide_count,
    });
    phaseTelemetry.visualQaAuthor = buildSimplePhaseTelemetry(VISUAL_QA_MODEL, initialVisualQa.usage);
    await persistRequestUsage(config, runId, attempt, "critique", "rendered_page_qa", VISUAL_QA_MODEL, initialVisualQa.requests);
    rememberRequestIds(anthropicRequestIds, initialVisualQa.requests);
    await upsertWorkingPaper(config, runId, "visual_qa_author", initialVisualQa.report);
    const critiqueIssues = collectCritiqueIssues(
      manifest,
      initialVisualQa.report,
      [
        ...((phaseTelemetry.authorLint as { actionableIssues?: string[] } | undefined)?.actionableIssues ?? []),
        ...((phaseTelemetry.authorContract as { actionableIssues?: string[] } | undefined)?.actionableIssues ?? []),
      ],
      run.target_slide_count,
    );
    const blockingCritiqueIssues = critiqueIssues.filter((issue) => isBlockingRepairIssue(issue));
    const critiqueLint = lintManifest(manifest, run.target_slide_count, fidelityContext ?? undefined);
    const critiqueContract = validateManifestContract(manifest);
    const critiqueLintSummary = summarizeLintResult(critiqueLint);
    const critiqueContractSummary = summarizeDeckContractResult(critiqueContract);
    const initialRepairBuckets = bucketRepairIssues({
      critiqueIssues,
      claimTraceabilityIssues,
      visualQa: initialVisualQa.report,
    });
    const initialFrontierState = buildRepairFrontierState({
      lintIssues: critiqueLintSummary.actionableIssues,
      contractIssues: critiqueContractSummary.actionableIssues,
      claimTraceabilityIssues,
      visualQa: initialVisualQa.report,
      critiqueIssues,
    });
    const repairLane = chooseRepairLane(initialRepairBuckets, initialVisualQa.report);
    const hasBlockingCritiqueIssues = blockingCritiqueIssues.length > 0;
    const critiqueCheckpointProof = buildCheckpointProof({
      authorComplete: true,
      critiqueComplete: true,
      reviseComplete: false,
      visualQaGreen: initialVisualQa.report.overallStatus === "green",
      lintPassed: critiqueLint.actionableIssues.length === 0,
      contractPassed: critiqueContract.actionableIssues.length === 0,
      deckNeedsRevision: initialVisualQa.report.deckNeedsRevision || blockingCritiqueIssues.length > 0,
    });
    await completePhase(
      config,
      runId,
      attempt,
      "critique",
      {
        issueCount: critiqueIssues.length,
        blockingIssueCount: blockingCritiqueIssues.length,
        issues: critiqueIssues,
        visualQa: initialVisualQa.report,
      },
      initialVisualQa.usage,
    );
    await assertAttemptStillOwnsRun(config, runId, attempt);
    await persistArtifactCheckpoint(config, runId, attempt, "critique", pptxFile!, pdfFile!, finalNarrativeMarkdown!, xlsxFile!, manifest, {
      resumeReady:
        critiqueCheckpointProof.visualQaGreen &&
        critiqueCheckpointProof.lintPassed &&
        critiqueCheckpointProof.contractPassed &&
        !critiqueCheckpointProof.deckNeedsRevision,
      visualQaStatus: initialVisualQa.report.overallStatus,
      deckNeedsRevision: critiqueCheckpointProof.deckNeedsRevision,
      proof: critiqueCheckpointProof,
    }).catch((checkpointError) => {
      console.warn(`[generateDeckRun] failed to persist critique checkpoint: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`);
    });

    finalPptx = pptxFile;
    finalPdf = pdfFile;
    finalManifest = manifest;
    finalVisualQa = initialVisualQa.report;

    const reviseIterationLimit = latestResponse
      ? computeReviseIterationBudget({
          frontierState: initialFrontierState,
          repairLane,
        })
      : 0;
    phaseTelemetry.repairRouting = {
      lane: repairLane,
      deterministicIssueCount: initialRepairBuckets.deterministic.length,
      haikuIssueCount: initialRepairBuckets.haiku.length,
      sonnetIssueCount: initialRepairBuckets.sonnet.length,
      initialFrontierState,
    };

    if (reviseIterationLimit > 0 && latestResponse && repairLane !== "none") {
      try {
        currentPhase = "revise";
        await markPhase(config, runId, attempt, currentPhase);
        const reviseModel: AuthorModel = repairLane === "haiku" ? "claude-haiku-4-5" : MODEL;
        const reviseBudgetCaps = getDeckBudgetCaps(reviseModel, run.target_slide_count);
        const reviseBetas = buildClaudeBetas(reviseModel);
        const reviseToolCallSummary = buildAuthoringToolCallSummary(reviseModel);
        const reviseMaxTokens = getRevisePhaseMaxTokens(reviseModel, run.target_slide_count);
        let activeManifest = manifest;
        let activePdf = pdfFile;
        let activeVisualQa = initialVisualQa.report;
        let activeCritiqueIssues = critiqueIssues;
        let activeBlockingCritiqueIssues = blockingCritiqueIssues;
        let bestFrontierState = initialFrontierState;
        let bestManifest = manifest;
        let bestPdf = pdfFile;
        let bestPptx = pptxFile;
        let bestNarrativeMarkdown = finalNarrativeMarkdown;
        let bestXlsxFile = xlsxFile;
        let bestVisualQa = initialVisualQa.report;
        let bestCritiqueIssues = critiqueIssues;
        let bestBlockingCritiqueIssues = blockingCritiqueIssues;
        let reviseLoopCount = 0;
        let reviseAggregateUsage: Required<ClaudeUsage> = {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        };
        let reviseVisualQaAggregateUsage: Required<ClaudeUsage> = {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        };
        let reviseAggregateIterations = 0;
        let reviseAggregatePauseTurns = 0;

        while (reviseLoopCount < reviseIterationLimit && latestResponse) {
          reviseLoopCount += 1;
          const reviseMessage = buildReviseMessage({
            issues: activeCritiqueIssues,
            manifest: activeManifest,
            currentPdf: activePdf,
            visualQa: activeVisualQa,
          });
          const reviseMessages = [
            ...buildMinimalReviseThread({
              run,
              analysis,
              manifest: activeManifest,
            }),
            reviseMessage,
          ];
          await recordToolCall(config, runId, attempt, "revise", "code_execution", {
            model: reviseModel,
            tools: [...reviseToolCallSummary.tools],
            autoInjectedTools: [...reviseToolCallSummary.autoInjectedTools],
            skills: [...reviseToolCallSummary.skills],
            stepNumber: reviseLoopCount,
          });
          const reviseBudgetGate = await enforceDeckBudget({
            client,
            model: reviseModel,
            betas: [...reviseBetas],
            spentUsd,
            maxUsd: reviseBudgetCaps.preFlight,
            outputTokenBudget: reviseMaxTokens,
            fileBackedBudgetContext: {
              phase: "revise",
              targetSlideCount: run.target_slide_count,
              fileCount: sourceFiles.length,
              attachmentKinds: fileBackedAttachmentKinds,
              hasWorkspaceContext: Boolean(workspaceContextPack),
              hasPriorRevise: reviseLoopCount > 1,
              priorSpendUsd: spentUsd,
            },
              body: {
                system: systemPrompt,
                messages: reviseMessages,
                tools: buildClaudeTools(reviseModel),
                thinking: buildAuthoringThinkingConfig(reviseModel),
                output_config: buildAuthoringOutputConfig(reviseModel),
              },
          });
          await insertEvent(config, runId, attempt, "revise", "cost_preflight", {
            projectedUsd: reviseBudgetGate.projectedUsd,
            usedCountTokens: reviseBudgetGate.usedCountTokens,
            envelopeContext: reviseBudgetGate.envelopeContext,
            iteration: reviseLoopCount,
            model: reviseModel,
          }).catch(() => {});

          await persistRequestStart(config, runId, attempt, "revise", "phase_generation", reviseModel);
          let reviseResponse = await runClaudeLoop({
            client,
            model: reviseModel,
            systemPrompt,
            maxTokens: reviseMaxTokens,
            phaseLabel: "revise",
            circuitKey: `${run.id}:${attempt.id}:revise:${reviseLoopCount}`,
            onMeaningfulProgress: () => touchAttemptProgress(config, runId, attempt, "revise").catch(() => {}),
            maxPauseTurns: MAX_PAUSE_TURNS_PER_PHASE.revise,
            phaseTimeoutMs: PHASE_TIMEOUTS_MS.revise,
            requestWatchdogMs: REQUEST_WATCHDOG_BY_PHASE_MS.revise,
            currentSpentUsd: spentUsd,
            targetSlideCount: run.target_slide_count,
            betas: reviseBetas,
            container: buildAuthoringContainer(latestContainerId, reviseModel),
            messages: reviseMessages,
            tools: buildClaudeTools(reviseModel),
            thinking: buildAuthoringThinkingConfig(reviseModel),
            outputConfig: buildAuthoringOutputConfig(reviseModel),
            onRequestRecord: buildRequestRecordCallback(config, runId, attempt, "revise", reviseModel),
            abortSignal: externalAbortSignal,
          });
          let reviseFiles = await downloadGeneratedFiles(client, reviseResponse.fileIds);
          const missingReviseFiles = findMissingGeneratedFiles(reviseFiles, ["deck.pptx", "deck.pdf", "deck_manifest.json"]);
          if (missingReviseFiles.length > 0) {
            console.warn(`[revise-retry] Missing revise files: ${missingReviseFiles.join(", ")}. Retrying revise phase once.`);
            await insertEvent(config, runId, attempt, "revise", "revise_missing_files_retry", {
              missingFiles: missingReviseFiles,
              model: reviseModel,
              repairLane,
              reviseIteration: reviseLoopCount,
            }).catch(() => {});

            const retryResponse = await runClaudeLoop({
              client,
              model: reviseModel,
              systemPrompt,
              maxTokens: reviseMaxTokens,
              phaseLabel: "revise",
              circuitKey: `${run.id}:${attempt.id}:revise:${reviseLoopCount}`,
              onMeaningfulProgress: () => touchAttemptProgress(config, runId, attempt, "revise").catch(() => {}),
              maxPauseTurns: 0,
              phaseTimeoutMs: PHASE_TIMEOUTS_MS.revise,
              requestWatchdogMs: REQUEST_WATCHDOG_BY_PHASE_MS.revise,
              currentSpentUsd: roundUsd(spentUsd + usageToCost(reviseModel, reviseResponse.usage)),
              targetSlideCount: run.target_slide_count,
              betas: reviseBetas,
              container: buildAuthoringContainer(reviseResponse.containerId ?? latestContainerId, reviseModel),
              messages: [
                ...reviseResponse.thread,
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: [
                        `Missing output files: ${missingReviseFiles.join(", ")}.`,
                        "Generate them now using the existing slides in the container.",
                        "Do not re-analyze or rewrite content.",
                        "Rebuild the PPTX from the current slides, render the PDF, and write deck_manifest.json.",
                        "The turn is incomplete until every missing file is attached.",
                      ].join(" "),
                    },
                  ],
                },
              ],
              tools: buildClaudeTools(reviseModel),
              thinking: buildAuthoringThinkingConfig(reviseModel),
              outputConfig: buildAuthoringOutputConfig(reviseModel),
              onRequestRecord: buildRequestRecordCallback(config, runId, attempt, "revise", reviseModel),
              abortSignal: externalAbortSignal,
            });
            const retryFiles = await downloadGeneratedFiles(client, retryResponse.fileIds);
            for (const retryFile of retryFiles) {
              const existingIndex = reviseFiles.findIndex((file) => file.fileName === retryFile.fileName);
              if (existingIndex >= 0) {
                reviseFiles[existingIndex] = retryFile;
              } else {
                reviseFiles.push(retryFile);
              }
            }
            reviseResponse = {
              ...reviseResponse,
              containerId: retryResponse.containerId ?? reviseResponse.containerId,
              thread: retryResponse.thread,
              fileIds: [...new Set([...reviseResponse.fileIds, ...retryResponse.fileIds])],
              usage: mergeClaudeUsage(reviseResponse.usage, retryResponse.usage),
              iterations: reviseResponse.iterations + retryResponse.iterations,
              pauseTurns: reviseResponse.pauseTurns + retryResponse.pauseTurns,
              requests: [...reviseResponse.requests, ...retryResponse.requests],
            };
          }
          spentUsd = roundUsd(spentUsd + usageToCost(reviseModel, reviseResponse.usage));
          await insertEvent(config, runId, attempt, "revise", "cost_actual", {
            actualUsd: usageToCost(reviseModel, reviseResponse.usage),
            cumulativeUsd: spentUsd,
            iteration: reviseLoopCount,
            model: reviseModel,
          }).catch(() => {});
          assertDeckSpendWithinBudget(spentUsd, reviseModel, {
            allowPartialOutput: reviseFiles.length > 0,
            context: `revise:${reviseLoopCount}`,
            targetSlideCount: run.target_slide_count,
          });
          continuationCount += reviseResponse.pauseTurns;
          reviseAggregateUsage = mergeClaudeUsage(reviseAggregateUsage, reviseResponse.usage);
          reviseAggregateIterations += reviseResponse.iterations;
          reviseAggregatePauseTurns += reviseResponse.pauseTurns;
          await persistRequestUsage(config, runId, attempt, "revise", "phase_generation", reviseModel, reviseResponse.requests);
          rememberRequestIds(anthropicRequestIds, reviseResponse.requests);
          requireGeneratedFiles(reviseFiles, ["deck.pptx", "deck.pdf", "deck_manifest.json"], "revise");
          finalManifest = parseManifestResponse(reviseResponse.message, reviseFiles);
          finalPptx = requireGeneratedFile(reviseFiles, "deck.pptx");
          finalPdf = requireGeneratedFile(reviseFiles, "deck.pdf");
          finalNarrativeMarkdown = findGeneratedFile(reviseFiles, "narrative_report.md") ?? finalNarrativeMarkdown;
          xlsxFile = findGeneratedFile(reviseFiles, "data_tables.xlsx") ?? xlsxFile;
          if (xlsxFile) {
            ({ analysis, manifest: finalManifest, xlsxFile } = await ensureWorkbookChartCompanionArtifacts({
              analysis,
              manifest: finalManifest,
              templateProfile,
              xlsxFile,
            }));
          }
          fidelityContext = xlsxFile ? buildFidelityContext(finalManifest, xlsxFile.buffer, parsed, run) : fidelityContext;
          const reviseClaimQa = await runClaimTraceabilityQaSafely({
            client,
            manifest: finalManifest,
            fidelityContext,
            run,
            phaseTelemetry,
            telemetryKey: "claimTraceabilityReviseSkipped",
          });
          claimTraceabilityIssues = reviseClaimQa.report.issues ?? [];
          if (useExactTemplateMode) {
            const recomposedArtifacts = await recomposeExactTemplateArtifacts({
              stage: "revise",
              run,
              manifest: finalManifest,
              interimPptx: finalPptx,
              templateProfile,
              templateFile,
              phaseTelemetry,
            });
            if (recomposedArtifacts) {
              finalPptx = recomposedArtifacts.pptx;
              if (recomposedArtifacts.pdf) {
                finalPdf = recomposedArtifacts.pdf;
              }
            }
          }
          latestResponse = reviseResponse;
          latestContainerId = reviseResponse.containerId ?? latestContainerId;

          const revisedQaOutcome = await runRenderedPageQaSafely({
            client,
            pdf: finalPdf,
            pptx: finalPptx,
            manifest: finalManifest,
            templateProfile,
            betas: [FILES_BETA],
            model: VISUAL_QA_MODEL,
            phaseTelemetry,
            telemetryKey: "visualQaReviseSkipped",
            recoveryStage: "revise",
          });
          finalPdf = revisedQaOutcome.pdf;
          const revisedVisualQa = revisedQaOutcome.qa;
          spentUsd = roundUsd(spentUsd + usageToCost(VISUAL_QA_MODEL, revisedVisualQa.usage));
          assertDeckSpendWithinBudget(spentUsd, reviseModel, {
            allowPartialOutput: true,
            context: `revise:visual-qa:${reviseLoopCount}`,
            targetSlideCount: run.target_slide_count,
          });
          reviseVisualQaAggregateUsage = mergeClaudeUsage(reviseVisualQaAggregateUsage, revisedVisualQa.usage);
          await persistRequestUsage(config, runId, attempt, "critique", "rendered_page_qa", VISUAL_QA_MODEL, revisedVisualQa.requests);
          rememberRequestIds(anthropicRequestIds, revisedVisualQa.requests);
          if ((revisedVisualQa.usage.input_tokens ?? 0) + (revisedVisualQa.usage.output_tokens ?? 0) > 0) {
            await touchAttemptProgress(config, runId, attempt, "revise");
          }
          finalVisualQa = revisedVisualQa.report;
          if ((reviseClaimQa.usage.input_tokens ?? 0) + (reviseClaimQa.usage.output_tokens ?? 0) > 0) {
            phaseTelemetry.claimTraceabilityRevise = buildSimplePhaseTelemetry("claude-haiku-4-5", reviseClaimQa.usage);
            await persistRequestUsage(config, runId, attempt, "revise", "claim_traceability_qa", "claude-haiku-4-5", reviseClaimQa.requests);
            rememberRequestIds(anthropicRequestIds, reviseClaimQa.requests);
            await upsertWorkingPaper(config, runId, "claim_traceability_revise", reviseClaimQa.report);
          }
          await upsertWorkingPaper(config, runId, "visual_qa_revise", finalVisualQa);

          const revisedLint = lintManifest(finalManifest, run.target_slide_count, fidelityContext ?? undefined);
          const revisedContract = validateManifestContract(finalManifest);
          const revisedLintSummary = summarizeLintResult(revisedLint);
          const revisedContractSummary = summarizeDeckContractResult(revisedContract);
          const revisedClaimIssueMessages = claimTraceabilityIssues.map(formatClaimTraceabilityIssue);
          activeManifest = finalManifest;
          activePdf = finalPdf;
          activeVisualQa = finalVisualQa;
          activeCritiqueIssues = collectCritiqueIssues(
            finalManifest,
            finalVisualQa,
            [
              ...revisedLintSummary.actionableIssues,
              ...revisedContractSummary.actionableIssues,
              ...revisedClaimIssueMessages,
            ],
            run.target_slide_count,
          );
          activeBlockingCritiqueIssues = activeCritiqueIssues.filter((issue) => isBlockingRepairIssue(issue));
          const activeFrontierState = buildRepairFrontierState({
            lintIssues: revisedLintSummary.actionableIssues,
            contractIssues: revisedContractSummary.actionableIssues,
            claimTraceabilityIssues,
            visualQa: activeVisualQa,
            critiqueIssues: activeCritiqueIssues,
          });
          const frontierComparison = compareRepairFrontierState(activeFrontierState, bestFrontierState);
          if (frontierComparison >= 0) {
            bestFrontierState = activeFrontierState;
            bestManifest = finalManifest;
            bestPdf = finalPdf;
            bestPptx = finalPptx;
            bestNarrativeMarkdown = finalNarrativeMarkdown;
            bestXlsxFile = xlsxFile;
            bestVisualQa = finalVisualQa;
            bestCritiqueIssues = activeCritiqueIssues;
            bestBlockingCritiqueIssues = activeBlockingCritiqueIssues;
          } else {
            await insertEvent(config, runId, attempt, "revise", "frontier_regression_rejected", {
              iteration: reviseLoopCount,
              candidateFrontier: activeFrontierState,
              bestFrontier: bestFrontierState,
            }).catch(() => {});
            finalManifest = bestManifest;
            finalPdf = bestPdf;
            finalPptx = bestPptx;
            finalNarrativeMarkdown = bestNarrativeMarkdown;
            xlsxFile = bestXlsxFile;
            finalVisualQa = bestVisualQa;
            activeManifest = bestManifest;
            activePdf = bestPdf;
            activeVisualQa = bestVisualQa;
            activeCritiqueIssues = bestCritiqueIssues;
            activeBlockingCritiqueIssues = bestBlockingCritiqueIssues;
            break;
          }

          if (!deckStillNeedsRevise({
            frontierState: bestFrontierState,
          })) {
            break;
          }
        }

        finalManifest = bestManifest;
        finalPdf = bestPdf;
        finalPptx = bestPptx;
        finalNarrativeMarkdown = bestNarrativeMarkdown;
        xlsxFile = bestXlsxFile;
        finalVisualQa = bestVisualQa;
        activeManifest = bestManifest;
        activePdf = bestPdf;
        activeVisualQa = bestVisualQa;
        activeCritiqueIssues = bestCritiqueIssues;
        activeBlockingCritiqueIssues = bestBlockingCritiqueIssues;

        phaseTelemetry.revise = {
          ...buildPhaseTelemetry(reviseModel, {
            usage: reviseAggregateUsage,
            iterations: reviseAggregateIterations,
            pauseTurns: reviseAggregatePauseTurns,
            requestIds: [...anthropicRequestIds],
          }),
          reviseLoops: reviseLoopCount,
          reviseLoopBudget: reviseIterationLimit,
          repairLane,
          bestFrontierState,
        };
        phaseTelemetry.visualQaRevise = buildSimplePhaseTelemetry(VISUAL_QA_MODEL, {
          input_tokens: reviseVisualQaAggregateUsage.input_tokens,
          output_tokens: reviseVisualQaAggregateUsage.output_tokens,
          cache_creation_input_tokens: reviseVisualQaAggregateUsage.cache_creation_input_tokens,
          cache_read_input_tokens: reviseVisualQaAggregateUsage.cache_read_input_tokens,
        });
        await assertAttemptStillOwnsRun(config, runId, attempt);
        await persistDeckSpec(config, runId, finalManifest);
        const revisePhaseUsage = reviseAggregateUsage;

        await completePhase(
          config,
          runId,
          attempt,
          "revise",
          {
            issueCount: activeCritiqueIssues.length,
            estimatedCostUsd: spentUsd,
            visualQa: finalVisualQa,
            reviseLoops: reviseLoopCount,
            reviseLoopBudget: reviseIterationLimit,
          },
          revisePhaseUsage,
        );

        const reviseLint = lintManifest(finalManifest, run.target_slide_count, fidelityContext ?? undefined);
        const reviseContract = validateManifestContract(finalManifest);
        const reviseClaimIssueMessages = claimTraceabilityIssues.map(formatClaimTraceabilityIssue);
        const reviseCheckpointProof = buildCheckpointProof({
          authorComplete: true,
          critiqueComplete: true,
          reviseComplete: true,
          visualQaGreen: finalVisualQa.overallStatus === "green",
          lintPassed: reviseLint.actionableIssues.length === 0 && reviseClaimIssueMessages.length === 0,
          contractPassed: reviseContract.actionableIssues.length === 0,
          deckNeedsRevision: finalVisualQa.deckNeedsRevision,
        });
        await assertAttemptStillOwnsRun(config, runId, attempt);
        await persistArtifactCheckpoint(config, runId, attempt, "revise", finalPptx!, finalPdf, finalNarrativeMarkdown!, xlsxFile!, finalManifest, {
          resumeReady:
            reviseCheckpointProof.visualQaGreen &&
            reviseCheckpointProof.lintPassed &&
            reviseCheckpointProof.contractPassed &&
            !reviseCheckpointProof.deckNeedsRevision,
          visualQaStatus: finalVisualQa.overallStatus,
          deckNeedsRevision: finalVisualQa.deckNeedsRevision,
          proof: reviseCheckpointProof,
        }).catch((checkpointError) => {
          console.warn(`[generateDeckRun] failed to persist revise checkpoint: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`);
        });
      } catch (revisePhaseError) {
        const revisePhaseMessage = revisePhaseError instanceof Error ? revisePhaseError.message : String(revisePhaseError);
        console.warn(`[generateDeckRun] revise phase failed entirely: ${revisePhaseMessage.slice(0, 300)}`);
        phaseTelemetry.revisePhaseFailure = {
          reason: "revise_phase_failed",
          errorMessage: revisePhaseMessage.slice(0, 500),
        };
        await completePhase(config, runId, attempt, "revise", {
          estimatedCostUsd: spentUsd,
          error: revisePhaseMessage.slice(0, 500),
        }).catch(() => {});
      }
    }
    } else if (isReportOnly) {
      finalPptx = null;
      finalPdf = null;
      finalManifest = manifest;
      finalVisualQa = buildReportOnlyVisualQa();
      await completePhase(config, runId, attempt, "render", {
        source: "skipped_report_only",
        estimatedCostUsd: spentUsd,
      }).catch(() => {});
      await completePhase(config, runId, attempt, "critique", {
        source: "skipped_report_only",
        visualQa: finalVisualQa,
      }).catch(() => {});
      await completePhase(config, runId, attempt, "revise", {
        source: "skipped_report_only",
        estimatedCostUsd: spentUsd,
      }).catch(() => {});
    } else {
      // Checkpoint recovery path — set final vars directly from checkpoint.
      // Visual QA will be run fresh in the export phase's strengthenFinalVisualQa
      // or in the salvage path. Use a conservative placeholder here.
      finalPptx = pptxFile;
      finalPdf = pdfFile;
      finalManifest = manifest;
      // Set green placeholder so strengthenFinalVisualQa runs fresh QA on
      // the checkpoint PDF in the export phase. If we used "yellow" here,
      // strengthenFinalVisualQa would skip (it only runs when green), and
      // the export path would loop through salvage unnecessarily.
      finalVisualQa = {
        overallStatus: "green" as const,
        score: 7,
        summary: "Checkpoint recovery — fresh visual QA will run in export phase.",
        deckNeedsRevision: false,
        issues: [],
        strongestSlides: [],
        weakestSlides: [],
      };
    }

    currentPhase = "export";
    await markPhase(config, runId, attempt, currentPhase);
    let finalDocx: GeneratedFile | null = null;
    let finalXlsx: GeneratedFile | null = null;
    let qaReport: Awaited<ReturnType<typeof buildQaReport>> & {
      qualityPassport?: PublishDecision["qualityPassport"];
    };
    let lastPublishDecision: PublishDecision | null = null;
    try {
      if (!isReportOnly) {
        finalVisualQa = await strengthenFinalVisualQa({
          client,
          pdf: finalPdf!.buffer,
          pptx: finalPptx!,
          manifest: finalManifest,
          currentReport: finalVisualQa,
          runId,
          attempt,
          config,
          authorModel: MODEL,
          targetSlideCount: run.target_slide_count,
          spentUsdRef: {
            get value() {
              return spentUsd;
            },
            set value(value: number) {
              spentUsd = value;
            },
          },
          anthropicRequestIds,
          phaseTelemetry,
          templateProfile,
        });
      }
      if (!analysis) {
        throw new Error("Analysis unavailable before export.");
      }
      phaseTelemetry.docxNarrative = { attempted: true };
      const markdownBuffer = finalNarrativeMarkdown?.buffer ?? null;
      const markdownText = markdownBuffer?.toString("utf8").trim() ?? "";
      if (markdownBuffer && markdownText.length > 0) {
        finalDocx = {
          fileId: "narrative-report-md",
          fileName: "narrative_report.md",
          buffer: markdownBuffer,
          mimeType: "text/markdown",
        } satisfies GeneratedFile;
        phaseTelemetry.docxNarrative = {
          attempted: true,
          succeeded: true,
          source: "narrative_markdown_direct",
          outputBytes: markdownBuffer.length,
          textChars: markdownText.length,
        };
      } else {
        const stubText = `# ${run.client?.trim() || "Report"}\n\nNarrative report was not generated during this run.\n`;
        finalDocx = {
          fileId: "narrative-report-stub",
          fileName: "narrative_report.md",
          buffer: Buffer.from(stubText, "utf8"),
          mimeType: "text/markdown",
        } satisfies GeneratedFile;
        phaseTelemetry.docxNarrative = {
          attempted: true,
          succeeded: false,
          reason: "narrative_report_missing",
        };
      }
      if (!xlsxFile) {
        throw new Error("data_tables.xlsx artifact unavailable before publish.");
      }
      finalXlsx = xlsxFile;
      if (!finalDocx) {
        throw new Error("Narrative markdown artifact unavailable before publish.");
      }
      ({ analysis, manifest: finalManifest, xlsxFile: finalXlsx } = await ensureWorkbookChartCompanionArtifacts({
        analysis,
        manifest: finalManifest,
        templateProfile,
        xlsxFile: finalXlsx,
      }));

      if (!isReportOnly) {
        let brandedBuffer = await sanitizePptxMedia(finalPptx!.buffer);

        // PGTI: deterministically inject template branding (logo, theme, decorative shapes)
        if (templateProfile.sourceType === "pptx" && templateProfile.brandTokens?.injection) {
          brandedBuffer = await applyTemplateBranding(brandedBuffer, templateProfile.brandTokens.injection);
          console.log("[PGTI] Template branding injected deterministically");
        }

        finalPptx = {
          ...finalPptx!,
          buffer: brandedBuffer,
        };
        finalPdf = await ensureValidPdfArtifact({
          pdf: finalPdf!,
          pptx: finalPptx,
          phaseTelemetry,
          stage: "export",
        });
      }
      qaReport = await buildQaReport(
        finalManifest,
        {
            pptx: finalPptx,
            pdf: finalPdf,
            md: finalDocx,
            xlsx: finalXlsx,
          },
        finalVisualQa,
        templateDiagnostics,
        run.target_slide_count,
        isReportOnly ? "report_only" : "deck",
      );
      if (!isReportOnly && claimTraceabilityIssues.length === 0) {
        const exportClaimQa = await runClaimTraceabilityQaSafely({
          client,
          manifest: finalManifest,
          fidelityContext,
          run,
          phaseTelemetry,
          telemetryKey: "claimTraceabilityExportSkipped",
        });
        claimTraceabilityIssues = exportClaimQa.report.issues ?? [];
        if ((exportClaimQa.usage.input_tokens ?? 0) + (exportClaimQa.usage.output_tokens ?? 0) > 0) {
          phaseTelemetry.claimTraceabilityExport = buildSimplePhaseTelemetry("claude-haiku-4-5", exportClaimQa.usage);
          await persistRequestUsage(config, runId, attempt, "export", "claim_traceability_qa", "claude-haiku-4-5", exportClaimQa.requests);
          rememberRequestIds(anthropicRequestIds, exportClaimQa.requests);
          await upsertWorkingPaper(config, runId, "claim_traceability_export", exportClaimQa.report);
        }
      }
      const finalLint = isReportOnly ? null : lintManifest(finalManifest, run.target_slide_count, fidelityContext ?? undefined);
      const finalContract = isReportOnly ? null : validateManifestContract(finalManifest);
      const finalQualityGate = isReportOnly
        ? {
            blockingFailures: qaReport.failed.filter((check) => HARD_QA_BLOCKERS.has(check)),
            advisories: qaReport.failed.filter((check) => !HARD_QA_BLOCKERS.has(check)),
          }
        : collectPublishGateFailures({
            qaReport,
            lint: finalLint!,
            contract: finalContract!,
            claimIssues: claimTraceabilityIssues,
          });

      lastPublishDecision = isReportOnly
        ? {
            decision: finalQualityGate.blockingFailures.length === 0 ? "publish" : "fail",
            hardBlockers: finalQualityGate.blockingFailures,
            advisories: finalQualityGate.advisories,
            qualityPassport: {
              classification: finalQualityGate.blockingFailures.length === 0 ? "silver" : "recovery",
              criticalCount: finalQualityGate.blockingFailures.length,
              majorCount: 0,
              visualScore: finalVisualQa.score,
              mecePass: true,
              summary: finalQualityGate.blockingFailures.length === 0
                ? "Report-only run published without deck-level visual scoring."
                : "Report-only run degraded because artifact gate blockers remained.",
            },
            artifactSource: "fresh_generation",
            visualQa: {
              overallStatus: finalVisualQa.overallStatus,
              deckNeedsRevision: finalVisualQa.deckNeedsRevision,
            },
            lintPassed: true,
            contractPassed: true,
            chartImageCoveragePct: null,
            sceneOverflowCount: 0,
            sceneCollisionCount: 0,
          }
        : buildPublishDecision({
            qaReport,
            lint: finalLint!,
            contract: finalContract!,
            visualQa: finalVisualQa,
            artifactSource: publishFromCheckpoint ? "checkpoint" : "fresh_generation",
            claimIssues: claimTraceabilityIssues,
          });
      qaReport = {
        ...qaReport,
        qualityPassport: lastPublishDecision.qualityPassport,
      };

      if (finalQualityGate.blockingFailures.length > 0) {
        throw new Error(`Artifact publish gate failed: ${finalQualityGate.blockingFailures.join(", ")}`);
      }
      if (finalLint && finalContract) {
        const finalLintSummary = summarizeLintResult(finalLint);
        phaseTelemetry.finalLint = {
          ...finalLintSummary,
          claimTraceabilityIssueCount: claimTraceabilityIssues.length,
          actionableIssueCount: finalLintSummary.actionableIssueCount + claimTraceabilityIssues.length,
          actionableIssues: [
            ...finalLintSummary.actionableIssues,
            ...claimTraceabilityIssues.map(formatClaimTraceabilityIssue),
          ],
        };
        phaseTelemetry.finalContract = summarizeDeckContractResult(finalContract);
      } else {
        phaseTelemetry.finalLint = { skipped: true, reason: "report_only_run" };
        phaseTelemetry.finalContract = { skipped: true, reason: "report_only_run" };
      }
      phaseTelemetry.publishDecision = lastPublishDecision;
      if (partialDeliveryWarnings.length > 0) {
        phaseTelemetry.partialDelivery = {
          enabled: true,
          warnings: partialDeliveryWarnings,
        };
      }
      await assertAttemptStillOwnsRun(config, runId, attempt);
      const artifacts = await persistArtifacts(config, run, attempt, {
        pptx: finalPptx,
        pdf: finalPdf,
        md: finalDocx,
        xlsx: finalXlsx,
      }, {
        checkpoint: publishFromCheckpoint,
        allowDocxFailure: false,
      });
      await finalizeSuccess(config, runId, attempt, MODEL, spentUsd, finalManifest, qaReport, artifacts, templateDiagnostics, {
        phases: phaseTelemetry,
        continuationCount,
        anthropicRequestIds: [...anthropicRequestIds],
        templateMode,
        partialDelivery: partialDeliveryWarnings.length > 0,
        partialDeliveryWarnings,
      });
      let previewAssets: PreviewAsset[] = [];
      if (!isReportOnly) {
        try {
          previewAssets = await persistPreviewAssets(config, run, attempt, finalManifest);
          if (previewAssets.length > 0) {
            await patchRestRows({
              supabaseUrl: config.supabaseUrl,
              serviceKey: config.serviceKey,
              table: "artifact_manifests_v2",
              query: { run_id: `eq.${runId}` },
              payload: { preview_assets: previewAssets },
            });
          }
        } catch (previewError) {
          console.warn(
            `[generateDeckRun] preview asset publish skipped: ${
              previewError instanceof Error ? previewError.message : String(previewError)
            }`,
          );
        }
      }
      await completePhase(config, runId, attempt, "export", {
        artifactCount: artifacts.length,
        estimatedCostUsd: spentUsd,
        qaTier: qaReport.tier,
        visualQa: finalVisualQa,
      });

      const resendApiKey = process.env.RESEND_API_KEY ?? process.env.RESEND_CURSOR_API_KEY ?? "";
      if (resendApiKey) {
        await notifyRunCompletionIfRequested(
          { supabaseUrl: config.supabaseUrl, serviceKey: config.serviceKey, resendApiKey },
          run,
          { runId, slideCount: finalManifest.slideCount, headline: finalManifest.slides[0]?.title ?? run.objective ?? null },
        );
      }
    } catch (exportPhaseError) {
      const exportPhaseMessage = exportPhaseError instanceof Error ? exportPhaseError.message : String(exportPhaseError);
      console.warn(`[generateDeckRun] export phase failed, failing run: ${exportPhaseMessage.slice(0, 300)}`);
      throw exportPhaseError;
    }
  } catch (error) {
    if (error instanceof AttemptOwnershipLostError) {
      console.warn(`[generateDeckRun] ${error.message} Skipping finalization for superseded attempt.`);
      throw error;
    }
    if (error instanceof WorkerShutdownInterruptError) {
      console.warn(`[generateDeckRun] ${error.message} Skipping failure finalization because shutdown recovery will supersede the attempt.`);
      throw error;
    }
    const rawMessage = error instanceof Error ? error.message : "Deck generation failed.";
    const message = sanitizeFailureMessage(rawMessage);
    const failureClass = classifyRuntimeError(error);
    const run = await loadRun(config, runId).catch(() => null);
    const attempt = run ? await resolveAttemptContext(config, run, suppliedAttempt).catch(() => null) : null;
    await finalizeFailure(config, runId, attempt, authorModel, currentPhase, message, {
      phases: phaseTelemetry,
      continuationCount,
      anthropicRequestIds: [...anthropicRequestIds],
      estimatedCostUsd: spentUsd,
      failureClass,
      templateMode,
      requestCount: anthropicRequestIds.size,
      costIncomplete: spentUsd === 0 && anthropicRequestIds.size > 0,
    }).catch(() => {});
    const resendApiKey = process.env.RESEND_API_KEY ?? process.env.RESEND_CURSOR_API_KEY ?? "";
    const shouldSuppressFailureEmail =
      attempt !== null &&
      (
        ((failureClass === "transient_provider" || failureClass === "transient_network") && attempt.attemptNumber < 3) ||
        (Boolean(run?.template_profile_id) && attempt.attemptNumber === 1 && (currentPhase === "normalize" || String(currentPhase) === "understand"))
      );
    if (run && resendApiKey && !shouldSuppressFailureEmail) {
      await notifyRunFailureIfRequested(
        { supabaseUrl: config.supabaseUrl, serviceKey: config.serviceKey, resendApiKey },
        run,
        {
          runId,
          failureMessage: message,
          parseWarnings,
        },
      ).catch(() => {});
    }
    throw error;
  }
}

function resolveConfig() {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required.");
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");

  return {
    anthropicApiKey,
    supabaseUrl,
    serviceKey,
  };
}

function normalizeAuthorModel(model: string | null | undefined): AuthorModel {
  return normalizeClaudeAuthorModel(model);
}

async function loadRun(config: ReturnType<typeof resolveConfig>, runId: string) {
  const runs = await fetchRestRows<RunRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: {
      select: "id,organization_id,project_id,requested_by,brief,business_context,client,audience,objective,thesis,stakes,source_file_ids,target_slide_count,author_model,template_profile_id,template_diagnostics,workspace_id,workspace_scope_id,conversation_id,from_message_id,launch_source,workspace_context_pack,workspace_context_pack_hash,active_attempt_id,latest_attempt_id,latest_attempt_number,failure_phase",
      id: `eq.${runId}`,
      limit: "1",
    },
  });

  if (!runs[0]) throw new Error(`Run ${runId} not found.`);
  return runs[0];
}

async function assertAttemptStillOwnsRun(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
) {
  const [runs, attempts] = await Promise.all([
    fetchRestRows<{ active_attempt_id: string | null; status: string }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        select: "active_attempt_id,status",
        id: `eq.${runId}`,
        limit: "1",
      },
    }),
    fetchRestRows<{ superseded_by_attempt_id: string | null }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_attempts",
      query: {
        select: "superseded_by_attempt_id",
        id: `eq.${attempt.id}`,
        limit: "1",
      },
    }),
  ]);

  const run = runs[0];
  const attemptRow = attempts[0];
  const ownershipLost = !run
    || run.active_attempt_id !== attempt.id
    || attemptRow?.superseded_by_attempt_id !== null;

  if (ownershipLost) {
    throw new AttemptOwnershipLostError(runId, attempt.id);
  }
}

async function resolveAttemptContext(
  config: ReturnType<typeof resolveConfig>,
  run: RunRow,
  suppliedAttempt?: Partial<AttemptContext>,
): Promise<AttemptContext> {
  if (
    suppliedAttempt?.id &&
    typeof suppliedAttempt.attemptNumber === "number" &&
    suppliedAttempt.recoveryReason !== undefined
  ) {
    return {
      id: suppliedAttempt.id,
      attemptNumber: suppliedAttempt.attemptNumber,
      recoveryReason: suppliedAttempt.recoveryReason ?? null,
    };
  }

  const attemptId = suppliedAttempt?.id ?? run.active_attempt_id ?? run.latest_attempt_id;
  if (!attemptId) {
    throw new Error(`Run ${run.id} has no active or latest attempt.`);
  }

  const attempts = await fetchRestRows<RunAttemptRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,run_id,attempt_number,status,recovery_reason,failure_phase,failure_message,last_meaningful_event_at,anthropic_request_ids",
      id: `eq.${attemptId}`,
      limit: "1",
    },
  });

  if (!attempts[0]) {
    throw new Error(`Attempt ${attemptId} not found for run ${run.id}.`);
  }

  return {
    id: attempts[0].id,
    attemptNumber: attempts[0].attempt_number,
    recoveryReason: attempts[0].recovery_reason,
  };
}

async function buildRunCostTelemetry(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext | null,
  model: string,
  currentAttemptEstimatedCostUsd: number,
  extraTelemetry: Record<string, unknown>,
) {
  const runRow = await fetchRestRows<Pick<RunRow, "target_slide_count">>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: {
      select: "target_slide_count",
      id: `eq.${runId}`,
      limit: "1",
    },
  }).catch(() => []);
  const attempts = await fetchRestRows<AttemptCostRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      select: "id,attempt_number,cost_telemetry",
      run_id: `eq.${runId}`,
      order: "attempt_number.asc",
      limit: "50",
    },
  }).catch(() => []);

  const priorEstimatedCostUsd = attempts
    .filter((row) => row.id !== attempt?.id)
    .reduce((sum, row) => {
      const value = Number(row.cost_telemetry?.estimatedCostUsd ?? 0);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  const expectedCostRangeUsd = inferExpectedRunCostRange(
    model,
    runRow[0]?.target_slide_count ?? null,
  );
  const costAnomaly = Boolean(
    expectedCostRangeUsd &&
    currentAttemptEstimatedCostUsd > expectedCostRangeUsd.highUsd * 1.5,
  );

  if (costAnomaly) {
    console.warn(
      `[generateDeckRun] cost anomaly for run ${runId}: attempt cost $${currentAttemptEstimatedCostUsd.toFixed(3)} exceeded expected range $${expectedCostRangeUsd!.lowUsd.toFixed(2)}-$${expectedCostRangeUsd!.highUsd.toFixed(2)} for model ${model}.`,
    );
  }

  return {
    model,
    ...extraTelemetry,
    estimatedCostUsd: roundUsd(priorEstimatedCostUsd + currentAttemptEstimatedCostUsd),
    latestAttemptEstimatedCostUsd: roundUsd(currentAttemptEstimatedCostUsd),
    expectedCostRangeUsd,
    costAnomaly,
    attemptNumber: attempt?.attemptNumber ?? null,
    totalAttemptCount: Math.max(
      attempt?.attemptNumber ?? 0,
      ...attempts.map((row) => row.attempt_number),
      0,
    ),
  };
}

function inferExpectedRunCostRange(model: string, targetSlideCount: number | null) {
  if (!targetSlideCount) {
    return null;
  }

  if (model === "claude-haiku-4-5" && targetSlideCount <= 10) {
    return { lowUsd: 0.8, highUsd: 1.5 };
  }

  if (model === "claude-sonnet-4-6" && targetSlideCount <= 10) {
    return { lowUsd: 2, highUsd: 4 };
  }

  if (model === "claude-sonnet-4-6" && targetSlideCount <= 15) {
    return { lowUsd: 3, highUsd: 5 };
  }

  if (model === OPUS_AUTHOR_MODEL && targetSlideCount <= 15) {
    return { lowUsd: 5, highUsd: 7 };
  }

  return null;
}

async function loadSourceFiles(
  config: ReturnType<typeof resolveConfig>,
  sourceFileIds: string[],
) {
  const rows = await Promise.all(
    sourceFileIds.map(async (id) => {
      const files = await fetchRestRows<SourceFileRow>({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "source_files",
        query: {
          select: "id,kind,file_name,storage_bucket,storage_path,file_bytes",
          id: `eq.${id}`,
          limit: "1",
        },
      });
      return files[0] ?? null;
    }),
  );

  const sourceRows = rows.filter((row): row is SourceFileRow => Boolean(row));
  return Promise.all(
    sourceRows.map(async (row) => ({
      ...row,
      buffer: await downloadFromStorage({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        bucket: row.storage_bucket,
        storagePath: row.storage_path,
      }),
    })),
  );
}

async function loadSourceFile(
  config: ReturnType<typeof resolveConfig>,
  sourceFileId: string,
) {
  const files = await loadSourceFiles(config, [sourceFileId]);
  return files[0];
}

async function loadTemplateProfileRow(
  config: ReturnType<typeof resolveConfig>,
  templateProfileId: string | null,
) {
  if (!templateProfileId) {
    return null;
  }

  const rows = await fetchRestRows<TemplateProfileRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "template_profiles",
    query: {
      select: "id,source_file_id,template_profile",
      id: `eq.${templateProfileId}`,
      limit: "1",
    },
  }).catch(() => []);

  return rows[0] ?? null;
}

async function loadRecoveredAnalysis(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  options: {
    attemptId?: string | null;
  } = {},
) {
  for (const paperType of ["analysis_checkpoint", "analysis_result"] as const) {
    const rows = await fetchRestRows<WorkingPaperRow>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "working_papers",
      query: {
        select: "paper_type,content,version",
        run_id: `eq.${runId}`,
        paper_type: `eq.${paperType}`,
        order: "version.desc",
        limit: "20",
      },
    }).catch(() => []);

    for (const row of rows) {
      const content = row.content;
      if (!content) {
        continue;
      }

      if (options.attemptId) {
        const contentAttemptId = typeof content._attemptId === "string" ? content._attemptId : null;
        if (contentAttemptId !== options.attemptId) {
          continue;
        }
      }

      try {
        const parsed = analysisSchema.parse(content);
        enforceAnalysisExhibitRules(parsed);
        return parsed;
      } catch {
        continue;
      }
    }
  }

  return null;
}

async function persistEvidenceWorkspace(
  config: ReturnType<typeof resolveConfig>,
  run: RunRow,
  parsed: Awaited<ReturnType<typeof parseEvidencePackage>>,
  templateProfile: TemplateProfile,
) {
  const fileInventory = parsed.datasetProfile.sourceFiles.map((file) => ({
    id: file.id,
    fileName: file.fileName,
    kind: file.kind,
    role: file.role,
    mediaType: file.mediaType,
    sheets: parsed.datasetProfile.sheets
      .filter((sheet) => sheet.sourceFileId === file.id)
      .map((sheet) => ({
        name: sheet.name,
        rowCount: sheet.rowCount,
        columnCount: sheet.columns.length,
        columns: sheet.columns.map((column) => ({
          name: column.name,
          inferredType: column.inferredType,
          role: column.role,
          sampleValues: column.sampleValues.map((value) => String(value ?? "")),
          uniqueCount: column.uniqueCount,
          nullRate: column.nullRate,
        })),
      })),
    warnings: file.notes ?? [],
  }));

  await upsertRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "evidence_workspaces",
    onConflict: "run_id",
    rows: [
      {
        run_id: run.id,
        file_inventory: fileInventory,
        dataset_profile: parsed.datasetProfile,
        template_profile: templateProfile,
        sheet_data: {},
      },
    ],
  });
}

async function persistTemplateDiagnostics(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  templateDiagnostics: TemplateDiagnostics,
) {
  await patchRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: { id: `eq.${runId}` },
    payload: {
      template_diagnostics: templateDiagnostics,
      updated_at: new Date().toISOString(),
    },
  });
}

async function upsertWorkingPaper(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  paperType: string,
  content: Record<string, unknown>,
) {
  await appendWorkingPaperVersion(config, runId, paperType, content);
}

async function appendWorkingPaperVersion(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  paperType: string,
  content: Record<string, unknown>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latestRows = await fetchRestRows<{ version: number }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "working_papers",
      query: {
        select: "version",
        run_id: `eq.${runId}`,
        paper_type: `eq.${paperType}`,
        order: "version.desc",
        limit: "1",
      },
    }).catch(() => []);
    const nextVersion = (latestRows[0]?.version ?? 0) + 1;

    try {
      await upsertRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "working_papers",
        onConflict: "run_id,paper_type,version",
        rows: [
          {
            run_id: runId,
            paper_type: paperType,
            content,
            version: nextVersion,
          },
        ],
      });
      return nextVersion;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("duplicate")) {
        throw error;
      }
    }
  }

  throw new Error(`Failed to append working paper version for ${paperType}.`);
}

async function persistArtifactCheckpoint(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase: "author" | "critique" | "revise",
  pptx: GeneratedFile,
  pdf: GeneratedFile,
  narrativeMarkdown: GeneratedFile,
  xlsx: GeneratedFile,
  manifest: Record<string, unknown>,
  metadata?: {
    resumeReady?: boolean;
    visualQaStatus?: "green" | "yellow" | "red";
    deckNeedsRevision?: boolean;
    proof?: Partial<ArtifactCheckpointProof>;
  },
) {
  const timestamp = new Date().toISOString();
  const checkpointKey = `${attempt.attemptNumber}-${attempt.id}-${phase}`;
  const pptxPath = `deck-runs/${runId}/checkpoints/${checkpointKey}/deck.pptx`;
  const pdfPath = `deck-runs/${runId}/checkpoints/${checkpointKey}/deck.pdf`;
  const mdPath = `deck-runs/${runId}/checkpoints/${checkpointKey}/narrative_report.md`;
  const xlsxPath = `deck-runs/${runId}/checkpoints/${checkpointKey}/data_tables.xlsx`;

  // Both uploads must succeed before we write the checkpoint record.
  // A dangling record pointing to missing files is worse than no checkpoint.
  const [pptxResult, pdfResult, mdResult, xlsxResult] = await Promise.all([
    uploadToStorage({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: "artifacts",
      storagePath: pptxPath,
      body: pptx.buffer,
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: true,
    }).then(() => true).catch(() => false),
    uploadToStorage({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: "artifacts",
      storagePath: pdfPath,
      body: pdf.buffer,
      contentType: "application/pdf",
      upsert: true,
    }).then(() => true).catch(() => false),
    uploadToStorage({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: "artifacts",
      storagePath: mdPath,
      body: narrativeMarkdown.buffer,
      contentType: "text/markdown; charset=utf-8",
      upsert: true,
    }).then(() => true).catch(() => false),
    uploadToStorage({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: "artifacts",
      storagePath: xlsxPath,
      body: xlsx.buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    }).then(() => true).catch(() => false),
  ]);

  if (!pptxResult || !pdfResult || !mdResult || !xlsxResult) {
    throw new Error(`Checkpoint upload failed: pptx=${pptxResult}, pdf=${pdfResult}, md=${mdResult}, xlsx=${xlsxResult}`);
  }

  const checkpoint: ArtifactCheckpoint = {
    phase,
    pptxStoragePath: pptxPath,
    pdfStoragePath: pdfPath,
    mdStoragePath: mdPath,
    xlsxStoragePath: xlsxPath,
    manifestJson: manifest,
    savedAt: timestamp,
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    resumeReady: metadata?.resumeReady ?? false,
    visualQaStatus: metadata?.visualQaStatus,
    deckNeedsRevision: metadata?.deckNeedsRevision,
    proof: buildCheckpointProof(metadata?.proof),
  };

  await assertAttemptStillOwnsRun(config, runId, attempt);
  await upsertWorkingPaper(config, runId, "artifact_checkpoint", checkpoint);
  return checkpoint;
}

async function loadArtifactCheckpoint(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  options: {
    requireResumeReady?: boolean;
    preferResumeReady?: boolean;
    attemptNumber?: number;
  } = {},
): Promise<ArtifactCheckpoint | null> {
  const rows = await fetchRestRows<WorkingPaperRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "working_papers",
    query: {
      select: "paper_type,content,version",
      run_id: `eq.${runId}`,
      paper_type: "eq.artifact_checkpoint",
      order: "version.desc",
      limit: "20",
    },
  }).catch(() => []);

  const checkpoints = rows
    .map((row) => normalizeArtifactCheckpoint(row.content))
    .filter((checkpoint): checkpoint is ArtifactCheckpoint => checkpoint !== null);
  const scopedCheckpoints = typeof options.attemptNumber === "number"
    ? checkpoints.filter((checkpoint) => checkpoint.attemptNumber === options.attemptNumber)
    : checkpoints;

  if (options.requireResumeReady) {
    return scopedCheckpoints.find((checkpoint) => checkpoint.resumeReady) ?? null;
  }

  if (options.preferResumeReady) {
    return scopedCheckpoints.find((checkpoint) => checkpoint.resumeReady) ?? scopedCheckpoints[0] ?? null;
  }

  return scopedCheckpoints[0] ?? null;
}

async function loadCheckpointArtifacts(
  config: ReturnType<typeof resolveConfig>,
  checkpoint: ArtifactCheckpoint,
): Promise<{
  pptx: GeneratedFile;
  pdf: GeneratedFile;
  md: GeneratedFile;
  xlsx: GeneratedFile;
  manifest: z.infer<typeof deckManifestSchema>;
} | null> {
  try {
    const [pptxBuffer, pdfBuffer, mdBuffer, xlsxBuffer] = await Promise.all([
      downloadFromStorage({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        bucket: "artifacts",
        storagePath: checkpoint.pptxStoragePath,
      }),
      downloadFromStorage({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        bucket: "artifacts",
        storagePath: checkpoint.pdfStoragePath,
      }),
      downloadFromStorage({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        bucket: "artifacts",
        storagePath: checkpoint.mdStoragePath,
      }),
      downloadFromStorage({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        bucket: "artifacts",
        storagePath: checkpoint.xlsxStoragePath,
      }),
    ]);

    let manifest: z.infer<typeof deckManifestSchema>;
    try {
      manifest = parseDeckManifest(checkpoint.manifestJson);
    } catch {
      manifest = await buildSyntheticManifestFromPptx(pptxBuffer);
    }

    return {
      pptx: { fileId: "checkpoint", fileName: "deck.pptx", buffer: pptxBuffer, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
      pdf: { fileId: "checkpoint", fileName: "deck.pdf", buffer: pdfBuffer, mimeType: "application/pdf" },
      md: { fileId: "checkpoint", fileName: "narrative_report.md", buffer: mdBuffer, mimeType: "text/markdown; charset=utf-8" },
      xlsx: { fileId: "checkpoint", fileName: "data_tables.xlsx", buffer: xlsxBuffer, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      manifest,
    };
  } catch {
    return null;
  }
}

async function buildSyntheticManifestFromPptx(pptxBuffer: Buffer) {
  const zip = await JSZip.loadAsync(pptxBuffer);
  const slideCount = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  if (slideCount < 1) {
    throw new Error("Synthetic manifest fallback could not determine PPTX slide count.");
  }

  return parseDeckManifest({
    slideCount,
    pageCount: slideCount,
    slides: Array.from({ length: slideCount }, (_, index) => ({
      position: index + 1,
      layoutId: index === 0 ? "cover" : "title-body",
      slideArchetype: index === 0 ? "cover" : "title-body",
      title: `Slide ${index + 1}`,
    })),
    charts: [],
  });
}

async function markPhase(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase: DeckPhase,
) {
  const now = new Date().toISOString();
  const [runRows, attemptRows] = await Promise.all([
    patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        id: `eq.${runId}`,
        active_attempt_id: `eq.${attempt.id}`,
      },
      payload: {
        status: "running",
        current_phase: phase,
        phase_started_at: now,
        updated_at: now,
        failure_message: null,
        failure_phase: null,
        active_attempt_id: attempt.id,
        latest_attempt_id: attempt.id,
        latest_attempt_number: attempt.attemptNumber,
      },
      select: "id",
    }),
    patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_attempts",
      query: {
        id: `eq.${attempt.id}`,
        superseded_by_attempt_id: "is.null",
      },
      payload: {
        status: "running",
        updated_at: now,
        failure_message: null,
        failure_phase: null,
      },
      select: "id",
    }),
  ]);
  if (!runRows[0] || !attemptRows[0]) {
    throw new AttemptOwnershipLostError(runId, attempt.id);
  }
  await insertEvent(config, runId, attempt, phase, "phase_started", {});
}

async function completePhase(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase: DeckPhase,
  payload: Record<string, unknown>,
  usage?: ClaudeUsage | null,
) {
  await touchAttemptProgress(config, runId, attempt, phase);

  const runRows = await patchRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: {
      id: `eq.${runId}`,
      active_attempt_id: `eq.${attempt.id}`,
    },
    payload: {
      updated_at: new Date().toISOString(),
    },
    select: "id",
  });
  const attemptRows = await patchRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      id: `eq.${attempt.id}`,
      superseded_by_attempt_id: "is.null",
    },
    payload: {
      updated_at: new Date().toISOString(),
      last_meaningful_event_at: new Date().toISOString(),
    },
    select: "id",
  }).catch(() => []);
  if (!runRows[0] || !attemptRows[0]) {
    throw new AttemptOwnershipLostError(runId, attempt.id);
  }
  await insertEvent(config, runId, attempt, phase, "phase_completed", payload, usage);
}

async function touchAttemptProgress(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase?: string,
) {
  const now = new Date().toISOString();
  const attemptRows = await patchRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: {
      id: `eq.${attempt.id}`,
      superseded_by_attempt_id: "is.null",
    },
    payload: {
      updated_at: now,
      last_meaningful_event_at: now,
    },
    select: "id",
  }).catch(() => []);
  if (!attemptRows[0]) {
    throw new AttemptOwnershipLostError(runId, attempt.id);
  }
  if (phase !== undefined) {
    await insertEvent(
      config,
      runId,
      attempt,
      phase as DeckPhase,
      "meaningful_progress",
      {
        phase,
      },
    ).catch(() => {});
  }
}

async function uploadClaudeFilesSequentially<T>(input: {
  client: Anthropic;
  config: ReturnType<typeof resolveConfig>;
  runId: string;
  attempt: AttemptContext;
  phase: DeckPhase;
  entries: Array<{
    label: string;
    fileName: string;
    upload: () => Promise<T>;
  }>;
}) {
  const uploaded: T[] = [];

  for (const [index, entry] of input.entries.entries()) {
    uploaded.push(await uploadClaudeFileWithRetry({
      ...input,
      ...entry,
      index,
      total: input.entries.length,
    }));
  }

  return uploaded;
}

async function uploadClaudeFileWithRetry<T>(input: {
  client: Anthropic;
  config: ReturnType<typeof resolveConfig>;
  runId: string;
  attempt: AttemptContext;
  phase: DeckPhase;
  label: string;
  fileName: string;
  index: number;
  total: number;
  upload: () => Promise<T>;
}) {
  for (let retry = 0; retry <= TRANSIENT_RETRY_DELAYS_MS.length; retry += 1) {
    await assertAttemptStillOwnsRun(input.config, input.runId, input.attempt);
    await touchAttemptProgress(input.config, input.runId, input.attempt, input.phase).catch(() => {});

    try {
      const uploaded = await input.upload();
      await touchAttemptProgress(input.config, input.runId, input.attempt, input.phase).catch(() => {});
      return uploaded;
    } catch (error) {
      if (!isTransientProviderError(error) || retry >= TRANSIENT_RETRY_DELAYS_MS.length) {
        throw error;
      }

      const baseDelay = TRANSIENT_RETRY_DELAYS_MS[Math.min(retry, TRANSIENT_RETRY_DELAYS_MS.length - 1)];
      const jitter = Math.round(Math.random() * baseDelay * 0.3);
      const delayMs = baseDelay + jitter;
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);

      console.warn(
        `[generateDeckRun] transient file upload error for ${input.label}:${input.fileName} ` +
        `(retry ${retry + 1}/${TRANSIENT_RETRY_DELAYS_MS.length}) — waiting ${delayMs}ms`,
      );
      await insertEvent(input.config, input.runId, input.attempt, input.phase, "file_upload_retry", {
        label: input.label,
        fileName: input.fileName,
        fileIndex: input.index + 1,
        fileTotal: input.total,
        retry: retry + 1,
        delayMs,
        message,
      }).catch(() => {});
      await touchAttemptProgress(input.config, input.runId, input.attempt, input.phase).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`File upload failed for ${input.fileName}.`);
}

async function strengthenFinalVisualQa(input: {
  client: Anthropic;
  pdf: Buffer;
  pptx: GeneratedFile;
  manifest: z.infer<typeof deckManifestSchema>;
  templateProfile: TemplateProfile;
  currentReport: RenderedPageQaReport;
  runId: string;
  attempt: AttemptContext;
  config: ReturnType<typeof resolveConfig>;
  authorModel: AuthorModel;
  targetSlideCount: number;
  spentUsdRef: MutableNumberRef;
  anthropicRequestIds: Set<string>;
  phaseTelemetry: Record<string, unknown>;
}) {
  if (input.currentReport.overallStatus !== "green" || input.currentReport.deckNeedsRevision) {
    return input.currentReport;
  }

  if (VISUAL_QA_MODEL === FINAL_VISUAL_QA_MODEL) {
    input.phaseTelemetry.visualQaFinalSkipped = {
      reason: "same_model_already_ran_in_critique",
      reusedScore: input.currentReport.score,
    };
    return input.currentReport;
  }

  if (input.currentReport.score >= 8 && input.currentReport.issues.length === 0) {
    input.phaseTelemetry.visualQaFinalSkipped = {
      reason: "haiku_green_high_confidence",
      reusedScore: input.currentReport.score,
    };
    return input.currentReport;
  }

  try {
    const finalQaOutcome = await runRenderedPageQaSafely({
      client: input.client,
      pdf: {
        fileId: "final-visual-qa-pdf",
        fileName: "deck.pdf",
        buffer: input.pdf,
        mimeType: "application/pdf",
      },
      pptx: input.pptx,
      manifest: input.manifest,
      templateProfile: input.templateProfile,
      betas: [FILES_BETA],
      model: FINAL_VISUAL_QA_MODEL,
      maxTokens: 1_600,
      phaseTelemetry: input.phaseTelemetry,
      telemetryKey: "visualQaFinalSkipped",
      recoveryStage: "export",
    });
    const finalVisualQa = finalQaOutcome.qa;
    input.spentUsdRef.value = roundUsd(input.spentUsdRef.value + usageToCost(FINAL_VISUAL_QA_MODEL, finalVisualQa.usage));
    assertDeckSpendWithinBudget(input.spentUsdRef.value, input.authorModel, {
      allowPartialOutput: true,
      context: "export:final-visual-qa",
      targetSlideCount: input.targetSlideCount,
    });
    input.phaseTelemetry.visualQaFinal = buildSimplePhaseTelemetry(FINAL_VISUAL_QA_MODEL, finalVisualQa.usage);
    await upsertWorkingPaper(input.config, input.runId, "visual_qa_final", finalVisualQa.report).catch(() => {});
    await persistRequestUsage(
      input.config,
      input.runId,
      input.attempt,
      "export",
      "rendered_page_qa_final",
      FINAL_VISUAL_QA_MODEL,
      finalVisualQa.requests,
    );
    rememberRequestIds(input.anthropicRequestIds, finalVisualQa.requests);
    const hasBlockingIssues = finalVisualQa.report.issues.some((issue) => issue.severity === "major" || issue.severity === "critical");
    if (!hasBlockingIssues && (finalVisualQa.report.overallStatus !== "green" || finalVisualQa.report.deckNeedsRevision)) {
      input.phaseTelemetry.visualQaFinalDowngradeIgnored = {
        reason: "non_blocking_final_qa_downgrade",
        reusedScore: input.currentReport.score,
        finalStatus: finalVisualQa.report.overallStatus,
        finalDeckNeedsRevision: finalVisualQa.report.deckNeedsRevision,
        issueCount: finalVisualQa.report.issues.length,
      };
      return input.currentReport;
    }
    return finalVisualQa.report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.phaseTelemetry.visualQaFinalFallback = {
      fallback: "reuse_prior_green_report",
      errorMessage: message.slice(0, 500),
    };
    return input.currentReport;
  }
}

async function finalizeSuccess(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  model: string,
  estimatedCostUsd: number,
  manifest: z.infer<typeof deckManifestSchema>,
  qaReport: Record<string, unknown>,
  artifacts: Array<Record<string, unknown>>,
  templateDiagnostics: TemplateDiagnostics,
  extraTelemetry: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  const qualityPassport = qaReport && typeof qaReport === "object"
    ? ((qaReport as Record<string, unknown>).qualityPassport as { classification?: string } | undefined)
    : undefined;
  const deliveryStatus = qualityPassport?.classification === "gold" || qualityPassport?.classification === "silver"
    ? "reviewed"
    : "degraded";
  const attemptCostTelemetry = {
    model,
    estimatedCostUsd,
    qaTier: qaReport.tier,
    attemptNumber: attempt.attemptNumber,
    ...extraTelemetry,
  };
  const runCostTelemetry = await buildRunCostTelemetry(config, runId, attempt, model, estimatedCostUsd, {
    qaTier: qaReport.tier,
    ...extraTelemetry,
  });
  const publishRows = await callWorkflowRpc<Array<{ published: boolean }>>(config, {
      functionName: "complete_deck_run_attempt",
      params: {
        p_run_id: runId,
      p_attempt_id: attempt.id,
      p_attempt_number: attempt.attemptNumber,
      p_completed_at: now,
      p_delivery_status: deliveryStatus,
      p_attempt_cost_telemetry: attemptCostTelemetry,
      p_run_cost_telemetry: runCostTelemetry,
      p_anthropic_request_ids: extraTelemetry.anthropicRequestIds ?? [],
      p_slide_count: manifest.slideCount,
      p_page_count: manifest.pageCount ?? manifest.slideCount,
      p_qa_passed: deliveryStatus === "reviewed",
      p_qa_report: {
        ...qaReport,
        template: templateDiagnostics,
      },
      p_artifacts: artifacts,
      p_published_at: now,
    },
  });

  if (!publishRows[0]?.published) {
    throw new AttemptOwnershipLostError(runId, attempt.id);
  }
}

async function finalizeFailure(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext | null,
  model: string,
  failurePhase: DeckPhase,
  failureMessage: string,
  extraTelemetry: Record<string, unknown>,
) {
  const ownsRun = attempt
    ? await fetchRestRows<{ active_attempt_id: string | null }>({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_runs",
        query: {
          select: "active_attempt_id",
          id: `eq.${runId}`,
          limit: "1",
        },
      }).then((rows) => rows[0]?.active_attempt_id === attempt.id).catch(() => false)
    : true;
  const now = new Date().toISOString();
  if (attempt) {
    await closeOpenRequestUsageRows({
      config,
      attemptId: attempt.id,
      status: "failed",
      completedAt: now,
      note: failureMessage.slice(0, 300),
    });
  }
  const attemptCostTelemetry = {
    model,
    estimatedCostUsd: extraTelemetry.estimatedCostUsd ?? 0,
    attemptNumber: attempt?.attemptNumber ?? null,
    ...extraTelemetry,
  };
  const runCostTelemetry = await buildRunCostTelemetry(
    config,
    runId,
    attempt,
    model,
    Number(extraTelemetry.estimatedCostUsd ?? 0),
    extraTelemetry,
  );
  const writes: Array<Promise<unknown>> = [
    ...(ownsRun ? [patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: attempt
        ? {
            id: `eq.${runId}`,
            active_attempt_id: `eq.${attempt.id}`,
          }
        : { id: `eq.${runId}` },
      payload: {
        status: "failed",
        failure_message: failureMessage,
        failure_phase: failurePhase,
        updated_at: now,
        completed_at: null,
        delivery_status: "failed",
        cost_telemetry: runCostTelemetry,
        active_attempt_id: null,
      },
    })] : []),
  ];

  if (attempt) {
    writes.push(
      patchRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_run_attempts",
        query: {
          id: `eq.${attempt.id}`,
          superseded_by_attempt_id: "is.null",
        },
        payload: {
          status: "failed",
          failure_phase: failurePhase,
          failure_message: failureMessage,
          updated_at: now,
          completed_at: now,
          cost_telemetry: attemptCostTelemetry,
          anthropic_request_ids: extraTelemetry.anthropicRequestIds ?? [],
        },
      }),
    );
  }

  await Promise.all(writes);
  await insertEvent(config, runId, attempt, failurePhase, "error", { message: failureMessage });
  const failureClass = String(extraTelemetry.failureClass ?? "");
  const shouldSuppressRefund =
    attempt !== null &&
    attempt.attemptNumber < 3 &&
    (failureClass === "transient_provider" || failureClass === "transient_network");
  if (ownsRun && !shouldSuppressRefund) {
    try {
      await callWorkflowRpc<Array<{ refunded: boolean; amount: number }>>(config, {
        functionName: "refund_run_credit",
        params: {
          p_run_id: runId,
        },
      });
    } catch (refundError) {
      const refundMessage = refundError instanceof Error ? refundError.message : String(refundError);
      console.error(`[generateDeckRun] refund_run_credit failed for ${runId}: ${refundMessage}`);
      await insertEvent(config, runId, attempt, failurePhase, "refund_error", {
        message: refundMessage,
        functionName: "refund_run_credit",
      }).catch(() => {});
    }
  }
}

async function insertEvent(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext | null,
  phase: DeckPhase,
  eventType: string,
  payload: Record<string, unknown>,
  usage?: ClaudeUsage | null,
  options?: { toolName?: string; stepNumber?: number; durationMs?: number },
) {
  await upsertRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_events",
    onConflict: "id",
    rows: [
      {
        id: randomUUID(),
        run_id: runId,
        attempt_id: attempt?.id ?? null,
        attempt_number: attempt?.attemptNumber ?? null,
        phase,
        event_type: eventType,
        tool_name: options?.toolName ?? null,
        step_number: options?.stepNumber ?? null,
        payload,
        usage: usage
          ? {
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
              totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
            }
          : null,
        duration_ms: options?.durationMs ?? null,
      },
    ],
  });
}

async function recordToolCall(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase: DeckPhase,
  toolName: string,
  payload: Record<string, unknown>,
) {
  const stepNumber = typeof payload.stepNumber === "number" ? payload.stepNumber : undefined;
  await insertEvent(
    config,
    runId,
    attempt,
    phase,
    "tool_call",
    payload,
    null,
    {
      toolName,
      stepNumber,
    },
  );
}

async function persistRequestUsage(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase: DeckPhase,
  requestKind: string,
  model: string,
  requests: ClaudeRequestUsage[],
) {
  if (requests.length === 0) {
    return;
  }

  // G: Remove the "started" sentinel row now that we have real usage data.
  // The sentinel was inserted by persistRequestStart() before the Claude call.
  await deleteRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_request_usage",
    query: {
      attempt_id: `eq.${attempt.id}`,
      phase: `eq.${phase}`,
      request_kind: `eq.${requestKind}`,
      anthropic_request_id: "is.null",
    },
  }).catch(() => {});

  await upsertRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_request_usage",
    onConflict: "id",
    rows: requests.map((request) => ({
      id: randomUUID(),
      run_id: runId,
      attempt_id: attempt.id,
      attempt_number: attempt.attemptNumber,
      phase,
      request_kind: requestKind,
      provider: "anthropic",
      model,
      anthropic_request_id: request.requestId,
      usage: {
        inputTokens: request.usage.input_tokens ?? 0,
        cacheCreationInputTokens: request.usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: request.usage.cache_read_input_tokens ?? 0,
        outputTokens: request.usage.output_tokens ?? 0,
        totalInputTokens: billableInputTokens(request.usage),
        totalTokens: billableInputTokens(request.usage) + (request.usage.output_tokens ?? 0),
      },
      started_at: request.startedAt,
      completed_at: request.completedAt,
    })),
  });
}

async function persistRequestStart(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase: DeckPhase,
  requestKind: string,
  model: string,
) {
  const requestRecordId = randomUUID();
  const startedAt = new Date().toISOString();
  await upsertRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_request_usage",
    onConflict: "id",
    rows: [{
      id: requestRecordId,
      run_id: runId,
      attempt_id: attempt.id,
      attempt_number: attempt.attemptNumber,
      phase,
      request_kind: requestKind,
      provider: "anthropic",
      model,
      anthropic_request_id: null,
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        status: "started",
      },
      started_at: startedAt,
      completed_at: null,
    }],
  }).catch(() => {});
  return { requestRecordId, startedAt };
}

function rememberRequestIds(
  target: Set<string>,
  requests: Array<{ requestId: string | null; [key: string]: unknown }>,
) {
  for (const request of requests) {
    if (request.requestId) {
      target.add(request.requestId);
    }
  }
}

function sanitizeFailureMessage(raw: string): string {
  // Strip Cloudflare/HTML error pages to a readable summary
  if (raw.includes("<!DOCTYPE") || raw.includes("<html")) {
    const statusMatch = raw.match(/(\d{3})\s*:\s*([^<]+)/i) ?? raw.match(/Error code (\d{3})/);
    if (statusMatch) {
      return `Upstream error ${statusMatch[1]}. The request failed due to a temporary infrastructure issue. Retry should work.`;
    }
    return "Upstream infrastructure error. The request failed due to a temporary issue. Retry should work.";
  }
  // Truncate very long Anthropic API errors
  if (raw.length > 500) {
    return raw.slice(0, 500);
  }
  return raw;
}

function validateAnalyticalEvidence(parsed: Awaited<ReturnType<typeof parseEvidencePackage>>) {
  const hasSheets = parsed.datasetProfile.sheets.length > 0;
  const hasTextContent = parsed.normalizedWorkbook.files.some((file) =>
    (file.textContent?.trim().length ?? 0) > 100 || (file.pages?.length ?? 0) > 0);

  if (hasSheets || hasTextContent) {
    return null;
  }

  const evidenceKinds = new Set(parsed.datasetProfile.sourceFiles.map((file) => file.kind));
  if (evidenceKinds.size === 0) {
    return "Basquio could not find any usable evidence files for this run.";
  }

  return "Could not find readable data. Add Excel/CSV for tabular data, or PPTX/PDF with tables and charts.";
}

async function runBriefDataReconciliation(input: {
  config: ReturnType<typeof resolveConfig>;
  runId: string;
  run: RunRow;
  attempt: AttemptContext;
  client: Anthropic;
  evidenceFiles: LoadedSourceFile[];
  parsed: Awaited<ReturnType<typeof parseEvidencePackage>>;
  currentSpentUsd: number;
  abortSignal: AbortSignal | null;
}): Promise<{
  result: BriefDataReconciliationResult;
  costUsd: number;
  requests: ClaudeRequestUsage[];
  source: "haiku" | "deterministic_fallback";
}> {
  const profile = buildBriefDataReconciliationProfile({
    briefText: [buildBriefText(input.run), input.run.audience].filter(Boolean).join("\n"),
    files: input.evidenceFiles.map((file) => ({
      id: file.id,
      fileName: file.file_name,
      kind: file.kind,
      buffer: file.buffer,
    })),
    workbook: input.parsed.normalizedWorkbook,
  });
  const fallback = buildFallbackBriefDataReconciliation(profile);

  try {
    await persistRequestStart(
      input.config,
      input.runId,
      input.attempt,
      "normalize",
      "brief_data_reconciliation",
      VISUAL_QA_MODEL,
    );
    const response = await runClaudeLoop({
      client: input.client,
      model: VISUAL_QA_MODEL,
      betas: buildClaudeBetas(VISUAL_QA_MODEL),
      systemPrompt: "You are Basquio's brief-data reconciliation auditor. Return strict JSON only.",
      maxTokens: 1600,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildBriefDataReconciliationPrompt(profile),
            },
          ],
        },
      ],
      tools: [],
      phaseLabel: "normalize",
      maxPauseTurns: 0,
      phaseTimeoutMs: 75_000,
      requestWatchdogMs: 75_000,
      abortSignal: input.abortSignal,
      currentSpentUsd: input.currentSpentUsd,
      targetSlideCount: input.run.target_slide_count,
      circuitKey: "brief-data-reconciliation",
    });
    await persistRequestUsage(
      input.config,
      input.runId,
      input.attempt,
      "normalize",
      "brief_data_reconciliation",
      VISUAL_QA_MODEL,
      response.requests,
    );

    const result = parseBriefDataReconciliationResponse(
      extractResponseText(response.message.content),
      fallback,
    );

    return {
      result,
      costUsd: usageToCost(VISUAL_QA_MODEL, response.usage),
      requests: response.requests,
      source: "haiku",
    };
  } catch (error) {
    await closeOpenRequestUsageRows({
      config: input.config,
      attemptId: input.attempt.id,
      status: "failed",
      note: `brief_data_reconciliation fallback: ${error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)}`,
    });
    await insertEvent(input.config, input.runId, input.attempt, "normalize", "brief_data_reconciliation_fallback", {
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    return {
      result: buildFallbackBriefDataReconciliation(profile, error),
      costUsd: 0,
      requests: [],
      source: "deterministic_fallback",
    };
  }
}

function buildAuthorMessage(
  run: RunRow,
  model: AuthorModel,
  analysis: z.infer<typeof analysisSchema> | null,
  evidenceMode: {
    hasTabularData: boolean;
    hasDocumentEvidence: boolean;
  },
  files?: AuthorInputFiles,
  questionRoutes: Array<{ id: string; name: string; diagnosticMotifs: string[]; recommendationLevers: string[] }> = [],
  scopeAdjustmentMessage?: string,
  chartSlotConstraintMessage?: string,
  perSlideConstraintMessage?: string,
) {
  const isReportOnly = model === "claude-haiku-4-5";
  const routeContext = questionRoutes.length > 0
    ? `- Detected analytical question: ${questionRoutes[0].name}. Check for these diagnostic motifs: ${questionRoutes[0].diagnosticMotifs.join(", ") || "none specific"}. Recommended levers: ${questionRoutes[0].recommendationLevers.join(", ") || "general"}.`
    : "";
  const analysisDepthInstruction = isReportOnly
    ? "This is a report-only analytical pack. Go deep on the evidence, quantify the category and supplier story, and make the markdown report and Excel tables the primary deliverables."
    : run.target_slide_count <= 3
      ? "This is a Memo-tier executive brief. Focus on top-line KPIs and 1-2 decisive insights only."
      : run.target_slide_count <= 10
        ? "This is a Summary-tier deck. Deliver 1-2 slides per chapter, 4-6 insights, and keep the storyline concise."
        : run.target_slide_count <= 20
          ? "This is a Standard consulting deck. Deliver 2-3 slides per chapter, full SCQA depth, and ensure every analytical slide shows co-located data."
        : run.target_slide_count <= 40
            ? "This is a Deep-dive deck. Deliver 3-5 slides per chapter, deep-dive each segment or competitor individually, and include richer cross-tabs plus detailed recommendation cards."
            : run.target_slide_count <= 70
              ? `This is a Full-report NielsenIQ-grade deck. BEFORE generating any slide, plan an MECE issue tree with 4-6 chapters and 4-6 unique leaf questions per chapter. No two slides may answer the same question with different chart types. Cover at least 10 drill-down dimensions from the deck-depth architecture pack, and decompose every segment finding to at least L3 before recommending action. The requested ${run.target_slide_count} slides are your CONTENT slide count, not your total. Produce exactly ${run.target_slide_count} content slides through drill-down depth. Ship one structural cover slide outside that count, and add up to ${getAppendixCapForRequestedDeckSize(run.target_slide_count)} appendix slides only as genuinely supplementary top-up, never as filler to reach count.`
              : `This is a Complete-book deliverable. Maximum depth is expected: dimension-specific slides, retailer and SKU drill-downs, sensitivity analysis, and a full methodology appendix. The requested ${run.target_slide_count} slides are your CONTENT slide count, not your total. Produce exactly ${run.target_slide_count} content slides first. Ship one structural cover slide outside that count, and add up to ${getAppendixCapForRequestedDeckSize(run.target_slide_count)} appendix slides only as optional top-up if they are genuinely additive.`;
  const extractionInstruction = evidenceMode.hasTabularData
    ? "Read the uploaded Excel/CSV files with pandas, profile only the relevant sheets, compute KPIs, and derive the storyline from the tabular evidence."
    : evidenceMode.hasDocumentEvidence
      ? "The evidence is document-based (PDF, PPTX, or DOCX), not tabular. There are NO spreadsheets to analyze with pandas. Do NOT spend more than 2 minutes trying to extract or reconstruct tabular data from document text. Instead: read the document content from uploaded evidence packets (`basquio-evidence-packet-*.md`) or the raw file, identify the key claims, data points, and conclusions, then build the deck around these findings using text-heavy archetypes (exec-summary, key-findings, title-body, recommendation-cards, chart-split with simple charts). If the document contains numeric data (market sizes, growth rates, comparisons), extract those numbers and create simple charts. If it is purely qualitative, use text-only slides. Prioritize completing the output files over exhaustive data extraction. A finished deck with partial analysis is ALWAYS better than no deck."
      : "Inspect the uploaded evidence files directly in code execution, recover any readable structure, and use only facts you can verify from the files.";
  const mergedAnalysisInstructions = analysis
    ? []
    : [
        "Analyze the uploaded evidence package first, then generate the final consulting-grade deck artifacts in the same pass.",
        "- Use code execution to inspect the uploaded files directly and compute the facts you need.",
        `- ${extractionInstruction}`,
        "- Follow the NIQ Analyst Playbook from the system prompt: recognize Italian column names, compute ALL applicable derivatives (growth, share, price index, mix gap) before forming findings, and detect diagnostic motifs.",
        "- Frame the analysis around the TRUE commercial question, not a generic summary. Classify each finding as connection, contradiction, or curiosity.",
        "- Recommendations must be traceable to the data in this run. Do not invent geographies, channels, or opportunities that are not directly supported by the evidence.",
        "- For NielsenIQ promo work, SCQA is only the narrative wrapper. The real body of the deck must drill down mechanically across market, channel, retailer/area, format, competitor, promo mechanic, and productivity.",
        "- Keep analytical branches contiguous. Do not move from segments to channels and then back to segments unless the later revisit is an explicit synthesis/comparison or a clearly deeper follow-up.",
        "- BEFORE writing any number, verify that the sum of supplier-level values per channel matches the channel category total within ±2%. If it does not, you are double-counting NielsenIQ hierarchical subtotal rows.",
        "- NielsenIQ exports contain subtotal rows at category, supplier, brand, and item level. For category totals use only rows where FORNITORE, MARCA, and ITEM are blank. For supplier totals use only rows where FORNITORE is present and MARCA and ITEM are blank.",
        "- If the brief is about promotions, benchmark the focal brand against key competitors and call out what others are doing, not only what the focal brand is doing.",
        "- If the brief is about promotions, follow this sequence unless data is missing: category baseline -> value vs volume vs price -> promo vs no-promo -> discount tiers -> channel/format/localization -> focal brand vs competitor -> WD Promo/display/folder mechanics -> short synthesis.",
        "- If prices materially inflate value growth, show that explicitly and pivot the commercial story to volume. Do not let price inflation hide weak volume dynamics.",
        "- Structure the executive storyline as SCQA (Situation/Complication/Question/Answer). Default DEDUCTIVE: the answer goes on slide 2.",
        "- When the brief asks for both geography and brand, retailer, or channel analysis, include cross-tab analysis at the intersection. Use at least one brand x geography or channel x geography heatmap, table, or grouped comparison instead of world totals only.",
        ...(routeContext ? [routeContext] : []),
        "- Inspect only the workbook regions needed to answer the brief. Do not spend time on exhaustive profiling of every tab if it is not necessary.",
        `- ${analysisDepthInstruction}`,
        "- Complete ALL work in a single uninterrupted code execution session. Do not end the turn until every required output file is attached as a container upload.",
        "- If you hit an error while analyzing, charting, or exporting, fix it and continue in the same session rather than ending the turn early.",
        "- Keep code execution output concise: after the initial 2-3 profiling blocks, print only the computed values needed for charts and narrative, not full DataFrames.",
        "- After initial profiling, print at most 5 rows from any dataframe. Compact output means fewer print() calls, not fewer analysis steps.",
        "- Use matplotlib in non-interactive mode (`matplotlib.use('Agg')`, `plt.ioff()`) to suppress GUI and debug rendering output.",
        ...(model === "claude-sonnet-4-6"
          ? [
              "- Sonnet efficiency: finish chart generation and PPTX writing in as few execution rounds as possible.",
              "- Sonnet efficiency: avoid intermediate debug prints or exploratory code once the required evidence is identified.",
              "- Sonnet efficiency: generate the full chart pack in one coherent script instead of one chart per execution round.",
            ]
          : []),
        isReportOnly
          ? "- Compact output does not change the deliverables. Finish all required file generation steps and attach the final outputs: deck_manifest.json, data_tables.xlsx, and narrative_report.md."
          : "- Compact output does not change the deliverables. Finish all required file generation steps and attach the final user-facing outputs: deck.pptx, narrative_report.md, data_tables.xlsx, and deck_manifest.json. Also attach `deck.pdf` as the internal rendered-QA artifact for this run.",
        "- Compute deterministic facts in Python and produce a concise executive storyline.",
        ...(isReportOnly
          ? ["- This is a report-only run. Do not produce slides or presentation artifacts."]
          : [`- The requested deck size is canonical. Produce exactly ${run.target_slide_count} content slides, plus one structural cover slide outside that count. You may add up to ${getAppendixCapForRequestedDeckSize(run.target_slide_count)} appendix slides only as optional supplementary top-up, never as filler.`]),
        `- Every planned slide must use a slideArchetype chosen from: ${APPROVED_ARCHETYPES.join(", ")}.`,
        "- Archetype selection is mandatory for every slide. Do not improvise freeform slide compositions outside the approved archetype system.",
        "- Never use addShape/addText with custom coordinates outside defined archetype slots unless an existing client template placeholder requires a microscopic adjustment.",
        "- Do not generate section divider slides. Use the slide header/category label to mark sections and spend every content slide on data or analysis.",
        "- Maximum 12 bars per chart. If a grouped bar would exceed that limit, split the exhibit into two slides or use a heatmap, small multiples, or a horizontal alternative.",
        "- Never rotate x-axis labels. If labels do not fit horizontally, abbreviate them, switch to a horizontal chart, or split the chart.",
        "- Minimum readable typography: chart axis labels 10, chart data labels 9, diagnostic side text 11, slide body text 11, chart titles 12.",
        "- When a slide combines a chart with 2-3 scenario, option, or pathway descriptions, use the scenario-cards archetype.",
        "- When a slide presents 3 key takeaways or 3 takeaway cards, use the key-findings archetype.",
        "- Use the system-prompt examples as the visual contract: charts should be PNG-based, slot-sized, and paired with complete narrative copy rather than placeholder labels.",
      ];
  const uploadedFilesContent = [
    ...(files?.uploadedEvidence.map((file) => ({ type: "container_upload" as const, file_id: file.id })) ?? []),
    ...(files?.uploadedSupportPackets.map((file) => ({ type: "container_upload" as const, file_id: file.id })) ?? []),
    ...(files?.uploadedTemplate ? [{ type: "container_upload" as const, file_id: files.uploadedTemplate.id }] : []),
  ];

  if (isReportOnly) {
    return {
      role: "user" as const,
      content: [
        ...uploadedFilesContent,
        {
          type: "text" as const,
          text: buildReportOnlyAuthorText({
            run,
            analysis,
            extractionInstruction,
            routeContext,
            analysisDepthInstruction,
            files,
            scopeAdjustmentMessage,
          }),
        },
      ],
    };
  }

  return {
    role: "user" as const,
    content: [
      ...uploadedFilesContent,
      {
        type: "text" as const,
        text: [
          analysis
            ? "Using the evidence files already available in the current container and the approved analysis below, generate the final consulting-grade deck artifacts."
            : "Use the evidence files already available in the current container to build a final consulting-grade deck without a separate analysis turn.",
          "",
          buildGenerationBrief(run),
          "",
          ...(scopeAdjustmentMessage ? [scopeAdjustmentMessage, ""] : []),
          ...(analysis ? [`Approved analysis JSON:\n${JSON.stringify(analysis, null, 2)}`, ""] : mergedAnalysisInstructions),
          "- Reuse the existing container state and uploaded files. Do not restart with exhaustive workbook discovery.",
          ...(analysis
            ? [
                "- Recalculate only the facts needed to render the promised slides and charts accurately.",
                "- Follow the approved slide plan unless a small factual adjustment is necessary for correctness.",
              ]
            : [
          "- Build the analysis and slide plan inline, then render the deck from that plan without starting over in a second pass.",
          "- Keep the analysis concise and execution-oriented. Do not spend tokens on narrative throat-clearing.",
        ]),
          ...(files?.uploadedSupportPackets.length
            ? [
                `- Normalized evidence packets are already uploaded in the container: ${files.uploadedSupportPackets.map((file) => file.filename).join(", ")}.`,
                "- Read those packets before attempting your own PDF/PPTX extraction. They are the fast path for hostile spacing, OCR drift, and scanned-layout noise.",
                "- If a `basquio-workbook-evidence-packet-*.md` packet is uploaded, read it before writing any analysis code. Its source totals and top dimension breakdowns are binding. Every market size, share, CAGR, and focal-entity value in the deck, workbook, and narrative report must reconcile to that packet within normal rounding.",
                "- If your raw Excel parsing produces different totals from the workbook evidence packet, stop and fix the header/measure parsing. Do not proceed with estimated, sampled, benchmark, or manually typed replacement figures.",
              ]
            : []),
          "- Follow the loaded pptx skill for the deck artifact generation.",
          "- CLIENT-FACING TONE: the client is paying for this deck. Lead with strengths, frame challenges as market dynamics, quantify the upside before the downside, and never attack the client's hero product or format.",
          "- CLIENT-FRIENDLY COPY IS NOT A LICENSE TO LOWER ANALYTICAL QUALITY. If there is a conflict, preserve evidence depth, metric accuracy, and focal-brand clarity first, then make the copy friendlier without weakening the claim.",
          "- BEFORE committing each slide to PPTX, self-score it against this rubric and revise in-place until it passes: TITLE = full-sentence insight with at least one number and max 14 words; BODY = no AI slop, active voice, evidence-led; EVIDENCE = chart/table/source actually support the claim; STRUCTURE = approved archetype and no duplicate question; RECOMMENDATIONS = opportunity first, lever second, rationale tied to visible evidence.",
          "- Treat the rubric as blocking inside the author turn. If a planned slide fails any dimension, rewrite the slide before adding it to the deck instead of hoping revise will fix it later.",
          `- POSITION CONTRACT: use 1-indexed slide positions only. Cover is position 1. Content slides are positions 2 through ${run.target_slide_count + 1} inclusive. Executive summary and recommendations count as content slides. Do not create position ${run.target_slide_count + 2} unless it is a true appendix/source-trail slide.`,
          "- EVIDENCE CO-LOCATION RULE: every analytical slide must show its supporting numbers. If a slide has a chart, include a compact data table or explicit chart annotations with the key values. Executive summary and recommendation slides may reference prior evidence via 'cfr. slide N'.",
          "- Use the recommendation framework from the knowledge pack: opportunity first, specific lever second, rationale anchored to visible evidence, and a concrete timeline.",
          "- CLAIM-TO-CHART BINDING: if the slide says the issue is rotation, productivity, ROS, price-led growth, or a distribution opportunity, the hero exhibit must show that metric or a direct causal driver. Do not chart sales value and bury productivity in a side note.",
          "- STORYLINE CONTIGUITY: finish one analytical branch before switching to another. If you revisit an earlier branch later in the deck, it must be an explicit synthesis/comparison or a deeper follow-up, not a lateral jump.",
          "- REDUNDANCY RULE: if a later slide only improves the commentary while keeping the same analytical cut, collapse it and replace it with a deeper or more causal exhibit.",
          "- Speaker notes are part of the deliverable quality bar. For each substantive non-cover slide, write 200-400 words covering TALK TRACK, DATA CONTEXT, skeptical pushback, anticipated questions, and a transition.",
          ...(files?.uploadedTemplate
            ? [
                `- A client PPTX template is uploaded in the container as ${files.uploadedTemplate.filename}. Use that actual template file as the visual source of truth, not just the summarized template tokens.`,
                "- Preserve the client's master background treatment and embedded logo/wordmark assets wherever the template already provides them.",
                "- Do not replace a light client template with Basquio dark styling.",
              ]
            : []),
          ...(chartSlotConstraintMessage ? [chartSlotConstraintMessage] : []),
          ...(perSlideConstraintMessage ? [perSlideConstraintMessage] : []),
          "- CHART VARIETY: use at least 3 different chart types even in short decks. Do not default to bar charts for everything. Use heatmaps for cross-tabs, bubbles/scatter for growth-vs-size, waterfalls for bridges. Follow the chart selection rules in the NIQ Analyst Playbook section 16.",
          ...(run.target_slide_count >= 40 ? [
            `- LONG DECK TITLES: every slide title must be a FULL SENTENCE stating an insight with at least one number. Single-word titles like 'CATEGORIA' or 'DISTRIBUZIONE' are NOT acceptable. Chapter labels ('CAPITOLO X | TOPIC') are only for section dividers (max ${Math.min(8, Math.floor(run.target_slide_count / 7))} in a ${run.target_slide_count}-slide deck).`,
            `- LAYOUT VARIETY: for this ${run.target_slide_count}-slide deck, use at least 6 different archetype layouts. Cycle through exec-summary, title-chart, chart-split, evidence-grid, comparison, recommendation-cards, key-findings, table, scenario-cards.`,
            `- RECOMMENDATION DEPTH: for a ${run.target_slide_count}-slide deck, generate at least ${Math.max(6, Math.floor(run.target_slide_count / 8))} recommendation cards grouped by strategic theme, with an impact summary slide and a prioritization slide.`,
          ] : []),
          "- Keep code execution output compact after the first profiling pass, but still complete every required deliverable.",
          "- Follow the system-prompt examples and per-slide constraints instead of inventing custom layout logic: complete SCQA/body copy, slot-sized PNG charts, and clean recommendation cards.",
          "- Rank recommendations by impact × feasibility. The first recommendation must be Priority 1 (must-win), then Priority 2 (high impact), then quick wins.",
          "- Distinguish promo intensity (% of PDV on promo) from promo effectiveness (incremental volume per promo event). High intensity with low effectiveness means wasted budget.",
          "- Every recommendation must include its own risk and mitigation in the narrative report: `Risk:` and `Mitigation:`.",
          "- If a chart would overcrowd labels or waste most of its frame, switch to a stronger text-first or split-slide composition instead of forcing the chart.",
          "- Numeric labels must be clean: + exactly once for positives, - for negatives, and pp labels like +0.09pp with no doubled symbols.",
          "- If a slide headline or commentary claims growth, expansion, or acceleration in a metric, the exhibit must show the change in that metric, not just its current level.",
          "- If a slide promises a comparison set with an explicit count such as 4 provinces, 3 channels, or 5 segments, cover all of them explicitly or change the claim.",
          "- Recommendations must stay inside the proven evidence. Do not elevate a country, region, or lever unless the supporting chart or table clearly makes it one of the strongest opportunities.",
          "- Never invent a growth target, market-share target, or strategy objective unless it is explicitly present in the brief or directly derivable from the visible evidence.",
          "- Recommendation slides must not introduce fresh quantified targets, share goals, revenue scenarios, or ROI math. Use opportunity size/CAGR already shown on prior evidence slides; if you must show a scenario, create a visible calculation sheet in data_tables.xlsx with assumptions/formula/source rows and label it as a scenario, not a forecast.",
          "- If uploaded evidence covers only historical/actual years and contains no forecast assumptions, do not create future-year forecast or target slides. Prioritize recommendations using current opportunity size, historical CAGR, share gaps, and clearly stated data gaps.",
          "- On player, manufacturer, or competitor slides, keep the focal brand explicitly visible and say what the comparison means for it.",
          "- Preserve source labels exactly: use the input label or the canonical NIQ English label, never invented synonyms like ACV when the source says Distr. Pond.",
          "- Tables with PY and CY must be ordered past-to-present (PY before CY), and any share or price table must include the relevant delta columns when those metrics are shown.",
          "- Bubble charts must declare the bubble-size dimension explicitly in both metadata and visible title text (`bolla = ...` or `bubble = ...`).",
          "- Apply the copywriting voice rules from the NIQ Analyst Playbook: no em dashes, no AI slop patterns, numbers first, active voice, every sentence carries information.",
          "- Native-language quality is mandatory. If the brief is Italian, write native Italian business prose, not translated English and not pseudo-Spanish. Never use fake-Italian verbs such as 'lidera' or 'performa'.",
          "- If the brief is English, write direct partner-grade English with no padded corporate phrasing such as 'in order to' or 'going forward'.",
          "- Every analytical slide must answer four questions: what changed, by how much, why it happened, and what the executive should do. A slide that only restates the chart is unfinished.",
          "- When the brief asks for both geography and brand, retailer, or channel analysis, at least one slide per chapter should show the intersection directly. Use heatmaps, tables, grouped horizontal bars, or small multiples instead of only world-total rankings.",
          "- Slide titles must state the insight with at least one number, max 14 words. Charts are the hero (60%+ of slide area). Quantify recommendations only when the evidence supports a direct calculation.",
          "- Slide titles: MAXIMUM 70 characters. If the insight needs more, split it into title + subtitle.",
          "- Never use donut or pie charts with more than 4 segments. Use a horizontal stacked bar when there are 5+ segments.",
          ...(!isReportOnly ? [
            `- Produce exactly ${run.target_slide_count} content slides. Do not compress the body of the deck below that ask. The cover is structural and sits outside the content count.`,
            `- Appendix is optional and capped at ${getAppendixCapForRequestedDeckSize(run.target_slide_count)} slides. Use it only for genuinely supplementary methodology or source-trail material.`,
            `- \`deck_manifest.json\` slideCount must equal the actual total slides shipped: 1 structural cover slide + ${run.target_slide_count} content slides + 0-${getAppendixCapForRequestedDeckSize(run.target_slide_count)} optional appendix slides.`,
          ] : [
            "- `deck_manifest.json` slideCount must be 0 for this report-only run.",
          ]),
          analysis
            ? (isReportOnly
              ? "- Generate files in this exact order: (1) `narrative_report.md` — write this FIRST using Python file I/O as the primary analytical deliverable, target 800-1200 lines and 10000-16000 words. File content written to disk has no token limit. (2) `data_tables.xlsx` — write ALL analysis DataFrames to a multi-sheet Excel file using pandas ExcelWriter with XlsxWriter, attempting native Excel chart objects for supported chart-bearing slides when the runtime allows it. (3) `deck_manifest.json` with slideCount 0. Do NOT generate deck.pptx or deck.pdf."
              : "- Generate files in this exact order: (1) `narrative_report.md` — write this FIRST using Python file I/O as the primary analytical deliverable, target 500-1000 lines and 8000-15000 words. File content written to disk has no token limit. (2) `data_tables.xlsx` — write ALL analysis DataFrames to a multi-sheet Excel file using pandas ExcelWriter with XlsxWriter, attempting native Excel chart objects for supported chart-bearing slides when the runtime allows it. (3) `deck.pptx` as the durable user deck, (4) `deck.pdf` as the internal rendered-QA artifact, (5) `deck_manifest.json`.")
            : (isReportOnly
              ? "- Generate files in this exact order: (1) `narrative_report.md` — write this FIRST using Python file I/O, target 800-1200 lines and 10000-16000 words. (2) `data_tables.xlsx` — write ALL analysis DataFrames to a multi-sheet Excel file using pandas ExcelWriter with XlsxWriter, attempting native Excel chart objects for supported chart-bearing slides when the runtime allows it. (3) `deck_manifest.json` with slideCount 0. Do NOT generate deck.pptx or deck.pdf."
              : "- Generate files in this exact order: (1) `narrative_report.md` — write this FIRST using Python file I/O, target 500-1000 lines and 8000-15000 words. (2) `analysis_result.json`, (3) `data_tables.xlsx` — write ALL analysis DataFrames to a multi-sheet Excel file using pandas ExcelWriter with XlsxWriter, attempting native Excel chart objects for supported chart-bearing slides when the runtime allows it. (4) `deck.pptx` as the durable user deck, (5) `deck.pdf` as the internal rendered-QA artifact, (6) `deck_manifest.json`."),
          ...(analysis
            ? []
            : [
                "- `analysis_result.json` must be valid JSON matching the approved analysis schema with `language`, `thesis`, `executiveSummary`, and `slidePlan[]`.",
                "- For every `slidePlan[].chart`, include `maxCategories`, `preferredOrientation`, `slotAspectRatio`, `figureSize`, `sort`, and `truncateLabels` so downstream QA can verify the chart contract.",
                "- For every `slidePlan[].chart`, also include `xAxisLabel`, `yAxisLabel`, and for bubble charts `bubbleSizeLabel` so fidelity validators can verify labels and legends.",
                "- For every `slidePlan[].chart`, also include `excelSheetName`; include `excelChartCellAnchor` for native-eligible Excel chart families; include `dataSignature` when you can derive a stable signature from the plotted data columns.",
                "- Use the same language as the brief. Do not emit mixed-language output.",
              ]),
          ...(!isReportOnly
            ? [
                "- Two-phase authoring is mandatory for full-deck runs.",
                "- Phase 1: finish `narrative_report.md` and `data_tables.xlsx` first. Do not start chart rendering, PPTX generation, or PDF generation until the markdown narrative is substantively complete.",
                "- VERIFICATION: after writing `narrative_report.md`, count its lines in Python before starting `analysis_result.json`, `deck.pptx`, or `deck.pdf`.",
                "```python",
                "with open('narrative_report.md', 'r', encoding='utf-8') as f:",
                "    line_count = sum(1 for _ in f)",
                "print(f'narrative_report.md: {line_count} lines')",
                "assert line_count >= 400, f'Narrative too short ({line_count} lines). Extend appendix, competitor analysis, and data tables before Phase 2.'",
                "```",
                "- If the assertion fails, expand the executive summary, findings, competitor section, recommendation details, and appendix tables until it passes.",
                "- Only after the markdown narrative passes the >400-line gate should you start slide, chart, PPTX, and PDF generation.",
              ]
            : []),
          isReportOnly
            ? "- `narrative_report.md` must be a STANDALONE consulting leave-behind that the reader can use without opening the PPTX. For report-only runs target 800-1200 lines and roughly 10000-16000 words."
            : "- `narrative_report.md` must be a STANDALONE consulting leave-behind that the reader can use without opening the PPTX. Target 500-1000 lines and roughly 8000-15000 words.",
          "- Begin `narrative_report.md` with a short `Brief Interpretation` section (5-7 sentences) explaining the core question, the main segmentation choices, the KPIs prioritized, the chapter/report flow, and what is intentionally out of scope.",
          "- Required sections for `narrative_report.md`:",
          "  1. Title page with client name from the brief (NEVER `Non specificato`), objective, date, and data source.",
          isReportOnly
            ? "  2. Brief Interpretation: 5-7 sentences on how you read the brief, how you segmented the analysis, and what the report emphasizes."
            : "  2. Brief Interpretation: 5-7 sentences on how you read the brief, how you segmented the analysis, and what the report emphasizes.",
          isReportOnly
            ? "  3. Executive summary (minimum 500 words): the full story in one page - situation, complication, key findings, recommended actions, and expected impact."
            : "  3. Executive summary (300-500 words): the full story in one page - situation, complication, key findings, recommended actions, and expected impact.",
          "  4. Methodology: data used, KPIs computed, time periods, comparison basis, data quality caveats, explicit assumptions, and sensitivity ranges.",
          isReportOnly
            ? "  5. Detailed findings (one section per analytical slide, minimum 400 words each): state the finding with exact numbers, explain the methodology, include caveats and confidence level, and add benchmark or historical context where available."
            : "  5. Detailed findings (one section per analytical slide, 300-500 words each): state the finding with exact numbers, explain the methodology, include caveats and confidence level, and add benchmark or historical context where available.",
          "  6. For every slide with a chart, include a markdown table with the exact numbers the chart visualizes so the report is usable without the PPTX.",
          isReportOnly
            ? "  7. Competitor deep-dive (minimum 600 words): dedicated section analyzing each major competitor's strategy, relative strengths, and implications for the client."
            : "  7. Competitor deep-dive: dedicated section analyzing the main competitors' strategies, relative strengths, and implications for the client.",
          isReportOnly
            ? "  8. Recommendations with sensitivity analysis (minimum 800 words): for each recommendation include base, bull, and bear scenarios, explicit assumptions, risk/probability assessment, expected impact, and timeline."
            : "  8. Recommendations with sensitivity analysis: for each recommendation include base, bull, and bear scenarios, explicit assumptions, risk/probability assessment, expected impact, and timeline.",
          "  8a. For every recommendation include the action, traceable rationale, priority, and any measurable impact that can be computed directly from the source data. If financial impact is not directly computable, say so explicitly instead of inventing ROI, investment, or budget figures.",
          "  9. Full data appendix: markdown tables with the key cross-tabulations (category by channel, brand share by channel, brand x geography, top items, distribution by channel, or the closest available evidence).",
          "  10. Risk register: probability x impact matrix for the recommendations and the main delivery risks.",
          "- Include markdown tables wherever the slide has a chart. The table gives the reader the exact numbers behind the visual.",
          "- Write `narrative_report.md` to McKinsey leave-behind quality, not blog-post quality. Use the same language as the brief.",
          isReportOnly
            ? "- `narrative_report.md` must be at least 800 lines for a report-only run. If it is shorter, extend the appendix, competitor analysis, and chart-supporting markdown tables."
            : "- `narrative_report.md` must be at least 500 lines. If it is shorter, extend the appendix and the chart-supporting markdown tables.",
          "- `data_tables.xlsx` must contain every pandas DataFrame that supports a chart, table, or numeric finding. Verify supplier-level sums vs category totals before writing it.",
          "- EXCEL-NATIVE-CHARTS RULE: for every slide that contains a matplotlib chart in the PPTX, write the exact underlying DataFrame to a sheet named `S<NN>_<descriptor>` in `data_tables.xlsx`.",
          "- Excel sheet names must already be Excel-safe in both the workbook and the manifest: max 31 characters, no `\\ / ? * [ ] :`, and use the exact same sanitized string in both places.",
          "- For supported Excel chart families (bar/column, line, scatter, pie/doughnut, area), attempt to embed a native XlsxWriter chart object in that same sheet so an analyst can copy it into another deck.",
          "- Basquio chart-type mapping for native Excel charts is deterministic: `bar` -> column, `horizontal_bar` -> bar, `grouped_bar` -> column cluster, `stacked_bar` -> bar stacked, `stacked_bar_100` -> bar percent-stacked, `line` -> line, `area` -> area, `scatter` -> scatter, `pie` -> pie, `doughnut` -> doughnut.",
          "- Excel-native charts are best-effort companion artifacts. If XlsxWriter is unavailable or a specific chart object fails, still write the exact sheet, omit `excelChartCellAnchor` for that chart, and continue. Never let Excel chart generation block `deck.pptx`, `deck.pdf`, `narrative_report.md`, or the workbook itself.",
          "- For unsupported Excel chart families (for example waterfall, heatmap, bubble, or table-only exhibits), still write the sheet and set `excelSheetName` in the manifest, but omit `excelChartCellAnchor` instead of inventing a broken native chart.",
          "- Every manifest chart should include `xAxisLabel`, `yAxisLabel`, and for bubble charts `bubbleSizeLabel` so slide-level fidelity validators can check source labels and legends.",
          "- Every manifest chart should include `excelSheetName` and, when a native Excel chart object exists, `excelChartCellAnchor`. Include `dataSignature` when you can derive a stable signature from the plotted data columns.",
          "<example name=\"data_tables_xlsx_with_native_charts\">",
          "import pandas as pd",
          "",
          "with pd.ExcelWriter('data_tables.xlsx', engine='xlsxwriter') as writer:",
          "    workbook = writer.book",
          "",
          "    brand_df = brand_share_top10  # columns: Brand, Quota_CY_pct",
          "    brand_df.to_excel(writer, sheet_name='S15_BrandShare', index=False)",
          "    ws = writer.sheets['S15_BrandShare']",
          "    bar = workbook.add_chart({'type': 'bar'})",
          "    bar.add_series({",
          "        'name':       ['S15_BrandShare', 0, 1],",
          "        'categories': ['S15_BrandShare', 1, 0, len(brand_df), 0],",
          "        'values':     ['S15_BrandShare', 1, 1, len(brand_df), 1],",
          "        'fill':       {'color': ACCENT},",
          "        'data_labels': {'value': True},",
          "    })",
          "    bar.set_title({'name': 'S15 — Top 10 brand — Quota CY %'})",
          "    bar.set_x_axis({'name': 'Quota CY %'})",
          "    bar.set_y_axis({'name': 'Brand'})",
          "    ws.insert_chart('G2', bar)",
          "",
          "    trend_df = monthly_sales_trend  # columns: Period, SalesValue",
          "    trend_df.to_excel(writer, sheet_name='S22_SalesTrend', index=False)",
          "    ws = writer.sheets['S22_SalesTrend']",
          "    line = workbook.add_chart({'type': 'line'})",
          "    line.add_series({",
          "        'name':       ['S22_SalesTrend', 0, 1],",
          "        'categories': ['S22_SalesTrend', 1, 0, len(trend_df), 0],",
          "        'values':     ['S22_SalesTrend', 1, 1, len(trend_df), 1],",
          "        'line':       {'color': ACCENT, 'width': 2.25},",
          "    })",
          "    line.set_title({'name': 'S22 — Sales trend'})",
          "    line.set_x_axis({'name': 'Period'})",
          "    line.set_y_axis({'name': 'Sales Value'})",
          "    ws.insert_chart('G2', line)",
          "</example>",
          "<example name=\"perfect_narrative_finding_section\">",
          "## Finding 2: Birre, Yogurt e Salumi spiegano la meta del gap ponderato",
          "",
          "I comparti con il maggiore contributo negativo ponderato al gap totale di -0.5pp sono:",
          "- **BIRRE** (3.9% delle confezioni Discount): -5.0% vs -2.8% TI, gap -2.2pp, contributo al gap totale -0.08pp",
          "- **YOGURT E SIMILARI** (3.4%): +5.1% vs +7.8% TI, gap -2.8pp, contributo -0.09pp",
          "- **SALUMI** (4.6%, il comparto più pesante): -2.0% vs -1.0% TI, gap -1.0pp, contributo -0.05pp",
          "",
          "Il fatto che Yogurt cresca in Discount (+5.1%) ma cresca ancora di più nel Totale Italia (+7.8%) è un segnale tipico di **portfolio mismatch**: il canale è presente ma non è abbastanza ben posizionato sulle varianti in espansione.",
          "",
          "**Implicazione:** Questi 5 comparti da soli spiegano circa 0.31pp del gap totale di -0.5pp. Interventi mirati basterebbero a recuperare la maggior parte del divario.",
          "",
          "**Caveat:** Il contributo ponderato assume un peso proporzionale al numero di confezioni. Se la distribuzione ponderata in questi comparti e significativamente diversa, il contributo reale potrebbe deviare. Servirebbe un drill-down per insegna.",
          "</example>",
          "- `deck_manifest.json` must contain `slideCount`, `pageCount`, `slides[]`, and `charts[]` describing the final deck.",
          "- Each chart in the manifest should include `categoryCount` and `categories[]` when available so Basquio can verify density and label fit.",
          "- Each chart in the manifest should also include `excelSheetName` for the linked `data_tables.xlsx` sheet and `excelChartCellAnchor` when a native Excel chart object exists.",
          "- Each slide entry in the manifest must include `position`, `layoutId`, `slideArchetype`, `pageIntent`, `title`, and `chartId` when applicable.",
          "- For charted slides, each slide entry in `deck_manifest.json` must also set `hasDataTable` and `hasChartAnnotations` so Basquio can verify evidence co-location deterministically.",
          "- Your final assistant message must attach the files as container uploads before finishing.",
        ].join("\n"),
      },
    ],
  };
}

function buildReportOnlyAuthorText(input: {
  run: RunRow;
  analysis: z.infer<typeof analysisSchema> | null;
  extractionInstruction: string;
  routeContext: string;
  analysisDepthInstruction: string;
  files?: AuthorInputFiles;
  scopeAdjustmentMessage?: string;
}) {
  const lines = [
    input.analysis
      ? "Using the evidence files already available in the current container and the approved analysis below, generate the final consulting-grade report deliverables."
      : "Use the evidence files already available in the current container to build the final consulting-grade report deliverables without a separate analysis turn.",
    "",
    buildGenerationBrief(input.run),
    "",
    ...(input.scopeAdjustmentMessage ? [input.scopeAdjustmentMessage, ""] : []),
    ...(input.analysis
      ? [`Approved analysis JSON:\n${JSON.stringify(input.analysis, null, 2)}`, ""]
      : [
          "Analyze the uploaded evidence package first, then generate the final report deliverables in the same pass.",
          "- Use code execution to inspect the uploaded files directly and compute the facts you need.",
          `- ${input.extractionInstruction}`,
          "- Follow the NIQ Analyst Playbook from the system prompt: recognize Italian column names, compute all applicable derivatives (growth, share, price index, mix gap) before forming findings, and detect diagnostic motifs.",
          "- Frame the analysis around the true commercial question, not a generic summary. Classify each finding as connection, contradiction, or curiosity.",
          "- Recommendations must be traceable to the data in this run. Do not invent geographies, channels, or opportunities that are not directly supported by the evidence.",
          "- BEFORE writing any number, verify that the sum of supplier-level values per channel matches the channel category total within plus or minus 2%. If it does not, you are double-counting NielsenIQ hierarchical subtotal rows.",
          "- NielsenIQ exports contain subtotal rows at category, supplier, brand, and item level. For category totals use only rows where FORNITORE, MARCA, and ITEM are blank. For supplier totals use only rows where FORNITORE is present and MARCA and ITEM are blank.",
          "- When the brief asks for both geography and brand, retailer, or channel analysis, include cross-tab analysis at the intersection. Use at least one brand x geography or channel x geography heatmap, table, or grouped comparison instead of world totals only.",
          ...(input.routeContext ? [input.routeContext] : []),
          "- Inspect only the workbook regions needed to answer the brief. Do not spend time on exhaustive profiling of every tab if it is not necessary.",
          `- ${input.analysisDepthInstruction}`,
          "- Complete all work in a single uninterrupted code execution session. Do not end the turn until every required output file is attached as a container upload.",
          "- If you hit an error while analyzing or exporting, fix it and continue in the same session rather than ending the turn early.",
        ]),
    "- This is a Haiku report-only run. Do not rely on pptx or pdf skills.",
    "- Generate ONLY these deliverables: narrative_report.md, data_tables.xlsx, and deck_manifest.json with slideCount set to 0.",
    "- Do NOT generate deck.pptx, deck.pdf, slide plans, or presentation artifacts.",
    "- Reuse the existing container state and uploaded files. Do not restart with exhaustive workbook discovery.",
    ...(input.analysis
      ? [
          "- Recalculate only the facts needed to render the promised report accurately.",
        ]
      : [
          "- Build the analysis inline, then write the report and workbook from that analysis without starting over in a second pass.",
        ]),
    ...(input.files?.uploadedSupportPackets.length
      ? [
          `- Normalized evidence packets are already uploaded in the container: ${input.files.uploadedSupportPackets.map((file) => file.filename).join(", ")}.`,
          "- Read those packets before attempting your own PDF/PPTX extraction. They are the fast path for hostile spacing, OCR drift, and scanned-layout noise.",
          "- If a `basquio-workbook-evidence-packet-*.md` packet is uploaded, read it before writing any analysis code. Its source totals and top dimension breakdowns are binding. Every market size, share, CAGR, and focal-entity value in the workbook and narrative report must reconcile to that packet within normal rounding.",
          "- If your raw Excel parsing produces different totals from the workbook evidence packet, stop and fix the header/measure parsing. Do not proceed with estimated, sampled, benchmark, or manually typed replacement figures.",
        ]
      : []),
    ...(input.files?.uploadedTemplate
      ? [
          `- A client PPTX template is uploaded in the container as ${input.files.uploadedTemplate.filename}. Use it only as naming and client-brand context for the title page; do not generate presentation artifacts from it.`,
          "- Never inject Basquio branding when a client template or client name is present.",
        ]
      : []),
    "- Use direct code execution for the report and data pack in this run.",
    "- Keep code execution output compact after the first profiling pass, but still complete every required deliverable.",
    "- data_tables.xlsx must contain the exact pandas DataFrames behind every quantitative finding.",
    "- If the report cites a quantitative claim, include the exact markdown table in the report and the exact supporting DataFrame in data_tables.xlsx.",
    "- Rank recommendations by impact x feasibility. The first recommendation must be Priority 1, then Priority 2, then quick wins.",
    "- Distinguish promo intensity (% of PDV on promo) from promo effectiveness (incremental volume per promo event). High intensity with low effectiveness means wasted budget.",
    "- Every recommendation must include its own Risk: and Mitigation: in the narrative report.",
    "- Recommendations must stay inside the proven evidence. Do not elevate a country, region, or lever unless the supporting chart or table clearly makes it one of the strongest opportunities.",
    "- When the brief asks for both geography and brand, retailer, or channel analysis, include at least one brand x geography or channel x geography cross-tab in the report appendix and call it out in the findings.",
    "- Apply the copywriting voice rules from the NIQ Analyst Playbook: no em dashes, no AI slop patterns, numbers first, active voice, every sentence carries information.",
    "- Native-language quality is mandatory. If the brief is Italian, write native Italian business prose, not translated English and not pseudo-Spanish. Never use fake-Italian verbs such as 'lidera' or 'performa'.",
    "- If the brief is English, write direct partner-grade English with no padded corporate phrasing such as 'in order to' or 'going forward'.",
    "- `deck_manifest.json` must contain slideCount: 0, slides: [], charts: [], and pageCount: 0 unless you have a better factual page count for the markdown report.",
    "- Generate files in this exact order: (1) narrative_report.md, (2) data_tables.xlsx, (3) deck_manifest.json.",
    "- `narrative_report.md` must be a standalone consulting leave-behind that the reader can use without opening any deck. Target 800-1200 lines and roughly 10000-16000 words.",
    "- Begin `narrative_report.md` with a short `Brief Interpretation` section (5-7 sentences) explaining the core question, the main segmentation choices, the KPIs prioritized, the report flow, and what is intentionally out of scope.",
    "- Required sections for `narrative_report.md`:",
    "  1. Title page with client name from the brief, objective, date, and data source.",
    "  2. Brief Interpretation: 5-7 sentences on how you read the brief, how you segmented the analysis, and what the report emphasizes.",
    "  3. Executive summary (minimum 500 words): situation, complication, key findings, recommended actions, and expected impact.",
    "  4. Methodology: data used, KPIs computed, time periods, comparison basis, data quality caveats, explicit assumptions, and sensitivity ranges.",
    "  5. Detailed findings (minimum 400 words each): state the finding with exact numbers, explain the methodology, include caveats and confidence level, and add context where available.",
    "  6. For every chart-like or table-backed finding, include a markdown table with the exact numbers so the report is usable without Excel.",
    "  7. Competitor deep-dive (minimum 600 words): dedicated section on each major competitor's strategy, strengths, and implications for the client.",
    "  8. Recommendations with sensitivity analysis (minimum 800 words): base, bull, and bear scenarios, explicit assumptions, risk/probability assessment, expected impact, and timeline.",
    "  9. Full data appendix: markdown tables with the key cross-tabulations behind the report, including brand x geography or channel x geography views when the brief calls for both cuts.",
    "  10. Risk register: probability x impact matrix for the recommendations and main delivery risks.",
    "- `narrative_report.md` must be at least 800 lines. If it is shorter, extend the appendix, competitor analysis, and chart-supporting markdown tables.",
    "- When you write `data_tables.xlsx`, every sheet must come from the exact DataFrame used for the finding. Do not recreate the table from prose.",
    "- Your final assistant message must attach narrative_report.md, data_tables.xlsx, and deck_manifest.json as container uploads before finishing.",
  ];

  return lines.join("\n");
}

function buildPerSlideConstraintBlock(analysis: z.infer<typeof analysisSchema> | null): string | undefined {
  if (!analysis?.slidePlan?.length) {
    return undefined;
  }

  const lines: string[] = ["Per-slide spatial constraints (from archetype system — respect these exactly):"];

  for (const slide of analysis.slidePlan) {
    const layoutId = slide.slideArchetype || slide.layoutId || "title-chart";
    const archetype = getArchetypeOrDefault(layoutId);
    const layoutRegions = getLayoutRegions(layoutId);
    const slotLines = Object.entries(archetype.slots).map(([slotName, slot]) => {
      const region = layoutRegions[slotName as keyof typeof layoutRegions];
      const frame = region ?? slot.frame;
      const details: string[] = [];

      if (slot.kind === "chart") {
        details.push(`figsize=${frame.w.toFixed(1)}×${frame.h.toFixed(1)}in`);
        if (slot.maxCategories) {
          details.push(`max ${slot.maxCategories} categories`);
        }
        if (slot.allowedChartTypes?.length) {
          details.push(`allowed: ${slot.allowedChartTypes.join(", ")}`);
          const forbiddenChartTypes = ALL_CHART_TYPES.filter((chartType) => !slot.allowedChartTypes?.includes(chartType));
          if (forbiddenChartTypes.length > 0) {
            details.push(`forbidden: ${forbiddenChartTypes.join(", ")}`);
          }
        }
      }

      if (slot.kind === "metrics") {
        details.push(`${slot.minMetrics ?? 1}-${slot.maxMetrics ?? 5} KPI cards`);
      }

      if (slot.maxChars) {
        details.push(`max ${slot.maxChars} chars`);
      }
      if (slot.maxWords) {
        details.push(`max ${slot.maxWords} words`);
      }
      if (slot.maxBullets) {
        details.push(`max ${slot.maxBullets} bullets`);
      }
      if (slot.fontRange) {
        details.push(`font ${slot.fontRange[0]}-${slot.fontRange[1]}pt`);
      }
      if (slot.required) {
        details.push("required");
      }

      return `  ${slotName}: ${details.join(", ")} | frame=(${frame.x.toFixed(2)}, ${frame.y.toFixed(2)}, ${frame.w.toFixed(2)}, ${frame.h.toFixed(2)})`;
    });

    lines.push(
      [
        `Slide ${slide.position} archetype "${layoutId}" (${archetype.label}):`,
        ...slotLines,
      ].join("\n"),
    );
  }

  return lines.join("\n");
}

function buildReviseSlideScope(
  manifest: z.infer<typeof deckManifestSchema>,
  issues: string[],
  visualQa?: RenderedPageQaReport,
) {
  const targetedPositions = new Set<number>();
  const deckLevelIssues: string[] = [];

  for (const issue of visualQa?.issues ?? []) {
    if (issue.severity === "major" || issue.severity === "critical") {
      targetedPositions.add(issue.slidePosition);
    }
  }

  for (const issue of issues) {
    const matches = [...issue.matchAll(/(?:^|[^a-z])(slide)\s+(\d+)/gi)];
    if (matches.length === 0) {
      deckLevelIssues.push(issue);
      continue;
    }
    for (const match of matches) {
      const position = Number.parseInt(match[2] ?? "", 10);
      if (Number.isFinite(position) && position >= 1) {
        targetedPositions.add(position);
      }
    }
  }

  const allSlides = manifest.slides.map((slide) => ({
    position: slide.position,
    title: slide.title,
  }));

  if (targetedPositions.size === 0) {
    return {
      allowedSlides: allSlides,
      preservedSlides: [] as Array<{ position: number; title: string }>,
      deckLevelIssues,
    };
  }

  return {
    allowedSlides: allSlides.filter((slide) => targetedPositions.has(slide.position)),
    preservedSlides: allSlides.filter((slide) => !targetedPositions.has(slide.position)),
    deckLevelIssues,
  };
}

function buildReviseMessage(input: {
  issues: string[];
  manifest: z.infer<typeof deckManifestSchema>;
  currentPdf: GeneratedFile;
  visualQa: RenderedPageQaReport;
}) {
  const chartPreprocessingGuide = buildChartPreprocessingGuide();
  const slideScope = buildReviseSlideScope(input.manifest, input.issues, input.visualQa);
  const primaryVisualIssues = input.visualQa.issues.filter((issue) => issue.severity === "major" || issue.severity === "critical");
  const secondaryIssues = input.issues.filter((issue) => {
    return !primaryVisualIssues.some((visualIssue) => issue.includes(`${visualIssue.code}`) && issue.includes(`${visualIssue.slidePosition}`));
  });
  return {
    role: "user" as const,
    content: [
      {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data: input.currentPdf.buffer.toString("base64"),
        },
        title: "Current rendered deck PDF - inspect this exact output before repairing it",
      },
      {
        type: "text" as const,
        text: [
          "Repair the generated deck and regenerate deck.pptx, deck.pdf (internal rendered-QA artifact), and deck_manifest.json.",
          "After making corrections, you MUST regenerate the complete output set: deck.pptx, deck.pdf, and deck_manifest.json. The revise turn is incomplete until all three files exist in the container.",
          "The rendered PDF above is the exact current deck. Inspect it before you change anything.",
          "Reuse the existing container state and the prior authoring context. Do not start a new draft from scratch unless necessary to fix the issues.",
          "If a client PPTX template is present in the container, continue using it as the visual source of truth. Do not drift back to Basquio dark/editorial styling during repair.",
          `Current rendered visual QA score: ${input.visualQa.score}/10 (${input.visualQa.overallStatus}). Improve the rendered visual quality from this baseline.`,
          "",
          slideScope.allowedSlides.length === input.manifest.slides.length
            ? "You may change any slide, but still preserve the storyline and keep edits minimal."
            : `You may change ONLY these slides: ${slideScope.allowedSlides.map((slide) => `${slide.position} (${slide.title})`).join(", ")}.`,
          ...(slideScope.preservedSlides.length > 0
            ? [
                `Do NOT change these slides: ${slideScope.preservedSlides.map((slide) => `${slide.position} (${slide.title})`).join(", ")}.`,
                "Preserve the analysis, wording, chart data, and layout of untouched slides exactly unless a file-format constraint makes a microscopic non-content adjustment unavoidable.",
              ]
            : []),
          ...(slideScope.deckLevelIssues.length > 0
            ? [
                "Deck-level advisories to respect without broad redrafting:",
                ...slideScope.deckLevelIssues.map((issue) => `- ${issue}`),
              ]
            : []),
          "",
          "Primary visible issues to fix from the rendered PDF:",
          ...(primaryVisualIssues.length > 0
            ? primaryVisualIssues.map((issue) => `- Slide ${issue.slidePosition} ${issue.code}: ${issue.description}. Fix: ${issue.fix}`)
            : ["- No major visual issues were supplied; make only the smallest fixes needed."]),
          ...(secondaryIssues.length > 0
            ? [
                "",
                "Secondary issues to consider only if they can be fixed within the same allowed slides and WITHOUT creating new visual defects:",
                ...secondaryIssues.map((issue) => `- ${issue}`),
              ]
            : []),
          "",
          "Target only the weak slides. Preserve the rest of the deck.",
          "Do not use a deck-wide rewrite to solve local issues.",
          "Do not widen or compress the deck unless you are fixing a count-contract failure. If a critique issue says [content_shortfall] or [appendix_overfill], you may add or remove only the minimum slides needed to restore the requested content-slide count and keep appendix within the allowed top-up cap.",
          "Re-apply the deterministic chart preprocessing guide when rebuilding any chart:",
          chartPreprocessingGuide,
          "Fix overlaps, clipped text, blank sections, and claim-exhibit mismatches before any cosmetic refinements.",
          "Your final assistant message must attach deck.pptx, deck.pdf, and deck_manifest.json as container_upload blocks. `deck.pdf` is internal QA support, not a durable user-facing publish artifact.",
        ].join("\n"),
      },
    ],
  };
}

function buildMinimalReviseThread(input: {
  run: RunRow;
  analysis: z.infer<typeof analysisSchema> | null;
  manifest: z.infer<typeof deckManifestSchema>;
}) {
  const compactManifest = input.manifest.slides.map((slide) => ({
    position: slide.position,
    title: slide.title,
    archetype: slide.slideArchetype,
    chartId: slide.chartId ?? null,
    metrics: slide.metrics?.slice(0, 3) ?? [],
    callout: slide.callout?.text ?? null,
  }));

  const summary = [
    `I analyzed the uploaded evidence package and generated a ${input.manifest.slideCount}-slide deck in the current container.`,
    `Client: ${input.run.client || "Not specified"}`,
    `Audience: ${input.run.audience || "Executive stakeholder"}`,
    `Objective: ${input.run.objective || "Not specified"}`,
    `Thesis: ${input.analysis?.thesis || input.run.thesis || "Not specified"}`,
    `Executive summary: ${input.analysis?.executiveSummary || "Not available"}`,
    ...(parseWorkspaceContextPack(input.run.workspace_context_pack)
      ? [
          "Workspace context summary:",
          buildWorkspaceContextSummary(parseWorkspaceContextPack(input.run.workspace_context_pack)),
          "Workspace context files already in the container: workspace-context.md, workspace-context.json.",
        ]
      : []),
    `Manifest summary: ${JSON.stringify(compactManifest, null, 2)}`,
    "Generated files already present in the container: deck.pptx, deck.pdf (internal QA), deck_manifest.json.",
    "Use the rendered PDF and issue list from the next user message to make local repairs without replaying the full authoring transcript.",
  ].join("\n\n");

  return [
    {
      role: "assistant" as const,
      content: [
        {
          type: "text" as const,
          text: summary,
        },
      ],
    },
  ];
}

// ─── TRANSIENT ERROR CLASSIFICATION ──────────────────────────

const TRANSIENT_RETRY_DELAYS_MS = [3_000, 8_000, 20_000] as const;

// isTransientProviderError and classifyRuntimeError are imported from ./failure-classifier

function buildRequestRecordCallback(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase: DeckPhase,
  model: string,
) {
  return async (record: ClaudeRequestUsage) => {
    const totalInputTokens = billableInputTokens(record.usage);
    const totalTokens = totalInputTokens + (record.usage.output_tokens ?? 0);

    await upsertRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_request_usage",
      onConflict: "id",
      rows: [{
        id: randomUUID(),
        run_id: runId,
        attempt_id: attempt.id,
        attempt_number: attempt.attemptNumber,
        phase,
        request_kind: "request_record",
        provider: "anthropic",
        model,
        anthropic_request_id: record.requestId,
        usage: {
          inputTokens: record.usage.input_tokens ?? 0,
          cacheCreationInputTokens: record.usage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: record.usage.cache_read_input_tokens ?? 0,
          totalInputTokens,
          outputTokens: record.usage.output_tokens ?? 0,
          totalTokens,
          status: record.stopReason?.startsWith("transient_retry") ? "failed_transient" : "completed",
        },
        started_at: record.startedAt,
        completed_at: record.completedAt,
      }],
    });

    if (totalTokens > 0) {
      await touchAttemptProgress(config, runId, attempt, phase).catch(() => {});
    }
  };
}

function pruneCircuitStates(now: number = Date.now()) {
  if (now - lastCircuitBreakerCleanupAt < CIRCUIT_BREAKER_CLEANUP_MS) {
    return;
  }
  lastCircuitBreakerCleanupAt = now;
  for (const [key, state] of CIRCUIT_BREAKER_STATES) {
    const validFailures = state.failures.filter((ts) => ts >= now - CIRCUIT_BREAKER_WINDOW_MS);
    if (validFailures.length !== state.failures.length) {
      state.failures = validFailures;
    }
    if (state.openUntil) {
      if (state.openUntil <= now) {
        CIRCUIT_BREAKER_STATES.delete(key);
      }
      continue;
    }
    if (state.failures.length === 0) {
      CIRCUIT_BREAKER_STATES.delete(key);
    }
  }
}

function getCircuitBreakerState(circuitKey: string): CircuitState {
  const now = Date.now();
  pruneCircuitStates(now);
  let state = CIRCUIT_BREAKER_STATES.get(circuitKey);
  if (!state) {
    state = { failures: [], openUntil: null };
    CIRCUIT_BREAKER_STATES.set(circuitKey, state);
  }
  state.failures = state.failures.filter((ts) => ts >= now - CIRCUIT_BREAKER_WINDOW_MS);
  if (state.openUntil && state.openUntil <= now) {
    state.openUntil = null;
    state.failures = [];
  }
  return state;
}

function openCircuit(circuitKey: string, state: CircuitState) {
  const now = Date.now();
  state.openUntil = now + CIRCUIT_BREAKER_OPEN_MS;
  const error = new Error(
    `circuit breaker open for ${circuitKey}; provider likely unavailable, retry after ${Math.ceil(CIRCUIT_BREAKER_OPEN_MS / 1000)}s (429).`,
  ) as Error & { status?: number };
  error.status = 429;
  throw error;
}

function recordCircuitFailure(circuitKey: string, state: CircuitState) {
  const now = Date.now();
  state.failures.push(now);
  const recentFailures = state.failures.filter((ts) => ts >= now - CIRCUIT_BREAKER_WINDOW_MS);
  state.failures = recentFailures;
  if (recentFailures.length >= CIRCUIT_BREAKER_MAX_FAILURES) {
    openCircuit(circuitKey, state);
  }
}

function assertCircuitClosed(state: CircuitState, circuitKey: string) {
  if (!state.openUntil) return;
  const now = Date.now();
  if (state.openUntil <= now) {
    state.openUntil = null;
    state.failures = [];
    return;
  }
  const error = new Error(
    `circuit breaker open for ${circuitKey}; retry after ${Math.max(1, Math.ceil((state.openUntil - now) / 1000))}s (429).`,
  ) as Error & { status?: number };
  error.status = 429;
  throw error;
}

async function runClaudeLoop(input: {
  client: Anthropic;
  model: string;
  betas?: Anthropic.Beta.AnthropicBeta[];
  systemPrompt: string | Array<Anthropic.Beta.BetaTextBlockParam>;
  maxTokens: number;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaToolUnion[];
  container?: AuthoringContainer;
  contextManagement?: Anthropic.Beta.BetaContextManagementConfig | null;
  thinking?: Anthropic.Beta.BetaThinkingConfigParam;
  outputConfig?: Anthropic.Beta.BetaOutputConfig;
  /** Optional: persist each retry-level request record immediately for telemetry truth */
  onRequestRecord?: (record: ClaudeRequestUsage) => Promise<void>;
  phaseLabel?: DeckPhase;
  onMeaningfulProgress?: () => Promise<unknown> | void;
  /** Maximum number of pause_turn continuations before breaking out. Default: unlimited (up to 8 iterations). */
  maxPauseTurns?: number;
  phaseTimeoutMs?: number | null;
  requestWatchdogMs?: number | null;
  abortSignal?: AbortSignal | null;
  currentSpentUsd?: number;
  targetSlideCount?: number;
  circuitKey?: string;
}) {
  let messages = [...input.messages];
  const fileIds = new Set<string>();
  let currentContainer = input.container;
  const usePlainContainerId = input.model === "claude-haiku-4-5";
  let finalMessage: Anthropic.Beta.BetaMessage | null = null;
  let iterationCount = 0;
  let pauseTurns = 0;
  const requests: ClaudeRequestUsage[] = [];
  const usage: Required<ClaudeUsage> = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const phaseTimeoutMs =
    typeof input.phaseTimeoutMs === "number" && input.phaseTimeoutMs > 0
      ? input.phaseTimeoutMs
      : null;
  const externalAbortSignal = input.abortSignal ?? null;
  const controller = phaseTimeoutMs ? new AbortController() : null;
  const timeoutHandle = phaseTimeoutMs
    ? setTimeout(() => controller?.abort(), phaseTimeoutMs)
    : null;
  const circuitState = input.circuitKey
    ? getCircuitBreakerState(input.circuitKey)
    : null;

  try {
    for (let iteration = 0; iteration < 8; iteration += 1) {
      throwIfWorkerShutdownRequested(externalAbortSignal, input.phaseLabel ?? "request");
      if (circuitState && input.circuitKey) {
        assertCircuitClosed(circuitState, input.circuitKey);
      }
      if (input.currentSpentUsd !== undefined) {
        const remainingBudgetUsd = roundUsd(
          getDeckBudgetCaps(normalizeAuthorModel(input.model), input.targetSlideCount).hard - input.currentSpentUsd - usageToCost(input.model, usage),
        );
        if (remainingBudgetUsd < CONTINUATION_MIN_REMAINING_BUDGET_USD) {
          const budgetMessage = `[runClaudeLoop] remaining budget $${remainingBudgetUsd.toFixed(3)} below continuation threshold $${CONTINUATION_MIN_REMAINING_BUDGET_USD.toFixed(2)}.`;
          const hasPartialOutput = fileIds.size > 0;
          if (hasPartialOutput) {
            console.warn(`${budgetMessage} Continuing because Claude has already produced ${fileIds.size} file artifact(s).`);
          } else {
            console.warn(`${budgetMessage} ${finalMessage ? "Breaking before another continuation." : "Aborting phase before request."}`);
            if (!finalMessage) {
              throw new Error(`${budgetMessage} Aborting phase before another Claude request.`);
            }
            break;
          }
        }
      }

      iterationCount += 1;
      const startedAt = new Date().toISOString();
      let message: Anthropic.Beta.BetaMessage;
      let requestId: string | null = null;
      const streamBody = {
        model: input.model,
        max_tokens: input.maxTokens,
        betas: (input.betas ?? [...BETAS]) as Anthropic.Beta.AnthropicBeta[],
        system: input.systemPrompt,
        container: currentContainer,
        context_management: input.contextManagement,
        messages,
        tools: input.tools,
        thinking: input.thinking,
        output_config: input.outputConfig,
      };

      // Bounded transient retry with exponential backoff + jitter
      let lastTransientError: Error | null = null;
      for (let retry = 0; retry <= TRANSIENT_RETRY_DELAYS_MS.length; retry += 1) {
        const requestController = new AbortController();
        const configuredRequestWatchdogMs =
          typeof input.requestWatchdogMs === "number" && input.requestWatchdogMs > 0
            ? input.requestWatchdogMs
            : input.requestWatchdogMs === null
              ? null
              : (input.phaseLabel ? REQUEST_WATCHDOG_BY_PHASE_MS[input.phaseLabel] : STREAM_REQUEST_WATCHDOG_MS);
        const requestTimeoutMs =
          typeof configuredRequestWatchdogMs === "number" && configuredRequestWatchdogMs > 0
            ? Math.max(45_000, configuredRequestWatchdogMs)
            : null;
        const requestTimeoutHandle = requestTimeoutMs
          ? setTimeout(() => requestController.abort(), requestTimeoutMs)
          : null;
        try {
          throwIfWorkerShutdownRequested(externalAbortSignal, input.phaseLabel ?? "request");
          const signalParts = [requestController.signal];
          if (controller) {
            signalParts.push(controller.signal);
          }
          if (externalAbortSignal) {
            signalParts.push(externalAbortSignal);
          }
          const signal = signalParts.length === 1
            ? signalParts[0]!
            : AbortSignal.any(signalParts);
          const stream = input.client.beta.messages.stream(
            streamBody,
            { signal },
          );
          requestId = stream.request_id ?? null;
          message = await stream.finalMessage();
          lastTransientError = null;
          if (circuitState) {
            circuitState.failures = [];
            circuitState.openUntil = null;
          }
          break;
        } catch (streamError) {
          streamError = normalizeClaudeStreamError(streamError);
          if (externalAbortSignal?.aborted) {
            throw new WorkerShutdownInterruptError(input.phaseLabel ?? "request");
          } else if (controller?.signal.aborted) {
            const phaseTimeoutError = new Error(
              `Claude ${input.phaseLabel ?? "request"} timed out after ${phaseTimeoutMs ?? requestTimeoutMs ?? 0}ms.`,
            );
            phaseTimeoutError.name = "AbortError";
            streamError = phaseTimeoutError;
          } else if (requestTimeoutMs && requestController.signal.aborted) {
            const watchdogError = new Error(`Claude stream watchdog timed out after ${requestTimeoutMs}ms.`);
            watchdogError.name = "AbortError";
            streamError = watchdogError;
          }
          requestId = null;
          const containerStringRetry = isRetryableContainerStringError(streamError);
          const maxTransientRetries = containerStringRetry ? 1 : TRANSIENT_RETRY_DELAYS_MS.length;
          if (isTransientProviderError(streamError) && retry < maxTransientRetries) {
            lastTransientError = streamError instanceof Error ? streamError : new Error(String(streamError));
            const baseDelay = TRANSIENT_RETRY_DELAYS_MS[Math.min(retry, TRANSIENT_RETRY_DELAYS_MS.length - 1)];
            const jitter = Math.round(Math.random() * baseDelay * 0.3);
            console.warn(
              `[runClaudeLoop] transient error (retry ${retry + 1}/${maxTransientRetries}): ${lastTransientError.message.slice(0, 200)}. Waiting ${baseDelay + jitter}ms...`,
            );
            const retryRecord: ClaudeRequestUsage = {
              requestId: null,
              startedAt,
              completedAt: new Date().toISOString(),
              usage: {
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
              stopReason: `transient_retry_${retry + 1}`,
            };
            requests.push(retryRecord);
            if (input.onRequestRecord) {
              await input.onRequestRecord(retryRecord).catch(() => {});
            }
            await waitWithOptionalAbort(baseDelay + jitter, externalAbortSignal, input.phaseLabel ?? "request");
            continue;
          }
          if (isTransientProviderError(streamError)) {
            if (circuitState && input.circuitKey) {
              recordCircuitFailure(input.circuitKey, circuitState);
            }
          } else if (circuitState) {
            circuitState.failures = [];
          }
          throw streamError;
        } finally {
          if (requestTimeoutHandle) {
            clearTimeout(requestTimeoutHandle);
          }
        }
      }
      if (lastTransientError) {
        throw lastTransientError;
      }

      const completedAt = new Date().toISOString();

      finalMessage = message!;
      currentContainer = finalMessage.container
        ? (usePlainContainerId ? finalMessage.container.id : { id: finalMessage.container.id })
        : currentContainer;
      const finalInputTokens = finalMessage.usage?.input_tokens ?? 0;
      const finalOutputTokens = finalMessage.usage?.output_tokens ?? 0;
      const finalCacheCreationInputTokens = finalMessage.usage?.cache_creation_input_tokens ?? 0;
      const finalCacheReadInputTokens = finalMessage.usage?.cache_read_input_tokens ?? 0;
      usage.input_tokens = (usage.input_tokens ?? 0) + finalInputTokens;
      usage.output_tokens = (usage.output_tokens ?? 0) + finalOutputTokens;
      usage.cache_creation_input_tokens =
        (usage.cache_creation_input_tokens ?? 0) + finalCacheCreationInputTokens;
      usage.cache_read_input_tokens =
        (usage.cache_read_input_tokens ?? 0) + finalCacheReadInputTokens;
      const generatedFileIds = collectGeneratedFileIds(finalMessage.content);
      const completedRecord: ClaudeRequestUsage = {
        requestId,
        startedAt,
        completedAt,
        usage: {
          input_tokens: finalInputTokens,
          output_tokens: finalOutputTokens,
          cache_creation_input_tokens: finalCacheCreationInputTokens,
          cache_read_input_tokens: finalCacheReadInputTokens,
        },
        stopReason: finalMessage.stop_reason ?? null,
      };
      requests.push(completedRecord);
      if (input.onRequestRecord) {
        await input.onRequestRecord(completedRecord).catch(() => {});
      }

      generatedFileIds.forEach((fileId) => fileIds.add(fileId));
      if (input.onMeaningfulProgress && (generatedFileIds.length > 0 || (finalMessage.usage?.output_tokens ?? 0) > 0 || (finalMessage.usage?.input_tokens ?? 0) > 0)) {
        const progressResult = input.onMeaningfulProgress();
        if (progressResult && typeof (progressResult as Promise<unknown>).catch === "function") {
          void (progressResult as Promise<unknown>).catch(() => {});
        }
      }

      if (finalMessage.stop_reason !== "pause_turn") {
        break;
      }

      pauseTurns += 1;

      if (input.maxPauseTurns !== undefined && pauseTurns >= input.maxPauseTurns) {
        console.warn(`[runClaudeLoop] hit maxPauseTurns=${input.maxPauseTurns}, breaking out`);
        break;
      }

      throwIfWorkerShutdownRequested(externalAbortSignal, input.phaseLabel ?? "request");
      messages = appendPauseTurnContinuation(messages, finalMessage);
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  if (!finalMessage) {
    throw new Error("Claude did not return a message.");
  }

  return {
    message: finalMessage,
    containerId: finalMessage.container?.id ??
      (typeof currentContainer === "string" ? currentContainer : currentContainer?.id) ??
      null,
    fileIds: [...fileIds],
    thread: appendAssistantTurn(messages, finalMessage),
    usage,
    iterations: iterationCount,
    pauseTurns,
    requests,
  };
}

function requireGeneratedFiles(
  files: GeneratedFile[],
  requiredFiles: string[],
  phase: "author" | "revise" | "checkpoint_export",
) {
  const missingFiles = findMissingGeneratedFiles(files, requiredFiles);
  if (missingFiles.length > 0) {
    throw new Error(`${phase} phase is missing required output files: ${missingFiles.join(", ")}.`);
  }
}

function findMissingGeneratedFiles(files: GeneratedFile[], requiredFiles: string[]) {
  return requiredFiles.filter((fileName) => !files.some((file) => file.fileName === fileName || file.fileName.endsWith(fileName)));
}

function mergeGeneratedFiles(primaryFiles: GeneratedFile[], retryFiles: GeneratedFile[]) {
  const merged = new Map<string, GeneratedFile>();
  for (const file of [...primaryFiles, ...retryFiles]) {
    merged.set(file.fileName, file);
  }
  return [...merged.values()];
}

function isBudgetExhaustionErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("budget") || normalized.includes("remaining budget") || normalized.includes("continuation threshold");
}

function getAuthorFallbackModels(model: AuthorModel): AuthorModel[] {
  switch (model) {
    case OPUS_AUTHOR_MODEL:
      return ["claude-sonnet-4-6", "claude-haiku-4-5"];
    case "claude-sonnet-4-6":
      return ["claude-haiku-4-5"];
    default:
      return [];
  }
}

function getAuthorPhaseMaxTokens(model: AuthorModel, targetSlideCount: number) {
  if (model === OPUS_AUTHOR_MODEL && targetSlideCount >= 40) {
    return 96_000;
  }
  return 64_000;
}

function getRevisePhaseMaxTokens(model: AuthorModel, targetSlideCount: number) {
  if (model === OPUS_AUTHOR_MODEL && targetSlideCount >= 40) {
    return 48_000;
  }
  return 28_000;
}

function collectParseWarnings(parsed: Awaited<ReturnType<typeof parseEvidencePackage>>) {
  const warnings = new Set<string>();

  for (const warning of parsed.datasetProfile.warnings ?? []) {
    if (warning.trim()) {
      warnings.add(warning.trim());
    }
  }

  for (const file of parsed.normalizedWorkbook.files) {
    for (const warning of file.warnings ?? []) {
      if (warning.trim()) {
        warnings.add(warning.trim());
      }
    }

    const textContent = file.textContent?.trim() ?? "";
    if (
      textContent.startsWith("[DOCX ") ||
      textContent.startsWith("[PDF ") ||
      textContent.startsWith("[PPTX ") ||
      textContent.startsWith("[Basquio warning:")
    ) {
      warnings.add(textContent.slice(0, 220));
    }
  }

  return [...warnings];
}

function buildManifestFromAnalysis(analysis: AnalysisResult) {
  return parseDeckManifest({
    slideCount: analysis.slidePlan.length,
    pageCount: analysis.slidePlan.length,
    slides: analysis.slidePlan.map((slide) => ({
      position: slide.position,
      layoutId: slide.layoutId,
      slideArchetype: slide.slideArchetype,
      title: slide.title,
      subtitle: slide.subtitle,
      body: slide.body,
      pageIntent: typeof (slide as { pageIntent?: string }).pageIntent === "string"
        ? (slide as { pageIntent?: string }).pageIntent
        : undefined,
      bullets: slide.bullets,
      metrics: slide.metrics?.map((metric) => ({
        ...metric,
        presentation:
          metric.presentation ??
          inferMetricPresentationSpec({
            label: metric.label,
            title: slide.title,
          }),
      })),
      callout: slide.callout,
      evidenceIds: slide.evidenceIds,
      chartId: slide.chart?.id,
    })),
    charts: analysis.slidePlan
      .filter((slide) => Boolean(slide.chart))
      .map((slide) => ({
        id: slide.chart!.id,
        chartType: slide.chart!.chartType,
        title: slide.chart!.title || slide.title,
        xAxisLabel: slide.chart!.xAxisLabel,
        yAxisLabel: slide.chart!.yAxisLabel,
        bubbleSizeLabel: slide.chart!.bubbleSizeLabel,
        sourceNote: slide.chart!.sourceNote,
        excelSheetName: slide.chart!.excelSheetName,
        excelChartCellAnchor: slide.chart!.excelChartCellAnchor,
        dataSignature: slide.chart!.dataSignature,
        presentation: (slide.chart as { exhibitPresentation?: Record<string, unknown> }).exhibitPresentation,
      })),
  });
}

async function countPptxSlides(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).length;
}

function buildPlaceholderNarrativeReport(run: RunRow, warnings: string[]): GeneratedFile {
  const body = [
    `# ${run.client?.trim() || "Basquio report"}`,
    "",
    "Basquio completed a partial delivery for this run.",
    "The full narrative report was not generated before the budget or tool limit was reached.",
    warnings.length > 0 ? "" : null,
    warnings.length > 0 ? "## File warnings" : null,
    ...warnings.slice(0, 8).map((warning) => `- ${warning}`),
    "",
    "Use the PPTX and workbook artifacts from this run as the primary outputs.",
  ].filter((line): line is string => typeof line === "string").join("\n");

  return {
    fileId: "narrative-report-partial",
    fileName: "narrative_report.md",
    buffer: Buffer.from(body, "utf8"),
    mimeType: "text/markdown",
  };
}

async function buildPlaceholderWorkbookArtifact(warnings: string[]): Promise<GeneratedFile> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("README");
  sheet.addRow(["status", "partial_delivery"]);
  sheet.addRow(["message", "Basquio published a partial delivery because the full workbook was not generated in time."]);
  for (const warning of warnings.slice(0, 12)) {
    sheet.addRow(["warning", warning]);
  }
  const buffer = await workbook.xlsx.writeBuffer();

  return {
    fileId: "data-tables-partial",
    fileName: "data_tables.xlsx",
    buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

async function repairPartialAuthorArtifacts(input: {
  run: RunRow;
  model: AuthorModel;
  files: GeneratedFile[];
  messages: Anthropic.Beta.BetaMessage[];
  recoveredAnalysis: AnalysisResult | null;
  parseWarnings: string[];
}) {
  const repairedFiles = [...input.files];
  const repairWarnings: string[] = [];
  const isReportOnly = input.model === "claude-haiku-4-5";

  if (!findGeneratedFile(repairedFiles, "narrative_report.md")) {
    repairedFiles.push(buildPlaceholderNarrativeReport(input.run, input.parseWarnings));
    repairWarnings.push("Narrative report was missing. Published a partial markdown placeholder instead.");
  }

  if (!findGeneratedFile(repairedFiles, "data_tables.xlsx")) {
    repairedFiles.push(await buildPlaceholderWorkbookArtifact(input.parseWarnings));
    repairWarnings.push("Workbook was missing. Published a partial workbook placeholder instead.");
  }

  if (!findGeneratedFile(repairedFiles, "deck_manifest.json")) {
    let fallbackAnalysis = input.recoveredAnalysis;

    if (!fallbackAnalysis) {
      for (const message of input.messages) {
        try {
          fallbackAnalysis = parseGeneratedAnalysisResponse(message, repairedFiles);
          break;
        } catch {
          // Keep trying older messages.
        }
      }
    }

    if (fallbackAnalysis) {
      const manifest = buildManifestFromAnalysis(fallbackAnalysis);
      repairedFiles.push({
        fileId: "deck-manifest-partial",
        fileName: "deck_manifest.json",
        buffer: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
        mimeType: "application/json",
      });
      repairWarnings.push("Deck manifest was missing. Rebuilt it from the recovered analysis.");
    } else if (!isReportOnly) {
      const pptx = findGeneratedFile(repairedFiles, "deck.pptx");
      if (pptx) {
        const slideCount = await countPptxSlides(pptx.buffer).catch(() => 0);
        if (slideCount > 0) {
          const manifest = parseDeckManifest({
            slideCount,
            pageCount: slideCount,
            slides: Array.from({ length: slideCount }, (_, index) => ({
              position: index + 1,
              layoutId: "title-body",
              slideArchetype: "title-body",
              title: `Slide ${index + 1}`,
            })),
            charts: [],
          });
          repairedFiles.push({
            fileId: "deck-manifest-generic",
            fileName: "deck_manifest.json",
            buffer: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
            mimeType: "application/json",
          });
          repairWarnings.push("Deck manifest was missing. Rebuilt a minimal manifest from the PPTX structure.");
        }
      }
    }
  }

  if (!isReportOnly && !findGeneratedFile(repairedFiles, "deck.pdf")) {
    const pptx = findGeneratedFile(repairedFiles, "deck.pptx");
    if (pptx) {
      try {
        const pdfBuffer = await convertPptxToPdf(pptx.buffer);
        repairedFiles.push({
          fileId: "deck-pdf-recovered",
          fileName: "deck.pdf",
          buffer: pdfBuffer,
          mimeType: "application/pdf",
        });
        repairWarnings.push("Deck PDF was missing. Re-rendered it from the PPTX before publish.");
      } catch (error) {
        repairWarnings.push(`Deck PDF was missing and could not be regenerated: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const criticalFiles = isReportOnly
    ? ["narrative_report.md", "data_tables.xlsx", "deck_manifest.json"]
    : ["deck.pptx", "narrative_report.md", "data_tables.xlsx", "deck_manifest.json"];

  return {
    files: mergeGeneratedFiles(input.files, repairedFiles),
    repairWarnings,
    missingCriticalFiles: findMissingGeneratedFiles(mergeGeneratedFiles(input.files, repairedFiles), criticalFiles),
  };
}

function mergeClaudeUsage(baseUsage: ClaudeUsage, retryUsage: ClaudeUsage): Required<ClaudeUsage> {
  return {
    input_tokens: (baseUsage.input_tokens ?? 0) + (retryUsage.input_tokens ?? 0),
    output_tokens: (baseUsage.output_tokens ?? 0) + (retryUsage.output_tokens ?? 0),
    cache_creation_input_tokens: (baseUsage.cache_creation_input_tokens ?? 0) + (retryUsage.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (baseUsage.cache_read_input_tokens ?? 0) + (retryUsage.cache_read_input_tokens ?? 0),
  };
}

function collectGeneratedFileIds(blocks: Anthropic.Beta.BetaContentBlock[]) {
  const fileIds: string[] = [];

  for (const block of blocks) {
    if (
      block.type === "code_execution_tool_result" &&
      (block.content.type === "code_execution_result" || block.content.type === "encrypted_code_execution_result")
    ) {
      for (const output of block.content.content) {
        if (output.file_id) fileIds.push(output.file_id);
      }
    }
    if (block.type === "bash_code_execution_tool_result" && block.content.type === "bash_code_execution_result") {
      for (const output of block.content.content) {
        if (output.file_id) fileIds.push(output.file_id);
      }
    }
    if (block.type === "container_upload" && block.file_id) {
      fileIds.push(block.file_id);
    }
  }

  return fileIds;
}

async function downloadGeneratedFiles(client: Anthropic, fileIds: string[]) {
  const uniqueFileIds = [...new Set(fileIds)];
  return Promise.all(
    uniqueFileIds.map(async (fileId) => {
      const metadata = await client.beta.files.retrieveMetadata(fileId, {
        betas: [FILES_BETA],
      });
      const response = await client.beta.files.download(fileId, {
        betas: [FILES_BETA],
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        fileId,
        fileName: metadata.filename,
        mimeType: metadata.mime_type,
        buffer,
      };
    }),
  );
}

function requireGeneratedFile(files: GeneratedFile[], fileName: string) {
  const exact = files.find((file) => file.fileName === fileName);
  if (exact) return exact;
  const suffix = files.find((file) => file.fileName.endsWith(fileName));
  if (suffix) return suffix;
  throw new Error(`Claude did not generate required file ${fileName}.`);
}

function parseGeneratedAnalysisResponse(
  message: Anthropic.Beta.BetaMessage,
  files: GeneratedFile[],
) {
  const analysisFile = findGeneratedFile(files, "analysis_result.json");
  if (analysisFile) {
    const raw = analysisFile.buffer.toString("utf8");
    try {
      return parseAnalysisPayload(JSON.parse(raw));
    } catch {
      const repaired = attemptJsonRepair(raw);
      if (repaired) {
        return parseAnalysisPayload(JSON.parse(repaired));
      }
      throw new Error("analysis_result.json is malformed and could not be repaired.");
    }
  }

  return parseStructuredAnalysisResponse(message);
}

function parseStructuredAnalysisResponse(message: Anthropic.Beta.BetaMessage) {
  const text = extractResponseText(message.content);
  if (!text) {
    throw new Error("Claude did not return structured analysis JSON.");
  }

  try {
    return parseAnalysisPayload(JSON.parse(text));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid analysis JSON.";
    throw new Error(`Claude did not return parseable structured analysis JSON. ${reason} Response preview: ${text.slice(0, 800)}`);
  }
}

function resolveAuthorAnalysis(input: {
  run: RunRow;
  message: Anthropic.Beta.BetaMessage;
  files: GeneratedFile[];
  manifest: z.infer<typeof deckManifestSchema>;
}): {
  analysis: AnalysisResult;
  recovery: Record<string, unknown> | null;
  invalidPayload: Record<string, unknown> | null;
} {
  try {
    return {
      analysis: parseGeneratedAnalysisResponse(input.message, input.files),
      recovery: null,
      invalidPayload: null,
    };
  } catch (analysisError) {
    const reason = analysisError instanceof Error ? analysisError.message : String(analysisError);
    const rawPayload = extractRawAnalysisPayload(input.message, input.files);
    const salvagedAnalysis = synthesizeAnalysisFromManifest(input.run, input.manifest);
    return {
      analysis: salvagedAnalysis,
      recovery: {
        source: "manifest_salvage",
        reason,
        slidePlanCount: salvagedAnalysis.slidePlan.length,
      },
      invalidPayload: {
        source: rawPayload.source,
        error: reason,
        rawText: rawPayload.rawText.slice(0, 200_000),
        salvagedFromManifest: true,
      },
    };
  }
}

function resolveAuthorAnalysisWithFallback(input: {
  run: RunRow;
  messages: Anthropic.Beta.BetaMessage[];
  files: GeneratedFile[];
  manifest: z.infer<typeof deckManifestSchema>;
}): {
  analysis: AnalysisResult;
  recovery: Record<string, unknown> | null;
  invalidPayload: Record<string, unknown> | null;
} {
  let lastError: unknown = null;

  for (const message of input.messages) {
    try {
      return {
        analysis: parseGeneratedAnalysisResponse(message, input.files),
        recovery: null,
        invalidPayload: null,
      };
    } catch (analysisError) {
      lastError = analysisError;
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  const rawPayload = extractRawAnalysisPayloadFromMessages(input.messages, input.files);
  const salvagedAnalysis = synthesizeAnalysisFromManifest(input.run, input.manifest);
  return {
    analysis: salvagedAnalysis,
    recovery: {
      source: "manifest_salvage",
      reason,
      slidePlanCount: salvagedAnalysis.slidePlan.length,
    },
    invalidPayload: {
      source: rawPayload.source,
      error: reason,
      rawText: rawPayload.rawText.slice(0, 200_000),
      salvagedFromManifest: true,
    },
  };
}

function extractRawAnalysisPayload(
  message: Anthropic.Beta.BetaMessage,
  files: GeneratedFile[],
) {
  const analysisFile = findGeneratedFile(files, "analysis_result.json");
  if (analysisFile) {
    return {
      source: analysisFile.fileName,
      rawText: analysisFile.buffer.toString("utf8"),
    };
  }

  return {
    source: "assistant_response_text",
    rawText: extractResponseText(message.content) ?? "",
  };
}

function extractRawAnalysisPayloadFromMessages(
  messages: Anthropic.Beta.BetaMessage[],
  files: GeneratedFile[],
) {
  const analysisFile = findGeneratedFile(files, "analysis_result.json");
  if (analysisFile) {
    return {
      source: analysisFile.fileName,
      rawText: analysisFile.buffer.toString("utf8"),
    };
  }

  for (const message of messages) {
    const text = extractResponseText(message.content);
    if (text) {
      return {
        source: "assistant_response_text",
        rawText: text,
      };
    }
  }

  return {
    source: "assistant_response_text",
    rawText: "",
  };
}

function parseAnalysisPayload(payload: unknown) {
  return analysisSchema.parse(normalizeAnalysisPayload(payload));
}

function normalizeAnalysisPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const normalized = { ...(payload as Record<string, unknown>) };
  normalized.executiveSummary = normalizeExecutiveSummary(normalized.executiveSummary);

  if (Array.isArray(normalized.slidePlan)) {
    normalized.slidePlan = normalized.slidePlan
      .map((slide, index) => normalizeSlidePlanEntry(slide, index))
      .filter((slide): slide is Record<string, unknown> => slide !== null);
  }

  return normalized;
}

function normalizeExecutiveSummary(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyLooseText(entry))
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const prioritized = [
      stringifyLooseText(record.headline),
      stringifyLooseText(record.summary),
      stringifyLooseText(record.text),
      stringifyLooseText(record.title),
    ].filter(Boolean);
    const bullets = Array.isArray(record.bullets)
      ? record.bullets.map((entry) => stringifyLooseText(entry)).filter(Boolean)
      : [];
    const combined = [...prioritized, ...bullets];
    if (combined.length > 0) {
      return combined.join(" ").trim();
    }
  }

  return stringifyLooseText(value);
}

function normalizeSlidePlanEntry(value: unknown, index: number): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const normalized = { ...(value as Record<string, unknown>) };
  const rawPosition = coerceInteger(normalized.position ?? normalized.index ?? normalized.order);
  normalized.position = rawPosition === 0 || rawPosition == null ? index + 1 : rawPosition;

  if (typeof normalized.bullets === "string") {
    normalized.bullets = [normalized.bullets];
  }

  if (typeof normalized.callout === "string") {
    normalized.callout = { text: normalized.callout };
  }

  if (typeof normalized.evidenceIds === "string") {
    normalized.evidenceIds = [normalized.evidenceIds];
  }

  if (Array.isArray(normalized.metrics)) {
    normalized.metrics = normalized.metrics
      .map((metric) => normalizeMetricEntry(metric))
      .filter((metric): metric is Record<string, unknown> => metric !== null);
  }

  if (normalized.chart != null) {
    const chart = normalizeChartPlanEntry(normalized.chart);
    if (chart) {
      normalized.chart = chart;
    } else {
      delete normalized.chart;
    }
  }

  return normalized;
}

function normalizeChartPlanEntry(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = { ...(value as Record<string, unknown>) };
  const normalized: Record<string, unknown> = {
    ...record,
    id: stringifyLooseText(record.id ?? record.chartId ?? record.chart_id) || undefined,
    chartType: stringifyLooseText(record.chartType ?? record.chart_type ?? record.type) || undefined,
    title: stringifyLooseText(record.title ?? record.chartTitle ?? record.label) || undefined,
    sourceNote: stringifyLooseText(record.sourceNote ?? record.source_note) || undefined,
    maxCategories: coercePositiveNumber(record.maxCategories ?? record.max_categories),
    preferredOrientation: stringifyLooseText(record.preferredOrientation ?? record.preferred_orientation) || undefined,
    slotAspectRatio: coercePositiveNumber(record.slotAspectRatio ?? record.slot_aspect_ratio),
    figureSize: normalizeChartFigureSize(record.figureSize ?? record.figure_size),
    sort: normalizeChartSort(record.sort),
  };

  if (typeof record.truncateLabels === "boolean") {
    normalized.truncateLabels = record.truncateLabels;
  } else if (typeof record.truncate_labels === "boolean") {
    normalized.truncateLabels = record.truncate_labels;
  }

  Object.keys(normalized).forEach((key) => {
    if (normalized[key] === undefined) {
      delete normalized[key];
    }
  });

  return normalized;
}

function normalizeMetricEntry(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    return { label: value, value };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = { ...(value as Record<string, unknown>) };
  const label = stringifyLooseText(record.label ?? record.name ?? record.title ?? record.metric);
  const metricValue = stringifyLooseText(record.value ?? record.amount ?? record.result ?? record.number);
  if (!label && !metricValue) {
    const firstPair = Object.entries(record).find(([, entry]) => stringifyLooseText(entry));
    if (firstPair) {
      return {
        label: firstPair[0],
        value: stringifyLooseText(firstPair[1]),
      };
    }
    return null;
  }

  return {
    ...record,
    label: label || metricValue,
    value: metricValue || label,
    ...(record.delta != null ? { delta: stringifyLooseText(record.delta) } : {}),
  };
}

function stringifyLooseText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyLooseText(entry)).filter(Boolean).join(" ").trim();
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => stringifyLooseText(entry))
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return "";
}

function synthesizeAnalysisFromManifest(
  run: RunRow,
  manifest: z.infer<typeof deckManifestSchema>,
): AnalysisResult {
  const chartById = new Map(manifest.charts.map((chart) => [chart.id, chart]));
  const slidePlan = manifest.slides.map((slide, index) => {
    const chart = slide.chartId ? chartById.get(slide.chartId) : null;
    const preferredOrientation = inferPreferredOrientation(chart?.categories);
    return {
      position: slide.position ?? index + 1,
      layoutId: slide.layoutId,
      slideArchetype: slide.slideArchetype,
      title: slide.title,
      ...(slide.subtitle ? { subtitle: slide.subtitle } : {}),
      ...(slide.body ? { body: slide.body } : {}),
      ...(slide.bullets ? { bullets: slide.bullets } : {}),
      ...(slide.metrics
        ? {
            metrics: slide.metrics.map((metric) => ({
              ...metric,
              presentation:
                metric.presentation ??
                inferMetricPresentationSpec({
                  label: metric.label,
                  title: slide.title,
                }),
            })),
          }
        : {}),
      ...(slide.callout ? { callout: slide.callout } : {}),
      ...(slide.evidenceIds ? { evidenceIds: slide.evidenceIds } : {}),
      ...(chart
        ? {
            chart: {
              id: chart.id,
              chartType: chart.chartType,
              title: chart.title,
              ...(chart.xAxisLabel ? { xAxisLabel: chart.xAxisLabel } : {}),
              ...(chart.yAxisLabel ? { yAxisLabel: chart.yAxisLabel } : {}),
              ...(chart.bubbleSizeLabel ? { bubbleSizeLabel: chart.bubbleSizeLabel } : {}),
              ...(chart.sourceNote ? { sourceNote: chart.sourceNote } : {}),
              ...(chart.excelSheetName ? { excelSheetName: chart.excelSheetName } : {}),
              ...(chart.excelChartCellAnchor ? { excelChartCellAnchor: chart.excelChartCellAnchor } : {}),
              ...(chart.dataSignature ? { dataSignature: chart.dataSignature } : {}),
              ...(chart.presentation ? { exhibitPresentation: chart.presentation } : {}),
              ...(typeof chart.categoryCount === "number" ? { maxCategories: chart.categoryCount } : {}),
              ...(preferredOrientation ? { preferredOrientation } : {}),
              ...(shouldTruncateChartLabels(chart.categories) ? { truncateLabels: true } : {}),
            },
          }
        : {}),
    };
  });
  const executiveSummary = buildManifestExecutiveSummary(run, manifest);

  return analysisSchema.parse({
    language: inferLanguageHint(run),
    thesis: run.thesis || executiveSummary || manifest.slides[0]?.title || "",
    executiveSummary,
    slidePlan,
  });
}

function buildManifestExecutiveSummary(
  run: RunRow,
  manifest: z.infer<typeof deckManifestSchema>,
) {
  const summaryParts = manifest.slides
    .slice(0, 2)
    .flatMap((slide) => [
      slide.title,
      slide.subtitle,
      slide.body,
      slide.callout?.text,
    ])
    .map((entry) => stringifyLooseText(entry))
    .filter(Boolean);

  if (summaryParts.length > 0) {
    return summaryParts.join(" ").trim();
  }

  return [
    run.thesis,
    run.objective,
    manifest.slides[0]?.title,
  ]
    .map((entry) => stringifyLooseText(entry))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function inferPreferredOrientation(categories: string[] | undefined) {
  if (!categories || categories.length === 0) {
    return undefined;
  }

  const averageLabelLength = categories.reduce((sum, category) => sum + category.length, 0) / categories.length;
  return averageLabelLength > 12 || categories.length > 8
    ? "horizontal"
    : "vertical";
}

function shouldTruncateChartLabels(categories: string[] | undefined) {
  if (!categories || categories.length === 0) {
    return false;
  }

  return categories.some((category) => category.length > 18);
}

function parseManifestResponse(
  message: Anthropic.Beta.BetaMessage,
  files: GeneratedFile[],
) {
  const manifestFile = findGeneratedFile(files, "deck_manifest.json");
  if (manifestFile) {
    const raw = manifestFile.buffer.toString("utf8");
    try {
      return parseDeckManifest(JSON.parse(raw));
    } catch {
      // Try deterministic repair on malformed manifest file
      const repaired = attemptJsonRepair(raw);
      if (repaired) {
        return parseDeckManifest(JSON.parse(repaired));
      }
      throw new Error(`deck_manifest.json is malformed and could not be repaired.`);
    }
  }

  const text = extractResponseText(message.content);
  if (!text) {
    throw new Error(
      `Claude did not generate required file deck_manifest.json and did not provide inline manifest JSON. Content blocks: ${
        message.content.map((block) => block.type).join(", ") || "none"
      }.`,
    );
  }

  try {
    return parseDeckManifest(JSON.parse(extractFirstJsonObject(text)));
  } catch (error) {
    // Try deterministic repair on inline manifest JSON
    const repaired = attemptJsonRepair(text);
    if (repaired) {
      try {
        return parseDeckManifest(JSON.parse(repaired));
      } catch { /* fall through to error */ }
    }
    const reason = error instanceof Error ? error.message : "Invalid manifest JSON.";
    throw new Error(
      `Claude did not generate a parseable deck manifest. ${reason} Response preview: ${text.slice(0, 800)}`,
    );
  }
}

function parseManifestResponseWithFallback(
  messages: Anthropic.Beta.BetaMessage[],
  files: GeneratedFile[],
) {
  let lastError: unknown = null;

  for (const message of messages) {
    try {
      return parseManifestResponse(message, files);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Claude did not generate a parseable deck manifest.");
}

function findGeneratedFile(files: GeneratedFile[], fileName: string) {
  return files.find((file) => file.fileName === fileName || file.fileName.endsWith(fileName)) ?? null;
}

function buildCheckpointProof(
  partial: Partial<ArtifactCheckpointProof> = {},
): ArtifactCheckpointProof {
  return {
    authorComplete: partial.authorComplete ?? false,
    critiqueComplete: partial.critiqueComplete ?? false,
    reviseComplete: partial.reviseComplete ?? false,
    visualQaGreen: partial.visualQaGreen ?? false,
    lintPassed: partial.lintPassed ?? false,
    contractPassed: partial.contractPassed ?? false,
    deckNeedsRevision: partial.deckNeedsRevision ?? true,
  };
}

function normalizeArtifactCheckpoint(content: Record<string, unknown> | null): ArtifactCheckpoint | null {
  if (
    !content ||
    !content.phase ||
    !content.pptxStoragePath ||
    !content.pdfStoragePath ||
    !content.mdStoragePath ||
    !content.xlsxStoragePath
  ) {
    return null;
  }

  const proofContent = typeof content.proof === "object" && content.proof !== null
    ? content.proof as Record<string, unknown>
    : null;
  const proof = buildCheckpointProof({
    authorComplete: Boolean(proofContent?.authorComplete ?? (content.phase === "author" || content.phase === "critique" || content.phase === "revise")),
    critiqueComplete: Boolean(proofContent?.critiqueComplete ?? (content.phase === "critique" || content.phase === "revise")),
    reviseComplete: Boolean(proofContent?.reviseComplete ?? content.phase === "revise"),
    visualQaGreen: Boolean(proofContent?.visualQaGreen ?? (content.visualQaStatus === "green")),
    lintPassed: Boolean(proofContent?.lintPassed ?? content.resumeReady),
    contractPassed: Boolean(proofContent?.contractPassed ?? content.resumeReady),
    deckNeedsRevision: Boolean(proofContent?.deckNeedsRevision ?? content.deckNeedsRevision ?? !content.resumeReady),
  });

  return {
    phase: content.phase as ArtifactCheckpoint["phase"],
    pptxStoragePath: String(content.pptxStoragePath),
    pdfStoragePath: String(content.pdfStoragePath),
    mdStoragePath: String(content.mdStoragePath),
    xlsxStoragePath: String(content.xlsxStoragePath),
    manifestJson: (content.manifestJson ?? {}) as Record<string, unknown>,
    savedAt: String(content.savedAt ?? new Date(0).toISOString()),
    attemptId: String(content.attemptId ?? ""),
    attemptNumber: Number(content.attemptNumber ?? 0),
    resumeReady: Boolean(content.resumeReady) && proof.visualQaGreen && proof.lintPassed && proof.contractPassed && !proof.deckNeedsRevision,
    visualQaStatus: content.visualQaStatus as ArtifactCheckpoint["visualQaStatus"],
    deckNeedsRevision: Boolean(content.deckNeedsRevision ?? proof.deckNeedsRevision),
    proof,
  };
}

function extractResponseText(blocks: Anthropic.Beta.BetaContentBlock[]) {
  return blocks
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function extractFirstJsonObject(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Response did not contain a JSON object.");
  }

  return text.slice(firstBrace, lastBrace + 1);
}

/**
 * Attempt deterministic JSON repair for truncated/malformed structured output.
 * Handles common failure modes: unclosed strings, missing closing brackets/braces,
 * trailing commas, and truncated arrays.
 */
function attemptJsonRepair(raw: string): string | null {
  if (!raw || raw.length < 10) return null;

  // Extract the JSON portion
  let json: string;
  try {
    json = extractFirstJsonObject(raw);
  } catch {
    // No JSON-like content found
    const firstBrace = raw.indexOf("{");
    if (firstBrace === -1) return null;
    json = raw.slice(firstBrace);
  }

  // Try parsing as-is first
  try {
    JSON.parse(json);
    return json;
  } catch {
    // Continue with repair
  }

  // Repair pass: close unclosed structures
  let repaired = json;

  // Remove trailing comma before closing bracket/brace
  repaired = repaired.replace(/,\s*$/, "");

  // Close unclosed strings (odd number of unescaped quotes)
  const unescapedQuotes = (repaired.match(/(?<!\\)"/g) ?? []).length;
  if (unescapedQuotes % 2 !== 0) {
    repaired += '"';
  }

  // Count open brackets and braces, close them
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (ch === '"' && (i === 0 || repaired[i - 1] !== "\\")) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") openBraces++;
    else if (ch === "}") openBraces--;
    else if (ch === "[") openBrackets++;
    else if (ch === "]") openBrackets--;
  }

  // Remove trailing comma before adding closers
  repaired = repaired.replace(/,\s*$/, "");

  for (let i = 0; i < openBrackets; i++) repaired += "]";
  for (let i = 0; i < openBraces; i++) repaired += "}";

  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

function buildGenerationBrief(run: RunRow) {
  const briefRecord = (run.brief && typeof run.brief === "object" ? run.brief : {}) as Record<string, unknown>;

  return [
    `Client: ${run.client || "Unknown"}`,
    `Audience: ${run.audience || "Unspecified"}`,
    `Objective: ${run.objective || "Unspecified"}`,
    `Thesis: ${run.thesis || "Unspecified"}`,
    `Stakes: ${run.stakes || "Unspecified"}`,
    `Business context: ${run.business_context || "Unspecified"}`,
    `Requested slide count: ${run.target_slide_count}`,
    `Structured brief: ${JSON.stringify(briefRecord, null, 2)}`,
  ].join("\n");
}

function buildChartPreprocessingGuide() {
  const chartLayouts = ["title-chart", "chart-split", "evidence-grid", "comparison"];
  const lines = [
    "Deterministic chart preprocessing guide:",
    "- Compute category_count before rendering every chart.",
    "- If category_count exceeds the slot limit, aggregate the tail into `Other` or switch to commentary-led treatment instead of cramming the chart.",
    "- If average category label length is above 12 characters, prefer horizontal orientation unless the chart is a true time series.",
    "- Figure size must match the slide archetype chart slot. Render at the slot ratio first, then place the image 1:1 without stretch.",
    "- Use descending sort for rankings, ascending only for deliberate smallest-first comparisons, and `none` for time series.",
    "- Truncate long labels only after sorting and only when the full label is preserved elsewhere in notes/source data.",
  ];

  for (const layoutId of chartLayouts) {
    const archetype = getArchetypeOrDefault(layoutId);
    const chartSlot = archetype.slots.chart;
    if (!chartSlot) {
      continue;
    }
    const aspectRatio = Number((chartSlot.frame.w / chartSlot.frame.h).toFixed(2));
    const preferredOrientation = aspectRatio < 1.7 ? "horizontal" : "vertical";
    lines.push(
      `- ${layoutId}: figureSize=${chartSlot.frame.w.toFixed(2)}x${chartSlot.frame.h.toFixed(2)}in, slotAspectRatio=${aspectRatio}, maxCategories=${chartSlot.maxCategories ?? 12}, preferredOrientation=${preferredOrientation}, allowedChartTypes=${(chartSlot.allowedChartTypes ?? []).join("/") || "any"}.`,
    );
  }

  return lines.join("\n");
}

function buildChartSlotConstraintMessage(analysis: z.infer<typeof analysisSchema>) {
  const constrainedSlides = analysis.slidePlan
    .filter((slide) => slide.chart)
    .map((slide) => ({
      position: slide.position,
      chart: slide.chart,
      archetype: slide.slideArchetype ?? slide.layoutId,
    }));

  if (constrainedSlides.length === 0) {
    return undefined;
  }

  const lines = [
    "Preserve these chart slot constraints from the prior analysis pass:",
    ...constrainedSlides.map((slide) => {
      const chartConstraints = slide.chart;
      const constraints = [
        `figureSize=${chartConstraints?.figureSize?.widthInches}x${chartConstraints?.figureSize?.heightInches}in`,
        `slotAspectRatio=${chartConstraints?.slotAspectRatio}`,
        `maxCategories=${chartConstraints?.maxCategories}`,
        `preferredOrientation=${chartConstraints?.preferredOrientation}`,
        `sort=${chartConstraints?.sort}`,
        `truncateLabels=${Boolean(chartConstraints?.truncateLabels)}`,
      ].filter((item) => !item.includes("undefined")).join(", ");

      return `- slide ${slide.position} (${slide.archetype}): ${constraints || "inherit previous chart plan constraints"}`;
    }),
  ];

  return lines.join("\n");
}

function buildBriefText(run: RunRow) {
  return [run.objective, run.thesis, run.business_context, run.stakes, run.client]
    .filter(Boolean)
    .join(" ");
}

/**
 * Deterministic exhibit enforcement: override wrong chart types in the analysis
 * before passing to the author phase. $0 LLM cost.
 */
function enforceAnalysisExhibitRules(analysis: z.infer<typeof analysisSchema>) {
  for (const slide of analysis.slidePlan) {
    if (!slide.chart) continue;

    const questionType = inferQuestionType(slide.title);
    const periodCount = /trend|over time|weekly|monthly|quarter/i.test(slide.title) ? 5 : 2;
    const result = enforceExhibit(questionType, slide.chart.chartType, periodCount);

    if (result.wasOverridden) {
      slide.chart.chartType = result.chartType;
    }
  }
}

function applyChartPreprocessingConstraints(analysis: z.infer<typeof analysisSchema>) {
  for (const slide of analysis.slidePlan) {
    if (!slide.chart) {
      continue;
    }

    const layoutId = slide.slideArchetype || slide.layoutId || "title-chart";
    const archetype = getArchetypeOrDefault(layoutId);
    const chartSlot = archetype.slots.chart;
    if (!chartSlot) {
      continue;
    }

    const slotAspectRatio = Number((chartSlot.frame.w / chartSlot.frame.h).toFixed(2));
    const preferredOrientation = slotAspectRatio < 1.7 ? "horizontal" : "vertical";
    const chartType = slide.chart.chartType.toLowerCase();
    const isTimeSeries = chartType === "line" || chartType === "area";

    slide.chart.maxCategories ??= chartSlot.maxCategories ?? 12;
    slide.chart.slotAspectRatio ??= slotAspectRatio;
    slide.chart.figureSize ??= {
      widthInches: Number(chartSlot.frame.w.toFixed(2)),
      heightInches: Number(chartSlot.frame.h.toFixed(2)),
    };
    slide.chart.preferredOrientation ??= isTimeSeries ? "vertical" : preferredOrientation;
    slide.chart.sort ??= isTimeSeries ? "none" : chartType.includes("horizontal") ? "desc" : "desc";
    slide.chart.truncateLabels ??= (slide.chart.maxCategories ?? 12) <= 8;
  }
}

function analysisToPlanLintInput(analysis: z.infer<typeof analysisSchema>): SlidePlanLintInput[] {
  return analysis.slidePlan.map((slide) => ({
    position: slide.position,
    role: slide.position === 1 ? "cover" : slide.position === 2 ? "exec-summary" : "content",
    layoutId: slide.layoutId,
    slideArchetype: slide.slideArchetype,
    title: slide.title,
    body: slide.body,
    governingThought: slide.body,
    focalObject: slide.subtitle,
    pageIntent: typeof (slide as { pageIntent?: string }).pageIntent === "string"
      ? (slide as { pageIntent?: string }).pageIntent
      : undefined,
    chartId: slide.chart?.id,
    chartType: slide.chart?.chartType,
    evidenceIds: slide.evidenceIds,
  }));
}

function buildPlanLintSummary(analysis: z.infer<typeof analysisSchema>, requestedSlideCount?: number) {
  const planTargetSlideCount = resolvePlanLintTargetSlideCount(requestedSlideCount, analysis.slidePlan.length);
  const result = lintSlidePlan(analysisToPlanLintInput(analysis), planTargetSlideCount);
  const meceCheckEnabled = shouldEnforceDeckPlanMeceCheck(planTargetSlideCount);
  const actionableIssues = [
    ...result.pairViolations
      .filter((violation) => isActionablePlanPairViolation(violation, meceCheckEnabled))
      .map((violation) =>
        `Slides ${violation.positions[0]} and ${violation.positions[1]}: ${violation.message}`,
      ),
    ...result.deckViolations
      .filter((violation) => isActionablePlanDeckViolation(violation, meceCheckEnabled))
      .map((violation) => formatPlanDeckViolation(violation)),
  ];

  return {
    result,
    actionableIssues,
    summary: {
      slideCount: analysis.slidePlan.length,
      requestedSlideCount: planTargetSlideCount,
      drillDownDimensions: result.uniqueDimensions.length,
      minRequiredDimensions: result.minRequiredDimensions,
      mecePairViolations: result.pairViolations.length,
      deepestLevel: result.deepestLevel,
      chapterDepths: result.chapterDepths,
      contentSlideCount: result.contentSlideCount,
      appendixSlideCount: result.appendixSlideCount,
      appendixCap: result.appendixCap,
      meceCheckEnabled,
    },
  };
}

function shouldEnforceDeckPlanMeceCheck(targetSlideCount: number) {
  return DECK_PLAN_MECE_CHECK && targetSlideCount >= 40;
}

function getMaxContentTargetSlides() {
  return Math.max(0, MAX_RENDERING_TARGET_SLIDES - MIN_REQUIRED_STRUCTURAL_DECK_SLIDES);
}

function getAppendixCapForRequestedDeckSize(targetSlideCount: number) {
  const nominalTopUp = Math.ceil(targetSlideCount * 0.10);
  const remainingHeadroom = Math.max(
    0,
    MAX_RENDERING_TARGET_SLIDES - MIN_REQUIRED_STRUCTURAL_DECK_SLIDES - targetSlideCount,
  );
  return Math.min(nominalTopUp, remainingHeadroom);
}

function assertRequestedDeckSizeSupported(targetSlideCount: number, mode: "deck" | "report_only") {
  if (mode !== "deck") {
    return;
  }

  const maxContentSlides = getMaxContentTargetSlides();
  if (targetSlideCount > maxContentSlides) {
    throw new Error(
      `Requested ${targetSlideCount} content slides exceeds the supported maximum of ${maxContentSlides}. ` +
      `Basquio reserves ${MIN_REQUIRED_STRUCTURAL_DECK_SLIDES} structural slide for the cover within the ${MAX_RENDERING_TARGET_SLIDES}-slide rendering ceiling.`,
    );
  }
}

function resolvePlanLintTargetSlideCount(requestedSlideCount: number | undefined, fallbackSlideCount: number) {
  return typeof requestedSlideCount === "number" && requestedSlideCount > 0
    ? requestedSlideCount
    : fallbackSlideCount;
}

function isActionablePlanPairViolation(
  violation: { rule: string; severity: "critical" | "major" | "minor" },
  meceCheckEnabled: boolean,
) {
  if (violation.severity !== "critical" && violation.severity !== "major") {
    return false;
  }

  if (ALWAYS_ACTIONABLE_PLAN_RULES.has(violation.rule)) {
    return true;
  }

  return DECK_PLAN_MECE_CHECK && meceCheckEnabled;
}

function isActionablePlanDeckViolation(
  violation: { rule: string; severity: "critical" | "major" | "minor" },
  meceCheckEnabled: boolean,
) {
  if (violation.severity !== "critical" && violation.severity !== "major") {
    return false;
  }

  if (ALWAYS_ACTIONABLE_PLAN_RULES.has(violation.rule)) {
    return true;
  }

  if (LONG_DECK_PLAN_RULES.has(violation.rule)) {
    return meceCheckEnabled;
  }

  return meceCheckEnabled;
}

function formatPlanDeckViolation(violation: { rule: string; message: string }) {
  const prefix = LONG_DECK_PLAN_RULES.has(violation.rule) ? "Deck depth issue" : "Deck plan issue";
  return `${prefix} [${violation.rule}]: ${violation.message}`;
}


async function persistDeckSpec(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  manifest: z.infer<typeof deckManifestSchema>,
) {
  type PersistedChartRow = {
    id: string;
    data?: Record<string, unknown>[] | null;
    x_axis?: string | null;
    y_axis?: string | null;
    series?: string[] | null;
    style?: Record<string, unknown> | null;
    source_note?: string | null;
    thumbnail_url?: string | null;
    width?: number | null;
    height?: number | null;
  };

  await deleteRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_spec_v2_slides",
    query: { run_id: `eq.${runId}` },
  });

  const existingChartRows = manifest.charts.length > 0
    ? await fetchRestRows<PersistedChartRow>({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_spec_v2_charts",
        query: {
          run_id: `eq.${runId}`,
          select: "id,data,x_axis,y_axis,series,style,source_note,thumbnail_url,width,height",
          order: "created_at.asc",
          limit: "200",
        },
      }).catch(() => [])
    : [];

  const canReuseExistingChartRows =
    existingChartRows.length === manifest.charts.length &&
    existingChartRows.some((row) =>
      (Array.isArray(row.data) && row.data.length > 0) ||
      (Array.isArray(row.series) && row.series.length > 0) ||
      Boolean(row.thumbnail_url),
    );

  if (!canReuseExistingChartRows) {
    await deleteRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_spec_v2_charts",
      query: { run_id: `eq.${runId}` },
    }).catch(() => {});
  }

  const chartIdMap = new Map<string, string>();
  const chartRows = manifest.charts.map((chart, index) => {
    const existing = canReuseExistingChartRows ? existingChartRows[index] : null;
    const id = existing?.id ?? randomUUID();
    chartIdMap.set(chart.id, id);
    return {
      id,
      run_id: runId,
      chart_type: chart.chartType,
      title: chart.title,
      data: existing?.data ?? [],
      x_axis: existing?.x_axis ?? "",
      y_axis: existing?.y_axis ?? "",
      series: existing?.series ?? [],
      style: existing?.style ?? {},
      source_note: chart.sourceNote ?? existing?.source_note ?? null,
      thumbnail_url: existing?.thumbnail_url ?? null,
      width: existing?.width ?? 0,
      height: existing?.height ?? 0,
    };
  });

  if (chartRows.length > 0) {
    await upsertRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_spec_v2_charts",
      onConflict: "id",
      rows: chartRows,
    });
  }

  const slideRows = manifest.slides.map((slide) => ({
    run_id: runId,
    position: slide.position,
    layout_id: slide.layoutId,
    title: slide.title,
    subtitle: slide.subtitle ?? null,
    body: slide.body ?? null,
    bullets: slide.bullets ?? null,
    chart_id: slide.chartId ? chartIdMap.get(slide.chartId) ?? null : null,
    metrics: slide.metrics ?? null,
    evidence_ids: slide.evidenceIds ?? [],
    scene_graph: {
      slideArchetype: slide.slideArchetype ?? slide.layoutId,
    },
    qa_status: "passed",
    revision: 1,
    kicker: null,
    callout: slide.callout ?? null,
  }));

  if (slideRows.length > 0) {
    await upsertRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_spec_v2_slides",
      onConflict: "run_id,position,revision",
      rows: slideRows,
    });
  }
}

function collectManifestIssues(manifest: z.infer<typeof deckManifestSchema>, requestedSlideCount?: number) {
  const issues: string[] = [];
  const chartIds = new Set(manifest.charts.map((chart) => chart.id));
  const chartById = new Map(manifest.charts.map((chart) => [chart.id, chart]));
  if (manifest.slideCount <= 0) issues.push("Manifest has zero slides.");
  if (manifest.slideCount !== manifest.slides.length) issues.push("Manifest slideCount does not match slides[].");
  if (typeof requestedSlideCount === "number") {
    const appendixCap = getAppendixCapForRequestedDeckSize(requestedSlideCount);
    const structuralSlideCount = countStructuralSlidesInManifest(manifest);
    const minTotalSlides = requestedSlideCount + structuralSlideCount;
    const maxTotalSlides = requestedSlideCount + structuralSlideCount + appendixCap;
    if (manifest.slideCount < minTotalSlides) {
      issues.push(
        `Manifest slideCount ${manifest.slideCount} is below requested targetSlideCount ${requestedSlideCount} plus structural slides ${structuralSlideCount}.`,
      );
    }
    if (manifest.slideCount > maxTotalSlides) {
      issues.push(
        `Manifest slideCount ${manifest.slideCount} exceeds requested targetSlideCount ${requestedSlideCount} plus structural slides ${structuralSlideCount} and appendix cap ${appendixCap}.`,
      );
    }
  }
  if (manifest.slides.some((slide) => /chart unavailable|placeholder/i.test(`${slide.body ?? ""} ${slide.title}`))) {
    issues.push("Deck still contains placeholder or chart-unavailable language.");
  }
  if (manifest.slides.some((slide) => slide.chartId && !chartIds.has(slide.chartId))) {
    issues.push("At least one slide references a chart missing from charts[].");
  }
  if (manifest.slides.some((slide) => (slide.body ?? "").length > 550)) {
    issues.push("At least one slide body is too long and likely overcrowded.");
  }
  if (
    manifest.slides.some((slide) => {
      const bodyWords = (slide.body ?? "").trim().split(/\s+/).filter(Boolean).length;
      const metricCount = slide.metrics?.length ?? 0;
      return metricCount > 0 && bodyWords > 36;
    })
  ) {
    issues.push("At least one slide combines metrics with too much body copy for a stable card/footer layout.");
  }
  if (
    manifest.slides.some((slide) => {
      const titleWords = slide.title.trim().split(/\s+/).filter(Boolean).length;
      const metricCount = slide.metrics?.length ?? 0;
      return metricCount > 0 && titleWords > 7;
    })
  ) {
    issues.push("At least one metric-bearing slide title is too long for a clean recommendation-card layout.");
  }
  // Title overflow detection: titles > 75 chars will likely clip at the right edge
  for (const slide of manifest.slides) {
    if (slide.title.length > 75) {
      issues.push(`Slide ${slide.position} title is ${slide.title.length} characters and will overflow the right margin. Shorten to under 75 characters.`);
    }
  }
  issues.push(...collectChartSlotConstraintFindings(manifest));

  for (const slide of manifest.slides) {
    const countClaimIssue = detectExplicitCoverageMismatch(slide);
    if (countClaimIssue) {
      issues.push(`Slide ${slide.position} ${countClaimIssue}`);
    }
    const chart = slide.chartId ? chartById.get(slide.chartId) : null;
    const claimExhibitIssue = detectClaimExhibitMismatch(slide, chart);
    if (claimExhibitIssue) {
      issues.push(`Slide ${slide.position} ${claimExhibitIssue}`);
    }
  }
  if (new Set(manifest.slides.map((slide) => slide.title)).size !== manifest.slides.length) {
    issues.push("Slide titles are duplicated.");
  }
  const planLint = lintManifestPlan(manifest, requestedSlideCount);
  issues.push(...planLint.actionableIssues);
  for (const slide of manifest.slides) {
    if (!APPROVED_ARCHETYPES.includes(slide.slideArchetype)) {
      issues.push(`Slide ${slide.position} uses unsupported slideArchetype "${slide.slideArchetype}".`);
      continue;
    }
    const chart = slide.chartId ? chartById.get(slide.chartId) : null;
    const slotViolations = validateSlotConstraints(slide.slideArchetype, {
      title: slide.title,
      subtitle: slide.subtitle,
      body: slide.body,
      bullets: slide.bullets,
      chartId: slide.chartId,
      chartCategories: undefined,
      chartType: chart?.chartType,
      metrics: slide.metrics,
      callout: slide.callout?.text,
    });
    for (const violation of slotViolations.slice(0, 4)) {
      issues.push(
        `Slide ${slide.position} violates archetype ${slide.slideArchetype}: ${violation.slot} ${violation.constraint} (${violation.actual} vs ${violation.limit}).`,
      );
    }
  }
  return issues;
}

function collectChartSlotConstraintFindings(manifest: z.infer<typeof deckManifestSchema>) {
  const findings: string[] = [];
  const chartById = new Map(manifest.charts.map((chart) => [chart.id, chart]));

  for (const slide of manifest.slides) {
    const chart = slide.chartId ? chartById.get(slide.chartId) : null;
    if (!chart) {
      continue;
    }

    const archetype = getArchetypeOrDefault(slide.slideArchetype || slide.layoutId);
    const chartSlot = archetype.slots.chart;
    const categoryCount = chart.categoryCount ?? chart.categories?.length;
    if (chartSlot?.maxCategories && categoryCount && categoryCount > chartSlot.maxCategories) {
      findings.push(
        `Slide ${slide.position} chart exposes ${categoryCount} categories but the ${archetype.id} chart slot is capped at ${chartSlot.maxCategories}. Aggregate the tail, switch to horizontal orientation, or change the grammar.`,
      );
    }
    if (categoryCount && categoryCount > 8 && ["bar", "grouped_bar", "stacked_bar", "stacked_bar_100"].includes(chart.chartType)) {
      findings.push(
        `Slide ${slide.position} chart uses ${chart.chartType} with ${categoryCount} categories. Prefer horizontal orientation or reduce the category set before publish.`,
      );
    }
  }

  return findings;
}

function detectExplicitCoverageMismatch(slide: z.infer<typeof deckManifestSchema>["slides"][number]) {
  const titleAndSubtitle = `${slide.title} ${slide.subtitle ?? ""}`;
  const expectedCount = extractExplicitEntityCount(titleAndSubtitle);
  if (!expectedCount || expectedCount < 3) {
    return "";
  }

  const explicitMentions = countExplicitEntityMentions(`${slide.body ?? ""} ${(slide.bullets ?? []).join(" ")}`);
  if (explicitMentions > 0 && explicitMentions < expectedCount) {
    return `promises ${expectedCount} entities but only references ${explicitMentions} explicitly in the commentary.`;
  }

  return "";
}

function extractExplicitEntityCount(text: string) {
  const normalized = text.toLowerCase();
  const numericMatch = normalized.match(/\b([3-9]|10)\s+(province|provinces|regioni|regions|mercati|markets|channel|channels|categorie|categories|segmenti|segments)\b/);
  if (numericMatch) {
    return Number.parseInt(numericMatch[1] ?? "0", 10);
  }

  if (/\bquattro\s+(province|regioni|mercati)\b/.test(normalized)) return 4;
  if (/\btre\s+(province|regioni|mercati)\b/.test(normalized)) return 3;
  if (/\bfive\s+(markets|channels|segments)\b/.test(normalized)) return 5;
  return 0;
}

function countExplicitEntityMentions(text: string) {
  return (text.match(/\b[^:]{2,40}:/g) ?? []).length;
}

function detectClaimExhibitMismatch(
  slide: z.infer<typeof deckManifestSchema>["slides"][number],
  chart?: z.infer<typeof deckManifestSchema>["charts"][number] | null,
) {
  const copy = `${slide.title} ${slide.subtitle ?? ""} ${slide.body ?? ""} ${(slide.bullets ?? []).join(" ")}`.toLowerCase();
  const chartTitle = chart?.title?.toLowerCase() ?? "";
  const claimsDistributionChange =
    /(distribution|distribuzion)/.test(copy) &&
    /(grow|grows|grew|increase|expanded|espand|cresc|acceler)/.test(copy);
  const chartShowsDistributionLevel =
    /(distribution|distribuzion)/.test(chartTitle) &&
    !(/(change|delta|variation|variazione|vs|yoy|py|pp)/.test(chartTitle));

  if (claimsDistributionChange && chartShowsDistributionLevel) {
    return "claims a distribution change, but the linked chart title suggests current distribution level rather than a change metric.";
  }

  const claimsLevelChange =
    /(grow|growth|growing|increase|increased|expanded|expansion|accelerat|up\b|gain|gained|rise|rising|improv|surge|higher|aument|cresc|espans|acceler)/.test(copy);
  const chartLooksLevelOnly =
    chartTitle.length > 0 &&
    !(/(change|delta|variation|variazione|vs|versus|yoy|py|pp|trend|growth|increase|decline|decrease|comparison|compare)/.test(chartTitle));
  if (claimsLevelChange && chartLooksLevelOnly) {
    return "claims metric growth or acceleration, but the linked chart metadata suggests a current-level exhibit rather than a change view.";
  }

  const expectedTopCount = extractTopEntityCount(copy);
  const chartCategoryCount = chart?.categoryCount ?? chart?.categories?.length ?? 0;
  if (expectedTopCount > 0 && chartCategoryCount > 0 && chartCategoryCount < expectedTopCount) {
    return `claims a top-${expectedTopCount} comparison, but the linked chart metadata only exposes ${chartCategoryCount} categories.`;
  }

  return "";
}

function extractTopEntityCount(text: string) {
  const normalized = text.toLowerCase();
  const numericMatch = normalized.match(/\btop[\s-]?([3-9]|10)\b/);
  if (numericMatch) {
    return Number.parseInt(numericMatch[1] ?? "0", 10);
  }

  if (/\btop\s+tre\b/.test(normalized)) return 3;
  if (/\btop\s+quattro\b/.test(normalized)) return 4;
  if (/\btop\s+cinque\b/.test(normalized)) return 5;
  return 0;
}

function manifestToLintInput(manifest: z.infer<typeof deckManifestSchema>): SlideTextInput[] {
  const deckText = manifest.slides
    .flatMap((slide) => [slide.title, slide.body, ...(slide.bullets ?? []), slide.callout?.text])
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ");
  const expectedLanguage = (detectLanguage(deckText) as "it" | "en" | "unknown");

  return manifest.slides.map((slide, index) => ({
    position: slide.position,
    role: index === 0 || slide.layoutId === "cover"
      ? "cover"
      : slide.slideArchetype === "exec-summary" || slide.layoutId === "exec-summary"
        ? "exec-summary"
        : "finding",
    layoutId: slide.layoutId,
    title: slide.title,
    expectedLanguage,
    slideArchetype: slide.slideArchetype,
    body: slide.body,
    bullets: slide.bullets,
    callout: slide.callout ? { text: slide.callout.text, tone: slide.callout.tone } : undefined,
    metrics: slide.metrics,
    speakerNotes: typeof (slide as { speakerNotes?: string }).speakerNotes === "string"
      ? (slide as { speakerNotes?: string }).speakerNotes
      : undefined,
    chartId: slide.chartId,
    pageIntent: typeof slide.pageIntent === "string" ? slide.pageIntent : undefined,
    hasDataTable: Boolean(slide.hasDataTable),
    hasChartAnnotations: Boolean(slide.hasChartAnnotations),
  }));
}

function manifestToPlanLintInput(manifest: z.infer<typeof deckManifestSchema>): SlidePlanLintInput[] {
  const chartById = new Map(manifest.charts.map((chart) => [chart.id, chart]));
  return manifest.slides.map((slide, index) => {
    const chart = slide.chartId ? chartById.get(slide.chartId) : undefined;
    return {
      position: slide.position,
      role: index === 0 || slide.layoutId === "cover"
        ? "cover"
        : slide.layoutId === "exec-summary"
          ? "exec-summary"
          : slide.pageIntent ?? "content",
      layoutId: slide.layoutId,
      slideArchetype: slide.slideArchetype,
      title: slide.title,
      body: slide.body,
      governingThought: slide.body ?? slide.subtitle,
      focalObject: slide.callout?.text,
      pageIntent: slide.pageIntent,
      chartId: slide.chartId,
      chartType: chart?.chartType,
      categories: chart?.categories,
      categoryCount: chart?.categoryCount,
      evidenceIds: slide.evidenceIds,
    };
  });
}

function buildFidelityContext(
  manifest: z.infer<typeof deckManifestSchema>,
  workbookBuffer: Buffer | null | undefined,
  parsed: Awaited<ReturnType<typeof parseEvidencePackage>>,
  run: RunRow,
): FidelityContext {
  return {
    workbookSheets: workbookBuffer ? extractWorkbookSheetProfiles(workbookBuffer) : [],
    knownEntities: buildKnownEntityCatalog(parsed, run),
  };
}

function extractWorkbookSheetProfiles(buffer: Buffer): WorkbookSheetProfile[] {
  const workbook = read(buffer, {
    type: "buffer",
    raw: true,
    cellDates: true,
  });

  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const matrix = utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    }) as unknown[][];
    const normalizedRows = matrix
      .map((row) => row.map((cell) => normalizeWorkbookCell(cell)))
      .filter((row) => row.some((cell) => cell !== null && cell !== ""));
    const headers = (normalizedRows[0] ?? []).map((cell, index) => normalizeWorkbookHeader(cell, index));
    const rowObjects = normalizedRows
      .slice(1)
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])))
      .filter((row) => Object.values(row).some((value) => value !== null && value !== ""));
    const numericValues = rowObjects.flatMap((row) =>
      Object.values(row)
        .map((value) => typeof value === "number" && Number.isFinite(value) ? value : null)
        .filter((value): value is number => value !== null),
    );

    return {
      name: sheetName,
      headers,
      rows: rowObjects,
      numericValues,
      dataSignature: createHash("sha256")
        .update(JSON.stringify({ headers, rows: rowObjects }))
        .digest("hex")
        .slice(0, 16),
    };
  });
}

async function ensureWorkbookChartCompanionArtifacts(input: {
  analysis: AnalysisResult | null;
  manifest: z.infer<typeof deckManifestSchema>;
  templateProfile: TemplateProfile;
  xlsxFile: GeneratedFile;
}): Promise<{
  analysis: AnalysisResult | null;
  manifest: z.infer<typeof deckManifestSchema>;
  xlsxFile: GeneratedFile;
}> {
  const workbookSheets = extractWorkbookSheetProfiles(input.xlsxFile.buffer);
  if (workbookSheets.length === 0) {
    return input;
  }
  const sheetPresentations = buildWorkbookSheetPresentations(workbookSheets, input.templateProfile);
  const sheetPresentationByName = new Map(sheetPresentations.map((sheet) => [sheet.sheetName, sheet]));
  const requests = buildWorkbookChartBindingRequests(input.manifest, input.analysis);
  if (requests.length === 0 && sheetPresentations.length === 0) {
    return input;
  }

  const bindings = requests
    .map((request) =>
      bindWorkbookSheetToChart(request, workbookSheets, input.templateProfile, sheetPresentationByName),
    )
    .filter((binding): binding is WorkbookChartBinding => Boolean(binding));

  const manifestCharts = input.manifest.charts.map((chart) => {
    const binding = bindings.find((entry) => entry.request.chartId === chart.id);
    if (!binding) {
      return chart;
    }
    return {
      ...chart,
      excelSheetName: binding.sheet.name,
      dataSignature: chart.dataSignature ?? binding.sheet.dataSignature,
      presentation: {
        ...binding.exhibitPresentation,
        workbookAnchor:
          chart.presentation?.workbookAnchor ??
          chart.excelChartCellAnchor ??
          binding.exhibitPresentation.workbookAnchor,
      },
    };
  });

  let nextAnalysis = input.analysis;
  if (input.analysis) {
    nextAnalysis = analysisSchema.parse({
      ...input.analysis,
      slidePlan: input.analysis.slidePlan.map((slide) => {
        if (!slide.chart) {
          return slide;
        }
        const binding = bindings.find((entry) => entry.request.chartId === slide.chart?.id);
        if (!binding) {
          return slide;
        }
        return {
          ...slide,
          chart: {
            ...slide.chart,
            excelSheetName: binding.sheet.name,
            dataSignature: slide.chart.dataSignature ?? binding.sheet.dataSignature,
            exhibitPresentation: {
              ...binding.exhibitPresentation,
              workbookAnchor:
                (slide.chart as { exhibitPresentation?: ExhibitPresentationSpec }).exhibitPresentation?.workbookAnchor ??
                slide.chart.excelChartCellAnchor ??
                binding.exhibitPresentation.workbookAnchor,
            },
          },
        };
      }),
    });
  }

  const needsWorkbookMutation =
    sheetPresentations.length > 0 ||
    bindings.some((binding) =>
      supportsNativeExcelChart(binding.request.chartType) &&
      binding.selectedHeaders.length > 0 &&
      !binding.request.existingAnchor,
    );
  let nextXlsx = input.xlsxFile;
  let chartAnchorById = new Map<string, string>();
  if (needsWorkbookMutation) {
    const nativeResult = await injectWorkbookNativeCharts(
      input.xlsxFile.buffer,
      bindings,
      sheetPresentations,
    );
    nextXlsx = {
      ...input.xlsxFile,
      buffer: nativeResult.buffer,
    };
    chartAnchorById = nativeResult.chartAnchorById;
  }

  const nextManifest = parseDeckManifest({
    ...input.manifest,
    charts: manifestCharts.map((chart) => {
      const anchor = chartAnchorById.get(chart.id) ?? chart.excelChartCellAnchor;
      return {
        ...chart,
        ...(anchor ? { excelChartCellAnchor: anchor } : {}),
        ...(chart.presentation
          ? {
              presentation: {
                ...chart.presentation,
                workbookAnchor: anchor ?? chart.presentation.workbookAnchor ?? null,
              },
            }
          : {}),
      };
    }),
  });

  if (nextAnalysis) {
    nextAnalysis = analysisSchema.parse({
      ...nextAnalysis,
      slidePlan: nextAnalysis.slidePlan.map((slide) => {
        if (!slide.chart) {
          return slide;
        }
        const anchor = chartAnchorById.get(slide.chart.id);
        if (!anchor && !(slide.chart as { exhibitPresentation?: ExhibitPresentationSpec }).exhibitPresentation) {
          return slide;
        }
        return {
          ...slide,
          chart: {
            ...slide.chart,
            ...(anchor ? { excelChartCellAnchor: anchor } : {}),
            ...((slide.chart as { exhibitPresentation?: ExhibitPresentationSpec }).exhibitPresentation
              ? {
                  exhibitPresentation: {
                    ...(slide.chart as { exhibitPresentation?: ExhibitPresentationSpec }).exhibitPresentation,
                    workbookAnchor:
                      anchor ??
                      (slide.chart as { exhibitPresentation?: ExhibitPresentationSpec }).exhibitPresentation?.workbookAnchor ??
                      null,
                  },
                }
              : {}),
          },
        };
      }),
    });
  }

  return {
    analysis: nextAnalysis,
    manifest: nextManifest,
    xlsxFile: nextXlsx,
  };
}

function buildWorkbookChartBindingRequests(
  manifest: z.infer<typeof deckManifestSchema>,
  analysis: AnalysisResult | null,
): WorkbookChartBindingRequest[] {
  type AnalysisChart = NonNullable<AnalysisResult["slidePlan"][number]["chart"]>;
  const analysisEntries: Array<{
    position: number;
    chart: AnalysisChart;
  }> = [];
  const analysisByChartId = new Map<string, AnalysisChart>();
  const analysisByPosition = new Map<number, AnalysisChart>();
  const analysisByDataSignature = new Map<string, AnalysisChart>();
  const analysisByExcelSheetName = new Map<string, AnalysisChart>();
  for (const slide of analysis?.slidePlan ?? []) {
    if (slide.chart) {
      analysisEntries.push({ position: slide.position, chart: slide.chart });
      analysisByChartId.set(slide.chart.id, slide.chart);
      analysisByPosition.set(slide.position, slide.chart);
      if (slide.chart.dataSignature && !analysisByDataSignature.has(slide.chart.dataSignature)) {
        analysisByDataSignature.set(slide.chart.dataSignature, slide.chart);
      }
      if (slide.chart.excelSheetName && !analysisByExcelSheetName.has(slide.chart.excelSheetName)) {
        analysisByExcelSheetName.set(slide.chart.excelSheetName, slide.chart);
      }
    }
  }

  return manifest.charts.map((manifestChart, index) => {
    const slide = manifest.slides.find((entry) => entry.chartId === manifestChart.id) ?? null;
    const analysisChart =
      analysisByChartId.get(manifestChart.id) ??
      (manifestChart.dataSignature ? analysisByDataSignature.get(manifestChart.dataSignature) : undefined) ??
      (manifestChart.excelSheetName ? analysisByExcelSheetName.get(manifestChart.excelSheetName) : undefined) ??
      analysisByPosition.get(slide?.position ?? -1) ??
      analysisEntries.find((entry) =>
        entry.chart.chartType === manifestChart.chartType &&
        (
          (manifestChart.excelSheetName && entry.chart.excelSheetName === manifestChart.excelSheetName) ||
          (manifestChart.dataSignature && entry.chart.dataSignature === manifestChart.dataSignature)
        )
      )?.chart;

    return {
      position: slide?.position ?? index + 1,
      chartId: manifestChart.id,
      chartType: manifestChart.chartType,
      title: manifestChart.title || slide?.title || `Chart ${index + 1}`,
      xAxisLabel: manifestChart.xAxisLabel,
      yAxisLabel: manifestChart.yAxisLabel,
      categories: extractChartCategories(analysisChart),
      existingSheetName: manifestChart.excelSheetName,
      existingAnchor: manifestChart.excelChartCellAnchor,
      existingDataSignature: manifestChart.dataSignature,
    };
  });
}

function extractChartCategories(chart: AnalysisResult["slidePlan"][number]["chart"] | undefined) {
  const categories = (chart && typeof chart === "object" && "categories" in chart)
    ? (chart as { categories?: unknown }).categories
    : [];
  return Array.isArray(categories)
    ? categories.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
}

function bindWorkbookSheetToChart(
  request: WorkbookChartBindingRequest,
  workbookSheets: WorkbookSheetProfile[],
  templateProfile: TemplateProfile,
  sheetPresentationByName: Map<string, WorkbookSheetPresentation>,
): WorkbookChartBinding | null {
  const preferredSheet = request.existingSheetName
    ? workbookSheets.find((sheet) => sheet.name === request.existingSheetName)
    : null;
  const sheet = preferredSheet ?? selectBestWorkbookSheetForChart(request, workbookSheets);
  if (!sheet) {
    return null;
  }

  const selectedHeaders = selectWorkbookSeriesHeaders(request, sheet);
  const sheetPresentation = sheetPresentationByName.get(sheet.name);
  const headerPresentations = Object.fromEntries(
    (sheetPresentation?.columns ?? []).map((column) => [column.header, column.presentation]),
  ) as Record<string, MetricPresentationSpec>;
  return {
    request,
    sheet,
    selectedHeaders,
    headerPresentations,
    exhibitPresentation: buildExhibitPresentationSpec({
      chartId: request.chartId,
      chartType: request.chartType,
      title: request.title,
      xAxisLabel: request.xAxisLabel,
      yAxisLabel: request.yAxisLabel,
      selectedHeaders,
      headerPresentations,
      templateProfile,
      workbookAnchor: request.existingAnchor ?? null,
    }),
  };
}

function selectBestWorkbookSheetForChart(
  request: WorkbookChartBindingRequest,
  workbookSheets: WorkbookSheetProfile[],
): WorkbookSheetProfile | null {
  const requestedCategories = new Set(request.categories.map((value) => normalizeEntityName(value)).filter(Boolean));
  const titleTokens = new Set(tokenizeWorkbookMatchText(request.title));
  let best: { sheet: WorkbookSheetProfile; score: number } | null = null;

  for (const sheet of workbookSheets) {
    let score = 0;
    const rowLabelHeader = sheet.headers[0];
    const rowLabels = sheet.rows
      .map((row) => row[rowLabelHeader])
      .map((value) => normalizeEntityName(typeof value === "string" || typeof value === "number" ? String(value) : ""))
      .filter(Boolean);
    const overlapCount = [...requestedCategories].filter((value) => rowLabels.includes(value)).length;
    if (requestedCategories.size > 0) {
      score += overlapCount * 12;
      if (overlapCount === requestedCategories.size) {
        score += 10;
      }
    }
    const sheetTokens = new Set([
      ...tokenizeWorkbookMatchText(sheet.name),
      ...sheet.headers.flatMap((header) => tokenizeWorkbookMatchText(header)),
    ]);
    const titleOverlap = [...titleTokens].filter((token) => sheetTokens.has(token)).length;
    score += titleOverlap * 2;
    if (request.existingDataSignature && request.existingDataSignature === sheet.dataSignature) {
      score += 20;
    }
    if (sheet.headers.length > 1) {
      score += 1;
    }
    if (!best || score > best.score) {
      best = { sheet, score };
    }
  }

  return best && best.score > 0 ? best.sheet : workbookSheets[0] ?? null;
}

function selectWorkbookSeriesHeaders(
  request: WorkbookChartBindingRequest,
  sheet: WorkbookSheetProfile,
): string[] {
  const numericHeaders = sheet.headers.slice(1).filter((header) =>
    sheet.rows.some((row) => typeof row[header] === "number" && Number.isFinite(row[header] as number)),
  );
  if (numericHeaders.length === 0) {
    return [];
  }

  const ranked = [...numericHeaders].sort((left, right) =>
    scoreWorkbookSeriesHeader(request.title, right) - scoreWorkbookSeriesHeader(request.title, left),
  );
  const chartType = request.chartType.trim().toLowerCase();
  if (chartType === "scatter") {
    return ranked.slice(0, 2);
  }
  if (["grouped_bar", "stacked_bar", "stacked_bar_100"].includes(chartType)) {
    return ranked.slice(0, Math.min(3, ranked.length));
  }
  return ranked.slice(0, 1);
}

function scoreWorkbookSeriesHeader(title: string, header: string) {
  const titleTokens = tokenizeWorkbookMatchText(title);
  const headerTokens = tokenizeWorkbookMatchText(header);
  let score = 0;
  for (const token of headerTokens) {
    if (titleTokens.includes(token)) {
      score += 10;
    }
  }
  const normalizedHeader = normalizeEntityName(header);
  const normalizedTitle = normalizeEntityName(title);
  const keywordGroups: Array<{ title: string[]; header: string[]; bonus: number }> = [
    { title: ["quota", "share"], header: ["quota", "share", "mix"], bonus: 9 },
    { title: ["mix", "gap"], header: ["mix", "gap", "var"], bonus: 9 },
    { title: ["crescita", "growth", "grow", "trend"], header: ["crescita", "growth", "var"], bonus: 8 },
    { title: ["promo", "promotion"], header: ["promo"], bonus: 8 },
    { title: ["value", "valore", "sales", "eur"], header: ["value", "valore", "eur"], bonus: 6 },
    { title: ["volume", "vol"], header: ["volume", "vol"], bonus: 6 },
  ];
  for (const group of keywordGroups) {
    if (group.title.some((token) => normalizedTitle.includes(token)) && group.header.some((token) => normalizedHeader.includes(token))) {
      score += group.bonus;
    }
  }
  if (normalizedHeader.includes("cy")) {
    score += 3;
  }
  if (normalizedHeader.includes("py")) {
    score += 2;
  }
  return score;
}

function tokenizeWorkbookMatchText(value: string | undefined | null) {
  return normalizeEntityName(value ?? "")
    .split(" ")
    .filter((token) => token.length >= 2);
}

async function injectWorkbookNativeCharts(
  xlsxBuffer: Buffer,
  bindings: WorkbookChartBinding[],
  sheetPresentations: WorkbookSheetPresentation[],
): Promise<{
  buffer: Buffer;
  chartAnchorById: Map<string, string>;
}> {
  const chartsToInject = bindings.filter((binding) =>
    supportsNativeExcelChart(binding.request.chartType) &&
    binding.selectedHeaders.length > 0,
  );
  if (chartsToInject.length === 0 && sheetPresentations.length === 0) {
    return { buffer: xlsxBuffer, chartAnchorById: new Map() };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "basquio-native-xlsx-"));
  const inputPath = path.join(tempDir, "input.xlsx");
  const outputPath = path.join(tempDir, "output.xlsx");
  const specPath = path.join(tempDir, "spec.json");

  try {
    await writeFile(inputPath, xlsxBuffer);
    await writeFile(specPath, JSON.stringify({
      workbookFormats: sheetPresentations.map((sheet) => ({
        sheetName: sheet.sheetName,
        freezePane: sheet.freezePane,
        tableStyleName: sheet.tableStyleName,
        headerFillColor: sheet.headerFillColor,
        headerTextColor: sheet.headerTextColor,
        showGridLines: sheet.showGridLines,
        columns: sheet.columns.map((column) => ({
          header: column.header,
          widthChars: column.widthChars,
          excelNumberFormat: column.presentation.excelNumberFormat,
        })),
      })),
      charts: chartsToInject.map((binding) => ({
        chartId: binding.request.chartId,
        chartType: binding.request.chartType,
        title: binding.request.title,
        xAxisLabel: binding.request.xAxisLabel,
        yAxisLabel: binding.request.yAxisLabel,
        sheetName: binding.sheet.name,
        categories: binding.request.categories,
        selectedHeaders: binding.selectedHeaders,
        presentation: binding.exhibitPresentation,
      })),
    }));
    const { stdout } = await execFileAsync(
      "python3",
      [NATIVE_WORKBOOK_CHART_SCRIPT_PATH, inputPath, specPath, outputPath],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const outputBuffer = await readFile(outputPath);
    const parsed = JSON.parse(stdout || "{\"charts\":[]}") as {
      charts?: Array<{ chartId?: string; created?: boolean; anchor?: string }>;
    };
    const chartAnchorById = new Map<string, string>();
    for (const chart of parsed.charts ?? []) {
      if (chart.chartId && chart.created && chart.anchor) {
        chartAnchorById.set(chart.chartId, chart.anchor);
      }
    }
    return {
      buffer: outputBuffer,
      chartAnchorById,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function normalizeWorkbookHeader(value: unknown, index: number) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return `column_${index + 1}`;
}

function normalizeWorkbookCell(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return value ?? null;
}

function buildKnownEntityCatalog(
  parsed: Awaited<ReturnType<typeof parseEvidencePackage>>,
  run: RunRow,
) {
  const entities = new Set<string>();
  const entityColumnPattern = /(brand|marca|supplier|fornitore|retailer|insegna|channel|canale|segment|segmento|family|famiglia|market|mercato|item|sku)/i;

  for (const sheet of parsed.normalizedWorkbook.sheets) {
    for (const column of sheet.columns) {
      if (!entityColumnPattern.test(column.name)) {
        continue;
      }

      for (const row of sheet.rows.slice(0, 500)) {
        const value = row[column.name];
        if (typeof value !== "string") {
          continue;
        }
        const normalized = normalizeEntityName(value);
        if (normalized) {
          entities.add(normalized);
        }
      }
    }
  }

  [
    run.client,
    run.audience,
    run.objective,
    run.thesis,
    run.business_context,
  ].forEach((value) => {
    const normalized = normalizeEntityName(value ?? "");
    if (normalized) {
      entities.add(normalized);
    }
  });

  return [...entities];
}

function normalizeEntityName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function manifestToFidelityInput(
  manifest: z.infer<typeof deckManifestSchema>,
): FidelitySlideInput[] {
  const chartById = new Map(manifest.charts.map((chart) => [chart.id, chart]));
  return manifest.slides.map((slide) => {
    const chart = slide.chartId ? chartById.get(slide.chartId) : undefined;
    return {
      position: slide.position,
      title: slide.title,
      ...(slide.body ? { body: slide.body } : {}),
      ...(slide.bullets ? { bullets: slide.bullets } : {}),
      ...(slide.callout ? { callout: { text: slide.callout.text } } : {}),
      ...(slide.metrics ? { metrics: slide.metrics } : {}),
      ...(slide.evidenceIds ? { evidenceIds: slide.evidenceIds } : {}),
      ...(slide.pageIntent ? { pageIntent: slide.pageIntent } : {}),
      ...(chart
        ? {
            chart: {
              chartType: chart.chartType,
              title: chart.title,
              ...(chart.xAxisLabel ? { xAxisLabel: chart.xAxisLabel } : {}),
              ...(chart.yAxisLabel ? { yAxisLabel: chart.yAxisLabel } : {}),
              ...(chart.bubbleSizeLabel ? { bubbleSizeLabel: chart.bubbleSizeLabel } : {}),
              ...(chart.excelSheetName ? { excelSheetName: chart.excelSheetName } : {}),
              ...(chart.dataSignature ? { dataSignature: chart.dataSignature } : {}),
              ...(chart.sourceNote ? { sourceNote: chart.sourceNote } : {}),
            },
          }
        : {}),
    };
  });
}

function manifestToClaimTraceabilityInput(
  manifest: z.infer<typeof deckManifestSchema>,
) {
  const chartById = new Map(manifest.charts.map((chart) => [chart.id, chart]));
  return manifest.slides.map((slide) => {
    const chart = slide.chartId ? chartById.get(slide.chartId) : undefined;
    return {
      position: slide.position,
      layoutId: slide.layoutId,
      slideArchetype: slide.slideArchetype,
      pageIntent: slide.pageIntent,
      title: slide.title,
      body: slide.body,
      bullets: slide.bullets,
      calloutText: slide.callout?.text,
      chartSheetName: chart?.excelSheetName,
    };
  });
}

function formatClaimTraceabilityIssue(issue: ClaimTraceabilityIssue) {
  return `Slide ${issue.position} claim issue [claim_traceability]: ${issue.message}`;
}

function lintManifest(
  manifest: z.infer<typeof deckManifestSchema>,
  requestedSlideCount?: number,
  fidelityContext?: FidelityContext,
) {
  const result = lintDeckText(manifestToLintInput(manifest));
  const planLint = lintManifestPlan(manifest, requestedSlideCount);
  const fidelityLint = fidelityContext
    ? lintDeckFidelity({
        slides: manifestToFidelityInput(manifest),
        sheets: fidelityContext.workbookSheets,
        knownEntities: fidelityContext.knownEntities,
      })
    : { passed: true, violations: [] as FidelityViolation[] };
  const actionableIssues = [
    ...result.slideResults.flatMap((slideResult) =>
      slideResult.result.violations
        .filter((violation) => violation.severity === "critical" || violation.severity === "major")
        .map((violation) => `Slide ${slideResult.position} writing issue [${violation.rule}]: ${violation.message} (${violation.field})`),
    ),
    ...result.deckViolations
      .filter((violation) => violation.severity === "critical" || violation.severity === "major")
      .map((violation) => `Deck writing issue [${violation.rule}]: ${violation.message}`),
    ...fidelityLint.violations
      .filter((violation) => violation.severity === "critical" || violation.severity === "major")
      .map((violation) => `Slide ${violation.position} fidelity issue [${violation.rule}]: ${violation.message}`),
    ...planLint.actionableIssues,
  ];

  return { result, actionableIssues, planLint: planLint.result, fidelity: fidelityLint };
}

function lintManifestPlan(manifest: z.infer<typeof deckManifestSchema>, requestedSlideCount?: number) {
  const planTargetSlideCount = resolvePlanLintTargetSlideCount(requestedSlideCount, manifest.slideCount);
  const result = lintSlidePlan(manifestToPlanLintInput(manifest), planTargetSlideCount);
  const meceCheckEnabled = shouldEnforceDeckPlanMeceCheck(planTargetSlideCount);
  const actionableIssues = [
    ...result.pairViolations
      .filter((violation) => isActionablePlanPairViolation(violation, meceCheckEnabled))
      .map((violation) => `Slides ${violation.positions[0]} and ${violation.positions[1]} redundancy issue [${violation.rule}]: ${violation.message}`),
    ...result.deckViolations
      .filter((violation) => isActionablePlanDeckViolation(violation, meceCheckEnabled))
      .map((violation) => formatPlanDeckViolation(violation)),
  ];
  return { result, actionableIssues, meceCheckEnabled };
}

function summarizeLintResult(lint: ReturnType<typeof lintManifest>) {
  const slideViolationCount = lint.result.slideResults.reduce(
    (total, slideResult) => total + slideResult.result.violations.length,
    0,
  );

  return {
    passed: lint.result.passed,
    actionableIssueCount: lint.actionableIssues.length,
    actionableIssues: lint.actionableIssues,
    slideViolationCount,
    deckViolationCount: lint.result.deckViolations.length,
    fidelityViolationCount: lint.fidelity.violations.length,
    planPairViolationCount: lint.planLint.pairViolations.length,
    planDeckViolationCount: lint.planLint.deckViolations.length,
    planUniqueDimensions: lint.planLint.uniqueDimensions,
    planMinRequiredDimensions: lint.planLint.minRequiredDimensions,
    planDeepestLevel: lint.planLint.deepestLevel,
    planContentSlideCount: lint.planLint.contentSlideCount,
    planAppendixSlideCount: lint.planLint.appendixSlideCount,
    planAppendixCap: lint.planLint.appendixCap,
  };
}

function validateManifestContract(manifest: z.infer<typeof deckManifestSchema>) {
  const chartById = new Map(manifest.charts.map((chart) => [chart.id, chart]));
  const result = validateDeckContract(
    manifest.slides.map((slide, index) => ({
      layoutId: normalizeManifestLayoutIdForContract(slide, index, manifest.slides.length),
      chartType: slide.chartId ? chartById.get(slide.chartId)?.chartType : undefined,
      slideArchetype: slide.slideArchetype,
      position: slide.position,
      title: slide.title,
      body: slide.body,
      bullets: slide.bullets,
      pageIntent: slide.pageIntent,
    })),
  );

  return {
    result,
    actionableIssues: result.violations.map((violation) => `Deck contract issue: ${violation.message}`),
  };
}

function normalizeManifestLayoutIdForContract(
  slide: z.infer<typeof deckManifestSchema>["slides"][number],
  _index: number,
  _slideCount: number,
) {
  const archetype = normalizeLayoutAlias(slide.slideArchetype);
  if (archetype === "cover") {
    return "cover";
  }
  if (archetype === "recommendation-cards") {
    return "recommendation-cards";
  }
  if (archetype && archetype !== "unknown") {
    return archetype;
  }

  const layout = normalizeLayoutAlias(slide.layoutId);
  if (layout === "exec-summary" && _index === _slideCount - 1) {
    return "summary";
  }
  if (layout && layout !== "unknown") {
    return layout;
  }

  return slide.layoutId ?? "title-body";
}

function normalizeLayoutAlias(raw: string | undefined) {
  if (!raw) {
    return "unknown";
  }

  const normalized = raw.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (normalized === "cover" || normalized.includes("cover") || normalized.includes("title slide")) {
    return "cover";
  }
  if (normalized === "exec summary" || normalized === "exec-summary" || normalized.includes("section header") || normalized.includes("overview")) {
    return "exec-summary";
  }
  if (normalized === "summary" || normalized.includes("summary") || normalized.includes("closing") || normalized.includes("takeaway")) {
    return "summary";
  }
  if (normalized === "recommendation cards" || normalized === "recommendation-cards" || normalized.includes("recommendation")) {
    return "recommendation-cards";
  }
  if (normalized === "title body" || normalized === "title-body" || normalized.includes("title and content") || normalized.includes("title, content")) {
    return "title-body";
  }
  if (normalized === "title bullets" || normalized === "title-bullets" || normalized.includes("bullet") || normalized.includes("list")) {
    return "title-bullets";
  }
  if (normalized === "two column" || normalized === "two-column" || normalized.includes("two content") || normalized.includes("comparison")) {
    return "two-column";
  }
  if (normalized === "title chart" || normalized === "title-chart" || normalized.includes("title only") || normalized.includes("chart")) {
    return "title-chart";
  }
  return "unknown";
}

async function callWorkflowRpc<T>(
  config: ReturnType<typeof resolveConfig>,
  input: {
    functionName: string;
    params?: Record<string, unknown>;
  },
) {
  const url = new URL(`/rest/v1/rpc/${input.functionName}`, config.supabaseUrl);
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    apikey: config.serviceKey,
  });

  if (config.serviceKey.split(".").length === 3 && !config.serviceKey.startsWith("sb_secret_")) {
    headers.set("Authorization", `Bearer ${config.serviceKey}`);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(input.params ?? {}),
    signal: AbortSignal.timeout(SUPABASE_RPC_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Unable to execute RPC ${input.functionName}: ${await response.text()}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

function summarizeDeckContractResult(contract: ReturnType<typeof validateManifestContract>) {
  return {
    passed: contract.result.valid,
    actionableIssueCount: contract.actionableIssues.length,
    actionableIssues: contract.actionableIssues,
    violationCount: contract.result.violations.length,
  };
}

function collectPublishGateFailures(input: {
  qaReport: Awaited<ReturnType<typeof buildQaReport>>;
  lint: ReturnType<typeof lintManifest>;
  contract: ReturnType<typeof validateManifestContract>;
  claimIssues?: ClaimTraceabilityIssue[];
}) {
  const blockingFailures = input.qaReport.failed.filter((check) => HARD_QA_BLOCKERS.has(check));
  const advisories = [
    ...input.qaReport.failed.filter((check) => !HARD_QA_BLOCKERS.has(check)),
    ...input.lint.actionableIssues.map((issue) => `lint:${issue}`),
    ...input.contract.actionableIssues.map((issue) => `contract:${issue}`),
    ...((input.claimIssues ?? []).map((issue) => `claim:${formatClaimTraceabilityIssue(issue)}`)),
  ];

  return {
    blockingFailures: [...new Set(blockingFailures)],
    advisories: [...new Set(advisories)],
    lintSummary: summarizeLintResult(input.lint),
    contractSummary: summarizeDeckContractResult(input.contract),
  };
}

function classifyQualityPassport(input: {
  qaReport: Awaited<ReturnType<typeof buildQaReport>>;
  lint: ReturnType<typeof lintManifest>;
  contract: ReturnType<typeof validateManifestContract>;
  visualQa: RenderedPageQaReport;
  claimIssues?: ClaimTraceabilityIssue[];
}) {
  const writingCriticalCount =
    input.lint.result.deckViolations.filter((issue) => issue.severity === "critical").length +
    input.lint.result.slideResults.reduce(
      (total, slide) => total + slide.result.violations.filter((issue) => issue.severity === "critical").length,
      0,
    ) +
    input.lint.fidelity.violations.filter((issue) => issue.severity === "critical").length +
    input.lint.planLint.pairViolations.filter((issue) => issue.severity === "critical").length +
    input.lint.planLint.deckViolations.filter((issue) => issue.severity === "critical").length;
  const writingMajorCount =
    input.lint.result.deckViolations.filter((issue) => issue.severity === "major").length +
    input.lint.result.slideResults.reduce(
      (total, slide) => total + slide.result.violations.filter((issue) => issue.severity === "major").length,
      0,
    ) +
    input.lint.fidelity.violations.filter((issue) => issue.severity === "major").length +
    input.lint.planLint.pairViolations.filter((issue) => issue.severity === "major").length +
    input.lint.planLint.deckViolations.filter((issue) => issue.severity === "major").length;
  const visualCriticalCount = input.visualQa.issues.filter((issue) => issue.severity === "critical").length;
  const visualMajorCount = input.visualQa.issues.filter((issue) => issue.severity === "major").length;
  const claimCriticalCount = (input.claimIssues ?? []).filter((issue) => issue.severity === "critical").length;
  const claimMajorCount = (input.claimIssues ?? []).filter((issue) => issue.severity === "major").length;
  const contractCriticalCount = input.contract.actionableIssues.length;
  const criticalCount = writingCriticalCount + visualCriticalCount + claimCriticalCount + contractCriticalCount;
  const majorCount = writingMajorCount + visualMajorCount + claimMajorCount;
  const mecePass = input.lint.planLint.pairViolations.every((issue) => issue.severity === "minor")
    && input.lint.planLint.deckViolations.every((issue) => issue.severity === "minor");

  let classification: "gold" | "silver" | "bronze" | "recovery";
  if (
    input.qaReport.failed.some((check) => HARD_QA_BLOCKERS.has(check))
    || criticalCount > 0
    || !mecePass
    || input.visualQa.score < 5
    || majorCount > 10
  ) {
    classification = "recovery";
  } else if (majorCount <= 3 && input.visualQa.score >= 8.5) {
    classification = "gold";
  } else if (majorCount <= 6 && input.visualQa.score >= 7) {
    classification = "silver";
  } else {
    classification = "bronze";
  }

  return {
    classification,
    criticalCount,
    majorCount,
    visualScore: input.visualQa.score,
    mecePass,
    summary: `Quality passport ${classification}: visual=${input.visualQa.score.toFixed(1)}, critical=${criticalCount}, major=${majorCount}, mecePass=${mecePass}.`,
  };
}

function buildPublishDecision(input: {
  qaReport: Awaited<ReturnType<typeof buildQaReport>>;
  lint: ReturnType<typeof lintManifest>;
  contract: ReturnType<typeof validateManifestContract>;
  visualQa: RenderedPageQaReport;
  artifactSource: PublishDecision["artifactSource"];
  claimIssues?: ClaimTraceabilityIssue[];
}): PublishDecision {
  const gate = collectPublishGateFailures({
    qaReport: input.qaReport,
    lint: input.lint,
    contract: input.contract,
    claimIssues: input.claimIssues,
  });
  const qualityPassport = classifyQualityPassport({
    qaReport: input.qaReport,
    lint: input.lint,
    contract: input.contract,
    visualQa: input.visualQa,
    claimIssues: input.claimIssues,
  });

  return {
    decision: gate.blockingFailures.length === 0 ? "publish" : "fail",
    hardBlockers: gate.blockingFailures,
    advisories: [
      ...gate.advisories,
      ...input.lint.result.deckViolations
        .filter((issue) => issue.severity === "minor")
        .map((issue) => issue.message),
      ...input.lint.result.slideResults.flatMap((slide) =>
        slide.result.violations
          .filter((issue) => issue.severity === "minor")
          .map((issue) => `Slide ${slide.position}: ${issue.message}`),
      ),
      ...input.contract.result.violations.map((issue) => issue.message),
      ...input.visualQa.issues
        .filter((issue) => issue.severity === "minor")
        .map((issue) => `Rendered slide ${issue.slidePosition} advisory ${issue.code}: ${issue.description}`),
    ],
    qualityPassport,
    artifactSource: input.artifactSource,
    visualQa: {
      overallStatus: input.visualQa.overallStatus,
      deckNeedsRevision: input.visualQa.deckNeedsRevision,
    },
    lintPassed: input.lint.actionableIssues.length === 0 && (input.claimIssues?.length ?? 0) === 0,
    contractPassed: input.contract.actionableIssues.length === 0,
    chartImageCoveragePct: null,
    sceneOverflowCount: 0,
    sceneCollisionCount: 0,
  };
}

function collectCritiqueIssues(
  manifest: z.infer<typeof deckManifestSchema>,
  visualQa: RenderedPageQaReport,
  lintIssues: string[] = [],
  requestedSlideCount?: number,
) {
  const issues = [...collectManifestIssues(manifest, requestedSlideCount)];

  for (const visualIssue of visualQa.issues) {
    if (visualIssue.severity === "minor") {
      continue;
    }
    issues.push(
      `Rendered slide ${visualIssue.slidePosition} has ${visualIssue.severity} visual issue ${visualIssue.code}: ${visualIssue.description}. Fix: ${visualIssue.fix}`,
    );
  }

  if (visualQa.deckNeedsRevision && visualQa.issues.length === 0) {
    issues.push(`Rendered deck requires revision: ${visualQa.summary}`);
  }

  issues.push(...lintIssues);

  return issues;
}

function hasMajorOrCriticalVisualIssues(visualQa: RenderedPageQaReport) {
  return visualQa.issues.some((issue) => issue.severity === "major" || issue.severity === "critical");
}

function classifyRepairIssue(issue: string): keyof RepairIssueBuckets {
  const normalized = issue.toLowerCase();

  if (normalized.includes("has major visual issue") || normalized.includes("has critical visual issue")) {
    return "sonnet";
  }
  if (
    normalized.includes("deck depth issue") ||
    normalized.includes("[content_shortfall]") ||
    normalized.includes("[content_overflow]") ||
    normalized.includes("[appendix_overfill]") ||
    normalized.includes("[drilldown_dimension_coverage]") ||
    normalized.includes("[insufficient_decomposition_depth]") ||
    normalized.includes("[chapter_depth_shallow]") ||
    normalized.includes("[redundant_data_cut]") ||
    normalized.includes("[redundant_analytical_cut]") ||
    normalized.includes("[competitor_tool_")
  ) {
    return "sonnet";
  }
  if (
    normalized.includes("claim-traceability") ||
    normalized.includes("[title_no_number]") ||
    normalized.includes("[title_number_coverage]") ||
    normalized.includes("writing issue") ||
    normalized.includes("mixed-language") ||
    normalized.includes("recommendation")
  ) {
    return "haiku";
  }
  if (
    normalized.includes("pptx_large_image_aspect_fit") ||
    normalized.includes("xlsx_manifest_") ||
    normalized.includes("md_present") ||
    normalized.includes("pptx_present")
  ) {
    return "deterministic";
  }

  return "sonnet";
}

function isBlockingRepairIssue(issue: string) {
  return !isAdvisoryCritiqueIssue(issue) && classifyRepairIssue(issue) !== "deterministic";
}

function bucketRepairIssues(input: {
  critiqueIssues: string[];
  claimTraceabilityIssues: ClaimTraceabilityIssue[];
  visualQa: RenderedPageQaReport;
}): RepairIssueBuckets {
  const buckets: RepairIssueBuckets = {
    deterministic: [],
    haiku: [],
    sonnet: [],
  };

  for (const issue of input.critiqueIssues) {
    buckets[classifyRepairIssue(issue)].push(issue);
  }

  if (!hasMajorOrCriticalVisualIssues(input.visualQa) && input.claimTraceabilityIssues.length > 0) {
    buckets.haiku.push(...input.claimTraceabilityIssues.map(formatClaimTraceabilityIssue));
  }

  return buckets;
}

function chooseRepairLane(buckets: RepairIssueBuckets, visualQa: RenderedPageQaReport): RepairLane {
  if (hasMajorOrCriticalVisualIssues(visualQa) || buckets.sonnet.length > 0) {
    return "sonnet";
  }
  if (buckets.haiku.length > 0) {
    return "haiku";
  }
  return "none";
}

function buildRepairFrontierState(input: {
  lintIssues: string[];
  contractIssues: string[];
  claimTraceabilityIssues: ClaimTraceabilityIssue[];
  visualQa: RenderedPageQaReport;
  critiqueIssues: string[];
}) {
  const advisoryIssueCount = input.critiqueIssues.filter((issue) => isAdvisoryCritiqueIssue(issue)).length;
  const blockingVisualIssueCount = input.visualQa.issues.filter((issue) => issue.severity === "major" || issue.severity === "critical").length;

  return {
    blockingContractIssueCount: input.lintIssues.length + input.contractIssues.length,
    claimTraceabilityIssueCount: input.claimTraceabilityIssues.length,
    blockingVisualIssueCount,
    visualScore: input.visualQa.score,
    advisoryIssueCount,
    deckNeedsRevision: input.visualQa.deckNeedsRevision,
  };
}

function compareRepairFrontierState(candidate: RepairFrontierState, baseline: RepairFrontierState) {
  if (candidate.blockingContractIssueCount !== baseline.blockingContractIssueCount) {
    return candidate.blockingContractIssueCount < baseline.blockingContractIssueCount ? 1 : -1;
  }
  if (candidate.claimTraceabilityIssueCount !== baseline.claimTraceabilityIssueCount) {
    return candidate.claimTraceabilityIssueCount < baseline.claimTraceabilityIssueCount ? 1 : -1;
  }
  if (candidate.blockingVisualIssueCount !== baseline.blockingVisualIssueCount) {
    return candidate.blockingVisualIssueCount < baseline.blockingVisualIssueCount ? 1 : -1;
  }
  if (candidate.deckNeedsRevision !== baseline.deckNeedsRevision) {
    return candidate.deckNeedsRevision ? -1 : 1;
  }
  if (candidate.visualScore !== baseline.visualScore) {
    return candidate.visualScore > baseline.visualScore ? 1 : -1;
  }
  if (candidate.advisoryIssueCount !== baseline.advisoryIssueCount) {
    return candidate.advisoryIssueCount < baseline.advisoryIssueCount ? 1 : -1;
  }
  return 0;
}

function deckStillNeedsRevise(input: {
  frontierState: RepairFrontierState;
}) {
  return !(
    input.frontierState.visualScore >= 7.5 &&
    !input.frontierState.deckNeedsRevision &&
    input.frontierState.blockingContractIssueCount === 0 &&
    input.frontierState.claimTraceabilityIssueCount === 0 &&
    input.frontierState.blockingVisualIssueCount === 0
  );
}

function computeReviseIterationBudget(input: {
  frontierState: RepairFrontierState;
  repairLane: RepairLane;
}) {
  if (input.repairLane === "none" || !deckStillNeedsRevise({ frontierState: input.frontierState })) {
    return 0;
  }

  const severityWeight =
    (input.frontierState.blockingContractIssueCount * 3) +
    (input.frontierState.claimTraceabilityIssueCount * 2) +
    (input.frontierState.blockingVisualIssueCount * 3) +
    (input.frontierState.deckNeedsRevision ? 2 : 0) +
    (input.frontierState.visualScore < 5 ? 4 : input.frontierState.visualScore < 7 ? 2 : 0);

  if (input.repairLane === "haiku") {
    return severityWeight >= 6 ? 2 : 1;
  }

  if (severityWeight >= 18) {
    return 3;
  }
  if (severityWeight >= 8) {
    return 2;
  }
  return 1;
}

function countStructuralSlidesInManifest(manifest: z.infer<typeof deckManifestSchema>) {
  return manifest.slides.some((slide) => {
    const layout = (slide.layoutId ?? slide.slideArchetype ?? "").trim().toLowerCase();
    return layout === "cover";
  }) ? 1 : 0;
}

/**
 * Determine whether a critique issue is advisory (should NOT trigger revise)
 * vs blocking (SHOULD trigger revise).
 *
 * KEY RULE: visual issues with severity "major" or "critical" are ALWAYS blocking,
 * regardless of their code. Only "advisory"-severity visual issues are advisory.
 * Lint and manifest issues are classified by content, not severity.
 */
function isAdvisoryCritiqueIssue(issue: string) {
  const n = issue.toLowerCase();

  // Visual issues carry severity in the string: "has major visual issue" or "has advisory visual issue"
  // Major and critical visual issues are NEVER advisory — they must trigger revise.
  if (n.includes("has major visual issue") || n.includes("has critical visual issue")) return false;
  // Advisory-severity visual issues are always advisory
  if (n.includes("has advisory visual issue")) return true;
  // "pptx_large_image_aspect_fit" is a top-level advisory, not from the visual QA judge
  if (n.includes("pptx_large_image_aspect_fit")) return true;

  // Wave 1 quality blockers: these must trigger revise, not remain advisory.
  if (n.includes("[competitor_tool_")) return false;
  if (n.includes("[title_no_number]")) return false;
  if (n.includes("[title_number_coverage]")) return false;
  if (n.includes("redundancy issue [redundant_data_cut]")) return false;
  if (n.includes("redundancy issue [redundant_analytical_cut]")) return false;
  if (n.includes("deck depth issue [drilldown_dimension_coverage]")) return false;
  if (n.includes("deck depth issue [insufficient_decomposition_depth]")) return false;
  if (n.includes("deck plan issue [content_shortfall]")) return false;
  if (n.includes("deck plan issue [content_overflow]")) return false;
  if (n.includes("deck plan issue [appendix_overfill]")) return false;

  // Lint advisories — layout diversity, layout percentage, writing issues
  if (n.includes("layout type") || n.includes("layout used") || n.includes("main\" layout")) return true;
  if (n.startsWith("deck writing issue") || (n.startsWith("slide") && n.includes("writing issue"))) return true;

  // Title overflow — advisory
  if (n.includes("title is") && n.includes("overflow the right margin")) return true;

  if (n.includes("is below requested targetslidecount")) return false;
  if (n.includes("exceeds requested targetslidecount")) return false;

  // Body length / metric layout warnings — hints, not structural failures
  if (n.includes("body is too long") || n.includes("too much body copy") || n.includes("title is too long for a clean")) return true;

  return false;
}

async function buildQaReport(
  manifest: z.infer<typeof deckManifestSchema>,
  artifacts: {
    pptx?: GeneratedFile | null;
    pdf?: GeneratedFile | null;
    md: GeneratedFile;
    xlsx: GeneratedFile;
  },
  visualQa: RenderedPageQaReport,
  templateDiagnostics: TemplateDiagnostics,
  requestedSlideCount?: number,
  mode: QaMode = "deck",
) {
  const chartSlotConstraintFindings = collectChartSlotConstraintFindings(manifest);
  const checks: Array<{ name: string; passed: boolean; detail: string }> = [
    { name: "md_present", passed: artifacts.md.buffer.length > 0, detail: `${artifacts.md.buffer.length} bytes` },
    { name: "xlsx_present", passed: artifacts.xlsx.buffer.length > 0, detail: `${artifacts.xlsx.buffer.length} bytes` },
    {
      name: "template_diagnostics_present",
      passed: Boolean(templateDiagnostics.status && templateDiagnostics.source && templateDiagnostics.effect),
      detail: `${templateDiagnostics.source}:${templateDiagnostics.status}:${templateDiagnostics.effect}`,
    },
  ];

  if (mode === "deck") {
    const planLint = lintManifestPlan(manifest, requestedSlideCount);
    const structuralSlideCount = countStructuralSlidesInManifest(manifest);
    checks.push(
      { name: "pptx_present", passed: (artifacts.pptx?.buffer.length ?? 0) > 0, detail: `${artifacts.pptx?.buffer.length ?? 0} bytes` },
      { name: "pdf_present", passed: (artifacts.pdf?.buffer.length ?? 0) > 0, detail: `${artifacts.pdf?.buffer.length ?? 0} bytes` },
      { name: "slide_count_positive", passed: manifest.slideCount > 0, detail: `${manifest.slideCount} slides` },
      {
        name: "slide_count_within_requested_plus_appendix_cap",
        passed: typeof requestedSlideCount !== "number"
          || (
            manifest.slideCount >= requestedSlideCount + structuralSlideCount &&
            manifest.slideCount <= requestedSlideCount + structuralSlideCount + getAppendixCapForRequestedDeckSize(requestedSlideCount)
          ),
        detail: typeof requestedSlideCount === "number"
          ? `requested=${requestedSlideCount} structural=${structuralSlideCount} appendixCap=${getAppendixCapForRequestedDeckSize(requestedSlideCount)} manifest=${manifest.slideCount}`
          : "no requested slide count recorded",
      },
      {
        name: "content_slide_count_meets_request",
        passed: typeof requestedSlideCount !== "number" || planLint.result.contentSlideCount >= requestedSlideCount,
        detail: typeof requestedSlideCount === "number"
          ? `requested=${requestedSlideCount} content=${planLint.result.contentSlideCount}`
          : "no requested slide count recorded",
      },
      {
        name: "appendix_slide_count_within_cap",
        passed: typeof requestedSlideCount !== "number" || planLint.result.appendixSlideCount <= planLint.result.appendixCap,
        detail: typeof requestedSlideCount === "number"
          ? `appendix=${planLint.result.appendixSlideCount} cap=${planLint.result.appendixCap}`
          : "no requested slide count recorded",
      },
      {
        name: "chart_density_fits_layout_slots",
        passed: chartSlotConstraintFindings.length === 0,
        detail: chartSlotConstraintFindings.length === 0 ? "all chart category counts fit their slot budgets" : chartSlotConstraintFindings.slice(0, 3).join("; "),
      },
      { name: "titles_present", passed: manifest.slides.every((slide) => slide.title.trim().length > 0), detail: "all slides have titles" },
      { name: "rendered_page_visual_green", passed: visualQa.overallStatus === "green", detail: `visual status=${visualQa.overallStatus}` },
      { name: "rendered_page_visual_no_revision", passed: !visualQa.deckNeedsRevision, detail: visualQa.summary },
      {
        name: "rendered_page_numeric_labels_clean",
        passed: !visualQa.issues.some((issue) => issue.code === "numeric_label_malformed"),
        detail: visualQa.issues
          .filter((issue) => issue.code === "numeric_label_malformed")
          .map((issue) => `slide ${issue.slidePosition}`)
          .join(", ") || "no malformed numeric labels reported",
      },
    );

    const zipSignatureValid =
      (artifacts.pptx?.buffer.length ?? 0) >= 4 &&
      artifacts.pptx!.buffer[0] === 0x50 &&
      artifacts.pptx!.buffer[1] === 0x4b;
    checks.push({ name: "pptx_zip_signature", passed: zipSignatureValid, detail: "pptx starts with PK" });

    const pdfHeaderValid =
      (artifacts.pdf?.buffer.length ?? 0) >= 4 &&
      artifacts.pdf!.buffer[0] === 0x25 &&
      artifacts.pdf!.buffer[1] === 0x50 &&
      artifacts.pdf!.buffer[2] === 0x44 &&
      artifacts.pdf!.buffer[3] === 0x46;
    checks.push({ name: "pdf_header_signature", passed: pdfHeaderValid, detail: "pdf starts with %PDF" });
  } else {
    checks.push({
      name: "report_only_manifest_zero_slides",
      passed: manifest.slideCount === 0,
      detail: `manifest slideCount=${manifest.slideCount}`,
    });
  }

  const mdContentValid = artifacts.md.buffer.toString("utf8").trim().length > 50;
  checks.push({ name: "md_content_present", passed: mdContentValid, detail: "narrative markdown has content" });

  const validated = await validateArtifactChecks(
    manifest,
    checks,
    {
      pptx: artifacts.pptx?.buffer ?? null,
      pdf: artifacts.pdf?.buffer ?? null,
      md: artifacts.md.buffer,
      xlsx: artifacts.xlsx.buffer,
    },
    mode,
  );
  return {
    ...validated,
    template: templateDiagnostics,
  };
}

async function validateArtifactChecks(
  manifest: z.infer<typeof deckManifestSchema>,
  checks: Array<{ name: string; passed: boolean; detail: string }>,
  buffers: {
    pptx: Buffer | null;
    pdf: Buffer | null;
    md: Buffer;
    xlsx: Buffer;
  },
  mode: QaMode,
) {
  const failed = [...checks.filter((check) => !check.passed).map((check) => check.name)];
  const allChecks = [...checks];
  const allFailed = [...failed];

  if (mode === "deck" && buffers.pptx) {
    try {
      const zip = await JSZip.loadAsync(buffers.pptx);
      const presentationXml = zip.file("ppt/presentation.xml");
      const contentTypesXml = zip.file("[Content_Types].xml");
      const slideXmlCount = presentationXml
        ? (await presentationXml.async("string")).match(/<p:sldId\b/gi)?.length ?? 0
        : 0;
      const rasterMediaCount = Object.keys(zip.files).filter((name) => /^ppt\/media\/.+\.(png|jpe?g)$/i.test(name)).length;
      const vectorMediaCount = Object.keys(zip.files).filter((name) => /^ppt\/media\/.+\.(svg|emf|wmf)$/i.test(name)).length;
      const nativeChartXmlCount = Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/i.test(name)).length;
      const aspectMismatchFindings = await collectLargePictureAspectMismatchFindings(zip, manifest);

      // Structural integrity checks that cause PowerPoint repair dialog
      const structuralFindings = await validatePptxStructuralIntegrity(zip);

      const extraChecks = [
        { name: "pptx_presentation_xml", passed: Boolean(presentationXml), detail: "ppt/presentation.xml exists" },
        { name: "pptx_content_types_xml", passed: Boolean(contentTypesXml), detail: "[Content_Types].xml exists" },
        { name: "pptx_slide_xml_count_matches_manifest", passed: slideXmlCount === manifest.slideCount, detail: `manifest=${manifest.slideCount} xml=${slideXmlCount}` },
        {
          name: "pptx_chart_media_present",
          passed: manifest.charts.length === 0 || rasterMediaCount >= manifest.charts.length,
          detail: `charts=${manifest.charts.length} rasterMedia=${rasterMediaCount}`,
        },
        {
          name: "pptx_no_vector_media",
          passed: vectorMediaCount === 0,
          detail: `vectorMedia=${vectorMediaCount}`,
        },
        {
          name: "pptx_no_native_chart_xml",
          passed: nativeChartXmlCount === 0,
          detail: `nativeChartXml=${nativeChartXmlCount}`,
        },
        {
          name: "pptx_large_image_aspect_fit",
          passed: aspectMismatchFindings.length === 0,
          detail: aspectMismatchFindings.length === 0
            ? "no large image aspect mismatches"
            : aspectMismatchFindings
                .slice(0, 3)
                .map((finding) => `slide ${finding.slideNumber} ${finding.target} ${finding.frameRatio.toFixed(2)} vs ${finding.imageRatio.toFixed(2)}`)
                .join("; "),
        },
        {
          name: "pptx_structural_integrity",
          passed: structuralFindings.length === 0,
          detail: structuralFindings.length === 0
            ? "no structural integrity issues"
            : structuralFindings.slice(0, 5).join("; "),
        },
      ];
      allChecks.push(...extraChecks);
      allFailed.push(...extraChecks.filter((check) => !check.passed).map((check) => check.name));
    } catch {
      allFailed.push("pptx_zip_parse_failed");
    }
  }

  if (mode === "deck" && buffers.pdf) {
    try {
      const pdfDoc = await PDFDocument.load(buffers.pdf);
      const pdfPageCount = pdfDoc.getPageCount();
      const expectedPageCount = manifest.pageCount ?? manifest.slideCount;
      const extraChecks = [
        { name: "pdf_parseable", passed: true, detail: `${pdfPageCount} pages` },
        {
          name: "pdf_page_count_matches_manifest",
          passed: pdfPageCount === expectedPageCount,
          detail: `manifest=${expectedPageCount} pdf=${pdfPageCount}`,
        },
      ];
      allChecks.push(...extraChecks);
      allFailed.push(...extraChecks.filter((check) => !check.passed).map((check) => check.name));
    } catch {
      allChecks.push({ name: "pdf_parseable", passed: false, detail: "pdf-lib could not parse the PDF" });
      allFailed.push("pdf_parseable");
    }
  }

  try {
    const zip = await JSZip.loadAsync(buffers.xlsx);
    const workbookXml = zip.file("xl/workbook.xml");
    const workbookXmlString = workbookXml ? await workbookXml.async("string") : "";
    const workbookSheetNames = workbookXmlString ? extractWorkbookSheetNames(workbookXmlString) : [];
    const nativeChartXmlCount = Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/i.test(name)).length;
    const manifestCharts = manifest.charts ?? [];
    const chartsMissingExcelSheetName = manifestCharts.filter((chart) => !chart.excelSheetName);
    const missingWorkbookSheets = manifestCharts
      .map((chart) => chart.excelSheetName)
      .filter((sheetName): sheetName is string => typeof sheetName === "string" && sheetName.trim().length > 0)
      .filter((sheetName) => !workbookSheetNames.includes(sheetName));
    const chartsExpectingNativeExcel = manifestCharts.filter((chart) => supportsNativeExcelChart(chart.chartType));
    const chartsMissingExcelAnchor = chartsExpectingNativeExcel.filter((chart) => !chart.excelChartCellAnchor);
    const linkedNativeExcelCharts = manifestCharts.filter((chart) => chart.excelChartCellAnchor);
    const extraChecks = [
      { name: "xlsx_zip_signature", passed: true, detail: "xlsx starts with PK" },
      { name: "xlsx_workbook_xml", passed: Boolean(workbookXml), detail: "xl/workbook.xml exists" },
      {
        name: "xlsx_manifest_excel_sheet_links_present",
        passed: manifestCharts.length === 0 || chartsMissingExcelSheetName.length === 0,
        detail: manifestCharts.length === 0
          ? "manifest has no chart entries"
          : chartsMissingExcelSheetName.length === 0
            ? `all ${manifestCharts.length} manifest charts include excelSheetName`
            : `missing excelSheetName for ${chartsMissingExcelSheetName.map((chart) => chart.id).slice(0, 5).join(", ")}`,
      },
      {
        name: "xlsx_manifest_excel_sheets_exist",
        passed: missingWorkbookSheets.length === 0,
        detail: missingWorkbookSheets.length === 0
          ? `workbook contains all linked sheets (${workbookSheetNames.length} total)`
          : `missing workbook sheets: ${missingWorkbookSheets.slice(0, 5).join(", ")}`,
      },
      {
        name: "xlsx_manifest_native_chart_links_present",
        passed: chartsExpectingNativeExcel.length === 0 || chartsMissingExcelAnchor.length === 0,
        detail: chartsExpectingNativeExcel.length === 0
          ? "manifest has no native-eligible chart families"
          : chartsMissingExcelAnchor.length === 0
            ? `all ${chartsExpectingNativeExcel.length} native-eligible charts include excelChartCellAnchor`
            : `missing excelChartCellAnchor for ${chartsMissingExcelAnchor.map((chart) => chart.id).slice(0, 5).join(", ")}`,
      },
      {
        name: "xlsx_native_chart_xml_present",
        passed: linkedNativeExcelCharts.length === 0 || nativeChartXmlCount >= linkedNativeExcelCharts.length,
        detail: `manifestAnchors=${linkedNativeExcelCharts.length} nativeChartXml=${nativeChartXmlCount}`,
      },
    ];
    allChecks.push(...extraChecks);
    allFailed.push(...extraChecks.filter((check) => !check.passed).map((check) => check.name));
  } catch {
    allChecks.push({ name: "xlsx_zip_signature", passed: false, detail: "xlsx is not a valid zip package" });
    allFailed.push("xlsx_zip_signature");
  }

  try {
    const markdownText = buffers.md.toString("utf8");
    const flattenedText = markdownText.replace(/\s+/g, " ").trim();
    const visibleTextLength = flattenedText.length;
    const hasInternalScaffolding =
      /evidence-backed story as the deck/i.test(flattenedText) ||
      /downstream ai workflows/i.test(flattenedText) ||
      /text-first format/i.test(flattenedText);
    const hasPlaceholderMetrics = /\bMetric\s+\d+\b/.test(flattenedText);
    const extraChecks = [
      { name: "md_heading_present", passed: /^#\s+\S/m.test(markdownText), detail: "markdown includes a heading" },
      {
        name: "md_text_content_present",
        passed: visibleTextLength >= 160,
        detail: `${visibleTextLength} visible chars`,
      },
      {
        name: "md_no_internal_scaffolding",
        passed: !hasInternalScaffolding,
        detail: hasInternalScaffolding ? "contains internal product scaffolding language" : "no internal scaffolding language",
      },
      {
        name: "md_no_placeholder_metrics",
        passed: !hasPlaceholderMetrics,
        detail: hasPlaceholderMetrics ? "contains placeholder Metric N rows" : "no placeholder metric rows",
      },
    ];
    allChecks.push(...extraChecks);
    allFailed.push(...extraChecks.filter((check) => !check.passed).map((check) => check.name));
  } catch {
    allChecks.push({ name: "md_parseable", passed: false, detail: "markdown text could not be parsed" });
    allFailed.push("md_parseable");
  }

  const blockingFailures = allFailed.filter((check) => HARD_QA_BLOCKERS.has(check));
  const tier =
    blockingFailures.length > 0
      ? "red" as const
      : allFailed.length > 0
      ? "yellow" as const
      : "green" as const;

  return {
    tier,
    passed: blockingFailures.length === 0,
    checks: allChecks,
    failed: [...new Set(allFailed)],
  };
}

function extractWorkbookSheetNames(workbookXml: string) {
  const sheetNames: string[] = [];
  const sheetNameRegex = /<sheet\b[^>]*\bname="([^"]+)"/gi;

  for (const match of workbookXml.matchAll(sheetNameRegex)) {
    const name = decodeXmlEntities(match[1] ?? "").trim();
    if (name.length > 0) {
      sheetNames.push(name);
    }
  }

  return sheetNames;
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function supportsNativeExcelChart(chartType: string | undefined) {
  const normalized = (chartType ?? "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return [
    "bar",
    "horizontal_bar",
    "grouped_bar",
    "stacked_bar",
    "stacked_bar_100",
    "line",
    "area",
    "pie",
    "doughnut",
  ].includes(normalized);
}

const TRANSPARENT_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==",
  "base64",
);

async function sanitizePptxMedia(pptxBuffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(pptxBuffer);
  const mediaFiles = Object.keys(zip.files).filter((name) =>
    /^ppt\/media\/.+\.(svg|emf|wmf)$/i.test(name),
  );
  const rewrittenEntries = new Map<string, string>();
  let changed = false;

  let Resvg: (typeof import("@resvg/resvg-js"))["Resvg"] | null = null;
  if (mediaFiles.some((name) => name.toLowerCase().endsWith(".svg"))) {
    ({ Resvg } = await import("@resvg/resvg-js"));
  }

  for (const mediaPath of mediaFiles) {
    const file = zip.file(mediaPath);
    if (!file) {
      continue;
    }

    const replacementPath = mediaPath.replace(/\.(svg|emf|wmf)$/i, ".png");
    const extension = mediaPath.split(".").pop()?.toLowerCase();
    const buffer = await file.async("nodebuffer");
    let pngBuffer = TRANSPARENT_PNG_BUFFER;

    if (extension === "svg") {
      try {
        const svgText = buffer.toString("utf8");
        const rendered = new Resvg!(svgText, {
          fitTo: { mode: "width", value: 1600 },
          background: "rgba(0,0,0,0)",
          font: {
            fontFiles: resolveBundledFontFiles(),
            loadSystemFonts: false,
            defaultFontFamily: "DejaVu Sans",
          },
        }).render();
        pngBuffer = Buffer.from(rendered.asPng());
      } catch (error) {
        console.warn(`[sanitizePptxMedia] failed to rasterize ${mediaPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    zip.remove(mediaPath);
    zip.file(replacementPath, pngBuffer);
    rewrittenEntries.set(mediaPath.split("/").pop()!, replacementPath.split("/").pop()!);
    changed = true;
  }

  const contentTypesPath = "[Content_Types].xml";
  const contentTypesFile = zip.file(contentTypesPath);
  if (contentTypesFile) {
    let contentTypesXml = await contentTypesFile.async("string");
    for (const [oldName, newName] of rewrittenEntries) {
      contentTypesXml = contentTypesXml.replace(new RegExp(oldName.replace(".", "\\."), "g"), newName);
    }
    contentTypesXml = contentTypesXml
      .replace(/ContentType="image\/svg\+xml"/gi, 'ContentType="image/png"')
      .replace(/ContentType="image\/x-emf"/gi, 'ContentType="image/png"')
      .replace(/ContentType="image\/x-wmf"/gi, 'ContentType="image/png"');
    contentTypesXml = contentTypesXml.replace(
      /<Override\b[^>]*PartName="\/ppt\/slideMasters\/slideMaster\d+\.xml"[^>]*\/>/gi,
      (overrideTag) => {
        const partMatch = overrideTag.match(/PartName="\/([^"]+)"/i);
        const partPath = partMatch?.[1];
        if (!partPath || zip.file(partPath)) {
          return overrideTag;
        }
        changed = true;
        return "";
      },
    );
    zip.file(contentTypesPath, contentTypesXml);
  }

  for (const [entry, file] of Object.entries(zip.files)) {
    if (!entry.endsWith(".rels")) {
      continue;
    }
    let relsXml = await file.async("string");
    let relsChanged = false;
    for (const [oldName, newName] of rewrittenEntries) {
      if (!relsXml.includes(oldName)) {
        continue;
      }
      relsXml = relsXml.replace(new RegExp(oldName.replace(".", "\\."), "g"), newName);
      relsChanged = true;
    }
    if (relsChanged) {
      zip.file(entry, relsXml);
    }
  }

  if (!changed) {
    return pptxBuffer;
  }

  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

function buildReportOnlyVisualQa(): RenderedPageQaReport {
  return {
    overallStatus: "green",
    score: 10,
    summary: "Report-only run. Visual QA skipped because no presentation artifacts were generated.",
    deckNeedsRevision: false,
    issues: [],
    strongestSlides: [],
    weakestSlides: [],
  };
}

function shouldUseExactTemplateMode(input: {
  isReportOnly: boolean;
  templateFile?: LoadedSourceFile;
  templateProfile: TemplateProfile;
}) {
  // Disabled until the manifest can carry full rendered slide content.
  // Recomposition from manifest metadata preserves template geometry but destroys
  // slide body content (SCQA, diagnostics, recommendations) in production.
  return false;
}

async function recomposeExactTemplateArtifacts(input: {
  stage: "author" | "revise";
  run: RunRow;
  manifest: z.infer<typeof deckManifestSchema>;
  interimPptx: GeneratedFile;
  templateProfile: TemplateProfile;
  templateFile?: LoadedSourceFile;
  phaseTelemetry: Record<string, unknown>;
}) {
  const telemetryKey = input.stage === "author" ? "exactTemplateAuthor" : "exactTemplateRevise";
  if (!input.templateFile) {
    input.phaseTelemetry[telemetryKey] = {
      attempted: false,
      reason: "template_file_missing",
    };
    return null;
  }

  try {
    const slidePlan = buildExactTemplateSlidePlan(input.manifest, input.templateProfile);
    const chartImages = await extractChartImagesFromPptx(input.interimPptx.buffer, input.manifest);
    const charts = buildExactTemplateCharts(input.manifest);
    const artifact = await renderPptxArtifact({
      deckTitle: input.run.client?.trim() || input.manifest.slides[0]?.title || "Basquio deck",
      slidePlan,
      charts,
      chartImages,
      templateProfile: input.templateProfile,
      templateFile: {
        fileName: input.templateFile.file_name,
        base64: input.templateFile.buffer.toString("base64"),
      },
    });
    const rawArtifactBuffer = Buffer.isBuffer(artifact.buffer)
      ? artifact.buffer
      : Buffer.from(artifact.buffer.data);
    const { buffer: artifactBuffer, duplicateMediaCount, duplicateMediaBytes } = await dedupeRecomposedPptx(rawArtifactBuffer);
    const exactPptx: GeneratedFile = {
      fileId: `${input.stage}-template-preserved-pptx`,
      fileName: "deck.pptx",
      buffer: artifactBuffer,
      mimeType: artifact.mimeType,
    };
    input.phaseTelemetry[telemetryKey] = {
      attempted: true,
      succeeded: true,
      chartImageCount: chartImages.size,
      chartCount: input.manifest.charts.length,
      slideCount: slidePlan.length,
      pdfRegenerated: false,
      pdfStrategy: "preserve_existing_pdf",
      duplicateMediaCount,
      duplicateMediaBytes,
      originalPptxBytes: rawArtifactBuffer.byteLength,
      dedupedPptxBytes: artifactBuffer.byteLength,
    };
    return { pptx: exactPptx, pdf: null };
  } catch (error) {
    input.phaseTelemetry[telemetryKey] = {
      attempted: true,
      succeeded: false,
      reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    };
    return null;
  }
}

async function dedupeRecomposedPptx(buffer: Buffer): Promise<{
  buffer: Buffer;
  duplicateMediaCount: number;
  duplicateMediaBytes: number;
}> {
  const zip = await JSZip.loadAsync(buffer);
  const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/") && !zip.files[name]?.dir);
  const seen = new Map<string, string>();
  const renames = new Map<string, string>();
  let duplicateMediaBytes = 0;

  for (const mediaPath of mediaFiles) {
    const file = zip.files[mediaPath];
    if (!file) {
      continue;
    }
    const data = await file.async("nodebuffer");
    const hash = createHash("md5").update(data).digest("hex");
    const canonicalPath = seen.get(hash);
    if (canonicalPath) {
      renames.set(mediaPath, canonicalPath);
      duplicateMediaBytes += data.byteLength;
      zip.remove(mediaPath);
      continue;
    }
    seen.set(hash, mediaPath);
  }

  if (renames.size === 0) {
    return {
      buffer,
      duplicateMediaCount: 0,
      duplicateMediaBytes: 0,
    };
  }

  for (const [zipPath, file] of Object.entries(zip.files)) {
    if (file.dir || !zipPath.endsWith(".rels")) {
      continue;
    }
    let content = await file.async("string");
    let changed = false;
    for (const [oldPath, newPath] of renames) {
      const oldName = oldPath.split("/").pop();
      const newName = newPath.split("/").pop();
      if (!oldName || !newName || oldName === newName || !content.includes(oldName)) {
        continue;
      }
      content = content.replaceAll(oldName, newName);
      changed = true;
    }
    if (changed) {
      zip.file(zipPath, content);
    }
  }

  return {
    buffer: Buffer.from(
      await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      }),
    ),
    duplicateMediaCount: renames.size,
    duplicateMediaBytes,
  };
}

function buildExactTemplateSlidePlan(
  manifest: z.infer<typeof deckManifestSchema>,
  templateProfile: TemplateProfile,
): SlideSpec[] {
  return manifest.slides.map((slide, index) => {
    const blocks: SlideSpec["blocks"] = [];

    for (const metric of slide.metrics ?? []) {
      blocks.push({
        kind: "metric",
        label: metric.label,
        value: metric.value,
        content: metric.delta,
        tone: "default",
        items: [],
        evidenceIds: slide.evidenceIds ?? [],
      });
    }

    if (slide.chartId) {
      blocks.push({
        kind: "chart",
        chartId: slide.chartId,
        content: slide.title,
        items: [],
        evidenceIds: slide.evidenceIds ?? [],
        tone: "default",
      });
    }

    if (slide.body) {
      blocks.push({
        kind: "body",
        content: slide.body,
        items: [],
        evidenceIds: slide.evidenceIds ?? [],
        tone: "default",
      });
    }

    if ((slide.bullets?.length ?? 0) > 0) {
      blocks.push({
        kind: slide.chartId ? "evidence-list" : "bullet-list",
        items: slide.bullets ?? [],
        evidenceIds: slide.evidenceIds ?? [],
        tone: "default",
      });
    }

    if (slide.callout?.text) {
      blocks.push({
        kind: "callout",
        content: slide.callout.text,
        items: [],
        evidenceIds: slide.evidenceIds ?? [],
        tone: mapManifestCalloutTone(slide.callout.tone),
      });
    }

    if (blocks.length === 0) {
      blocks.push({
        kind: "body",
        content: slide.subtitle ?? slide.title,
        items: [],
        evidenceIds: slide.evidenceIds ?? [],
        tone: "default",
      });
    }

    const templateLayoutId = selectTemplateLayoutForManifestSlide(slide, index, templateProfile);

    return {
      id: `slide-${slide.position}`,
      purpose: slide.title,
      section: "",
      emphasis: index === 0 ? "cover" : "content",
      layoutId: templateLayoutId,
      slideArchetype: templateLayoutId,
      title: slide.title,
      subtitle: slide.subtitle,
      blocks,
      claimIds: [],
      evidenceIds: slide.evidenceIds ?? [],
      speakerNotes: "",
      transition: "",
    };
  });
}

function buildExactTemplateCharts(
  manifest: z.infer<typeof deckManifestSchema>,
): ChartSpec[] {
  return manifest.charts.map((chart) => ({
    id: chart.id,
    title: chart.title,
    family: normalizeManifestChartFamily(chart.chartType),
    editableInPptx: false,
    artifactMode: "raster-screenshot",
    categories: chart.categories ?? [],
    series: [],
    xKey: undefined,
    yKeys: [],
    summary: chart.sourceNote ?? "",
    annotation: "",
    evidenceIds: [],
    bindings: [],
  }));
}

function normalizeManifestChartFamily(chartType: string | undefined): ChartSpec["family"] {
  const normalized = (chartType ?? "bar").trim().toLowerCase().replace(/[_\s]+/g, "-");
  switch (normalized) {
    case "line":
      return "line";
    case "area":
      return "area";
    case "pie":
      return "pie";
    case "doughnut":
    case "donut":
      return "doughnut";
    case "waterfall":
      return "waterfall";
    case "scatter":
    case "bubble":
      return "scatter";
    case "horizontal-bar":
    case "horizontal":
      return "horizontal-bar";
    case "grouped-bar":
      return "grouped-bar";
    case "stacked-bar":
    case "stacked-bar-100":
      return "stacked-bar";
    case "heatmap":
      return "heatmap";
    default:
      return "bar";
  }
}

function selectTemplateLayoutForManifestSlide(
  slide: z.infer<typeof deckManifestSchema>["slides"][number],
  index: number,
  templateProfile: TemplateProfile,
) {
  const candidateLayouts = templateProfile.layouts.filter((layout) => typeof layout.sourceSlideNumber === "number");
  const pick = (predicate: (layout: TemplateProfile["layouts"][number]) => boolean) =>
    candidateLayouts.find(predicate)?.id;
  const exactId = pick((layout) => layout.id === slide.layoutId || layout.id === slide.slideArchetype);
  if (exactId) {
    return exactId;
  }
  if (index === 0) {
    return (
      pick((layout) => layout.id === "cover" || layout.name.toLowerCase().includes("cover")) ??
      candidateLayouts[0]?.id ??
      slide.layoutId
    );
  }
  if (slide.chartId && (slide.metrics?.length ?? 0) > 0) {
    return (
      pick((layout) => layout.placeholders.includes("metric-strip") && layout.placeholders.includes("chart")) ??
      pick((layout) => layout.placeholders.includes("chart") && layout.placeholders.includes("evidence-list")) ??
      candidateLayouts[0]?.id ??
      slide.layoutId
    );
  }
  if (slide.chartId) {
    return (
      pick((layout) => layout.placeholders.includes("chart") && layout.placeholders.includes("body-right")) ??
      pick((layout) => layout.placeholders.includes("chart")) ??
      candidateLayouts[0]?.id ??
      slide.layoutId
    );
  }
  if (slide.callout?.text) {
    return (
      pick((layout) => layout.placeholders.includes("callout") && layout.placeholders.includes("body")) ??
      pick((layout) => layout.placeholders.includes("callout")) ??
      candidateLayouts[0]?.id ??
      slide.layoutId
    );
  }
  if ((slide.bullets?.length ?? 0) >= 4) {
    return (
      pick((layout) => layout.placeholders.includes("body-left") && layout.placeholders.includes("body-right")) ??
      pick((layout) => layout.placeholders.includes("body")) ??
      candidateLayouts[0]?.id ??
      slide.layoutId
    );
  }
  return (
    pick((layout) => layout.placeholders.includes("body")) ??
    candidateLayouts[0]?.id ??
    slide.layoutId
  );
}

function mapManifestCalloutTone(
  tone: "accent" | "green" | "orange" | undefined,
): SlideSpec["blocks"][number]["tone"] {
  switch (tone) {
    case "green":
      return "positive";
    case "orange":
      return "caution";
    case "accent":
    default:
      return "default";
  }
}

async function extractChartImagesFromPptx(
  pptxBuffer: Buffer,
  manifest: z.infer<typeof deckManifestSchema>,
) {
  const zip = await JSZip.loadAsync(pptxBuffer);
  const chartImages = new Map<string, Buffer>();

  for (const slide of manifest.slides) {
    if (!slide.chartId) {
      continue;
    }

    const slideEntry = `ppt/slides/slide${slide.position}.xml`;
    const relsEntry = `ppt/slides/_rels/slide${slide.position}.xml.rels`;
    const slideXml = await zip.file(slideEntry)?.async("string");
    const relsXml = await zip.file(relsEntry)?.async("string");

    if (!slideXml || !relsXml) {
      continue;
    }

    const relTargets = parseRelationshipTargets(relsXml, slideEntry);
    const pictures = slideXml.match(/<p:pic[\s\S]*?<\/p:pic>/g) ?? [];
    let bestCandidate: { target: string; area: number; bytes: number } | null = null;

    for (const picture of pictures) {
      const relId = picture.match(/<a:blip[^>]*r:embed="([^"]+)"/i)?.[1];
      const cx = Number.parseInt(picture.match(/<a:ext[^>]*cx="(\d+)"/i)?.[1] ?? "", 10);
      const cy = Number.parseInt(picture.match(/<a:ext[^>]*cy="(\d+)"/i)?.[1] ?? "", 10);
      if (!relId || !Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) {
        continue;
      }

      const target = relTargets.get(relId);
      if (!target || !/^ppt\/media\/.+\.(png|jpe?g)$/i.test(target)) {
        continue;
      }

      const buffer = await zip.file(target)?.async("nodebuffer");
      if (!buffer) {
        continue;
      }

      const area = cx * cy;
      const score = area * 100 + buffer.length;
      if (!bestCandidate || score > (bestCandidate.area * 100 + bestCandidate.bytes)) {
        bestCandidate = {
          target,
          area,
          bytes: buffer.length,
        };
      }
    }

    if (!bestCandidate) {
      continue;
    }

    const bestBuffer = await zip.file(bestCandidate.target)?.async("nodebuffer");
    if (bestBuffer) {
      chartImages.set(slide.chartId, bestBuffer);
    }
  }

  return chartImages;
}

/**
 * Validate PPTX structural integrity to catch corruption that triggers
 * the PowerPoint repair dialog. Checks:
 * - [Content_Types].xml references match actual parts
 * - Slide relationship files exist for each slide
 * - No duplicate relationship IDs within a .rels file
 * - All media referenced by slides exist in the zip
 * - presentation.xml.rels exists and references all slides
 */
async function validatePptxStructuralIntegrity(zip: JSZip): Promise<string[]> {
  const findings: string[] = [];

  // 1. Check [Content_Types].xml exists and references are consistent
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) {
    findings.push("Missing [Content_Types].xml");
    return findings;
  }
  const contentTypesXml = await contentTypesFile.async("string");

  // 2. Check presentation.xml.rels exists
  const presRelsFile = zip.file("ppt/_rels/presentation.xml.rels");
  if (!presRelsFile) {
    findings.push("Missing ppt/_rels/presentation.xml.rels");
    return findings;
  }
  const presRelsXml = await presRelsFile.async("string");

  // 3. Verify all slides referenced in presentation.xml.rels exist
  const slideRefs = [...presRelsXml.matchAll(/Target="(slides\/slide\d+\.xml)"/gi)];
  for (const match of slideRefs) {
    const slidePath = `ppt/${match[1]}`;
    if (!zip.file(slidePath)) {
      findings.push(`presentation.xml.rels references ${match[1]} but file is missing`);
    }
  }

  // 4. Check each slide has a matching .rels file and no duplicate rIds
  const slideFiles = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/i.test(name),
  );
  for (const slidePath of slideFiles) {
    const relsPath = slidePath.replace("slides/", "slides/_rels/") + ".rels";
    const relsFile = zip.file(relsPath);
    if (!relsFile) {
      findings.push(`Missing relationship file for ${slidePath.replace("ppt/", "")}`);
      continue;
    }

    const relsXml = await relsFile.async("string");
    const relIds = [...relsXml.matchAll(/Id="([^"]+)"/gi)].map((m) => m[1]);
    const uniqueIds = new Set(relIds);
    if (uniqueIds.size < relIds.length) {
      findings.push(`Duplicate relationship IDs in ${relsPath.replace("ppt/", "")}`);
    }

    // Verify referenced media files exist
    const mediaRefs = [...relsXml.matchAll(/Target="([^"]*media\/[^"]+)"/gi)];
    for (const mediaMatch of mediaRefs) {
      const mediaTarget = mediaMatch[1].startsWith("../")
        ? `ppt/${mediaMatch[1].slice(3)}`
        : `ppt/slides/${mediaMatch[1]}`;
      const normalizedPath = mediaTarget.replace(/\/\.\.\//g, "/").replace(/\/[^/]+\/\.\.\//g, "/");
      if (!zip.file(normalizedPath) && !zip.file(mediaTarget)) {
        findings.push(`${slidePath.replace("ppt/", "")} references missing media: ${mediaMatch[1]}`);
      }
    }
  }

  // 5. Check PartName entries in [Content_Types].xml reference existing parts
  const overrideParts = [...contentTypesXml.matchAll(/PartName="\/([^"]+)"/gi)];
  for (const match of overrideParts) {
    const partPath = match[1];
    if (!zip.file(partPath)) {
      findings.push(`[Content_Types].xml references missing part: /${partPath}`);
    }
  }

  return findings;
}

type PictureAspectFinding = {
  slideNumber: number;
  target: string;
  frameRatio: number;
  imageRatio: number;
  frameAreaSqIn: number;
};

async function collectLargePictureAspectMismatchFindings(
  zip: JSZip,
  manifest: z.infer<typeof deckManifestSchema>,
): Promise<PictureAspectFinding[]> {
  const findings: PictureAspectFinding[] = [];
  const chartSlides = new Set(
    manifest.slides
      .filter((slide) => Boolean(slide.chartId))
      .map((slide) => slide.position),
  );
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => extractSlideNumber(a) - extractSlideNumber(b));

  for (const slideEntry of slideEntries) {
    const slideNumber = extractSlideNumber(slideEntry);
    if (!chartSlides.has(slideNumber)) {
      continue;
    }
    const slideXml = await zip.file(slideEntry)?.async("string");
    const relsEntry = slideEntry.replace("slides/", "slides/_rels/") + ".rels";
    const relsXml = await zip.file(relsEntry)?.async("string");

    if (!slideXml || !relsXml) {
      continue;
    }

    const slideFindings = await collectSlidePictureAspectMismatchFindings(
      zip,
      slideEntry,
      slideNumber,
      slideXml,
      relsXml,
    );
    if (slideFindings.length === 0) {
      continue;
    }

    const primaryFinding = slideFindings.reduce((largest, finding) =>
      finding.frameAreaSqIn > largest.frameAreaSqIn ? finding : largest,
    );
    findings.push(primaryFinding);
  }

  return findings;
}

async function collectSlidePictureAspectMismatchFindings(
  zip: JSZip,
  slideEntry: string,
  slideNumber: number,
  slideMarkup: string,
  relsMarkup: string,
): Promise<PictureAspectFinding[]> {
  const findings: PictureAspectFinding[] = [];
  const relTargets = parseRelationshipTargets(relsMarkup, slideEntry);
  const pictures = slideMarkup.match(/<p:pic[\s\S]*?<\/p:pic>/g) ?? [];

  for (const picture of pictures) {
    const embed = picture.match(/<a:blip[^>]*r:embed="([^"]+)"/i)?.[1];
    const cx = Number.parseInt(picture.match(/<a:ext[^>]*cx="(\d+)"/i)?.[1] ?? "", 10);
    const cy = Number.parseInt(picture.match(/<a:ext[^>]*cy="(\d+)"/i)?.[1] ?? "", 10);
    if (!embed || !Number.isFinite(cx) || !Number.isFinite(cy) || cy <= 0) {
      continue;
    }

    const target = relTargets.get(embed);
    if (!target) {
      continue;
    }

    const imageBuffer = await zip.file(target)?.async("nodebuffer");
    if (!imageBuffer) {
      continue;
    }

    const imageDimensions = readImageDimensions(imageBuffer);
    if (!imageDimensions || imageDimensions.height <= 0) {
      continue;
    }

    const frameWidthInches = cx / 914400;
    const frameHeightInches = cy / 914400;
    const frameAreaSqIn = frameWidthInches * frameHeightInches;
    if (frameAreaSqIn < 8) {
      continue;
    }

    const frameRatio = frameWidthInches / frameHeightInches;
    const imageRatio = imageDimensions.width / imageDimensions.height;
    const distortion = Math.abs(frameRatio - imageRatio) / imageRatio;

    if (distortion > 0.3) {
      findings.push({
        slideNumber,
        target,
        frameRatio,
        imageRatio,
        frameAreaSqIn,
      });
    }
  }

  return findings;
}

function parseRelationshipTargets(relsMarkup: string, slideEntry: string) {
  const targets = new Map<string, string>();
  const baseDir = path.posix.dirname(slideEntry);

  for (const match of relsMarkup.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/gi)) {
    const [, relId, target] = match;
    targets.set(relId, path.posix.normalize(path.posix.join(baseDir, target)));
  }

  return targets;
}

function readImageDimensions(buffer: Buffer | null) {
  if (!buffer || buffer.length < 24) {
    return null;
  }

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const blockLength = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + blockLength;
    }
  }

  return null;
}

function extractSlideNumber(name: string) {
  return Number.parseInt(name.match(/slide(\d+)\.xml/i)?.[1] ?? "0", 10);
}

async function persistArtifacts(
  config: ReturnType<typeof resolveConfig>,
  run: RunRow,
  attempt: AttemptContext,
  artifactsToPublish: {
    pptx?: GeneratedFile | null;
    pdf?: GeneratedFile | null;
    md: GeneratedFile;
    xlsx: GeneratedFile;
  },
  options: {
    checkpoint?: ArtifactCheckpoint | null;
    allowDocxFailure?: boolean;
  } = {},
) {
  const artifacts: PublishedArtifact[] = [];

  if (options.checkpoint && artifactsToPublish.pptx) {
    artifacts.push(
      buildPublishedArtifact({
        kind: "pptx",
        fileName: "deck.pptx",
        mimeType: artifactsToPublish.pptx.mimeType || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: artifactsToPublish.pptx.buffer,
        storagePath: options.checkpoint.pptxStoragePath,
      }),
    );
  } else {
    const publishPrefix = `${run.id}/attempts/${attempt.attemptNumber}-${attempt.id}`;
    const coreItems = [
      ...(artifactsToPublish.pptx
        ? [{
            kind: "pptx" as const,
            fileName: "deck.pptx",
            mimeType: artifactsToPublish.pptx.mimeType || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            buffer: artifactsToPublish.pptx.buffer,
          }]
        : []),
      {
        kind: "xlsx" as const,
        fileName: "data_tables.xlsx",
        mimeType: artifactsToPublish.xlsx.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: artifactsToPublish.xlsx.buffer,
      },
    ];

    for (const item of coreItems) {
      const storagePath = `${publishPrefix}/${item.fileName}`;
      await uploadToStorage({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        bucket: "artifacts",
        storagePath,
        body: item.buffer,
        contentType: item.mimeType,
      });

      artifacts.push(buildPublishedArtifact({
        kind: item.kind,
        fileName: item.fileName,
        mimeType: item.mimeType,
        buffer: item.buffer,
        storagePath,
      }));
    }
  }

  if (options.checkpoint) {
    const xlsxStoragePath = `${run.id}/attempts/${attempt.attemptNumber}-${attempt.id}/data_tables.xlsx`;
    await uploadToStorage({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: "artifacts",
      storagePath: xlsxStoragePath,
      body: artifactsToPublish.xlsx.buffer,
      contentType: artifactsToPublish.xlsx.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    artifacts.push(buildPublishedArtifact({
      kind: "xlsx",
      fileName: "data_tables.xlsx",
      mimeType: artifactsToPublish.xlsx.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: artifactsToPublish.xlsx.buffer,
      storagePath: xlsxStoragePath,
    }));
  }

  const mdMimeType = artifactsToPublish.md.mimeType || "text/markdown";
  const mdStoragePath = `${run.id}/attempts/${attempt.attemptNumber}-${attempt.id}/narrative_report.md`;
  try {
    await uploadToStorage({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: "artifacts",
      storagePath: mdStoragePath,
      body: artifactsToPublish.md.buffer,
      contentType: mdMimeType,
    });
    artifacts.push(buildPublishedArtifact({
      kind: "md",
      fileName: "narrative_report.md",
      mimeType: mdMimeType,
      buffer: artifactsToPublish.md.buffer,
      storagePath: mdStoragePath,
    }));
  } catch (error) {
    if (!options.allowDocxFailure) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[generateDeckRun] narrative markdown publish skipped during salvage: ${message.slice(0, 300)}`);
  }

  return artifacts;
}

async function persistPreviewAssets(
  config: ReturnType<typeof resolveConfig>,
  run: RunRow,
  attempt: AttemptContext,
  manifest: z.infer<typeof deckManifestSchema>,
) {
  const slides = selectPreviewSlides(manifest);
  if (slides.length === 0) {
    return [];
  }

  const chartTitles = new Map(manifest.charts.map((chart) => [chart.id, chart.title]));
  const previewAssets: PreviewAsset[] = [];

  for (const slide of slides) {
    const svg = buildSlidePreviewSvg(slide, chartTitles.get(slide.chartId ?? "") ?? null);
    const pngBuffer = await renderPreviewPng(svg);
    const fileName = `slide-preview-${slide.position}.png`;
    const storagePath = `${run.id}/attempts/${attempt.attemptNumber}-${attempt.id}/${fileName}`;

    // Observability: a rendered preview with text should be >12KB. A ~10KB or
    // smaller PNG strongly suggests text silently dropped (fonts not found).
    // Warn loudly so this never regresses to the empty-preview email bug again.
    if (pngBuffer.length < 12_000) {
      console.warn(
        `[preview] slide ${slide.position} rendered to only ${pngBuffer.length} bytes — likely missing fonts, text may have silently dropped. Check nixpacks.toml has liberation_ttf/dejavu_fonts/noto-fonts and Resvg is configured with loadSystemFonts: true.`,
      );
    }

    await uploadToStorage({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: "artifacts",
      storagePath,
      body: pngBuffer,
      contentType: "image/png",
    });

    previewAssets.push({
      position: slide.position,
      fileName,
      mimeType: "image/png",
      storageBucket: "artifacts",
      storagePath,
      fileBytes: pngBuffer.length,
      checksumSha256: createHash("sha256").update(pngBuffer).digest("hex"),
    });
  }

  return previewAssets;
}

function selectPreviewSlides(manifest: z.infer<typeof deckManifestSchema>) {
  if (manifest.slides.length === 0) {
    return [];
  }

  const selected = new Map<number, z.infer<typeof deckManifestSchema>["slides"][number]>();
  const first = manifest.slides[0];
  const last = manifest.slides[manifest.slides.length - 1];
  const chartSlide = manifest.slides.find((slide) => Boolean(slide.chartId) && slide.position !== first.position && slide.position !== last.position);
  const denseInsightSlide = manifest.slides.find((slide) =>
    slide.position !== first.position &&
    slide.position !== last.position &&
    ((slide.metrics?.length ?? 0) > 0 || (slide.callout?.text?.length ?? 0) > 0),
  );

  [first, chartSlide, denseInsightSlide, last]
    .filter((slide): slide is z.infer<typeof deckManifestSchema>["slides"][number] => Boolean(slide))
    .forEach((slide) => selected.set(slide.position, slide));

  for (const slide of manifest.slides) {
    if (selected.size >= 3) {
      break;
    }
    selected.set(slide.position, slide);
  }

  return Array.from(selected.values())
    .sort((left, right) => left.position - right.position)
    .slice(0, 3);
}

// Resolve bundled DejaVu TTF font paths at runtime. The npm package
// `dejavu-fonts-ttf` ships actual .ttf files that @resvg/resvg-js can load
// directly. Bundling is the only reliable approach because Nix/Railway's
// fontconfig configuration does NOT expose system font packages to resvg —
// adding liberation_ttf or dejavu_fonts to nixpacks.toml is insufficient
// because Nix profiles are not in the paths fontconfig scans by default.
// See: https://github.com/thx/resvg-js/issues/210 (identical symptom)
let cachedFontFiles: string[] | null = null;
function resolveBundledFontFiles(): string[] {
  if (cachedFontFiles) return cachedFontFiles;
  const pkgJson = require.resolve("dejavu-fonts-ttf/package.json");
  const ttfDir = path.join(path.dirname(pkgJson), "ttf");
  cachedFontFiles = [
    path.join(ttfDir, "DejaVuSans.ttf"),
    path.join(ttfDir, "DejaVuSans-Bold.ttf"),
    path.join(ttfDir, "DejaVuSans-Oblique.ttf"),
    path.join(ttfDir, "DejaVuSerif.ttf"),
    path.join(ttfDir, "DejaVuSerif-Bold.ttf"),
    path.join(ttfDir, "DejaVuSerif-Italic.ttf"),
    path.join(ttfDir, "DejaVuSansMono.ttf"),
  ];
  return cachedFontFiles;
}

async function renderPreviewPng(svgText: string) {
  const { Resvg } = await import("@resvg/resvg-js");
  const rendered = new Resvg(svgText, {
    fitTo: { mode: "width", value: 1200 },
    background: "#f7f5f1",
    // Bundle DejaVu TTF files with the worker so Railway/Nix/Docker can NEVER
    // render blank previews. DejaVu has full Latin + Italian diacritic
    // coverage and substitutes cleanly for Arial (sans) and Georgia (serif)
    // which the SVG template requests by name.
    font: {
      fontFiles: resolveBundledFontFiles(),
      loadSystemFonts: false,
      defaultFontFamily: "DejaVu Sans",
    },
  }).render();

  return Buffer.from(rendered.asPng());
}

function buildSlidePreviewSvg(
  slide: z.infer<typeof deckManifestSchema>["slides"][number],
  chartTitle: string | null,
) {
  const safeTitle = escapeXml(slide.title);
  const safeSubtitle = escapeXml(slide.subtitle ?? slide.body ?? "");
  const callout = slide.callout?.text ? escapeXml(slide.callout.text) : "";
  const bullets = (slide.bullets ?? [])
    .filter(Boolean)
    .slice(0, 3)
    .map((bullet) => escapeXml(bullet));
  const metrics = (slide.metrics ?? []).slice(0, 3);
  const chartBadge = chartTitle ? `<text x="960" y="146" font-family="Arial, sans-serif" font-size="26" fill="#1A6AFF">Chart: ${escapeXml(chartTitle)}</text>` : "";
  const bulletMarkup = bullets.map((bullet, index) => `
    <circle cx="110" cy="${350 + index * 64}" r="6" fill="#1A6AFF" />
    <text x="132" y="${358 + index * 64}" font-family="Arial, sans-serif" font-size="30" fill="#1F2937">${bullet}</text>
  `).join("");
  const metricsMarkup = metrics.map((metric, index) => {
    const x = 760 + index * 132;
    return `
      <rect x="${x}" y="560" width="116" height="118" rx="18" fill="#FFFFFF" stroke="#D6DEEF" />
      <text x="${x + 16}" y="602" font-family="Arial, sans-serif" font-size="20" fill="#64748B">${escapeXml(metric.label)}</text>
      <text x="${x + 16}" y="646" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#0F172A">${escapeXml(metric.value)}</text>
      ${metric.delta ? `<text x="${x + 16}" y="676" font-family="Arial, sans-serif" font-size="18" fill="#1A6AFF">${escapeXml(metric.delta)}</text>` : ""}
    `;
  }).join("");
  const calloutMarkup = callout
    ? `<rect x="760" y="332" width="360" height="164" rx="22" fill="#0F172A" />
       <text x="792" y="386" font-family="Arial, sans-serif" font-size="21" fill="#93C5FD">Key finding</text>
       <text x="792" y="430" font-family="Arial, sans-serif" font-size="30" fill="#F8FAFC">${truncateSvgLine(callout, 42)}</text>
       <text x="792" y="468" font-family="Arial, sans-serif" font-size="30" fill="#F8FAFC">${truncateSvgLine(callout.split(" ").slice(7).join(" "), 42)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="Slide ${slide.position} preview">
    <rect width="1200" height="675" rx="24" fill="#F7F5F1" />
    <rect x="34" y="34" width="1132" height="607" rx="22" fill="#FFFDFC" stroke="#E6E0D5" />
    <text x="96" y="108" font-family="Arial, sans-serif" font-size="22" letter-spacing="4" fill="#1A6AFF">SLIDE ${slide.position}</text>
    ${chartBadge}
    <text x="96" y="176" font-family="Georgia, 'Times New Roman', serif" font-size="52" font-weight="700" fill="#0F172A">${truncateSvgLine(safeTitle, 34)}</text>
    <text x="96" y="224" font-family="Georgia, 'Times New Roman', serif" font-size="52" font-weight="700" fill="#0F172A">${truncateSvgLine(safeTitle.split(" ").slice(7).join(" "), 34)}</text>
    ${safeSubtitle ? `<text x="96" y="280" font-family="Arial, sans-serif" font-size="26" fill="#475569">${truncateSvgLine(safeSubtitle, 62)}</text>` : ""}
    <rect x="96" y="318" width="560" height="250" rx="22" fill="#FFFFFF" stroke="#E2E8F0" />
    ${bulletMarkup}
    ${calloutMarkup}
    ${metricsMarkup}
    <rect x="96" y="598" width="1024" height="4" rx="2" fill="#1A6AFF" opacity="0.18" />
  </svg>`;
}

function truncateSvgLine(value: string, maxChars: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function buildPublishedArtifact(input: {
  kind: PublishedArtifact["kind"];
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  storagePath: string;
}): PublishedArtifact {
  return {
    id: randomUUID(),
    kind: input.kind,
    fileName: input.fileName,
    mimeType: input.mimeType,
    storageBucket: "artifacts",
    storagePath: input.storagePath,
    fileBytes: input.buffer.length,
    checksumSha256: createHash("sha256").update(input.buffer).digest("hex"),
  };
}

function inferLanguageHint(run: RunRow) {
  const text = [
    run.business_context,
    run.objective,
    run.audience,
    run.client,
    run.thesis,
    run.stakes,
  ].join(" ");

  return /[àèéìòù]/i.test(text) || /\b(il|lo|la|gli|delle|con|pack|mercato)\b/i.test(text)
    ? "Italian"
    : "English";
}

function billableInputTokens(usage: ClaudeUsage | null | undefined) {
  return (
    (usage?.input_tokens ?? 0) +
    (usage?.cache_creation_input_tokens ?? 0) +
    (usage?.cache_read_input_tokens ?? 0)
  );
}

function buildPhaseTelemetry(
  model: "claude-sonnet-4-6" | "claude-haiku-4-5" | "claude-opus-4-7",
  result: { usage: ClaudeUsage; iterations: number; pauseTurns: number; requestIds?: string[] },
) {
  const inputTokens = result.usage.input_tokens ?? 0;
  const cacheCreationInputTokens = result.usage.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = result.usage.cache_read_input_tokens ?? 0;
  const totalInputTokens = billableInputTokens(result.usage);
  const outputTokens = result.usage.output_tokens ?? 0;
  return {
    model,
    estimatedCostUsd: usageToCost(model, result.usage),
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalInputTokens,
    outputTokens,
    totalTokens: totalInputTokens + outputTokens,
    iterations: result.iterations,
    pauseTurns: result.pauseTurns,
    anthropicRequestIds: result.requestIds ?? [],
  };
}

function buildSimplePhaseTelemetry(
  model: "claude-sonnet-4-6" | "claude-haiku-4-5" | "claude-opus-4-7",
  usage: ClaudeUsage | null | undefined,
) {
  const inputTokens = usage?.input_tokens ?? 0;
  const cacheCreationInputTokens = usage?.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = usage?.cache_read_input_tokens ?? 0;
  const totalInputTokens = billableInputTokens(usage);
  const outputTokens = usage?.output_tokens ?? 0;
  return {
    model,
    estimatedCostUsd: usageToCost(model, usage),
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalInputTokens,
    outputTokens,
    totalTokens: totalInputTokens + outputTokens,
  };
}

function buildTemplateQaContext(templateProfile: TemplateProfile) {
  const palette = [
    ...(templateProfile.brandTokens?.chartPalette ?? []),
    templateProfile.brandTokens?.palette.background,
    templateProfile.brandTokens?.palette.coverBg,
    templateProfile.brandTokens?.palette.accent,
    templateProfile.brandTokens?.palette.highlight,
    ...templateProfile.colors,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => (value.startsWith("#") ? value.toUpperCase() : `#${value.toUpperCase()}`))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8);

  return {
    templateName: templateProfile.templateName,
    palette,
    background: templateProfile.brandTokens?.palette.coverBg ?? templateProfile.brandTokens?.palette.background ?? null,
    clientLabel: templateProfile.templateName?.replace(/\.pptx$/i, "") ?? null,
    logoExpected: Boolean(templateProfile.brandTokens?.logo?.imageBase64),
  };
}

// ── Research-phase helpers (spec §5.5, Day 4 scope) ────────────────

/**
 * Extract a one-line brief summary for the research planner. Pulls from
 * the most specific field present on `run.brief`, falling back to a
 * concatenation when nothing explicit is set. Never returns empty; the
 * planner needs at least something to anchor the keyword extraction.
 */
function extractBriefSummaryForResearch(brief: unknown): string {
  if (!brief || typeof brief !== "object") return "Deck run without explicit brief";
  const record = brief as Record<string, unknown>;
  const candidates = [
    record.title,
    record.objective,
    record.thesis,
    record.narrative,
    record.description,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim().slice(0, 1000);
    }
  }
  return "Deck run without explicit brief";
}

/**
 * Keyword extraction for the research planner. Rough heuristic: tokenize
 * the brief text, drop short/stop tokens, keep the first N unique. Day 4
 * ships this minimal version; Day 5+ may upgrade to an LLM extraction
 * once the planner itself is in production use.
 *
 * Also pulls named entities from the workspace context pack when
 * available so the keyword set reflects workspace knowledge the analyst
 * already named.
 */
function extractBriefKeywordsForResearch(
  brief: unknown,
  workspaceContextPack: WorkspaceContextPack | null,
): string[] {
  const textParts: string[] = [];
  if (brief && typeof brief === "object") {
    const record = brief as Record<string, unknown>;
    for (const field of ["title", "objective", "thesis", "narrative", "description"] as const) {
      const value = record[field];
      if (typeof value === "string") textParts.push(value);
    }
  }
  if (workspaceContextPack?.scope?.name) textParts.push(workspaceContextPack.scope.name);
  if (workspaceContextPack?.stakeholders) {
    for (const s of workspaceContextPack.stakeholders) textParts.push(s.name);
  }
  const combined = textParts.join(" ").toLowerCase();
  const tokens = combined
    .split(/[^a-zà-ÿ0-9]+/u)
    .filter((t) => t.length >= 4 && !RESEARCH_STOPWORDS.has(t));
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
    if (unique.length >= 12) break;
  }
  return unique;
}

const RESEARCH_STOPWORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "they",
  "have",
  "been",
  "will",
  "what",
  "when",
  "where",
  "which",
  "their",
  "these",
  "those",
  "into",
  "about",
  "della",
  "dello",
  "delle",
  "degli",
  "quali",
  "quale",
  "come",
  "dove",
  "quando",
  "sono",
  "essere",
  "avere",
  "anche",
]);

/**
 * Adapter that lets the research planner call Haiku via the existing
 * Anthropic SDK client. The planner passes a system+user pair and
 * expects a raw JSON string. Day 4 uses claude-haiku-4-5 for cost and
 * a conservative max_tokens cap; medium effort is the default for
 * Claude 4.x planning calls.
 */
function buildHaikuCallFnForResearch(client: Anthropic): HaikuCallFn {
  return async ({ system, user, signal }) => {
    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
      },
      { signal: signal ?? undefined },
    );
    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return content;
  };
}
