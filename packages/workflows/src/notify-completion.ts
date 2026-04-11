import { createServiceSupabaseClient, fetchRestRows, patchRestRows } from "./supabase";

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

type RunEmailVariant = "completion" | "waiting";

type PreviewAsset = {
  position: number;
  fileName: string;
  mimeType: string;
  storageBucket: string;
  storagePath: string;
  fileBytes?: number;
};

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
  try {
    if (!config.resendApiKey) return;
    if (!run.requested_by) return;

    const rows = await fetchRestRows<{ notify_on_complete: boolean; completion_email_sent_at: string | null }>({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: {
        select: "notify_on_complete,completion_email_sent_at",
        id: `eq.${run.id}`,
        limit: "1",
      },
    });

    if (!rows[0]?.notify_on_complete) return;
    if (rows[0].completion_email_sent_at) return;

    const email = await resolveUserEmail(config, run.requested_by);
    if (!email) return;

    const sent = await sendRunDeliveryEmail(config, {
      to: email,
      runId: context.runId,
      slideCount: context.slideCount,
      headline: context.headline ?? null,
      variant: "completion",
    });
    if (!sent) return;

    await patchRestRows({
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      table: "deck_runs",
      query: { id: `eq.${run.id}` },
      payload: { completion_email_sent_at: new Date().toISOString() },
    });
  } catch (error) {
    console.warn(`[basquio] completion email failed (non-fatal):`, error);
  }
}

export async function resolveUserEmail(
  config: { supabaseUrl: string; serviceKey: string },
  userId: string,
): Promise<string | null> {
  const response = await fetch(
    `${config.supabaseUrl}/auth/v1/admin/users/${userId}`,
    {
      headers: buildAuthAdminHeaders(config.serviceKey),
    },
  );

  if (!response.ok) return null;

  const user = (await response.json()) as { email?: string };
  return user.email ?? null;
}

export async function sendRunDeliveryEmail(
  config: NotifyConfig,
  params: {
    to: string;
    runId: string;
    slideCount: number;
    headline?: string | null;
    variant: RunEmailVariant;
  },
): Promise<boolean> {
  const progressUrl = `https://basquio.com/jobs/${params.runId}`;
  const previewUrls = await resolveSignedPreviewUrls(config, params.runId);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.resendApiKey}`,
    },
    body: JSON.stringify({
      from: "Marco at Basquio <reports@basquio.com>",
      to: [params.to],
      subject: buildRunEmailSubject(params),
      html: buildRunEmailHtml({
        progressUrl,
        previewUrls,
        slideCount: params.slideCount,
        headline: params.headline ?? null,
        variant: params.variant,
      }),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.warn(`[basquio] Resend API ${response.status}: ${body}`);
    return false;
  }

  return true;
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
}) {
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
}) {
  const isWaitingReminder = input.variant === "waiting";
  const eyebrow = isWaitingReminder ? "DECK WAITING" : "DECK READY";
  const title = isWaitingReminder ? "Your deck is waiting for review." : "Your deck is ready.";
  const body = isWaitingReminder
    ? `Basquio finished your ${input.slideCount}-slide deck, but it looks like you have not opened the exports yet.`
    : `Your ${input.slideCount}-slide deck is ready. Download the PPTX, narrative report, and data workbook.`;
  const ctaLabel = isWaitingReminder ? "Open your deck" : "View your deck";
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

  return `<body style="background-color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px 20px;">
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
              <a href="${input.progressUrl}" style="background-color: #1A6AFF; border-radius: 6px; color: #FFFFFF; display: inline-block; font-size: 14px; font-weight: 700; padding: 12px 22px; text-decoration: none;">${ctaLabel}</a>
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
