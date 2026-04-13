import { createHash } from "node:crypto";

import { interpretTemplateSource } from "@basquio/template-engine";
import type { TemplateProfile } from "@basquio/types";

import {
  claimServiceIdempotencyKey,
  completeServiceIdempotencyKey,
  releaseServiceIdempotencyKey,
} from "./idempotency-claims";
import { sendResendHtmlEmail } from "./resend";
import { downloadFromStorage, fetchRestRows, patchRestRows, upsertRestRows } from "./supabase";

type ImportJobRow = {
  id: string;
  organization_id: string;
  requested_by: string | null;
  source_file_id: string;
  template_profile_id: string | null;
  status: string;
  set_as_default: boolean;
  name: string | null;
};

type SourceFileRow = {
  id: string;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  kind: string;
};

type Config = {
  supabaseUrl: string;
  serviceKey: string;
};

/**
 * Run a template import job end-to-end.
 * Phases: normalize -> interpret -> validate -> preview -> finalize
 */
export async function runTemplateImportJob(jobId: string, config: Config) {
  const now = () => new Date().toISOString();

  try {
    // Load job
    const jobs = await fetchRestRows<ImportJobRow>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "template_import_jobs",
      query: {
        select: "id,organization_id,requested_by,source_file_id,template_profile_id,status,set_as_default,name",
        id: `eq.${jobId}`,
        limit: "1",
      },
    });
    const job = jobs[0];
    if (!job) throw new Error(`Import job ${jobId} not found.`);

    // Phase: normalize
    await markImportPhase(config, jobId, "normalize");

    const sourceFiles = await fetchRestRows<SourceFileRow>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "source_files",
      query: {
        select: "id,file_name,storage_bucket,storage_path,kind",
        id: `eq.${job.source_file_id}`,
        limit: "1",
      },
    });
    const sourceFile = sourceFiles[0];
    if (!sourceFile) throw new Error(`Source file ${job.source_file_id} not found.`);

    const buffer = await downloadFromStorage({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: sourceFile.storage_bucket,
      storagePath: sourceFile.storage_path,
    });

    // Phase: interpret
    await markImportPhase(config, jobId, "interpret");

    const profile = await interpretTemplateSource({
      id: job.template_profile_id ?? jobId,
      fileName: sourceFile.file_name,
      sourceFile: {
        fileName: sourceFile.file_name,
        base64: buffer.toString("base64"),
      },
    });

    // Phase: validate
    await markImportPhase(config, jobId, "validate");

    const layoutCount = profile.layouts?.length ?? 0;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({
        colors: profile.colors,
        fonts: profile.fonts,
        layoutCount,
        sourceType: profile.sourceType,
      }))
      .digest("hex")
      .slice(0, 16);

    // Phase: preview
    await markImportPhase(config, jobId, "preview");

    const previewPayload = buildPreviewPayload(profile, layoutCount);
    const templateName = job.name || profile.templateName || sourceFile.file_name.replace(/\.[^.]+$/, "");

    // Phase: finalize — persist template profile
    await markImportPhase(config, jobId, "finalize");

    const templateProfileId = job.template_profile_id!;
    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "template_profiles",
      query: { id: `eq.${templateProfileId}` },
      payload: {
        template_profile: profile,
        source_type: profile.sourceType ?? "pptx",
        name: templateName,
        status: "ready",
        fingerprint,
        layout_count: layoutCount,
        preview_payload: previewPayload,
        updated_at: now(),
      },
    });

    // Set as workspace default if requested
    if (job.set_as_default) {
      await upsertRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "organization_template_settings",
        onConflict: "organization_id",
        rows: [{
          organization_id: job.organization_id,
          default_template_profile_id: templateProfileId,
          updated_at: now(),
        }],
      });
    }

    // Mark job completed
    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "template_import_jobs",
      query: { id: `eq.${jobId}` },
      payload: {
        status: "completed",
        completed_at: now(),
        updated_at: now(),
      },
    });

    // Send notification
    await notifyTemplateImportCompletion(config, jobId, job, templateName, true).catch(() => {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template import failed.";
    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "template_import_jobs",
      query: { id: `eq.${jobId}` },
      payload: {
        status: "failed",
        failure_message: message.slice(0, 500),
        updated_at: now(),
      },
    }).catch(() => {});

    // Mark template profile as failed
    const jobs = await fetchRestRows<{ template_profile_id: string | null; name: string | null; requested_by: string | null; organization_id: string }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "template_import_jobs",
      query: { select: "template_profile_id,name,requested_by,organization_id", id: `eq.${jobId}`, limit: "1" },
    }).catch(() => []);
    const job = jobs[0];
    if (job?.template_profile_id) {
      await patchRestRows({
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        table: "template_profiles",
        query: { id: `eq.${job.template_profile_id}` },
        payload: {
          status: "failed",
          failure_message: message.slice(0, 500),
          updated_at: now(),
        },
      }).catch(() => {});
    }

    if (job) {
      await notifyTemplateImportCompletion(
        config,
        jobId,
        { ...job, requested_by: job.requested_by },
        job.name ?? "template",
        false,
      ).catch(() => {});
    }

    throw error;
  }
}

function buildPreviewPayload(profile: TemplateProfile, layoutCount: number) {
  return {
    templateName: profile.templateName ?? null,
    sourceType: profile.sourceType ?? "pptx",
    colors: (profile.colors ?? []).slice(0, 8),
    fonts: (profile.fonts ?? []).slice(0, 4),
    headingFont: profile.brandTokens?.typography?.headingFont ?? null,
    bodyFont: profile.brandTokens?.typography?.bodyFont ?? null,
    layoutCount,
    layoutNames: (profile.layouts ?? []).slice(0, 6).map((l) => l.name),
  };
}

