import { ensureFreeTierCredit } from "@/lib/credits";
import { notifySignup } from "@/lib/discord-customers";
import type { SignupAttribution } from "@/lib/signup-attribution";
import { fetchRestRows, patchRestRows, upsertRestRows } from "@/lib/supabase/admin";
import type { ViewerState } from "@/lib/supabase/auth";
import { ensureViewerWorkspace } from "@/lib/viewer-workspace";

type BootstrapStateRow = {
  user_id: string;
  first_authenticated_at: string;
  last_authenticated_at: string;
  workspace_initialized_at: string | null;
  welcome_email_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type BootstrapResult = {
  workspaceReady: boolean;
  welcomeEmailSent: boolean;
  welcomeEmailPreviouslySent: boolean;
};

export async function bootstrapViewerAccount(
  user: NonNullable<ViewerState["user"]>,
  options?: { signupAttribution?: SignupAttribution | null },
): Promise<BootstrapResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase admin configuration missing.");
  }

  const now = new Date().toISOString();
  const [[existingState], workspace] = await Promise.all([
    fetchRestRows<BootstrapStateRow>({
      supabaseUrl,
      serviceKey,
      table: "user_bootstrap_state",
      query: {
        select: "*",
        user_id: `eq.${user.id}`,
        limit: "1",
      },
    }).catch(() => []),
    ensureViewerWorkspace(user),
  ]);
  const workspaceReady = Boolean(workspace);

  await Promise.all([
    upsertRestRows<BootstrapStateRow>({
      supabaseUrl,
      serviceKey,
      table: "user_bootstrap_state",
      onConflict: "user_id",
      select: "*",
      rows: [
        {
          user_id: user.id,
          first_authenticated_at: existingState?.first_authenticated_at ?? now,
          last_authenticated_at: now,
          workspace_initialized_at: existingState?.workspace_initialized_at ?? (workspaceReady ? now : null),
          welcome_email_sent_at: existingState?.welcome_email_sent_at ?? null,
          updated_at: now,
        },
      ],
    }),
    ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: user.id }),
  ]);

  if (!existingState?.first_authenticated_at && user.email) {
    void notifySignup({
      email: user.email,
      sourceLabel: formatSignupSourceLabel(options?.signupAttribution ?? null),
    }).catch(() => {});
  }

  const welcomeEmailPreviouslySent = Boolean(existingState?.welcome_email_sent_at);
  let welcomeEmailSent = false;

  const resendApiKey = process.env.RESEND_API_KEY ?? process.env.RESEND_CURSOR_API_KEY;

  if (!welcomeEmailPreviouslySent && user.email && resendApiKey) {
    welcomeEmailSent = await sendWelcomeEmail({
      resendApiKey,
      email: user.email,
    });

    if (welcomeEmailSent) {
      await patchRestRows({
        supabaseUrl,
        serviceKey,
        table: "user_bootstrap_state",
        query: { user_id: `eq.${user.id}` },
        payload: {
          welcome_email_sent_at: now,
          updated_at: now,
        },
      });
    }
  }

  return {
    workspaceReady,
    welcomeEmailSent,
    welcomeEmailPreviouslySent,
  };
}

function formatSignupSourceLabel(signupAttribution: SignupAttribution | null): string | null {
  if (!signupAttribution?.source?.trim()) {
    return null;
  }

  const source = signupAttribution.source.trim().toLowerCase();
  const referrer = signupAttribution.referrer?.trim().toLowerCase() ?? "";
  const landingPath = sanitizeLandingPath(signupAttribution.landingPath);
  const sourceLabel = resolveSourceLabel(source, referrer);
  const queryParts = compactParts([
    signupAttribution.source ? `utm_source=${signupAttribution.source}` : null,
    signupAttribution.medium ? `utm_medium=${signupAttribution.medium}` : null,
    signupAttribution.campaign ? `utm_campaign=${signupAttribution.campaign}` : null,
  ]);

  const suffix = compactParts([
    landingPath ? `-> ${landingPath}` : null,
    queryParts.length > 0 ? `(${queryParts.join(", ")})` : null,
  ]).join(" ");

  return suffix ? `${sourceLabel} ${suffix}` : sourceLabel;
}

