import Stripe from "stripe";

import { CREDIT_PACK_CATALOG, type CreditPackId, type PackPricingTier, PLAN_CONFIG } from "@/lib/billing-config";
export type { CreditPackId } from "@/lib/billing-config";

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
  Object.entries(CREDIT_PACK_CATALOG).map(([id, config]) => [
    id,
    { credits: config.credits, reason: "purchase_pack" as const },
  ]),
) as Record<string, { credits: number; reason: "purchase_pack" }>;

/**
 * Get the Stripe Price ID for a credit pack from env vars.
 * New env var format: STRIPE_PRICE_FREE_PACK_25, STRIPE_PRICE_STARTER_PACK_25, STRIPE_PRICE_PRO_PACK_25.
 * Fallback format for backwards compatibility: STRIPE_PRICE_PACK_25.
 */
export function getPriceId(packId: CreditPackId, tier: PackPricingTier): string {
  const envKeys = [
    `STRIPE_PRICE_${tier.toUpperCase()}_${packId.toUpperCase()}`,
    `STRIPE_PRICE_${packId.toUpperCase()}`,
  ];
  const envKey = envKeys.find((candidate) => Boolean(process.env[candidate]));
  const priceId = envKey ? process.env[envKey] : undefined;

  if (!priceId) {
    throw new Error(`${envKeys.join(" or ")} environment variable is required.`);
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

export function getTemplateFeePriceId(): string {
  const envKeys = ["STRIPE_PRICE_TEMPLATE_FEE", "STRIPE_PRICE_TEMPLATE_RUN_FEE"];
  const envKey = envKeys.find((candidate) => Boolean(process.env[candidate]));
  const priceId = envKey ? process.env[envKey] : undefined;
  if (!priceId) {
    throw new Error(`${envKeys.join(" or ")} environment variable is required.`);
  }
  return priceId;
}

/** Plan metadata: credits included per period + template slots. Derived from billing-config. */
export const PLAN_CREDITS: Record<string, { credits: number; templateSlots: number }> = Object.fromEntries(
  Object.entries(PLAN_CONFIG)
    .filter(([id]) => id !== "free")
    .map(([id, config]) => [id, { credits: config.creditsIncluded, templateSlots: config.templateSlots }]),
);

type StripeCustomerMappingRow = {
  user_id: string;
  stripe_customer_id: string;
};

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
  const existingMapping = await getStripeCustomerMapping(supabaseUrl, serviceKey, userId);
  if (existingMapping?.stripe_customer_id) {
    const existingCustomer = await retrieveStripeCustomer(stripe, existingMapping.stripe_customer_id);
    if (existingCustomer) {
      return existingCustomer.id;
    }
  }

  const matchedCustomer = await findReusableStripeCustomer(stripe, userId, email);
  if (matchedCustomer) {
    await saveStripeCustomerMapping(supabaseUrl, serviceKey, userId, matchedCustomer.id);
    return matchedCustomer.id;
  }

  const customer = await stripe.customers.create({
    ...(email ? { email } : {}),
    metadata: { supabase_user_id: userId },
  });

  await saveStripeCustomerMapping(supabaseUrl, serviceKey, userId, customer.id);

  return customer.id;
}

async function getStripeCustomerMapping(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<StripeCustomerMappingRow | null> {
  const lookupUrl = new URL("/rest/v1/stripe_customers", supabaseUrl);
  lookupUrl.searchParams.set("user_id", `eq.${userId}`);
  lookupUrl.searchParams.set("select", "user_id,stripe_customer_id");
  lookupUrl.searchParams.set("limit", "1");

  const lookupRes = await fetch(lookupUrl, {
    headers: buildSupabaseHeaders(serviceKey),
    cache: "no-store",
  });

  if (!lookupRes.ok) {
    return null;
  }

  const rows = (await lookupRes.json()) as StripeCustomerMappingRow[];
  return rows[0] ?? null;
}

async function saveStripeCustomerMapping(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  const existingMapping = await getStripeCustomerMapping(supabaseUrl, serviceKey, userId);

  if (existingMapping) {
    const updateUrl = new URL("/rest/v1/stripe_customers", supabaseUrl);
    updateUrl.searchParams.set("user_id", `eq.${userId}`);

    const updateRes = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        ...buildSupabaseHeaders(serviceKey),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        stripe_customer_id: stripeCustomerId,
      }),
      cache: "no-store",
    });

    if (updateRes.ok) {
      return;
    }
  }

  const insertUrl = new URL("/rest/v1/stripe_customers", supabaseUrl);
  const insertRes = await fetch(insertUrl, {
    method: "POST",
    headers: {
      ...buildSupabaseHeaders(serviceKey),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      stripe_customer_id: stripeCustomerId,
    }),
    cache: "no-store",
  });

  if (!insertRes.ok) {
    const message = await insertRes.text().catch(() => "Unknown error");
    throw new Error(`Failed to save Stripe customer mapping: ${message}`);
  }
}

async function retrieveStripeCustomer(
  stripe: Stripe,
  stripeCustomerId: string,
): Promise<Stripe.Customer | null> {
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if ("deleted" in customer && customer.deleted) {
      return null;
    }
    return customer;
  } catch (error) {
    if (isMissingCustomerError(error)) {
      return null;
    }
    throw error;
  }
}

async function findReusableStripeCustomer(
  stripe: Stripe,
  userId: string,
  email: string,
): Promise<Stripe.Customer | null> {
  if (!email) {
    return null;
  }

  const customers = await stripe.customers.list({ email, limit: 10 });
  const activeCustomers = customers.data.filter((customer) => !("deleted" in customer && customer.deleted));

  const exactMetadataMatch = activeCustomers.find(
    (customer) => customer.metadata?.supabase_user_id === userId,
  );
  if (exactMetadataMatch) {
    return exactMetadataMatch;
  }

  const exactEmailMatch = activeCustomers.find(
    (customer) => (customer.email ?? "").toLowerCase() === email.toLowerCase(),
  );
  if (exactEmailMatch) {
    if (exactEmailMatch.metadata?.supabase_user_id !== userId) {
      await stripe.customers.update(exactEmailMatch.id, {
        metadata: {
          ...exactEmailMatch.metadata,
          supabase_user_id: userId,
        },
      });
    }
    return exactEmailMatch;
  }

  return null;
}

function isMissingCustomerError(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeInvalidRequestError
    && error.code === "resource_missing"
    && error.param === "customer";
}

function buildSupabaseHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json",
  };
}
