import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

import { parseEvidencePackage } from "@basquio/data-ingest";
import { enforceExhibit, inferQuestionType, routeQuestion } from "@basquio/intelligence";
import { listArchetypeIds, validateSlotConstraints } from "@basquio/scene-graph/slot-archetypes";
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
import { buildBasquioSystemPrompt } from "./system-prompt";
import { notifyRunCompletionIfRequested } from "./notify-completion";
import { deleteRestRows, downloadFromStorage, fetchRestRows, patchRestRows, upsertRestRows, uploadToStorage } from "./supabase";

const MODEL = "claude-sonnet-4-6";
const VISUAL_QA_MODEL = "claude-haiku-4-5";
const FINAL_VISUAL_QA_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_TIMEOUT_MS = Number.parseInt(process.env.BASQUIO_ANTHROPIC_TIMEOUT_MS ?? "1800000", 10);
const FILES_BETA = "files-api-2025-04-14";
const CODE_EXEC_BETA = "code-execution-2025-08-25";
const SKILLS_BETA = "skills-2025-10-02";
const BETAS = [FILES_BETA, CODE_EXEC_BETA, SKILLS_BETA] as const;
const CLAUDE_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_fetch_20260209", name: "web_fetch" },
];
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
    }).optional(),
  })).default([]),
}).passthrough();

const ANALYSIS_OUTPUT_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      language: { type: "string" },
      thesis: { type: "string" },
      executiveSummary: { type: "string" },
      slidePlan: {
        type: "array",
        items: {
          type: "object",
          properties: {
            position: { type: "integer" },
            layoutId: { type: "string" },
            slideArchetype: { type: "string" },
            title: { type: "string" },
            subtitle: { type: "string" },
            body: { type: "string" },
            bullets: {
              type: "array",
              items: { type: "string" },
            },
            metrics: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  delta: { type: "string" },
                },
                required: ["label", "value"],
                additionalProperties: false,
              },
            },
            callout: {
              type: "object",
              properties: {
                text: { type: "string" },
                tone: {
                  type: "string",
                  enum: ["accent", "green", "orange"],
                },
              },
              required: ["text"],
              additionalProperties: false,
            },
            evidenceIds: {
              type: "array",
              items: { type: "string" },
            },
            chart: {
              type: "object",
              properties: {
                id: { type: "string" },
                chartType: { type: "string" },
                title: { type: "string" },
                sourceNote: { type: "string" },
              },
              required: ["id", "chartType", "title"],
              additionalProperties: false,
            },
          },
          required: ["position", "layoutId", "slideArchetype", "title"],
          additionalProperties: false,
        },
      },
    },
    required: ["language", "thesis", "executiveSummary", "slidePlan"],
    additionalProperties: false,
  },
} as const;

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
};

