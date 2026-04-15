import { createServiceSupabaseClient, fetchRestRows, patchRestRows } from "./supabase";
import { classifyFailureMessage } from "./failure-classifier";
import { sendResendHtmlEmail, type ResendSendResult } from "./resend";

export type NotifyConfig = {
  supabaseUrl: string;
  serviceKey: string;
  resendApiKey: string;
};

type CompletionContext = {
  runId: string;
  slideCount: number;
  headline?: string | null;
};

type FailureContext = {
  runId: string;
  failureMessage: string;
  parseWarnings?: string[];
};

type CompletionVariant = "first_run_clean" | "first_run_after_retry" | "returning";
type RunEmailVariant = CompletionVariant | "waiting" | "failed";

type PreviewAsset = {
  position: number;
  fileName: string;
  mimeType: string;
  storageBucket: string;
  storagePath: string;
  fileBytes?: number;
};

type RunNotificationRow = {
  notify_on_complete: boolean;
  completion_email_sent_at: string | null;
  brief: Record<string, unknown> | null;
  created_at: string;
};

type CompletionEmailContext = {
  variant: CompletionVariant;
  lastFailureAt: string | null;
  creditsRemaining: number | null;
  briefExcerpt: string | null;
};

type UserIdentity = {
  email: string | null;
  firstName: string | null;
};

const STANDARD_SONNET_DECK_CREDITS = 13;

function isSupabaseSecretKey(value: string) {
  return value.startsWith("sb_secret_");
}

function isJwtLikeKey(value: string) {
  return value.split(".").length === 3;
}

function buildAuthAdminHeaders(serviceKey: string) {
  const headers = new Headers({
    apikey: serviceKey,
  });

  if (isJwtLikeKey(serviceKey) && !isSupabaseSecretKey(serviceKey)) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }

  return headers;
}

export async function notifyRunCompletionIfRequested(
  config: NotifyConfig,
  run: { id: string; requested_by: string | null },
  context: CompletionContext,
) {
  let claimedAt: string | null = null;
  try {
    if (!config.resendApiKey) return;
    if (!run.requested_by) return;

    const rows = await fetchRestRows<RunNotificationRow>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        select: "notify_on_complete,completion_email_sent_at,brief,created_at",
        id: `eq.${run.id}`,
        limit: "1",
      },
    });

    if (!rows[0]?.notify_on_complete) return;
    if (rows[0].completion_email_sent_at) return;

    const claim = await claimCompletionEmailSend(config, run.id);
    if (!claim.shouldSend) return;
    claimedAt = claim.claimedAt;

    const [identity, emailContext] = await Promise.all([
      resolveUserIdentity(config, run.requested_by),
      buildCompletionEmailContext(config, {
        userId: run.requested_by,
        runId: run.id,
        runCreatedAt: rows[0].created_at,
        brief: rows[0].brief,
      }),
    ]);
    if (!identity.email) {
      await releaseCompletionEmailClaim(config, run.id, claimedAt);
      return;
    }

    const sent = await sendRunDeliveryEmail(config, {
      to: identity.email,
      runId: context.runId,
      slideCount: context.slideCount,
      headline: context.headline ?? null,
      variant: emailContext.variant,
      firstName: identity.firstName,
      creditsRemaining: emailContext.creditsRemaining,
      lastFailureAt: emailContext.lastFailureAt,
      briefExcerpt: emailContext.briefExcerpt,
    });
    if (sent.status === "rejected") {
      await releaseCompletionEmailClaim(config, run.id, claimedAt);
    }
  } catch (error) {
    await releaseCompletionEmailClaim(config, run.id, claimedAt);
    console.warn(`[basquio] completion email failed (non-fatal):`, error);
  }
}

