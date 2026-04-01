import Stripe from "stripe";

import { CREDIT_PACKS_CONFIG, PLAN_CONFIG } from "@/lib/billing-config";

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeInstance) {
    return stripeInstance;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is required.");
  }

  stripeInstance = new Stripe(secretKey);

  return stripeInstance;
}

/**
 * Credit pack configuration — single source of truth is billing-config.ts.
 * This re-export adds the `reason` field needed by webhook handlers.
 */
export const CREDIT_PACKS = Object.fromEntries(
  Object.entries(CREDIT_PACKS_CONFIG).map(([id, config]) => [
    id,
    { credits: config.credits, price: config.price, reason: "purchase_pack" as const },
  ]),
) as Record<string, { credits: number; price: number; reason: "purchase_pack" }>;

export type CreditPackId = keyof typeof CREDIT_PACKS_CONFIG;

/**
 * Get the Stripe Price ID for a credit pack from env vars.
 * Env var format: STRIPE_PRICE_PACK_25, STRIPE_PRICE_PACK_50, etc.
 */
export function getPriceId(packId: CreditPackId): string {
  const envKey = `STRIPE_PRICE_${packId.toUpperCase()}`;
  const priceId = process.env[envKey];

  if (!priceId) {
    throw new Error(`${envKey} environment variable is required.`);
  }

  return priceId;
}

/**
 * Get the Stripe Price ID for a subscription plan.
 * Env var format: STRIPE_PRICE_STARTER_MONTHLY, STRIPE_PRICE_PRO_ANNUAL, etc.
 */
export function getSubscriptionPriceId(plan: string, interval: "monthly" | "annual"): string {
  const envKey = `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
  const priceId = process.env[envKey];

  if (!priceId) {
    throw new Error(`${envKey} environment variable is required.`);
  }

  return priceId;
}

/** Plan metadata: credits included per period + template slots. Derived from billing-config. */
export const PLAN_CREDITS: Record<string, { credits: number; templateSlots: number }> = Object.fromEntries(
  Object.entries(PLAN_CONFIG)
    .filter(([id]) => id !== "free")
    .map(([id, config]) => [id, { credits: config.creditsIncluded, templateSlots: config.templateSlots }]),
);

/**
 * Get or create a Stripe customer for a Supabase user.
 * Checks stripe_customers mapping table first, creates if missing.
 */
export async function getOrCreateStripeCustomer(
  stripe: Stripe,
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  email: string,
): Promise<string> {
  // Check mapping table
  const lookupUrl = new URL("/rest/v1/stripe_customers", supabaseUrl);
  lookupUrl.searchParams.set("user_id", `eq.${userId}`);
  lookupUrl.searchParams.set("select", "stripe_customer_id");
  lookupUrl.searchParams.set("limit", "1");

  const lookupRes = await fetch(lookupUrl, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (lookupRes.ok) {
    const rows = await lookupRes.json();
    if (rows.length > 0 && rows[0].stripe_customer_id) {
      return rows[0].stripe_customer_id;
    }
  }

  // Create Stripe customer
  const customer = await stripe.customers.create({
    email,
    metadata: { supabase_user_id: userId },
  });

  // Save mapping (handle race condition: another request may have inserted first)
  const insertUrl = new URL("/rest/v1/stripe_customers", supabaseUrl);
  const insertRes = await fetch(insertUrl, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      stripe_customer_id: customer.id,
    }),
    cache: "no-store",
  });

  if (!insertRes.ok) {
    // Conflict means another request created the mapping — re-query
    const retryUrl = new URL("/rest/v1/stripe_customers", supabaseUrl);
    retryUrl.searchParams.set("user_id", `eq.${userId}`);
    retryUrl.searchParams.set("select", "stripe_customer_id");
    retryUrl.searchParams.set("limit", "1");
    const retryRes = await fetch(retryUrl, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (retryRes.ok) {
      const rows = await retryRes.json();
      if (rows.length > 0 && rows[0].stripe_customer_id) {
        return rows[0].stripe_customer_id;
      }
    }
  }

  return customer.id;
}
