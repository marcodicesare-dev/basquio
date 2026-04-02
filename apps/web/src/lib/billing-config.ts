/**
 * Billing configuration: tier mapping, plan definitions, credit pack pricing.
 *
 * UI shows Memo/Deck/Deep-Dive. Internal code uses claude-* model names.
 * This file is the single source of truth for the mapping.
 */

// ─── TIER CONFIG (output types) ─────────────────────────────

export const TIER_CONFIG = {
  memo: {
    model: "claude-haiku-4-5" as const,
    label: "Memo",
    description: "Data tables and narrative report. No slides.",
    shortDescription: "Fast, no slides",
    estimatedTime: "~2 min",
    artifacts: ["XLSX", "MD"],
  },
  deck: {
    model: "claude-sonnet-4-6" as const,
    label: "Deck",
    description: "Full analysis deck with real charts and narrative report.",
    shortDescription: "Full deck with charts",
    estimatedTime: "~15 min",
    artifacts: ["PPTX", "MD", "XLSX"],
  },
  "deep-dive": {
    model: "claude-opus-4-6" as const,
    label: "Deep-Dive",
    description: "Consulting-grade depth. The full treatment.",
    shortDescription: "Maximum analytical depth",
    estimatedTime: "~25 min",
    artifacts: ["PPTX", "MD", "XLSX"],
  },
} as const;

export type TierId = keyof typeof TIER_CONFIG;
export type AuthorModel = (typeof TIER_CONFIG)[TierId]["model"];

/** Resolve a UI tier ID to an internal model name. */
export function tierToModel(tier: TierId): AuthorModel {
  return TIER_CONFIG[tier].model;
}

/** Resolve an internal model name back to a tier ID. */
export function modelToTier(model: string): TierId {
  for (const [id, config] of Object.entries(TIER_CONFIG)) {
    if (config.model === model) return id as TierId;
  }
  return "deck"; // fallback
}

// ─── PLAN DEFINITIONS ───────────────────────────────────────

export type PlanId = "free" | "starter" | "pro" | "team";

export interface PlanConfig {
  label: string;
  monthlyPrice: number;
  annualMonthlyPrice: number;
  annualPrice: number;
  creditsIncluded: number;
  templateSlots: number;
  features: string[];
  highlight: boolean;
}

export const PLAN_CONFIG: Record<PlanId, PlanConfig> = {
  free: {
    label: "Free",
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    annualPrice: 0,
    creditsIncluded: 0, // 3 free runs via credit_grants, not subscription
    templateSlots: 0,
    features: [
      "40 free credits (~3 Deck runs)",
      "Basquio branding on output",
      "Community templates only",
    ],
    highlight: false,
  },
  starter: {
    label: "Starter",
    monthlyPrice: 29,
    annualMonthlyPrice: 23,
    annualPrice: 276,
    creditsIncluded: 30,
    templateSlots: 1,
    features: [
      "No branding on output",
      "30 credits/month",
      "1 custom template slot",
      "Email support",
    ],
    highlight: false,
  },
  pro: {
    label: "Pro",
    monthlyPrice: 79,
    annualMonthlyPrice: 63,
    annualPrice: 756,
    creditsIncluded: 100,
    templateSlots: 5,
    features: [
      "No branding on output",
      "100 credits/month",
      "5 custom template slots",
      "Priority generation queue",
      "Narrative reports",
    ],
    highlight: true,
  },
  team: {
    label: "Team",
    monthlyPrice: 149,
    annualMonthlyPrice: 119,
    annualPrice: 1428,
    creditsIncluded: 200,
    templateSlots: 10,
    features: [
      "Shared workspace",
      "200 credits/month pool",
      "10 custom template slots",
      "Billing controls",
      "+$29/seat/month",
    ],
    highlight: false,
  },
};

// ─── CREDIT PACKS ───────────────────────────────────────────

export interface CreditPackConfig {
  credits: number;
  price: number;
  perCredit: number;
  discount: string;
}

export const CREDIT_PACKS_CONFIG: Record<string, CreditPackConfig> = {
  pack_25: { credits: 25, price: 18, perCredit: 0.72, discount: "10%" },
  pack_50: { credits: 50, price: 32, perCredit: 0.64, discount: "20%" },
  pack_100: { credits: 100, price: 56, perCredit: 0.56, discount: "30%" },
  pack_250: { credits: 250, price: 125, perCredit: 0.50, discount: "37.5%" },
};

export type CreditPackId = keyof typeof CREDIT_PACKS_CONFIG;

// ─── PRICE ENV VAR RESOLVER ─────────────────────────────────

/**
 * Get Stripe Price ID from environment variable.
 * Convention: STRIPE_PRICE_{IDENTIFIER} where identifier is uppercase.
 */
export function getStripePriceId(identifier: string): string {
  const envKey = `STRIPE_PRICE_${identifier.toUpperCase()}`;
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new Error(`${envKey} environment variable is required.`);
  }
  return priceId;
}

/** Map plan + interval to Stripe price env var identifier. */
export function planPriceIdentifier(plan: PlanId, interval: "monthly" | "annual"): string {
  return `${plan}_${interval}`;
}