async function markImportPhase(config: Config, jobId: string, phase: string) {
  await patchRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "template_import_jobs",
    query: { id: `eq.${jobId}` },
    payload: {
      current_phase: phase,
      updated_at: new Date().toISOString(),
    },
  });
}

async function notifyTemplateImportCompletion(
  config: Config,
  jobId: string,
  job: { requested_by: string | null; organization_id: string },
  templateName: string,
  success: boolean,
) {
  const resendApiKey = process.env.RESEND_API_KEY ?? process.env.RESEND_CURSOR_API_KEY;
  if (!resendApiKey || !job.requested_by) return;

  // Historical note:
  // A pre-2026-04-08 welcome-email path caused duplicate sends in production.
  // This template-import notification is separate and still needs its own durable claim.
  const sentCheck = await fetchRestRows<{ import_email_sent_at: string | null }>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "template_import_jobs",
    query: {
      select: "import_email_sent_at",
      id: `eq.${jobId}`,
      limit: "1",
    },
  }).catch(() => []);
  if (sentCheck[0]?.import_email_sent_at) return;

  const idempotencyKey = `template-import-email:${jobId}`;
  const claimed = await claimServiceIdempotencyKey(config, {
    id: idempotencyKey,
    scope: "template_import_email",
    metadata: {
      jobId,
      templateName,
      success,
    },
    staleAfterSeconds: 23 * 60 * 60,
  });
  if (!claimed) return;

  // Check account-level notification preference
  try {
    const prefRows = await fetchRestRows<{ notify_on_run_complete: boolean }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "user_preferences",
      query: {
        select: "notify_on_run_complete",
        user_id: `eq.${job.requested_by}`,
        limit: "1",
      },
    });
    if (prefRows[0] && prefRows[0].notify_on_run_complete === false) {
      await completeServiceIdempotencyKey(config, {
        id: idempotencyKey,
        metadata: { outcome: "skipped_preference" },
      }).catch(() => {});
      return;
    }
  } catch {
    // Default to sending if preference lookup fails
  }

  // Resolve email
  const response = await fetch(
    `${config.supabaseUrl}/auth/v1/admin/users/${job.requested_by}`,
    {
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
      },
    },
  );
  if (!response.ok) {
    await completeServiceIdempotencyKey(config, {
      id: idempotencyKey,
      metadata: { outcome: "skipped_missing_user" },
    }).catch(() => {});
    return;
  }
  const user = (await response.json()) as { email?: string };
  if (!user.email) {
    await completeServiceIdempotencyKey(config, {
      id: idempotencyKey,
      metadata: { outcome: "skipped_missing_email" },
    }).catch(() => {});
    return;
  }

  const subject = success
    ? "Your Basquio template is ready"
    : "We couldn't finish preparing your Basquio template";

  const body = success
    ? `<body style="background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0;padding:40px 20px;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;margin:0 auto;">
<tr><td>
<p style="color:#94A3B8;font-size:11px;font-weight:600;letter-spacing:1.5px;margin:0 0 16px;text-transform:uppercase;">TEMPLATE READY</p>
<p style="color:#0b0c0c;font-size:14px;line-height:24px;margin:0 0 20px;">Your template "${templateName}" has been mapped and is ready to use on future reports.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
<tr><td>
<a href="https://basquio.com/templates" style="background-color:#1a6aff;border-radius:4px;color:#FFFFFF;display:inline-block;font-size:14px;font-weight:600;padding:12px 24px;text-decoration:none;">View templates</a>
</td></tr>
</table>
</td></tr>
</table></body>`
    : `<body style="background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0;padding:40px 20px;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;margin:0 auto;">
<tr><td>
<p style="color:#94A3B8;font-size:11px;font-weight:600;letter-spacing:1.5px;margin:0 0 16px;text-transform:uppercase;">TEMPLATE IMPORT FAILED</p>
<p style="color:#0b0c0c;font-size:14px;line-height:24px;margin:0 0 20px;">We couldn't map "${templateName}". You can try uploading again or use Basquio Standard in the meantime.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
<tr><td>
<a href="https://basquio.com/templates" style="background-color:#1a6aff;border-radius:4px;color:#FFFFFF;display:inline-block;font-size:14px;font-weight:600;padding:12px 24px;text-decoration:none;">Try again</a>
</td></tr>
</table>
</td></tr>
</table></body>`;

  const emailResult = await sendResendHtmlEmail({
    apiKey: resendApiKey,
    from: "Marco at Basquio <reports@basquio.com>",
    to: [user.email],
    idempotencyKey,
    subject,
    html: body,
  });

  if (emailResult.status === "rejected") {
    await releaseServiceIdempotencyKey(config, idempotencyKey).catch(() => {});
    return;
  }

  if (emailResult.status === "unknown") {
    return;
  }

  const sentAt = new Date().toISOString();
  await completeServiceIdempotencyKey(config, {
    id: idempotencyKey,
    metadata: {
      outcome: "sent",
      messageId: emailResult.messageId,
      recipient: user.email,
    },
  }).catch(() => {});

  await patchRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "template_import_jobs",
    query: { id: `eq.${jobId}` },
    payload: { import_email_sent_at: sentAt },
  }).catch(() => {});
}
