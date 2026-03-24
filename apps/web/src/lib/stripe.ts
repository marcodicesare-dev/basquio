import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeInstance) {
    return stripeInstance;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is required.");
  }

  stripeInstance = new Stripe(secretKey, {
    apiVersion: "2026-02-25.clover",
    typescript: true,
  });

  return stripeInstance;
}

/**
 * Product configuration for per-deck pricing.
 * Prices are configured in Stripe Dashboard, referenced by env vars.
 */
export const DECK_PRODUCTS = {
  standard: {
    credits: 1,
    reason: "purchase_standard" as const,
  },
  pro: {
    credits: 1,
    reason: "purchase_pro" as const,
  },
  pack_5: {
    credits: 5,
    reason: "purchase_pack" as const,
  },
  pack_10: {
    credits: 10,
    reason: "purchase_pack" as const,
  },
} as const;

export type DeckTier = keyof typeof DECK_PRODUCTS;

/**
 * Get the Stripe Price ID for a deck tier from env vars.
 */
export function getPriceId(tier: DeckTier): string {
  const envKey = `STRIPE_PRICE_${tier.toUpperCase()}`;
  const priceId = process.env[envKey];

  if (!priceId) {
    throw new Error(`${envKey} environment variable is required.`);
  }

  return priceId;
}
