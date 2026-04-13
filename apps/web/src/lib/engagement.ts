import { sendRunDeliveryEmail, resolveUserEmail } from "@basquio/workflows/notify-completion";

import { CREDIT_PACKS_CONFIG, PLAN_CONFIG } from "@/lib/billing-config";
import { calculateRunCredits } from "@/lib/credits";
import { sendResendHtmlEmail, type ResendSendResult } from "@/lib/resend";
import { deleteRestRows, fetchRestRows } from "@/lib/supabase/admin";

type SupabaseConfig = {
  supabaseUrl: string;
  serviceKey: string;
};

type EngagementConfig = SupabaseConfig & {
  resendApiKey: string;
};

type NotificationType = "low_credits" | "run_waiting" | "unfinished_setup";

export const LOW_CREDIT_THRESHOLD = calculateRunCredits(10, "claude-sonnet-4-6");
export const DOWNLOAD_TRACKING_FLOOR = "2026-04-11T15:00:00Z";

type SourceFileRow = {
  id: string;
  uploaded_by: string | null;
  file_name: string;
  storage_bucket: string;
  created_at: string;
};

type DeckRunRow = {
  id: string;
  requested_by: string | null;
  completed_at: string | null;
  objective: string | null;
};

type ArtifactDownloadEventRow = {
  id: string;
};

type ArtifactManifestSummaryRow = {
  slide_count: number;
};

type CoverSlideRow = {
  title: string;
};

export async function recordArtifactDownloadEvent(
  config: SupabaseConfig,
  input: {
    runId: string;
    userId: string;
    artifactKind: string;
    disposition: "attachment" | "inline";
  },
) {
  await postRow(config, "artifact_download_events", {
    run_id: input.runId,
    requested_by: input.userId,
    artifact_kind: input.artifactKind,
    disposition: input.disposition,
  }).catch(() => {});
}

export async function maybeSendLowCreditReminder(
  config: EngagementConfig,
  input: {
    userId: string;
    balance: number;
  },
) {
  if (input.balance >= LOW_CREDIT_THRESHOLD) {
    return false;
  }

  const notificationKey = `low-credit-threshold-13:${input.userId}`;
  const claimed = await claimEngagementNotification(config, {
    userId: input.userId,
    notificationKey,
    notificationType: "low_credits",
    payload: {
      balance: input.balance,
      threshold: LOW_CREDIT_THRESHOLD,
    },
  });

  if (!claimed) {
    return false;
  }

  try {
    const email = await resolveUserEmail(config, input.userId);
    if (!email) {
      throw new Error("User email not found.");
    }

    const sent = await sendResendEmail(config.resendApiKey, {
      idempotencyKey: notificationKey,
      to: email,
      subject: `You have ${input.balance} credits left on Basquio`,
      html: buildLowCreditHtml(input.balance),
    });

    if (sent.status === "rejected") {
      throw new Error("Resend send failed.");
    }

    return sent.status === "sent";
  } catch {
    await releaseEngagementNotification(config, notificationKey);
    return false;
  }
}

export async function sendWaitingRunReminder(
  config: EngagementConfig,
  input: {
    runId: string;
    userId: string;
    slideCount: number;
    headline: string | null;
  },
) {
  const notificationKey = `run-waiting:${input.runId}`;
  const claimed = await claimEngagementNotification(config, {
    userId: input.userId,
    runId: input.runId,
    notificationKey,
    notificationType: "run_waiting",
    payload: {
      slideCount: input.slideCount,
    },
  });

  if (!claimed) {
    return false;
  }

  try {
    const email = await resolveUserEmail(config, input.userId);
    if (!email) {
      throw new Error("User email not found.");
    }

    const sent = await sendRunDeliveryEmail(config, {
      to: email,
      runId: input.runId,
      slideCount: input.slideCount,
      headline: input.headline,
      variant: "waiting",
    });

    if (sent.status === "rejected") {
      throw new Error("Waiting reminder send failed.");
    }

    return sent.status === "sent";
  } catch {
    await releaseEngagementNotification(config, notificationKey);
    return false;
  }
}

export async function sendIncompleteSetupReminder(
  config: EngagementConfig,
  input: {
    userId: string;
    firstFileName: string;
    hasTemplateUpload: boolean;
  },
) {
  const notificationKey = `unfinished-setup:${input.userId}`;
  const claimed = await claimEngagementNotification(config, {
    userId: input.userId,
    notificationKey,
    notificationType: "unfinished_setup",
    payload: {
      firstFileName: input.firstFileName,
      hasTemplateUpload: input.hasTemplateUpload,
    },
  });

  if (!claimed) {
    return false;
  }

  try {
    const email = await resolveUserEmail(config, input.userId);
    if (!email) {
      throw new Error("User email not found.");
    }

    const sent = await sendResendEmail(config.resendApiKey, {
      idempotencyKey: notificationKey,
      to: email,
      subject: input.hasTemplateUpload
        ? "Your Basquio template is saved"
        : "Your Basquio workspace is ready to finish",
      html: buildIncompleteSetupHtml(input),
    });

    if (sent.status === "rejected") {
      throw new Error("Incomplete setup email failed.");
    }

    return sent.status === "sent";
  } catch {
    await releaseEngagementNotification(config, notificationKey);
    return false;
  }
}

