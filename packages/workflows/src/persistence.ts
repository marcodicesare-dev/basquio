import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  GenerationJobStatus,
  GenerationRequest,
  GenerationRunSummary,
  QualityReport,
  TemplateProfile,
  ValidationReport,
} from "@basquio/types";
import { generationRunSummarySchema } from "@basquio/types";

import {
  createServiceSupabaseClient,
  fetchRestRows,
  patchRestRows,
  upsertRestRows,
  uploadToStorage,
} from "./supabase";

type RunPersistenceContext = {
  supabase: SupabaseClient;
  supabaseUrl: string;
  serviceRoleKey: string;
  organizationId: string;
  projectId: string;
  requestedBy: string | null;
};

type UploadedInputRecord = {
  externalId: string;
  rowId: string;
  fileName: string;
};

export async function createRunPersistence(input: {
  request: GenerationRequest;
  brief: GenerationRequest["brief"];
}) {
  const context = await resolveRunPersistenceContext(input.request, input.brief);

  if (!context) {
    return new NoopRunPersistence();
  }

  return new SupabaseRunPersistence(context, input.request, input.brief);
}

class NoopRunPersistence {
  async initialize() {}
  async persistSourceInputs() {}
  async updateDataset() {}
  async updateTemplateProfile() {}
  async updateJobStage() {}
  async updateValidationReport() {}
  async updateQualityReport() {}
  async finalize() {}
  async finalizeFailure() {}
}

class SupabaseRunPersistence {
  private readonly sourceFiles = new Map<string, UploadedInputRecord>();
  private datasetRowId: string | null = null;
  private templateProfileRowId: string | null = null;

  constructor(
    private readonly context: RunPersistenceContext,
    private readonly request: GenerationRequest,
    private readonly brief: GenerationRequest["brief"],
  ) {}

  async initialize() {
    await upsertRestRows({
      supabaseUrl: this.context.supabaseUrl,
      serviceKey: this.context.serviceRoleKey,
      table: "generation_jobs",
      onConflict: "job_key",
      rows: [
        {
          job_key: this.request.jobId,
          organization_id: this.context.organizationId,
          project_id: this.context.projectId,
          requested_by: this.context.requestedBy,
          status: "running",
          business_context: this.brief.businessContext,
          audience: this.brief.audience,
          objective: this.brief.objective,
          brief: this.brief,
        },
      ],
    });
  }

  async persistSourceInputs() {
    const evidenceUploads = await Promise.all(
      this.request.sourceFiles.map((file, index) =>
        this.persistSourceFile(file, {
          bucket: "source-files",
          externalId: file.id ?? `${this.request.jobId}-source-${index + 1}`,
        }),
      ),
    );

    const styleUpload = this.request.styleFile
      ? await this.persistSourceFile(this.request.styleFile, {
          bucket: "templates",
          externalId: `${this.request.jobId}-style`,
        })
      : null;

    [...evidenceUploads, styleUpload].filter(Boolean).forEach((record) => {
      if (record) {
        this.sourceFiles.set(record.externalId, record);
      }
    });
  }

  async updateDataset(input: {
    datasetId: string;
    datasetProfile: Record<string, unknown>;
    deterministicAnalysis: Record<string, unknown>;
  }) {
    const primarySourceRowId = this.resolveSourceFileRowId(input.datasetProfile);
    const { data } = await this.context.supabase
      .from("datasets")
      .upsert(
        {
          external_id: input.datasetId,
          project_id: this.context.projectId,
          source_file_id: primarySourceRowId,
          manifest: (input.datasetProfile.manifest as Record<string, unknown> | undefined) ?? {},
          dataset_profile: input.datasetProfile,
          deterministic_analysis: input.deterministicAnalysis,
          status: "running",
        },
        { onConflict: "external_id" },
      )
      .select("id")
      .single();

    this.datasetRowId = data?.id ?? this.datasetRowId;

    if (!this.datasetRowId) {
      return;
    }

    const manifestFiles = Array.isArray((input.datasetProfile.manifest as { files?: unknown[] } | undefined)?.files)
      ? ((input.datasetProfile.manifest as { files: Array<Record<string, unknown>> }).files ?? [])
      : [];
    const manifest = (input.datasetProfile.manifest as Record<string, unknown> | undefined) ?? {};
    const primaryFileId = typeof manifest.primaryFileId === "string" ? manifest.primaryFileId : undefined;
    const brandFileId = typeof manifest.brandFileId === "string" ? manifest.brandFileId : undefined;

    const datasetSourceRows = manifestFiles
      .map((file, index) => {
        const externalId = typeof file.id === "string" ? file.id : undefined;
        const sourceRowId = externalId ? this.sourceFiles.get(externalId)?.rowId : undefined;

        if (!sourceRowId) {
          return null;
        }

        return {
          dataset_id: this.datasetRowId,
          source_file_id: sourceRowId,
          file_role: typeof file.role === "string" ? file.role : "unknown-support",
          parsed_sheet_count: typeof file.parsedSheetCount === "number" ? file.parsedSheetCount : 0,
          is_primary: externalId === primaryFileId,
          is_brand: externalId === brandFileId,
          notes: Array.isArray(file.notes) ? file.notes : [],
          sort_order: index,
        };
      })
      .filter(Boolean);

    if (datasetSourceRows.length > 0) {
      await this.context.supabase.from("dataset_source_files").upsert(datasetSourceRows, {
        onConflict: "dataset_id,source_file_id",
      });
    }

    await this.context.supabase
      .from("generation_jobs")
      .update({ dataset_id: this.datasetRowId })
      .eq("job_key", this.request.jobId);
  }