function resolveSourceLabel(source: string, referrer: string): string {
  if (source.includes("linkedin") || referrer.includes("linkedin.com")) {
    return "via LinkedIn";
  }
  if (source === "google" || referrer.includes("google.")) {
    return "via Google Search";
  }
  if (source === "twitter" || source === "x" || referrer.includes("twitter.com") || referrer.includes("x.com")) {
    return "via X/Twitter";
  }
  if (source.includes("producthunt")) {
    return "via Product Hunt";
  }
  if (source.includes("taaft") || source.includes("theresanaiforthat") || referrer.includes("theresanaiforthat.com")) {
    return "via There's An AI For That";
  }
  if (referrer.includes("basquio.com")) {
    return "direct / returning visitor";
  }
  if (source === "direct") {
    return "direct";
  }
  return `via ${source}`;
}

function sanitizeLandingPath(landingPath: string | undefined): string | null {
  if (!landingPath) {
    return null;
  }

  const trimmed = landingPath.trim();
  if (!trimmed || trimmed === "/sign-in") {
    return null;
  }

  return trimmed;
}

function compactParts(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value?.trim()));
}

async function sendWelcomeEmail(input: {
  resendApiKey: string;
  email: string;
}) {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.resendApiKey}`,
      },
      body: JSON.stringify({
        from: "Basquio <reports@basquio.com>",
        to: [input.email],
        subject: "Welcome to Basquio",
        html: buildWelcomeHtml(),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(`[basquio] welcome email failed: ${response.status} ${body}`);
      return false;
    }

    return true;
  } catch (error) {
    console.warn("[basquio] welcome email failed:", error);
    return false;
  }
}

function buildWelcomeHtml() {
  return `<body style="background-color: #F7F5F1; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px 20px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 560px; margin: 0 auto;">
    <tr>
      <td style="padding: 28px; border: 1px solid #E8E4DB; border-radius: 14px; background: #FFFFFF;">
        <p style="color: #1A6AFF; font-size: 11px; font-weight: 700; letter-spacing: 1.6px; margin: 0 0 16px 0; text-transform: uppercase;">Welcome to Basquio</p>
        <img src="https://basquio.com/brand/png/logo/1x/basquio-logo-light-bg-blue.png" alt="Basquio" width="110" height="auto" style="display: block; margin-bottom: 28px;">
        <h1 style="color: #0B0C0C; font-size: 28px; line-height: 1.1; letter-spacing: -0.04em; margin: 0 0 14px 0;">Your workspace is ready.</h1>
        <p style="color: #4B5563; font-size: 15px; line-height: 24px; margin: 0 0 18px 0;">Start with one real reporting cycle. Upload the working files, write a tight brief, and Basquio will turn it into a presentation, report, and data pack.</p>
        <table cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0;">
          <tr>
            <td>
              <a href="https://basquio.com/jobs/new?tour=1" style="background-color: #1A6AFF; border-radius: 6px; color: #FFFFFF; display: inline-block; font-size: 14px; font-weight: 700; padding: 12px 20px; text-decoration: none;">Open guided setup</a>
            </td>
          </tr>
        </table>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 18px 0;">
          <tr>
            <td style="padding: 12px 14px; border: 1px solid #E8E4DB; border-radius: 8px; background: #FAFBFD; color: #4B5563; font-size: 14px; line-height: 22px;">
              <strong style="color: #0B0C0C;">Best first brief:</strong> one business problem, one audience, one decision.
            </td>
          </tr>
        </table>
        <p style="color: #94A3B8; font-size: 12px; line-height: 20px; margin: 0;">Beautiful Intelligence.</p>
      </td>
    </tr>
  </table>
</body>`;
}
