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
import { sendResendHtmlEmail } from "@/lib/resend";

export const runtime = "nodejs";

/** Subset of Stripe Subscription fields we use. */
type SubscriptionData = {
  id: string;
  customer: string | { id: string };
  status: string;
  metadata?: Record<string, string> | null;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  items?: {
    data: Array<{
      current_period_start?: number;
      current_period_end?: number;
      price?: { id: string; recurring?: { interval: string } | null };
    }>;
  };
};

type ExistingSubscriptionRow = {
  user_id: string;
  stripe_customer_id: string;
  plan: string;
  billing_interval: "monthly" | "annual";
  status: string;
};

type InvoiceLineData = {
  description?: string | null;
  metadata?: Record<string, string> | null;
  period?: { start?: number; end?: number };
  price?: { recurring?: { interval: string | null } | null } | null;
  pricing?: {
    price_details?: {
      price?: string | null;
      product?: string | null;
    } | null;
  } | null;
  proration?: boolean | null;
  parent?: {
    type?: string | null;
    subscription_item_details?: {
      subscription?: string | { id: string } | null;
      subscription_item?: string | null;
      proration?: boolean | null;
    } | null;
  } | null;
};

type InvoiceData = {
  id: string;
  customer?: string | { id: string } | null;
  customer_email?: string | null;
  amount_paid?: number | null;
  currency?: string | null;
  hosted_invoice_url?: string | null;
  subscription?: string | { id: string } | null;
  parent?: {
    type?: string | null;
    subscription_details?: {
      subscription?: string | { id: string } | null;
      metadata?: Record<string, string> | null;
    } | null;
  } | null;
  subscription_details?: { metadata?: Record<string, string> | null } | null;
  metadata?: Record<string, string> | null;
  lines?: {
    data: InvoiceLineData[];
  };
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
        await handleInvoicePaid(config, stripe, invoice as InvoiceData, event.id);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        await handleInvoicePaymentFailed(config, stripe, invoice as InvoiceData);
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
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const userId = subscription.metadata?.user_id ?? await resolveUserIdForStripeCustomer(config, customerId, null);
  const rawPlan = resolvePlanFromMetadata(subscription.metadata);

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
  const interval = normalizeInterval(subscription.items?.data?.[0]?.price?.recurring?.interval) ?? "monthly";
  const currentPeriodStart = getSubscriptionPeriodStart(subscription);
  const currentPeriodEnd = getSubscriptionPeriodEnd(subscription);

  if (!currentPeriodStart || !currentPeriodEnd) {
    console.error(`[stripe-webhook] subscription ${subscription.id} missing current period bounds`);
    return;
  }

  await saveStripeCustomerMappingFromWebhook(config, userId, customerId);

  await upsertSubscription({
    ...config,
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    plan: serializePlanForDatabase(plan),
    billingInterval: interval,
    status: mapStripeSubscriptionStatus(subscription.status),
    currentPeriodStart: new Date(currentPeriodStart * 1000).toISOString(),
    currentPeriodEnd: new Date(currentPeriodEnd * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    creditsIncluded: planConfig.credits,
    templateSlotsIncluded: planConfig.templateSlots,
  });

  const normalizedStatus = mapStripeSubscriptionStatus(subscription.status);
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
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const userId = subscription.metadata?.user_id ?? await resolveUserIdForStripeCustomer(config, customerId, null);
  const existingSubscription = await getExistingSubscription(config, subscription.id);
  const currentPeriodEnd = getSubscriptionPeriodEnd(subscription);

  if (!userId) {
    console.error("[stripe-webhook] canceled subscription missing user_id", { subId: subscription.id });
    return;
  }
  if (!currentPeriodEnd) {
    console.error(`[stripe-webhook] canceled subscription ${subscription.id} missing current period end`);
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
      current_period_end: new Date(currentPeriodEnd * 1000).toISOString(),
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
  stripe: ReturnType<typeof getStripe>,
  invoice: InvoiceData,
  eventId: string,
) {
  const subscriptionId = extractInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    console.log(`[stripe-webhook] invoice ${invoice.id} has no subscription id, skipping`);
    return;
  }

  const lines = invoice.lines?.data ?? [];
  const existingSubscription = await getExistingSubscription(config, subscriptionId);
  const invoiceMetadata = extractInvoiceSubscriptionMetadata(invoice);
  const lineItem = selectSubscriptionInvoiceLine(lines);

  let stripeSubscription: SubscriptionData | null = null;
  if (
    !existingSubscription
    || !invoiceMetadata.plan
    || !invoiceMetadata.user_id
    || !lineItem?.period?.end
    || !resolveInvoiceInterval(lineItem, existingSubscription.billing_interval, null)
  ) {
    stripeSubscription = await retrieveStripeSubscription(stripe, subscriptionId);
  }

  // Find the subscription renewal line item — it has a recurring price and is not a proration.
  // This is more robust than using data[0], which can be a proration or add-on line.
  if (!lineItem) {
    console.log(`[stripe-webhook] invoice ${invoice.id} has no line items, skipping`);
    return;
  }

  // Skip if the only lines are prorations (plan switch invoices)
  if (lines.every((line) => isInvoiceLineProration(line))) {
    console.log(`[stripe-webhook] skipping all-proration invoice ${invoice.id}`);
    return;
  }

  const plan =
    resolvePlanFromMetadata(invoiceMetadata)
    ?? existingSubscription?.plan
    ?? resolvePlanFromMetadata(stripeSubscription?.metadata)
    ?? null;
  const userId =
    invoiceMetadata.user_id
    ?? existingSubscription?.user_id
    ?? stripeSubscription?.metadata?.user_id
    ?? await resolveUserIdForStripeCustomer(
      config,
      normalizeStripeId(invoice.customer) ?? normalizeStripeId(stripeSubscription?.customer) ?? null,
      invoice.customer_email ?? null,
    )
    ?? null;
  const billingInterval = resolveInvoiceInterval(
    lineItem,
    existingSubscription?.billing_interval ?? null,
    stripeSubscription,
  );

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
  const periodEnd = lineItem.period?.end ?? getSubscriptionPeriodEnd(stripeSubscription);
  if (!periodEnd) {
    console.error(`[stripe-webhook] invoice missing period end (inv=${invoice.id})`);
    return;
  }

  const stripeCustomerId =
    existingSubscription?.stripe_customer_id
    ?? normalizeStripeId(invoice.customer)
    ?? normalizeStripeId(stripeSubscription?.customer)
    ?? null;

  if (userId && stripeCustomerId) {
    await saveStripeCustomerMappingFromWebhook(config, userId, stripeCustomerId);
  }

  if (stripeCustomerId) {
    const periodStart = lineItem.period?.start ?? getSubscriptionPeriodStart(stripeSubscription) ?? periodEnd;
    await upsertSubscription({
      ...config,
      userId,
      stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
      plan: serializePlanForDatabase(normalizedPlan),
      billingInterval: billingInterval ?? "monthly",
      status: mapStripeSubscriptionStatus(stripeSubscription?.status),
      currentPeriodStart: new Date(periodStart * 1000).toISOString(),
      currentPeriodEnd: new Date(periodEnd * 1000).toISOString(),
      cancelAtPeriodEnd: stripeSubscription?.cancel_at_period_end ?? false,
      creditsIncluded: planConfig.credits,
      templateSlotsIncluded: planConfig.templateSlots,
    });
  }

  const isAnnual = billingInterval === "annual";
  const planLabel = resolveInvoicePlanLabel(lineItem, plan);

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
      planLabel,
      creditsGranted: creditAmount,
    });
  }, (error) => {
    logDiscordNotificationFailure("subscription renewed", userId, error);
  });

  scheduleBillingEmail(async () => {
    const email = await resolveUserEmail(config.supabaseUrl, config.serviceKey, userId);
    await sendSubscriptionReceiptEmail({
      email,
      invoiceId: invoice.id,
      amountPaid: invoice.amount_paid ?? null,
      currency: invoice.currency ?? null,
      plan: normalizedPlan,
      planLabel,
      interval: billingInterval ?? "monthly",
      periodEnd: new Date(periodEnd * 1000).toISOString(),
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      creditsGranted: creditAmount,
    });
  });

  console.log(`[stripe-webhook] granted ${creditAmount} subscription credits to ${userId} (plan=${normalizedPlan}, interval=${isAnnual ? "annual" : "monthly"}, event=${eventId})`);
}

