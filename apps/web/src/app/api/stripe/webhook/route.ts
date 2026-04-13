import { after, NextResponse } from "next/server";

import {
  grantPurchaseCredits,
  grantSubscriptionCredits,
  checkPaymentAlreadyProcessed,
  upsertSubscription,
} from "@/lib/credits";
import { normalizePlanId, type CreditPackId } from "@/lib/billing-config";
import {
  notifyCancellation,
  notifyCreditPurchase,
  notifyPaymentFailed,
  notifyPlanUpgrade,
  notifySubscriptionRenewed,
  notifySubscriptionStarted,
  notifyTemplateFeePayment,
} from "@/lib/discord-customers";
import { getStripe, CREDIT_PACKS, PLAN_CREDITS } from "@/lib/stripe";
import { createServiceSupabaseClient, fetchRestRows } from "@/lib/supabase/admin";
import { getTemplateFeeDraft, updateTemplateFeeDraft } from "@/lib/template-fee-drafts";

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

type ExistingSubscriptionRow = {
  plan: string;
  billing_interval: "monthly" | "annual";
  status: string;
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

  const claimed = await claimWebhookEvent(config, event.id, event.type);
  if (!claimed) {
    console.log(`[stripe-webhook] event ${event.id} already claimed or processed, skipping`);
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
        } else if (checkoutType === "template_fee") {
          await handleTemplateFeeCheckoutCompleted(config, session);
          console.log(`[stripe-webhook] template fee checkout completed for session ${session.id}`);
        } else {
          // Credit pack purchase
          await handleCreditPackPurchase(config, session);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        await handleSubscriptionChange(config, subscription as unknown as SubscriptionData, event.type);
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

    await finalizeWebhookEventClaim(config, event.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handler failed.";
    // If it's a duplicate/unique constraint, it's safe
    if (message.includes("unique") || message.includes("duplicate")) {
      await finalizeWebhookEventClaim(config, event.id).catch(() => {});
      console.log(`[stripe-webhook] duplicate processing attempt for ${event.id}, safe to ignore`);
      return NextResponse.json({ received: true });
    }
    await releaseWebhookEventClaim(config, event.id).catch(() => {});
    console.error(`[stripe-webhook] handler failed for ${event.type}: ${message}`);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── HANDLERS ────────────────────────────────────────────────

async function handleTemplateFeeCheckoutCompleted(
  config: { supabaseUrl: string; serviceKey: string },
  session: {
    id: string;
    amount_total?: number | null;
    metadata?: Record<string, string> | null;
  },
) {
  const userId = session.metadata?.user_id;
  const draftId = session.metadata?.draft_id;

  if (!userId || !draftId) {
    console.error("[stripe-webhook] template fee session missing metadata", { sessionId: session.id, userId, draftId });
    return;
  }

  const draft = await getTemplateFeeDraft({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    draftId,
    userId,
  });

  if (!draft) {
    console.error("[stripe-webhook] template fee draft not found", { sessionId: session.id, draftId, userId });
    return;
  }

  if (draft.status === "consumed" || draft.status === "paid") {
    return;
  }

  await updateTemplateFeeDraft({
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    draftId,
    userId,
    patch: {
      status: "paid",
      stripe_checkout_session_id: session.id,
      paid_at: new Date().toISOString(),
    },
  });

  scheduleDiscordNotification(async () => {
    const email = await resolveUserEmail(config.supabaseUrl, config.serviceKey, userId);
    await notifyTemplateFeePayment({
      email,
      amountUsd: (session.amount_total ?? 0) / 100,
    });
  }, (error) => {
    console.error(`[stripe-webhook] template fee Discord notification failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

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

  scheduleDiscordNotification(async () => {
    const email = await resolveUserEmail(config.supabaseUrl, config.serviceKey, userId);
    await notifyCreditPurchase({
      email,
      packId,
      pricingTier: normalizePackPricingTier(session.metadata?.pack_pricing_tier),
    });
  }, (error) => {
    logDiscordNotificationFailure("credit purchase", userId, error);
  });

  console.log(`[stripe-webhook] granted ${pack.credits} credits to user ${userId} (pack=${packId}, pi=${paymentIntentId})`);
}

async function handleSubscriptionChange(
  config: { supabaseUrl: string; serviceKey: string },
  subscription: SubscriptionData,
  eventType: "customer.subscription.created" | "customer.subscription.updated",
) {
  const userId = subscription.metadata?.user_id;
  const rawPlan = subscription.metadata?.plan;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  if (!userId || !rawPlan) {
    console.error("[stripe-webhook] subscription missing metadata", { userId, plan: rawPlan, subId: subscription.id });
    return;
  }

  const plan = normalizePlanId(rawPlan);
  const planConfig = PLAN_CREDITS[plan];
  if (!planConfig) {
    console.error(`[stripe-webhook] unknown plan: ${rawPlan}`);
    return;
  }

  const existingSubscription = await getExistingSubscription(config, subscription.id);

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

  const normalizedStatus = statusMap[subscription.status] ?? "active";
  const previousPlan = existingSubscription ? normalizePlanId(existingSubscription.plan) : null;
  const previousInterval = existingSubscription?.billing_interval ?? "monthly";
  const previousStatus = existingSubscription?.status ?? null;
  const isUpgrade = Boolean(previousPlan && previousPlan !== plan && getPlanWeight(plan) > getPlanWeight(previousPlan));
  const isNewSubscriptionStart = normalizedStatus === "active"
    && (
      !existingSubscription
      || (eventType === "customer.subscription.updated" && previousStatus === "incomplete")
    );

  if (normalizedStatus === "active") {
    if (isUpgrade) {
      scheduleDiscordNotification(async () => {
        const email = await resolveUserEmail(config.supabaseUrl, config.serviceKey, userId);
        await notifyPlanUpgrade({
          email,
          fromPlan: previousPlan!,
          toPlan: plan,
          fromInterval: previousInterval,
          toInterval: interval,
        });
      }, (error) => {
        logDiscordNotificationFailure("plan upgrade", userId, error);
      });
    } else if (isNewSubscriptionStart) {
      scheduleDiscordNotification(async () => {
        const email = await resolveUserEmail(config.supabaseUrl, config.serviceKey, userId);
        await notifySubscriptionStarted({
          email,
          plan,
          interval,
          creditsIncluded: planConfig.credits,
          previousStatus,
        });
      }, (error) => {
        logDiscordNotificationFailure("subscription started", userId, error);
      });
    }
  }

  console.log(`[stripe-webhook] upserted subscription ${subscription.id} (plan=${plan}, status=${subscription.status})`);
}

async function handleSubscriptionCanceled(
  config: { supabaseUrl: string; serviceKey: string },
  subscription: SubscriptionData,
) {
  const userId = subscription.metadata?.user_id;
  const existingSubscription = await getExistingSubscription(config, subscription.id);

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
    return;
  }

  scheduleDiscordNotification(async () => {
    const email = await resolveUserEmail(config.supabaseUrl, config.serviceKey, userId);
    await notifyCancellation({
      email,
      plan: existingSubscription?.plan ?? null,
    });
  }, (error) => {
    logDiscordNotificationFailure("subscription canceled", userId, error);
  });

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

  const lines = invoice.lines?.data ?? [];

  // Find the subscription renewal line item — it has a recurring price and is not a proration.
  // This is more robust than using data[0], which can be a proration or add-on line.
  const lineItem = lines.find(
    (line) => line.price?.recurring && !line.proration,
  ) ?? lines[0]; // fallback to first line if no recurring non-proration found

  if (!lineItem) {
    console.log(`[stripe-webhook] invoice ${invoice.id} has no line items, skipping`);
    return;
  }

  // Skip if the only lines are prorations (plan switch invoices)
  if (lines.every((line) => line.proration)) {
    console.log(`[stripe-webhook] skipping all-proration invoice ${invoice.id}`);
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

  const normalizedPlan = normalizePlanId(plan);
  const planConfig = PLAN_CREDITS[normalizedPlan];
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

  scheduleDiscordNotification(async () => {
    const email = await resolveUserEmail(config.supabaseUrl, config.serviceKey, userId);
    await notifySubscriptionRenewed({
      email,
      plan: normalizedPlan,
      creditsGranted: creditAmount,
    });
  }, (error) => {
    logDiscordNotificationFailure("subscription renewed", userId, error);
  });

  console.log(`[stripe-webhook] granted ${creditAmount} subscription credits to ${userId} (plan=${normalizedPlan}, interval=${isAnnual ? "annual" : "monthly"}, event=${eventId})`);
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
  const existingSubscription = await getExistingSubscription(config, subId);
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
    scheduleDiscordNotification(async () => {
      const email = await resolveUserEmail(config.supabaseUrl, config.serviceKey, userId);
      await notifyPaymentFailed({
        email,
        plan: invoice.subscription_details?.metadata?.plan ?? invoice.metadata?.plan ?? existingSubscription?.plan ?? null,
      });
    }, (error) => {
      logDiscordNotificationFailure("payment failed", userId, error);
    });

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

function logDiscordNotificationFailure(context: string, userId: string, error: unknown) {
  console.error(`[stripe-webhook] Discord ${context} notification failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
}

function scheduleDiscordNotification(task: () => Promise<void>, onError: (error: unknown) => void) {
  after(async () => {
    try {
      await task();
    } catch (error) {
      onError(error);
    }
  });
}

async function resolveUserEmail(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<string> {
  try {
    const supabase = createServiceSupabaseClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase.auth.admin.getUserById(userId);

    if (error) {
      throw error;
    }

    return data.user?.email ?? userId;
  } catch {
    return userId;
  }
}

async function claimWebhookEvent(
  config: { supabaseUrl: string; serviceKey: string },
  eventId: string,
  eventType: string,
): Promise<boolean> {
  const supabase = createServiceSupabaseClient(config.supabaseUrl, config.serviceKey);
  const { data, error } = await supabase
    .from("stripe_webhook_events")
    .upsert(
      [
        {
          id: eventId,
          type: eventType,
          processed: false,
        },
      ],
      {
        onConflict: "id",
        ignoreDuplicates: true,
      },
    )
    .select("id");

  if (error) {
    throw error;
  }

  return (data?.length ?? 0) > 0;
}

async function finalizeWebhookEventClaim(
  config: { supabaseUrl: string; serviceKey: string },
  eventId: string,
): Promise<void> {
  const supabase = createServiceSupabaseClient(config.supabaseUrl, config.serviceKey);
  const { error } = await supabase
    .from("stripe_webhook_events")
    .update({ processed: true })
    .eq("id", eventId);

  if (error) {
    throw error;
  }
}

async function releaseWebhookEventClaim(
  config: { supabaseUrl: string; serviceKey: string },
  eventId: string,
): Promise<void> {
  const supabase = createServiceSupabaseClient(config.supabaseUrl, config.serviceKey);
  const { error } = await supabase
    .from("stripe_webhook_events")
    .delete()
    .eq("id", eventId)
    .eq("processed", false);

  if (error) {
    throw error;
  }
}

async function getExistingSubscription(
  config: { supabaseUrl: string; serviceKey: string },
  stripeSubscriptionId: string,
): Promise<ExistingSubscriptionRow | null> {
  const rows = await fetchRestRows<ExistingSubscriptionRow>({
    ...config,
    table: "subscriptions",
    query: {
      stripe_subscription_id: `eq.${stripeSubscriptionId}`,
      select: "plan,billing_interval,status",
      limit: "1",
    },
  }).catch(() => []);

  return rows[0] ?? null;
}

function normalizePackPricingTier(value: string | undefined): "free" | "starter" | "pro" {
  if (value === "starter" || value === "pro") {
    return value;
  }
  return "free";
}

function getPlanWeight(plan: string): number {
  const normalized = normalizePlanId(plan);
  if (normalized === "starter") return 1;
  if (normalized === "pro") return 2;
  if (normalized === "enterprise") return 3;
  return 0;
}
