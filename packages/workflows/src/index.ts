import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { inngest } from "./inngest-client";

import { parseEvidencePackage } from "@basquio/data-ingest";
import {
  combineValidationReports,
  computeAnalytics,
  critiqueExecutionPlanSemantically,
  decideRevision,
  interpretPackageSemantics,
  planMetrics,
  planSlides,
  planReportOutline,
  planStory,
  profileDataset,
  rankInsights,
  runDeterministicValidation,
} from "@basquio/intelligence";
import { renderPdfArtifact } from "@basquio/render-pdf";
import { renderPptxArtifact } from "@basquio/render-pptx";
import { interpretTemplateSource } from "@basquio/template-engine";
import {
  artifactManifestSchema,
  artifactRecordSchema,
  type ArtifactRecord,
  type BinaryArtifact,
  type ExecutableMetricSpec,
  type GenerationJobStatus,
  type QualityCheck,
  qualityReportSchema,
  generationJobResultSchema,
  generationRunSummarySchema,
  generationRequestSchema,
  type GenerationRequest,
  type GenerationRunSummary,
  type ReportOutline,
  type RevisionDecision,
  type SlideSpec,
  type StageTrace,
  type StorySpec,
  type TemplateProfile,
  type ChartSpec,
  type ValidationReport,
} from "@basquio/types";

import { createRunPersistence } from "./persistence";
import {
  createServiceSupabaseClient,
  downloadFromStorage,
  fetchRestRows,
  upsertRestRows,
  uploadToStorage,
} from "./supabase";

export { inngest } from "./inngest-client";

// V2 orchestration (AI-native agents) — the only pipeline
export { basquioV2Generation, basquioExport, basquioUnderstand } from "./v2-orchestration";

type GenerationStepRunner = <T>(executionId: string, fn: () => Promise<T> | T) => Promise<T>;
type ResolvedUploadedFile = GenerationRequest["sourceFiles"][number] & { base64: string };
type PlannedSlideBundle = {
  slides: SlideSpec[];
  charts: ChartSpec[];
  templateProfile: TemplateProfile;
};

export class GenerationValidationError extends Error {
  constructor(
    message: string,
    readonly validationReport: ValidationReport,
    readonly partialSummary?: GenerationRunSummary,
  ) {
    super(message);
    this.name = "GenerationValidationError";
  }
}

export class GenerationExecutionLeaseError extends Error {
  constructor(readonly jobId: string) {
    super(`Another Basquio execution already owns ${jobId}.`);
    this.name = "GenerationExecutionLeaseError";
  }
}