export async function notifyRunFailureIfRequested(
  config: NotifyConfig,
  run: { id: string; requested_by: string | null },
  context: FailureContext,
) {
  let claimedAt: string | null = null;
  try {
    if (!config.resendApiKey) return;
    if (!run.requested_by) return;

    const rows = await fetchRestRows<RunNotificationRow>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        select: "notify_on_complete,completion_email_sent_at,brief,created_at",
        id: `eq.${run.id}`,
        limit: "1",
      },
    });

    if (!rows[0]?.notify_on_complete) return;
    if (rows[0].completion_email_sent_at) return;

    const claim = await claimCompletionEmailSend(config, run.id);
    if (!claim.shouldSend) return;
    claimedAt = claim.claimedAt;

    const identity = await resolveUserIdentity(config, run.requested_by);
    if (!identity.email) {
      await releaseCompletionEmailClaim(config, run.id, claimedAt);
      return;
    }

    const failureClassification = classifyFailureMessage(context.failureMessage);
    const sent = await sendRunDeliveryEmail(config, {
      to: identity.email,
      runId: context.runId,
      slideCount: 0,
      variant: "failed",
      firstName: identity.firstName,
      failureClass: failureClassification.class,
      failureMessage: context.failureMessage,
      retryUrl: `https://basquio.com/jobs/new?from=${context.runId}`,
      parseWarnings: context.parseWarnings ?? [],
      creditsRefunded: true,
    });
    if (sent.status === "rejected") {
      await releaseCompletionEmailClaim(config, run.id, claimedAt);
    }
  } catch (error) {
    await releaseCompletionEmailClaim(config, run.id, claimedAt);
    console.warn(`[basquio] failure email failed (non-fatal):`, error);
  }
}

async function claimCompletionEmailSend(
  config: NotifyConfig,
  runId: string,
): Promise<{ shouldSend: boolean; claimedAt: string | null }> {
  const claimedAt = new Date().toISOString();
  const claimedRows = await patchRestRows<RunNotificationRow>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: {
      id: `eq.${runId}`,
      completion_email_sent_at: "is.null",
    },
    payload: {
      completion_email_sent_at: claimedAt,
    },
    select: "notify_on_complete,completion_email_sent_at,brief,created_at",
  }).catch(() => []);

  return {
    shouldSend: claimedRows.length > 0,
    claimedAt: claimedRows.length > 0 ? claimedAt : null,
  };
}

async function releaseCompletionEmailClaim(
  config: NotifyConfig,
  runId: string,
  claimedAt: string | null,
) {
  if (!claimedAt) {
    return;
  }

  await patchRestRows({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "deck_runs",
    query: {
      id: `eq.${runId}`,
      completion_email_sent_at: `eq.${claimedAt}`,
    },
    payload: {
      completion_email_sent_at: null,
    },
  }).catch(() => {});
}

export async function resolveUserEmail(
  config: { supabaseUrl: string; serviceKey: string },
  userId: string,
): Promise<string | null> {
  const identity = await resolveUserIdentity(config, userId);
  return identity.email;
}

