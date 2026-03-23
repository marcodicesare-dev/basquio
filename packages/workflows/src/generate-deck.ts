import { createHash, randomUUID } from "node:crypto";

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

import { parseEvidencePackage } from "@basquio/data-ingest";
import { listArchetypeIds, validateSlotConstraints } from "@basquio/scene-graph/slot-archetypes";
import { createSystemTemplateProfile, interpretTemplateSource } from "@basquio/template-engine";
import type { TemplateProfile } from "@basquio/types";

import { assertDeckSpendWithinBudget, enforceDeckBudget, roundUsd, usageToCost } from "./cost-guard";
import { renderedPageQaSchema, runRenderedPageQa } from "./rendered-page-qa";
import { buildBasquioSystemPrompt } from "./system-prompt";
import { deleteRestRows, downloadFromStorage, fetchRestRows, patchRestRows, upsertRestRows, uploadToStorage } from "./supabase";

const MODEL = "claude-sonnet-4-6";
const VISUAL_QA_MODEL = "claude-haiku-4-5";
const FILES_BETA = "files-api-2025-04-14";
const CODE_EXEC_BETA = "code-execution-2025-08-25";
const SKILLS_BETA = "skills-2025-10-02";
const BETAS = [FILES_BETA, CODE_EXEC_BETA, SKILLS_BETA] as const;
const CLAUDE_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: "code_execution_20250825", name: "code_execution" },
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

const manifestSchema = z.object({
  slideCount: z.number().int().min(1),
  pageCount: z.number().int().min(0).optional(),
  slides: z.array(z.object({
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
    chartId: z.string().optional(),
  })).default([]),
  charts: z.array(z.object({
    id: z.string(),
    chartType: z.string(),
    title: z.string(),
    sourceNote: z.string().optional(),
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
  template_profile_id: string | null;
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

type ParsedDatasetProfile = Awaited<ReturnType<typeof parseEvidencePackage>>["datasetProfile"];
type DeckPhase = "normalize" | "understand" | "author" | "critique" | "revise" | "export";
type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
};
type RenderedPageQaReport = z.infer<typeof renderedPageQaSchema>;

const ANALYSIS_JSON_SHAPE = {
  language: "English",
  thesis: "One-sentence overall conclusion",
  executiveSummary: "Short executive summary paragraph",
  slidePlan: [
    {
      position: 1,
      layoutId: "title-body",
      slideArchetype: "title-body",
      title: "Insight-led slide title with a number when supported",
      subtitle: "Optional subtitle",
      body: "Optional short body copy",
      bullets: ["Optional bullet", "Optional bullet"],
      metrics: [
        {
          label: "Sales",
          value: "+12.4%",
          delta: "+2.1 pts vs YA",
        },
      ],
      callout: {
        text: "Optional callout",
        tone: "accent",
      },
      evidenceIds: ["sheet:summary"],
      chart: {
        id: "chart-1",
        chartType: "bar",
        title: "Chart title",
        sourceNote: "Source note",
      },
    },
  ],
} as const;

const ANALYSIS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    language: { type: "string" },
    thesis: { type: "string" },
    executiveSummary: { type: "string" },
    slidePlan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
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
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                value: { type: "string" },
                delta: { type: "string" },
              },
              required: ["label", "value"],
            },
          },
          callout: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string" },
              tone: { type: "string", enum: ["accent", "green", "orange"] },
            },
            required: ["text"],
          },
          evidenceIds: {
            type: "array",
            items: { type: "string" },
          },
          chart: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              chartType: { type: "string" },
              title: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["id", "chartType", "title"],
          },
        },
        required: ["position", "layoutId", "slideArchetype", "title"],
      },
    },
  },
  required: ["language", "thesis", "executiveSummary", "slidePlan"],
} as const;

