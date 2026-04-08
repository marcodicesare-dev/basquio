import { NextResponse } from "next/server";

import { checkWebhookEventProcessed, markWebhookEventProcessed } from "@/lib/credits";
import { postWeeklyRevenueSummary } from "@/lib/discord-customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CUSTOMERS_TIMEZONE = "Europe/Zurich";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const now = new Date();
  const schedule = getZurichSchedule(now);

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!force && !shouldRunWeeklySummary(schedule)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "outside_weekly_window",
      schedule,
    });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const eventId = `customers-weekly-summary-${schedule.isoWeekKey}`;
  if (!force) {
    const alreadyProcessed = await checkWebhookEventProcessed({
      ...config,
      eventId,
    });

    if (alreadyProcessed) {
      return NextResponse.json({ ok: true, skipped: true, reason: "already_posted", eventId });
    }
  }

  const summary = await postWeeklyRevenueSummary({ occurredAt: now });
  if (!summary) {
    return NextResponse.json({ error: "Customers webhook not configured." }, { status: 503 });
  }

  if (!force) {
    await markWebhookEventProcessed({
      ...config,
      eventId,
      eventType: "customers.weekly_summary",
    });
  }

  return NextResponse.json({
    ok: true,
    posted: Boolean(summary),
    eventId,
    summary,
  });
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  return { supabaseUrl, serviceKey };
}

function isAuthorized(request: Request) {
  const authorization = request.headers.get("authorization");
  const validTokens = [
    process.env.CRON_SECRET?.trim(),
    process.env.BASQUIO_INTERNAL_JOB_TOKEN?.trim(),
  ].filter((value): value is string => Boolean(value));

  return validTokens.some((token) => authorization === `Bearer ${token}`);
}

function shouldRunWeeklySummary(schedule: ReturnType<typeof getZurichSchedule>) {
  return schedule.weekday === "Mon" && schedule.hour === 9 && schedule.minute < 15;
}

function getZurichSchedule(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: CUSTOMERS_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    weekday: parts.weekday ?? "",
    hour: Number.parseInt(parts.hour ?? "0", 10),
    minute: Number.parseInt(parts.minute ?? "0", 10),
    isoWeekKey: `${parts.year ?? "0000"}-${parts.month ?? "01"}-${parts.day ?? "01"}`,
  };
}