export async function resolveUserIdentity(
  config: { supabaseUrl: string; serviceKey: string },
  userId: string,
): Promise<UserIdentity> {
  const response = await fetch(
    `${config.supabaseUrl}/auth/v1/admin/users/${userId}`,
    {
      headers: buildAuthAdminHeaders(config.serviceKey),
    },
  );

  if (!response.ok) {
    return {
      email: null,
      firstName: null,
    };
  }

  const user = (await response.json()) as {
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
  const fullName = [
    typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
    typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null,
  ].find((value): value is string => Boolean(value?.trim())) ?? null;

  return {
    email: user.email ?? null,
    firstName: extractFirstName(fullName),
  };
}

export async function sendRunDeliveryEmail(
  config: NotifyConfig,
  params: {
    to: string;
    runId: string;
    slideCount: number;
    headline?: string | null;
    variant: RunEmailVariant;
    firstName?: string | null;
    creditsRemaining?: number | null;
    lastFailureAt?: string | null;
    briefExcerpt?: string | null;
    failureClass?: string | null;
    failureMessage?: string | null;
    retryUrl?: string | null;
    parseWarnings?: string[];
    creditsRefunded?: boolean;
  },
): Promise<ResendSendResult> {
  const progressUrl = `https://basquio.com/jobs/${params.runId}`;
  const previewUrls = await resolveSignedPreviewUrls(config, params.runId);
  return sendResendHtmlEmail({
    apiKey: config.resendApiKey,
    from: "Marco at Basquio <reports@basquio.com>",
    to: [params.to],
    idempotencyKey: `run-email-${params.variant}-${params.runId}`,
    subject: buildRunEmailSubject(params),
    html: buildRunEmailHtml({
      progressUrl,
      previewUrls,
      slideCount: params.slideCount,
      headline: params.headline ?? null,
      variant: params.variant,
      firstName: params.firstName ?? null,
      creditsRemaining: params.creditsRemaining ?? null,
      lastFailureAt: params.lastFailureAt ?? null,
      briefExcerpt: params.briefExcerpt ?? null,
      failureClass: params.failureClass ?? null,
      failureMessage: params.failureMessage ?? null,
      retryUrl: params.retryUrl ?? null,
      parseWarnings: params.parseWarnings ?? [],
      creditsRefunded: params.creditsRefunded ?? false,
    }),
  });
}

async function resolveSignedPreviewUrls(
  config: { supabaseUrl: string; serviceKey: string },
  runId: string,
) {
  const rows = await fetchRestRows<{ preview_assets: unknown }>({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    table: "artifact_manifests_v2",
    query: {
      select: "preview_assets",
      run_id: `eq.${runId}`,
      limit: "1",
    },
  }).catch(() => []);

  const previewAssets = normalizePreviewAssets(rows[0]?.preview_assets);
  if (previewAssets.length === 0) {
    return [];
  }

  const supabase = createServiceSupabaseClient(config.supabaseUrl, config.serviceKey);
  const results: Array<{ position: number; url: string }> = [];

  for (const asset of previewAssets.slice(0, 3)) {
    const { data, error } = await supabase.storage
      .from(asset.storageBucket)
      .createSignedUrl(asset.storagePath, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) {
      continue;
    }
    results.push({
      position: asset.position,
      url: data.signedUrl,
    });
  }

  return results;
}

function normalizePreviewAssets(value: unknown): PreviewAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const assets: PreviewAsset[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.position !== "number" ||
      typeof record.fileName !== "string" ||
      typeof record.mimeType !== "string" ||
      typeof record.storageBucket !== "string" ||
      typeof record.storagePath !== "string"
    ) {
      continue;
    }

    assets.push({
        position: record.position,
        fileName: record.fileName,
        mimeType: record.mimeType,
        storageBucket: record.storageBucket,
        storagePath: record.storagePath,
        fileBytes: typeof record.fileBytes === "number" ? record.fileBytes : undefined,
      });
  }

  return assets.sort((left, right) => left.position - right.position);
}

function buildRunEmailSubject(params: {
  slideCount: number;
  headline?: string | null;
  variant: RunEmailVariant;
  failureClass?: string | null;
}) {
  if (params.variant === "failed") {
    if (params.failureClass === "transient_provider") {
      return "Temporary issue - your deck will be ready soon";
    }
    return "Your deck couldn't be completed";
  }

  const subjectHead = params.variant === "waiting" ? "Your deck is still waiting" : "Your deck is ready";
  if (!params.headline) {
    return subjectHead;
  }

  const trimmedHeadline = params.headline.trim();
  if (!trimmedHeadline) {
    return subjectHead;
  }

  return `${subjectHead}: ${trimmedHeadline.slice(0, 80)}`;
}

function buildRunEmailHtml(input: {
  progressUrl: string;
  previewUrls: Array<{ position: number; url: string }>;
  slideCount: number;
  headline: string | null;
  variant: RunEmailVariant;
  firstName: string | null;
  creditsRemaining: number | null;
  lastFailureAt: string | null;
  briefExcerpt: string | null;
  failureClass: string | null;
  failureMessage: string | null;
  retryUrl: string | null;
  parseWarnings: string[];
  creditsRefunded: boolean;
}) {
  if (input.variant === "failed") {
    return buildFailureRunEmailHtml({
      ...input,
      variant: "failed",
    });
  }

  if (input.variant === "first_run_clean" || input.variant === "first_run_after_retry") {
    return buildFirstRunEmailHtml({
      ...input,
      variant: input.variant,
    });
  }

  return buildLegacyRunEmailHtml(input);
}

