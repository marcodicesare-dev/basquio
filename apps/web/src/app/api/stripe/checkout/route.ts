import { NextResponse } from "next/server";

import { getViewerState } from "@/lib/supabase/auth";
import { getStripe, getPriceId, getSubscriptionPriceId, getOrCreateStripeCustomer, type CreditPackId } from "@/lib/stripe";

export const runtime = "nodejs";

const VALID_PACKS: CreditPackId[] = ["pack_25", "pack_50", "pack_100", "pack_250"];
const VALID_PLANS = ["starter", "pro", "team"] as const;
const VALID_INTERVALS = ["monthly", "annual"] as const;

type CheckoutBody =
  | { type: "credit_pack"; packId: string }
  | { type: "subscription"; plan: string; interval: string }
  | { packId: string }; // Legacy: credit pack only (backwards compat)

/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session.
 *
 * Supports:
 * - Credit pack purchase: { type: "credit_pack", packId: "pack_25" }
 * - Subscription: { type: "subscription", plan: "starter", interval: "monthly" }
 * - Legacy: { packId: "pack_25" } (backwards compat)
 */
export async function POST(request: Request) {
  const viewer = await getViewerState();

  if (!viewer.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = (await request.json()) as CheckoutBody;
  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://basquio.com";
  const stripe = getStripe();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  try {
    // Determine checkout type
    const type = "type" in body ? body.type : "credit_pack";

    if (type === "subscription") {
      return handleSubscriptionCheckout(stripe, body as { type: "subscription"; plan: string; interval: string }, {
        origin, userId: viewer.user.id, email: viewer.user.email ?? "", supabaseUrl, serviceKey,
      });
    }

    // Credit pack (default / legacy)
    const packId = ("packId" in body ? body.packId : undefined) as CreditPackId | undefined;
    return handleCreditPackCheckout(stripe, packId, {
      origin, userId: viewer.user.id, email: viewer.user.email ?? "", supabaseUrl, serviceKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleCreditPackCheckout(
  stripe: ReturnType<typeof getStripe>,
  packId: CreditPackId | undefined,
  ctx: { origin: string; userId: string; email: string; supabaseUrl: string; serviceKey: string },
) {
  if (!packId || !VALID_PACKS.includes(packId)) {
    return NextResponse.json({ error: `Invalid pack. Use: ${VALID_PACKS.join(", ")}.` }, { status: 400 });
  }

  const priceId = getPriceId(packId);
  const customerId = await getOrCreateStripeCustomer(stripe, ctx.supabaseUrl, ctx.serviceKey, ctx.userId, ctx.email);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      user_id: ctx.userId,
      pack_id: packId,
      type: "credit_pack",
    },
    success_url: `${ctx.origin}/billing?purchase=success&pack=${packId}`,
    cancel_url: `${ctx.origin}/pricing?purchase=cancelled`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Failed to create checkout session." }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}

async function handleSubscriptionCheckout(
  stripe: ReturnType<typeof getStripe>,
  body: { type: "subscription"; plan: string; interval: string },
  ctx: { origin: string; userId: string; email: string; supabaseUrl: string; serviceKey: string },
) {
  const plan = body.plan as (typeof VALID_PLANS)[number];
  const interval = body.interval as (typeof VALID_INTERVALS)[number];

  if (!VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: `Invalid plan. Use: ${VALID_PLANS.join(", ")}.` }, { status: 400 });
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: `Invalid interval. Use: ${VALID_INTERVALS.join(", ")}.` }, { status: 400 });
  }

  const priceId = getSubscriptionPriceId(plan, interval);
  const customerId = await getOrCreateStripeCustomer(stripe, ctx.supabaseUrl, ctx.serviceKey, ctx.userId, ctx.email);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      user_id: ctx.userId,
      plan,
      interval,
      type: "subscription",
    },
    subscription_data: {
      metadata: {
        user_id: ctx.userId,
        plan,
        interval,
      },
    },
    success_url: `${ctx.origin}/billing?subscription=success&plan=${plan}`,
    cancel_url: `${ctx.origin}/pricing?subscription=cancelled`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Failed to create checkout session." }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
