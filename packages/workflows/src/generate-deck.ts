import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

import { parseEvidencePackage } from "@basquio/data-ingest";
import { detectLanguage, enforceExhibit, inferQuestionType, lintDeckText, routeQuestion, validateDeckContract, type SlideTextInput } from "@basquio/intelligence";
import { getArchetypeOrDefault, listArchetypeIds, validateSlotConstraints } from "@basquio/scene-graph/slot-archetypes";
import {
  buildNoTemplateDiagnostics,
  buildTemplateDiagnosticsFromProfile,
  createSystemTemplateProfile,
  interpretTemplateSource,
  type TemplateDiagnostics,
} from "@basquio/template-engine";
import type { TemplateProfile } from "@basquio/types";

import { assertDeckSpendWithinBudget, enforceDeckBudget, roundUsd, usageToCost } from "./cost-guard";
import { deckManifestSchema, parseDeckManifest } from "./deck-manifest";
import { buildNarrativeDocx } from "./docx-report";
import { renderedPageQaSchema, runRenderedPageQa } from "./rendered-page-qa";
import { isTransientProviderError, classifyRuntimeError } from "./failure-classifier";
import { buildBasquioSystemPrompt } from "./system-prompt";
import { notifyRunCompletionIfRequested } from "./notify-completion";
import { callRpc, deleteRestRows, downloadFromStorage, fetchRestRows, patchRestRows, upsertRestRows, uploadToStorage } from "./supabase";

const MODEL = "claude-sonnet-4-6";
const VISUAL_QA_MODEL = "claude-haiku-4-5";
const FINAL_VISUAL_QA_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_TIMEOUT_MS = Number.parseInt(process.env.BASQUIO_ANTHROPIC_TIMEOUT_MS ?? "1800000", 10);
const FILES_BETA = "files-api-2025-04-14";
const SKILLS_BETA = "skills-2025-10-02";
const CODE_EXEC_TOOL = "code_execution_20250825";
const BETAS = [FILES_BETA, SKILLS_BETA, CODE_EXEC_TOOL] as const;
type ClaudePhase = "normalize" | "understand" | "author" | "render" | "critique" | "revise" | "export";
const PHASE_TIMEOUTS_MS: Record<ClaudePhase, number> = {
  normalize: 120_000,
  understand: 120_000,
  author: 300_000,
  revise: 240_000,
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
const REQUEST_WATCHDOG_BY_PHASE_MS = {
  ...PHASE_TIMEOUTS_MS,
} as const;
const REQUEST_WATCHDOG_DEFAULT_MS = 240_000;
const CIRCUIT_BREAKER_MAX_FAILURES = 3;
const CIRCUIT_BREAKER_OPEN_MS = 60_000;
const CIRCUIT_BREAKER_WINDOW_MS = 5 * 60_000;
const CIRCUIT_BREAKER_CLEANUP_MS = 10 * 60_000;
const PROGRESS_MEANINGFUL_STALL_MS = 8 * 60_000;
type CircuitState = {
  failures: number[];
  openUntil: number | null;
};
let lastCircuitBreakerCleanupAt = 0;
const CONTINUATION_MIN_REMAINING_BUDGET_USD = 0.5;
const STREAM_REQUEST_WATCHDOG_MS = Number.parseInt(process.env.BASQUIO_STREAM_REQUEST_WATCHDOG_MS ?? "240000", 10);
const CLAUDE_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: CODE_EXEC_TOOL, name: "code_execution" },
  { type: "web_fetch_20260209", name: "web_fetch" },
];
const CIRCUIT_BREAKER_STATES = new Map<string, CircuitState>();
const APPROVED_ARCHETYPES = listArchetypeIds();

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
    })).optional(),
    callout: z.object({
      text: z.string(),
      tone: z.enum(["accent", "green", "orange"]).optional(),
    }).optional(),
    evidenceIds: z.array(z.string()).optional(),
    chart: z.object({
      id: z.string(),
      chartType: z.string(),
      title: z.string(),
      sourceNote: z.string().optional(),
      maxCategories: z.number().int().min(1).optional(),
      preferredOrientation: z.enum(["horizontal", "vertical"]).optional(),
      slotAspectRatio: z.number().positive().optional(),
      figureSize: z.object({
        widthInches: z.number().positive(),
        heightInches: z.number().positive(),
      }).optional(),
      sort: z.enum(["desc", "asc", "none"]).optional(),
      truncateLabels: z.boolean().optional(),
    }).optional(),
  })).default([]),
}).passthrough();

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
  template_profile_id: string | null;
  template_diagnostics: Record<string, unknown> | null;
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

type DeckPhase = "normalize" | "understand" | "author" | "render" | "critique" | "revise" | "export";

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
  input_tokens?: number;
  output_tokens?: number;
};

type PublishDecision = {
  decision: "publish" | "fail";
  hardBlockers: string[];
  advisories: string[];
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
  usage: Required<ClaudeUsage>;
  stopReason: string | null;
};
type RenderedPageQaReport = z.infer<typeof renderedPageQaSchema>;
type MutableNumberRef = {
  value: number;
};
type PublishedArtifact = {
  id: string;
  kind: "pptx" | "pdf" | "docx";
  fileName: string;
  mimeType: string;
  storageBucket: "artifacts";
  storagePath: string;
  fileBytes: number;
  checksumSha256: string;
};

export class AttemptOwnershipLostError extends Error {
  constructor(runId: string, attemptId: string) {
    super(`Run ${runId} is no longer owned by attempt ${attemptId}.`);
    this.name = "AttemptOwnershipLostError";
  }
}

