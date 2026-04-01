import { NextResponse } from "next/server";

import {
  grantPurchaseCredits,
  grantSubscriptionCredits,
  checkPaymentAlreadyProcessed,
  checkWebhookEventProcessed,
  markWebhookEventProcessed,
  upsertSubscription,
} from "@/lib/credits";
import { getStripe, CREDIT_PACKS, PLAN_CREDITS, type CreditPackId } from "@/lib/stripe";

export const runtime = "nodejs";

/** Subset of Stripe Subscription fields we use. */
type SubscriptionData = {
  id: string;
  customer: string | { id: string };
  status: string;
  metadata?: Record<string, string> | null;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end?: boolean;
  items?: { data: Array<{ price?: { id: string; recurring?: { interval: string } | null } }> };
};

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events for billing.
 *
 * Events handled:
 * - checkout.session.completed — credit pack purchase or subscription start
 * - checkout.session.async_payment_succeeded — delayed payment methods
 * - customer.subscription.created — new subscription
 * - customer.subscription.updated — plan change, status change
 * - customer.subscription.deleted — cancellation
 * - invoice.paid — subscription renewal → grant monthly credits
 * - invoice.payment_failed — failed renewal → mark past_due
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

  const config = getSupabaseConfig();
  if (!config) {
    console.error("[stripe-webhook] Supabase credentials not configured.");
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  // Global idempotency check
  const alreadyProcessed = await checkWebhookEventProcessed({ ...config, eventId: event.id });
  if (alreadyProcessed) {
    console.log(`[stripe-webhook] event ${event.id} already processed, skipping`);
    return NextResponse.json({ received: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;

        // For checkout.session.completed, only proceed if already paid
        if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
          console.log(`[stripe-webhook] session ${session.id} payment_status=${session.payment_status}, waiting for async`);
          return NextResponse.json({ received: true });
        }

        const checkoutType = session.metadata?.type;

        if (checkoutType === "subscription") {
          // Subscription checkout completed — subscription events will handle the rest
          console.log(`[stripe-webhook] subscription checkout completed for session ${session.id}`);
        } else {
          // Credit pack purchase
          await handleCreditPackPurchase(config, session);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        await handleSubscriptionChange(config, subscription as unknown as SubscriptionData, event.id);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        await handleSubscriptionCanceled(config, subscription as unknown as SubscriptionData);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        await handleInvoicePaid(config, invoice, event.id);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        await handleInvoicePaymentFailed(config, invoice);
        break;
      }

      default:
        console.log(`[stripe-webhook] unhandled event type: ${event.type}`);
    }

    // Mark event as processed
    await markWebhookEventProcessed({ ...config, eventId: event.id, eventType: event.type });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handler failed.";
    // If it's a duplicate/unique constraint, it's safe
    if (message.includes("unique") || message.includes("duplicate")) {
      console.log(`[stripe-webhook] duplicate processing attempt for ${event.id}, safe to ignore`);
      return NextResponse.json({ received: true });
    }
    console.error(`[stripe-webhook] handler failed for ${event.type}: ${message}`);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── HANDLERS ────────────────────────────────────────────────

async function handleCreditPackPurchase(
  config: { supabaseUrl: string; serviceKey: string },
  session: {
    id: string;
    metadata?: Record<string, string> | null;
    payment_intent?: string | { id: string } | null;
  },
) {
  const userId = session.metadata?.user_id;
  const packId = session.metadata?.pack_id as CreditPackId | undefined;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? session.id;

  if (!userId || !packId) {
    console.error("[stripe-webhook] paid session missing metadata", { userId, packId, sessionId: session.id });
    return;
  }

  const pack = CREDIT_PACKS[packId];
  if (!pack) {
    console.error(`[stripe-webhook] unknown pack: ${packId}`);
    return;
  }

  // Idempotency check (fast path before attempting insert)
  const alreadyProcessed = await checkPaymentAlreadyProcessed({ ...config, paymentIntentId });
  if (alreadyProcessed) {
    console.log(`[stripe-webhook] already processed pi=${paymentIntentId}, skipping`);
    return;
  }

  await grantPurchaseCredits({
    ...config,
    userId,
    amount: pack.credits,
    reason: pack.reason,
    paymentIntentId,
  });

  console.log(`[stripe-webhook] granted ${pack.credits} credits to user ${userId} (pack=${packId}, pi=${paymentIntentId})`);
}

async function handleSubscriptionChange(
  config: { supabaseUrl: string; serviceKey: string },
  subscription: SubscriptionData,
  _eventId: string,
) {
  const userId = subscription.metadata?.user_id;
  const plan = subscription.metadata?.plan;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  void _eventId; // reserved for future use

  if (!userId || !plan) {
    console.error("[stripe-webhook] subscription missing metadata", { userId, plan, subId: subscription.id });
    return;
  }

  const planConfig = PLAN_CREDITS[plan];
  if (!planConfig) {
    console.error(`[stripe-webhook] unknown plan: ${plan}`);
    return;
  }

  // Determine billing interval from subscription items
  const interval = subscription.items?.data?.[0]?.price?.recurring?.interval === "year" ? "annual" : "monthly";

  // Map Stripe status to our status
  const statusMap: Record<string, string> = {
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    incomplete: "incomplete",
    trialing: "active",
    incomplete_expired: "canceled",
    unpaid: "past_due",
    paused: "canceled",
  };

  await upsertSubscription({
    ...config,
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    plan,
    billingInterval: interval,
    status: statusMap[subscription.status] ?? "active",
    currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    creditsIncluded: planConfig.credits,
    templateSlotsIncluded: planConfig.templateSlots,
  });

  console.log(`[stripe-webhook] upserted subscription ${subscription.id} (plan=${plan}, status=${subscription.status})`);
}

async function handleSubscriptionCanceled(
  config: { supabaseUrl: string; serviceKey: string },
  subscription: SubscriptionData,
) {
  const userId = subscription.metadata?.user_id;

  if (!userId) {
    console.error("[stripe-webhook] canceled subscription missing user_id", { subId: subscription.id });
    return;
  }

  // For cancellations, just PATCH the existing row to canceled status.
  // This avoids needing the plan field — we already have it from the initial insert.
  const url = new URL("/rest/v1/subscriptions", config.supabaseUrl);
  url.searchParams.set("stripe_subscription_id", `eq.${subscription.id}`);

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      status: "canceled",
      cancel_at_period_end: false,
      credits_included: 0,
      template_slots_included: 0,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    console.error(`[stripe-webhook] failed to cancel subscription: ${text}`);
  }

  console.log(`[stripe-webhook] subscription canceled ${subscription.id} for user ${userId}`);
}

async function handleInvoicePaid(
  config: { supabaseUrl: string; serviceKey: string },
  invoice: {
    id: string;
    subscription?: string | null;
    subscription_details?: { metadata?: Record<string, string> | null } | null;
    metadata?: Record<string, string> | null;
    lines?: {
      data: Array<{
        period?: { start: number; end: number };
        price?: { recurring?: { interval: string } | null } | null;
        proration?: boolean;
      }>;
    };
  },
  eventId: string,
) {
  // Only handle subscription invoices (not one-time payments)
  if (!invoice.subscription) return;

  const lineItem = invoice.lines?.data?.[0];

  // Skip proration invoices (plan upgrades/downgrades) — they don't represent a new billing period
  if (lineItem?.proration) {
    console.log(`[stripe-webhook] skipping proration invoice ${invoice.id}`);
    return;
  }

  // Get plan from subscription metadata (try multiple locations)
  let plan = invoice.subscription_details?.metadata?.plan ?? invoice.metadata?.plan;
  let userId = invoice.subscription_details?.metadata?.user_id ?? invoice.metadata?.user_id;
  let billingInterval: string | null = null;

  // Fallback: look up from our subscriptions table if metadata is missing
  if (!plan || !userId) {
    const subId = typeof invoice.subscription === "string" ? invoice.subscription : null;
    if (subId) {
      try {
        const url = new URL("/rest/v1/subscriptions", config.supabaseUrl);
        url.searchParams.set("stripe_subscription_id", `eq.${subId}`);
        url.searchParams.set("select", "plan,user_id,billing_interval");
        url.searchParams.set("limit", "1");
        const res = await fetch(url, {
          headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, Accept: "application/json" },
          cache: "no-store",
        });
        if (res.ok) {
          const rows = await res.json();
          if (rows[0]) {
            plan = plan ?? rows[0].plan;
            userId = userId ?? rows[0].user_id;
            billingInterval = rows[0].billing_interval;
          }
        }
      } catch {
        // Best-effort fallback
      }
    }
  }

  if (!plan || !userId) {
    console.log(`[stripe-webhook] invoice.paid without plan/user metadata, skipping (inv=${invoice.id})`);
    return;
  }

  const planConfig = PLAN_CREDITS[plan];
  if (!planConfig) {
    console.error(`[stripe-webhook] unknown plan in invoice: ${plan}`);
    return;
  }

  // Determine period end from invoice line items
  const periodEnd = lineItem?.period?.end;
  if (!periodEnd) {
    console.error(`[stripe-webhook] invoice missing period end (inv=${invoice.id})`);
    return;
  }

  // Determine if annual from invoice line item or DB fallback
  const isAnnual =
    lineItem?.price?.recurring?.interval === "year" ||
    billingInterval === "annual";

  // Monthly: Stripe sends invoice.paid every month → grant 1 month of credits.
  // Annual: Stripe sends invoice.paid once/year → grant 12 months of credits upfront.
  // Customer pays for a year, they must see a full year of credits immediately.
  const creditAmount = isAnnual ? planConfig.credits * 12 : planConfig.credits;

  await grantSubscriptionCredits({
    ...config,
    userId,
    amount: creditAmount,
    periodEnd: new Date(periodEnd * 1000).toISOString(),
    stripeEventId: eventId,
  });

  console.log(`[stripe-webhook] granted ${creditAmount} subscription credits to ${userId} (plan=${plan}, interval=${isAnnual ? "annual" : "monthly"}, event=${eventId})`);
}

async function handleInvoicePaymentFailed(
  config: { supabaseUrl: string; serviceKey: string },
  invoice: {
    id: string;
    subscription?: string | { id: string } | null;
    subscription_details?: { metadata?: Record<string, string> | null } | null;
    metadata?: Record<string, string> | null;
  },
) {
  if (!invoice.subscription) return;

  const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription.id;
  const userId = invoice.subscription_details?.metadata?.user_id ?? invoice.metadata?.user_id;
  if (!userId) return;

  // Update subscription status to past_due
  const url = new URL("/rest/v1/subscriptions", config.supabaseUrl);
  url.searchParams.set("stripe_subscription_id", `eq.${subId}`);

  const patchRes = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ status: "past_due", updated_at: new Date().toISOString() }),
    cache: "no-store",
  });

  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => "Unknown error");
    console.error(`[stripe-webhook] failed to mark subscription past_due: ${text}`);
  } else {
    console.log(`[stripe-webhook] marked subscription past_due for user ${userId} (inv=${invoice.id})`);
  }
}

// ─── HELPERS ─────────────────────────────────────────────────

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return { supabaseUrl, serviceKey };
}
