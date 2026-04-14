import { NextResponse } from "next/server";

import {
  getRunReminderContext,
  listCompletedRunsWithoutDownloads,
  listUnfinishedSetupCandidates,
  sendActivationReminders,
  sendIncompleteSetupReminder,
  sendWaitingRunReminder,
} from "@/lib/engagement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY ?? process.env.RESEND_CURSOR_API_KEY;

  if (!supabaseUrl || !serviceKey || !resendApiKey) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const config = {
    supabaseUrl,
    serviceKey,
    resendApiKey,
  };
  const now = new Date();
  const waitingCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const setupCutoff = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

  const waitingRuns = await listCompletedRunsWithoutDownloads(config, waitingCutoff, 50);
  let waitingSent = 0;
  for (const run of waitingRuns) {
    if (!run.requested_by) {
      continue;
    }

    const context = await getRunReminderContext(config, run.id);
    const sent = await sendWaitingRunReminder(config, {
      runId: run.id,
      userId: run.requested_by,
      slideCount: context.slideCount,
      headline: context.headline ?? run.objective ?? null,
    });
    if (sent) {
      waitingSent += 1;
    }
  }

  const unfinishedCandidates = await listUnfinishedSetupCandidates(config, setupCutoff, 100);
  let unfinishedSent = 0;
  for (const candidate of unfinishedCandidates) {
    const sent = await sendIncompleteSetupReminder(config, candidate);
    if (sent) {
      unfinishedSent += 1;
    }
  }

  const activation = await sendActivationReminders(config);

  return NextResponse.json({
    ok: true,
    waitingCandidates: waitingRuns.length,
    waitingSent,
    unfinishedCandidates: unfinishedCandidates.length,
    unfinishedSent,
    activationSent: activation.sent,
    activationSkipped: activation.skipped,
  });
}

function isAuthorized(request: Request) {
  const authorization = request.headers.get("authorization");
  const validTokens = [
    process.env.CRON_SECRET?.trim(),
    process.env.BASQUIO_INTERNAL_JOB_TOKEN?.trim(),
  ].filter((value): value is string => Boolean(value));

  return validTokens.some((token) => authorization === `Bearer ${token}`);
}
