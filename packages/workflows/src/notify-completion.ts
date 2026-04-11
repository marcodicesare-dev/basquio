import { fetchRestRows, patchRestRows } from "./supabase";

type NotifyConfig = {
  supabaseUrl: string;
  serviceKey: string;
  resendApiKey: string;
};

type CompletionContext = {
  runId: string;
  slideCount: number;
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

/**
 * Check notify_on_complete preference and send a completion email if requested.
 * Idempotent: skips if completion_email_sent_at is already set.
 * Best-effort: failures are logged but never propagate to the caller.
 */
export async function notifyRunCompletionIfRequested(
  config: NotifyConfig,
  run: { id: string; requested_by: string | null },
  context: CompletionContext,
) {
  try {
    if (!config.resendApiKey) return;
    if (!run.requested_by) return;

    // Check preference + idempotency in one query
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

    // Resolve the user's email from Supabase Auth admin API
    const email = await resolveUserEmail(config, run.requested_by);
    if (!email) return;

    const sent = await sendCompletionEmail(config.resendApiKey, {
      to: email,
      runId: context.runId,
      slideCount: context.slideCount,
    });
    if (!sent) return;

    // Mark as sent (idempotency guard)
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

async function resolveUserEmail(
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

async function sendCompletionEmail(
  resendApiKey: string,
  params: {
    to: string;
    runId: string;
    slideCount: number;
  },
): Promise<boolean> {
  const progressUrl = `https://basquio.com/jobs/${params.runId}`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: "Basquio <reports@basquio.com>",
      to: [params.to],
      subject: "Your deck is ready",
      html: buildCompletionHtml(params.slideCount, progressUrl),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.warn(`[basquio] Resend API ${response.status}: ${body}`);
    return false;
  }

  return true;
}

function buildCompletionHtml(
  slideCount: number,
  progressUrl: string,
) {
  return `<body style="background-color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px 20px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 520px; margin: 0 auto;">
    <tr>
      <td>
        <p style="color: #94A3B8; font-size: 11px; font-weight: 600; letter-spacing: 1.5px; margin: 0 0 16px 0; text-transform: uppercase;">DECK READY</p>
        <img src="https://basquio.com/brand/png/logo/1x/basquio-logo-light-bg-blue.png" alt="Basquio" width="100" height="auto" style="display: block; margin-bottom: 32px;">
        <p style="color: #0b0c0c; font-size: 14px; line-height: 24px; margin: 0 0 20px 0;">Your ${slideCount}-slide deck is ready. Download the PPTX, narrative report, and data workbook.</p>
        <table cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
          <tr>
            <td>
              <a href="${progressUrl}" style="background-color: #1a6aff; border-radius: 4px; color: #FFFFFF; display: inline-block; font-size: 14px; font-weight: 600; padding: 12px 24px; text-decoration: none;">View your deck</a>
            </td>
          </tr>
        </table>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid #E2E8F0; margin-top: 32px; padding-top: 24px;">
          <tr>
            <td style="vertical-align: middle;">
              <img src="https://basquio.com/brand/png/logo/1x/basquio-logo-light-bg-blue.png" alt="Basquio" width="60" height="auto" style="display: block; margin-bottom: 4px;">
              <p style="color: #94A3B8; font-size: 12px; margin: 0;">Evidence in. Executive deck out.</p>
            </td>
            <td align="right" style="vertical-align: middle;">
              <img src="https://basquio.com/brand/png/icon/1x/basquio-icon-onyx.png" alt="Basquio" width="32" height="32" style="display: block;">
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`;
}