function buildLegacyRunEmailHtml(input: {
  progressUrl: string;
  previewUrls: Array<{ position: number; url: string }>;
  slideCount: number;
  headline: string | null;
  variant: RunEmailVariant;
  firstName: string | null;
  creditsRemaining: number | null;
  lastFailureAt: string | null;
  briefExcerpt: string | null;
  failureClass: string | null;
  failureMessage: string | null;
  retryUrl: string | null;
  parseWarnings: string[];
  creditsRefunded: boolean;
}) {
  const isWaitingReminder = input.variant === "waiting";
  const eyebrow = isWaitingReminder ? "DECK WAITING" : "DECK READY";
  const title = isWaitingReminder ? "Your deck is waiting for review." : "Your deck is ready.";
  const body = isWaitingReminder
    ? `Basquio finished your ${input.slideCount}-slide deck, but it looks like you have not opened the exports yet.`
    : `Your ${input.slideCount}-slide deck is ready. Download the PPTX, narrative report, and data workbook.`;
  const ctaLabel = isWaitingReminder ? "Open your deck" : "View your deck";
  const ctaUrl = appendEmailTracking(input.progressUrl, input.variant);
  const previewMarkup = input.previewUrls.length > 0
    ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 24px 0 8px 0;"><tr>${
        input.previewUrls.map((preview) => `<td style="padding-right: 8px; vertical-align: top;">
          <img src="${preview.url}" alt="Slide ${preview.position} preview" width="160" style="display:block; width:160px; max-width:100%; border-radius:10px; border:1px solid #E2E8F0;">
        </td>`).join("")
      }</tr></table>`
    : "";
  const headlineMarkup = input.headline
    ? `<p style="color: #0B0C0C; font-size: 15px; line-height: 24px; font-weight: 600; margin: 0 0 14px 0;">${escapeHtml(input.headline)}</p>`
    : "";
  const previewText = buildInboxPreviewText(input.slideCount);

  return `<body style="background-color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px 20px;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(previewText)}</div>
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 560px; margin: 0 auto;">
    <tr>
      <td style="padding: 30px; border: 1px solid #E5E7EB; border-radius: 16px; background: #FFFFFF;">
        <p style="color: #94A3B8; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; margin: 0 0 16px 0; text-transform: uppercase;">${eyebrow}</p>
        <img src="https://basquio.com/brand/png/logo/1x/basquio-logo-light-bg-blue.png" alt="Basquio" width="108" height="auto" style="display: block; margin-bottom: 28px;">
        <h1 style="color: #0B0C0C; font-size: 28px; line-height: 1.05; letter-spacing: -0.04em; margin: 0 0 14px 0;">${title}</h1>
        ${headlineMarkup}
        <p style="color: #4B5563; font-size: 15px; line-height: 24px; margin: 0 0 18px 0;">${body}</p>
        ${previewMarkup}
        <table cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td>
              <a href="${ctaUrl}" style="background-color: #1A6AFF; border-radius: 6px; color: #FFFFFF; display: inline-block; font-size: 14px; font-weight: 700; padding: 12px 22px; text-decoration: none;">${ctaLabel}</a>
            </td>
          </tr>
        </table>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 18px 0;">
          <tr>
            <td style="padding: 12px 14px; border: 1px solid #E8E4DB; border-radius: 8px; background: #FAFBFD; color: #4B5563; font-size: 14px; line-height: 22px;">
              <strong style="color: #0B0C0C;">Included:</strong> editable PPTX, markdown narrative, and the supporting Excel workbook.
            </td>
          </tr>
        </table>
        <p style="color: #94A3B8; font-size: 12px; line-height: 20px; margin: 0;">Evidence in. Executive deck out.</p>
      </td>
    </tr>
  </table>
