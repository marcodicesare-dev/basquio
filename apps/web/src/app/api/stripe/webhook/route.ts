import { NextResponse } from "next/server";

import { grantPurchaseCredits, checkPaymentAlreadyProcessed } from "@/lib/credits";
import { getStripe, CREDIT_PACKS, type CreditPackId } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events for credit pack purchases.
 *
 * Listens for checkout.session.completed, verifies signature,
 * checks idempotency, and grants credits to the user.
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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    const packId = session.metadata?.pack_id as CreditPackId | undefined;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? session.id;

    if (!userId || !packId) {
      console.error("[stripe-webhook] checkout.session.completed missing metadata", {
        userId,
        packId,
        sessionId: session.id,
      });
      return NextResponse.json({ received: true });
    }

    const pack = CREDIT_PACKS[packId];

    if (!pack) {
      console.error(`[stripe-webhook] unknown pack: ${packId}`);
      return NextResponse.json({ received: true });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.error("[stripe-webhook] Supabase credentials not configured.");
      return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }

    try {
      // Idempotency: skip if this payment_intent was already processed
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
        amount: pack.credits,
        reason: pack.reason,
        paymentIntentId,
      });

      console.log(
        `[stripe-webhook] granted ${pack.credits} credits to user ${userId} (pack=${packId}, pi=${paymentIntentId})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Credit grant failed.";
      console.error(`[stripe-webhook] credit grant failed: ${message}`);
      return NextResponse.json({ error: "Credit grant failed." }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
