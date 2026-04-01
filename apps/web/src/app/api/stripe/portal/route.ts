import { NextResponse } from "next/server";

import { getViewerState } from "@/lib/supabase/auth";
import { getStripe, getOrCreateStripeCustomer } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST /api/stripe/portal
 * Creates a Stripe Customer Portal session and returns the URL.
 * Users can manage payment methods, view invoices, cancel/change subscriptions.
 */
export async function POST(request: Request) {
  const viewer = await getViewerState();

  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  try {
    const stripe = getStripe();
    const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://basquio.com";

    const customerId = await getOrCreateStripeCustomer(
      stripe, supabaseUrl, serviceKey, viewer.user.id, viewer.user.email ?? "",
    );

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Portal session failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
