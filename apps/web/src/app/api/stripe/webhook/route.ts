import { NextResponse } from "next/server";

import { grantPurchaseCredits, checkPaymentAlreadyProcessed } from "@/lib/credits";
import { getStripe, CREDIT_PACKS, type CreditPackId } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events for credit pack purchases.
 *
 * Listens for:
 * - checkout.session.completed (immediate card payments)
 * - checkout.session.async_payment_succeeded (delayed payment methods)
 *
 * Verifies signature, checks idempotency, and grants credits.
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

  // Handle both immediate and delayed payment confirmations
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object;

    // For checkout.session.completed, only proceed if already paid.
    // Async payment methods fire completed with payment_status !== "paid",
    // then fire async_payment_succeeded when the payment settles.
    if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
      console.log(`[stripe-webhook] session ${session.id} payment_status=${session.payment_status}, waiting for async_payment_succeeded`);
      return NextResponse.json({ received: true });
    }

    return handlePaidSession(session);
  }

  return NextResponse.json({ received: true });
}

async function handlePaidSession(
  session: { id: string; metadata?: Record<string, string> | null; payment_intent?: string | { id: string } | null },
) {
  const userId = session.metadata?.user_id;
  const packId = session.metadata?.pack_id as CreditPackId | undefined;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? session.id;

  if (!userId || !packId) {
    console.error("[stripe-webhook] paid session missing metadata", {
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
    // Idempotency: DB unique index on (reference_id WHERE reason='purchase_pack')
    // prevents double-insert. Application check is a fast-path to avoid the attempt.
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
    // If this is a unique constraint violation, it's a duplicate — not an error
    if (message.includes("unique") || message.includes("duplicate")) {
      console.log(`[stripe-webhook] duplicate grant attempt for pi=${paymentIntentId}, safe to ignore`);
      return NextResponse.json({ received: true });
    }
    console.error(`[stripe-webhook] credit grant failed: ${message}`);
    return NextResponse.json({ error: "Credit grant failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