export async function listCompletedRunsWithoutDownloads(
  config: SupabaseConfig,
  olderThanIso: string,
  limit = 50,
) {
  const runs = await fetchRestRows<DeckRunRow>({
    ...config,
    table: "deck_runs",
    query: {
      select: "id,requested_by,completed_at,objective",
      and: `(completed_at.lt.${olderThanIso},completed_at.gte.${DOWNLOAD_TRACKING_FLOOR})`,
      order: "completed_at.asc",
      limit: String(limit),
    },
  }).catch(() => []);

  const results: Array<DeckRunRow> = [];

  for (const run of runs) {
    if (!run.requested_by) {
      continue;
    }

    const downloads = await fetchRestRows<ArtifactDownloadEventRow>({
      ...config,
      table: "artifact_download_events",
      query: {
        select: "id",
        run_id: `eq.${run.id}`,
        limit: "1",
      },
    }).catch(() => []);

    if (downloads.length === 0) {
      results.push(run);
    }
  }

  return results;
}

export async function getRunReminderContext(
  config: SupabaseConfig,
  runId: string,
) {
  const [[manifest], [coverSlide]] = await Promise.all([
    fetchRestRows<ArtifactManifestSummaryRow>({
      ...config,
      table: "artifact_manifests_v2",
      query: {
        select: "slide_count",
        run_id: `eq.${runId}`,
        limit: "1",
      },
    }).catch(() => []),
    fetchRestRows<CoverSlideRow>({
      ...config,
      table: "deck_spec_v2_slides",
      query: {
        select: "title",
        run_id: `eq.${runId}`,
        position: "eq.1",
        order: "revision.desc",
        limit: "1",
      },
    }).catch(() => []),
  ]);

  return {
    slideCount: manifest?.slide_count ?? 10,
    headline: coverSlide?.title?.trim() || null,
  };
}

export async function listUnfinishedSetupCandidates(
  config: SupabaseConfig,
  olderThanIso: string,
  limit = 100,
) {
  const uploads = await fetchRestRows<SourceFileRow>({
    ...config,
    table: "source_files",
    query: {
      select: "id,uploaded_by,file_name,storage_bucket,created_at",
      created_at: `lt.${olderThanIso}`,
      order: "created_at.asc",
      limit: String(limit),
    },
  }).catch(() => []);

  const grouped = new Map<string, SourceFileRow[]>();
  for (const upload of uploads) {
    if (!upload.uploaded_by) {
      continue;
    }
    const current = grouped.get(upload.uploaded_by) ?? [];
    current.push(upload);
    grouped.set(upload.uploaded_by, current);
  }

  const candidates: Array<{ userId: string; firstFileName: string; hasTemplateUpload: boolean }> = [];

  for (const [userId, userUploads] of grouped.entries()) {
    const runs = await fetchRestRows<{ id: string }>({
      ...config,
      table: "deck_runs",
      query: {
        select: "id",
        requested_by: `eq.${userId}`,
        limit: "1",
      },
    }).catch(() => []);

    if (runs.length > 0) {
      continue;
    }

    const hasTemplateUpload = userUploads.some((upload) => upload.storage_bucket === "templates");
    candidates.push({
      userId,
      firstFileName: userUploads[0]?.file_name ?? "your uploaded file",
      hasTemplateUpload,
    });
  }

  return candidates;
}