export async function runGenerationRequest(
  requestInput: GenerationRequest,
  options?: {
    stepRunner?: GenerationStepRunner;
  },
): Promise<GenerationRunSummary> {
  const request = generationRequestSchema.parse(requestInput);
  const brief = resolveReportBrief(request);
  const createdAt = new Date().toISOString();
  const persistence = await createRunPersistence({
    request,
    brief,
  });

  const leaseAcquired = await persistence.tryAcquireExecutionLease();

  if (!leaseAcquired) {
    throw new GenerationExecutionLeaseError(request.jobId);
  }

  await persistence.initialize();
  await persistence.persistSourceInputs();

  const runStep = async <T>(stage: string, fn: () => Promise<T> | T) => {
    if (options?.stepRunner) {
      return options.stepRunner(stage, fn);
    }

    return await fn();
  };

  const runStage = async <T>(
    stage: string,
    fn: () => Promise<T> | T,
    options?: {
      executionId?: string;
      attempt?: number;
      detail?: (result: T) => string;
      payload?: (result: T) => Record<string, unknown>;
    },
  ) => {
    const stageLabel = formatStageLabel(stage, options?.attempt);
    await persistence.updateJobStage(stageLabel, "running", `Running ${stage}.`);
    await persistence.touchExecutionLease();
    const heartbeat = setInterval(() => {
      void persistence.touchExecutionLease().catch(() => {});
    }, 15_000);

    try {
      const result = await runStep(options?.executionId ?? toStageExecutionId(stage, options?.attempt ?? 1), fn);
      clearInterval(heartbeat);
      await persistence.touchExecutionLease();
      await persistence.updateJobStage(
        stageLabel,
        "completed",
        options?.detail ? options.detail(result) : `${stage} completed.`,
        options?.payload ? options.payload(result) : {},
      );
      return result;
    } catch (error) {
      clearInterval(heartbeat);
      await persistence.touchExecutionLease();
      const status: Extract<GenerationJobStatus, "failed" | "needs_input"> =
        error instanceof GenerationValidationError ? "needs_input" : "failed";
      const message = error instanceof Error ? error.message : "Stage execution failed.";
      await persistence.updateJobStage(stageLabel, status, message, { error: message });
      throw error;
    }
  };

  try {
    const intake = await runStage(
      "intake and profiling",
      async () => {
        const sourceFiles = await resolveSourceFiles(request);
        const parsed = await parseEvidencePackage({
          datasetId: request.jobId,
          files: sourceFiles.map((file, index) => ({
            id: file.id ?? `${request.jobId}-file-${index + 1}`,
            fileName: file.fileName,
            mediaType: file.mediaType,
            kind: file.kind,
            buffer: Buffer.from(file.base64, "base64"),
          })),
        });

        return {
          sourceFiles,
          parsed,
          datasetProfile: profileDataset(parsed.datasetProfile),
        };
      },
      {
        detail: (result) =>
          `Parsed ${result.datasetProfile.manifest?.files.length ?? result.sourceFiles.length} source files into ${result.datasetProfile.sheets.length} profiled sheet views.`,
        payload: (result) => ({
          fileCount: result.datasetProfile.manifest?.files.length ?? result.sourceFiles.length,
          sheetCount: result.datasetProfile.sheets.length,
          warningCount: result.datasetProfile.warnings.length,
        }),
      },
    );
    const parsed = intake.parsed;
    const analyzed = {
      datasetProfile: intake.datasetProfile,
    };
    let styleFile: ResolvedUploadedFile | undefined;

    const stageTraces: StageTrace[] = [];
    const recordTrace = (trace: StageTrace) => {
      stageTraces.push(trace);
    };

    const packageSemantics = await runStage(
      "package semantics inference",
      async () =>
        interpretPackageSemantics(
          {
            datasetProfile: analyzed.datasetProfile,
            workbook: parsed.normalizedWorkbook,
            brief,
          },
          { onTrace: recordTrace },
        ),
      {
        detail: (result) =>
          `Interpreted the package as ${result.packageType} in the ${result.domain} domain.`,
        payload: (result) => ({
          entityCount: result.entities.length,
          relationshipCount: result.relationships.length,
          candidateMetricCount: result.candidateMetrics.length,
        }),
      },
    );

    let metricPlan = await runStage(
      "metric planning",
      async () =>
        planMetrics(
          {
            datasetProfile: analyzed.datasetProfile,
            packageSemantics,
            brief,
          },
          { onTrace: recordTrace },
        ),
      {
        detail: (result) => `Planned ${result.length} executable metrics.`,
        payload: (result) => ({
          metricCount: result.length,
        }),
      },
    );

    let analyticsResult = await runStage(
      "deterministic analytics execution",
      async () =>
        computeAnalytics({
          datasetProfile: analyzed.datasetProfile,
          workbook: parsed.normalizedWorkbook,
          packageSemantics,
          metricPlan,
          onHeartbeat: () => persistence.touchExecutionLease(),
        }),
      {
        detail: (result) =>
          `Computed ${result.metrics.length} metrics, ${result.derivedTables.length} derived tables, and ${result.evidenceRefs.length} evidence refs.`,
        payload: (result) => ({
          metricCount: result.metrics.length,
          derivedTableCount: result.derivedTables.length,
          evidenceRefCount: result.evidenceRefs.length,
        }),
      },
    );

    await persistence.updateDataset({
      datasetId: request.jobId,
      datasetProfile: analyzed.datasetProfile,
      deterministicAnalysis: analyticsResult,
    });

    let insights = await runStage(
      "insight ranking",
      async () =>
        rankInsights(
          {
            analyticsResult,
            packageSemantics,
            brief,
          },
          { onTrace: recordTrace },
        ),
      {
        detail: (result) => `Ranked ${result.length} evidence-backed insights.`,
        payload: (result) => ({ insightCount: result.length }),
      },
    );

    let story: StorySpec | undefined;
    let reportOutline: ReportOutline | undefined;
    let slidePlan: PlannedSlideBundle | undefined;
    let templateProfile: TemplateProfile | undefined;
    let validationReport: ValidationReport | undefined;
    const revisionHistory: RevisionDecision[] = [];
    let reviewerFeedback: string[] = [];
    let nextRevisionTarget: RevisionDecision["targetStage"] | null = null;
    const maxPlanAttempts = 3;

    for (let attempt = 1; attempt <= maxPlanAttempts; attempt += 1) {
      if (attempt > 1 && nextRevisionTarget === "metrics") {
        metricPlan = await runStage(
          "metric planning",
          async () =>
            planMetrics(
              {
                datasetProfile: analyzed.datasetProfile,
                packageSemantics,
                brief,
                reviewFeedback: reviewerFeedback,
              },
              { onTrace: recordTrace },
            ),
          {
            attempt,
            executionId: toStageExecutionId("metric planning", attempt),
            detail: (result) => `Attempt ${attempt}: replanned ${result.length} executable metrics from reviewer feedback.`,
            payload: (result) => ({ metricCount: result.length, attempt }),
          },
        );

        analyticsResult = await runStage(
          "deterministic analytics execution",
          async () =>
            computeAnalytics({
              datasetProfile: analyzed.datasetProfile,
              workbook: parsed.normalizedWorkbook,
              packageSemantics,
              metricPlan,
              onHeartbeat: () => persistence.touchExecutionLease(),
            }),
          {
            attempt,
            executionId: toStageExecutionId("deterministic analytics execution", attempt),
            detail: (result) =>
              `Attempt ${attempt}: recomputed ${result.metrics.length} metrics, ${result.derivedTables.length} derived tables, and ${result.evidenceRefs.length} evidence refs.`,
            payload: (result) => ({
              metricCount: result.metrics.length,
              derivedTableCount: result.derivedTables.length,
              evidenceRefCount: result.evidenceRefs.length,
              attempt,
            }),
          },
        );

        await persistence.updateDataset({
          datasetId: request.jobId,
          datasetProfile: analyzed.datasetProfile,
          deterministicAnalysis: analyticsResult,
        });
      }

      if (
        attempt === 1 ||
        nextRevisionTarget === "metrics" ||
        nextRevisionTarget === "insights"
      ) {
        insights = await runStage(
          "insight ranking",
          async () =>
            rankInsights(
              {
                analyticsResult,
                packageSemantics,
                brief,
                reviewFeedback: reviewerFeedback,
              },
              { onTrace: recordTrace },
            ),
          {
            attempt,
            executionId: toStageExecutionId("insight ranking", attempt),
            detail: (result) => `Attempt ${attempt}: ranked ${result.length} evidence-backed insights.`,
            payload: (result) => ({ insightCount: result.length, attempt }),
          },
        );
      }

      if (
        attempt === 1 ||
        nextRevisionTarget === "metrics" ||
        nextRevisionTarget === "insights" ||
        nextRevisionTarget === "story"
      ) {
        const plannedStory = await runStage(
          "story architecture",
          async () =>
            planStory(
              {
                analyticsResult,
                insights,
                packageSemantics,
                brief,
                reviewFeedback: reviewerFeedback,
              },
              { onTrace: recordTrace },
            ),
          {
            attempt,
            executionId: toStageExecutionId("story architecture", attempt),
            detail: (result) => `Attempt ${attempt}: planned story "${result.title || "Basquio evidence package report"}".`,
            payload: (result) => ({
              narrativeArcCount: result.narrativeArc.length,
              keyMessageCount: result.keyMessages.length,
              attempt,
            }),
          },
        );
        story = plannedStory;

        reportOutline = await runStage(
          "outline architecture",
          async () =>
            planReportOutline({
              story: plannedStory,
              insights,
              brief,
            }),
          {
            attempt,
            executionId: toStageExecutionId("outline architecture", attempt),
            detail: (result) => `Attempt ${attempt}: locked a ${result.sections.length}-section report outline before slide planning.`,
            payload: (result) => ({ sectionCount: result.sections.length, attempt }),
          },
        );
      }

      if (!story || !reportOutline) {
        throw new Error("Story architecture and outline architecture must exist before slide planning.");
      }

      if (attempt === 1 || nextRevisionTarget === "design") {
        templateProfile = await runStage(
          "design translation",
          async () => {
            styleFile = styleFile ?? (await resolveUploadedFile(request.styleFile));

            return interpretTemplateSource({
              id: `${request.jobId}-template`,
              fileName: styleFile?.fileName ?? request.templateFileName,
              reviewFeedback: reviewerFeedback,
              sourceFile: styleFile,
            });
          },
          {
            attempt,
            detail: (result) =>
              `Attempt ${attempt}: translated ${result.sourceType} template input into ${result.layouts.length} layout-aware rendering constraints.`,
            payload: (result) => ({
              sourceType: result.sourceType,
              layoutCount: result.layouts.length,
              placeholderCount: result.placeholderCatalog.length,
              attempt,
            }),
            executionId: toStageExecutionId("design translation", attempt),
          },
        );
        await persistence.updateTemplateProfile(templateProfile);
      }

      if (!templateProfile) {
        throw new Error("Design translation must produce a template profile before slide architecture.");
      }

      const currentStory = story;
      const currentOutline = reportOutline;
      const currentTemplateProfile = templateProfile;

      const plannedSlidePlan = await runStage(
        "slide architecture",
        async () => {
          const planned = await planSlides(
            {
              analyticsResult,
              story: currentStory,
              outline: currentOutline,
              insights,
              templateProfile: currentTemplateProfile,
              brief,
              reviewFeedback: reviewerFeedback,
            },
            { onTrace: recordTrace },
          );

          return {
            slides: planned.slides,
            charts: planned.charts,
            templateProfile: currentTemplateProfile,
          };
        },
        {
          attempt,
          executionId: toStageExecutionId("slide architecture", attempt),
          detail: (result) => `Attempt ${attempt}: planned ${result.slides.length} slides and ${result.charts.length} charts.`,
          payload: (result) => ({
            slideCount: result.slides.length,
            chartCount: result.charts.length,
            attempt,
          }),
        },
      );
      slidePlan = plannedSlidePlan;

      const deterministicValidation = await runStage(
        "deterministic validation",
        async () =>
          runDeterministicValidation({
            jobId: request.jobId,
            analyticsResult,
            insights,
            slides: plannedSlidePlan.slides,
            charts: plannedSlidePlan.charts,
            story: currentStory,
            stageTraces,
            attemptCount: attempt,
          }),
        {
          attempt,
          executionId: toStageExecutionId("deterministic validation", attempt),
          detail: (result) =>
            `Attempt ${attempt}: deterministic validation finished with ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}.`,
          payload: (result) => ({
            status: result.status,
            issueCount: result.issues.length,
            attemptCount: result.attemptCount,
          }),
        },
      );

      const semanticCritique = await runStage(
        "semantic critique",
        async () =>
          critiqueExecutionPlanSemantically({
            jobId: request.jobId,
            analyticsResult,
            insights,
            slides: plannedSlidePlan.slides,
            charts: plannedSlidePlan.charts,
            story: currentStory,
            stageTraces,
            attemptCount: attempt,
          }),
        {
          attempt,
          executionId: toStageExecutionId("semantic critique", attempt),
          detail: (result) =>
            `Attempt ${attempt}: semantic critique finished with ${result.report.issues.length} issue${result.report.issues.length === 1 ? "" : "s"}.`,
          payload: (result) => ({
            status: result.report.status,
            issueCount: result.report.issues.length,
            targetStage: result.report.targetStage,
            attempt,
          }),
        },
      );

      const revisionOutcome = await runStage(
        "targeted revision loop",
        async () => {
          const report = combineValidationReports({
            jobId: request.jobId,
            insights,
            charts: plannedSlidePlan.charts,
            slides: plannedSlidePlan.slides,
            deterministicReport: deterministicValidation,
            semanticReport: semanticCritique.report,
            stageTraces,
            attemptCount: attempt,
          });

          return {
            report,
            revision: decideRevision({ report }),
          };
        },
        {
          attempt,
          executionId: toStageExecutionId("targeted revision loop", attempt),
          detail: (result) =>
            result.report.status === "passed"
              ? `Attempt ${attempt}: validation and critique passed; rendering can start.`
              : `Attempt ${attempt}: revision loop is sending the run back to ${result.revision?.targetStage ?? "slides"}.`,
          payload: (result) => ({
            status: result.report.status,
            issueCount: result.report.issues.length,
            targetStage: result.revision?.targetStage ?? result.report.targetStage,
            attempt,
          }),
        },
      );
      validationReport = revisionOutcome.report;

      if (revisionOutcome.report.status === "passed") {
        break;
      }

      if (revisionOutcome.revision) {
        revisionHistory.push(revisionOutcome.revision);
        reviewerFeedback = revisionOutcome.revision.reviewerFeedback;
        nextRevisionTarget = revisionOutcome.revision.targetStage;
      }
    }

    if (!story || !reportOutline || !slidePlan || !templateProfile || !validationReport) {
      throw new Error("Planning loop did not produce a complete execution plan.");
    }

    const finalStory = story;
    const finalOutline = reportOutline;
    const finalSlidePlan = slidePlan;
    const finalTemplateProfile = templateProfile;
    const finalValidationReport = validationReport;

    await persistence.updateValidationReport(finalValidationReport);

    if (finalValidationReport.status !== "passed") {
      await persistence.updateJobStage(
        "targeted revision loop",
        "needs_input",
        `Validation blocked rendering with ${finalValidationReport.issues.length} issue${finalValidationReport.issues.length === 1 ? "" : "s"}.`,
        {
          status: finalValidationReport.status,
          issueCount: finalValidationReport.issues.length,
        },
      );

      const partialSummary = generationRunSummarySchema.parse({
        jobId: request.jobId,
        createdAt,
        status: "needs_input",
        failureMessage: "Pre-render validation failed.",
        sourceFileName: analyzed.datasetProfile.sourceFileName,
        brief,
        businessContext: brief.businessContext,
        client: brief.client,
        audience: brief.audience,
        objective: brief.objective,
        thesis: brief.thesis,
        stakes: brief.stakes,
        datasetProfile: analyzed.datasetProfile,
        packageSemantics,
        metricPlan,
        analyticsResult,
        insights,
        story: finalStory,
        reportOutline: finalOutline,
        templateProfile: finalTemplateProfile,
        slidePlan: {
          slides: finalSlidePlan.slides,
          charts: finalSlidePlan.charts,
        },
        validationReport: finalValidationReport,
        revisionHistory,
        stageTraces,
        artifacts: [],
      });

      throw new GenerationValidationError("Pre-render validation failed.", finalValidationReport, partialSummary);
    }

    const deckTitle = finalStory.title || finalStory.keyMessages[0] || brief.objective || "Basquio output";

    const pptxArtifact = await runStage(
      "render pptx",
      async () =>
        renderPptxArtifact({
          deckTitle,
          slidePlan: finalSlidePlan.slides,
          charts: finalSlidePlan.charts,
          templateProfile: finalTemplateProfile,
          templateFile:
            styleFile && finalTemplateProfile.sourceType === "pptx"
              ? {
                  fileName: styleFile.fileName,
                  base64: styleFile.base64,
                }
              : undefined,
        }),
      {
        detail: (result) => `Rendered PPTX artifact ${result.fileName}.`,
        payload: (result) => ({ fileName: result.fileName, byteSize: toBuffer(result.buffer).byteLength }),
      },
    );

    const pdfArtifact = await runStage(
      "render pdf",
      async () =>
        renderPdfArtifact({
          deckTitle,
          slidePlan: finalSlidePlan.slides,
          charts: finalSlidePlan.charts,
          templateProfile: finalTemplateProfile,
        }),
      {
        detail: (result) => `Rendered PDF artifact ${result.fileName}.`,
        payload: (result) => ({ fileName: result.fileName, byteSize: toBuffer(result.buffer).byteLength }),
      },
    );

    const artifactDelivery = await runStage(
      "artifact qa and delivery",
      async () =>
        {
          const artifacts = await Promise.all([
            persistArtifact(request.jobId, "pptx", pptxArtifact),
            persistArtifact(request.jobId, "pdf", pdfArtifact),
          ]);

          const qa = await runPostRenderQa({
            jobId: request.jobId,
            artifacts,
            slideCount: slidePlan.slides.length,
            sectionCount: reportOutline.sections.length,
          });

          return {
            artifacts,
            ...qa,
          };
        },
      {
        detail: (result) => `Artifact delivery finished with QA status ${result.qualityReport.status}.`,
        payload: (result) => ({
          status: result.qualityReport.status,
          artifactCount: result.artifacts.length,
          checkCount: result.qualityReport.checks.length,
        }),
      },
    );

    await persistence.updateQualityReport(artifactDelivery.qualityReport);

    assertArtifactDeliveryIsDurable(artifactDelivery);

    const summary = generationRunSummarySchema.parse({
      jobId: request.jobId,
      createdAt,
      status: "completed",
      failureMessage: "",
      sourceFileName: analyzed.datasetProfile.sourceFileName,
      brief,
      businessContext: brief.businessContext,
      client: brief.client,
      audience: brief.audience,
      objective: brief.objective,
      thesis: brief.thesis,
      stakes: brief.stakes,
      datasetProfile: analyzed.datasetProfile,
      packageSemantics,
      metricPlan,
      analyticsResult,
      insights,
      story,
      reportOutline,
      templateProfile: finalTemplateProfile,
      slidePlan: {
        slides: slidePlan.slides,
        charts: slidePlan.charts,
      },
      validationReport,
      artifactManifest: artifactDelivery.artifactManifest,
      qualityReport: artifactDelivery.qualityReport,
      revisionHistory,
      stageTraces,
      artifacts: artifactDelivery.artifactManifest.artifacts,
    });

    await persistence.finalize(summary);
    await writeRunSummary(summary);

    return summary;
  } catch (error) {
    if (error instanceof GenerationExecutionLeaseError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Generation failed.";

    if (error instanceof GenerationValidationError) {
      if (error.partialSummary) {
        await persistence.finalizeFailure("needs_input", message, error.partialSummary);
        await writeRunSummary(error.partialSummary);
      } else {
        await persistence.finalizeFailure("needs_input", message);
      }
    } else {
      await persistence.finalizeFailure("failed", message);
    }

    throw error;
  }
}

function toStageExecutionId(stage: string, attempt = 1) {
  const normalizedStage = stage
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return attempt > 1 ? `${normalizedStage}-attempt-${attempt}` : normalizedStage;
}

function formatStageLabel(stage: string, attempt = 1) {
  return attempt > 1 ? `${stage} (attempt ${attempt})` : stage;
}

async function resolveSourceFiles(request: GenerationRequest) {
  if (request.sourceFiles.length > 0) {
    return Promise.all(request.sourceFiles.map((file) => resolveRequiredUploadedFile(file)));
  }

  if (request.sourceFileName && request.workbookBase64) {
    return [
      {
        fileName: request.sourceFileName,
        mediaType: "application/octet-stream",
        base64: request.workbookBase64,
      },
    ];
  }

  throw new Error("Generation request did not include any source files.");
}

async function resolveUploadedFile(file?: GenerationRequest["sourceFiles"][number]): Promise<ResolvedUploadedFile | undefined> {
  if (!file) {
    return undefined;
  }

  if (file.base64) {
    return {
      ...file,
      base64: file.base64,
    };
  }

  if (!file.storageBucket || !file.storagePath) {
    throw new Error(`Uploaded file ${file.fileName} is missing its storage reference.`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(`Unable to resolve ${file.fileName} from storage because Supabase server credentials are missing.`);
  }

  const buffer = await downloadFromStorage({
    supabaseUrl,
    serviceKey,
    bucket: file.storageBucket,
    storagePath: file.storagePath,
  });

  return {
    ...file,
    base64: buffer.toString("base64"),
    fileBytes: file.fileBytes ?? buffer.byteLength,
  };
}

async function resolveRequiredUploadedFile(file: GenerationRequest["sourceFiles"][number]): Promise<ResolvedUploadedFile> {
  const resolved = await resolveUploadedFile(file);

  if (!resolved) {
    throw new Error("Generation request included an empty source file entry.");
  }

  return resolved;
}

function resolveReportBrief(request: GenerationRequest) {
  return {
    businessContext: request.brief.businessContext || request.businessContext,
    client: request.brief.client || request.client,
    audience: request.brief.audience || request.audience,
    objective: request.brief.objective || request.objective,
    thesis: request.brief.thesis || request.thesis,
    stakes: request.brief.stakes || request.stakes,
  };
}

async function runPostRenderQa(input: {
  jobId: string;
  artifacts: ArtifactRecord[];
  slideCount: number;
  sectionCount: number;
}) {
  const checks: QualityCheck[] = [];
  const qaArtifacts: ArtifactRecord[] = [];
  let resolvedPdfPageCount: number | undefined;
  let resolvedPptxSlideCount: number | undefined;

  for (const artifact of input.artifacts) {
    try {
      const buffer = await readPersistedArtifactBuffer(artifact);
      const actualByteSize = buffer.byteLength;
      const checksumSha256 = createHash("sha256").update(buffer).digest("hex");

      checks.push({
        id: `${artifact.kind}-exists`,
        label: `${artifact.kind.toUpperCase()} artifact exists`,
        status: actualByteSize > 0 ? "passed" : "failed",
        detail: actualByteSize > 0 ? `${artifact.fileName} is readable after storage.` : `${artifact.fileName} is empty after storage.`,
        artifactKind: artifact.kind,
      });

      checks.push({
        id: `${artifact.kind}-metadata`,
        label: `${artifact.kind.toUpperCase()} metadata matches stored bytes`,
        status: actualByteSize === artifact.byteSize ? "passed" : "failed",
        detail:
          actualByteSize === artifact.byteSize
            ? `${artifact.fileName} reports ${artifact.byteSize} bytes and storage returned the same size.`
            : `${artifact.fileName} reports ${artifact.byteSize} bytes, but storage returned ${actualByteSize}.`,
        artifactKind: artifact.kind,
      });

      let slideCount = input.slideCount;
      let pageCount: number | undefined;

      if (artifact.kind === "pdf") {
        pageCount = await countPdfPages(buffer);
        resolvedPdfPageCount = pageCount;
        checks.push({
          id: "pdf-page-count",
          label: "PDF page count matches the slide plan",
          status: pageCount === input.slideCount ? "passed" : "failed",
          detail: `Expected ${input.slideCount} pages and resolved ${pageCount}.`,
          artifactKind: artifact.kind,
        });
      }

      if (artifact.kind === "pptx") {
        slideCount = await countPptxSlides(buffer);
        resolvedPptxSlideCount = slideCount;
        checks.push({
          id: "pptx-slide-count",
          label: "PPTX slide count matches the slide plan",
          status: slideCount === input.slideCount ? "passed" : "failed",
          detail: `Expected ${input.slideCount} slides and resolved ${slideCount}.`,
          artifactKind: artifact.kind,
        });
      }

      qaArtifacts.push(
        artifactRecordSchema.parse({
          ...artifact,
          byteSize: actualByteSize,
          checksumSha256,
          exists: actualByteSize > 0,
          slideCount,
          sectionCount: input.sectionCount,
          ...(typeof pageCount === "number" ? { pageCount } : {}),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Artifact verification failed.";
      checks.push({
        id: `${artifact.kind}-read`,
        label: `${artifact.kind.toUpperCase()} artifact is readable`,
        status: "failed",
        detail: message,
        artifactKind: artifact.kind,
      });

      qaArtifacts.push(
        artifactRecordSchema.parse({
          ...artifact,
          exists: false,
          sectionCount: input.sectionCount,
        }),
      );
    }
  }

  if (typeof resolvedPdfPageCount === "number" && typeof resolvedPptxSlideCount === "number") {
    checks.push({
      id: "cross-output-slide-consistency",
      label: "PPTX slides and PDF pages stay aligned",
      status: resolvedPdfPageCount === resolvedPptxSlideCount ? "passed" : "failed",
      detail: `PPTX resolved ${resolvedPptxSlideCount} slides and PDF resolved ${resolvedPdfPageCount} pages.`,
    });
  }

  checks.push({
    id: "cross-output-section-consistency",
    label: "Artifacts carry the same section count metadata",
    status: qaArtifacts.every((artifact) => artifact.sectionCount === input.sectionCount) ? "passed" : "failed",
    detail: `Expected section count ${input.sectionCount} across ${qaArtifacts.length} artifacts.`,
  });

  const manifest = artifactManifestSchema.parse({
    jobId: input.jobId,
    generatedAt: new Date().toISOString(),
    expectedSlideCount: input.slideCount,
    expectedSectionCount: input.sectionCount,
    artifacts: qaArtifacts,
  });

  const failedChecks = checks.filter((check) => check.status === "failed").length;
  const warningChecks = checks.filter((check) => check.status === "warning").length;

  const qualityReport = qualityReportSchema.parse({
    jobId: input.jobId,
    generatedAt: new Date().toISOString(),
    status: failedChecks > 0 ? "failed" : warningChecks > 0 ? "warning" : "passed",
    checks,
  });

  return {
    artifactManifest: manifest,
    qualityReport,
  };
}

function assertArtifactDeliveryIsDurable(input: {
  artifacts: ArtifactRecord[];
  qualityReport: { status: "passed" | "warning" | "failed"; checks: QualityCheck[] };
}) {
  const missingArtifacts = input.artifacts.filter((artifact) => !artifact.exists).map((artifact) => artifact.kind);

  if (missingArtifacts.length > 0) {
    throw new Error(`Artifact delivery did not durably persist ${missingArtifacts.join(" and ")}.`);
  }

  if (input.qualityReport.status === "failed") {
    const failedChecks = input.qualityReport.checks
      .filter((check) => check.status === "failed")
      .map((check) => check.detail)
      .filter(Boolean);
    throw new Error(failedChecks[0] || "Artifact QA failed after render.");
  }
}

async function persistArtifact(jobId: string, kind: "pptx" | "pdf", artifact: BinaryArtifact): Promise<ArtifactRecord> {
  const storagePath = `jobs/${jobId}/${artifact.fileName}`;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const buffer = toBuffer(artifact.buffer);
  const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
  const allowLocalFallback =
    process.env.BASQUIO_ALLOW_LOCAL_ARTIFACT_FALLBACK === "true" || process.env.NODE_ENV !== "production";

  if (supabaseUrl && serviceRoleKey) {
    try {
      await uploadToStorage({
        supabaseUrl,
        serviceKey: serviceRoleKey,
        bucket: "artifacts",
        storagePath,
        body: buffer,
        contentType: artifact.mimeType,
        upsert: true,
      });

      const supabase = createServiceSupabaseClient(supabaseUrl, serviceRoleKey);
      const record = artifactRecordSchema.parse({
        id: `${jobId}-${kind}`,
        jobId,
        kind,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        storagePath,
        byteSize: buffer.byteLength,
        provider: "supabase",
        checksumSha256,
        exists: true,
      });

      await persistArtifactMetadata(supabase, record);
      return record;
    } catch (error) {
      const supabase = createServiceSupabaseClient(supabaseUrl, serviceRoleKey);
      const inlineRecord = artifactRecordSchema.parse({
        id: `${jobId}-${kind}`,
        jobId,
        kind,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        storagePath,
        byteSize: buffer.byteLength,
        provider: "database",
        checksumSha256,
        exists: true,
      });

      try {
        await persistArtifactMetadata(supabase, inlineRecord, {
          inlineBase64: buffer.toString("base64"),
        });
        return inlineRecord;
      } catch {}

      if (!allowLocalFallback) {
        const message = error instanceof Error ? error.message : `Unable to upload ${storagePath}.`;
        throw new Error(`Supabase artifact upload failed for ${storagePath}: ${message}`);
      }
    }
  }

  if (!allowLocalFallback) {
    throw new Error(
      "Supabase artifact storage is required in production. Configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const workspaceRoot = await resolveWorkspaceRoot();
  const outputDir = path.join(workspaceRoot, "output", jobId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, artifact.fileName), buffer);

  const record = artifactRecordSchema.parse({
    id: `${jobId}-${kind}`,
    jobId,
    kind,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    storagePath: path.relative(workspaceRoot, path.join(outputDir, artifact.fileName)),
    byteSize: buffer.byteLength,
    provider: "local",
    checksumSha256,
    exists: true,
  });

  if (supabaseUrl && serviceRoleKey) {
    const supabase = createServiceSupabaseClient(supabaseUrl, serviceRoleKey);
    await persistArtifactMetadata(supabase, record);
  }

  return record;
}

async function writeRunSummary(summary: GenerationRunSummary) {
  const summaryPayload = Buffer.from(JSON.stringify(summary, null, 2), "utf8");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    try {
      await uploadToStorage({
        supabaseUrl,
        serviceKey: serviceRoleKey,
        bucket: "artifacts",
        storagePath: `run-summaries/${summary.jobId}.json`,
        body: summaryPayload,
        contentType: "application/json",
        upsert: true,
      });
    } catch {
      // Summary persistence to storage is best-effort so artifact delivery can still succeed.
    }
  }

  const outputRoot = await resolveOutputRoot();

  if (!outputRoot) {
    return;
  }

  const outputDir = path.join(outputRoot, summary.jobId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "job-summary.json"), summaryPayload);
}

async function persistArtifactMetadata(
  supabase: any,
  artifact: ArtifactRecord,
  extraMetadata: Record<string, unknown> = {},
) {
  try {
    const jobs = await fetchRestRows<{ id: string }>({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      table: "generation_jobs",
      query: {
        select: "id",
        job_key: `eq.${artifact.jobId}`,
        limit: "1",
      },
    });

    if (!jobs[0]?.id) {
      return;
    }

    await upsertRestRows({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      table: "artifacts",
      onConflict: "job_id,kind",
      rows: [
        {
          job_id: jobs[0].id,
          kind: artifact.kind,
          storage_bucket: artifact.provider === "supabase" ? "artifacts" : artifact.provider === "database" ? "database" : "local",
          storage_path: artifact.storagePath,
          mime_type: artifact.mimeType,
          file_bytes: artifact.byteSize,
        metadata: {
          fileName: artifact.fileName,
          provider: artifact.provider,
          checksumSha256: artifact.checksumSha256,
          exists: artifact.exists,
          slideCount: artifact.slideCount,
          pageCount: artifact.pageCount,
          sectionCount: artifact.sectionCount,
          ...extraMetadata,
        },
        },
      ],
    });
  } catch {
    // Durable metadata is best-effort so the working generation path keeps moving.
  }
}

async function readPersistedArtifactBuffer(artifact: ArtifactRecord) {
  if (artifact.provider === "supabase") {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase storage is configured for this artifact, but service-role credentials are missing.");
    }

    return downloadFromStorage({
      supabaseUrl,
      serviceKey: serviceRoleKey,
      bucket: "artifacts",
      storagePath: artifact.storagePath,
    });
  }

  if (artifact.provider === "database") {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase database access is configured for this artifact, but service-role credentials are missing.");
    }

    return readInlineArtifactBuffer({
      supabase: createServiceSupabaseClient(supabaseUrl, serviceRoleKey),
      jobId: artifact.jobId,
      kind: artifact.kind,
    });
  }

  const workspaceRoot = await resolveWorkspaceRoot();
  const absolutePath = path.isAbsolute(artifact.storagePath)
    ? artifact.storagePath
    : path.join(workspaceRoot, artifact.storagePath);

  return readFile(absolutePath);
}

async function readInlineArtifactBuffer(input: {
  supabase: any;
  jobId: string;
  kind: "pptx" | "pdf";
}) {
  const { data: job } = await input.supabase
    .from("generation_jobs")
    .select("id")
    .eq("job_key", input.jobId)
    .single();

  if (!job?.id) {
    throw new Error(`Unable to locate generation job ${input.jobId}.`);
  }

  const { data: artifact } = await input.supabase
    .from("artifacts")
    .select("metadata")
    .eq("job_id", job.id)
    .eq("kind", input.kind)
    .maybeSingle();

  const inlineBase64 =
    artifact?.metadata && typeof artifact.metadata === "object" && typeof artifact.metadata.inlineBase64 === "string"
      ? artifact.metadata.inlineBase64
      : null;

  if (!inlineBase64) {
    throw new Error(`Inline artifact payload is missing for ${input.jobId}/${input.kind}.`);
  }

  return Buffer.from(inlineBase64, "base64");
}

async function countPdfPages(buffer: Buffer) {
  const pdf = await PDFDocument.load(buffer);
  return pdf.getPageCount();
}

async function countPptxSlides(buffer: Buffer) {
  const archive = await JSZip.loadAsync(buffer);
  const presentationXml = await archive.file("ppt/presentation.xml")?.async("text");

  if (presentationXml) {
    const referencedSlides = [...presentationXml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/gim)];
    if (referencedSlides.length > 0) {
      return referencedSlides.length;
    }
  }

  return Object.keys(archive.files).filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry)).length;
}

function toBuffer(buffer: BinaryArtifact["buffer"]) {
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.data);
}

async function resolveOutputRoot() {
  const workspaceRoot = await tryResolveWorkspaceRoot();
  return workspaceRoot ? path.join(workspaceRoot, "output") : null;
}

async function resolveWorkspaceRoot() {
  const workspaceRoot = await tryResolveWorkspaceRoot();

  if (!workspaceRoot) {
    throw new Error("Unable to resolve the Basquio workspace root.");
  }

  return workspaceRoot;
}

async function tryResolveWorkspaceRoot() {
  let current = process.cwd();

  for (;;) {
    try {
      await access(path.join(current, "docs", "vision.md"));
      await access(path.join(current, "package.json"));
      return current;
    } catch {
      const parent = path.dirname(current);

      if (parent === current) {
        return null;
      }

      current = parent;
    }
  }
}
