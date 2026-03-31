import { NextResponse } from "next/server";

import { getCreditBalance, ensureFreeTierCredit, calculateRunCredits, BASE_CREDITS, CREDITS_PER_SLIDE, MAX_TARGET_SLIDES } from "@/lib/credits";
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

  // Ensure the free tier credit exists
  await ensureFreeTierCredit({ supabaseUrl, serviceKey, userId: viewer.user.id });

  const balance = await getCreditBalance({ supabaseUrl, serviceKey, userId: viewer.user.id });

  // Calculate what the user can afford
  const maxSlidesAffordableRaw = balance.balance > BASE_CREDITS
    ? Math.floor((balance.balance - BASE_CREDITS) / CREDITS_PER_SLIDE)
    : 0;
  const maxSlidesAffordable = Math.min(MAX_TARGET_SLIDES, maxSlidesAffordableRaw);

  return NextResponse.json({
    balance: balance.balance,
    totalRuns: balance.totalRuns,
    hasUsedFreeTier: balance.freeGrantsCount > 0,
    pricing: {
      baseCredits: BASE_CREDITS,
      creditsPerSlide: CREDITS_PER_SLIDE,
      example10Slides: calculateRunCredits(10),
    },
    maxSlidesAffordable,
  });
}