async function handleInvoicePaymentFailed(
  config: { supabaseUrl: string; serviceKey: string },
  stripe: ReturnType<typeof getStripe>,
  invoice: InvoiceData,
) {
  const subId = extractInvoiceSubscriptionId(invoice);
  if (!subId) {
    return;
  }

  const invoiceMetadata = extractInvoiceSubscriptionMetadata(invoice);
  const existingSubscription = await getExistingSubscription(config, subId);
  const stripeSubscription = (!existingSubscription || !invoiceMetadata.user_id || !invoiceMetadata.plan)
    ? await retrieveStripeSubscription(stripe, subId)
    : null;
  const userId =
    invoiceMetadata.user_id
    ?? existingSubscription?.user_id
    ?? stripeSubscription?.metadata?.user_id
    ?? await resolveUserIdForStripeCustomer(
      config,
      normalizeStripeId(invoice.customer) ?? normalizeStripeId(stripeSubscription?.customer) ?? null,
      invoice.customer_email ?? null,
    );
  if (!userId) return;

  const stripeCustomerId =
    existingSubscription?.stripe_customer_id
    ?? normalizeStripeId(invoice.customer)
    ?? normalizeStripeId(stripeSubscription?.customer)
    ?? null;
  const billingInterval =
    existingSubscription?.billing_interval
    ?? normalizeInterval(stripeSubscription?.items?.data?.[0]?.price?.recurring?.interval)
    ?? "monthly";
  const plan = normalizePlanId(resolvePlanFromMetadata(invoiceMetadata) ?? existingSubscription?.plan ?? resolvePlanFromMetadata(stripeSubscription?.metadata) ?? "free");
  const planConfig = PLAN_CREDITS[plan];

  if (userId && stripeCustomerId) {
    await saveStripeCustomerMappingFromWebhook(config, userId, stripeCustomerId);
  }

  if (!existingSubscription && stripeCustomerId && stripeSubscription && planConfig) {
    const currentPeriodStart = getSubscriptionPeriodStart(stripeSubscription);
    const currentPeriodEnd = getSubscriptionPeriodEnd(stripeSubscription);

    if (currentPeriodStart && currentPeriodEnd) {
      await upsertSubscription({
        ...config,
        userId,
        stripeCustomerId,
        stripeSubscriptionId: subId,
        plan: serializePlanForDatabase(plan),
        billingInterval,
        status: "past_due",
        currentPeriodStart: new Date(currentPeriodStart * 1000).toISOString(),
        currentPeriodEnd: new Date(currentPeriodEnd * 1000).toISOString(),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end ?? false,
        creditsIncluded: planConfig.credits,
        templateSlotsIncluded: planConfig.templateSlots,
      });
    }
  }

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
        plan: invoiceMetadata.plan ?? existingSubscription?.plan ?? stripeSubscription?.metadata?.plan ?? null,
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

function scheduleBillingEmail(task: () => Promise<void>) {
  after(async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[stripe-webhook] billing email failed: ${error instanceof Error ? error.message : String(error)}`);
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
      select: "user_id,stripe_customer_id,plan,billing_interval,status",
      limit: "1",
    },
  }).catch(() => []);

  return rows[0] ?? null;
}

async function resolveUserIdForStripeCustomer(
  config: { supabaseUrl: string; serviceKey: string },
  stripeCustomerId: string | null,
  customerEmail: string | null,
) {
  if (stripeCustomerId) {
    const mappedRows = await fetchRestRows<{ user_id: string }>({
      ...config,
      table: "stripe_customers",
      query: {
        stripe_customer_id: `eq.${stripeCustomerId}`,
        select: "user_id",
        limit: "1",
      },
    }).catch(() => []);

    if (mappedRows[0]?.user_id) {
      return mappedRows[0].user_id;
    }
  }

  if (!customerEmail) {
    return null;
  }

  try {
    const supabase = createServiceSupabaseClient(config.supabaseUrl, config.serviceKey);
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) {
      throw error;
    }

    return data.users.find((user) => (user.email ?? "").toLowerCase() === customerEmail.toLowerCase())?.id ?? null;
  } catch {
    return null;
  }
}

async function saveStripeCustomerMappingFromWebhook(
  config: { supabaseUrl: string; serviceKey: string },
  userId: string,
  stripeCustomerId: string,
) {
  const url = new URL("/rest/v1/stripe_customers", config.supabaseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      stripe_customer_id: stripeCustomerId,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "Unknown error");
    console.error(`[stripe-webhook] failed to upsert stripe_customers for ${userId}: ${message}`);
  }
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

function extractInvoiceSubscriptionId(invoice: InvoiceData): string | null {
  return (
    normalizeStripeId(invoice.subscription)
    ?? normalizeStripeId(invoice.parent?.type === "subscription_details"
      ? invoice.parent.subscription_details?.subscription
      : null)
    ?? invoice.lines?.data.map((line) => normalizeStripeId(
      line.parent?.type === "subscription_item_details"
        ? line.parent.subscription_item_details?.subscription
        : null,
    )).find(Boolean)
    ?? null
  );
}

function extractInvoiceSubscriptionMetadata(invoice: InvoiceData) {
  return (
    (invoice.parent?.type === "subscription_details"
      ? invoice.parent.subscription_details?.metadata
      : null)
    ?? invoice.subscription_details?.metadata
    ?? invoice.metadata
    ?? null
  ) ?? {};
}

function selectSubscriptionInvoiceLine(lines: InvoiceLineData[]) {
  return lines.find((line) => !isInvoiceLineProration(line) && (
    Boolean(line.price?.recurring)
    || Boolean(normalizeStripeId(
      line.parent?.type === "subscription_item_details"
        ? line.parent.subscription_item_details?.subscription
        : null,
    ))
  )) ?? lines.find((line) => !isInvoiceLineProration(line)) ?? lines[0] ?? null;
}

function isInvoiceLineProration(line: InvoiceLineData) {
  return line.proration === true || (
    line.parent?.type === "subscription_item_details"
    && line.parent.subscription_item_details?.proration === true
  );
}

function resolveInvoiceInterval(
  line: InvoiceLineData | null,
  existingInterval: ExistingSubscriptionRow["billing_interval"] | null,
  subscription: SubscriptionData | null,
): "monthly" | "annual" | null {
  const recurringInterval = line?.price?.recurring?.interval
    ?? subscription?.items?.data?.[0]?.price?.recurring?.interval
    ?? null;

  return normalizeInterval(recurringInterval) ?? existingInterval;
}

function normalizeInterval(value: string | null | undefined): "monthly" | "annual" | null {
  if (value === "year") return "annual";
  if (value === "month") return "monthly";
  return null;
}

function getSubscriptionPeriodStart(subscription: SubscriptionData | null) {
  return subscription?.items?.data?.[0]?.current_period_start ?? subscription?.current_period_start ?? null;
}

function getSubscriptionPeriodEnd(subscription: SubscriptionData | null) {
  return subscription?.items?.data?.[0]?.current_period_end ?? subscription?.current_period_end ?? null;
}

function normalizeStripeId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

async function retrieveStripeSubscription(
  stripe: ReturnType<typeof getStripe>,
  subscriptionId: string,
): Promise<SubscriptionData | null> {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return subscription as unknown as SubscriptionData;
  } catch (error) {
    console.error(`[stripe-webhook] failed to retrieve subscription ${subscriptionId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function mapStripeSubscriptionStatus(status: string | undefined) {
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

  return statusMap[status ?? ""] ?? "active";
}

async function sendSubscriptionReceiptEmail(input: {
  email: string;
  invoiceId: string;
  amountPaid: number | null;
  currency: string | null;
  plan: string;
  planLabel?: string | null;
  interval: "monthly" | "annual";
  periodEnd: string;
  hostedInvoiceUrl: string | null;
  creditsGranted: number;
}) {
  const resendApiKey = process.env.RESEND_API_KEY ?? process.env.RESEND_CURSOR_API_KEY;
  if (!resendApiKey || !input.email) {
    return;
  }

  const amountLabel = formatMoney(input.amountPaid, input.currency);
  const planLabel = input.planLabel?.trim() || getPlanLabelForEmail(input.plan);
  const intervalLabel = input.interval === "annual" ? "Annual" : "Monthly";
  const periodEndLabel = new Intl.DateTimeFormat("en-CH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(input.periodEnd));

  const html = `<body style="background:#F7F5F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;margin:0;padding:40px 20px;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr>
      <td style="padding:28px;border:1px solid #E8E4DB;border-radius:14px;background:#FFFFFF;">
        <p style="color:#1A6AFF;font-size:11px;font-weight:700;letter-spacing:1.6px;margin:0 0 16px 0;text-transform:uppercase;">Subscription receipt</p>
        <img src="https://basquio.com/brand/png/logo/1x/basquio-logo-light-bg-blue.png" alt="Basquio" width="110" height="auto" style="display:block;margin-bottom:28px;">
        <h1 style="color:#0B0C0C;font-size:28px;line-height:1.1;letter-spacing:-0.04em;margin:0 0 14px 0;">Payment received.</h1>
        <p style="color:#4B5563;font-size:15px;line-height:24px;margin:0 0 20px 0;">We received your ${planLabel} ${intervalLabel.toLowerCase()} subscription payment.</p>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;border-collapse:collapse;">
          <tr><td style="padding:10px 0;color:#64748B;font-size:13px;">Amount paid</td><td style="padding:10px 0;color:#0B0C0C;font-size:14px;font-weight:700;text-align:right;">${amountLabel}</td></tr>
          <tr><td style="padding:10px 0;color:#64748B;font-size:13px;border-top:1px solid #E8E4DB;">Plan</td><td style="padding:10px 0;color:#0B0C0C;font-size:14px;font-weight:700;text-align:right;border-top:1px solid #E8E4DB;">${planLabel}</td></tr>
          <tr><td style="padding:10px 0;color:#64748B;font-size:13px;border-top:1px solid #E8E4DB;">Billing interval</td><td style="padding:10px 0;color:#0B0C0C;font-size:14px;font-weight:700;text-align:right;border-top:1px solid #E8E4DB;">${intervalLabel}</td></tr>
          <tr><td style="padding:10px 0;color:#64748B;font-size:13px;border-top:1px solid #E8E4DB;">Credits granted</td><td style="padding:10px 0;color:#0B0C0C;font-size:14px;font-weight:700;text-align:right;border-top:1px solid #E8E4DB;">${input.creditsGranted}</td></tr>
          <tr><td style="padding:10px 0;color:#64748B;font-size:13px;border-top:1px solid #E8E4DB;">Coverage through</td><td style="padding:10px 0;color:#0B0C0C;font-size:14px;font-weight:700;text-align:right;border-top:1px solid #E8E4DB;">${periodEndLabel}</td></tr>
          <tr><td style="padding:10px 0;color:#64748B;font-size:13px;border-top:1px solid #E8E4DB;">Invoice</td><td style="padding:10px 0;color:#0B0C0C;font-size:14px;font-weight:700;text-align:right;border-top:1px solid #E8E4DB;">${input.invoiceId}</td></tr>
        </table>
        ${input.hostedInvoiceUrl ? `<p style="margin:24px 0 0 0;"><a href="${input.hostedInvoiceUrl}" style="background-color:#1A6AFF;border-radius:6px;color:#FFFFFF;display:inline-block;font-size:14px;font-weight:700;padding:12px 20px;text-decoration:none;">Open Stripe invoice</a></p>` : ""}
        <p style="color:#94A3B8;font-size:12px;line-height:20px;margin:24px 0 0 0;">Marco at Basquio</p>
      </td>
    </tr>
  </table>
</body>`;

  await sendResendHtmlEmail({
    apiKey: resendApiKey,
    from: "Marco at Basquio <reports@basquio.com>",
    to: [input.email],
    subject: `Basquio subscription receipt: ${amountLabel}`,
    html,
    idempotencyKey: `subscription-receipt-${input.invoiceId}`,
  });
}

function formatMoney(amountMinor: number | null, currency: string | null) {
  if (amountMinor === null || !currency) {
    return "Paid";
  }

  try {
    return new Intl.NumberFormat("en-CH", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function getPlanLabelForEmail(plan: string) {
  const normalized = normalizePlanId(plan);
  if (normalized === "starter") return "Starter";
  if (normalized === "pro") return "Pro";
  if (normalized === "enterprise") return "Enterprise";
  return "Subscription";
}

function serializePlanForDatabase(plan: string) {
  return normalizePlanId(plan) === "enterprise" ? "team" : normalizePlanId(plan);
}

function resolveInvoicePlanLabel(lineItem: InvoiceLineData | null, fallbackPlan: string | null) {
  return (
    resolvePlanLabelFromText(lineItem?.description)
    ?? resolvePlanLabelFromMetadata(lineItem?.metadata)
    ?? (fallbackPlan ? getPlanLabelForEmail(fallbackPlan) : null)
  );
}

function resolvePlanLabelFromText(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes("enterprise")
    || normalized.includes("custom dashboard")
    || normalized.includes("custom analysis")
    || normalized.includes("custom plan")
    || normalized.includes("team")
  ) {
    return "Enterprise";
  }
  if (normalized.includes("starter") || normalized.includes("grow") || normalized.includes("essentials")) {
    return "Starter";
  }
  if (normalized.includes("professional") || /\bpro\b/.test(normalized)) {
    return "Pro";
  }
  return null;
}

function resolvePlanLabelFromMetadata(metadata: Record<string, string> | null | undefined) {
  const raw = metadata?.plan ?? metadata?.tier ?? null;
  if (!raw) {
    return null;
  }
  if (raw === "grow" || raw === "starter" || raw === "essentials") {
    return "Starter";
  }
  if (raw === "team" || raw === "enterprise") {
    return "Enterprise";
  }
  if (raw === "professional" || raw === "pro") {
    return "Pro";
  }
  return null;
}

function resolvePlanFromMetadata(metadata: Record<string, string> | null | undefined) {
  const raw = metadata?.plan ?? metadata?.tier ?? null;
  if (!raw) {
    return null;
  }

  if (raw === "grow" || raw === "starter" || raw === "essentials") {
    return "starter";
  }
  if (raw === "team" || raw === "enterprise") {
    return "team";
  }
  if (raw === "professional" || raw === "pro") {
    return "pro";
  }

  return raw;
}