export async function generateDeckRun(runId: string, suppliedAttempt?: Partial<AttemptContext>) {
  const config = resolveConfig();
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

  try {
    const run = await loadRun(config, runId);
    const attempt = await resolveAttemptContext(config, run, suppliedAttempt);
    const sourceFiles = await loadSourceFiles(config, run.source_file_ids);
    // E: Template fallback — if recovery_reason is template_fallback, skip template entirely
    const isTemplateFallback = attempt.recoveryReason === "template_fallback";
    const persistedTemplate = isTemplateFallback ? null : await loadTemplateProfileRow(config, run.template_profile_id);
    const templateSourceFileId = persistedTemplate?.source_file_id ?? null;
    const persistedTemplateFile = !isTemplateFallback && templateSourceFileId
      ? (sourceFiles.find((file) => file.id === templateSourceFileId) ??
         await loadSourceFile(config, templateSourceFileId))
      : undefined;
    const templateFile = isTemplateFallback
      ? undefined
      : (persistedTemplateFile ??
         sourceFiles.find((file) => file.kind === "pptx" || file.kind === "brand-tokens"));
    const evidenceFiles = sourceFiles.filter((file) => file.id !== templateFile?.id);
    templateMode = isTemplateFallback
      ? "template_fallback"
      : (templateFile || persistedTemplate ? "workspace_template" : "basquio_standard");

    currentPhase = "normalize";
    await markPhase(config, runId, attempt, currentPhase);

    const parsed = await parseEvidencePackage({
      datasetId: runId,
      files: evidenceFiles.map((file) => ({
        id: file.id,
        fileName: file.file_name,
        buffer: file.buffer,
      })),
    });

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

    await persistTemplateDiagnostics(config, runId, templateDiagnostics);

    await persistEvidenceWorkspace(config, run, parsed, templateProfile);
    await upsertWorkingPaper(config, runId, "execution_brief", {
      brief: run.brief,
      fileInventory: parsed.datasetProfile.manifest ?? {},
      templateProfile,
      templateDiagnostics,
    });

    const evidenceValidationError = validateAnalyticalEvidence(parsed);
    if (evidenceValidationError) {
      throw new Error(evidenceValidationError);
    }

    await completePhase(config, runId, attempt, "normalize", {
      fileCount: parsed.datasetProfile.sourceFiles.length,
      sheetCount: parsed.datasetProfile.sheets.length,
    });

    const uploadedEvidence = await Promise.all(
      evidenceFiles.map(async (file) =>
        client.beta.files.upload({
          file: await toFile(file.buffer, file.file_name),
          betas: [FILES_BETA],
        }),
      ),
    );
    const uploadedTemplate = templateFile
      ? await client.beta.files.upload({
          file: await toFile(templateFile.buffer, templateFile.file_name),
          betas: [FILES_BETA],
        })
      : null;

    const systemPrompt = await buildBasquioSystemPrompt({
      templateProfile,
      briefLanguageHint: inferLanguageHint(run),
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

    const existingCheckpoint = await loadArtifactCheckpoint(config, runId, { requireResumeReady: true });
    let checkpointArtifacts = existingCheckpoint ? await loadCheckpointArtifacts(config, existingCheckpoint) : null;
    const recoveredAnalysis = await loadRecoveredAnalysis(config, runId);

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
    let pptxFile: GeneratedFile;
    let pdfFile: GeneratedFile;
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
      const isRecoveryAttempt = attempt.recoveryReason === "stale_timeout" || attempt.recoveryReason === "transient_provider_retry";
      const recoveredAnalysisForSplit = isRecoveryAttempt ? recoveredAnalysis : null;
      const questionRoutes = routeQuestion(buildBriefText(run));

      if (recoveredAnalysisForSplit) {
        analysis = recoveredAnalysisForSplit;
        applyChartPreprocessingConstraints(analysis);
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
      await markPhase(config, runId, attempt, currentPhase);

      const generationMessage = buildAuthorMessage(
        run,
        recoveredAnalysisForSplit ? analysis : null,
        !baseContainerId ? { uploadedEvidence, uploadedTemplate } : undefined,
        questionRoutes,
        recoveredAnalysisForSplit && analysis ? buildChartSlotConstraintMessage(analysis) : undefined,
      );
      await recordToolCall(config, runId, attempt, "author", "code_execution", {
        model: MODEL,
        tools: ["web_fetch"],
        autoInjectedTools: ["code_execution"],
        skills: ["pptx", "pdf"],
        stepNumber: 1,
      });
      await enforceDeckBudget({
        client,
        model: MODEL,
        betas: [...BETAS],
        spentUsd,
        outputTokenBudget: 72_000,
        body: {
          system: systemPrompt,
          messages: [generationMessage],
          tools: CLAUDE_TOOLS,
          output_config: { effort: "medium" },
        },
      });

      await persistRequestStart(config, runId, attempt, "author", "phase_generation", MODEL);
      let authorResponse = await runClaudeLoop({
        client,
        systemPrompt,
        maxTokens: 8_192,
        phaseLabel: "author",
        circuitKey: `${run.id}:${attempt.id}:author`,
        onMeaningfulProgress: () => touchAttemptProgress(config, runId, attempt, "author").catch(() => {}),
        maxPauseTurns: MAX_PAUSE_TURNS_PER_PHASE.author,
        phaseTimeoutMs: PHASE_TIMEOUTS_MS.author,
        currentSpentUsd: spentUsd,
        container: baseContainerId
          ? { id: baseContainerId }
          : {
              skills: [
                { type: "anthropic", skill_id: "pptx", version: "latest" },
                { type: "anthropic", skill_id: "pdf", version: "latest" },
              ],
            },
        messages: [generationMessage],
        tools: CLAUDE_TOOLS,
        outputConfig: { effort: "medium" },
        onRequestRecord: buildRequestRecordCallback(config, runId, attempt, "author", MODEL),
      });
      const authorFiles = await downloadGeneratedFiles(client, authorResponse.fileIds);
      requireGeneratedFiles(
        authorFiles,
        recoveredAnalysisForSplit
        ? ["deck.pptx", "deck.pdf", "deck_manifest.json"]
        : ["analysis_result.json", "deck.pptx", "deck.pdf", "deck_manifest.json"],
        "author",
      );
      spentUsd = roundUsd(spentUsd + usageToCost(MODEL, authorResponse.usage));
      assertDeckSpendWithinBudget(spentUsd);
      continuationCount += authorResponse.pauseTurns;
      phaseTelemetry.author = buildPhaseTelemetry(MODEL, {
        ...authorResponse,
        requestIds: authorResponse.requests.map((r) => r.requestId).filter((id): id is string => Boolean(id)),
      });
      await persistRequestUsage(config, runId, attempt, "author", "phase_generation", MODEL, authorResponse.requests);
      rememberRequestIds(anthropicRequestIds, authorResponse.requests);
      const authorPhaseUsage = {
        input_tokens: authorResponse.usage.input_tokens ?? 0,
        output_tokens: authorResponse.usage.output_tokens ?? 0,
      };
      const containerId = authorResponse.containerId;
      if (!recoveredAnalysisForSplit) {
        analysis = parseGeneratedAnalysisResponse(authorResponse.message, authorFiles);
        enforceAnalysisExhibitRules(analysis);
        applyChartPreprocessingConstraints(analysis);
        await upsertWorkingPaper(config, runId, "analysis_result", analysis);
        await upsertWorkingPaper(config, runId, "deck_plan", { slidePlan: analysis.slidePlan });
        await upsertWorkingPaper(config, runId, "analysis_checkpoint", {
          ...analysis,
          checkpointedAt: new Date().toISOString(),
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
      pptxFile = requireGeneratedFile(authorFiles, "deck.pptx");
      pdfFile = requireGeneratedFile(authorFiles, "deck.pdf");
      manifest = parseManifestResponse(authorResponse.message, authorFiles);
      latestResponse = authorResponse;
      latestContainerId = authorResponse.containerId ?? containerId ?? baseContainerId;
      phaseTelemetry.authorLint = summarizeLintResult(lintManifest(manifest));
      phaseTelemetry.authorContract = summarizeDeckContractResult(validateManifestContract(manifest));

      await assertAttemptStillOwnsRun(config, runId, attempt);
      await persistDeckSpec(config, runId, manifest);
      await completePhase(config, runId, attempt, "author", {
        containerId,
        slideCount: manifest.slideCount,
        chartCount: manifest.charts.length,
        estimatedCostUsd: spentUsd,
      }, authorPhaseUsage);

      // A1: Persist durable artifact checkpoint after author success
      await assertAttemptStillOwnsRun(config, runId, attempt);
      await persistArtifactCheckpoint(config, runId, attempt, "author", pptxFile, pdfFile, manifest, {
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
      }).catch((checkpointError) => {
        console.warn(`[generateDeckRun] failed to persist author checkpoint: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`);
      });
    }

    // ─── RENDER / CRITIQUE / REVISE ────────────────────────────────
    // Skip entirely on checkpoint recovery (phases already marked completed,
    // no Claude thread/container available to revise against).
    let finalPptx = pptxFile;
    let finalPdf = pdfFile;
    let finalManifest = manifest;
    let finalVisualQa: RenderedPageQaReport;

    if (!canSkipToExportFromCheckpoint) {
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
    const initialVisualQa = await runRenderedPageQa({
      client,
      pdf: pdfFile.buffer,
      manifest,
      betas: [FILES_BETA],
      model: VISUAL_QA_MODEL,
    });
    spentUsd = roundUsd(spentUsd + usageToCost(VISUAL_QA_MODEL, initialVisualQa.usage));
    assertDeckSpendWithinBudget(spentUsd);
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
    const blockingCritiqueIssues = critiqueIssues.filter((issue) => !isAdvisoryCritiqueIssue(issue));
    const critiqueLint = lintManifest(manifest);
    const critiqueContract = validateManifestContract(manifest);
    const hasManifestActionableIssues = critiqueLint.actionableIssues.length > 0 || critiqueContract.actionableIssues.length > 0;
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
    await persistArtifactCheckpoint(config, runId, attempt, "critique", pptxFile, pdfFile, manifest, {
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

    const shouldRunRevise = latestResponse !== null && !(
      initialVisualQa.report.overallStatus === "green" &&
      initialVisualQa.report.score >= 8 &&
      !initialVisualQa.report.deckNeedsRevision &&
      !hasManifestActionableIssues &&
      !hasBlockingCritiqueIssues
    );

    if (shouldRunRevise && latestResponse) {
      try {
        currentPhase = "revise";
        await markPhase(config, runId, attempt, currentPhase);
        const reviseMessage = buildReviseMessage(critiqueIssues);
        const reviseMessages = [...latestResponse.thread, reviseMessage];
        await recordToolCall(config, runId, attempt, "revise", "code_execution", {
          model: MODEL,
          tools: ["web_fetch"],
          autoInjectedTools: ["code_execution"],
          skills: ["pptx", "pdf"],
          stepNumber: 1,
        });
        await enforceDeckBudget({
          client,
          model: MODEL,
          betas: [...BETAS],
          spentUsd,
          outputTokenBudget: 28_000,
          body: {
            system: systemPrompt,
            messages: reviseMessages,
            tools: CLAUDE_TOOLS,
            output_config: {
              effort: "medium",
            },
          },
        });

        await persistRequestStart(config, runId, attempt, "revise", "phase_generation", MODEL);
        let reviseResponse = await runClaudeLoop({
          client,
          systemPrompt,
          maxTokens: 4_096,
          phaseLabel: "revise",
          circuitKey: `${run.id}:${attempt.id}:revise`,
          onMeaningfulProgress: () => touchAttemptProgress(config, runId, attempt, "revise").catch(() => {}),
          maxPauseTurns: MAX_PAUSE_TURNS_PER_PHASE.revise,
          phaseTimeoutMs: PHASE_TIMEOUTS_MS.revise,
          currentSpentUsd: spentUsd,
          container: latestContainerId
            ? {
                id: latestContainerId,
                skills: [
                  { type: "anthropic", skill_id: "pptx", version: "latest" },
                  { type: "anthropic", skill_id: "pdf", version: "latest" },
                ],
              }
            : {
                skills: [
                  { type: "anthropic", skill_id: "pptx", version: "latest" },
                  { type: "anthropic", skill_id: "pdf", version: "latest" },
                ],
              },
          messages: reviseMessages,
          tools: CLAUDE_TOOLS,
          outputConfig: {
            effort: "medium",
          },
          onRequestRecord: buildRequestRecordCallback(config, runId, attempt, "revise", MODEL),
        });
        spentUsd = roundUsd(spentUsd + usageToCost(MODEL, reviseResponse.usage));
        assertDeckSpendWithinBudget(spentUsd);
        continuationCount += reviseResponse.pauseTurns;
        phaseTelemetry.revise = buildPhaseTelemetry(MODEL, {
          ...reviseResponse,
          requestIds: reviseResponse.requests.map((request) => request.requestId).filter((requestId): requestId is string => Boolean(requestId)),
        });
        await persistRequestUsage(config, runId, attempt, "revise", "phase_generation", MODEL, reviseResponse.requests);
        rememberRequestIds(anthropicRequestIds, reviseResponse.requests);
        const reviseFiles = await downloadGeneratedFiles(client, reviseResponse.fileIds);
        requireGeneratedFiles(reviseFiles, ["deck.pptx", "deck.pdf", "deck_manifest.json"], "revise");
        finalManifest = parseManifestResponse(reviseResponse.message, reviseFiles);
        finalPptx = requireGeneratedFile(reviseFiles, "deck.pptx");
        finalPdf = requireGeneratedFile(reviseFiles, "deck.pdf");
        latestResponse = reviseResponse;
        latestContainerId = reviseResponse.containerId ?? latestContainerId;

      const revisedVisualQa = await runRenderedPageQa({
        client,
        pdf: finalPdf.buffer,
        manifest: finalManifest,
        betas: [FILES_BETA],
        model: VISUAL_QA_MODEL,
      });
      spentUsd = roundUsd(spentUsd + usageToCost(VISUAL_QA_MODEL, revisedVisualQa.usage));
      assertDeckSpendWithinBudget(spentUsd);
      phaseTelemetry.visualQaRevise = buildSimplePhaseTelemetry(VISUAL_QA_MODEL, revisedVisualQa.usage);
      await persistRequestUsage(config, runId, attempt, "critique", "rendered_page_qa", VISUAL_QA_MODEL, revisedVisualQa.requests);
      rememberRequestIds(anthropicRequestIds, revisedVisualQa.requests);
      if ((revisedVisualQa.usage.input_tokens ?? 0) + (revisedVisualQa.usage.output_tokens ?? 0) > 0) {
        await touchAttemptProgress(config, runId, attempt, "revise");
      }
      finalVisualQa = revisedVisualQa.report;
        await upsertWorkingPaper(config, runId, "visual_qa_revise", finalVisualQa);
        await assertAttemptStillOwnsRun(config, runId, attempt);
        await persistDeckSpec(config, runId, finalManifest);
        const revisePhaseUsage = {
          input_tokens: reviseResponse.usage.input_tokens ?? 0,
          output_tokens: reviseResponse.usage.output_tokens ?? 0,
        };

        await completePhase(
          config,
          runId,
          attempt,
          "revise",
          {
            issueCount: critiqueIssues.length,
            estimatedCostUsd: spentUsd,
            visualQa: finalVisualQa,
          },
          revisePhaseUsage,
        );

        // B1: Persist pre-export checkpoint after revise success
        const reviseLint = lintManifest(finalManifest);
        const reviseContract = validateManifestContract(finalManifest);
        const reviseCheckpointProof = buildCheckpointProof({
          authorComplete: true,
          critiqueComplete: true,
          reviseComplete: true,
          visualQaGreen: finalVisualQa.overallStatus === "green",
          lintPassed: reviseLint.actionableIssues.length === 0,
          contractPassed: reviseContract.actionableIssues.length === 0,
          deckNeedsRevision: finalVisualQa.deckNeedsRevision,
        });
        await assertAttemptStillOwnsRun(config, runId, attempt);
        await persistArtifactCheckpoint(config, runId, attempt, "revise", finalPptx, finalPdf, finalManifest, {
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
    let qaReport: Awaited<ReturnType<typeof buildQaReport>>;
    let lastPublishDecision: PublishDecision | null = null;
    try {
      finalVisualQa = await strengthenFinalVisualQa({
        client,
        pdf: finalPdf.buffer,
        manifest: finalManifest,
        currentReport: finalVisualQa,
        runId,
        attempt,
        config,
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
      });
      if (!analysis) {
        throw new Error("Analysis unavailable before export.");
      }
      finalDocx = await buildNarrativeDocx({
        run,
        analysis,
        manifest: finalManifest,
      });
      qaReport = await buildQaReport(
        finalManifest,
        finalPptx,
        finalPdf,
        finalDocx,
        finalVisualQa,
        templateDiagnostics,
        run.target_slide_count,
      );
      const initialLint = lintManifest(finalManifest);
      const initialContract = validateManifestContract(finalManifest);
      const initialQualityGate = collectPublishGateFailures({
        qaReport,
        lint: initialLint,
        contract: initialContract,
      });
      lastPublishDecision = buildPublishDecision({
        qaReport,
        lint: initialLint,
        contract: initialContract,
        visualQa: finalVisualQa,
        artifactSource: publishFromCheckpoint ? "checkpoint" : "fresh_generation",
      });

      const finalLint = lintManifest(finalManifest);
      const finalContract = validateManifestContract(finalManifest);
      const finalQualityGate = collectPublishGateFailures({
        qaReport,
        lint: finalLint,
        contract: finalContract,
      });
      lastPublishDecision = buildPublishDecision({
        qaReport,
        lint: finalLint,
        contract: finalContract,
        visualQa: finalVisualQa,
        artifactSource: publishFromCheckpoint ? "checkpoint" : "fresh_generation",
      });
      if (finalQualityGate.blockingFailures.length > 0) {
        throw new Error(`Artifact publish gate failed: ${finalQualityGate.blockingFailures.join(", ")}`);
      }

      finalDocx ??= await buildFallbackNarrativeDocx({
        message: "Narrative report generation degraded on this run, so Basquio rebuilt a lighter text-first report from the final deck manifest.",
        run,
        analysis,
        manifest: finalManifest,
      });
      phaseTelemetry.finalLint = summarizeLintResult(finalLint);
      phaseTelemetry.finalContract = summarizeDeckContractResult(finalContract);
      phaseTelemetry.publishDecision = lastPublishDecision;
      await assertAttemptStillOwnsRun(config, runId, attempt);
      const artifacts = await persistArtifacts(config, run, attempt, finalPptx, finalPdf, finalDocx, {
        checkpoint: publishFromCheckpoint,
        allowDocxFailure: false,
      });
      await finalizeSuccess(config, runId, attempt, spentUsd, finalManifest, qaReport, artifacts, templateDiagnostics, {
        phases: phaseTelemetry,
        continuationCount,
        anthropicRequestIds: [...anthropicRequestIds],
        templateMode,
      });
      await completePhase(config, runId, attempt, "export", {
        artifactCount: artifacts.length,
        estimatedCostUsd: spentUsd,
        qaTier: qaReport.tier,
        visualQa: finalVisualQa,
      });

      const resendApiKey = process.env.RESEND_API_KEY ?? "";
      if (resendApiKey) {
        await notifyRunCompletionIfRequested(
          { supabaseUrl: config.supabaseUrl, serviceKey: config.serviceKey, resendApiKey },
          run,
          { runId, slideCount: finalManifest.slideCount },
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
    const rawMessage = error instanceof Error ? error.message : "Deck generation failed.";
    const message = sanitizeFailureMessage(rawMessage);
    const failureClass = classifyRuntimeError(error);
    const run = await loadRun(config, runId).catch(() => null);
    const attempt = run ? await resolveAttemptContext(config, run, suppliedAttempt).catch(() => null) : null;
    await finalizeFailure(config, runId, attempt, currentPhase, message, {
      phases: phaseTelemetry,
      continuationCount,
      anthropicRequestIds: [...anthropicRequestIds],
      estimatedCostUsd: spentUsd,
      failureClass,
      templateMode,
      requestCount: anthropicRequestIds.size,
      costIncomplete: spentUsd === 0 && anthropicRequestIds.size > 0,
    }).catch(() => {});
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

  return { anthropicApiKey, supabaseUrl, serviceKey };
}

async function loadRun(config: ReturnType<typeof resolveConfig>, runId: string) {
  const runs = await fetchRestRows<RunRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: {
      select: "id,organization_id,project_id,requested_by,brief,business_context,client,audience,objective,thesis,stakes,source_file_ids,target_slide_count,template_profile_id,template_diagnostics,active_attempt_id,latest_attempt_id,latest_attempt_number,failure_phase",
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
  if (suppliedAttempt?.id && typeof suppliedAttempt.attemptNumber === "number") {
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
  currentAttemptEstimatedCostUsd: number,
  extraTelemetry: Record<string, unknown>,
) {
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

  return {
    model: MODEL,
    ...extraTelemetry,
    estimatedCostUsd: roundUsd(priorEstimatedCostUsd + currentAttemptEstimatedCostUsd),
    latestAttemptEstimatedCostUsd: roundUsd(currentAttemptEstimatedCostUsd),
    attemptNumber: attempt?.attemptNumber ?? null,
    totalAttemptCount: Math.max(
      attempt?.attemptNumber ?? 0,
      ...attempts.map((row) => row.attempt_number),
      0,
    ),
  };
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
        limit: "1",
      },
    }).catch(() => []);

    const content = rows[0]?.content;
    if (!content) {
      continue;
    }

    try {
      const parsed = analysisSchema.parse(content);
      enforceAnalysisExhibitRules(parsed);
      return parsed;
    } catch {
      continue;
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

  // Both uploads must succeed before we write the checkpoint record.
  // A dangling record pointing to missing files is worse than no checkpoint.
  const [pptxResult, pdfResult] = await Promise.all([
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
  ]);

  if (!pptxResult || !pdfResult) {
    throw new Error(`Checkpoint upload failed: pptx=${pptxResult}, pdf=${pdfResult}`);
  }

  const checkpoint: ArtifactCheckpoint = {
    phase,
    pptxStoragePath: pptxPath,
    pdfStoragePath: pdfPath,
    manifestJson: manifest,
    savedAt: timestamp,
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    resumeReady: metadata?.resumeReady ?? false,
    visualQaStatus: metadata?.visualQaStatus,
    deckNeedsRevision: metadata?.deckNeedsRevision,
    proof: buildCheckpointProof(metadata?.proof),
  };

  await upsertWorkingPaper(config, runId, "artifact_checkpoint", checkpoint);
  return checkpoint;
}

async function loadArtifactCheckpoint(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  options: {
    requireResumeReady?: boolean;
    preferResumeReady?: boolean;
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

  if (options.requireResumeReady) {
    return checkpoints.find((checkpoint) => checkpoint.resumeReady) ?? null;
  }

  if (options.preferResumeReady) {
    return checkpoints.find((checkpoint) => checkpoint.resumeReady) ?? checkpoints[0] ?? null;
  }

  return checkpoints[0] ?? null;
}

async function loadCheckpointArtifacts(
  config: ReturnType<typeof resolveConfig>,
  checkpoint: ArtifactCheckpoint,
): Promise<{ pptx: GeneratedFile; pdf: GeneratedFile; manifest: z.infer<typeof deckManifestSchema> } | null> {
  try {
    const [pptxBuffer, pdfBuffer] = await Promise.all([
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

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function buildStubDocx(message: string) {
  const stubZip = new JSZip();
  stubZip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  stubZip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  stubZip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  stubZip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escapeXml(message)}</w:t></w:r></w:p></w:body></w:document>`);
  const buffer = await stubZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    fileId: "salvage-docx-stub",
    fileName: "report.docx",
    buffer,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  } satisfies GeneratedFile;
}

async function buildFallbackNarrativeDocx(input: {
  message: string;
  run?: RunRow | null;
  analysis?: z.infer<typeof analysisSchema> | null;
  manifest?: z.infer<typeof deckManifestSchema> | null;
}) {
  if (input.run && input.manifest) {
    try {
      return await buildNarrativeDocx({
        run: input.run,
        analysis: input.analysis ?? {
          language: detectLanguage(`${input.run.objective} ${input.run.thesis} ${input.run.business_context}`),
          thesis: input.run.thesis || input.manifest.slides[0]?.title || "",
          executiveSummary: input.message,
          slidePlan: input.manifest.slides.map((slide) => ({
            position: slide.position,
            layoutId: slide.layoutId,
            slideArchetype: slide.slideArchetype,
            title: slide.title,
            subtitle: slide.subtitle,
            body: slide.body,
            bullets: slide.bullets,
            metrics: slide.metrics,
            callout: slide.callout,
            chart: slide.chartId
              ? {
                  id: slide.chartId,
                  chartType: input.manifest?.charts.find((chart) => chart.id === slide.chartId)?.chartType ?? "bar",
                  title: input.manifest?.charts.find((chart) => chart.id === slide.chartId)?.title ?? slide.title,
                }
              : undefined,
          })),
        },
        manifest: input.manifest,
      });
    } catch (fallbackError) {
      console.warn(`[generateDeckRun] fallback narrative DOCX build failed, using minimal stub: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
    }
  }

  return buildStubDocx(input.message);
}

async function markPhase(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase: DeckPhase,
) {
  await touchAttemptProgress(config, runId, attempt, phase);

  const now = new Date().toISOString();
  await Promise.all([
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
    }),
    patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_attempts",
      query: { id: `eq.${attempt.id}` },
      payload: {
        status: "running",
        updated_at: now,
        last_meaningful_event_at: now,
        failure_message: null,
        failure_phase: null,
      },
    }),
  ]);
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

  await patchRestRows({
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
  });
  await patchRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_run_attempts",
    query: { id: `eq.${attempt.id}` },
    payload: {
      updated_at: new Date().toISOString(),
      last_meaningful_event_at: new Date().toISOString(),
    },
  }).catch(() => {});
  await insertEvent(config, runId, attempt, phase, "phase_completed", payload, usage);
}

async function touchAttemptProgress(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase?: string,
) {
  const now = new Date().toISOString();
  await Promise.all([
    patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_attempts",
      query: {
        id: `eq.${attempt.id}`,
      },
      payload: {
        updated_at: now,
        last_meaningful_event_at: now,
      },
    }).catch(() => {}),
    ...(phase === undefined ? [] : [
      insertEvent(
        config,
        runId,
        attempt,
        phase as DeckPhase,
        "meaningful_progress",
        {
          phase,
        },
      ).catch(() => {}),
    ]),
  ]);
}

async function strengthenFinalVisualQa(input: {
  client: Anthropic;
  pdf: Buffer;
  manifest: z.infer<typeof deckManifestSchema>;
  currentReport: RenderedPageQaReport;
  runId: string;
  attempt: AttemptContext;
  config: ReturnType<typeof resolveConfig>;
  spentUsdRef: MutableNumberRef;
  anthropicRequestIds: Set<string>;
  phaseTelemetry: Record<string, unknown>;
}) {
  if (input.currentReport.overallStatus !== "green" || input.currentReport.deckNeedsRevision) {
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
    const finalVisualQa = await runRenderedPageQa({
      client: input.client,
      pdf: input.pdf,
      manifest: input.manifest,
      betas: [FILES_BETA],
      model: FINAL_VISUAL_QA_MODEL,
      maxTokens: 1_600,
    });
    input.spentUsdRef.value = roundUsd(input.spentUsdRef.value + usageToCost(FINAL_VISUAL_QA_MODEL, finalVisualQa.usage));
    assertDeckSpendWithinBudget(input.spentUsdRef.value);
    input.phaseTelemetry.visualQaFinal = buildSimplePhaseTelemetry(FINAL_VISUAL_QA_MODEL, finalVisualQa.usage);
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
  estimatedCostUsd: number,
  manifest: z.infer<typeof deckManifestSchema>,
  qaReport: Record<string, unknown>,
  artifacts: Array<Record<string, unknown>>,
  templateDiagnostics: TemplateDiagnostics,
  extraTelemetry: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  const attemptCostTelemetry = {
    model: MODEL,
    estimatedCostUsd,
    qaTier: qaReport.tier,
    attemptNumber: attempt.attemptNumber,
    ...extraTelemetry,
  };
  const runCostTelemetry = await buildRunCostTelemetry(config, runId, attempt, estimatedCostUsd, {
    qaTier: qaReport.tier,
    ...extraTelemetry,
  });
  const publishRows = await callRpc<Array<{ published: boolean }>>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    functionName: "complete_deck_run_attempt",
    params: {
      p_run_id: runId,
      p_attempt_id: attempt.id,
      p_attempt_number: attempt.attemptNumber,
      p_completed_at: now,
      p_delivery_status: qaReport.tier === "green" ? "reviewed" : "degraded",
      p_attempt_cost_telemetry: attemptCostTelemetry,
      p_run_cost_telemetry: runCostTelemetry,
      p_anthropic_request_ids: extraTelemetry.anthropicRequestIds ?? [],
      p_slide_count: manifest.slideCount,
      p_page_count: manifest.pageCount ?? manifest.slideCount,
      p_qa_passed: qaReport.tier === "green",
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
  const attemptCostTelemetry = {
    model: MODEL,
    estimatedCostUsd: extraTelemetry.estimatedCostUsd ?? 0,
    attemptNumber: attempt?.attemptNumber ?? null,
    ...extraTelemetry,
  };
  const runCostTelemetry = await buildRunCostTelemetry(
    config,
    runId,
    attempt,
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
    await callRpc<Array<{ refunded: boolean; amount: number }>>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      functionName: "refund_run_credit",
      params: {
        p_run_id: runId,
      },
    }).catch(() => []);
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
        outputTokens: request.usage.output_tokens ?? 0,
        totalTokens: (request.usage.input_tokens ?? 0) + (request.usage.output_tokens ?? 0),
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
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, status: "started" },
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

function appendAssistantTurn(
  messages: Anthropic.Beta.BetaMessageParam[],
  message: Anthropic.Beta.BetaMessage,
): Anthropic.Beta.BetaMessageParam[] {
  // Strip orphaned tool_use blocks that lack a matching tool_result in the same message.
  // This happens when code execution is interrupted during a pause_turn — the assistant
  // message contains the tool_use but the API never appended the tool_result.
  const content = message.content as Anthropic.Beta.BetaContentBlockParam[];
  const resultToolIds = new Set<string>();
  for (const block of content) {
    const b = block as unknown as Record<string, unknown>;
    if (
      typeof b.type === "string" &&
      b.type.endsWith("_tool_result") &&
      typeof b.tool_use_id === "string"
    ) {
      resultToolIds.add(b.tool_use_id);
    }
  }
  const safeContent = content.filter((block) => {
    const b = block as unknown as Record<string, unknown>;
    if (
      typeof b.type === "string" &&
      b.type.endsWith("_tool_use") &&
      typeof b.id === "string" &&
      !resultToolIds.has(b.id)
    ) {
      return false;
    }
    return true;
  });

  return [
    ...messages,
    {
      role: "assistant",
      content: safeContent.length > 0 ? safeContent : content,
    },
  ];
}

function validateAnalyticalEvidence(parsed: Awaited<ReturnType<typeof parseEvidencePackage>>) {
  if (parsed.datasetProfile.sheets.length > 0) {
    return null;
  }

  const evidenceKinds = new Set(parsed.datasetProfile.sourceFiles.map((file) => file.kind));
  if (evidenceKinds.size === 0) {
    return "Basquio could not find any usable evidence files for this run.";
  }

  if (!evidenceKinds.has("workbook")) {
    return "Basquio could not find readable analytical data in the uploaded evidence. For now, add at least one CSV, XLSX, or XLS file as primary evidence and keep PPTX, PDF, images, and documents as support material or template input.";
  }

  return "Basquio could not read analytical tables from the uploaded evidence. Check that the CSV/XLSX/XLS files contain readable tabular data and retry.";
}

function buildAuthorMessage(
  run: RunRow,
  analysis: z.infer<typeof analysisSchema> | null,
  files?: {
    uploadedEvidence: Array<{ id: string; filename: string }>;
    uploadedTemplate: { id: string; filename: string } | null;
  },
  questionRoutes: Array<{ id: string; name: string; diagnosticMotifs: string[]; recommendationLevers: string[] }> = [],
  chartSlotConstraintMessage?: string,
) {
  const routeContext = questionRoutes.length > 0
    ? `- Detected analytical question: ${questionRoutes[0].name}. Check for these diagnostic motifs: ${questionRoutes[0].diagnosticMotifs.join(", ") || "none specific"}. Recommended levers: ${questionRoutes[0].recommendationLevers.join(", ") || "general"}.`
    : "";
  const chartPreprocessingGuide = buildChartPreprocessingGuide();
  const mergedAnalysisInstructions = analysis
    ? []
    : [
        "Analyze the uploaded evidence package first, then generate the final consulting-grade deck artifacts in the same pass.",
        "- Use code execution to inspect the uploaded files directly and compute the facts you need.",
        "- Follow the NIQ Analyst Playbook from the system prompt: recognize Italian column names, compute ALL applicable derivatives (growth, share, price index, mix gap) before forming findings, and detect diagnostic motifs.",
        "- Frame the analysis around the TRUE commercial question, not a generic summary. Classify each finding as connection, contradiction, or curiosity.",
        "- Recommendations must be traceable to the data in this run. Do not invent geographies, channels, or opportunities that are not directly supported by the evidence.",
        "- If the brief is about promotions, benchmark the focal brand against key competitors and call out what others are doing, not only what the focal brand is doing.",
        "- Structure the executive storyline as SCQA (Situation/Complication/Question/Answer). Default DEDUCTIVE: the answer goes on slide 2.",
        ...(routeContext ? [routeContext] : []),
        "- Inspect only the workbook regions needed to answer the brief. Do not spend time on exhaustive profiling of every tab if it is not necessary.",
        "- Compute deterministic facts in Python and produce a concise executive storyline.",
        `- The requested deck size is canonical. Produce exactly ${run.target_slide_count} slides in the final deck.`,
        `- Every planned slide must use a slideArchetype chosen from: ${APPROVED_ARCHETYPES.join(", ")}.`,
        "- Recommend charts only when they materially improve the argument.",
        chartPreprocessingGuide,
      ];

  return {
    role: "user" as const,
    content: [
      ...(files?.uploadedEvidence.map((file) => ({ type: "container_upload" as const, file_id: file.id })) ?? []),
      ...(files?.uploadedTemplate ? [{ type: "container_upload" as const, file_id: files.uploadedTemplate.id }] : []),
      {
        type: "text" as const,
        text: [
          analysis
            ? "Using the evidence files already available in the current container and the approved analysis below, generate the final consulting-grade deck artifacts."
            : "Use the evidence files already available in the current container to build a final consulting-grade deck without a separate analysis turn.",
          "",
          buildGenerationBrief(run),
          "",
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
          "- Follow the loaded pptx skill for the deck artifact generation.",
          ...(files?.uploadedTemplate
            ? [
                `- A client PPTX template is uploaded in the container as ${files.uploadedTemplate.filename}. Use that actual template file as the visual source of truth, not just the summarized template tokens.`,
                "- Preserve the client's master background treatment and embedded logo/wordmark assets wherever the template already provides them.",
                "- Do not replace a light client template with Basquio dark styling.",
              ]
            : []),
          "- Generate charts as high-resolution PNG assets in Python and insert them as images.",
          "- Do not use native PowerPoint chart objects for critical visuals.",
          ...(chartSlotConstraintMessage ? [chartSlotConstraintMessage] : []),
          "- Treat the deterministic chart preprocessing guide below as a hard render contract, not as optional style advice.",
          chartPreprocessingGuide,
          "- Match every chart canvas to its target slot aspect ratio. Never stretch chart images in the final deck.",
          "- Before rendering any chart, check category label lengths: if average > 12 chars or count > 8, use horizontal bars or aggregate.",
          "- For charts with source notes: add plt.subplots_adjust(bottom=0.15) BEFORE plt.tight_layout() so the source text does not collide with axis labels. Always call plt.tight_layout() before savefig().",
          "- For horizontal bar charts with end-of-bar value labels: set xlim right padding to at least 8% beyond the max value so labels are not clipped at the figure edge.",
          "- If a chart is sparse, leader-dominated, or near-zero outside one segment, switch to a split or commentary-led slide instead of forcing a wide chart.",
          "- Numeric labels must be clean: + exactly once for positives, - for negatives, and pp labels like +0.09pp with no doubled symbols.",
          "- If a slide headline or commentary claims growth, expansion, or acceleration in a metric, the exhibit must show the change in that metric, not just its current level.",
          "- If a slide promises a comparison set with an explicit count such as 4 provinces, 3 channels, or 5 segments, cover all of them explicitly or change the claim.",
          "- Recommendations must stay inside the proven evidence. Do not elevate a country, region, or lever unless the supporting chart or table clearly makes it one of the strongest opportunities.",
          "- Apply the copywriting voice rules from the NIQ Analyst Playbook: no em dashes, no AI slop patterns, numbers first, active voice, every sentence carries information.",
          "- Native-language quality is mandatory. If the brief is Italian, write native Italian business prose, not translated English and not pseudo-Spanish. Never use fake-Italian verbs such as 'lidera' or 'performa'.",
          "- If the brief is English, write direct partner-grade English with no padded corporate phrasing such as 'in order to' or 'going forward'.",
          "- Every analytical slide must answer four questions: what changed, by how much, why it happened, and what the executive should do. A slide that only restates the chart is unfinished.",
          "- Slide titles must state the insight with at least one number, max 14 words. Charts are the hero (60%+ of slide area). Quantify all recommendations with FMCG levers.",
          `- Produce exactly ${run.target_slide_count} slides. Do not widen or compress the deck.`,
          `- \`deck_manifest.json\` slideCount must equal ${run.target_slide_count}.`,
          analysis
            ? "- Generate and attach these files exactly: `deck.pptx`, `deck.pdf`, and `deck_manifest.json`."
            : "- Generate and attach these files exactly: `analysis_result.json`, `deck.pptx`, `deck.pdf`, and `deck_manifest.json`.",
          ...(analysis
            ? []
            : [
                "- `analysis_result.json` must be valid JSON matching the approved analysis schema with `language`, `thesis`, `executiveSummary`, and `slidePlan[]`.",
                "- For every `slidePlan[].chart`, include `maxCategories`, `preferredOrientation`, `slotAspectRatio`, `figureSize`, `sort`, and `truncateLabels` so downstream QA can verify the chart contract.",
                "- Use the same language as the brief. Do not emit mixed-language output.",
              ]),
          "- `deck_manifest.json` must contain `slideCount`, `pageCount`, `slides[]`, and `charts[]` describing the final deck.",
          "- Each chart in the manifest should include `categoryCount` and `categories[]` when available so Basquio can verify density and label fit.",
          "- Each slide entry in the manifest must include `position`, `layoutId`, `slideArchetype`, `title`, and `chartId` when applicable.",
          "- Your final assistant message must attach the files as container uploads before finishing.",
        ].join("\n"),
      },
    ],
  };
}

function buildReviseMessage(issues: string[]) {
  const chartPreprocessingGuide = buildChartPreprocessingGuide();
  return {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: [
          "Repair the generated deck and regenerate deck.pptx, deck.pdf, and deck_manifest.json.",
          "Reuse the existing container state and the prior authoring context. Do not start a new draft from scratch unless necessary to fix the issues.",
          "If a client PPTX template is present in the container, continue using it as the visual source of truth. Do not drift back to Basquio dark/editorial styling during repair.",
          "Fix these issues:",
          ...issues.map((issue) => `- ${issue}`),
          "",
          "Do not widen the deck. Improve the weak slides and keep the deck consulting-grade.",
          "Apply the copywriting voice rules from the system prompt when rewriting any text: no em dashes, numbers first, active voice, insight titles not topic labels.",
          "Keep language native and sharp. In Italian, do not use translated-English or pseudo-Spanish wording such as 'lidera'. In English, remove padded corporate phrasing.",
          "When revising analytical slides, do not merely soften the prose. Make sure each slide states the fact, the magnitude, the driver, and the implication.",
          "Use Arial for all dense text and card internals unless the uploaded template explicitly forces another safe font.",
          "Do not use stacked ordinals, narrow title boxes, or floating footer metrics that can drift across PowerPoint, Keynote, and Google Slides.",
          "Re-apply the deterministic chart preprocessing guide when you rebuild any chart.",
          chartPreprocessingGuide,
          "Fix any stretched charts by re-rendering them at the correct slot ratio rather than scaling the old image.",
          "Fix any chart where the source note text collides with axis labels by adding plt.subplots_adjust(bottom=0.15) before plt.tight_layout().",
          "Fix any chart where end-of-bar value labels are clipped at the right edge by adding xlim padding.",
          "Fix any slide where title text overflows the right margin by shortening the title to fit on one line.",
          "Fix any side-panel card where body text overflows the card boundary by shortening the text to 3 lines max.",
          "If a slide has a weak sparse chart or ugly dead space, switch to a more appropriate grammar instead of padding the same layout.",
          "Fix malformed numeric annotations such as duplicated plus signs or inconsistent pp notation.",
          "Fix any claim-exhibit mismatch where the title or commentary says a metric is growing but the visual only shows current level.",
          "Fix any comparison slide that promises a full set of entities but only covers a subset in the commentary.",
          "For action cards, reserve separate non-overlapping bands for index, title, body, and footer.",
          "Keep charts as image-based embeds that remain visible in Keynote.",
          "Your final assistant message must attach deck.pptx, deck.pdf, and deck_manifest.json as container_upload blocks.",
        ].join("\n"),
      },
    ],
  };
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
          outputTokens: record.usage.output_tokens ?? 0,
          totalTokens: (record.usage.input_tokens ?? 0) + (record.usage.output_tokens ?? 0),
          status: record.stopReason?.startsWith("transient_retry") ? "failed_transient" : "completed",
        },
        started_at: record.startedAt,
        completed_at: record.completedAt,
      }],
    });
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
  systemPrompt: string | Array<Anthropic.Beta.BetaTextBlockParam>;
  maxTokens: number;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaToolUnion[];
  container?: Anthropic.Beta.BetaContainerParams;
  outputConfig?: Anthropic.Beta.BetaOutputConfig;
  /** Optional: persist each retry-level request record immediately for telemetry truth */
  onRequestRecord?: (record: ClaudeRequestUsage) => Promise<void>;
  phaseLabel?: DeckPhase;
  onMeaningfulProgress?: () => Promise<unknown> | void;
  /** Maximum number of pause_turn continuations before breaking out. Default: unlimited (up to 8 iterations). */
  maxPauseTurns?: number;
  phaseTimeoutMs?: number;
  currentSpentUsd?: number;
  circuitKey?: string;
}) {
  let messages = [...input.messages];
  const fileIds = new Set<string>();
  let currentContainer = input.container;
  let finalMessage: Anthropic.Beta.BetaMessage | null = null;
  let iterationCount = 0;
  let pauseTurns = 0;
  const requests: ClaudeRequestUsage[] = [];
  const usage: Required<ClaudeUsage> = {
    input_tokens: 0,
    output_tokens: 0,
  };
  const controller = input.phaseTimeoutMs ? new AbortController() : null;
  const timeoutHandle = input.phaseTimeoutMs
    ? setTimeout(() => controller?.abort(), input.phaseTimeoutMs)
    : null;
  const circuitState = input.circuitKey
    ? getCircuitBreakerState(input.circuitKey)
    : null;

  try {
    for (let iteration = 0; iteration < 8; iteration += 1) {
      if (circuitState && input.circuitKey) {
        assertCircuitClosed(circuitState, input.circuitKey);
      }
      if (input.currentSpentUsd !== undefined) {
        const remainingBudgetUsd = roundUsd(3.5 - input.currentSpentUsd - usageToCost(MODEL, usage));
        if (remainingBudgetUsd < CONTINUATION_MIN_REMAINING_BUDGET_USD) {
          const budgetMessage = `[runClaudeLoop] remaining budget $${remainingBudgetUsd.toFixed(3)} below continuation threshold $${CONTINUATION_MIN_REMAINING_BUDGET_USD.toFixed(2)}.`;
          console.warn(`${budgetMessage} ${finalMessage ? "Breaking before another continuation." : "Aborting phase before request."}`);
          if (!finalMessage) {
            throw new Error(`${budgetMessage} Aborting phase before another Claude request.`);
          }
          break;
        }
      }

      iterationCount += 1;
      const startedAt = new Date().toISOString();
      let message: Anthropic.Beta.BetaMessage;
      let requestId: string | null = null;
      const streamBody = {
        model: MODEL,
        max_tokens: input.maxTokens,
        betas: [...BETAS] as Anthropic.Beta.AnthropicBeta[],
        system: input.systemPrompt,
        container: currentContainer,
        messages,
        tools: input.tools,
        output_config: input.outputConfig,
      };

      // Bounded transient retry with exponential backoff + jitter
      let lastTransientError: Error | null = null;
      for (let retry = 0; retry <= TRANSIENT_RETRY_DELAYS_MS.length; retry += 1) {
        const requestController = new AbortController();
        const phaseRequestTimeoutMs = input.phaseTimeoutMs
          ?? (input.phaseLabel ? REQUEST_WATCHDOG_BY_PHASE_MS[input.phaseLabel] : STREAM_REQUEST_WATCHDOG_MS)
          ?? STREAM_REQUEST_WATCHDOG_MS;
        const requestTimeoutMs = Math.max(
          45_000,
          phaseRequestTimeoutMs,
        );
        const requestTimeoutHandle = setTimeout(() => requestController.abort(), requestTimeoutMs);
        try {
          const signal = controller
            ? AbortSignal.any([controller.signal, requestController.signal])
            : requestController.signal;
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
          if (requestController.signal.aborted && !controller?.signal.aborted) {
            const watchdogError = new Error(`Claude stream watchdog timed out after ${requestTimeoutMs}ms.`);
            watchdogError.name = "AbortError";
            streamError = watchdogError;
          }
          requestId = null;
          if (isTransientProviderError(streamError) && retry < TRANSIENT_RETRY_DELAYS_MS.length) {
            lastTransientError = streamError instanceof Error ? streamError : new Error(String(streamError));
            const baseDelay = TRANSIENT_RETRY_DELAYS_MS[retry];
            const jitter = Math.round(Math.random() * baseDelay * 0.3);
            console.warn(
              `[runClaudeLoop] transient error (retry ${retry + 1}/${TRANSIENT_RETRY_DELAYS_MS.length}): ${lastTransientError.message.slice(0, 200)}. Waiting ${baseDelay + jitter}ms...`,
            );
            const retryRecord: ClaudeRequestUsage = {
              requestId: null,
              startedAt,
              completedAt: new Date().toISOString(),
              usage: { input_tokens: 0, output_tokens: 0 },
              stopReason: `transient_retry_${retry + 1}`,
            };
            requests.push(retryRecord);
            if (input.onRequestRecord) {
              await input.onRequestRecord(retryRecord).catch(() => {});
            }
            await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
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
          clearTimeout(requestTimeoutHandle);
        }
      }
      if (lastTransientError) {
        throw lastTransientError;
      }

      const completedAt = new Date().toISOString();

      finalMessage = message!;
      currentContainer = finalMessage.container ? { id: finalMessage.container.id } : currentContainer;
      usage.input_tokens += finalMessage.usage?.input_tokens ?? 0;
      usage.output_tokens += finalMessage.usage?.output_tokens ?? 0;
      const generatedFileIds = collectGeneratedFileIds(finalMessage.content);
      const completedRecord: ClaudeRequestUsage = {
        requestId,
        startedAt,
        completedAt,
        usage: {
          input_tokens: finalMessage.usage?.input_tokens ?? 0,
          output_tokens: finalMessage.usage?.output_tokens ?? 0,
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

      messages = appendAssistantTurn(messages, finalMessage);
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
    containerId: finalMessage.container?.id ?? currentContainer?.id ?? null,
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
  const missingFiles = requiredFiles.filter((fileName) => !files.some((file) => file.fileName === fileName || file.fileName.endsWith(fileName)));
  if (missingFiles.length > 0) {
    throw new Error(`${phase} phase is missing required output files: ${missingFiles.join(", ")}.`);
  }
}

function collectGeneratedFileIds(blocks: Anthropic.Beta.BetaContentBlock[]) {
  const fileIds: string[] = [];

  for (const block of blocks) {
    if (block.type === "code_execution_tool_result" && block.content.type === "code_execution_result") {
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
      return analysisSchema.parse(JSON.parse(raw));
    } catch {
      const repaired = attemptJsonRepair(raw);
      if (repaired) {
        return analysisSchema.parse(JSON.parse(repaired));
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
    return analysisSchema.parse(JSON.parse(text));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid analysis JSON.";
    throw new Error(`Claude did not return parseable structured analysis JSON. ${reason} Response preview: ${text.slice(0, 800)}`);
  }
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
  if (!content || !content.phase || !content.pptxStoragePath || !content.pdfStoragePath) {
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


async function persistDeckSpec(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  manifest: z.infer<typeof deckManifestSchema>,
) {
  await deleteRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_spec_v2_slides",
    query: { run_id: `eq.${runId}` },
  }).catch(() => {});

  await deleteRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_spec_v2_charts",
    query: { run_id: `eq.${runId}` },
  }).catch(() => {});

  const chartIdMap = new Map<string, string>();
  const chartRows = manifest.charts.map((chart) => {
    const id = randomUUID();
    chartIdMap.set(chart.id, id);
    return {
      id,
      run_id: runId,
      chart_type: chart.chartType,
      title: chart.title,
      data: [],
      x_axis: "",
      y_axis: "",
      series: [],
      style: {},
      source_note: chart.sourceNote ?? null,
      thumbnail_url: null,
      width: 0,
      height: 0,
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
    id: randomUUID(),
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
      onConflict: "id",
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
  if (typeof requestedSlideCount === "number" && manifest.slideCount !== requestedSlideCount) {
    issues.push(`Manifest slideCount ${manifest.slideCount} does not match requested targetSlideCount ${requestedSlideCount}.`);
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
    body: slide.body,
    bullets: slide.bullets,
    callout: slide.callout ? { text: slide.callout.text, tone: slide.callout.tone } : undefined,
    metrics: slide.metrics,
  }));
}

function lintManifest(manifest: z.infer<typeof deckManifestSchema>) {
  const result = lintDeckText(manifestToLintInput(manifest));
  const actionableIssues = [
    ...result.slideResults.flatMap((slideResult) =>
      slideResult.result.violations
        .filter((violation) => violation.severity === "critical" || violation.severity === "major")
        .map((violation) => `Slide ${slideResult.position} writing issue: ${violation.message} (${violation.field})`),
    ),
    ...result.deckViolations
      .filter((violation) => violation.severity === "critical" || violation.severity === "major")
      .map((violation) => `Deck writing issue: ${violation.message}`),
  ];

  return { result, actionableIssues };
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
  };
}

function validateManifestContract(manifest: z.infer<typeof deckManifestSchema>) {
  const chartById = new Map(manifest.charts.map((chart) => [chart.id, chart]));
  const result = validateDeckContract(
    manifest.slides.map((slide) => ({
      layoutId: slide.layoutId ?? "title-body",
      chartType: slide.chartId ? chartById.get(slide.chartId)?.chartType : undefined,
    })),
  );

  return {
    result,
    actionableIssues: result.violations.map((violation) => `Deck contract issue: ${violation.message}`),
  };
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
}) {
  const blockingFailures = [
    ...input.qaReport.failed,
    ...input.lint.actionableIssues.map((issue) => `lint:${issue}`),
    ...input.contract.actionableIssues.map((issue) => `contract:${issue}`),
  ];

  return {
    blockingFailures: [...new Set(blockingFailures)],
    lintSummary: summarizeLintResult(input.lint),
    contractSummary: summarizeDeckContractResult(input.contract),
  };
}

function buildPublishDecision(input: {
  qaReport: Awaited<ReturnType<typeof buildQaReport>>;
  lint: ReturnType<typeof lintManifest>;
  contract: ReturnType<typeof validateManifestContract>;
  visualQa: RenderedPageQaReport;
  artifactSource: PublishDecision["artifactSource"];
}): PublishDecision {
  const gate = collectPublishGateFailures({
    qaReport: input.qaReport,
    lint: input.lint,
    contract: input.contract,
  });

  return {
    decision: gate.blockingFailures.length === 0 ? "publish" : "fail",
    hardBlockers: gate.blockingFailures,
    advisories: [
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
    artifactSource: input.artifactSource,
    visualQa: {
      overallStatus: input.visualQa.overallStatus,
      deckNeedsRevision: input.visualQa.deckNeedsRevision,
    },
    lintPassed: input.lint.actionableIssues.length === 0,
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

function isAdvisoryCritiqueIssue(issue: string) {
  const normalized = issue.toLowerCase();
  return normalized.includes("title is") && normalized.includes("overflow the right margin");
}

async function buildQaReport(
  manifest: z.infer<typeof deckManifestSchema>,
  pptx: GeneratedFile,
  pdf: GeneratedFile,
  docx: GeneratedFile,
  visualQa: RenderedPageQaReport,
  templateDiagnostics: TemplateDiagnostics,
  requestedSlideCount?: number,
) {
  const chartSlotConstraintFindings = collectChartSlotConstraintFindings(manifest);
  const checks = [
    { name: "pptx_present", passed: pptx.buffer.length > 0, detail: `${pptx.buffer.length} bytes` },
    { name: "pdf_present", passed: pdf.buffer.length > 0, detail: `${pdf.buffer.length} bytes` },
    { name: "docx_present", passed: docx.buffer.length > 0, detail: `${docx.buffer.length} bytes` },
    { name: "slide_count_positive", passed: manifest.slideCount > 0, detail: `${manifest.slideCount} slides` },
    {
      name: "slide_count_matches_requested_target",
      passed: typeof requestedSlideCount !== "number" || manifest.slideCount === requestedSlideCount,
      detail: typeof requestedSlideCount === "number" ? `requested=${requestedSlideCount} manifest=${manifest.slideCount}` : "no requested slide count recorded",
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
      name: "template_diagnostics_present",
      passed: Boolean(templateDiagnostics.status && templateDiagnostics.source && templateDiagnostics.effect),
      detail: `${templateDiagnostics.source}:${templateDiagnostics.status}:${templateDiagnostics.effect}`,
    },
    {
      name: "rendered_page_numeric_labels_clean",
      passed: !visualQa.issues.some((issue) => issue.code === "numeric_label_malformed"),
      detail: visualQa.issues
        .filter((issue) => issue.code === "numeric_label_malformed")
        .map((issue) => `slide ${issue.slidePosition}`)
        .join(", ") || "no malformed numeric labels reported",
    },
  ];

  const zipSignatureValid = pptx.buffer.length >= 4 && pptx.buffer[0] === 0x50 && pptx.buffer[1] === 0x4b;
  checks.push({ name: "pptx_zip_signature", passed: zipSignatureValid, detail: "pptx starts with PK" });

  const pdfHeaderValid =
    pdf.buffer.length >= 4 &&
    pdf.buffer[0] === 0x25 &&
    pdf.buffer[1] === 0x50 &&
    pdf.buffer[2] === 0x44 &&
    pdf.buffer[3] === 0x46;
  checks.push({ name: "pdf_header_signature", passed: pdfHeaderValid, detail: "pdf starts with %PDF" });

  const docxZipSignatureValid = docx.buffer.length >= 4 && docx.buffer[0] === 0x50 && docx.buffer[1] === 0x4b;
  checks.push({ name: "docx_zip_signature", passed: docxZipSignatureValid, detail: "docx starts with PK" });

  const validated = await validateArtifactChecks(manifest, checks, pptx.buffer, pdf.buffer, docx.buffer);
  return {
    ...validated,
    template: templateDiagnostics,
  };
}

async function validateArtifactChecks(
  manifest: z.infer<typeof deckManifestSchema>,
  checks: Array<{ name: string; passed: boolean; detail: string }>,
  pptxBuffer: Buffer,
  pdfBuffer: Buffer,
  docxBuffer: Buffer,
) {
  const failed = [...checks.filter((check) => !check.passed).map((check) => check.name)];
  const allChecks = [...checks];
  const allFailed = [...failed];

  try {
    const zip = await JSZip.loadAsync(pptxBuffer);
    const presentationXml = zip.file("ppt/presentation.xml");
    const contentTypesXml = zip.file("[Content_Types].xml");
    const slideXmlCount = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
    const rasterMediaCount = Object.keys(zip.files).filter((name) => /^ppt\/media\/.+\.(png|jpe?g)$/i.test(name)).length;
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

  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
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

  try {
    const zip = await JSZip.loadAsync(docxBuffer);
    const documentXml = zip.file("word/document.xml");
    const contentTypes = zip.file("[Content_Types].xml");
    const documentText = documentXml ? await documentXml.async("string") : "";
    const flattenedText = documentText
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const visibleTextLength = documentText
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .length;
    const hasInternalScaffolding =
      /evidence-backed story as the deck/i.test(flattenedText) ||
      /downstream ai workflows/i.test(flattenedText) ||
      /text-first format/i.test(flattenedText);
    const hasPlaceholderMetrics = /\bMetric\s+\d+\b/.test(flattenedText);
    const extraChecks = [
      { name: "docx_document_xml", passed: Boolean(documentXml), detail: "word/document.xml exists" },
      { name: "docx_content_types_xml", passed: Boolean(contentTypes), detail: "[Content_Types].xml exists" },
      {
        name: "docx_text_content_present",
        passed: visibleTextLength >= 160,
        detail: `${visibleTextLength} visible chars`,
      },
      {
        name: "docx_no_internal_scaffolding",
        passed: !hasInternalScaffolding,
        detail: hasInternalScaffolding ? "contains internal product scaffolding language" : "no internal scaffolding language",
      },
      {
        name: "docx_no_placeholder_metrics",
        passed: !hasPlaceholderMetrics,
        detail: hasPlaceholderMetrics ? "contains placeholder Metric N rows" : "no placeholder metric rows",
      },
    ];
    allChecks.push(...extraChecks);
    allFailed.push(...extraChecks.filter((check) => !check.passed).map((check) => check.name));
  } catch {
    allChecks.push({ name: "docx_parseable", passed: false, detail: "docx zip could not be parsed" });
    allFailed.push("docx_parseable");
  }

  return {
    tier: allFailed.length === 0 ? "green" as const : "red" as const,
    passed: allFailed.length === 0,
    checks: allChecks,
    failed: [...new Set(allFailed)],
  };
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

    if (distortion > 0.12) {
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
  pptx: GeneratedFile,
  pdf: GeneratedFile,
  docx: GeneratedFile,
  options: {
    checkpoint?: ArtifactCheckpoint | null;
    allowDocxFailure?: boolean;
  } = {},
) {
  const artifacts: PublishedArtifact[] = [];

  if (options.checkpoint) {
    artifacts.push(
      buildPublishedArtifact({
        kind: "pptx",
        fileName: "deck.pptx",
        mimeType: pptx.mimeType || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: pptx.buffer,
        storagePath: options.checkpoint.pptxStoragePath,
      }),
      buildPublishedArtifact({
        kind: "pdf",
        fileName: "deck.pdf",
        mimeType: pdf.mimeType || "application/pdf",
        buffer: pdf.buffer,
        storagePath: options.checkpoint.pdfStoragePath,
      }),
    );
  } else {
    const publishPrefix = `${run.id}/attempts/${attempt.attemptNumber}-${attempt.id}`;
    const coreItems = [
      { kind: "pptx", fileName: "deck.pptx", mimeType: pptx.mimeType || "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: pptx.buffer },
      { kind: "pdf", fileName: "deck.pdf", mimeType: pdf.mimeType || "application/pdf", buffer: pdf.buffer },
    ] as const;

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

  const docxMimeType = docx.mimeType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const docxStoragePath = `${run.id}/attempts/${attempt.attemptNumber}-${attempt.id}/report.docx`;
  try {
    await uploadToStorage({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: "artifacts",
      storagePath: docxStoragePath,
      body: docx.buffer,
      contentType: docxMimeType,
    });
    artifacts.push(buildPublishedArtifact({
      kind: "docx",
      fileName: "report.docx",
      mimeType: docxMimeType,
      buffer: docx.buffer,
      storagePath: docxStoragePath,
    }));
  } catch (error) {
    if (!options.allowDocxFailure) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[generateDeckRun] docx publish skipped during salvage: ${message.slice(0, 300)}`);
  }

  return artifacts;
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

function buildPhaseTelemetry(
  model: "claude-sonnet-4-6" | "claude-haiku-4-5" | "claude-opus-4-6",
  result: { usage: ClaudeUsage; iterations: number; pauseTurns: number; requestIds?: string[] },
) {
  return {
    model,
    estimatedCostUsd: usageToCost(model, result.usage),
    inputTokens: result.usage.input_tokens ?? 0,
    outputTokens: result.usage.output_tokens ?? 0,
    totalTokens: (result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0),
    iterations: result.iterations,
    pauseTurns: result.pauseTurns,
    anthropicRequestIds: result.requestIds ?? [],
  };
}

function buildSimplePhaseTelemetry(
  model: "claude-sonnet-4-6" | "claude-haiku-4-5" | "claude-opus-4-6",
  usage: ClaudeUsage | null | undefined,
) {
  return {
    model,
    estimatedCostUsd: usageToCost(model, usage),
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
  };
}
