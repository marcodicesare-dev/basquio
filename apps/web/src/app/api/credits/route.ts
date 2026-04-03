import { NextResponse } from "next/server";

import {
  getDetailedCreditBalance,
  ensureFreeTierCredit,
  calculateRunCredits,
  maxAffordableSlides,
  getActiveSubscription,
  MAX_TARGET_SLIDES,
} from "@/lib/credits";
import { getViewerState } from "@/lib/supabase/auth";

export const runtime = "nodejs";

export async function GET() {
  const viewer = await getViewerState();

  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const config = { supabaseUrl, serviceKey, userId: viewer.user.id };

  // Ensure free tier credit exists
  await ensureFreeTierCredit(config);

  const balance = await getDetailedCreditBalance(config);
  const subscription = await getActiveSubscription(config);

  // Calculate what the user can afford
  const maxSlidesAffordable = Math.min(
    MAX_TARGET_SLIDES,
    maxAffordableSlides(balance.balance, "claude-sonnet-4-6"),
  );

  return NextResponse.json({
    balance: balance.balance,
    totalRuns: balance.totalRuns,
    hasUsedFreeTier: balance.freeGrantsCount > 0,
    // Detailed breakdown
    subscriptionCredits: balance.subscriptionCredits,
    purchasedCredits: balance.purchasedCredits,
    promotionalCredits: balance.promotionalCredits,
    freeCredits: balance.freeCredits,
    // Current plan
    plan: subscription?.plan ?? "free",
    planStatus: subscription?.status ?? null,
    planInterval: subscription?.billing_interval ?? null,
    planPeriodEnd: subscription?.current_period_end ?? null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    templateSlotsIncluded: subscription?.template_slots_included ?? 0,
    // Pricing info
    pricing: {
      freeTierCredits: 30,
      example10Slides: calculateRunCredits(10, "claude-sonnet-4-6"),
      example15Slides: calculateRunCredits(15, "claude-sonnet-4-6"),
      example20SlidesOpus: calculateRunCredits(20, "claude-opus-4-6"),
      memoCredits: calculateRunCredits(10, "claude-haiku-4-5"),
      deckCredits: calculateRunCredits(10, "claude-sonnet-4-6"),
      deepDiveCredits: calculateRunCredits(10, "claude-opus-4-6"),
    },
    maxSlidesAffordable,
  });
}