type RunAttemptRow = {
  id: string;
  run_id: string;
  attempt_number: number;
  status: string;
  recovery_reason: string | null;
  failure_phase: string | null;
  failure_message: string | null;
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
type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
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
    const templateFile = isTemplateFallback
      ? undefined
      : (sourceFiles.find((file) => file.id === templateSourceFileId) ??
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

    const recoveredAnalysis = (attempt.recoveryReason === "stale_timeout" || attempt.recoveryReason === "transient_provider_retry")
      ? await loadRecoveredAnalysis(config, runId)
      : null;

    let analysis: z.infer<typeof analysisSchema>;
    let baseContainerId: string | null = null;

    if (recoveredAnalysis) {
      analysis = recoveredAnalysis;
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
    } else {
      currentPhase = "understand";
      await markPhase(config, runId, attempt, currentPhase);

      const questionRoutes = routeQuestion(buildBriefText(run));
      const understandMessage = buildUnderstandMessage(run, uploadedEvidence, uploadedTemplate, questionRoutes);
      await recordToolCall(config, runId, attempt, "understand", "code_execution", {
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
        outputTokenBudget: 16_000,
        body: {
          system: systemPrompt,
          messages: [understandMessage],
          tools: CLAUDE_TOOLS,
          output_config: {
            effort: "medium",
            format: ANALYSIS_OUTPUT_FORMAT,
          },
        },
      });

      // G: persist request-start telemetry before calling Claude
      await persistRequestStart(config, runId, attempt, "understand", "phase_generation", MODEL);

      const understandResponse = await runClaudeLoop({
        client,
        systemPrompt,
        maxTokens: 4_096,
        container: {
          skills: [
            { type: "anthropic", skill_id: "pptx", version: "latest" },
            { type: "anthropic", skill_id: "pdf", version: "latest" },
          ],
        },
        messages: [understandMessage],
        tools: CLAUDE_TOOLS,
        outputConfig: {
          effort: "medium",
          format: ANALYSIS_OUTPUT_FORMAT,
        },
      });
      spentUsd = roundUsd(spentUsd + usageToCost(MODEL, understandResponse.usage));
      assertDeckSpendWithinBudget(spentUsd);
      continuationCount += understandResponse.pauseTurns;
      phaseTelemetry.understand = buildPhaseTelemetry(MODEL, {
        ...understandResponse,
        requestIds: understandResponse.requests.map((request) => request.requestId).filter((requestId): requestId is string => Boolean(requestId)),
      });
      await persistRequestUsage(config, runId, attempt, "understand", "phase_generation", MODEL, understandResponse.requests);
      rememberRequestIds(anthropicRequestIds, understandResponse.requests);

      // Structured-output hardening: bounded repair for understand analysis JSON
      try {
        analysis = parseStructuredAnalysisResponse(understandResponse.message);
      } catch (parseError) {
        const parseMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.warn(`[generateDeckRun] understand analysis JSON malformed, attempting repair: ${parseMsg.slice(0, 200)}`);
        phaseTelemetry.understandParseRepair = { firstAttemptError: parseMsg.slice(0, 500) };

        // Attempt deterministic JSON repair: try to fix truncated JSON
        const rawText = extractResponseText(understandResponse.message.content);
        const repaired = attemptJsonRepair(rawText);
        if (repaired) {
          try {
            analysis = analysisSchema.parse(JSON.parse(repaired));
            phaseTelemetry.understandParseRepair = { ...phaseTelemetry.understandParseRepair as Record<string, unknown>, repairSucceeded: true };
          } catch {
            // Repair failed — re-throw original
            throw parseError;
          }
        } else {
          throw parseError;
        }
      }
      baseContainerId = understandResponse.containerId;
      enforceAnalysisExhibitRules(analysis);
      await upsertWorkingPaper(config, runId, "analysis_result", analysis);
      await upsertWorkingPaper(config, runId, "deck_plan", { slidePlan: analysis.slidePlan });
      await completePhase(config, runId, attempt, "understand", {
        slidePlanCount: analysis.slidePlan.length,
        thesis: analysis.thesis,
        estimatedCostUsd: spentUsd,
        containerId: understandResponse.containerId,
      }, understandResponse.usage);
    }

    currentPhase = "author";
    await markPhase(config, runId, attempt, currentPhase);

    const generationMessage = buildAuthorMessage(
      run,
      analysis,
      !baseContainerId ? { uploadedEvidence, uploadedTemplate } : undefined,
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
        output_config: {
          effort: "medium",
        },
      },
    });

    await persistRequestStart(config, runId, attempt, "author", "phase_generation", MODEL);
    let authorResponse = await runClaudeLoop({
      client,
      systemPrompt,
      maxTokens: 8_192,
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
      outputConfig: {
        effort: "medium",
      },
    });
    spentUsd = roundUsd(spentUsd + usageToCost(MODEL, authorResponse.usage));
    assertDeckSpendWithinBudget(spentUsd);
    continuationCount += authorResponse.pauseTurns;
    phaseTelemetry.author = buildPhaseTelemetry(MODEL, {
      ...authorResponse,
      requestIds: authorResponse.requests.map((request) => request.requestId).filter((requestId): requestId is string => Boolean(requestId)),
    });
    await persistRequestUsage(config, runId, attempt, "author", "phase_generation", MODEL, authorResponse.requests);
    rememberRequestIds(anthropicRequestIds, authorResponse.requests);

    const authorRecovery = await recoverMissingArtifacts({
      client,
      systemPrompt,
      baseResponse: authorResponse,
      phaseLabel: "author",
        requiredFiles: ["deck.pptx", "deck.pdf", "deck_manifest.json"],
        tools: CLAUDE_TOOLS,
        containerFallback: baseContainerId
          ? { id: baseContainerId }
          : {
              skills: [
                { type: "anthropic", skill_id: "pptx", version: "latest" },
                { type: "anthropic", skill_id: "pdf", version: "latest" },
            ],
          },
    });
    if ((authorRecovery.usage.input_tokens ?? 0) > 0 || (authorRecovery.usage.output_tokens ?? 0) > 0) {
      spentUsd = roundUsd(spentUsd + usageToCost(MODEL, authorRecovery.usage));
      assertDeckSpendWithinBudget(spentUsd);
      continuationCount += authorRecovery.pauseTurns;
      phaseTelemetry.authorArtifactRecovery = buildPhaseTelemetry(MODEL, {
        usage: authorRecovery.usage,
        iterations: authorRecovery.iterations,
        pauseTurns: authorRecovery.pauseTurns,
        requestIds: authorRecovery.requests.map((request) => request.requestId).filter((requestId): requestId is string => Boolean(requestId)),
      });
      await persistRequestUsage(config, runId, attempt, "author", "missing_artifact_repair", MODEL, authorRecovery.requests);
      rememberRequestIds(anthropicRequestIds, authorRecovery.requests);
    }
    const authorPhaseUsage = {
      input_tokens: (authorResponse.usage.input_tokens ?? 0) + (authorRecovery.usage.input_tokens ?? 0),
      output_tokens: (authorResponse.usage.output_tokens ?? 0) + (authorRecovery.usage.output_tokens ?? 0),
    };
    authorResponse = authorRecovery.response;
    const containerId = authorResponse.containerId;
    const authorFiles = authorRecovery.files;
    const pptxFile = requireGeneratedFile(authorFiles, "deck.pptx");
    const pdfFile = requireGeneratedFile(authorFiles, "deck.pdf");
    let manifest = parseManifestResponse(authorResponse.message, authorFiles);
    let latestResponse = authorResponse;
    let latestContainerId = authorResponse.containerId ?? containerId ?? baseContainerId;

    await persistDeckSpec(config, runId, manifest);
    await completePhase(config, runId, attempt, "author", {
      containerId,
      slideCount: manifest.slideCount,
      chartCount: manifest.charts.length,
      estimatedCostUsd: spentUsd,
    }, authorPhaseUsage);

    currentPhase = "render";
    await markPhase(config, runId, attempt, currentPhase);
    await completePhase(config, runId, attempt, "render", {
      containerId,
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
    await persistRequestUsage(config, runId, attempt, "critique", "rendered_page_qa", VISUAL_QA_MODEL, [{
      requestId: initialVisualQa.requestId,
      startedAt: initialVisualQa.startedAt,
      completedAt: initialVisualQa.completedAt,
      usage: {
        input_tokens: initialVisualQa.usage?.input_tokens ?? 0,
        output_tokens: initialVisualQa.usage?.output_tokens ?? 0,
      },
      stopReason: "end_turn",
    }]);
    rememberRequestIds(anthropicRequestIds, [{
      requestId: initialVisualQa.requestId,
      startedAt: initialVisualQa.startedAt,
      completedAt: initialVisualQa.completedAt,
      usage: {
        input_tokens: initialVisualQa.usage?.input_tokens ?? 0,
        output_tokens: initialVisualQa.usage?.output_tokens ?? 0,
      },
      stopReason: "end_turn",
    }]);
    await upsertWorkingPaper(config, runId, "visual_qa_author", initialVisualQa.report);
    const critiqueIssues = collectCritiqueIssues(manifest, initialVisualQa.report);
    await completePhase(
      config,
      runId,
      attempt,
      "critique",
      {
        issueCount: critiqueIssues.length,
        issues: critiqueIssues,
        visualQa: initialVisualQa.report,
      },
      initialVisualQa.usage,
    );

    let finalPptx = pptxFile;
    let finalPdf = pdfFile;
    let finalManifest = manifest;
    let finalVisualQa = initialVisualQa.report;

    if (critiqueIssues.length > 0) {
      currentPhase = "revise";
      await markPhase(config, runId, attempt, currentPhase);
      const reviseMessage = buildReviseMessage(critiqueIssues);
      const reviseMessages = [...authorResponse.thread, reviseMessage];
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
        container: {
          id: authorResponse.containerId ?? containerId,
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

      let reviseRecovery: Awaited<ReturnType<typeof recoverMissingArtifacts>> | null = null;
      try {
        reviseRecovery = await recoverMissingArtifacts({
          client,
          systemPrompt,
          baseResponse: reviseResponse,
          phaseLabel: "revise",
          requiredFiles: ["deck.pptx", "deck.pdf", "deck_manifest.json"],
          tools: CLAUDE_TOOLS,
          containerFallback: containerId
            ? { id: containerId }
            : {
                skills: [
                  { type: "anthropic", skill_id: "pptx", version: "latest" },
                  { type: "anthropic", skill_id: "pdf", version: "latest" },
                ],
              },
        });
      } catch (reviseRecoveryError) {
        // If revise artifact recovery itself fails, salvage pre-revise artifacts
        const recoveryMsg = reviseRecoveryError instanceof Error ? reviseRecoveryError.message : String(reviseRecoveryError);
        console.warn(`[generateDeckRun] revise artifact recovery failed, salvaging pre-revise artifacts: ${recoveryMsg.slice(0, 300)}`);
        phaseTelemetry.reviseSalvage = {
          reason: "revise_artifact_recovery_failure",
          errorMessage: recoveryMsg.slice(0, 500),
          fallbackSource: "author_phase_artifacts",
        };
        await completePhase(config, runId, attempt, "revise", {
          issueCount: critiqueIssues.length,
          estimatedCostUsd: spentUsd,
          salvaged: true,
          salvageReason: "revise_artifact_recovery_failure",
        }, reviseResponse.usage);
        // finalPptx, finalPdf, finalManifest remain from author phase
      }
      if (reviseRecovery && ((reviseRecovery.usage.input_tokens ?? 0) > 0 || (reviseRecovery.usage.output_tokens ?? 0) > 0)) {
        spentUsd = roundUsd(spentUsd + usageToCost(MODEL, reviseRecovery.usage));
        assertDeckSpendWithinBudget(spentUsd);
        continuationCount += reviseRecovery.pauseTurns;
        phaseTelemetry.reviseArtifactRecovery = buildPhaseTelemetry(MODEL, {
          usage: reviseRecovery.usage,
          iterations: reviseRecovery.iterations,
          pauseTurns: reviseRecovery.pauseTurns,
          requestIds: reviseRecovery.requests.map((request) => request.requestId).filter((requestId): requestId is string => Boolean(requestId)),
        });
        await persistRequestUsage(config, runId, attempt, "revise", "missing_artifact_repair", MODEL, reviseRecovery.requests);
        rememberRequestIds(anthropicRequestIds, reviseRecovery.requests);
      }
      const revisePhaseUsage = {
        input_tokens: (reviseResponse.usage.input_tokens ?? 0) + (reviseRecovery?.usage.input_tokens ?? 0),
        output_tokens: (reviseResponse.usage.output_tokens ?? 0) + (reviseRecovery?.usage.output_tokens ?? 0),
      };

      if (reviseRecovery) {
        reviseResponse = reviseRecovery.response;
        latestResponse = reviseResponse;
        latestContainerId = reviseResponse.containerId ?? latestContainerId;
      }
      const reviseFiles = reviseRecovery?.files ?? [];

      // Layer 3: structured-output repair — if revise manifest/artifacts are malformed,
      // fall back to the pre-revise (author-phase) artifacts instead of killing the run.
      // The author output already passed critique, so it is a valid deliverable.
      let reviseSalvaged = false;
      try {
        finalManifest = parseManifestResponse(reviseResponse.message, reviseFiles);
        finalPptx = requireGeneratedFile(reviseFiles, "deck.pptx");
        finalPdf = requireGeneratedFile(reviseFiles, "deck.pdf");
      } catch (reviseParseError) {
        const parseMsg = reviseParseError instanceof Error ? reviseParseError.message : String(reviseParseError);
        console.warn(`[generateDeckRun] revise output malformed, salvaging pre-revise artifacts: ${parseMsg.slice(0, 300)}`);
        phaseTelemetry.reviseSalvage = {
          reason: "revise_parse_failure",
          errorMessage: parseMsg.slice(0, 500),
          fallbackSource: "author_phase_artifacts",
        };
        // Keep finalPptx, finalPdf, finalManifest from the author phase — they are still valid
        reviseSalvaged = true;
      }

      if (!reviseSalvaged) {
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
        await persistRequestUsage(config, runId, attempt, "critique", "rendered_page_qa", VISUAL_QA_MODEL, [{
          requestId: revisedVisualQa.requestId,
          startedAt: revisedVisualQa.startedAt,
          completedAt: revisedVisualQa.completedAt,
          usage: {
            input_tokens: revisedVisualQa.usage?.input_tokens ?? 0,
            output_tokens: revisedVisualQa.usage?.output_tokens ?? 0,
          },
          stopReason: "end_turn",
        }]);
        rememberRequestIds(anthropicRequestIds, [{
          requestId: revisedVisualQa.requestId,
          startedAt: revisedVisualQa.startedAt,
          completedAt: revisedVisualQa.completedAt,
          usage: {
            input_tokens: revisedVisualQa.usage?.input_tokens ?? 0,
            output_tokens: revisedVisualQa.usage?.output_tokens ?? 0,
          },
          stopReason: "end_turn",
        }]);
        finalVisualQa = revisedVisualQa.report;
        await upsertWorkingPaper(config, runId, "visual_qa_revise", finalVisualQa);
        await persistDeckSpec(config, runId, finalManifest);
      }

      await completePhase(
        config,
        runId,
        attempt,
        "revise",
        {
          issueCount: critiqueIssues.length,
          estimatedCostUsd: spentUsd,
          visualQa: finalVisualQa,
          salvaged: reviseSalvaged,
        },
        revisePhaseUsage,
      );
    }

    currentPhase = "export";
    await markPhase(config, runId, attempt, currentPhase);
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
    let finalDocx = await buildNarrativeDocx({
      run,
      analysis,
      manifest: finalManifest,
    });
    let qaReport = await buildQaReport(
      finalManifest,
      finalPptx,
      finalPdf,
      finalDocx,
      finalVisualQa,
      templateDiagnostics,
    );
    const repairableQaFailures = qaReport.failed.filter((check) =>
      ["pptx_chart_media_present", "pptx_large_image_aspect_fit", "pptx_structural_integrity"].includes(check),
    );
    const blockingQaFailures = qaReport.failed.filter((check) =>
      !["rendered_page_visual_green", "rendered_page_visual_no_revision"].includes(check),
    );

    if (repairableQaFailures.length > 0 && latestContainerId && blockingQaFailures.every((check) => repairableQaFailures.includes(check))) {
      const repairedArtifacts = await repairArtifactsFromQa({
        client,
        systemPrompt,
        latestResponse,
        latestContainerId,
        qaFailures: repairableQaFailures,
        tools: CLAUDE_TOOLS,
      });
      if ((repairedArtifacts.usage.input_tokens ?? 0) > 0 || (repairedArtifacts.usage.output_tokens ?? 0) > 0) {
        spentUsd = roundUsd(spentUsd + usageToCost(MODEL, repairedArtifacts.usage));
        assertDeckSpendWithinBudget(spentUsd);
        continuationCount += repairedArtifacts.pauseTurns;
        phaseTelemetry.exportArtifactRepair = buildPhaseTelemetry(MODEL, {
          usage: repairedArtifacts.usage,
          iterations: repairedArtifacts.iterations,
          pauseTurns: repairedArtifacts.pauseTurns,
          requestIds: repairedArtifacts.requests.map((request) => request.requestId).filter((requestId): requestId is string => Boolean(requestId)),
        });
        await persistRequestUsage(config, runId, attempt, "export", "artifact_repair", MODEL, repairedArtifacts.requests);
        rememberRequestIds(anthropicRequestIds, repairedArtifacts.requests);
      }

      latestResponse = repairedArtifacts;
      latestContainerId = repairedArtifacts.containerId ?? latestContainerId;
      finalManifest = parseManifestResponse(repairedArtifacts.message, repairedArtifacts.files);
      finalPptx = requireGeneratedFile(repairedArtifacts.files, "deck.pptx");
      finalPdf = requireGeneratedFile(repairedArtifacts.files, "deck.pdf");
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
      );
    }

    const finalBlockingQaFailures = qaReport.failed.filter((check) =>
      !["rendered_page_visual_green", "rendered_page_visual_no_revision"].includes(check),
    );
    if (finalBlockingQaFailures.length > 0) {
      throw new Error(`Artifact QA failed: ${finalBlockingQaFailures.join(", ")}`);
    }
    const artifacts = await persistArtifacts(config, run, finalPptx, finalPdf, finalDocx);
    await publishArtifactManifest(config, runId, finalManifest, qaReport, artifacts, templateDiagnostics);
    await finalizeSuccess(config, runId, attempt, spentUsd, qaReport, {
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

    // Best-effort completion email (never blocks or throws)
    const resendApiKey = process.env.RESEND_API_KEY ?? "";
    if (resendApiKey) {
      await notifyRunCompletionIfRequested(
        { supabaseUrl: config.supabaseUrl, serviceKey: config.serviceKey, resendApiKey },
        run,
        { runId, slideCount: finalManifest.slideCount },
      );
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Deck generation failed.";
    const message = sanitizeFailureMessage(rawMessage);
    const failureClass = isTransientProviderError(error) ? "transient_provider" : "permanent";
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
      select: "id,organization_id,project_id,requested_by,brief,business_context,client,audience,objective,thesis,stakes,source_file_ids,template_profile_id,template_diagnostics,active_attempt_id,latest_attempt_id,latest_attempt_number",
      id: `eq.${runId}`,
      limit: "1",
    },
  });

  if (!runs[0]) throw new Error(`Run ${runId} not found.`);
  return runs[0];
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
      select: "id,run_id,attempt_number,status,recovery_reason,failure_phase,failure_message,anthropic_request_ids",
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
  const rows = await fetchRestRows<WorkingPaperRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "working_papers",
    query: {
      select: "paper_type,content,version",
      run_id: `eq.${runId}`,
      paper_type: "eq.analysis_result",
      order: "version.desc",
      limit: "1",
    },
  }).catch(() => []);

  const content = rows[0]?.content;
  if (!content) {
    return null;
  }

  try {
    const parsed = analysisSchema.parse(content);
    enforceAnalysisExhibitRules(parsed);
    return parsed;
  } catch {
    return null;
  }
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
        version: 1,
      },
    ],
  });
}