async function claimEngagementNotification(
  config: SupabaseConfig,
  input: {
    userId: string;
    notificationKey: string;
    notificationType: NotificationType;
    runId?: string;
    payload?: Record<string, unknown>;
  },
) {
  try {
    await postRow(config, "user_engagement_notifications", {
      user_id: input.userId,
      notification_key: input.notificationKey,
      notification_type: input.notificationType,
      run_id: input.runId ?? null,
      payload: input.payload ?? {},
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("23505") || message.includes("duplicate")) {
      return false;
    }
    throw error;
  }
}

async function releaseEngagementNotification(config: SupabaseConfig, notificationKey: string) {
  await deleteRestRows({
    ...config,
    table: "user_engagement_notifications",
    query: {
      notification_key: `eq.${notificationKey}`,
    },
  }).catch(() => {});
}

async function postRow(
  config: SupabaseConfig,
  table: string,
  row: Record<string, unknown>,
) {
  const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: buildServiceHeaders(config.serviceKey, {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    }),
    body: JSON.stringify(row),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to insert ${table}: ${body}`);
  }
}

async function sendResendEmail(
  resendApiKey: string,
  input: {
    idempotencyKey?: string;
    to: string;
    subject: string;
    html: string;
  },
) : Promise<ResendSendResult> {
  return sendResendHtmlEmail({
    apiKey: resendApiKey,
    from: "Marco at Basquio <reports@basquio.com>",
    to: [input.to],
    idempotencyKey: input.idempotencyKey,
    subject: input.subject,
    html: input.html,
  });
}

function buildLowCreditHtml(balance: number) {
  const starterPrice = PLAN_CONFIG.starter.monthlyPrice;
  const freePackPrice = CREDIT_PACKS_CONFIG.free.pack_25.price;
  const decksLeft = balance >= LOW_CREDIT_THRESHOLD ? 1 : 0;

  return `<body style="background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0;padding:40px 20px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr>
      <td style="padding:30px;border:1px solid #E5E7EB;border-radius:16px;background:#FFFFFF;">
        <p style="color:#94A3B8;font-size:11px;font-weight:700;letter-spacing:1.5px;margin:0 0 16px 0;text-transform:uppercase;">CREDITS</p>
        <img src="https://basquio.com/brand/png/logo/1x/basquio-logo-light-bg-blue.png" alt="Basquio" width="108" height="auto" style="display:block;margin-bottom:28px;">
        <h1 style="color:#0B0C0C;font-size:28px;line-height:1.05;letter-spacing:-0.04em;margin:0 0 14px 0;">You have ${balance} credits left.</h1>
        <p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">That is ${decksLeft} more standard Deck run${decksLeft === 1 ? "" : "s"} before you need to top up.</p>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;">
          <tr>
            <td style="padding:12px 14px;border:1px solid #E8E4DB;border-radius:8px;background:#FAFBFD;color:#4B5563;font-size:14px;line-height:22px;">
              <strong style="color:#0B0C0C;">Options:</strong><br>
              Starter: $${starterPrice}/month for 30 credits<br>
              Credit pack: 25 credits for $${freePackPrice}
            </td>
          </tr>
        </table>
        <table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr>
            <td>
              <a href="https://basquio.com/pricing" style="background-color:#1A6AFF;border-radius:6px;color:#FFFFFF;display:inline-block;font-size:14px;font-weight:700;padding:12px 22px;text-decoration:none;">See pricing</a>
            </td>
          </tr>
        </table>
        <p style="color:#94A3B8;font-size:12px;line-height:20px;margin:0;">Purchased credits stay valid for 12 months.</p>
      </td>
    </tr>
  </table>
</body>`;
}

function buildIncompleteSetupHtml(input: { firstFileName: string; hasTemplateUpload: boolean }) {
  const headline = input.hasTemplateUpload ? "Your template is saved." : "Your files are still waiting.";
  const copy = input.hasTemplateUpload
    ? "You uploaded a template to Basquio but have not generated a deck yet. Your template is saved, so the next run can apply your branding automatically."
    : `You uploaded ${escapeHtml(input.firstFileName)} to Basquio but have not started a run yet.`;

  return `<body style="background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0;padding:40px 20px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr>
      <td style="padding:30px;border:1px solid #E5E7EB;border-radius:16px;background:#FFFFFF;">
        <p style="color:#94A3B8;font-size:11px;font-weight:700;letter-spacing:1.5px;margin:0 0 16px 0;text-transform:uppercase;">FINISH SETUP</p>
        <img src="https://basquio.com/brand/png/logo/1x/basquio-logo-light-bg-blue.png" alt="Basquio" width="108" height="auto" style="display:block;margin-bottom:28px;">
        <h1 style="color:#0B0C0C;font-size:28px;line-height:1.05;letter-spacing:-0.04em;margin:0 0 14px 0;">${headline}</h1>
        <p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 18px 0;">${copy}</p>
        <table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr>
            <td>
              <a href="https://basquio.com/jobs/new" style="background-color:#1A6AFF;border-radius:6px;color:#FFFFFF;display:inline-block;font-size:14px;font-weight:700;padding:12px 22px;text-decoration:none;">Finish your first run</a>
            </td>
            <td style="padding-left:12px;">
              <a href="https://basquio.com/jobs/new?sample=1" style="border:1px solid #CBD5E1;border-radius:6px;color:#0B0C0C;display:inline-block;font-size:14px;font-weight:700;padding:12px 22px;text-decoration:none;">Try sample data</a>
            </td>
          </tr>
        </table>
        <p style="color:#94A3B8;font-size:12px;line-height:20px;margin:0;">Evidence in. Executive deck out.</p>
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

function isSupabaseSecretKey(value: string) {
  return value.startsWith("sb_secret_");
}

function isJwtLikeKey(value: string) {
  return value.split(".").length === 3;
}

function buildServiceHeaders(serviceKey: string, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("apikey", serviceKey);

  if (isJwtLikeKey(serviceKey) && !isSupabaseSecretKey(serviceKey)) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }

  return headers;
}
