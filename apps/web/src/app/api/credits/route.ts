import { NextResponse } from "next/server";

import { getCreditBalance, ensureFreeTierCredit } from "@/lib/credits";
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

  return NextResponse.json({
    balance: balance.balance,
    totalRuns: balance.totalRuns,
    hasUsedFreeTier: balance.freeGrantsCount > 0,
  });
}
