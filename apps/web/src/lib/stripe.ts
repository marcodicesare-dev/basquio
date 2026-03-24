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

  stripeInstance = new Stripe(secretKey);

  return stripeInstance;
}

/**
 * Credit pack configuration for per-slide pricing.
 *
 * Pricing model: 3 base credits + 1 credit per slide.
 * A 10-slide deck costs 13 credits.
 *
 * Pack pricing:
 * - 25 credits ($15) = $0.60/credit — enough for ~2 eight-slide decks
 * - 50 credits ($25) = $0.50/credit — enough for ~4 ten-slide decks
 * - 100 credits ($40) = $0.40/credit — enough for ~7 ten-slide decks
 *
 * Prices are configured in Stripe Dashboard and referenced by env vars.
 */
export const CREDIT_PACKS = {
  pack_25: {
    credits: 25,
    reason: "purchase_pack" as const,
  },
  pack_50: {
    credits: 50,
    reason: "purchase_pack" as const,
  },
  pack_100: {
    credits: 100,
    reason: "purchase_pack" as const,
  },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

/**
 * Get the Stripe Price ID for a credit pack from env vars.
 * Env var format: STRIPE_PRICE_PACK_25, STRIPE_PRICE_PACK_50, STRIPE_PRICE_PACK_100
 */
export function getPriceId(packId: CreditPackId): string {
  const envKey = `STRIPE_PRICE_${packId.toUpperCase()}`;
  const priceId = process.env[envKey];

  if (!priceId) {
    throw new Error(`${envKey} environment variable is required.`);
  }

  return priceId;
}