</body>`;
}

function buildFirstRunEmailHtml(input: {
  progressUrl: string;
  previewUrls: Array<{ position: number; url: string }>;
  slideCount: number;
  headline: string | null;
  variant: "first_run_clean" | "first_run_after_retry";
  firstName: string | null;
  creditsRemaining: number | null;
  lastFailureAt: string | null;
  briefExcerpt: string | null;
  failureClass: string | null;
  failureMessage: string | null;
  retryUrl: string | null;
  parseWarnings: string[];
  creditsRefunded: boolean;
}) {
  const greeting = input.firstName ? `Hi ${escapeHtml(input.firstName)},` : "Hi there,";
  const mainLine = input.slideCount ? `Your ${input.slideCount}-slide deck is ready.` : "Your deck is ready.";
  const ctaUrl = appendEmailTracking(input.progressUrl, input.variant);
  const previewText = buildInboxPreviewText(input.slideCount);
  const eyebrow = input.variant === "first_run_after_retry" ? "DECK READY" : "FIRST DECK READY";
  const headlineValue = (input.headline ?? input.briefExcerpt)?.trim() || null;
  const headlineMarkup = headlineValue
    ? `<p style="color:#0B0C0C;font-size:15px;line-height:24px;font-weight:600;margin:0 0 14px 0;">${escapeHtml(headlineValue)}</p>`
    : "";
  const previewMarkup = input.previewUrls.length > 0
    ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 24px 0 8px 0;"><tr>${
        input.previewUrls.map((preview) => `<td style="padding-right: 8px; vertical-align: top;">
          <img src="${preview.url}" alt="Slide ${preview.position} preview" width="160" style="display:block; width:160px; max-width:100%; border-radius:10px; border:1px solid #E2E8F0;">
        </td>`).join("")
      }</tr></table>`
    : "";
  const acknowledgment = buildRetryAcknowledgment(input.variant, input.lastFailureAt);
  const creditSection = buildFirstRunCreditSection(input.creditsRemaining, input.variant);

  return `<body style="background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0;padding:40px 20px;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(previewText)}</div>
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr>
      <td style="padding:30px;border:1px solid #E5E7EB;border-radius:16px;background:#FFFFFF;">
        <p style="color:#94A3B8;font-size:11px;font-weight:700;letter-spacing:1.5px;margin:0 0 16px 0;text-transform:uppercase;">${eyebrow}</p>
        <img src="https://basquio.com/brand/png/logo/1x/basquio-logo-light-bg-blue.png" alt="Basquio" width="108" height="auto" style="display:block;margin-bottom:28px;">
        <p style="color:#0B0C0C;font-size:15px;line-height:24px;margin:0 0 16px 0;">${greeting}</p>
        <h1 style="color:#0B0C0C;font-size:28px;line-height:1.05;letter-spacing:-0.04em;margin:0 0 14px 0;">${escapeHtml(mainLine)}</h1>
        ${headlineMarkup}
        ${previewMarkup}
        <table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr>
            <td>
              <a href="${ctaUrl}" style="background-color:#1A6AFF;border-radius:6px;color:#FFFFFF;display:inline-block;font-size:14px;font-weight:700;padding:12px 22px;text-decoration:none;">View and download</a>
            </td>
          </tr>
        </table>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px 0;">
          <tr>
            <td style="padding:12px 14px;border:1px solid #E8E4DB;border-radius:8px;background:#FAFBFD;color:#4B5563;font-size:14px;line-height:22px;">
              <strong style="color:#0B0C0C;">Included:</strong> editable PPTX, narrative report with methodology and findings, and the supporting data workbook.
            </td>
          </tr>
        </table>
        ${acknowledgment ? `<p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">${escapeHtml(acknowledgment)}</p>` : ""}
        <p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">Open the narrative alongside the deck. It walks through the reasoning behind every chart and calls out what surprised us in the numbers.</p>
        ${creditSection}
        <p style="color:#94A3B8;font-size:12px;line-height:20px;margin:0;">Evidence in. Executive deck out.</p>
      </td>
    </tr>
  </table>
