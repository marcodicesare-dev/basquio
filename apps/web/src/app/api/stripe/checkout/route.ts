import { NextResponse } from "next/server";

import { getViewerState } from "@/lib/supabase/auth";
import { getStripe, getPriceId, type DeckTier } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session for purchasing deck credits.
 *
 * Body: { tier: "standard" | "pro" | "pack_5" | "pack_10" }
 * Returns: { url: string } — the Stripe Checkout URL to redirect to
 */
export async function POST(request: Request) {
  const viewer = await getViewerState();

  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = (await request.json()) as { tier?: string };
  const tier = body.tier as DeckTier | undefined;

  if (!tier || !["standard", "pro", "pack_5", "pack_10"].includes(tier)) {
    return NextResponse.json({ error: "Invalid tier. Use: standard, pro, pack_5, or pack_10." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const priceId = getPriceId(tier);

    const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://basquio.com";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        user_id: viewer.user.id,
        tier,
      },
      success_url: `${origin}/dashboard?purchase=success&tier=${tier}`,
      cancel_url: `${origin}/pricing?purchase=cancelled`,
      customer_email: viewer.user.email ?? undefined,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Failed to create checkout session." }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