export async function generateDeckRun(runId: string) {
  const config = resolveConfig();
  const client = new Anthropic({
    apiKey: config.anthropicApiKey,
    maxRetries: 2,
    timeout: 15 * 60 * 1000,
  });

  let spentUsd = 0;
  let currentPhase: DeckPhase = "normalize";
  const phaseTelemetry: Record<string, unknown> = {};
  let continuationCount = 0;

  try {
    const run = await loadRun(config, runId);
    const sourceFiles = await loadSourceFiles(config, run.source_file_ids);
    const persistedTemplate = await loadTemplateProfileRow(config, run.template_profile_id);
    const templateSourceFileId = persistedTemplate?.source_file_id ?? null;
    const templateFile =
      sourceFiles.find((file) => file.id === templateSourceFileId) ??
      sourceFiles.find((file) => file.kind === "pptx" || file.kind === "brand-tokens");
    const evidenceFiles = sourceFiles.filter((file) => file.id !== templateFile?.id);

    currentPhase = "normalize";
    await markPhase(config, runId, currentPhase);

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

    await persistEvidenceWorkspace(config, run, parsed, templateProfile);
    await upsertWorkingPaper(config, runId, "execution_brief", {
      brief: run.brief,
      fileInventory: parsed.datasetProfile.manifest ?? {},
      templateProfile,
    });
    await completePhase(config, runId, "normalize", {
      fileCount: parsed.datasetProfile.sourceFiles.length,
      sheetCount: parsed.datasetProfile.sheets.length,
    });

    currentPhase = "understand";
    await markPhase(config, runId, currentPhase);

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

    const understandMessage = buildUnderstandMessage(
      run,
      summarizeDatasetProfile(parsed.datasetProfile),
      templateProfile,
      uploadedEvidence,
      uploadedTemplate,
    );
    await recordToolCall(config, runId, "understand", "code_execution", {
      model: MODEL,
      tools: ["code_execution"],
      skills: [],
      stepNumber: 1,
    });
    await enforceDeckBudget({
      client,
      model: MODEL,
      betas: [...BETAS],
      spentUsd,
      outputTokenBudget: 24_000,
      body: {
        system: systemPrompt,
        messages: [understandMessage],
        tools: CLAUDE_TOOLS,
        output_config: {
          format: {
            type: "json_schema",
            schema: ANALYSIS_OUTPUT_SCHEMA,
          },
        },
      },
    });

    const understandResponse = await runClaudeLoop({
      client,
      systemPrompt,
      maxTokens: 4_096,
      messages: [understandMessage],
      tools: CLAUDE_TOOLS,
      outputConfig: {
        format: {
          type: "json_schema",
          schema: ANALYSIS_OUTPUT_SCHEMA,
        },
      },
    });
    spentUsd = roundUsd(spentUsd + usageToCost(MODEL, understandResponse.usage));
    assertDeckSpendWithinBudget(spentUsd);
    continuationCount += understandResponse.pauseTurns;
    phaseTelemetry.understand = buildPhaseTelemetry(MODEL, understandResponse);

    const containerId = understandResponse.containerId;
    const understandFiles = await downloadGeneratedFiles(client, understandResponse.fileIds);
    const analysis = parseAnalysisResponse(understandResponse.message, understandFiles);
    const understandThread = understandResponse.thread;
    await upsertWorkingPaper(config, runId, "analysis_result", analysis);
    await upsertWorkingPaper(config, runId, "deck_plan", { slidePlan: analysis.slidePlan });
    await completePhase(config, runId, "understand", {
      containerId,
      slideCount: analysis.slidePlan.length,
      estimatedCostUsd: spentUsd,
    }, understandResponse.usage);

    currentPhase = "author";
    await markPhase(config, runId, currentPhase);

    const authorMessage = buildAuthorMessage(run, analysis, templateProfile);
    const authorMessages = [...understandThread, authorMessage];
    await recordToolCall(config, runId, "author", "code_execution", {
      model: MODEL,
      tools: ["code_execution"],
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
        messages: authorMessages,
        tools: CLAUDE_TOOLS,
      },
    });

    const authorResponse = await runClaudeLoop({
      client,
      systemPrompt,
      maxTokens: 8_192,
      container: {
        id: containerId,
        skills: [
          { type: "anthropic", skill_id: "pptx", version: "latest" },
          { type: "anthropic", skill_id: "pdf", version: "latest" },
        ],
      },
      messages: authorMessages,
      tools: CLAUDE_TOOLS,
    });
    spentUsd = roundUsd(spentUsd + usageToCost(MODEL, authorResponse.usage));
    assertDeckSpendWithinBudget(spentUsd);
    continuationCount += authorResponse.pauseTurns;
    phaseTelemetry.author = buildPhaseTelemetry(MODEL, authorResponse);

    const authorFiles = await downloadGeneratedFiles(client, authorResponse.fileIds);
    const manifestFile = requireGeneratedFile(authorFiles, "deck_manifest.json");
    const pptxFile = requireGeneratedFile(authorFiles, "deck.pptx");
    const pdfFile = requireGeneratedFile(authorFiles, "deck.pdf");
    let manifest = manifestSchema.parse(JSON.parse(manifestFile.buffer.toString("utf8")));

    await persistDeckSpec(config, runId, manifest);
    await completePhase(config, runId, "author", {
      slideCount: manifest.slideCount,
      chartCount: manifest.charts.length,
      estimatedCostUsd: spentUsd,
    }, authorResponse.usage);

    currentPhase = "critique";
    await markPhase(config, runId, currentPhase);
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
    await upsertWorkingPaper(config, runId, "visual_qa_author", initialVisualQa.report);
    const critiqueIssues = collectCritiqueIssues(manifest, initialVisualQa.report);
    await completePhase(
      config,
      runId,
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
      await markPhase(config, runId, currentPhase);
      const reviseMessage = buildReviseMessage(critiqueIssues);
      const reviseMessages = [...authorResponse.thread, reviseMessage];
      await recordToolCall(config, runId, "revise", "code_execution", {
        model: MODEL,
        tools: ["code_execution"],
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
        },
      });

      const reviseResponse = await runClaudeLoop({
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
      });
      spentUsd = roundUsd(spentUsd + usageToCost(MODEL, reviseResponse.usage));
      assertDeckSpendWithinBudget(spentUsd);
      continuationCount += reviseResponse.pauseTurns;
      phaseTelemetry.revise = buildPhaseTelemetry(MODEL, reviseResponse);

      const reviseFiles = await downloadGeneratedFiles(client, reviseResponse.fileIds);
      finalManifest = manifestSchema.parse(
        JSON.parse(requireGeneratedFile(reviseFiles, "deck_manifest.json").buffer.toString("utf8")),
      );
      finalPptx = requireGeneratedFile(reviseFiles, "deck.pptx");
      finalPdf = requireGeneratedFile(reviseFiles, "deck.pdf");
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
      finalVisualQa = revisedVisualQa.report;
      await upsertWorkingPaper(config, runId, "visual_qa_revise", finalVisualQa);
      await persistDeckSpec(config, runId, finalManifest);
      await completePhase(
        config,
        runId,
        "revise",
        {
          issueCount: critiqueIssues.length,
          estimatedCostUsd: spentUsd,
          visualQa: finalVisualQa,
        },
        reviseResponse.usage,
      );
    }

    currentPhase = "export";
    await markPhase(config, runId, currentPhase);
    const qaReport = await buildQaReport(finalManifest, finalPptx, finalPdf, finalVisualQa);
    if (!qaReport.passed) {
      throw new Error(`Artifact QA failed: ${qaReport.failed.join(", ")}`);
    }
    const artifacts = await persistArtifacts(config, run, finalPptx, finalPdf);
    await publishArtifactManifest(config, runId, finalManifest, qaReport, artifacts);
    await finalizeSuccess(config, runId, spentUsd, qaReport, {
      phases: phaseTelemetry,
      continuationCount,
    });
    await completePhase(config, runId, "export", {
      artifactCount: artifacts.length,
      estimatedCostUsd: spentUsd,
      qaTier: qaReport.tier,
      visualQa: finalVisualQa,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deck generation failed.";
    await finalizeFailure(config, runId, currentPhase, message).catch(() => {});
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
      select: "id,organization_id,project_id,requested_by,brief,business_context,client,audience,objective,thesis,stakes,source_file_ids,template_profile_id",
      id: `eq.${runId}`,
      limit: "1",
    },
  });

  if (!runs[0]) throw new Error(`Run ${runId} not found.`);
  return runs[0];
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
  phase: DeckPhase,
) {
  const now = new Date().toISOString();
  await patchRestRows({
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
    },
  });
  await insertEvent(config, runId, phase, "phase_started", {});
}