</body>`;
}

function buildFailureRunEmailHtml(input: {
  progressUrl: string;
  previewUrls: Array<{ position: number; url: string }>;
  slideCount: number;
  headline: string | null;
  variant: "failed";
  firstName: string | null;
  creditsRemaining: number | null;
  lastFailureAt: string | null;
  briefExcerpt: string | null;
  failureClass: string | null;
  failureMessage: string | null;
  retryUrl: string | null;
  parseWarnings: string[];
  creditsRefunded: boolean;
}) {
  if (input.failureClass === "transient_provider") {
    return buildTransientProviderFailureEmailHtml({
      ...input,
      variant: "failed",
    });
  }

  const greeting = input.firstName ? `Hi ${escapeHtml(input.firstName)},` : "Hi there,";
  const previewText = "Your deck run hit an issue";
  const retryUrl = appendEmailTracking(input.retryUrl ?? "https://basquio.com/jobs/new", input.variant);
  const parseWarningMarkup = input.parseWarnings.length > 0
    ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px 0;">
        <tr>
          <td style="padding:12px 14px;border:1px solid #F3D3A1;border-radius:8px;background:#FFF8ED;color:#7C5200;font-size:14px;line-height:22px;">
            <strong style="color:#5C3B00;">File warning:</strong> We had trouble reading part of your upload.${input.parseWarnings[0] ? ` ${escapeHtml(input.parseWarnings[0])}` : ""} Try CSV or XLSX if you want the cleanest rerun.
          </td>
        </tr>
      </table>`
    : "";
  const refundLine = input.creditsRefunded
    ? `<p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">Your credits have been restored automatically.</p>`
    : "";
  const failureDetail = input.failureMessage?.trim()
    ? `<p style="color:#6B7280;font-size:14px;line-height:22px;margin:0 0 18px 0;">${escapeHtml(input.failureMessage.trim().slice(0, 220))}</p>`
    : "";

  return `<body style="background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0;padding:40px 20px;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(previewText)}</div>
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr>
      <td style="padding:30px;border:1px solid #E5E7EB;border-radius:16px;background:#FFFFFF;">
        <p style="color:#94A3B8;font-size:11px;font-weight:700;letter-spacing:1.5px;margin:0 0 16px 0;text-transform:uppercase;">RUN FAILED</p>
        <img src="https://basquio.com/brand/png/logo/1x/basquio-logo-light-bg-blue.png" alt="Basquio" width="108" height="auto" style="display:block;margin-bottom:28px;">
        <p style="color:#0B0C0C;font-size:15px;line-height:24px;margin:0 0 16px 0;">${greeting}</p>
        <h1 style="color:#0B0C0C;font-size:28px;line-height:1.05;letter-spacing:-0.04em;margin:0 0 14px 0;">Your deck couldn't be completed.</h1>
        <p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">Something went wrong while building your deck. We’ve saved the run state, and you can restart from it with one click.</p>
        ${failureDetail}
        ${parseWarningMarkup}
        ${refundLine}
        <table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr>
            <td>
              <a href="${retryUrl}" style="background-color:#1A6AFF;border-radius:6px;color:#FFFFFF;display:inline-block;font-size:14px;font-weight:700;padding:12px 22px;text-decoration:none;">Retry this run</a>
            </td>
          </tr>
        </table>
        <p style="color:#94A3B8;font-size:12px;line-height:20px;margin:0;">If this keeps happening, send us the source file and run ID so we can inspect the failure directly.</p>
      </td>
    </tr>
  </table>
</body>`;
}

function buildTransientProviderFailureEmailHtml(input: {
  progressUrl: string;
  previewUrls: Array<{ position: number; url: string }>;
  slideCount: number;
  headline: string | null;
  variant: "failed";
  firstName: string | null;
  creditsRemaining: number | null;
  lastFailureAt: string | null;
  briefExcerpt: string | null;
  failureClass: string | null;
  failureMessage: string | null;
  retryUrl: string | null;
  parseWarnings: string[];
  creditsRefunded: boolean;
}) {
  const greeting = input.firstName ? `Hi ${escapeHtml(input.firstName)},` : "Hi there,";
  const previewText = "Temporary issue with our AI provider";
  const retryUrl = appendEmailTracking(input.retryUrl ?? "https://basquio.com/jobs/new", input.variant);
  const refundLine = input.creditsRefunded
    ? `<p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">Your credits have been refunded. You can retry now or wait a few minutes for the provider to recover.</p>`
    : "";

  return `<body style="background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0;padding:40px 20px;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(previewText)}</div>
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr>
      <td style="padding:30px;border:1px solid #E5E7EB;border-radius:16px;background:#FFFFFF;">
        <p style="color:#94A3B8;font-size:11px;font-weight:700;letter-spacing:1.5px;margin:0 0 16px 0;text-transform:uppercase;">TEMPORARY ISSUE</p>
        <img src="https://basquio.com/brand/png/logo/1x/basquio-logo-light-bg-blue.png" alt="Basquio" width="108" height="auto" style="display:block;margin-bottom:28px;">
        <p style="color:#0B0C0C;font-size:15px;line-height:24px;margin:0 0 16px 0;">${greeting}</p>
        <h1 style="color:#0B0C0C;font-size:28px;line-height:1.05;letter-spacing:-0.04em;margin:0 0 14px 0;">Your deck hit a temporary provider issue.</h1>
        <p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">Our AI provider is having an outage right now. This is temporary and not related to your file or settings.</p>
        ${refundLine}
        <table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr>
            <td>
              <a href="${retryUrl}" style="background-color:#1A6AFF;border-radius:6px;color:#FFFFFF;display:inline-block;font-size:14px;font-weight:700;padding:12px 22px;text-decoration:none;">Retry your deck</a>
            </td>
          </tr>
        </table>
        <p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">This usually clears within minutes. You can also check the live provider status at <a href="https://status.anthropic.com" style="color:#1A6AFF;text-decoration:none;">status.anthropic.com</a>.</p>
        <p style="color:#94A3B8;font-size:12px;line-height:20px;margin:0;">Marco</p>
      </td>
    </tr>
  </table>
</body>`;
}