async function markPhase(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  phase: DeckPhase,
) {
  const now = new Date().toISOString();
  await Promise.all([
    patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: { id: `eq.${runId}` },
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
  await patchRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: { id: `eq.${runId}` },
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
    },
  }).catch(() => {});
  await insertEvent(config, runId, attempt, phase, "phase_completed", payload, usage);
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
  await persistRequestUsage(input.config, input.runId, input.attempt, "export", "rendered_page_qa_final", FINAL_VISUAL_QA_MODEL, [{
    requestId: finalVisualQa.requestId,
    startedAt: finalVisualQa.startedAt,
    completedAt: finalVisualQa.completedAt,
    usage: {
      input_tokens: finalVisualQa.usage?.input_tokens ?? 0,
      output_tokens: finalVisualQa.usage?.output_tokens ?? 0,
    },
    stopReason: "end_turn",
  }]);
  rememberRequestIds(input.anthropicRequestIds, [{
    requestId: finalVisualQa.requestId,
    startedAt: finalVisualQa.startedAt,
    completedAt: finalVisualQa.completedAt,
    usage: {
      input_tokens: finalVisualQa.usage?.input_tokens ?? 0,
      output_tokens: finalVisualQa.usage?.output_tokens ?? 0,
    },
    stopReason: "end_turn",
  }]);

  return finalVisualQa.report;
}