async function completePhase(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  phase: DeckPhase,
  payload: Record<string, unknown>,
  usage?: ClaudeUsage | null,
) {
  await insertEvent(config, runId, phase, "phase_completed", payload, usage);
}

async function finalizeSuccess(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  estimatedCostUsd: number,
  qaReport: Record<string, unknown>,
  extraTelemetry: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  await patchRestRows({
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
      cost_telemetry: {
        model: MODEL,
        estimatedCostUsd,
        qaTier: qaReport.tier,
        ...extraTelemetry,
      },
    },
  });
}

async function finalizeFailure(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  failurePhase: DeckPhase,
  failureMessage: string,
) {
  await patchRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: { id: `eq.${runId}` },
    payload: {
      status: "failed",
      failure_message: failureMessage,
      failure_phase: failurePhase,
      updated_at: new Date().toISOString(),
      delivery_status: "failed",
    },
  });
  await insertEvent(config, runId, failurePhase, "error", { message: failureMessage });
}

async function insertEvent(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
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
  phase: DeckPhase,
  toolName: string,
  payload: Record<string, unknown>,
) {
  const stepNumber = typeof payload.stepNumber === "number" ? payload.stepNumber : undefined;
  await insertEvent(
    config,
    runId,
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

function appendAssistantTurn(
  messages: Anthropic.Beta.BetaMessageParam[],
  message: Anthropic.Beta.BetaMessage,
): Anthropic.Beta.BetaMessageParam[] {
  return [
    ...messages,
    {
      role: "assistant",
      content: message.content as Anthropic.Beta.BetaContentBlockParam[],
    },
  ];
}

function buildUnderstandMessage(
  run: RunRow,
  datasetProfile: Record<string, unknown>,
  templateProfile: TemplateProfile,
  uploadedEvidence: Array<{ id: string; filename: string }>,
  uploadedTemplate: { id: string; filename: string } | null,
) {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...uploadedEvidence.map((file) => ({ type: "container_upload" as const, file_id: file.id })),
    ...(uploadedTemplate ? [{ type: "container_upload" as const, file_id: uploadedTemplate.id }] : []),
    {
      type: "text",
      text: [
        "Analyze the uploaded evidence package and create a machine-readable analysis plan for a consulting-grade deck.",
        "",
        "Return only valid JSON matching this shape:",
        JSON.stringify(ANALYSIS_JSON_SHAPE, null, 2),
        "",
        `Brief: ${JSON.stringify(run.brief ?? {}, null, 2)}`,
        `Dataset inventory: ${JSON.stringify(datasetProfile, null, 2)}`,
        `Template profile summary: ${JSON.stringify({
          templateName: templateProfile.templateName,
          colors: templateProfile.colors,
          fonts: templateProfile.fonts,
          layoutIds: templateProfile.layouts.map((layout) => layout.id),
        }, null, 2)}`,
        "",
        "Rules:",
        "- Use code execution to inspect the uploaded files directly.",
        "- Keep slide count between 8 and 14.",
        `- Every slidePlan item must include slideArchetype chosen from: ${APPROVED_ARCHETYPES.join(", ")}.`,
        "- slideArchetype is the visual grammar contract. layoutId is the implementation layout or template binding.",
        "- Every title must be an insight.",
        "- Prefer concrete numbers in titles when the data supports them.",
        "- Do not emit mixed-language output.",
        "- The final assistant message must be valid JSON only, with no prose before or after it.",
        "- Also save the same JSON as a file named exactly `basquio_analysis.json` and attach it if convenient, but the message JSON is the required output contract.",
      ].join("\n"),
    },
  ];

  return { role: "user" as const, content };
}

function buildAuthorMessage(
  run: RunRow,
  analysis: z.infer<typeof analysisSchema>,
  templateProfile: TemplateProfile,
) {
  return {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: [
          "Create the final consulting-grade deck now.",
          "Reuse the prior analysis turn and the current container state. Do not restart the analysis from scratch.",
          "",
          "You must generate and attach these files exactly:",
          "- deck.pptx",
          "- deck.pdf",
          "- deck_manifest.json",
          "",
          "Use the same slide order and arguments from this analysis:",
          JSON.stringify(analysis, null, 2),
          "",
          "Honor each slide's slideArchetype from the analysis plan. Do not swap to a different archetype unless the original one is impossible with the template.",
          "",
          "Template profile:",
          JSON.stringify({
            templateName: templateProfile.templateName,
            slideSize: templateProfile.slideSize,
            slideWidthInches: templateProfile.slideWidthInches,
            slideHeightInches: templateProfile.slideHeightInches,
            palette: templateProfile.brandTokens?.palette,
            typography: templateProfile.brandTokens?.typography,
            layouts: templateProfile.layouts.map((layout) => ({
              id: layout.id,
              name: layout.name,
              regions: layout.regions,
            })),
          }, null, 2),
          "",
          "Manifest rules:",
          "- deck_manifest.json must contain slideCount, pageCount, slides[], charts[].",
          "- slides[] must describe the final deck, not the draft plan.",
          `- every slide in slides[] must include slideArchetype chosen from: ${APPROVED_ARCHETYPES.join(", ")}.`,
          "- charts[] must only include charts that actually appear in the final deck.",
          "",
          "Quality rules:",
          "- No placeholder boxes.",
          "- No generic AI filler language.",
          "- No empty chart areas.",
          "- Same language as the brief.",
          "- The design must feel premium, editorial, and current; avoid generic 2005-style PowerPoint aesthetics.",
          "- Prefer a dark editorial canvas, restrained card surfaces, and sparse accent lines unless the uploaded template clearly requires another direction.",
          "- Use cross-viewer-safe typography. If no strong template is provided, use serif display only for short page-level headlines. Use Arial for card titles, KPI values, recommendation numbers, body text, and all dense copy.",
          "- Keep text density low and whitespace high. If a slide feels crowded, cut content instead of shrinking everything.",
          "- Use monospace only for metadata, footnotes, and compact numeric labels.",
          "- Pricing, matrix, ladder, and KPI slides should be built from shapes and text with disciplined alignment, not default Office styles.",
          "- Do not use stacked decorative ordinals or oversized numerals unless they live in a dedicated band that cannot collide with the title or body. A simple single-line badge is better than a fragile ornament.",
          "- Recommendation or action cards must reserve four clean bands: index, title, body, footer. Do not let the title overlap the index. Do not let the body or footer overlap each other.",
          "- Footer KPI values and labels must sit inside a dedicated bottom band with enough height and width. If the card is tight, shorten the copy instead of compressing the footer.",
          "- Do not rely on PowerPoint auto-fit or narrow text boxes. Use fewer words, wider boxes, and fewer independent text frames.",
          "- For every chart, render the chart in Python to a high-resolution PNG with explicit styling and insert it into the slide as an image.",
          "- Implementation rule: use matplotlib or seaborn, save PNG files, and insert them with `slide.shapes.add_picture(...)`.",
          "- Do not use `slide.shapes.add_chart(...)`, native PowerPoint chart objects, SmartArt, SVG, OLE embeds, or default Office chart themes for critical visuals.",
          "- Every chart must remain visible in Apple Keynote, so image-based charts are the default contract.",
          "- Use the uploaded template or its geometry/palette faithfully when possible.",
          "- Your final assistant message must attach deck.pptx, deck.pdf, and deck_manifest.json as container_upload blocks. Saving them in the container is not sufficient.",
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
          "Use Arial for all dense text and card internals unless the uploaded template explicitly forces another safe font.",
          "Do not use stacked ordinals, narrow title boxes, or floating footer metrics that can drift across PowerPoint, Keynote, and Google Slides.",
          "For action cards, reserve separate non-overlapping bands for index, title, body, and footer.",
          "Keep charts as image-based embeds that remain visible in Keynote.",
          "Your final assistant message must attach deck.pptx, deck.pdf, and deck_manifest.json as container_upload blocks.",
        ].join("\n"),
      },
    ],
  };
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
  const baseMessages = [...input.messages];
  let messages = [...baseMessages];
  const fileIds = new Set<string>();
  let currentContainer = input.container;
  let finalMessage: Anthropic.Beta.BetaMessage | null = null;
  let iterationCount = 0;
  let pauseTurns = 0;
  const usage: Required<ClaudeUsage> = {
    input_tokens: 0,
    output_tokens: 0,
  };

  for (let iteration = 0; iteration < 8; iteration += 1) {
    iterationCount += 1;
    const message = await input.client.beta.messages.create({
      model: MODEL,
      max_tokens: input.maxTokens,
      betas: [...BETAS] as Anthropic.Beta.AnthropicBeta[],
      system: input.systemPrompt,
      container: currentContainer,
      messages,
      tools: input.tools,
      output_config: input.outputConfig,
    });

    finalMessage = message;
    currentContainer = message.container ? { id: message.container.id } : currentContainer;
    usage.input_tokens += message.usage?.input_tokens ?? 0;
    usage.output_tokens += message.usage?.output_tokens ?? 0;

    collectGeneratedFileIds(message.content).forEach((fileId) => fileIds.add(fileId));

    if (message.stop_reason !== "pause_turn") {
      break;
    }

    pauseTurns += 1;
    messages = appendAssistantTurn(baseMessages, message);
  }

  if (!finalMessage) {
    throw new Error("Claude did not return a message.");
  }

  return {
    message: finalMessage,
    containerId: finalMessage.container?.id ?? currentContainer?.id ?? null,
    fileIds: [...fileIds],
    thread: appendAssistantTurn(baseMessages, finalMessage),
    usage,
    iterations: iterationCount,
    pauseTurns,
  };
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

