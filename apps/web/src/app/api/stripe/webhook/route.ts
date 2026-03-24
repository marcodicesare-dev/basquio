import { NextResponse } from "next/server";

import { grantPurchaseCredits, checkPaymentAlreadyProcessed } from "@/lib/credits";
import { getStripe, DECK_PRODUCTS, type DeckTier } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events for payment processing.
 *
 * Required env vars:
 * - STRIPE_SECRET_KEY
 * - STRIPE_WEBHOOK_SECRET
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured.");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signature verification failed.";
    console.error(`[stripe-webhook] verification failed: ${message}`);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Handle checkout.session.completed — this fires when payment succeeds
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    const tier = session.metadata?.tier as DeckTier | undefined;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? session.id;

    if (!userId || !tier) {
      console.error("[stripe-webhook] checkout.session.completed missing metadata", {
        userId,
        tier,
        sessionId: session.id,
      });
      // Return 200 to acknowledge — Stripe would retry on non-200
      return NextResponse.json({ received: true });
    }

    const product = DECK_PRODUCTS[tier];

    if (!product) {
      console.error(`[stripe-webhook] unknown tier: ${tier}`);
      return NextResponse.json({ received: true });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.error("[stripe-webhook] Supabase credentials not configured.");
      return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }

    try {
      // Idempotency: check if this payment_intent was already processed.
      // Stripe retries webhooks on non-2xx, so this prevents double-crediting.
      const alreadyProcessed = await checkPaymentAlreadyProcessed({
        supabaseUrl,
        serviceKey,
        paymentIntentId,
      });

      if (alreadyProcessed) {
        console.log(`[stripe-webhook] already processed pi=${paymentIntentId}, skipping`);
        return NextResponse.json({ received: true });
      }

      await grantPurchaseCredits({
        supabaseUrl,
        serviceKey,
        userId,
        amount: product.credits,
        reason: product.reason,
        paymentIntentId,
      });

      console.log(
        `[stripe-webhook] granted ${product.credits} credit(s) to user ${userId} (tier=${tier}, pi=${paymentIntentId})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Credit grant failed.";
      console.error(`[stripe-webhook] credit grant failed: ${message}`);
      // Return 500 so Stripe retries
      return NextResponse.json({ error: "Credit grant failed." }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
