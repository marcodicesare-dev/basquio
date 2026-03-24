import { NextResponse } from "next/server";

import { getViewerState } from "@/lib/supabase/auth";
import { getStripe, getPriceId, type CreditPackId } from "@/lib/stripe";

export const runtime = "nodejs";

const VALID_PACKS: CreditPackId[] = ["pack_25", "pack_50", "pack_100"];

/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session for purchasing a credit pack.
 *
 * Body: { packId: "pack_25" | "pack_50" | "pack_100" }
 * Returns: { url: string } — the Stripe Checkout URL to redirect to
 */
export async function POST(request: Request) {
  const viewer = await getViewerState();

  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = (await request.json()) as { packId?: string };
  const packId = body.packId as CreditPackId | undefined;

  if (!packId || !VALID_PACKS.includes(packId)) {
    return NextResponse.json({ error: "Invalid pack. Use: pack_25, pack_50, or pack_100." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const priceId = getPriceId(packId);

    const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://basquio.com";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        user_id: viewer.user.id,
        pack_id: packId,
      },
      success_url: `${origin}/dashboard?purchase=success&pack=${packId}`,
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