  async updateTemplateProfile(templateProfile: TemplateProfile) {
    if (this.templateProfileRowId) {
      return;
    }

    const { data: existingJob } = await this.context.supabase
      .from("generation_jobs")
      .select("template_profile_id")
      .eq("job_key", this.request.jobId)
      .maybeSingle();

    if (existingJob?.template_profile_id) {
      this.templateProfileRowId = existingJob.template_profile_id;
      return;
    }

    const styleSourceRowId = this.sourceFiles.get(`${this.request.jobId}-style`)?.rowId ?? null;
    const { data } = await this.context.supabase
      .from("template_profiles")
      .insert({
        organization_id: this.context.organizationId,
        source_file_id: styleSourceRowId,
        source_type: templateProfile.sourceType,
        template_profile: templateProfile,
      })
      .select("id")
      .single();

    this.templateProfileRowId = data?.id ?? this.templateProfileRowId;

    if (this.templateProfileRowId) {
      await this.context.supabase
        .from("generation_jobs")
        .update({ template_profile_id: this.templateProfileRowId })
        .eq("job_key", this.request.jobId);
    }
  }

  async updateJobStage(stage: string, status: GenerationJobStatus, detail: string, payload: Record<string, unknown> = {}) {
    const { data: job } = await this.context.supabase
      .from("generation_jobs")
      .select("id")
      .eq("job_key", this.request.jobId)
      .single();

    if (!job?.id) {
      return;
    }

    await this.context.supabase.from("generation_job_steps").upsert(
      {
        job_id: job.id,
        stage,
        status,
        detail,
        payload,
        completed_at: status === "completed" || status === "failed" || status === "needs_input" ? new Date().toISOString() : null,
      },
      { onConflict: "job_id,stage" },
    );
  }

  async updateValidationReport(report: ValidationReport) {
    await patchRestRows({
      supabaseUrl: this.context.supabaseUrl,
      serviceKey: this.context.serviceRoleKey,
      table: "generation_jobs",
      query: {
        job_key: `eq.${this.request.jobId}`,
      },
      payload: {
        validation_report: report,
      },
    });
  }

  async updateQualityReport(report: QualityReport) {
    await patchRestRows({
      supabaseUrl: this.context.supabaseUrl,
      serviceKey: this.context.serviceRoleKey,
      table: "generation_jobs",
      query: {
        job_key: `eq.${this.request.jobId}`,
      },
      payload: {
        quality_report: report,
      },
    });
  }

  async finalize(summary: GenerationRunSummary) {
    const parsedSummary = generationRunSummarySchema.parse(summary);

    await patchRestRows({
      supabaseUrl: this.context.supabaseUrl,
      serviceKey: this.context.serviceRoleKey,
      table: "generation_jobs",
      query: {
        job_key: `eq.${this.request.jobId}`,
      },
      payload: {
        status: parsedSummary.status,
        story_spec: parsedSummary.story,
        report_outline: parsedSummary.reportOutline ?? {},
        slide_plan: parsedSummary.slidePlan,
        validation_report: parsedSummary.validationReport ?? {},
        quality_report: parsedSummary.qualityReport ?? {},
        artifact_manifest: parsedSummary.artifactManifest ?? {},
        summary: parsedSummary,
        failure_message: parsedSummary.failureMessage || null,
        completed_at: parsedSummary.status === "completed" ? new Date().toISOString() : null,
      },
    });
  }