async function finalizeSuccess(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext,
  estimatedCostUsd: number,
  qaReport: Record<string, unknown>,
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
  await Promise.all([
    patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_run_attempts",
      query: { id: `eq.${attempt.id}` },
      payload: {
        status: "completed",
        updated_at: now,
        completed_at: now,
        cost_telemetry: attemptCostTelemetry,
        anthropic_request_ids: extraTelemetry.anthropicRequestIds ?? [],
      },
    }),
    patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: { id: `eq.${runId}` },
      payload: {
        status: "completed",
        current_phase: "export",
        updated_at: now,
        completed_at: now,
        delivery_status: qaReport.tier === "green" ? "reviewed" : "degraded",
        cost_telemetry: runCostTelemetry,
        active_attempt_id: null,
        latest_attempt_id: attempt.id,
        latest_attempt_number: attempt.attemptNumber,
        successful_attempt_id: attempt.id,
      },
    }),
  ]);
}

async function finalizeFailure(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  attempt: AttemptContext | null,
  failurePhase: DeckPhase,
  failureMessage: string,
  extraTelemetry: Record<string, unknown>,
) {
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
    patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: { id: `eq.${runId}` },
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
    }),
  ];

  if (attempt) {
    writes.push(
      patchRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "deck_run_attempts",
        query: { id: `eq.${attempt.id}` },
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

function buildUnderstandMessage(
  run: RunRow,
  uploadedEvidence: Array<{ id: string; filename: string }>,
  uploadedTemplate: { id: string; filename: string } | null,
  questionRoutes: Array<{ id: string; name: string; diagnosticMotifs: string[]; recommendationLevers: string[] }>,
) {
  const briefSummary = buildGenerationBrief(run);
  const routeContext = questionRoutes.length > 0
    ? `- Detected analytical question: ${questionRoutes[0].name}. Check for these diagnostic motifs: ${questionRoutes[0].diagnosticMotifs.join(", ") || "none specific"}. Recommended levers: ${questionRoutes[0].recommendationLevers.join(", ") || "general"}.`
    : "";
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...uploadedEvidence.map((file) => ({ type: "container_upload" as const, file_id: file.id })),
    ...(uploadedTemplate ? [{ type: "container_upload" as const, file_id: uploadedTemplate.id }] : []),
    {
      type: "text",
      text: [
        "Analyze the uploaded evidence package and return only the analysis JSON for the deck plan.",
        "",
        briefSummary,
        "",
        "- Use code execution to inspect the uploaded files directly.",
        "- Follow the NIQ Analyst Playbook from the system prompt: recognize Italian column names, compute ALL applicable derivatives (growth, share, price index, mix gap) before forming findings, and detect diagnostic motifs.",
        "- Frame the analysis around the TRUE commercial question, not a generic summary. Classify each finding as connection, contradiction, or curiosity.",
        "- Recommendations must be traceable to the data in this run. Do not invent geographies, channels, or opportunities that are not directly supported by the evidence.",
        "- If the brief is about promotions, benchmark the focal brand against key competitors and call out what others are doing, not only what the focal brand is doing.",
        "- Structure the executive storyline as SCQA (Situation/Complication/Question/Answer). Default DEDUCTIVE: the answer goes on slide 2.",
        "- Choose exhibit types per the exhibit selection rules. NEVER use a line chart for 2-period CY vs PY data.",
        ...(routeContext ? [routeContext] : []),
        "- Inspect only the workbook regions needed to answer the brief. Do not spend time on exhaustive profiling of every tab if it is not necessary.",
        "- Compute deterministic facts in Python and produce a concise executive storyline.",
        "- Plan a consulting-grade deck between 8 and 12 slides unless the brief strongly requires fewer or the evidence clearly needs more.",
        `- Every planned slide must use a slideArchetype chosen from: ${APPROVED_ARCHETYPES.join(", ")}.`,
        "- Recommend charts only when they materially improve the argument.",
        "- Your final response must be valid JSON matching the requested schema, not prose.",
        "- Use the same language as the brief. Do not emit mixed-language output.",
      ].join("\n"),
    },
  ];

  return { role: "user" as const, content };
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
  analysis: z.infer<typeof analysisSchema>,
  files?: {
    uploadedEvidence: Array<{ id: string; filename: string }>;
    uploadedTemplate: { id: string; filename: string } | null;
  },
) {
  return {
    role: "user" as const,
    content: [
      ...(files?.uploadedEvidence.map((file) => ({ type: "container_upload" as const, file_id: file.id })) ?? []),
      ...(files?.uploadedTemplate ? [{ type: "container_upload" as const, file_id: files.uploadedTemplate.id }] : []),
      {
        type: "text" as const,
        text: [
          "Using the evidence files already available in the current container and the approved analysis below, generate the final consulting-grade deck artifacts.",
          "",
          buildGenerationBrief(run),
          "",
          `Approved analysis JSON:\n${JSON.stringify(analysis, null, 2)}`,
          "",
          "- Reuse the existing container state and uploaded files. Do not restart with exhaustive workbook discovery.",
          "- Recalculate only the facts needed to render the promised slides and charts accurately.",
          "- Follow the approved slide plan unless a small factual adjustment is necessary for correctness.",
          "- Follow the loaded pptx skill for the deck artifact generation.",
          "- Generate charts as high-resolution PNG assets in Python and insert them as images.",
          "- Do not use native PowerPoint chart objects for critical visuals.",
          "- Match every chart canvas to its target slot aspect ratio. Never stretch chart images in the final deck.",
          "- Before rendering any chart, check category label lengths: if average > 12 chars or count > 8, use horizontal bars or aggregate. Always call plt.tight_layout() before savefig().",
          "- If a chart is sparse, leader-dominated, or near-zero outside one segment, switch to a split or commentary-led slide instead of forcing a wide chart.",
          "- Numeric labels must be clean: + exactly once for positives, - for negatives, and pp labels like +0.09pp with no doubled symbols.",
          "- If a slide headline or commentary claims growth, expansion, or acceleration in a metric, the exhibit must show the change in that metric, not just its current level.",
          "- If a slide promises a comparison set with an explicit count such as 4 provinces, 3 channels, or 5 segments, cover all of them explicitly or change the claim.",
          "- Recommendations must stay inside the proven evidence. Do not elevate a country, region, or lever unless the supporting chart or table clearly makes it one of the strongest opportunities.",
          "- Apply the copywriting voice rules from the NIQ Analyst Playbook: no em dashes, no AI slop patterns, numbers first, active voice, every sentence carries information.",
          "- Slide titles must state the insight with at least one number, max 14 words. Charts are the hero (60%+ of slide area). Quantify all recommendations with FMCG levers.",
          "- Generate and attach these files exactly: `deck.pptx`, `deck.pdf`, and `deck_manifest.json`.",
          "- `deck_manifest.json` must contain `slideCount`, `pageCount`, `slides[]`, and `charts[]` describing the final deck.",
          "- Each slide entry in the manifest must include `position`, `layoutId`, `slideArchetype`, `title`, and `chartId` when applicable.",
          "- Your final assistant message must attach the files as container uploads before finishing.",
        ].join("\n"),
      },
    ],
  };
}

function buildReviseMessage(issues: string[]) {
  return {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: [
          "Repair the generated deck and regenerate deck.pptx, deck.pdf, and deck_manifest.json.",
          "Reuse the existing container state and the prior authoring context. Do not start a new draft from scratch unless necessary to fix the issues.",
          "Fix these issues:",
          ...issues.map((issue) => `- ${issue}`),
          "",
          "Do not widen the deck. Improve the weak slides and keep the deck consulting-grade.",
          "Apply the copywriting voice rules from the system prompt when rewriting any text: no em dashes, numbers first, active voice, insight titles not topic labels.",
          "Use Arial for all dense text and card internals unless the uploaded template explicitly forces another safe font.",
          "Do not use stacked ordinals, narrow title boxes, or floating footer metrics that can drift across PowerPoint, Keynote, and Google Slides.",
          "Fix any stretched charts by re-rendering them at the correct slot ratio rather than scaling the old image.",
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

export function isTransientProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const name = error.name?.toLowerCase() ?? "";

  // Anthropic overloaded / rate limit
  if (msg.includes("overloaded") || msg.includes("overloaded_error")) return true;
  if (msg.includes("rate_limit") || msg.includes("rate limit")) return true;

  // HTTP status codes
  if (/\b(429|529|502|503|504)\b/.test(msg)) return true;

  // Stream / connection failures
  if (msg.includes("stream ended") || msg.includes("did not return")) return true;
  if (msg.includes("connection") && (msg.includes("reset") || msg.includes("refused") || msg.includes("closed"))) return true;
  if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("etimedout")) return true;
  if (name.includes("fetcherror") || name.includes("aborterror")) return true;

  // Anthropic SDK error types
  if ("status" in error) {
    const status = (error as { status?: number }).status;
    if (status && [429, 502, 503, 504, 529].includes(status)) return true;
  }

  return false;
}

async function runClaudeLoop(input: {
  client: Anthropic;
  systemPrompt: string | Array<Anthropic.Beta.BetaTextBlockParam>;
  maxTokens: number;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaToolUnion[];
  container?: Anthropic.Beta.BetaContainerParams;
  outputConfig?: Anthropic.Beta.BetaOutputConfig;
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

  for (let iteration = 0; iteration < 8; iteration += 1) {
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
      try {
        const stream = input.client.beta.messages.stream(streamBody);
        requestId = stream.request_id ?? null;
        message = await stream.finalMessage();
        lastTransientError = null;
        break;
      } catch (streamError) {
        requestId = null;
        if (isTransientProviderError(streamError) && retry < TRANSIENT_RETRY_DELAYS_MS.length) {
          lastTransientError = streamError instanceof Error ? streamError : new Error(String(streamError));
          const baseDelay = TRANSIENT_RETRY_DELAYS_MS[retry];
          const jitter = Math.round(Math.random() * baseDelay * 0.3);
          console.warn(
            `[runClaudeLoop] transient error (retry ${retry + 1}/${TRANSIENT_RETRY_DELAYS_MS.length}): ${lastTransientError.message.slice(0, 200)}. Waiting ${baseDelay + jitter}ms...`,
          );
          // Record the failed request for telemetry even though it didn't complete
          requests.push({
            requestId: null,
            startedAt,
            completedAt: new Date().toISOString(),
            usage: { input_tokens: 0, output_tokens: 0 },
            stopReason: `transient_retry_${retry + 1}`,
          });
          await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
          continue;
        }
        throw streamError;
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
    requests.push({
      requestId,
      startedAt,
      completedAt,
      usage: {
        input_tokens: finalMessage.usage?.input_tokens ?? 0,
        output_tokens: finalMessage.usage?.output_tokens ?? 0,
      },
      stopReason: finalMessage.stop_reason ?? null,
    });

    collectGeneratedFileIds(finalMessage.content).forEach((fileId) => fileIds.add(fileId));

    if (finalMessage.stop_reason !== "pause_turn") {
      break;
    }

    pauseTurns += 1;
    messages = appendAssistantTurn(messages, finalMessage);
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

function buildMissingArtifactRepairMessage(phaseLabel: "author" | "revise", missingFiles: string[]) {
  return {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: [
          `The ${phaseLabel} step finished without attaching all required output files.`,
          `Missing files: ${missingFiles.join(", ")}.`,
          "Stay in the current container state. Do not restart from scratch.",
          "Attach the missing files now as real container uploads.",
          "Required outputs are exactly: deck.pptx, deck.pdf, and deck_manifest.json.",
          "Your next assistant message must include the missing files before finishing.",
        ].join("\n"),
      },
    ],
  };
}

function listMissingGeneratedFiles(files: GeneratedFile[], requiredFiles: string[]) {
  return requiredFiles.filter((fileName) => !files.some((file) => file.fileName === fileName || file.fileName.endsWith(fileName)));
}

async function recoverMissingArtifacts(input: {
  client: Anthropic;
  systemPrompt: string | Array<Anthropic.Beta.BetaTextBlockParam>;
  baseResponse: Awaited<ReturnType<typeof runClaudeLoop>>;
  phaseLabel: "author" | "revise";
  requiredFiles: string[];
  tools: Anthropic.Beta.BetaToolUnion[];
  containerFallback?: Anthropic.Beta.BetaContainerParams;
}) {
  let response = input.baseResponse;
  let files = await downloadGeneratedFiles(input.client, response.fileIds);
  const usage: Required<ClaudeUsage> = {
    input_tokens: 0,
    output_tokens: 0,
  };
  let pauseTurns = 0;
  let iterations = 0;
  const requests: ClaudeRequestUsage[] = [];

  for (let attempt = 0; attempt < 1; attempt += 1) {
    const missingFiles = listMissingGeneratedFiles(files, input.requiredFiles);
    if (missingFiles.length === 0) {
      return { response, files, usage, pauseTurns, iterations, requests };
    }

    const repairResponse = await runClaudeLoop({
      client: input.client,
      systemPrompt: input.systemPrompt,
      maxTokens: 4_096,
      container: response.containerId
        ? { id: response.containerId }
        : input.containerFallback,
      messages: [...response.thread, buildMissingArtifactRepairMessage(input.phaseLabel, missingFiles)],
      tools: input.tools,
      outputConfig: {
        effort: "medium",
      },
    });

    usage.input_tokens += repairResponse.usage.input_tokens ?? 0;
    usage.output_tokens += repairResponse.usage.output_tokens ?? 0;
    pauseTurns += repairResponse.pauseTurns;
    iterations += repairResponse.iterations;
    requests.push(...repairResponse.requests);
    response = repairResponse;
    files = await downloadGeneratedFiles(input.client, response.fileIds);
  }

  return { response, files, usage, pauseTurns, iterations, requests };
}

function buildArtifactRepairMessage(qaFailures: string[]) {
  return {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: [
          "The generated deck artifacts failed export validation.",
          "Regenerate the deck artifacts cleanly in the current container state.",
          "Fix these artifact QA failures:",
          ...qaFailures.map((failure) => `- ${failure}`),
          "",
          "Requirements:",
          "- Regenerate deck.pptx, deck.pdf, and deck_manifest.json.",
          "- Keep the same business story unless a small factual correction is necessary.",
          "- Ensure every chart is embedded as raster media in the PPTX and survives opening in PowerPoint without repair warnings.",
          "- Ensure chart image frames match the underlying image aspect ratio; do not stretch a chart to fill a wider box.",
          "- If a slide layout is causing a stretched chart, change the slide grammar instead of scaling the image.",
          "- Attach the regenerated files as real container uploads before finishing.",
        ].join("\n"),
      },
    ],
  };
}

async function repairArtifactsFromQa(input: {
  client: Anthropic;
  systemPrompt: string | Array<Anthropic.Beta.BetaTextBlockParam>;
  latestResponse: Awaited<ReturnType<typeof runClaudeLoop>>;
  latestContainerId: string;
  qaFailures: string[];
  tools: Anthropic.Beta.BetaToolUnion[];
}) {
  const response = await runClaudeLoop({
    client: input.client,
    systemPrompt: input.systemPrompt,
    maxTokens: 4_096,
    container: { id: input.latestContainerId },
    messages: [...input.latestResponse.thread, buildArtifactRepairMessage(input.qaFailures)],
    tools: input.tools,
    outputConfig: {
      effort: "medium",
    },
  });
  const files = await downloadGeneratedFiles(input.client, response.fileIds);
  return { ...response, files };
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
    `Structured brief: ${JSON.stringify(briefRecord, null, 2)}`,
  ].join("\n");
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

function collectManifestIssues(manifest: z.infer<typeof deckManifestSchema>) {
  const issues: string[] = [];
  const chartIds = new Set(manifest.charts.map((chart) => chart.id));
  const chartById = new Map(manifest.charts.map((chart) => [chart.id, chart]));
  if (manifest.slideCount <= 0) issues.push("Manifest has zero slides.");
  if (manifest.slideCount !== manifest.slides.length) issues.push("Manifest slideCount does not match slides[].");
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
  for (const slide of manifest.slides) {
    const countClaimIssue = detectExplicitCoverageMismatch(slide);
    if (countClaimIssue) {
      issues.push(`Slide ${slide.position} ${countClaimIssue}`);
    }
    const chart = slide.chartId ? chartById.get(slide.chartId) : null;
    const claimExhibitIssue = detectClaimExhibitMismatch(slide, chart?.title ?? "");
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
  chartTitle: string,
) {
  const copy = `${slide.title} ${slide.subtitle ?? ""} ${slide.body ?? ""} ${(slide.bullets ?? []).join(" ")}`.toLowerCase();
  const chart = chartTitle.toLowerCase();
  const claimsDistributionChange =
    /(distribution|distribuzion)/.test(copy) &&
    /(grow|grows|grew|increase|expanded|espand|cresc|acceler)/.test(copy);
  const chartShowsDistributionLevel =
    /(distribution|distribuzion)/.test(chart) &&
    !( /(change|delta|variation|variazione|vs|yoy|py|pp)/.test(chart));

  if (claimsDistributionChange && chartShowsDistributionLevel) {
    return "claims a distribution change, but the linked chart title suggests current distribution level rather than a change metric.";
  }

  return "";
}

function collectCritiqueIssues(
  manifest: z.infer<typeof deckManifestSchema>,
  visualQa: RenderedPageQaReport,
) {
  const issues = [...collectManifestIssues(manifest)];

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

  return issues;
}

async function buildQaReport(
  manifest: z.infer<typeof deckManifestSchema>,
  pptx: GeneratedFile,
  pdf: GeneratedFile,
  docx: GeneratedFile,
  visualQa: RenderedPageQaReport,
  templateDiagnostics: TemplateDiagnostics,
) {
  const checks = [
    { name: "pptx_present", passed: pptx.buffer.length > 0, detail: `${pptx.buffer.length} bytes` },
    { name: "pdf_present", passed: pdf.buffer.length > 0, detail: `${pdf.buffer.length} bytes` },
    { name: "docx_present", passed: docx.buffer.length > 0, detail: `${docx.buffer.length} bytes` },
    { name: "slide_count_positive", passed: manifest.slideCount > 0, detail: `${manifest.slideCount} slides` },
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
  pptx: GeneratedFile,
  pdf: GeneratedFile,
  docx: GeneratedFile,
) {
  const items = [
    { kind: "pptx", fileName: "deck.pptx", mimeType: pptx.mimeType || "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: pptx.buffer },
    { kind: "pdf", fileName: "deck.pdf", mimeType: pdf.mimeType || "application/pdf", buffer: pdf.buffer },
    { kind: "docx", fileName: "report.docx", mimeType: docx.mimeType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx.buffer },
  ] as const;

  const artifacts = [];

  for (const item of items) {
    const storagePath = `${run.id}/${item.fileName}`;
    await uploadToStorage({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: "artifacts",
      storagePath,
      body: item.buffer,
      contentType: item.mimeType,
    });

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

  return artifacts;
}

async function publishArtifactManifest(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  manifest: z.infer<typeof deckManifestSchema>,
  qaReport: Record<string, unknown>,
  artifacts: Array<Record<string, unknown>>,
  templateDiagnostics: TemplateDiagnostics,
) {
  await upsertRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "artifact_manifests_v2",
    onConflict: "run_id",
    rows: [
      {
        run_id: runId,
        slide_count: manifest.slideCount,
        page_count: manifest.pageCount ?? manifest.slideCount,
        qa_passed: qaReport.tier === "green",
        qa_report: {
          ...qaReport,
          template: templateDiagnostics,
        },
        artifacts,
        published_at: new Date().toISOString(),
      },
    ],
  });
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
