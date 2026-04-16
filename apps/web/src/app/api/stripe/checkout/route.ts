import { NextResponse } from "next/server";

import { normalizePlanId, planToCreditPackTier, type CreditPackId } from "@/lib/billing-config";
import { calculateRunCredits, ensureFreeTierCredit, getActiveSubscription, getDetailedCreditBalance } from "@/lib/credits";
import { getViewerState } from "@/lib/supabase/auth";
import { getStripe, getPriceId, getSubscriptionPriceId, getOrCreateStripeCustomer, getTemplateFeePriceId } from "@/lib/stripe";
import { getTemplateFeeDraft } from "@/lib/template-fee-drafts";

export const runtime = "nodejs";

const VALID_PACKS: CreditPackId[] = ["pack_25", "pack_50", "pack_100", "pack_250"];
const VALID_PLANS = ["starter", "pro"] as const;
const VALID_INTERVALS = ["monthly", "annual"] as const;

type CheckoutBody =
  | { type: "credit_pack"; packId: string }
  | { type: "subscription"; plan: string; interval: string }
  | { type: "template_fee"; templateProfileId?: string | null; draftId?: string | null }
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
    if (type === "template_fee") {
      return handleTemplateFeeCheckout(stripe, body as { type: "template_fee"; templateProfileId?: string | null; draftId?: string | null }, {
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

  const subscription = await getActiveSubscription({ supabaseUrl: ctx.supabaseUrl, serviceKey: ctx.serviceKey, userId: ctx.userId });
  const priceTier = planToCreditPackTier(subscription?.plan ?? "free");
  const priceId = getPriceId(packId, priceTier);
  const customerId = await getOrCreateStripeCustomer(stripe, ctx.supabaseUrl, ctx.serviceKey, ctx.userId, ctx.email);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    ...(ctx.email ? { payment_intent_data: { receipt_email: ctx.email } } : {}),
    metadata: {
      user_id: ctx.userId,
      pack_id: packId,
      pack_pricing_tier: priceTier,
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

async function handleTemplateFeeCheckout(
  stripe: ReturnType<typeof getStripe>,
  body: { type: "template_fee"; templateProfileId?: string | null; draftId?: string | null },
  ctx: { origin: string; userId: string; email: string; supabaseUrl: string; serviceKey: string },
) {
  if (!body.draftId) {
    return NextResponse.json({ error: "A persisted template-fee draft is required before checkout." }, { status: 400 });
  }

  const subscription = await getActiveSubscription({ supabaseUrl: ctx.supabaseUrl, serviceKey: ctx.serviceKey, userId: ctx.userId });
  const currentPlan = normalizePlanId(subscription?.plan ?? "free");
  if (currentPlan !== "free") {
    return NextResponse.json({ error: "Template-fee checkout is only available on the free plan." }, { status: 400 });
  }

  const draft = await getTemplateFeeDraft({
    supabaseUrl: ctx.supabaseUrl,
    serviceKey: ctx.serviceKey,
    draftId: body.draftId,
    userId: ctx.userId,
  });
  if (!draft) {
    return NextResponse.json({ error: "Template-fee draft not found." }, { status: 404 });
  }
  if (draft.status !== "pending_payment") {
    return NextResponse.json({ error: "This template-fee draft is no longer awaiting payment." }, { status: 409 });
  }
  if (new Date(draft.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "This template-fee draft expired. Start a new run from /jobs/new." }, { status: 409 });
  }
  if (body.templateProfileId && draft.template_profile_id !== body.templateProfileId) {
    return NextResponse.json({ error: "Template-fee checkout does not match the persisted draft." }, { status: 400 });
  }

  await ensureFreeTierCredit({ supabaseUrl: ctx.supabaseUrl, serviceKey: ctx.serviceKey, userId: ctx.userId });
  const balance = await getDetailedCreditBalance({ supabaseUrl: ctx.supabaseUrl, serviceKey: ctx.serviceKey, userId: ctx.userId });
  const creditsNeeded = calculateRunCredits(draft.target_slide_count, draft.author_model);
  if (balance.balance < creditsNeeded) {
    return NextResponse.json({
      error: `Not enough credits. This run needs ${creditsNeeded} credits, but you have ${balance.balance}. Buy credits before paying the template fee.`,
      code: "INSUFFICIENT_CREDITS_FOR_TEMPLATE_CHECKOUT",
      creditsNeeded,
      creditsAvailable: balance.balance,
    }, { status: 402 });
  }

  const customerId = await getOrCreateStripeCustomer(stripe, ctx.supabaseUrl, ctx.serviceKey, ctx.userId, ctx.email);
  const priceId = getTemplateFeePriceId();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    ...(ctx.email ? { payment_intent_data: { receipt_email: ctx.email } } : {}),
    metadata: {
      user_id: ctx.userId,
      draft_id: body.draftId,
      template_profile_id: body.templateProfileId ?? "",
      type: "template_fee",
    },
    success_url: `${ctx.origin}/jobs/new?templateFee=success&draft=${encodeURIComponent(body.draftId)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${ctx.origin}/jobs/new?templateFee=cancelled&draft=${encodeURIComponent(body.draftId)}`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Failed to create template fee checkout session." }, { status: 500 });
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
      plan: normalizePlanId(plan),
      interval,
      type: "subscription",
    },
    subscription_data: {
      metadata: {
        user_id: ctx.userId,
        plan: normalizePlanId(plan),
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