function parseAnalysisResponse(
  message: Anthropic.Beta.BetaMessage,
  files: GeneratedFile[],
) {
  const analysisFile = findGeneratedFile(files, "basquio_analysis.json");
  if (analysisFile) {
    return analysisSchema.parse(JSON.parse(analysisFile.buffer.toString("utf8")));
  }

  const text = extractResponseText(message.content);
  if (!text) {
    throw new Error(
      `Claude did not return analysis JSON or attach basquio_analysis.json. Content blocks: ${
        message.content.map((block) => block.type).join(", ") || "none"
      }.`,
    );
  }

  try {
    return analysisSchema.parse(JSON.parse(extractFirstJsonObject(text)));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid analysis JSON.";
    throw new Error(
      `Claude did not generate a parseable analysis response. ${reason} Response preview: ${text.slice(0, 800)}`,
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

async function persistDeckSpec(
  config: ReturnType<typeof resolveConfig>,
  runId: string,
  manifest: z.infer<typeof manifestSchema>,
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

function collectManifestIssues(manifest: z.infer<typeof manifestSchema>) {
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

function collectCritiqueIssues(
  manifest: z.infer<typeof manifestSchema>,
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
  manifest: z.infer<typeof manifestSchema>,
  pptx: GeneratedFile,
  pdf: GeneratedFile,
  visualQa: RenderedPageQaReport,
) {
  const checks = [
    { name: "pptx_present", passed: pptx.buffer.length > 0, detail: `${pptx.buffer.length} bytes` },
    { name: "pdf_present", passed: pdf.buffer.length > 0, detail: `${pdf.buffer.length} bytes` },
    { name: "slide_count_positive", passed: manifest.slideCount > 0, detail: `${manifest.slideCount} slides` },
    { name: "titles_present", passed: manifest.slides.every((slide) => slide.title.trim().length > 0), detail: "all slides have titles" },
    { name: "rendered_page_visual_green", passed: visualQa.overallStatus === "green", detail: `visual status=${visualQa.overallStatus}` },
    { name: "rendered_page_visual_no_revision", passed: !visualQa.deckNeedsRevision, detail: visualQa.summary },
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

  return await validateArtifactChecks(manifest, checks, pptx.buffer, pdf.buffer);
}

async function validateArtifactChecks(
  manifest: z.infer<typeof manifestSchema>,
  checks: Array<{ name: string; passed: boolean; detail: string }>,
  pptxBuffer: Buffer,
  pdfBuffer: Buffer,
) {
  const failed = [...checks.filter((check) => !check.passed).map((check) => check.name)];
  const allChecks = [...checks];
  const allFailed = [...failed];

  try {
    const zip = await JSZip.loadAsync(pptxBuffer);
    const presentationXml = zip.file("ppt/presentation.xml");
    const slideXmlCount = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
    const rasterMediaCount = Object.keys(zip.files).filter((name) => /^ppt\/media\/.+\.(png|jpe?g)$/i.test(name)).length;
    const nativeChartXmlCount = Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/i.test(name)).length;
    const extraChecks = [
      { name: "pptx_presentation_xml", passed: Boolean(presentationXml), detail: "ppt/presentation.xml exists" },
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

  return {
    tier: allFailed.length === 0 ? "green" as const : "red" as const,
    passed: allFailed.length === 0,
    checks: allChecks,
    failed: [...new Set(allFailed)],
  };
}

async function persistArtifacts(
  config: ReturnType<typeof resolveConfig>,
  run: RunRow,
  pptx: GeneratedFile,
  pdf: GeneratedFile,
) {
  const items = [
    { kind: "pptx", fileName: "deck.pptx", mimeType: pptx.mimeType || "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: pptx.buffer },
    { kind: "pdf", fileName: "deck.pdf", mimeType: pdf.mimeType || "application/pdf", buffer: pdf.buffer },
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
  manifest: z.infer<typeof manifestSchema>,
  qaReport: Record<string, unknown>,
  artifacts: Array<Record<string, unknown>>,
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
        qa_report: qaReport,
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
  result: { usage: ClaudeUsage; iterations: number; pauseTurns: number },
) {
  return {
    model,
    estimatedCostUsd: usageToCost(model, result.usage),
    inputTokens: result.usage.input_tokens ?? 0,
    outputTokens: result.usage.output_tokens ?? 0,
    totalTokens: (result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0),
    iterations: result.iterations,
    pauseTurns: result.pauseTurns,
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

function summarizeDatasetProfile(datasetProfile: ParsedDatasetProfile) {
  return {
    packageLabel: datasetProfile.manifest?.packageLabel ?? "Evidence package",
    warnings: [...(datasetProfile.manifest?.warnings ?? []), ...datasetProfile.warnings].slice(0, 12),
    files: datasetProfile.sourceFiles.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      role: file.role,
      kind: file.kind,
      mediaType: file.mediaType,
      parsedSheetCount: file.parsedSheetCount,
      notes: file.notes?.slice(0, 8) ?? [],
    })),
    sheets: datasetProfile.sheets.map((sheet) => ({
      name: sheet.name,
      sourceFileName: sheet.sourceFileName,
      sourceRole: sheet.sourceRole,
      rowCount: sheet.rowCount,
      columnCount: sheet.columns.length,
      columns: sheet.columns.slice(0, 24).map((column) => ({
        name: column.name,
        inferredType: column.inferredType,
        role: column.role,
        uniqueCount: column.uniqueCount,
        nullRate: column.nullRate,
        sampleValues: column.sampleValues.slice(0, 3).map((value) => String(value ?? "")),
      })),
    })),
  };
}