  async finalizeFailure(status: Extract<GenerationJobStatus, "failed" | "needs_input">, message: string, summary?: GenerationRunSummary) {
    await patchRestRows({
      supabaseUrl: this.context.supabaseUrl,
      serviceKey: this.context.serviceRoleKey,
      table: "generation_jobs",
      query: {
        job_key: `eq.${this.request.jobId}`,
      },
      payload: {
        status,
        failure_message: message,
        summary: summary ? generationRunSummarySchema.parse(summary) : null,
        completed_at: new Date().toISOString(),
      },
    });
  }

  private async persistSourceFile(
    file: GenerationRequest["sourceFiles"][number],
    input: { bucket: string; externalId: string },
  ): Promise<UploadedInputRecord | null> {
    const storageBucket = file.storageBucket ?? input.bucket;
    const storagePath = file.storagePath ?? `jobs/${this.request.jobId}/inputs/${sanitizeStorageSegment(file.fileName)}`;
    let fileBytes = file.fileBytes ?? 0;

    if (!file.storageBucket || !file.storagePath) {
      if (!file.base64) {
        return null;
      }

      const buffer = Buffer.from(file.base64, "base64");
      fileBytes = file.fileBytes ?? buffer.byteLength;

      try {
        await uploadToStorage({
          supabaseUrl: this.context.supabaseUrl,
          serviceKey: this.context.serviceRoleKey,
          bucket: storageBucket,
          storagePath,
          body: buffer,
          contentType: file.mediaType,
          upsert: true,
        });
      } catch {
        return null;
      }
    }

    const { data } = await this.context.supabase
      .from("source_files")
      .upsert(
        {
          external_id: input.externalId,
          organization_id: this.context.organizationId,
          project_id: this.context.projectId,
          uploaded_by: this.context.requestedBy,
          kind: file.kind ?? "unknown",
          file_name: file.fileName,
          media_type: file.mediaType,
          storage_bucket: storageBucket,
          storage_path: storagePath,
          file_bytes: fileBytes,
        },
        { onConflict: "external_id" },
      )
      .select("id")
      .single();

    if (!data?.id) {
      return null;
    }

    return {
      externalId: input.externalId,
      rowId: data.id,
      fileName: file.fileName,
    };
  }

  private resolveSourceFileRowId(datasetProfile: Record<string, unknown>) {
    const manifest = datasetProfile.manifest as Record<string, unknown> | undefined;
    const primaryFileId = typeof manifest?.primaryFileId === "string" ? manifest.primaryFileId : undefined;
    return primaryFileId ? this.sourceFiles.get(primaryFileId)?.rowId ?? null : null;
  }
}

async function resolveRunPersistenceContext(
  request: GenerationRequest,
  brief: GenerationRequest["brief"],
): Promise<RunPersistenceContext | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  try {
    const supabase = createServiceSupabaseClient(supabaseUrl, serviceRoleKey);
    const existingJobs = await fetchRestRows<{
      organization_id: string;
      project_id: string;
      requested_by: string | null;
    }>({
      supabaseUrl,
      serviceKey: serviceRoleKey,
      table: "generation_jobs",
      query: {
        select: "organization_id,project_id,requested_by",
        job_key: `eq.${request.jobId}`,
        limit: "1",
      },
    });

    if (existingJobs[0]?.organization_id && existingJobs[0]?.project_id) {
      return {
        supabase,
        supabaseUrl,
        serviceRoleKey,
        organizationId: existingJobs[0].organization_id,
        projectId: existingJobs[0].project_id,
        requestedBy: existingJobs[0].requested_by ?? null,
      };
    }

    const organizationSlug = sanitizeStorageSegment(request.organizationId || "local-org");
    const projectSlug = sanitizeStorageSegment(request.projectId || "local-project");

    const organizations = await upsertRestRows<{ id: string }>({
      supabaseUrl,
      serviceKey: serviceRoleKey,
      table: "organizations",
      onConflict: "slug",
      select: "id",
      rows: [
        {
          slug: organizationSlug,
          name: humanizeLabel(request.organizationId || "Local org"),
        },
      ],
    });

    if (!organizations[0]?.id) {
      return null;
    }

    const projects = await upsertRestRows<{ id: string }>({
      supabaseUrl,
      serviceKey: serviceRoleKey,
      table: "projects",
      onConflict: "organization_id,slug",
      select: "id",
      rows: [
        {
          organization_id: organizations[0].id,
          slug: projectSlug,
          name: humanizeLabel(request.projectId || "Local project"),
          objective: brief.objective,
          audience: brief.audience,
        },
      ],
    });

    if (!projects[0]?.id) {
      return null;
    }

    return {
      supabase,
      supabaseUrl,
      serviceRoleKey,
      organizationId: organizations[0].id,
      projectId: projects[0].id,
      requestedBy: null,
    };
  } catch {
    return null;
  }
}

function sanitizeStorageSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function humanizeLabel(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || value;
}