function buildInboxPreviewText(slideCount: number) {
  return slideCount > 0 ? `${slideCount} slides ready to download` : "Ready to download";
}

function buildRetryAcknowledgment(
  variant: "first_run_clean" | "first_run_after_retry",
  lastFailureAt: string | null,
) {
  if (variant !== "first_run_after_retry") {
    return null;
  }

  const lastFailureMs = lastFailureAt ? Date.parse(lastFailureAt) : Number.NaN;
  if (Number.isFinite(lastFailureMs) && Date.now() - lastFailureMs < 60 * 60 * 1000) {
    return "The earlier run hit a wall. This one came through.";
  }

  return "We know the first attempt didn't land. This one's good.";
}

function buildFirstRunCreditSection(
  creditsRemaining: number | null,
  variant: "first_run_clean" | "first_run_after_retry",
) {
  if (typeof creditsRemaining !== "number") {
    return "";
  }

  if (creditsRemaining <= 0) {
    return `<p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">You've used your free credits. <a href="${appendEmailTracking("https://basquio.com/pricing", variant)}" style="color:#1A6AFF;text-decoration:none;">See pricing</a> to keep going.</p>`;
  }

  if (creditsRemaining < STANDARD_SONNET_DECK_CREDITS) {
    const remainingDecks = Math.floor(creditsRemaining / STANDARD_SONNET_DECK_CREDITS);
    return `<p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">You have ${creditsRemaining} credits left, enough for ${remainingDecks} more run${remainingDecks === 1 ? "" : "s"}. <a href="${appendEmailTracking("https://basquio.com/pricing", variant)}" style="color:#1A6AFF;text-decoration:none;">See pricing</a>.</p>`;
  }

  return `<p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">You have ${creditsRemaining} credits. When you're ready for the next one: <a href="${appendEmailTracking("https://basquio.com/jobs/new", variant)}" style="color:#1A6AFF;text-decoration:none;">Generate another deck</a>.</p>`;
}

async function buildCompletionEmailContext(
  config: NotifyConfig,
  input: {
    userId: string;
    runId: string;
    runCreatedAt: string;
    brief: Record<string, unknown> | null;
  },
): Promise<CompletionEmailContext> {
  const [completedRows, failedRows, creditRows] = await Promise.all([
    fetchRestRows<{ id: string }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        select: "id",
        requested_by: `eq.${input.userId}`,
        status: "eq.completed",
        id: `neq.${input.runId}`,
        limit: "1",
      },
    }).catch(() => []),
    fetchRestRows<{ updated_at: string }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        select: "updated_at",
        requested_by: `eq.${input.userId}`,
        status: "eq.failed",
        created_at: `lt.${input.runCreatedAt}`,
        order: "updated_at.desc",
        limit: "1",
      },
    }).catch(() => []),
    fetchRestRows<{ balance: number }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "credit_balances",
      query: {
        select: "balance",
        user_id: `eq.${input.userId}`,
        limit: "1",
      },
    }).catch(() => []),
  ]);

  return {
    variant: pickCompletionVariant(completedRows.length, failedRows.length),
    lastFailureAt: failedRows[0]?.updated_at ?? null,
    creditsRemaining: typeof creditRows[0]?.balance === "number" ? creditRows[0].balance : null,
    briefExcerpt: extractBriefExcerpt(input.brief),
  };
}

function pickCompletionVariant(completedCount: number, failedCount: number): CompletionVariant {
  if (completedCount === 0) {
    return failedCount > 0 ? "first_run_after_retry" : "first_run_clean";
  }

  return "returning";
}

function extractBriefExcerpt(brief: Record<string, unknown> | null) {
  const value = typeof brief?.businessContext === "string"
    ? brief.businessContext
    : typeof brief?.objective === "string"
      ? brief.objective
      : "";

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function extractFirstName(fullName: string | null) {
  if (!fullName) {
    return null;
  }

  const [firstName] = fullName.trim().split(/\s+/);
  return firstName || null;
}

function appendEmailTracking(url: string, campaign: RunEmailVariant) {
  const parsed = new URL(url);
  parsed.searchParams.set("utm_source", "email");
  parsed.searchParams.set("utm_medium", "transactional");
  parsed.searchParams.set("utm_campaign", campaign);
  return parsed.toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
