export type ResendSendResult =
  | { status: "sent"; messageId: string | null }
  | { status: "rejected"; messageId: null }
  | { status: "unknown"; messageId: null };

export async function sendResendHtmlEmail(input: {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  idempotencyKey?: string;
}): Promise<ResendSendResult> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    };
    if (input.idempotencyKey) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const body = parseResendErrorBody(bodyText);

      if (response.status === 409 && body?.name === "concurrent_idempotent_requests") {
        console.warn(`[basquio] Resend request still in progress for idempotency key ${input.idempotencyKey ?? "<none>"}.`);
        return {
          status: "unknown",
          messageId: null,
        };
      }

      console.warn(`[basquio] Resend API ${response.status}: ${formatResendErrorBody(body, bodyText)}`);
      return {
        status: "rejected",
        messageId: null,
      };
    }

    const payload = (await response.json().catch(() => null)) as { id?: string } | null;
    return {
      status: "sent",
      messageId: typeof payload?.id === "string" ? payload.id : null,
    };
  } catch (error) {
    console.warn("[basquio] Resend email delivery outcome is unknown:", error);
    return {
      status: "unknown",
      messageId: null,
    };
  }
}

function parseResendErrorBody(body: string) {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as { name?: string; message?: string };
  } catch {
    return null;
  }
}

function formatResendErrorBody(
  body: { name?: string; message?: string } | null,
  fallback: string,
) {
  if (body?.message) {
    return `${body.name ?? "resend_error"}: ${body.message}`;
  }

  return fallback || "Unknown Resend error";
}
